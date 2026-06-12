/**
 * Layer 2 — Per-user MCP tool-call rate limiter.
 *
 * Applied at the top of `handleToolCall` in `src/handlers/dispatch.ts`. Returns an MCP
 * tool error (NOT HTTP 429) on denial so the LLM client surfaces it as a tool failure
 * and the agent loop backs off correctly. Per-user token bucket keyed on the resolved
 * user identity (userName / clientId / __anon__).
 *
 * Design choices:
 * - Per-instance, in-memory only. Multi-instance attackers cost `limit × instances` —
 *   acceptable trade-off, matches stateless-DCR philosophy from PR #212.
 * - Stdio mode is exempt because there's no authInfo to key on; the caller is
 *   responsible for skipping the consume in that case.
 * - When `perMinute === 0`, the factory returns a stub whose `consume` resolves
 *   immediately with `{ allowed: true }` — no allocation, no per-key bookkeeping.
 *   This is the clean opt-out for single-user deployments.
 * - Cost weighting per tool is intentionally deferred to v2 — every consume call is
 *   one point. See ADR-0004 for the rationale.
 */

import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterMs: number; limitPerMinute: number };

/**
 * Resolve the per-user rate-limit key from an `AuthInfo`, walking the most-
 * specific identity claims first so distinct users never share a quota when
 * they share an auth client / application.
 *
 * Order, by descending specificity:
 *   1. `extra.userName`        — XSUAA logon name (`securityContext.getLogonName()`)
 *   2. `extra.email`           — XSUAA / OIDC email when populated
 *   3. `extra.sub`             — OIDC subject claim (guaranteed unique per user within issuer)
 *   4. `extra.preferred_username` — sometimes set on OIDC tokens
 *   5. `clientId`              — last resort. Note for OIDC this is `azp`
 *      (the app's client id), shared by all users of that app — so falling here
 *      collapses them into one bucket. The earlier checks exist specifically
 *      to avoid that. Acceptable only for the API-key path where the clientId
 *      is `api-key:<profile>` and the operator has chosen the profile granularity.
 *   6. `'__anon__'`            — token with no usable identity claim. Single
 *      shared bucket for anonymous traffic. Operators should configure auth so
 *      this branch is never reached in production.
 *
 * Why not just `sub`? Because XSUAA tokens don't put `sub` on `extra`; they put
 * the SAP logon name on `extra.userName`. OIDC does the inverse. We accept both
 * shapes rather than forcing every auth provider to align on one claim.
 */
export function resolveRateLimitUserKey(authInfo: AuthInfo | undefined): string {
  if (!authInfo) return '__anon__';
  const extra = (authInfo.extra ?? {}) as {
    userName?: unknown;
    email?: unknown;
    sub?: unknown;
    preferred_username?: unknown;
  };
  const candidates = [extra.userName, extra.email, extra.sub, extra.preferred_username, authInfo.clientId];
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) return c;
  }
  return '__anon__';
}

export interface McpRateLimiter {
  /**
   * Try to consume one point for `userKey`. Resolves `{ allowed: true }` when the
   * bucket has tokens, `{ allowed: false, retryAfterMs, limitPerMinute }` when it
   * doesn't. Never throws — internal RateLimiterRes rejection is caught here.
   *
   * `tool` is recorded for the audit event at the call site; it doesn't affect
   * the bucket.
   */
  consume(userKey: string, tool: string): Promise<RateLimitDecision>;
}

/**
 * Build a per-user MCP rate limiter.
 *
 * @param perMinute Per-user requests per minute. `0` returns a no-op stub.
 */
export function createMcpRateLimiter(perMinute: number): McpRateLimiter {
  if (perMinute === 0) {
    return {
      async consume(_userKey: string, _tool: string): Promise<RateLimitDecision> {
        return { allowed: true };
      },
    };
  }

  const limiter = new RateLimiterMemory({ points: perMinute, duration: 60 });

  return {
    async consume(userKey: string, _tool: string): Promise<RateLimitDecision> {
      try {
        await limiter.consume(userKey, 1);
        return { allowed: true };
      } catch (rejected) {
        // RateLimiterRes is thrown on overflow; anything else is unexpected.
        if (rejected instanceof RateLimiterRes) {
          return {
            allowed: false,
            retryAfterMs: rejected.msBeforeNext,
            limitPerMinute: perMinute,
          };
        }
        // Defensive: treat unexpected errors as "allowed" so a misbehaving limiter
        // can never wedge legitimate traffic. The exception itself bubbles up via
        // logging when the limiter is fixed; in the meantime users still get through.
        return { allowed: true };
      }
    },
  };
}
