/**
 * Layer 1 — HTTP-edge per-IP rate limiter.
 *
 * Mounted in `src/server/http.ts` on `/register`, `/authorize`, `/token`, `/revoke`,
 * and `/mcp`. Closes the OAuth surface against brute-force / probing and the `/mcp`
 * surface against anonymous probing of the pre-bearer-auth path. CodeQL alert #12
 * (`js/missing-rate-limiting`) is resolved by this module's mount.
 *
 * Design choices:
 * - Per-IP, in-memory only — multi-instance attackers cost `limit × instances`. We
 *   accept that trade-off to preserve the stateless-deployment property from PR #212.
 * - The operator-facing knob is a single per-minute baseline (`ARC1_AUTH_RATE_LIMIT`,
 *   default 20). Per-endpoint differentiation is done at the mount site in http.ts:
 *   OAuth endpoints all use the baseline; `/mcp` gets a higher cap to absorb
 *   legitimate batch tool-call traffic.
 * - On limit hit, emits a typed `auth_rate_limited` audit event BEFORE responding so
 *   the security event stream captures the denial regardless of response timing.
 * - Uses `standardHeaders: 'draft-7'` for RFC 9331 / draft-ietf-httpapi-ratelimit
 *   headers (`RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`).
 */

import type { Request, RequestHandler, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { logger } from './logger.js';

/**
 * Optional knobs for `createAuthRateLimiter`.
 *
 * `skip` is the only one currently — used to layer two limiters on the same
 * route (`/authorize`) where one skips JSON-RPC bodies and the other only
 * applies to JSON-RPC bodies. See http.ts for the Copilot Studio rationale.
 * Passing a `skip` function is preferred over building an outer conditional
 * dispatcher: CodeQL's `js/missing-rate-limiting` query only recognises
 * `app.use(path, rateLimit({...}))` patterns where the second argument is
 * directly a `rateLimit({...})` result. Going through an inline arrow
 * function with branch-based delegation re-opens the alert.
 */
export interface AuthRateLimiterOptions {
  skip?: (req: Request, res: Response) => boolean;
}

/**
 * Build a per-IP rate limiter for one endpoint. The returned middleware:
 * - allows `perMinute` requests per minute per IP (60_000 ms window),
 * - returns HTTP 429 with `Retry-After` and RFC 9331 `RateLimit-*` headers on hit,
 * - emits a typed `auth_rate_limited` audit event on every denial,
 * - honors an optional `skip` predicate so the same Express route can stack
 *   two limiters (one for OAuth bodies, one for Copilot Studio MCP JSON-RPC).
 *
 * `endpoint` is used only for the audit event label and for diagnostic logs;
 * the path-based mount in Express is done by the caller.
 *
 * Operators disable Layer 1 by setting `ARC1_AUTH_RATE_LIMIT=0`, which makes
 * `http.ts` skip the `app.use(…)` mount entirely — there is intentionally no
 * "noop middleware" path here. Keeping the dataflow `rateLimit({…}) → app.use`
 * direct lets CodeQL's `js/missing-rate-limiting` query close cleanly.
 */
export function createAuthRateLimiter(
  endpoint: string,
  perMinute: number,
  opts: AuthRateLimiterOptions = {},
): RequestHandler {
  return rateLimit({
    windowMs: 60_000,
    max: perMinute,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Explicit keyGenerator: rely on Express's req.ip after `trust proxy 1` (set in http.ts).
    // Operators running behind multiple proxy hops must increase the trust-proxy count there.
    keyGenerator: (req) => req.ip ?? 'unknown',
    skip: opts.skip,
    handler: (req, res, _next, options) => {
      const ip = req.ip ?? 'unknown';
      logger.emitAudit({
        timestamp: new Date().toISOString(),
        level: 'warn',
        event: 'auth_rate_limited',
        endpoint,
        ip,
        limitPerMinute: perMinute,
      });
      res.status(options.statusCode).json({
        error: 'rate_limited',
        message: `Too many requests to ${endpoint} from ${ip}. Limit: ${perMinute}/min.`,
      });
    },
  });
}

/**
 * Detect Copilot Studio MCP JSON-RPC requests sent to `/authorize`.
 *
 * Copilot Studio POSTs JSON-RPC tool calls to `/authorize` (a known quirk of
 * that MCP client). On `/authorize`, this predicate is used in two limiter
 * mounts: the OAuth-cap limiter `skip`s when this is true; the MCP-cap
 * limiter `skip`s when this is false. The pair gives JSON-RPC traffic the
 * higher `/mcp` cap while real OAuth flows stay on the OAuth cap.
 *
 * Critically, this predicate MUST agree with the routing handler in `http.ts`
 * that actually dispatches the request to either the OAuth flow or the MCP
 * handler. The handler uses `req.body?.jsonrpc` — a truthiness check that
 * rejects falsy values (`''`, `0`, `null`). We mirror that exactly:
 * presence + truthiness. Earlier code used a presence-only check, which let
 * a request like `{"jsonrpc": ""}` skip the OAuth limiter (presence true =
 * "Copilot traffic, use MCP cap") AND get routed as a normal OAuth request
 * (truthiness false = "not Copilot, run OAuth"), producing a 30× rate-limit
 * bypass on `/authorize`. The predicate and the routing handler are now
 * defined identically and `http.ts` reuses this function in both places.
 *
 * Exported so http.ts AND its tests use the exact same predicate — drift
 * here would silently re-introduce the bypass.
 */
export function isCopilotJsonRpc(req: Request): boolean {
  if (req.method !== 'POST') return false;
  const body = req.body as { jsonrpc?: unknown } | undefined;
  return body != null && Boolean(body.jsonrpc);
}
