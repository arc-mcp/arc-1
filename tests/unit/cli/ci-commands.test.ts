import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { aunitResultToJunit, parseAunitRunResult, reconcileAunitSourceDeclarations } from '../../../src/adt/aunit.js';
import type { AdtClient } from '../../../src/adt/client.js';
import { type CliDependencies, main } from '../../../src/cli.js';
import type { AunitCiResult } from '../../../src/cli-checks.js';
import type { StartupAuthPreflightResult } from '../../../src/server/server.js';
import { DEFAULT_CONFIG, type ServerConfig } from '../../../src/server/types.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function dependencies(
  result: unknown,
  config: Partial<ServerConfig> = {},
): CliDependencies & { dispatchToolCall: ReturnType<typeof vi.fn> } {
  const resolvedConfig: ServerConfig = {
    ...DEFAULT_CONFIG,
    url: 'https://sap.example.test',
    cacheMode: 'none',
    ...config,
  };
  const dispatchToolCall = vi.fn(async () => ({
    content: [{ type: 'text' as const, text: typeof result === 'string' ? result : JSON.stringify(result) }],
  }));
  const auth: StartupAuthPreflightResult = {
    status: 'skipped',
    blocking: false,
    endpoint: '/sap/bc/adt/core/discovery',
    checkedAt: '2026-08-17T00:00:00Z',
    reason: 'offline test',
  };
  return {
    resolveConfiguration: vi.fn(() => ({
      config: resolvedConfig,
      sources: {},
    })),
    createClient: vi.fn(() => ({ http: { setDiscoveryMap: vi.fn() } }) as unknown as AdtClient),
    createCache: vi.fn(async () => undefined),
    authPreflight: vi.fn(async () => auth),
    probeFeatures: vi.fn(async () => undefined),
    dispatchToolCall,
    flushLogger: vi.fn(async () => undefined),
  };
}

function passingAunit(overrides: Partial<AunitCiResult> = {}): AunitCiResult {
  return {
    outcome: 'passed',
    summary: { tests: 2, passed: 2, failures: 0, errors: 0, skipped: 0, warnings: 0 },
    coverageEvidence: 'not_requested',
    sourceSelectionEvidence: {
      status: 'verified',
      declaredTestClasses: [{ testClass: 'LTCL_SAFE', riskLevel: 'harmless', explicitRiskLevel: true }],
      omittedTestClasses: [],
      omittedNonHarmlessTestClasses: [],
    },
    ...overrides,
  };
}

function completeAtc(priority?: number) {
  const findings =
    priority === undefined
      ? []
      : [
          {
            priority,
            checkTitle: 'ATC check',
            messageTitle: 'Finding',
            uri: '/sap/bc/adt/programs/programs/ZTEST/source/main#start=4,0',
            line: 4,
          },
        ];
  return {
    findings,
    worklistId: 'WL1',
    variant: null,
    maximumVerdicts: 100,
    expectedFindingCount: findings.length,
    findingCount: findings.length,
    processedObjectCount: 1,
    objectSetIsComplete: true,
    truncated: false,
    complete: true,
    incompleteReasons: [],
    runStatusCode: 200,
    worklist: { id: 'WL1' },
    infos: [],
  };
}

describe('dedicated unittest command', () => {
  it('uses dispatcher structured mode and returns the semantic pass code', async () => {
    const deps = dependencies(passingAunit());
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const code = await main(['unittest', 'clas', 'ZCL_TEST'], deps);

    expect(code).toBe(0);
    expect(output).toHaveBeenCalledWith(expect.stringContaining('ABAP Unit: passed'));
    expect(deps.dispatchToolCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'SAPDiagnose',
      expect.objectContaining({
        action: 'unittest',
        type: 'CLAS',
        name: 'ZCL_TEST',
        coverage: false,
        resultFormat: 'structured',
      }),
      undefined,
      undefined,
      undefined,
    );
  });

  it('forwards a bounded public-run timeout and rejects invalid values before dispatch', async () => {
    const deps = dependencies(passingAunit());
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await main(['unittest', 'CLAS', 'ZCL_TEST', '--timeout', '600'], deps)).toBe(0);
    expect(deps.dispatchToolCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'SAPDiagnose',
      expect.objectContaining({ timeoutSeconds: 600 }),
      undefined,
      undefined,
      undefined,
    );

    const invalid = dependencies(passingAunit());
    expect(await main(['unittest', 'CLAS', 'ZCL_TEST', '--timeout', '0'], invalid)).toBe(2);
    expect(invalid.dispatchToolCall).not.toHaveBeenCalled();
  });

  it('forwards recursive DEVC scope and rejects the flag for object targets before dispatch', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const packageDeps = dependencies(passingAunit());

    expect(await main(['unittest', 'devc', 'ZPKG', '--include-subpackages'], packageDeps)).toBe(0);
    expect(packageDeps.dispatchToolCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'SAPDiagnose',
      expect.objectContaining({
        action: 'unittest',
        type: 'DEVC',
        name: 'ZPKG',
        includeSubpackages: true,
      }),
      undefined,
      undefined,
      undefined,
    );

    const objectDeps = dependencies(passingAunit());
    expect(await main(['unittest', 'CLAS', 'ZCL_TEST', '--include-subpackages'], objectDeps)).toBe(2);
    expect(objectDeps.dispatchToolCall).not.toHaveBeenCalled();
  });

  it('writes JUnit before returning a failing test code', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arc1-ci-unit-'));
    temporaryDirectories.push(directory);
    const report = join(directory, 'aunit.xml');
    const deps = dependencies(
      passingAunit({
        outcome: 'failed',
        summary: { tests: 2, passed: 1, failures: 1, errors: 0, skipped: 0, warnings: 0 },
        junit: '<testsuites tests="2" failures="1" errors="0" skipped="0"/>',
      }),
    );

    const code = await main(['unittest', 'CLAS', 'ZCL_TEST', '--format', 'junit', '--report-file', report], deps);

    expect(code).toBe(1);
    expect(await readFile(report, 'utf8')).toBe('<testsuites tests="2" failures="1" errors="0" skipped="0"/>\n');
    expect(deps.dispatchToolCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'SAPDiagnose',
      expect.objectContaining({ resultFormat: 'junit' }),
      undefined,
      undefined,
      undefined,
    );
  });

  it('keeps no-tests, incomplete, and coverage-unavailable distinct', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const noTests = passingAunit({
      outcome: 'no_tests',
      summary: { tests: 0, passed: 0, failures: 0, errors: 0, skipped: 0, warnings: 0 },
      sourceSelectionEvidence: {
        status: 'verified',
        declaredTestClasses: [],
        omittedTestClasses: [],
        omittedNonHarmlessTestClasses: [],
      },
    });
    expect(await main(['unittest', 'CLAS', 'ZCL_EMPTY'], dependencies(noTests))).toBe(3);
    expect(await main(['unittest', 'CLAS', 'ZCL_EMPTY', '--allow-empty'], dependencies(noTests))).toBe(0);
    expect(
      await main(
        ['unittest', 'CLAS', 'ZCL_EMPTY', '--allow-empty'],
        dependencies({ ...noTests, outcome: 'incomplete' }),
      ),
    ).toBe(3);
    expect(
      await main(
        ['unittest', 'CLAS', 'ZCL_TEST', '--min-statement', '80'],
        dependencies(passingAunit({ coverageEvidence: 'unavailable' })),
      ),
    ).toBe(3);
    expect(
      await main(
        ['unittest', 'CLAS', 'ZCL_TEST', '--coverage'],
        dependencies(passingAunit({ coverageEvidence: 'unavailable' })),
      ),
    ).toBe(3);
    expect(
      await main(
        ['unittest', 'CLAS', 'ZCL_TEST', '--coverage'],
        dependencies(
          passingAunit({
            coverageEvidence: 'available',
            coverage: {
              statement: { executed: 8, total: 10, percent: 80 },
              branch: { executed: 7, total: 10, percent: 70 },
              procedure: { executed: 6, total: 10, percent: 60 },
            },
          }),
        ),
      ),
    ).toBe(0);
  });

  it('classifies malformed threshold input as usage before dispatch', async () => {
    const deps = dependencies(passingAunit());
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await main(['unittest', 'CLAS', 'ZCL_TEST', '--min-statement', '101'], deps)).toBe(2);
    expect(deps.dispatchToolCall).not.toHaveBeenCalled();
  });

  it('returns incomplete for malformed-but-valid AUnit JSON in every report format', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    for (const format of ['text', 'json', 'junit']) {
      expect(
        await main(['unittest', 'CLAS', 'ZCL_TEST', '--format', format], dependencies({ outcome: 'passed' })),
      ).toBe(3);
    }
    expect(
      await main(
        ['unittest', 'CLAS', 'ZCL_TEST', '--format', 'json'],
        dependencies({ ...passingAunit(), outcome: 'future_status' }),
      ),
    ).toBe(3);
  });

  it('makes a nonzero AUnit policy verdict visible in an otherwise green JUnit report', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arc1-ci-unit-policy-'));
    temporaryDirectories.push(directory);
    const report = join(directory, 'aunit.xml');
    const noTests = passingAunit({
      outcome: 'no_tests',
      summary: { tests: 0, passed: 0, failures: 0, errors: 0, skipped: 0, warnings: 0 },
      sourceSelectionEvidence: {
        status: 'verified',
        declaredTestClasses: [],
        omittedTestClasses: [],
        omittedNonHarmlessTestClasses: [],
      },
      junit: '<testsuites tests="0" failures="0" errors="0" skipped="0"/>',
    });

    expect(
      await main(
        ['unittest', 'CLAS', 'ZCL_EMPTY', '--format', 'junit', '--report-file', report],
        dependencies(noTests),
      ),
    ).toBe(3);
    const junit = await readFile(report, 'utf8');
    expect(junit).toContain('tests="1"');
    expect(junit).toContain('<error type="ARC1IncompleteEvidence"');
  });

  it('returns exit 3 and writes red JUnit for the live mixed-source omission shape', async () => {
    const legacy = parseAunitRunResult(`
      <aunit:runResult xmlns:aunit="http://www.sap.com/adt/aunit"><program name="ZARC1_MIXED"><testClasses>
        <testClass name="LTCL_HARMLESS" riskLevel="harmless"><testMethods><testMethod name="PASSES"/></testMethods></testClass>
      </testClasses></program></aunit:runResult>`);
    const reconciled = reconcileAunitSourceDeclarations(
      legacy,
      `REPORT zarc1_mixed.
       CLASS ltcl_harmless DEFINITION FOR TESTING RISK LEVEL HARMLESS. METHODS passes FOR TESTING. ENDCLASS.
       CLASS ltcl_dangerous DEFINITION FOR TESTING RISK LEVEL DANGEROUS. METHODS mutates FOR TESTING. ENDCLASS.`,
    );
    const directory = await mkdtemp(join(tmpdir(), 'arc1-ci-unit-risk-'));
    temporaryDirectories.push(directory);
    const report = join(directory, 'aunit.xml');

    const code = await main(
      ['unittest', 'PROG', 'ZARC1_MIXED', '--format', 'junit', '--report-file', report],
      dependencies({ ...reconciled, junit: aunitResultToJunit(reconciled, 'PROG ZARC1_MIXED') }),
    );

    expect(code).toBe(3);
    expect(await readFile(report, 'utf8')).toContain('<error type="ARC1IncompleteEvidence"');
  });
});

describe('dedicated ATC, diff, and lint commands', () => {
  it('applies numeric ATC priority and incomplete exit policies', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(await main(['atc', 'PROG', 'ZTEST', '--max-priority', '1'], dependencies(completeAtc(2)))).toBe(0);
    expect(await main(['atc', 'PROG', 'ZTEST', '--max-priority', '2'], dependencies(completeAtc(2)))).toBe(1);
    expect(
      await main(
        ['atc', 'PROG', 'ZTEST'],
        dependencies({
          ...completeAtc(),
          objectSetIsComplete: null,
          complete: false,
          incompleteReasons: ['missing evidence'],
        }),
      ),
    ).toBe(3);
  });

  it('writes ATC Checkstyle and dispatches structured evidence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arc1-ci-atc-'));
    temporaryDirectories.push(directory);
    const report = join(directory, 'atc.xml');
    const deps = dependencies(completeAtc(1));

    expect(await main(['atc', 'PROG', 'ZTEST', '--format', 'checkstyle', '--report-file', report], deps)).toBe(1);
    const xml = await readFile(report, 'utf8');
    expect(xml).toContain('<checkstyle');
    expect(xml).toContain('severity="error"');
    expect(deps.dispatchToolCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'SAPDiagnose',
      expect.objectContaining({ action: 'atc', resultFormat: 'structured' }),
      undefined,
      undefined,
      undefined,
    );
  });

  it('forwards and validates the ATC timeout budget before dispatch', async () => {
    const deps = dependencies(completeAtc());
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await main(['atc', 'DEVC', '$ABAPGIT', '--timeout', '600'], deps)).toBe(0);
    expect(deps.dispatchToolCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'SAPDiagnose',
      expect.objectContaining({ action: 'atc', timeoutSeconds: 600 }),
      undefined,
      undefined,
      undefined,
    );

    const invalid = dependencies(completeAtc());
    expect(await main(['atc', 'DEVC', '$ABAPGIT', '--timeout', '3601'], invalid)).toBe(2);
    expect(invalid.dispatchToolCall).not.toHaveBeenCalled();
  });

  it('returns diff exit 0 by default and 1 only with --check', async () => {
    const diff = {
      type: 'PROG',
      name: 'ZTEST',
      from: 'active',
      to: 'inactive',
      fromLabel: 'active',
      toLabel: 'inactive',
      identical: false,
      hasDifferences: true,
      added: 1,
      removed: 0,
      diff: '+WRITE.',
    };
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(await main(['diff', 'PROG', 'ZTEST'], dependencies(diff))).toBe(0);
    const checked = dependencies(diff);
    expect(await main(['diff', 'PROG', 'ZTEST', '--check'], checked)).toBe(1);
    expect(checked.dispatchToolCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'SAPRead',
      expect.objectContaining({ action: 'diff', format: 'structured', from: 'active', to: 'inactive' }),
      undefined,
      undefined,
      undefined,
    );
  });

  it('returns incomplete before formatting drifted ATC or diff evidence', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    for (const format of ['text', 'json', 'checkstyle']) {
      expect(
        await main(['atc', 'PROG', 'ZTEST', '--format', format], dependencies({ ...completeAtc(), complete: 'true' })),
      ).toBe(3);
    }
    for (const format of ['text', 'json']) {
      expect(
        await main(
          ['diff', 'PROG', 'ZTEST', '--format', format],
          dependencies({
            type: 'PROG',
            name: 'ZTEST',
            from: 'active',
            to: 'inactive',
            fromLabel: 'active',
            toLabel: 'inactive',
            identical: false,
            added: 1,
            removed: 0,
            diff: '+WRITE.',
          }),
        ),
      ).toBe(3);
    }
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/incomplete evidence|incomplete structured evidence/i));
  });

  it('lints through the dispatcher and supports Checkstyle warning thresholds', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arc1-ci-lint-'));
    temporaryDirectories.push(directory);
    const source = join(directory, 'ztest.prog.abap');
    const report = join(directory, 'lint.xml');
    await writeFile(source, 'REPORT ztest.');
    const issues = [
      {
        rule: 'style',
        message: 'Warning',
        line: 1,
        column: 1,
        endLine: 1,
        endColumn: 2,
        severity: 'warning',
      },
    ];
    const deps = dependencies(issues);

    expect(
      await main(['lint', source, '--format', 'checkstyle', '--report-file', report, '--fail-on', 'warning'], deps),
    ).toBe(1);
    expect(await readFile(report, 'utf8')).toContain('severity="warning"');
    expect(deps.dispatchToolCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'SAPLint',
      expect.objectContaining({ action: 'lint', source: 'REPORT ztest.' }),
      undefined,
      undefined,
      undefined,
    );
  });

  it.each([
    ['missing fields', [{}]],
    [
      'bad severity',
      [{ rule: 'syntax', message: 'bad', line: 1, column: 1, endLine: 1, endColumn: 2, severity: 'critical' }],
    ],
    [
      'bad coordinates',
      [{ rule: 'syntax', message: 'bad', line: -1, column: 1, endLine: 1, endColumn: 2, severity: 'error' }],
    ],
  ])('returns incomplete for malformed lint evidence with --fail-on none: %s', async (_label, issues) => {
    const directory = await mkdtemp(join(tmpdir(), 'arc1-ci-lint-drift-'));
    temporaryDirectories.push(directory);
    const source = join(directory, 'ztest.prog.abap');
    await writeFile(source, 'REPORT ztest.');
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await main(['lint', source, '--fail-on', 'none'], dependencies(issues))).toBe(3);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('malformed or incomplete structured evidence'));
    expect(output).not.toHaveBeenCalledWith(expect.stringContaining('undefined'));
  });

  it('refuses malformed or absent CI tool JSON', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await main(['atc', 'PROG', 'ZTEST'], dependencies('not JSON'))).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('non-JSON CI result'));

    const absent = dependencies(null);
    absent.dispatchToolCall.mockResolvedValue({ content: [] });
    expect(await main(['atc', 'PROG', 'ZTEST'], absent)).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('no text result'));
  });

  it('maps dispatcher errors to exit 1 rather than a CI assertion code', async () => {
    const deps = dependencies('SAP authentication failed');
    deps.dispatchToolCall.mockResolvedValue({
      content: [{ type: 'text', text: 'SAP authentication failed' }],
      isError: true,
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await main(['atc', 'PROG', 'ZTEST'], deps)).toBe(1);
  });
});
