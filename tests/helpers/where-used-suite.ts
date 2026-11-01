/** Research-only summary: never publish arbitrary test names, errors, source, or runner paths. */
import { isAbsolute, relative } from 'node:path';
import { z } from 'zod';
import type { Manifest } from './where-used-experiment.js';

const status = z.enum(['passed', 'failed', 'pending', 'skipped', 'todo']);
const reportSchema = z.object({
  success: z.boolean(),
  numTotalTests: z.number().int().nonnegative(),
  numFailedTestSuites: z.number().int().nonnegative(),
  testResults: z.array(
    z.object({
      name: z.string(),
      status: z.enum(['passed', 'failed']),
      startTime: z.number().nonnegative(),
      endTime: z.number().nonnegative(),
      assertionResults: z.array(z.object({ status })),
    }),
  ),
});

export function summarizeSuite(input: unknown, allowedFiles: ReadonlySet<string>) {
  const report = reportSchema.parse(input);
  const seen = new Set<string>();
  const files = report.testResults
    .map((file) => {
      const path = relative(process.cwd(), file.name);
      if (!isAbsolute(file.name) || !allowedFiles.has(path) || seen.has(path)) throw new Error('Invalid report path.');
      seen.add(path);
      const assertions = { passed: 0, failed: 0, pending: 0, skipped: 0, todo: 0 };
      for (const assertion of file.assertionResults) assertions[assertion.status]++;
      return {
        path,
        status: file.status,
        reportedStartTime: file.startTime,
        reportedEndTime: file.endTime,
        assertions,
      };
    })
    .sort((a, b) => a.reportedStartTime - b.reportedStartTime);
  return {
    success: report.success,
    reportedTotalTests: report.numTotalTests,
    reportedFailedSuites: report.numFailedTestSuites,
    ownedTestReported: files.some(
      (file) =>
        file.path === 'tests/integration/where-used-details.integration.test.ts' &&
        file.assertions.passed + file.assertions.failed > 0,
    ),
    // Canceled files can be reported as passed with no assertions. Times alone do not prove execution.
    order: 'Vitest reported start times; see assertion counts for unexecuted or pending tests',
    files,
    unreportedFiles: [...allowedFiles].filter((path) => !seen.has(path)).sort(),
  };
}

export function suiteFailed(state: Manifest): boolean {
  const pair = state.pairs[0];
  return (
    state.suiteExitCode !== 0 ||
    Boolean(state.stop || state.observationFailures) ||
    !state.cleanupFinishedUtc ||
    state.pairs.length !== 1 ||
    !pair ||
    pair.outcome !== 'passed' ||
    !pair.indexOk ||
    !pair.activeSourcesMatch ||
    Boolean(pair.retain) ||
    pair.cleanup[pair.root] !== 'absent' ||
    pair.cleanup[pair.consumer] !== 'absent'
  );
}
