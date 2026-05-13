import express from 'express';
import { describe, expect, it } from 'vitest';
import type { AuditEvent } from '../../../src/server/audit.js';
import { createAuthRateLimiter } from '../../../src/server/auth-rate-limit.js';
import { logger } from '../../../src/server/logger.js';

/**
 * Task 3 (Layer 1): HTTP-edge per-IP rate limit on OAuth + /mcp.
 *
 * Verifies the express-rate-limit factory: under-limit allows pass-through, over-limit
 * returns 429 with RFC 9331 RateLimit-* headers + Retry-After, emits a typed
 * auth_rate_limited audit event, no-op factory always passes.
 */

/** Capture audit events emitted via logger.emitAudit during a test. Matches the
 *  pattern in tests/unit/server/stateless-client-store.test.ts — sinks are append-only;
 *  the capture sink stays registered for the lifetime of the test file (one process). */
function captureAuditEvents(): AuditEvent[] {
  const events: AuditEvent[] = [];
  logger.addSink({ write: (e: AuditEvent) => events.push(e) });
  return events;
}

/** Build a tiny Express app with the given limiter mounted at /test. */
function appWithLimiter(limiter: express.RequestHandler) {
  const app = express();
  app.set('trust proxy', 1);
  app.use('/test', limiter);
  app.get('/test', (_req, res) => res.json({ ok: true }));
  return app;
}

/** Fire N sequential requests via supertest-lite using node:http. Returns status codes. */
async function fireRequests(
  app: express.Express,
  n: number,
  ip = '10.0.0.1',
): Promise<{ codes: number[]; lastHeaders: Record<string, string> }> {
  const http = await import('node:http');
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('server not listening');
  const port = addr.port;

  const codes: number[] = [];
  let lastHeaders: Record<string, string> = {};
  for (let i = 0; i < n; i++) {
    const res = await new Promise<{ status: number; headers: Record<string, string> }>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/test',
          method: 'GET',
          headers: { 'X-Forwarded-For': ip },
        },
        (response) => {
          response.on('data', () => {});
          response.on('end', () => {
            resolve({
              status: response.statusCode ?? 0,
              headers: Object.fromEntries(
                Object.entries(response.headers).map(([k, v]) => [
                  k.toLowerCase(),
                  Array.isArray(v) ? v.join(',') : (v ?? ''),
                ]),
              ),
            });
          });
        },
      );
      req.on('error', reject);
      req.end();
    });
    codes.push(res.status);
    lastHeaders = res.headers;
  }

  await new Promise<void>((r) => server.close(() => r()));
  return { codes, lastHeaders };
}

describe('createAuthRateLimiter (Layer 1)', () => {
  it('allows requests under the cap and rejects over it', async () => {
    const app = appWithLimiter(createAuthRateLimiter('/test', 3));
    const { codes } = await fireRequests(app, 5);
    // 3 pass with 200, then 2 over-cap requests return 429.
    expect(codes.slice(0, 3)).toEqual([200, 200, 200]);
    expect(codes.slice(3)).toEqual([429, 429]);
  });

  it('429 response includes Retry-After and RFC 9331 RateLimit header', async () => {
    const app = appWithLimiter(createAuthRateLimiter('/test', 1));
    const { lastHeaders } = await fireRequests(app, 2);
    expect(lastHeaders['retry-after']).toBeDefined();
    // express-rate-limit draft-7 collapses the individual draft-6 headers into a single
    // RFC 9331 `RateLimit: limit=1, remaining=0, reset=N` header.
    expect(lastHeaders.ratelimit).toBeDefined();
    expect(lastHeaders.ratelimit).toMatch(/limit=1/);
    expect(lastHeaders.ratelimit).toMatch(/remaining=0/);
    expect(lastHeaders.ratelimit).toMatch(/reset=\d+/);
  });

  it('emits auth_rate_limited audit event on denial', async () => {
    const events = captureAuditEvents();
    const app = appWithLimiter(createAuthRateLimiter('/test', 1));
    await fireRequests(app, 2);
    const denials = events.filter((e) => e.event === 'auth_rate_limited');
    expect(denials.length).toBeGreaterThanOrEqual(1);
    const denial = denials[0];
    if (denial.event !== 'auth_rate_limited') throw new Error('type guard');
    expect(denial.endpoint).toBe('/test');
    expect(denial.limitPerMinute).toBe(1);
    expect(denial.level).toBe('warn');
    expect(denial.ip).toBeTruthy();
  });

  it('does NOT emit audit event for allowed requests', async () => {
    const events = captureAuditEvents();
    const before = events.filter((e) => e.event === 'auth_rate_limited').length;
    const app = appWithLimiter(createAuthRateLimiter('/test', 5));
    await fireRequests(app, 3, '10.99.99.99');
    const after = events.filter((e) => e.event === 'auth_rate_limited').length;
    expect(after).toBe(before);
  });

  it('tracks different IPs independently', async () => {
    const app = appWithLimiter(createAuthRateLimiter('/test', 2));
    // IP A: 3 requests — last one denied
    const ipA = await fireRequests(app, 3, '10.0.0.1');
    expect(ipA.codes).toEqual([200, 200, 429]);
    // IP B: 2 requests — both pass (independent bucket)
    const ipB = await fireRequests(app, 2, '10.0.0.2');
    expect(ipB.codes).toEqual([200, 200]);
  });
});

// Note: when ARC1_AUTH_RATE_LIMIT=0 the limiter is NOT mounted at all (see http.ts).
// There is no noop-middleware helper any more — keeps CodeQL's dataflow direct.
