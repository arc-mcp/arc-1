import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  AunitIncompleteError,
  appendAunitJunitDiagnostic,
  aunitIncompleteToJunit,
  aunitResultToJunit,
  findSourceDeclaredAunitClasses,
  findStaticAbapIncludes,
  parseAunitRunResult,
  parseNativeJunitSummary,
  probePublicAunit,
  reconcileAunitProgramSources,
  reconcileAunitSourceDeclarations,
  runPublicAunit,
} from '../../../src/adt/aunit.js';
import { AdtApiError } from '../../../src/adt/errors.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';

const fixtureDir = join(import.meta.dirname, '../../fixtures/xml');
const mixed = readFileSync(join(fixtureDir, 'aunit-testrun-mixed-alerts.xml'), 'utf8');
const localizedEmptyClass = readFileSync(join(fixtureDir, 'aunit-testrun-localized-empty-class.xml'), 'utf8');
const programAlert = readFileSync(join(fixtureDir, 'aunit-testrun-program-alert.xml'), 'utf8');
const harmlessOnlyResult = `
  <aunit:runResult xmlns:aunit="http://www.sap.com/adt/aunit">
    <program name="ZARC1_MIXED"><testClasses>
      <testClass name="LTCL_HARMLESS" riskLevel="harmless"><testMethods>
        <testMethod name="PASSES" executionTime="0.1"/>
      </testMethods></testClass>
    </testClasses></program>
  </aunit:runResult>`;
const mixedRiskSource = `
  REPORT zarc1_mixed.
  CLASS lcl_production_helper DEFINITION.
  ENDCLASS.
  CLASS ltd_test_double DEFINITION FOR TESTING.
    PUBLIC SECTION.
      METHODS configure.
  ENDCLASS.
  CLASS ltcl_harmless DEFINITION FINAL FOR TESTING RISK LEVEL HARMLESS.
    PRIVATE SECTION.
      METHODS passes FOR TESTING.
  ENDCLASS.
  CLASS ltcl_dangerous DEFINITION FINAL FOR TESTING RISK LEVEL DANGEROUS.
    PRIVATE SECTION.
      METHODS mutates FOR TESTING.
  ENDCLASS.`;

function publicHttp(options: { get?: ReturnType<typeof vi.fn>; post?: ReturnType<typeof vi.fn> }): AdtHttpClient {
  return {
    get: options.get ?? vi.fn(),
    post: options.post ?? vi.fn(),
  } as unknown as AdtHttpClient;
}

describe('ABAP Unit CI model', () => {
  it('finds only executable source test classes and handles risk defaults, templates, and helpers', () => {
    const source = `
      REPORT zscan.
      " CLASS ltcl_comment DEFINITION FOR TESTING RISK LEVEL CRITICAL.
      DATA(fake) = |{ |CLASS ltcl_template DEFINITION FOR TESTING RISK LEVEL CRITICAL.| }|.
      DATA(fake2) = |{ \`|CLASS ltcl_literal DEFINITION FOR TESTING RISK LEVEL DANGEROUS.|\` }|.
      CLASS lhc_handler DEFINITION DEFERRED FOR TESTING.
      CLASS lhc_handler DEFINITION INHERITING FROM cl_abap_behavior_handler.
      ENDCLASS.
      CLASS ltd_mock DEFINITION FOR TESTING.
        METHODS configure.
      ENDCLASS.
      CLASS ltcl_default DEFINITION FOR TESTING.
        METHODS executes FOR TESTING.
      ENDCLASS.
      CLASS ltcl_safe DEFINITION FOR TESTING RISK LEVEL HARMLESS.
        METHODS executes FOR TESTING.
      ENDCLASS.`;

    expect(findSourceDeclaredAunitClasses(source)).toEqual([
      { testClass: 'LTCL_DEFAULT', riskLevel: 'critical', explicitRiskLevel: false },
      { testClass: 'LTCL_SAFE', riskLevel: 'harmless', explicitRiskLevel: true },
    ]);
    expect(
      findStaticAbapIncludes('INCLUDE zinc. INCLUDE TYPE ty_s. INCLUDE STRUCTURE mara. INCLUDE (lv_prog).'),
    ).toEqual(['ZINC']);
    expect(
      findSourceDeclaredAunitClasses(`
        REPORT zscan.
        DATA n TYPE i.
        n = 2
          * 3.
        CLASS ltcl_after_multiply DEFINITION FOR TESTING RISK LEVEL CRITICAL.
          METHODS executes FOR TESTING.
        ENDCLASS.`),
    ).toEqual([{ testClass: 'LTCL_AFTER_MULTIPLY', riskLevel: 'critical', explicitRiskLevel: true }]);
    expect(
      findSourceDeclaredAunitClasses(`
        CLASS zcl_global_test DEFINITION PUBLIC FOR TESTING RISK LEVEL DANGEROUS.
          PUBLIC SECTION.
            METHODS global_test.
            METHODS setup.
        ENDCLASS.`),
    ).toEqual([{ testClass: 'ZCL_GLOBAL_TEST', riskLevel: 'dangerous', explicitRiskLevel: true }]);
  });

  it('keeps column-one comments inside templates from exposing fake classes or hiding real classes', () => {
    const source = `DATA(text) = |{ 1
* } |. CLASS ltcl_fake DEFINITION FOR TESTING RISK LEVEL HARMLESS. |
  }|.
CLASS ltcl_real DEFINITION FOR TESTING RISK LEVEL CRITICAL.
  PRIVATE SECTION.
    METHODS real FOR TESTING.
ENDCLASS.`;

    expect(findSourceDeclaredAunitClasses(source)).toEqual([
      { testClass: 'LTCL_REAL', riskLevel: 'critical', explicitRiskLevel: true },
    ]);
  });

  it('follows static INCLUDE statements with pragmas but rejects structural and dynamic forms', () => {
    expect(
      findStaticAbapIncludes(`
        INCLUDE zinc ##NEEDED.
        INCLUDE /arc/test_if_found IF FOUND ##P1 ##P2['ignored payload'].
        INCLUDE zmulti ##P[A][B].
        INCLUDE TYPE ty_s ##NEEDED.
        INCLUDE STRUCTURE mara ##NEEDED.
        INCLUDE (lv_prog) ##NEEDED.`),
    ).toEqual(['ZINC', '/ARC/TEST_IF_FOUND', 'ZMULTI']);
  });

  it('marks concrete test inheritance from an uninspected superclass unavailable', () => {
    const result = reconcileAunitSourceDeclarations(
      parseAunitRunResult('<aunit:runResult xmlns:aunit="http://www.sap.com/adt/aunit"/>'),
      `CLASS ltcl_reuse DEFINITION FOR TESTING RISK LEVEL DANGEROUS
         INHERITING FROM zcl_global_test.
       ENDCLASS.`,
    );

    expect(result.outcome).toBe('incomplete');
    expect(result.sourceSelectionEvidence).toMatchObject({
      status: 'unavailable',
      reason: expect.stringContaining('source-external ZCL_GLOBAL_TEST'),
    });
  });

  it('fails closed when SAP 7.58 silently omits a source-declared dangerous test class', () => {
    const result = reconcileAunitSourceDeclarations(parseAunitRunResult(harmlessOnlyResult), mixedRiskSource);

    expect(result).toMatchObject({
      outcome: 'incomplete',
      summary: { tests: 1, passed: 1 },
      sourceSelectionEvidence: {
        status: 'verified',
        omittedNonHarmlessTestClasses: [
          { testClass: 'LTCL_DANGEROUS', riskLevel: 'dangerous', explicitRiskLevel: true },
        ],
      },
    });
    expect(result.sourceSelectionEvidence?.declaredTestClasses.map((testClass) => testClass.testClass)).toEqual([
      'LTCL_HARMLESS',
      'LTCL_DANGEROUS',
    ]);
    expect(result.alerts).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'sourceRiskSelection', testClass: 'LTCL_DANGEROUS' })]),
    );
    expect(parseNativeJunitSummary(aunitResultToJunit(result))).toMatchObject({ tests: 2, errors: 1 });
  });

  it('fails closed when an ABAP macro can declare an omitted test method', () => {
    const result = reconcileAunitSourceDeclarations(
      parseAunitRunResult(harmlessOnlyResult),
      `REPORT zarc1_mixed.
       DEFINE test_method.
         METHODS &1 FOR TESTING.
       END-OF-DEFINITION.
       CLASS ltcl_harmless DEFINITION FOR TESTING RISK LEVEL HARMLESS.
         METHODS passes FOR TESTING.
       ENDCLASS.
       CLASS ltcl_critical DEFINITION FOR TESTING RISK LEVEL CRITICAL.
         test_method hidden.
       ENDCLASS.`,
    );

    expect(result).toMatchObject({
      outcome: 'incomplete',
      sourceSelectionEvidence: {
        status: 'unavailable',
        reason: expect.stringMatching(/LTCL_CRITICAL.*macro TEST_METHOD/i),
      },
    });
    expect(parseNativeJunitSummary(aunitResultToJunit(result))).toMatchObject({ errors: 1 });
  });

  it('does not reject an unrelated macro outside a FOR TESTING definition', () => {
    expect(
      findSourceDeclaredAunitClasses(`
        DEFINE assign_value.
          &1 = &2.
        END-OF-DEFINITION.
        CLASS lcl_production DEFINITION.
          METHODS run.
        ENDCLASS.
        CLASS ltcl_safe DEFINITION FOR TESTING RISK LEVEL HARMLESS.
          METHODS passes FOR TESTING.
        ENDCLASS.`),
    ).toEqual([{ testClass: 'LTCL_SAFE', riskLevel: 'harmless', explicitRiskLevel: true }]);
  });

  it('marks an omitted executable harmless class incomplete instead of sound no_tests', () => {
    const result = reconcileAunitSourceDeclarations(
      parseAunitRunResult('<aunit:runResult xmlns:aunit="http://www.sap.com/adt/aunit"/>'),
      `REPORT zarc1_harmless.
       CLASS ltcl_harmless DEFINITION FOR TESTING RISK LEVEL HARMLESS.
         METHODS passes FOR TESTING.
       ENDCLASS.`,
    );

    expect(result).toMatchObject({
      outcome: 'incomplete',
      summary: { tests: 0 },
      sourceSelectionEvidence: {
        status: 'verified',
        omittedTestClasses: [{ testClass: 'LTCL_HARMLESS', riskLevel: 'harmless', explicitRiskLevel: true }],
        omittedNonHarmlessTestClasses: [],
      },
    });
    expect(result.alerts).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'sourceTestOmission', testClass: 'LTCL_HARMLESS' })]),
    );
    expect(parseNativeJunitSummary(aunitResultToJunit(result))).toMatchObject({ tests: 1, errors: 1 });
  });

  it('qualifies package declarations by program so duplicate local class names cannot satisfy each other', () => {
    const result = reconcileAunitProgramSources(
      parseAunitRunResult(`
        <aunit:runResult xmlns:aunit="http://www.sap.com/adt/aunit">
          <program name="ZCL_ONE"><testClasses><testClass name="LTCL_TEST" riskLevel="harmless">
            <testMethods><testMethod name="PASSES"/></testMethods>
          </testClass></testClasses></program>
        </aunit:runResult>`),
      [
        {
          program: 'ZCL_ONE',
          source: 'CLASS ltcl_test DEFINITION FOR TESTING RISK LEVEL HARMLESS. METHODS passes FOR TESTING. ENDCLASS.',
        },
        {
          program: 'ZCL_TWO',
          source: 'CLASS ltcl_test DEFINITION FOR TESTING RISK LEVEL HARMLESS. METHODS passes FOR TESTING. ENDCLASS.',
        },
      ],
    );

    expect(result.outcome).toBe('incomplete');
    expect(result.sourceSelectionEvidence).toMatchObject({
      status: 'verified',
      declaredTestClasses: [
        { program: 'ZCL_ONE', testClass: 'LTCL_TEST' },
        { program: 'ZCL_TWO', testClass: 'LTCL_TEST' },
      ],
      omittedTestClasses: [{ program: 'ZCL_TWO', testClass: 'LTCL_TEST', riskLevel: 'harmless' }],
    });
    expect(result.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'sourceTestOmission', program: 'ZCL_TWO', testClass: 'LTCL_TEST' }),
      ]),
    );
  });

  it('never counts a method node without a method identity as passing evidence', () => {
    const malformed = parseAunitRunResult(`
      <aunit:runResult xmlns:aunit="http://www.sap.com/adt/aunit">
        <program name="ZTEST"><testClasses><testClass name="LTCL_SAFE" riskLevel="harmless">
          <testMethods><testMethod executionTime="0.1"/></testMethods>
        </testClass></testClasses></program>
      </aunit:runResult>`);
    const result = reconcileAunitSourceDeclarations(
      malformed,
      'CLASS ltcl_safe DEFINITION FOR TESTING RISK LEVEL HARMLESS. METHODS passes FOR TESTING. ENDCLASS.',
    );

    expect(result.outcome).toBe('incomplete');
    expect(result.alerts).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'malformedResult' })]));
    expect(parseNativeJunitSummary(aunitResultToJunit(result))).toMatchObject({ errors: 1, outcome: 'failed' });
  });

  it('never certifies SAP-reported execution above the harmless risk selection', () => {
    const result = parseAunitRunResult(harmlessOnlyResult.replaceAll('harmless', 'critical'));

    expect(result.outcome).toBe('incomplete');
    expect(result.alerts).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'riskSelectionViolation', testClass: 'LTCL_HARMLESS' })]),
    );
    expect(parseNativeJunitSummary(aunitResultToJunit(result))).toMatchObject({ tests: 2, errors: 1 });
  });

  it('marks lexically incomplete source evidence unavailable instead of missing later classes', () => {
    const result = reconcileAunitSourceDeclarations(
      parseAunitRunResult(harmlessOnlyResult),
      `${mixedRiskSource}\nDATA(broken) = |unterminated`,
    );

    expect(result.outcome).toBe('incomplete');
    expect(result.sourceSelectionEvidence).toMatchObject({ status: 'unavailable' });
  });

  it('keeps class/run alerts separate from executed method test cases', () => {
    const result = parseAunitRunResult(mixed);

    expect(result.outcome).toBe('failed');
    expect(result.summary).toEqual({ tests: 2, passed: 1, failures: 1, errors: 1, skipped: 0, warnings: 2 });
    expect(result.tests.map((test) => test.testMethod)).toEqual(['FAILS', 'PASSES']);
    expect(result.tests.find((test) => test.testMethod === 'FAILS')).toMatchObject({
      status: 'failed',
      durationMs: 630,
      riskLevel: 'harmless',
    });
    expect(result.alerts.find((alert) => alert.testClass === 'LTCL_RISKY')).toMatchObject({
      scope: 'class',
      kind: 'warning',
      severity: 'tolerable',
    });
    expect(result.alerts.find((alert) => alert.testClass === 'LTCL_SETUP_FAIL')?.message).toContain(
      'CX_SY_ITAB_LINE_NOT_FOUND',
    );
    expect(result.alerts.some((alert) => alert.testClass === 'LTCL_SETUP_FAIL' && alert.kind === 'emptyClass')).toBe(
      false,
    );
  });

  it('reports a program-level generation problem as incomplete rather than a synthetic skipped test', () => {
    const result = parseAunitRunResult(programAlert);

    expect(result.tests).toEqual([]);
    expect(result.summary.tests).toBe(0);
    expect(result.outcome).toBe('incomplete');
    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0]).toMatchObject({ scope: 'program', kind: 'warning' });
  });

  it('distinguishes a sound empty run from a risk-filtered run', () => {
    expect(parseAunitRunResult('<aunit:runResult xmlns:aunit="http://www.sap.com/adt/aunit"/>').outcome).toBe(
      'no_tests',
    );
    expect(
      parseAunitRunResult(`
        <aunit:runResult xmlns:aunit="http://www.sap.com/adt/aunit">
          <program name="ZCL_RISKY"><testClasses><testClass name="LTCL_RISKY"><alerts>
            <alert kind="warning" severity="tolerable"><title>No execution, risk level of test class exceeds upper limit</title></alert>
          </alerts></testClass></testClasses></program>
        </aunit:runResult>`).outcome,
    ).toBe('incomplete');
  });

  it('fails closed when a localized class warning accompanies zero executed methods', () => {
    const result = parseAunitRunResult(localizedEmptyClass);

    expect(result.outcome).toBe('incomplete');
    expect(result.summary.tests).toBe(0);
    expect(result.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'warning', title: expect.stringContaining('Keine Ausführung') }),
        expect.objectContaining({
          kind: 'emptyClass',
          testClass: 'LTCL_RISKY',
          message: expect.stringContaining('reported risk level: dangerous'),
        }),
      ]),
    );
  });

  it('generates validly escaped JUnit without inventing alert test cases', () => {
    const junit = aunitResultToJunit(parseAunitRunResult(mixed), 'AUnit <suite>');

    expect(junit).toContain('tests="2"');
    expect(junit).toContain('failures="1"');
    expect(junit).toContain('errors="1"');
    expect(junit.match(/<testcase /g)).toHaveLength(2);
    expect(junit).toContain('AUnit &lt;suite&gt;');
    expect(junit).toContain('<system-err>');
    expect(junit).toContain('LTCL_RISKY');
  });

  it('makes a legacy risk-refusal JUnit visibly incomplete while preserving SAP alert evidence', () => {
    const result = parseAunitRunResult(localizedEmptyClass);
    const junit = aunitResultToJunit(result, 'Risk selection');

    expect(result.outcome).toBe('incomplete');
    expect(junit).toContain('Keine Ausführung');
    expect(junit).toContain('<error type="ARC1IncompleteEvidence"');
    expect(parseNativeJunitSummary(junit)).toMatchObject({ tests: 1, failures: 0, errors: 1, skipped: 0 });
  });

  it('summarizes native JUnit pass, fail, and zero-test outcomes', () => {
    expect(parseNativeJunitSummary('<testsuites tests="4" failures="0" errors="0" skipped="1"/>')).toEqual({
      tests: 4,
      failures: 0,
      errors: 0,
      skipped: 1,
      outcome: 'passed',
    });
    expect(parseNativeJunitSummary('<testsuites tests="4" failures="1" errors="0" skipped="0"/>').outcome).toBe(
      'failed',
    );
    expect(parseNativeJunitSummary('<testsuites tests="0" failures="0" errors="0" skipped="0"/>').outcome).toBe(
      'incomplete',
    );
    expect(parseNativeJunitSummary('<testsuites tests="2" failures="0" errors="0" skipped="2"/>').outcome).toBe(
      'incomplete',
    );
    expect(() => parseNativeJunitSummary('<not-junit/>')).toThrow(/non-JUnit/);
  });

  it.each([
    ['incomplete', 'error', { tests: 2, failures: 0, errors: 1, skipped: 0, outcome: 'failed' }],
    ['failed', 'failure', { tests: 2, failures: 1, errors: 0, skipped: 0, outcome: 'failed' }],
  ] as const)('appends a red %s diagnostic without losing native JUnit testcases', (outcome, element, expected) => {
    const native =
      '<testsuites tests="1" failures="0" errors="0" skipped="0"><testsuite name="SAP native" tests="1" failures="0" errors="0" skipped="0"><testcase classname="LTCL_OK" name="PASSES"/></testsuite></testsuites>';
    const reconciled = appendAunitJunitDiagnostic(
      native,
      parseNativeJunitSummary(native),
      outcome,
      'Reconciliation <evidence>',
    );

    expect(reconciled).toContain('<testcase classname="LTCL_OK" name="PASSES"/>');
    expect(reconciled).toContain(`<${element} type=`);
    expect(reconciled).toContain('Reconciliation &lt;evidence&gt;');
    expect(parseNativeJunitSummary(reconciled)).toEqual(expected);
  });

  it.each(['tests', 'failures', 'errors', 'skipped'])('rejects native JUnit missing the %s counter', (missing) => {
    const counters = { tests: '4', failures: '0', errors: '0', skipped: '0' };
    const attrs = Object.entries(counters)
      .filter(([name]) => name !== missing)
      .map(([name, value]) => `${name}="${value}"`)
      .join(' ');

    expect(() => parseNativeJunitSummary(`<testsuites ${attrs}/>`)).toThrow(`invalid JUnit ${missing} count`);
  });

  it.each(['NaN', '-1', '1.5', '9007199254740992'])(
    'rejects a malformed native JUnit counter value: %s',
    (failures) => {
      expect(() =>
        parseNativeJunitSummary(`<testsuites tests="5" failures="${failures}" errors="0" skipped="0"/>`),
      ).toThrow(/invalid JUnit failures count/);
    },
  );

  it('rejects native JUnit counters whose classified total exceeds the test count', () => {
    expect(() => parseNativeJunitSummary('<testsuites tests="2" failures="1" errors="1" skipped="1"/>')).toThrow(
      /inconsistent JUnit counters/,
    );
  });

  it('emits a well-formed red JUnit diagnostic for incomplete public runs', () => {
    const junit = aunitIncompleteToJunit('Timed out <without> a result', 'CLAS Z&TEST');
    expect(junit).toContain('<error type="ARC1IncompleteEvidence"');
    expect(junit).toContain('Timed out &lt;without&gt; a result');
    expect(junit).toContain('CLAS Z&amp;TEST');
    expect(parseNativeJunitSummary(junit)).toMatchObject({ tests: 1, failures: 0, errors: 1, skipped: 0 });
  });
});

describe('public ABAP Unit API', () => {
  it('treats endpoint absence as unsupported but never hides authentication failures', async () => {
    const absent = publicHttp({
      get: vi.fn().mockRejectedValue(new AdtApiError('not found', 404, '/sap/bc/adt/api/abapunit/runs/0')),
    });
    await expect(probePublicAunit(absent, unrestrictedSafetyConfig())).resolves.toBe(false);

    const denied = publicHttp({
      get: vi.fn().mockRejectedValue(new AdtApiError('denied', 401, '/sap/bc/adt/api/abapunit/runs/0')),
    });
    await expect(probePublicAunit(denied, unrestrictedSafetyConfig())).rejects.toThrow(/denied/);
  });

  it('submits harmless-only options, polls the safe run path, and returns SAP-native JUnit', async () => {
    const junit = '<testsuites tests="3" failures="1" errors="0" skipped="0"/>';
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: '<runStatus><progress status="Running"/></runStatus>',
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: '<runStatus><progress status="Completed"/><link rel="http://www.sap.com/adt/relations/api/abapunit/run-result" type="application/vnd.sap.adt.api.junit.run-result.v1+xml" href="/sap/bc/adt/api/abapunit/results/R1"/></runStatus>',
      })
      .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: junit });
    const post = vi.fn().mockResolvedValue({
      statusCode: 201,
      headers: { location: '/sap/bc/adt/api/abapunit/runs/R1' },
      body: '',
    });
    let clock = 1_000;
    const http = publicHttp({ get, post });

    const result = await runPublicAunit(http, unrestrictedSafetyConfig(), 'CLAS', 'zcl_demo', {
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });

    expect(result).toMatchObject({
      protocol: 'public-api',
      runPath: '/sap/bc/adt/api/abapunit/runs/R1',
      resultPath: '/sap/bc/adt/api/abapunit/results/R1',
      status: 'Completed',
      polls: 2,
      summary: { tests: 3, failures: 1, outcome: 'failed' },
    });
    expect(post).toHaveBeenCalledWith(
      '/sap/bc/adt/api/abapunit/runs',
      expect.stringContaining('<aunit:riskLevel harmless="true" dangerous="false" critical="false"/>'),
      'application/vnd.sap.adt.api.abapunit.run.v2+xml',
      expect.objectContaining({ Accept: 'application/vnd.sap.adt.api.abapunit.run-status.v1+xml' }),
      expect.objectContaining({ deadline: 301_000 }),
    );
    expect(post.mock.calls[0]?.[1]).toContain('<osl:object name="ZCL_DEMO" type="CLAS"/>');
    expect(post.mock.calls[0]?.[1]).toContain(
      '<aunit:scope ownTests="true" foreignTests="false" addForeignTestsAsPreview="false"/>',
    );
    expect(get.mock.calls[0]?.[0]).toBe('/sap/bc/adt/api/abapunit/runs/R1?withLongPolling=true');
    expect(get.mock.calls[2]?.[0]).toBe('/sap/bc/adt/api/abapunit/results/R1');
  });

  it('uses the earlier caller deadline and propagates its abort signal', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: '<runStatus><progress status="FINISHED"/><link type="application/vnd.sap.adt.api.junit.run-result.v1+xml" href="/sap/bc/adt/api/abapunit/results/R1"/></runStatus>',
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: '<testsuites tests="0" failures="0" errors="0" skipped="0"/>',
      });
    const post = vi.fn().mockResolvedValue({
      statusCode: 201,
      headers: { location: '/sap/bc/adt/api/abapunit/runs/R1' },
      body: '',
    });
    const signal = new AbortController().signal;

    await runPublicAunit(publicHttp({ get, post }), unrestrictedSafetyConfig(), 'CLAS', 'ZCL_DEMO', {
      deadline: 5_000,
      signal,
      now: () => 1_000,
    });

    expect(post.mock.calls[0]?.[4]).toEqual({ deadline: 5_000, signal });
    expect(get.mock.calls.every((call) => call[2]?.deadline === 5_000 && call[2]?.signal === signal)).toBe(true);
  });

  it.each([false, true])('submits a native packageSet with includeSubpackages=%s', async (includeSubpackages) => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: '<runStatus><progress status="FINISHED"/><link type="application/vnd.sap.adt.api.junit.run-result.v1+xml" href="/sap/bc/adt/api/abapunit/results/PKG"/></runStatus>',
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: '<testsuites tests="0" failures="0" errors="0" skipped="0"/>',
      });
    const post = vi.fn().mockResolvedValue({
      statusCode: 201,
      headers: { location: '/sap/bc/adt/api/abapunit/runs/PKG' },
      body: '',
    });

    await runPublicAunit(publicHttp({ get, post }), unrestrictedSafetyConfig(), 'DEVC', 'zpkg', {
      includeSubpackages,
    });

    const body = String(post.mock.calls[0]?.[1]);
    expect(body).toContain('xsi:type="osl:packageSet"');
    expect(body).toContain(`<osl:package includeSubpackages="${includeSubpackages}" name="ZPKG"/>`);
    expect(body).not.toContain('<osl:object name="ZPKG" type="DEVC"/>');
  });

  it.each([
    'https://evil.example/sap/bc/adt/api/abapunit/runs/R1',
    '//evil.example/sap/bc/adt/api/abapunit/runs/R1',
    '/sap/bc/adt/api/abapunit/runs/../results/R1',
    '/sap/bc/adt/unrelated/R1',
  ])('rejects an unsafe Location path: %s', async (location) => {
    const http = publicHttp({
      post: vi.fn().mockResolvedValue({ statusCode: 201, headers: { location }, body: '' }),
    });
    await expect(runPublicAunit(http, unrestrictedSafetyConfig(), 'CLAS', 'ZCL_DEMO')).rejects.toThrow(
      /canonical host-relative ADT path/,
    );
  });

  it('fails with incomplete evidence when the run misses its deadline', async () => {
    const post = vi.fn().mockResolvedValue({
      statusCode: 201,
      headers: { location: '/sap/bc/adt/api/abapunit/runs/R1' },
      body: '',
    });
    const get = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: '<runStatus><progress status="Running"/><link rel="run-result" type="application/vnd.sap.adt.api.junit.run-result.v1+xml" href="/sap/bc/adt/api/abapunit/results/EARLY"/></runStatus>',
    });
    let clock = 0;
    const http = publicHttp({ get, post });

    await expect(
      runPublicAunit(http, unrestrictedSafetyConfig(), 'CLAS', 'ZCL_DEMO', {
        timeoutMs: 2,
        now: () => clock,
        sleep: async (ms) => {
          clock += ms;
        },
      }),
    ).rejects.toMatchObject({
      name: AunitIncompleteError.name,
      evidence: { elapsedMs: 2, polls: 1, status: 'Running' },
    });
    expect(get).toHaveBeenCalledOnce();
  });
});
