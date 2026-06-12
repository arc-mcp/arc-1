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
 *   1. `TEST_RUN_ID` env var — set by scripts/e2e-run-local.sh (shell-exported)
 *      so the shell paths (port/PID/log dir) and the TS object names share one
 *      id. Sanitised to A-Z and capped at 4 chars.
 *   2. A random 2-letter token, derived once per process.
 *
 * The token is LETTERS-ONLY (not base36): letters are valid in every identifier
 * the suites generate, including BDEF/CDS names, so one token works for both the
 * alphanumeric `uniqueName` and the letters-only `uniqueLettersName` without a
 * lossy digit→letter mapping. `dotenv/config` is imported so a `TEST_RUN_ID` set
 * in `.env` is honoured regardless of module import order (the integration
 * suite's dotenv loader may run after this module).
 */

import 'dotenv/config';

/**
 * A random uppercase letter A-Z. `Math.random` (NOT a cryptographically secure
 * source) is the right tool here: this is a throwaway test-object-name token, not
 * a security value, so there is no need for crypto randomness — and using it
 * avoids the modulo/division bias CodeQL flags on crypto sources. Matches
 * scripts/e2e-local-utils.mjs `generateRunId`.
 */
function randomLetter(): string {
  return String.fromCharCode(65 + Math.floor(Math.random() * 26));
}

/**
 * Resolve a run id from a raw env value, falling back to a random token.
 * Exported (rather than only `RUN_ID`) so it can be unit-tested without
 * re-importing the module to re-trigger the random fallback.
 */
export function deriveRunId(rawEnv: string | undefined): string {
  const sanitized = rawEnv?.toUpperCase().replace(/[^A-Z]/g, '');
  if (sanitized) return sanitized.slice(0, 4);
  // 2 random uppercase letters (676 combinations) — ample to separate the
  // handful of runs that realistically overlap on one SAP system.
  return randomLetter() + randomLetter();
}

/** Stable per-process run id (uppercase letters, 2-4 chars). */
export const RUN_ID = deriveRunId(process.env.TEST_RUN_ID);
