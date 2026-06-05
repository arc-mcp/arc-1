/**
 * Shared skip policy helpers for integration and E2E tests.
 *
 * Converts implicit early-return pseudo-skips into explicit, visible skips
 * with actionable reason text.
 */
import { appendFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { TaskContext } from 'vitest';

/** Standard skip reason constants for common precondition failures. */
export const SkipReason = {
  NO_CREDENTIALS: 'SAP credentials not configured',
  NO_FIXTURE: 'Required test fixture not found on SAP system',
  NO_DDLS: 'No DDLS object found on system',
  NO_DUMPS: 'No short dumps found on system',
  NO_TRANSPORT_PACKAGE: 'TEST_TRANSPORT_PACKAGE not configured (transportable package required)',
  TRANSPORT_PACKAGE_WRITES_DISABLED:
    'TEST_TRANSPORT_PACKAGE_WRITE_TESTS not enabled (transportable package writes can leave locked CTS tasks on shared SAP systems)',
  TRANSPORT_RELEASE_DISABLED:
    'TEST_TRANSPORT_RELEASE_TESTS not enabled (transport release is permanent on the shared SAP test system)',
  BACKEND_UNSUPPORTED: 'Backend feature not supported on this SAP system',
} as const;

type SkipSuite = 'unit' | 'integration' | 'e2e' | 'unknown';

export interface SkipTelemetryRecord {
  timestamp: string;
  suite: SkipSuite;
  file: string;
  test: string;
  fullName: string;
  reason: string;
}

const SKIP_ARTIFACT_BY_SUITE: Record<SkipSuite, string> = {
  unit: 'unit-skips.ndjson',
  integration: 'integration-skips.ndjson',
  e2e: 'e2e-skips.ndjson',
  unknown: 'skips.ndjson',
};

function inferSuite(file: string): SkipSuite {
  const normalized = file.replaceAll('\\', '/');
  if (normalized.includes('/tests/integration/') || normalized.startsWith('tests/integration/')) return 'integration';
  if (normalized.includes('/tests/e2e/') || normalized.startsWith('tests/e2e/')) return 'e2e';
  if (normalized.includes('/tests/unit/') || normalized.startsWith('tests/unit/')) return 'unit';
  return 'unknown';
}

function skipArtifactPath(suite: SkipSuite): string {
  if (process.env.ARC1_SKIP_REASONS_FILE) {
    return resolve(process.env.ARC1_SKIP_REASONS_FILE);
  }
  return resolve(join('test-results', SKIP_ARTIFACT_BY_SUITE[suite]));
}

export function resetSkipReasonArtifacts(): void {
  const paths = new Set(Object.values(SKIP_ARTIFACT_BY_SUITE).map((name) => resolve(join('test-results', name))));
  if (process.env.ARC1_SKIP_REASONS_FILE) {
    paths.add(resolve(process.env.ARC1_SKIP_REASONS_FILE));
  }
  for (const path of paths) {
    rmSync(path, { force: true });
  }
}

export function recordSkipReason(ctx: TaskContext, reason: string): void {
  const task = (ctx as Partial<TaskContext>).task;
  if (!task) return;

  const file = task.file?.filepath ?? '';
  const suite = inferSuite(file);
  const record: SkipTelemetryRecord = {
    timestamp: new Date().toISOString(),
    suite,
    file,
    test: task.name,
    fullName: task.fullName,
    reason: reason || 'unknown',
  };

  try {
    const path = skipArtifactPath(suite);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(record)}\n`);
  } catch {
    // Telemetry must not change test behavior.
  }
}

export function skipTest(ctx: TaskContext, reason: string): never {
  recordSkipReason(ctx, reason);
  ctx.skip(reason);
  // ctx.skip(reason) throws internally in Vitest, so the line below is normally unreachable.
  // Defensive throw in case this helper is used outside Vitest's runtime.
  throw new Error(`Test skipped: ${reason}`);
}

/**
 * Assert that `value` is non-nullish, or skip the test with a reason.
 *
 * After this call, TypeScript narrows `value` to `T` (non-null, non-undefined).
 * Falsy-but-defined values like `0`, `false`, and `''` are NOT skipped.
 */
export function requireOrSkip<T>(ctx: TaskContext, value: T | null | undefined, reason: string): asserts value is T {
  if (value === null || value === undefined) {
    skipTest(ctx, reason);
  }
}
