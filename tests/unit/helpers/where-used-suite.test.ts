import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BASELINE, type Manifest } from '../../helpers/where-used-experiment.js';
import { suiteFailed, summarizeSuite } from '../../helpers/where-used-suite.js';

const path = 'tests/integration/where-used-details.integration.test.ts';
const otherPath = 'tests/integration/other.test.ts';
const allowed = new Set([path, otherPath]);
function report() {
  return {
    success: false,
    numTotalTests: 2,
    numFailedTestSuites: 1,
    privateText: 'private top-level detail',
    testResults: [
      {
        name: resolve(path),
        status: 'failed',
        startTime: 20,
        endTime: 30,
        message: 'private error',
        assertionResults: [
          { status: 'failed', title: 'private object name', failureMessages: ['private stack'] },
          { status: 'pending', title: 'never executed' },
        ],
      },
      { name: resolve(otherPath), status: 'passed', startTime: 10, endTime: 10, assertionResults: [] },
    ],
  };
}
function cleanState(): Manifest {
  const root = 'ZAR1018_ROOT_AB12345';
  const consumer = 'ZAR1018_USE_AB67890';
  return {
    baseline: BASELINE,
    startedUtc: '2026-11-01T00:00:00Z',
    suiteExitCode: 0,
    cleanupFinishedUtc: '2026-11-01T00:01:00Z',
    pairs: [
      {
        root,
        consumer,
        absentBeforeCreate: true,
        attempts: [root, consumer],
        conflicts: [],
        outcome: 'passed',
        indexOk: true,
        activeSourcesMatch: true,
        cleanup: { [root]: 'absent', [consumer]: 'absent' },
      },
    ],
  };
}

describe('research full-suite evidence', () => {
  it('reports pending assertions and empty canceled files without exposing arbitrary output', () => {
    const summary = summarizeSuite(report(), allowed);
    expect(summary.files.map((file) => file.path)).toEqual([otherPath, path]);
    expect(summary.files[0]?.assertions).toEqual({ passed: 0, failed: 0, pending: 0, skipped: 0, todo: 0 });
    expect(summary.files[1]?.assertions).toMatchObject({ failed: 1, pending: 1 });
    expect(JSON.stringify(summary)).not.toContain('private');
    expect(JSON.stringify(summary)).not.toContain(process.cwd());
    expect(summary.ownedTestReported).toBe(true);
  });
  it('distinguishes an unexecuted owned test from a reported assertion result', () => {
    const value = report();
    value.testResults[0]!.assertionResults = [];
    expect(summarizeSuite(value, allowed).ownedTestReported).toBe(false);
    value.testResults.shift();
    expect(summarizeSuite(value, allowed).ownedTestReported).toBe(false);
  });
  it('refuses unknown paths, duplicates and malformed/missing reports', () => {
    const unknown = report();
    unknown.testResults[0]!.name = '/private/secret.test.ts';
    expect(() => summarizeSuite(unknown, allowed)).toThrow();
    const duplicate = report();
    duplicate.testResults.push(duplicate.testResults[0]!);
    expect(() => summarizeSuite(duplicate, allowed)).toThrow();
    expect(() => summarizeSuite(undefined, allowed)).toThrow();
    expect(() => summarizeSuite({ testResults: [] }, allowed)).toThrow();
  });
  it('preserves unrelated suite failure even when the owned test passed and cleanup succeeded', () => {
    const state = cleanState();
    expect(suiteFailed(state)).toBe(false);
    state.suiteExitCode = 1;
    expect(suiteFailed(state)).toBe(true);
    state.suiteExitCode = null;
    expect(suiteFailed(state)).toBe(true);
  });
  it('requires fixture execution, successful diagnostics and complete cleanup', () => {
    const absent = cleanState();
    absent.pairs = [];
    expect(suiteFailed(absent)).toBe(true);
    const incomplete = cleanState();
    delete incomplete.pairs[0]!.cleanup[incomplete.pairs[0]!.consumer];
    expect(suiteFailed(incomplete)).toBe(true);
    const failed = cleanState();
    failed.pairs[0]!.outcome = 'ordinary-scoped-failure';
    expect(suiteFailed(failed)).toBe(true);
    const noSource = cleanState();
    noSource.pairs[0]!.activeSourcesMatch = undefined;
    expect(suiteFailed(noSource)).toBe(true);
  });
});
