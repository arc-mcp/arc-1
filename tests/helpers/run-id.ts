/**
 * Per-run identity for test object names and artifact paths.
 *
 * Two test runs against the SAME SAP system — e.g. two git worktrees, or a local
 * run overlapping a CI run — must not generate colliding ABAP object names.
 * Timestamp + a process-local counter (the previous scheme) still collides when
 * two processes start in the same millisecond: both read the same `Date.now()`
 * and both begin their counter at 0. Mixing a short per-run token into every
 * generated name closes that window.
 *
 * Resolution order:
 *   1. `TEST_RUN_ID` env var — set by scripts/e2e-run-local.sh so the shell-side
 *      paths (port/PID/log dir) and the TS-side object names share one identity.
 *      Sanitised to A-Z0-9 and capped at 4 chars.
 *   2. A random 2-char base36 token, derived once per process.
 *
 * The token is deliberately tiny (2 chars ≈ 1296 values) so it barely dents the
 * ABAP 30-char object-name budget while still separating the handful of runs
 * that could realistically overlap on one system.
 */

import { randomBytes } from 'node:crypto';

/** Number of base36 values a 2-char token spans (36 * 36). */
const TWO_CHAR_BASE36 = 1296;

/**
 * Resolve a run id from a raw env value, falling back to a random token.
 * Exported (rather than only `RUN_ID`) so it can be unit-tested without
 * re-importing the module to re-trigger the random fallback.
 */
export function deriveRunId(rawEnv: string | undefined): string {
  const sanitized = rawEnv?.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (sanitized) return sanitized.slice(0, 4);
  return (randomBytes(2).readUInt16BE(0) % TWO_CHAR_BASE36).toString(36).toUpperCase().padStart(2, '0');
}

/** Stable per-process run id (uppercase, alphanumeric, 2-4 chars). */
export const RUN_ID = deriveRunId(process.env.TEST_RUN_ID);

/**
 * Letters-only form of `RUN_ID`, for object types whose generated suffix must
 * not contain digits (e.g. the function-group naming in func-write.e2e). Maps
 * each digit 0-9 to A-J so the value stays stable and collision-equivalent.
 */
export const RUN_ID_ALPHA = RUN_ID.replace(/[0-9]/g, (d) => String.fromCharCode(65 + Number(d)));
