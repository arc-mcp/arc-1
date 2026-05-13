import express from 'express';
import { describe, expect, it } from 'vitest';
import type { AuditEvent } from '../../../src/server/audit.js';
import { createAuthRateLimiter, isCopilotJsonRpc } from '../../../src/server/auth-rate-limit.js';
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

/**
 * Mirrors the `/authorize` dispatcher in `src/server/http.ts`: POST bodies with
 * `jsonrpc` route to the higher /mcp cap (Copilot Studio MCP traffic), other
 * requests use the lower OAuth cap. Same one-instance-shared-with-/mcp pattern.
 *
 * Codex review flagged the original mount as a regression because the low OAuth
 * cap (20/min/IP default) would throttle Copilot's normal MCP tool-call traffic.
 * This test asserts the dispatcher routes the two correctly.
 */
describe('/authorize JSON-RPC dispatch (Copilot Studio MCP fix via skip())', () => {
  /** Mirrors the stacked-skip pattern used by src/server/http.ts. Both `app.use`
   *  calls pass a direct `rateLimit({...})` middleware so CodeQL's
   *  `js/missing-rate-limiting` query can trace the dataflow on every mount.
   *  The two limiters share the route; their `skip` predicates make exactly
   *  one of them count any given request. */
  function buildApp(oauthCap: number, mcpCap: number) {
    const app = express();
    app.set('trust proxy', 1);
    app.use(express.json());
    // OAuth-cap limiter: skips Copilot Studio MCP JSON-RPC traffic.
    app.use('/authorize', createAuthRateLimiter('/authorize', oauthCap, { skip: isCopilotJsonRpc }));
    // MCP-cap limiter: only counts Copilot Studio JSON-RPC requests.
    app.use('/authorize', createAuthRateLimiter('/mcp', mcpCap, { skip: (req) => !isCopilotJsonRpc(req) }));
    app.use('/mcp', createAuthRateLimiter('/mcp', mcpCap));
    app.all('/authorize', (_req, res) => res.json({ ok: 'authorize' }));
    app.all('/mcp', (_req, res) => res.json({ ok: 'mcp' }));
    return app;
  }

  async function fireJsonPost(
    app: express.Express,
    path: string,
    body: object,
    ip = '10.7.7.1',
  ): Promise<{ status: number; headers: Record<string, string> }> {
    const http = await import('node:http');
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, r));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('server not listening');
    const port = addr.port;
    const payload = JSON.stringify(body);
    try {
      return await new Promise<{ status: number; headers: Record<string, string> }>((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port,
            path,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload),
              'X-Forwarded-For': ip,
            },
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
        req.write(payload);
        req.end();
      });
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }

  it('JSON-RPC POST /authorize uses the /mcp cap, not the OAuth cap', async () => {
    // OAuth cap=2, /mcp cap=10. Fire 5 JSON-RPC POSTs to /authorize — all should pass
    // (would be capped at 2 if the OAuth limiter were applied).
    const app = buildApp(2, 10);
    const results: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await fireJsonPost(app, '/authorize', { jsonrpc: '2.0', id: i, method: 'tools/list' });
      results.push(r.status);
    }
    expect(results).toEqual([200, 200, 200, 200, 200]);
  });

  it('non-JSON-RPC POST /authorize still uses the OAuth cap', async () => {
    // OAuth cap=2. A POST body WITHOUT jsonrpc field (a real OAuth flow) — should hit
    // the OAuth cap at request 3.
    const app = buildApp(2, 10);
    const results: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await fireJsonPost(app, '/authorize', { client_id: 'foo', response_type: 'code' });
      results.push(r.status);
    }
    expect(results.slice(0, 2)).toEqual([200, 200]);
    expect(results.slice(2)).toEqual([429, 429]);
  });

  it('JSON-RPC /authorize and /mcp use independent stores (separate caps each)', async () => {
    // Trade-off documented in src/server/http.ts: each `rateLimit({...})` call gets
    // its own MemoryStore unless we explicitly inject a shared one. With separate
    // stores, a client alternating Copilot Studio routes effectively gets ~2× the
    // configured cap — acceptable at default config (max(20×30, 600) × 2 = 1200/min/IP)
    // and not worth the complexity of a custom shared store.
    //
    // mcpCap=3. Fire 3 JSON-RPC POSTs each to /authorize and /mcp → all 6 pass.
    const app = buildApp(2, 3);
    const results: { path: string; status: number }[] = [];
    const sequence = ['/authorize', '/authorize', '/authorize', '/mcp', '/mcp', '/mcp'];
    for (const path of sequence) {
      const r = await fireJsonPost(app, path, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
      results.push({ path, status: r.status });
    }
    expect(results.every((r) => r.status === 200)).toBe(true);
    // But each individual route still enforces its own cap.
    const next = await fireJsonPost(app, '/authorize', { jsonrpc: '2.0', id: 4, method: 'tools/list' });
    expect(next.status).toBe(429);
  });
});

describe('isCopilotJsonRpc', () => {
  function fakeReq(method: string, body: unknown): import('express').Request {
    return { method, body } as unknown as import('express').Request;
  }

  it('true for POST with jsonrpc field', () => {
    expect(isCopilotJsonRpc(fakeReq('POST', { jsonrpc: '2.0', method: 'tools/list' }))).toBe(true);
  });

  it('false for GET (any body)', () => {
    expect(isCopilotJsonRpc(fakeReq('GET', { jsonrpc: '2.0' }))).toBe(false);
  });

  it('false for POST without jsonrpc field (real OAuth flow)', () => {
    expect(isCopilotJsonRpc(fakeReq('POST', { client_id: 'foo', response_type: 'code' }))).toBe(false);
  });

  it('false for POST with no body', () => {
    expect(isCopilotJsonRpc(fakeReq('POST', undefined))).toBe(false);
    expect(isCopilotJsonRpc(fakeReq('POST', null))).toBe(false);
  });

  it('accepts any value for jsonrpc — including null or empty string', () => {
    // The MCP spec says jsonrpc MUST be the string "2.0", but we treat any
    // presence of the field as a Copilot Studio fingerprint. We let bearer auth
    // + the MCP handler do the actual JSON-RPC validation downstream.
    expect(isCopilotJsonRpc(fakeReq('POST', { jsonrpc: null }))).toBe(true);
    expect(isCopilotJsonRpc(fakeReq('POST', { jsonrpc: '' }))).toBe(true);
  });
});
