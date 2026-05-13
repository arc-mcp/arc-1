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

import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { logger } from './logger.js';

/**
 * Build a per-IP rate limiter for one endpoint. The returned middleware:
 * - allows `perMinute` requests per minute per IP (60_000 ms window),
 * - returns HTTP 429 with `Retry-After` and RFC 9331 `RateLimit-*` headers on hit,
 * - emits a typed `auth_rate_limited` audit event on every denial.
 *
 * `endpoint` is used only for the audit event label and for diagnostic logs;
 * the path-based mount in Express is done by the caller.
 *
 * Operators disable Layer 1 by setting `ARC1_AUTH_RATE_LIMIT=0`, which makes
 * `http.ts` skip the `app.use(…)` mount entirely — there is intentionally no
 * "noop middleware" path here. Keeping the dataflow `rateLimit({…}) → app.use`
 * direct lets CodeQL's `js/missing-rate-limiting` query close cleanly.
 */
export function createAuthRateLimiter(endpoint: string, perMinute: number): RequestHandler {
  return rateLimit({
    windowMs: 60_000,
    max: perMinute,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Explicit keyGenerator: rely on Express's req.ip after `trust proxy 1` (set in http.ts).
    // Operators running behind multiple proxy hops must increase the trust-proxy count there.
    keyGenerator: (req) => req.ip ?? 'unknown',
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
