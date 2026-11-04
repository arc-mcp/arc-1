import { describe, expect, it } from 'vitest';
import { summarizeDiagnostic } from '../../../scripts/ci/where-used-diagnostic-summary.mjs';

const passed = {
  success: true,
  numPassedTests: 1,
  numFailedTests: 0,
  numPendingTests: 0,
  numTodoTests: 0,
  numFailedTestSuites: 0,
};

describe('fresh-activation diagnostic reporting', () => {
  it('reports a real successful execution with the context qualification', () => {
    const result = summarizeDiagnostic(passed, 'success', '');
    expect(result.passed).toBe(true);
    expect(result.markdown).toContain('isolated process');
    expect(result.markdown).toContain('does not establish a fix');
  });

  it.each(['failure', 'cancelled', 'skipped', 'unknown'])(
    'never overrides step outcome %s with stale successful JSON',
    (outcome) => {
      expect(summarizeDiagnostic(passed, outcome, '').passed).toBe(false);
    },
  );

  it('reports missing/unreadable JSON as no results', () => {
    const result = summarizeDiagnostic(null, 'failure', '');
    expect(result.passed).toBe(false);
    expect(result.markdown).toContain('No readable result');
  });

  it.each([
    { ...passed, success: false },
    { ...passed, numPassedTests: 0 },
    { ...passed, numPendingTests: 1 },
    { ...passed, numTodoTests: 1 },
    { ...passed, numFailedTests: 1 },
    { ...passed, numFailedTestSuites: 1 },
  ])('rejects an unsuccessful, skipped or incomplete run: %j', (data) => {
    expect(summarizeDiagnostic(data, 'success', '').passed).toBe(false);
  });

  it('reports cleanup failures even when all test assertions passed', () => {
    const result = summarizeDiagnostic(
      { ...passed, success: false, numFailedTestSuites: 1 },
      'failure',
      'AssertionError: remove every owned where-used fixture: expected [leftover] to equal []',
    );
    expect(result.passed).toBe(false);
    expect(result.markdown).toContain('Cleanup failed');
    expect(result.markdown).toContain('ZAR1018_');
  });

  it('does not interpret zero failed assertions as a passing setup', () => {
    const result = summarizeDiagnostic(
      { ...passed, success: false, numPassedTests: 0, numPendingTests: 1, numFailedTestSuites: 1 },
      'failure',
      '',
    );
    expect(result.passed).toBe(false);
    expect(result.markdown).toContain('Suite/setup/cleanup failure');
  });

  it('does not mistake the cleanup assertion in a timeout code frame for a cleanup failure', () => {
    const result = summarizeDiagnostic(
      { ...passed, success: false, numPassedTests: 0, numFailedTests: 1, numFailedTestSuites: 1 },
      'failure',
      "57 | expect(failures, 'remove every owned where-used fixture').toEqual([]);\n59 | it('times out', ...)",
    );
    expect(result.passed).toBe(false);
    expect(result.markdown).not.toContain('Cleanup failed');
  });

  it('recognizes the actual cleanup assertion in colored CI output', () => {
    const result = summarizeDiagnostic(
      { ...passed, success: false, numFailedTestSuites: 1 },
      'failure',
      '\u001b[31mAssertionError: remove every owned where-used fixture\u001b[39m: expected [leftover] to equal []',
    );
    expect(result.markdown).toContain('Cleanup failed');
  });
});
