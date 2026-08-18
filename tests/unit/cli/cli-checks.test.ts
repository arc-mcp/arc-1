import { describe, expect, it } from 'vitest';
import type { AtcRunResult } from '../../../src/adt/devtools.js';
import type { AunitCiResult, StructuredDiffResult } from '../../../src/cli-checks.js';
import {
  assertAtcPriority,
  assertPercent,
  atcToCheckstyle,
  evaluateAtc,
  evaluateAunit,
  evaluateDiff,
  evaluateLint,
  formatAtcText,
  formatAunitText,
  formatLintText,
  lintToCheckstyle,
} from '../../../src/cli-checks.js';
import type { LintResult } from '../../../src/lint/lint.js';

function aunit(overrides: Partial<AunitCiResult> = {}): AunitCiResult {
  return {
    outcome: 'passed',
    summary: { tests: 3, passed: 3, failures: 0, errors: 0, skipped: 0, warnings: 0 },
    sourceSelectionEvidence: {
      status: 'verified',
      declaredTestClasses: [{ testClass: 'LTCL_SAFE', riskLevel: 'harmless', explicitRiskLevel: true }],
      omittedTestClasses: [],
      omittedNonHarmlessTestClasses: [],
    },
    ...overrides,
  };
}

function atc(overrides: Partial<AtcRunResult> = {}): AtcRunResult {
  return {
    findings: [],
    worklistId: 'WL1',
    variant: null,
    maximumVerdicts: 100,
    expectedFindingCount: 0,
    findingCount: 0,
    processedObjectCount: 1,
    objectSetIsComplete: true,
    truncated: false,
    complete: true,
    incompleteReasons: [],
    runStatusCode: 200,
    worklist: { id: 'WL1' },
    infos: [],
    ...overrides,
  };
}

const lintIssues: LintResult[] = [
  {
    rule: 'syntax',
    message: 'Bad <syntax> & value',
    line: 2,
    column: 3,
    endLine: 2,
    endColumn: 4,
    severity: 'error',
  },
  {
    rule: 'style',
    message: 'Style warning',
    line: 5,
    column: 1,
    endLine: 5,
    endColumn: 2,
    severity: 'warning',
  },
];

describe('ABAP Unit CI policy', () => {
  it('maps pass/fail/no-tests/incomplete without allowing an empty override to hide incomplete evidence', () => {
    expect(evaluateAunit(aunit())).toBe(0);
    expect(evaluateAunit(aunit({ outcome: 'failed' }))).toBe(1);
    expect(evaluateAunit(aunit({ outcome: 'incomplete' }), { allowEmpty: true })).toBe(3);
    const soundNoTests = aunit({
      outcome: 'no_tests',
      summary: { tests: 0, passed: 0, failures: 0, errors: 0, skipped: 0, warnings: 0 },
      sourceSelectionEvidence: {
        status: 'verified',
        declaredTestClasses: [],
        omittedTestClasses: [],
        omittedNonHarmlessTestClasses: [],
      },
    });
    expect(evaluateAunit(soundNoTests)).toBe(3);
    expect(evaluateAunit(soundNoTests, { allowEmpty: true })).toBe(0);
    expect(
      evaluateAunit(
        aunit({
          outcome: 'no_tests',
          summary: { tests: 0, passed: 0, failures: 0, errors: 0, skipped: 0, warnings: 1 },
          sourceSelectionEvidence: {
            status: 'verified',
            declaredTestClasses: [{ testClass: 'LTCL_SAFE', riskLevel: 'harmless', explicitRiskLevel: true }],
            omittedTestClasses: [{ testClass: 'LTCL_SAFE', riskLevel: 'harmless', explicitRiskLevel: true }],
            omittedNonHarmlessTestClasses: [],
          },
        }),
        { allowEmpty: true },
      ),
    ).toBe(3);
  });

  it('fails skipped and coverage gates, and distinguishes unavailable evidence', () => {
    const withCoverage = aunit({
      coverage: {
        statement: { executed: 80, total: 100, percent: 80 },
        branch: { executed: 7, total: 10, percent: 70 },
        procedure: { executed: 0, total: 0, percent: 0 },
      },
      coverageEvidence: 'available',
    });
    expect(evaluateAunit(withCoverage, { coverage: { statement: 80, branch: 70 } })).toBe(0);
    expect(evaluateAunit(withCoverage, { coverage: { statement: 81 } })).toBe(1);
    expect(evaluateAunit(withCoverage, { coverage: { procedure: 1 } })).toBe(3);
    expect(evaluateAunit(aunit(), { coverage: { statement: 1 } })).toBe(3);
    expect(evaluateAunit(withCoverage, { requireCoverage: true })).toBe(3);
    expect(
      evaluateAunit(
        aunit({
          coverageEvidence: 'available',
          coverage: {
            statement: { executed: 8, total: 10, percent: 80 },
            branch: { executed: 7, total: 10, percent: 70 },
            procedure: { executed: 6, total: 10, percent: 60 },
          },
        }),
        { requireCoverage: true },
      ),
    ).toBe(0);
    expect(evaluateAunit(aunit({ coverageEvidence: 'unavailable' }), { requireCoverage: true })).toBe(3);
    expect(
      evaluateAunit(aunit({ summary: { ...aunit().summary, skipped: 1, passed: 2 } }), { failOnSkipped: true }),
    ).toBe(1);
  });

  it('accepts duplicate local test-class names only when their package programs differ', () => {
    const qualified = aunit({
      sourceSelectionEvidence: {
        status: 'verified',
        declaredTestClasses: [
          { program: 'ZCL_ONE', testClass: 'LTCL_TEST', riskLevel: 'harmless', explicitRiskLevel: true },
          { program: 'ZCL_TWO', testClass: 'LTCL_TEST', riskLevel: 'harmless', explicitRiskLevel: true },
        ],
        omittedTestClasses: [],
        omittedNonHarmlessTestClasses: [],
      },
    });

    expect(evaluateAunit(qualified)).toBe(0);
    expect(
      evaluateAunit({
        ...qualified,
        sourceSelectionEvidence: {
          ...qualified.sourceSelectionEvidence!,
          declaredTestClasses: qualified.sourceSelectionEvidence!.declaredTestClasses.map((row) => ({
            ...row,
            program: undefined,
          })),
        },
      }),
    ).toBe(3);
  });

  it('never greens inconsistent structured counters or outcome evidence', () => {
    expect(
      evaluateAunit(aunit({ summary: { tests: 3, passed: 2, failures: 0, errors: 0, skipped: 0, warnings: 0 } })),
    ).toBe(3);
    expect(
      evaluateAunit(
        aunit({
          outcome: 'passed',
          summary: { tests: 0, passed: 0, failures: 0, errors: 0, skipped: 0, warnings: 0 },
        }),
      ),
    ).toBe(3);
    expect(evaluateAunit({ summary: aunit().summary } as AunitCiResult)).toBe(3);
    expect(evaluateAunit({ ...aunit(), outcome: 'future_status' } as unknown as AunitCiResult)).toBe(3);
    expect(
      evaluateAunit({
        ...aunit(),
        summary: { ...aunit().summary, warnings: undefined },
      } as unknown as AunitCiResult),
    ).toBe(3);
    expect(
      evaluateAunit(
        aunit({
          outcome: 'failed',
          summary: { tests: 2, passed: 1, failures: 1, errors: 1, skipped: 0, warnings: 0 },
        }),
      ),
    ).toBe(1);
    expect(
      evaluateAunit(
        aunit({
          outcome: 'no_tests',
          summary: { tests: 1, passed: 1, failures: 0, errors: 0, skipped: 0, warnings: 0 },
        }),
        { allowEmpty: true },
      ),
    ).toBe(3);
    expect(evaluateAunit({ ...aunit(), sourceSelectionEvidence: undefined })).toBe(3);
    expect(
      evaluateAunit(
        aunit({
          sourceSelectionEvidence: {
            status: 'verified',
            declaredTestClasses: [{ testClass: 'LTCL_DANGEROUS', riskLevel: 'dangerous', explicitRiskLevel: true }],
            omittedTestClasses: [],
            omittedNonHarmlessTestClasses: [],
          },
        }),
      ),
    ).toBe(3);
  });

  it('formats a compact text summary with measurable and unavailable coverage', () => {
    const text = formatAunitText(
      aunit({
        coverage: { statement: { executed: 1, total: 2, percent: 50 } },
        coverageEvidence: 'available',
      }),
    );
    expect(text).toContain('ABAP Unit: passed');
    expect(text).toContain('Statement coverage: 50.00% (1/2)');
    expect(text).toContain('Branch coverage: unavailable');
  });
});

describe('ATC, lint, and diff CI policy', () => {
  it('never evaluates an incomplete ATC worklist as clean', () => {
    expect(evaluateAtc(atc({ complete: false, objectSetIsComplete: null }), 3)).toBe(3);
    expect(evaluateAtc(atc({ complete: false, truncated: true }), 1)).toBe(3);
    expect(evaluateAtc(atc({ processedObjectCount: 0 }), 1)).toBe(3);
    expect(evaluateAtc(atc({ findingCount: 1 }), 1)).toBe(3);
    expect(
      evaluateAtc(
        atc({
          findings: [{ priority: Number.NaN, checkTitle: 'bad', messageTitle: 'bad', uri: '', line: 0 }],
          findingCount: 1,
        }),
        3,
      ),
    ).toBe(3);
    expect(evaluateAtc({ ...atc(), complete: 'true' } as unknown as AtcRunResult, 1)).toBe(3);
    expect(evaluateAtc({ ...atc(), worklistId: undefined } as unknown as AtcRunResult, 1)).toBe(3);
    expect(evaluateAtc({ ...atc(), infos: undefined } as unknown as AtcRunResult, 1)).toBe(3);
    expect(
      evaluateAtc(
        {
          ...atc(),
          findings: [{ priority: 2, checkTitle: 'check', messageTitle: 'message', uri: '', line: '4' }],
          findingCount: 1,
        } as unknown as AtcRunResult,
        1,
      ),
    ).toBe(3);
  });

  it('uses numeric ATC priority thresholds', () => {
    const findings = [
      { priority: 2, checkTitle: 'Search', messageTitle: 'DB write', uri: '/sap/source#start=7,0', line: 7 },
    ];
    expect(evaluateAtc(atc({ findings, expectedFindingCount: 1, findingCount: 1 }), 1)).toBe(0);
    expect(evaluateAtc(atc({ findings, expectedFindingCount: 1, findingCount: 1 }), 2)).toBe(1);
    expect(formatAtcText(atc({ findings, expectedFindingCount: 1, findingCount: 1 }))).toContain(
      '[P2] Search: DB write',
    );
  });

  it('maps lint thresholds and diff check semantics deterministically', () => {
    expect(evaluateLint(lintIssues, 'error')).toBe(1);
    expect(
      evaluateLint(
        lintIssues.filter((issue) => issue.severity === 'warning'),
        'error',
      ),
    ).toBe(0);
    expect(
      evaluateLint(
        lintIssues.filter((issue) => issue.severity === 'warning'),
        'warning',
      ),
    ).toBe(1);
    expect(evaluateLint(lintIssues, 'none')).toBe(0);
    expect(evaluateLint([{}] as LintResult[], 'none')).toBe(3);
    expect(evaluateLint([{ ...lintIssues[0], severity: 'critical' }] as unknown as LintResult[], 'none')).toBe(3);
    expect(evaluateLint([{ ...lintIssues[0], line: -1 }], 'error')).toBe(3);
    expect(evaluateLint([{ ...lintIssues[0], endLine: 1 }], 'error')).toBe(3);
    expect(formatLintText([])).toBe('No issues found.');

    const diff: StructuredDiffResult = {
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
    expect(evaluateDiff(diff, false)).toBe(0);
    expect(evaluateDiff(diff, true)).toBe(1);
    expect(
      evaluateDiff({ ...diff, identical: true, hasDifferences: false, added: 0, removed: 0, diff: '' }, true),
    ).toBe(0);
    expect(evaluateDiff({ ...diff, hasDifferences: undefined } as unknown as StructuredDiffResult, false)).toBe(3);
    expect(evaluateDiff({ ...diff, identical: true }, false)).toBe(3);
    expect(evaluateDiff({ ...diff, added: '1' } as unknown as StructuredDiffResult, false)).toBe(3);
  });

  it('emits escaped Checkstyle with documented ATC severity mapping', () => {
    const findings = [
      {
        priority: 1,
        checkTitle: 'Check <one>',
        messageTitle: 'Error & one',
        uri: '/sap/bc/adt/programs/ZTEST#start=2,0',
        line: 2,
      },
      {
        priority: 2,
        checkTitle: 'Check two',
        messageTitle: 'Warning',
        uri: '/sap/bc/adt/programs/ZTEST#start=4,0',
        line: 4,
      },
      { priority: 3, checkTitle: 'Check three', messageTitle: 'Info', uri: '', line: 0 },
    ];
    const xml = atcToCheckstyle(atc({ findings, findingCount: 3 }));
    expect(xml).toContain('severity="error"');
    expect(xml).toContain('severity="warning"');
    expect(xml).toContain('severity="info"');
    expect(xml).toContain('Check &lt;one&gt;');
    expect(xml).toContain('Error &amp; one');

    const lintXml = lintToCheckstyle(lintIssues, 'ztest.prog.abap');
    expect(lintXml).toContain('<file name="ztest.prog.abap">');
    expect(lintXml).toContain('source="abaplint.syntax"');
    expect(lintXml).toContain('Bad &lt;syntax&gt; &amp; value');
  });
});

describe('CI usage input', () => {
  it('validates percentages and ATC priority as usage input', () => {
    expect(assertPercent('80.5', '--min-statement')).toBe(80.5);
    expect(() => assertPercent('-1', '--min-statement')).toThrow(/between 0 and 100/);
    expect(() => assertPercent('NaN', '--min-statement')).toThrow(/between 0 and 100/);
    expect(assertAtcPriority('2')).toBe(2);
    expect(() => assertAtcPriority('2.5')).toThrow(/integer/);
    expect(() => assertAtcPriority('4')).toThrow(/integer/);
  });
});
