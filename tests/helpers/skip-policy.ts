/**
 * Shared skip policy helpers for integration and E2E tests.
 *
 * Converts implicit early-return pseudo-skips into explicit, visible skips
 * with actionable reason text.
 */
import type { TaskContext } from 'vitest';

/** Standard skip reason constants for common precondition failures. */
export const SkipReason = {
  NO_CREDENTIALS: 'SAP credentials not configured',
  NO_FIXTURE: 'Required test fixture not found on SAP system',
  NO_DDLS: 'No DDLS object found on system',
  NO_DUMPS: 'No short dumps found on system',
  NO_TRANSPORT_PACKAGE: 'TEST_TRANSPORT_PACKAGE not configured (transportable package required)',
  TRANSPORT_RELEASE_DISABLED:
    'TEST_TRANSPORT_RELEASE_TESTS not enabled (transport release is permanent on the shared SAP test system)',
  BACKEND_UNSUPPORTED: 'Backend feature not supported on this SAP system',
} as const;

/**
 * Assert that `value` is non-nullish, or skip the test with a reason.
 *
 * After this call, TypeScript narrows `value` to `T` (non-null, non-undefined).
 * Falsy-but-defined values like `0`, `false`, and `''` are NOT skipped.
 */
export function requireOrSkip<T>(ctx: TaskContext, value: T | null | undefined, reason: string): asserts value is T {
  if (value === null || value === undefined) {
    ctx.skip(reason);
    // ctx.skip() throws internally in Vitest, so the line below is normally unreachable.
    // Defensive throw in case this helper is used outside Vitest's runtime.
    throw new Error(`Test skipped: ${reason}`);
  }
}
