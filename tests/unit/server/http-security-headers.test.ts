import { createServer } from 'node:http';
import { connect } from 'node:net';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applySecurityMiddleware,
  checkHostAllowed,
  isLoopbackBind,
  resolveAllowedHosts,
} from '../../../src/server/http.js';
import { logger } from '../../../src/server/logger.js';

function buildApp(
  allowedOrigins: string[],
  allowedHosts: string[] = [],
  bindHost = '',
  port = 0,
  publicHost?: string,
): express.Express {
  const app = express();
  app.set('trust proxy', 1);
  applySecurityMiddleware(app, allowedOrigins, allowedHosts, bindHost, port, publicHost);
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/.well-known/oauth-protected-resource/mcp', (_req, res) => {
    res.json({ resource: 'ok' });
  });
  app.post('/mcp', (_req, res) => {
    res.json({ jsonrpc: '2.0', result: 'ok', id: 1 });
  });
  return app;
}

async function rawHttpRequest(app: express.Express, requestText: string): Promise<string> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind to an IP socket');
    return await new Promise<string>((resolve, reject) => {
      const socket = connect(address.port, '127.0.0.1', () => {
        socket.end(requestText);
      });
      let response = '';
      socket.setEncoding('utf8');
      socket.on('data', (chunk) => {
        response += chunk;
      });
      socket.on('error', reject);
      socket.on('end', () => resolve(response));
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

describe('applySecurityMiddleware — helmet defaults', () => {
  it('sets HSTS, content-type, frame, and referrer headers on /health by default', async () => {
    const res = await request(buildApp([])).get('/health');
    expect(res.status).toBe(200);
    expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('does NOT set COOP — popup-based OAuth flows (Copilot Studio) break otherwise', async () => {
    // Microsoft Copilot Studio opens /authorize in a popup and uses window.open()
    // / postMessage to receive the redirect result. Any COOP value on /authorize
    // (including same-origin-allow-popups) puts the popup in a separate browsing
    // context group, severing the parent's window reference and surfacing as
    // "consent pop-up window has been closed unexpectedly". Helmet's stock
    // same-origin would also break this. We disable COOP entirely.
    const resHealth = await request(buildApp([])).get('/health');
    expect(resHealth.headers['cross-origin-opener-policy']).toBeUndefined();
    const resCors = await request(buildApp(['https://app.example.com'])).get('/health');
    expect(resCors.headers['cross-origin-opener-policy']).toBeUndefined();
  });

  it('sets CORP same-origin when CORS is disabled', async () => {
    const res = await request(buildApp([])).get('/health');
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
  });

  it('relaxes CORP to cross-origin when CORS is enabled', async () => {
    const res = await request(buildApp(['https://app.example.com'])).get('/health');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('keeps stock CSP directives when CORS is disabled (defaults)', async () => {
    const res = await request(buildApp([])).get('/health');
    const csp = res.headers['content-security-policy'] ?? '';
    // Helmet default CSP includes these — make sure we didn't accidentally drop them.
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain('upgrade-insecure-requests');
  });

  it('keeps stock CSP directives when CORS is enabled (useDefaults: true)', async () => {
    const res = await request(buildApp(['https://app.example.com'])).get('/health');
    const csp = res.headers['content-security-policy'] ?? '';
    // The CORS-mode CSP only overrides style-src — every other directive must
    // remain present. This is the regression guard for the original PR which
    // dropped these.
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain('upgrade-insecure-requests');
    // And style-src is the relaxed one.
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  });
});

describe('applySecurityMiddleware — CORS opt-in', () => {
  it('emits no Access-Control-Allow-Origin when allowlist is empty', async () => {
    const res = await request(buildApp([]))
      .options('/mcp')
      .set('Origin', 'https://app.example.com')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('reflects exact origin (not wildcard) when allowed and credentials=true', async () => {
    const res = await request(buildApp(['https://app.example.com']))
      .options('/mcp')
      .set('Origin', 'https://app.example.com')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,authorization');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('https://app.example.com');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-allow-methods']).toContain('POST');
    expect(res.headers.vary).toContain('Origin');
  });

  it('omits CORS headers for disallowed origins', async () => {
    const res = await request(buildApp(['https://app.example.com']))
      .options('/mcp')
      .set('Origin', 'https://evil.example.com')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('exposes mcp-session-id and accepts the documented request headers', async () => {
    const res = await request(buildApp(['https://app.example.com']))
      .options('/mcp')
      .set('Origin', 'https://app.example.com')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,authorization,mcp-session-id');
    expect(res.headers['access-control-allow-headers']?.toLowerCase()).toContain('mcp-session-id');
    expect(res.headers['access-control-expose-headers']?.toLowerCase()).toContain('mcp-session-id');
  });

  it('reflects only the exact origin from a multi-origin allowlist', async () => {
    const app = buildApp(['https://a.example.com', 'https://b.example.com']);
    const resA = await request(app)
      .options('/mcp')
      .set('Origin', 'https://a.example.com')
      .set('Access-Control-Request-Method', 'POST');
    const resB = await request(app)
      .options('/mcp')
      .set('Origin', 'https://b.example.com')
      .set('Access-Control-Request-Method', 'POST');
    const resC = await request(app)
      .options('/mcp')
      .set('Origin', 'https://c.example.com')
      .set('Access-Control-Request-Method', 'POST');
    expect(resA.headers['access-control-allow-origin']).toBe('https://a.example.com');
    expect(resB.headers['access-control-allow-origin']).toBe('https://b.example.com');
    expect(resC.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('applySecurityMiddleware — cors_rejected audit', () => {
  let emitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    emitSpy = vi.spyOn(logger, 'emitAudit').mockImplementation(() => {});
  });

  afterEach(() => {
    emitSpy.mockRestore();
  });

  it('emits cors_rejected for a disallowed origin on a real request', async () => {
    await request(buildApp(['https://app.example.com']))
      .post('/mcp')
      .set('Origin', 'https://evil.example.com')
      .send({ jsonrpc: '2.0', method: 'ping', id: 1 });
    const corsCalls = emitSpy.mock.calls
      .map((c: unknown[]) => c[0] as { event: string; origin?: string; method?: string; path?: string })
      .filter((e: { event: string }) => e.event === 'cors_rejected');
    expect(corsCalls.length).toBe(1);
    expect(corsCalls[0]).toMatchObject({
      event: 'cors_rejected',
      origin: 'https://evil.example.com',
      method: 'POST',
      path: '/mcp',
    });
  });

  it('does not emit cors_rejected for an allowed origin', async () => {
    await request(buildApp(['https://app.example.com']))
      .post('/mcp')
      .set('Origin', 'https://app.example.com')
      .send({ jsonrpc: '2.0', method: 'ping', id: 1 });
    const corsCalls = emitSpy.mock.calls
      .map((c: unknown[]) => c[0] as { event: string })
      .filter((e: { event: string }) => e.event === 'cors_rejected');
    expect(corsCalls.length).toBe(0);
  });

  it('does not emit cors_rejected when no Origin header is present', async () => {
    await request(buildApp(['https://app.example.com']))
      .post('/mcp')
      .send({ jsonrpc: '2.0', method: 'ping', id: 1 });
    const corsCalls = emitSpy.mock.calls
      .map((c: unknown[]) => c[0] as { event: string })
      .filter((e: { event: string }) => e.event === 'cors_rejected');
    expect(corsCalls.length).toBe(0);
  });
});

// ─── DNS-rebinding / Host-header validation (SEC-14) ──────────────────

describe('host validation — pure helpers', () => {
  it('isLoopbackBind: true only for loopback hosts; wildcard, unspecified, and routable hosts are false', () => {
    for (const h of ['localhost', '127.0.0.1', '127.0.0.2', '127.1.2.3', '::1', '[::1]', 'LOCALHOST']) {
      expect(isLoopbackBind(h)).toBe(true);
    }
    for (const h of ['', '0.0.0.0', '::', 'a4h.example.com', '10.0.0.5', '203.0.113.10']) {
      expect(isLoopbackBind(h)).toBe(false);
    }
  });

  it('resolveAllowedHosts: empty config auto-protects (loopback always; folds in publicHost); empty bind disables', () => {
    // Loopback and 0.0.0.0 binds alike get the loopback allowlist — a rebind attacker cannot forge a
    // loopback Host, so allowing them is safe and keeps localhost dev working on a wildcard bind.
    expect(resolveAllowedHosts([], '127.0.0.1', 8080)).toEqual(['localhost', '127.0.0.1', '::1']);
    expect(resolveAllowedHosts([], '0.0.0.0', 8080)).toEqual(['localhost', '127.0.0.1', '::1']);
    expect(resolveAllowedHosts([], '203.0.113.10', 8080)).toEqual(['localhost', '127.0.0.1', '::1']);
    // The advertised public host (ARC1_PUBLIC_URL / VCAP) is folded in — port-stripped — so
    // reverse-proxy / BTP deploys work with no extra config.
    expect(resolveAllowedHosts([], '0.0.0.0', 8080, 'mcp.example.com:443')).toEqual([
      'localhost',
      '127.0.0.1',
      '::1',
      'mcp.example.com',
    ]);
    // …and de-duped when it is already a loopback alias.
    expect(resolveAllowedHosts([], '127.0.0.1', 8080, 'localhost')).toEqual(['localhost', '127.0.0.1', '::1']);
    // Unspecified bind (unit/helper callers with no real listener) disables validation.
    expect(resolveAllowedHosts([], '', 8080)).toBeNull();
    expect(resolveAllowedHosts([], '', 8080, 'mcp.example.com')).toBeNull();
  });

  it('resolveAllowedHosts: explicit list canonicalizes host values; `*` disables', () => {
    expect(resolveAllowedHosts(['Mcp.Example.COM:443', 'host2.', '[::1]:8080'], '0.0.0.0', 8080)).toEqual([
      'mcp.example.com',
      'host2',
      '::1',
    ]);
    expect(resolveAllowedHosts(['*'], '127.0.0.1', 8080)).toBeNull();
    expect(resolveAllowedHosts(['a.com', '*'], '127.0.0.1', 8080)).toBeNull();
    expect(resolveAllowedHosts(['*.'], '127.0.0.1', 8080)).toEqual(['*']);
  });

  it('checkHostAllowed: normalizes port, brackets, case, and trailing dots before compare', () => {
    expect(checkHostAllowed('anything', null)).toBe(true);
    const list = ['localhost', '127.0.0.1', '::1'];
    expect(checkHostAllowed('localhost:8080', list)).toBe(true);
    expect(checkHostAllowed('[::1]:8080', list)).toBe(true);
    expect(checkHostAllowed('LOCALHOST', list)).toBe(true);
    expect(checkHostAllowed('localhost.', list)).toBe(true);
    expect(checkHostAllowed('evil.com', list)).toBe(false);
    expect(checkHostAllowed(undefined, list)).toBe(false);
    expect(checkHostAllowed('', list)).toBe(false);
  });
});

describe('applySecurityMiddleware — Host-header validation (SEC-14)', () => {
  let emitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    emitSpy = vi.spyOn(logger, 'emitAudit').mockImplementation(() => {});
  });

  afterEach(() => {
    emitSpy.mockRestore();
  });

  it('rejects a foreign Host on a loopback bind with 403 + JSON-RPC error + host_rejected audit', async () => {
    const res = await request(buildApp([], [], '127.0.0.1', 8080))
      .post('/mcp')
      .set('Host', 'evil.com')
      .set('Authorization', 'Bearer should-not-appear-in-host-rejected')
      .send({ password: 'should-not-appear-in-host-rejected' });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ jsonrpc: '2.0', error: { code: -32000 }, id: null });
    const hostCalls = emitSpy.mock.calls
      .map(
        (c: unknown[]) =>
          c[0] as {
            event: string;
            level?: string;
            host?: string;
            method?: string;
            path?: string;
            authorization?: string;
            requestBody?: unknown;
          },
      )
      .filter((e: { event: string }) => e.event === 'host_rejected');
    expect(hostCalls.length).toBe(1);
    expect(hostCalls[0]).toMatchObject({
      event: 'host_rejected',
      level: 'warn',
      host: 'evil.com',
      method: 'POST',
      path: '/mcp',
    });
    expect(hostCalls[0]).not.toHaveProperty('authorization');
    expect(hostCalls[0]).not.toHaveProperty('requestBody');
  });

  it('allows a matching loopback Host through to the route', async () => {
    const res = await request(buildApp([], [], '127.0.0.1', 8080))
      .post('/mcp')
      .set('Host', 'localhost:8080')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ result: 'ok' });
  });

  it('normalizes Host before middleware comparison', async () => {
    const app = buildApp([], ['host', '::1'], '0.0.0.0', 8080);
    for (const host of ['host:8080', '[::1]:8080', 'HOST', 'host.']) {
      const res = await request(app).post('/mcp').set('Host', host).send({});
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ result: 'ok' });
    }

    const rejected = await request(app).post('/mcp').set('Host', 'evil-host:8080').send({});
    expect(rejected.status).toBe(403);
  });

  it('ignores X-Forwarded-Host and Forwarded when deciding whether Host is allowed', async () => {
    const res = await request(buildApp([], [], '127.0.0.1', 8080))
      .post('/mcp')
      .set('Host', 'localhost:8080')
      .set('X-Forwarded-Host', 'evil.com')
      .set('Forwarded', 'host=evil.com')
      .send({});
    expect(res.status).toBe(200);
    const hostCalls = emitSpy.mock.calls
      .map((c: unknown[]) => c[0] as { event: string })
      .filter((e: { event: string }) => e.event === 'host_rejected');
    expect(hostCalls.length).toBe(0);
  });

  it('auto-protect on a wildcard bind: rejects a foreign Host, allows loopback and the derived public host', async () => {
    // The rebind payload (a foreign Host) is rejected even with no explicit config…
    const rebind = await request(buildApp([], [], '0.0.0.0', 8080))
      .post('/mcp')
      .set('Host', 'whatever.example.com')
      .send({});
    expect(rebind.status).toBe(403);
    // …but localhost still works for local dev on the default 0.0.0.0 bind (a rebind attacker cannot
    // forge a loopback Host). This would 403 under a naive deny-all fail-closed default.
    const dev = await request(buildApp([], [], '0.0.0.0', 8080))
      .post('/mcp')
      .set('Host', 'localhost:8080')
      .send({});
    expect(dev.status).toBe(200);
    // …and the advertised public host (ARC1_PUBLIC_URL / VCAP — e.g. the CF gorouter route) is
    // auto-allowed so reverse-proxy / BTP deploys work with no extra config.
    const proxied = await request(buildApp([], [], '0.0.0.0', 8080, 'mcp.example.com'))
      .post('/mcp')
      .set('Host', 'mcp.example.com')
      .send({});
    expect(proxied.status).toBe(200);
    // A foreign Host is still rejected when a public host is configured.
    const stillRejected = await request(buildApp([], [], '0.0.0.0', 8080, 'mcp.example.com'))
      .post('/mcp')
      .set('Host', 'evil.com')
      .send({});
    expect(stillRejected.status).toBe(403);
  });

  it('gates OAuth metadata and other routes, but exempts /health for infra probes', async () => {
    const app = buildApp([], [], '127.0.0.1', 8080);
    // /health is exempt — CF Diego / k8s httpGet liveness probes hit it directly on the bind address
    // with a non-loopback Host (k8s defaults the probe Host to the pod IP). Gating it would
    // crash-loop a healthy deploy; it returns only a static {status:ok} so there is nothing to protect.
    const health = await request(app).get('/health').set('Host', 'evil.com');
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ status: 'ok' });
    // Every other route (here the unauthenticated OAuth metadata endpoint) is still Host-gated.
    const metadata = await request(app).get('/.well-known/oauth-protected-resource/mcp').set('Host', 'evil.com');
    expect(metadata.status).toBe(403);
  });

  it('rejects absolute-form requests based on the real Host header', async () => {
    const response = await rawHttpRequest(
      buildApp([], [], '127.0.0.1', 8080),
      'GET http://evil.example/mcp HTTP/1.1\r\nHost: evil.com\r\nConnection: close\r\n\r\n',
    );
    expect(response).toContain('HTTP/1.1 403 Forbidden');
  });

  it('rejects bad Host before CORS can complete an allowed preflight', async () => {
    const res = await request(buildApp(['https://trusted.example'], [], '127.0.0.1', 8080))
      .options('/mcp')
      .set('Host', 'evil.com')
      .set('Origin', 'https://trusted.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.status).toBe(403);
    const hostCalls = emitSpy.mock.calls
      .map((c: unknown[]) => c[0] as { event: string })
      .filter((e: { event: string }) => e.event === 'host_rejected');
    expect(hostCalls.length).toBe(1);
  });

  it('explicit allowlist enforces even on a non-loopback bind; `*` disables', async () => {
    const enforced = await request(buildApp([], ['mcp.example.com'], '0.0.0.0', 8080))
      .post('/mcp')
      .set('Host', 'evil.com')
      .send({});
    expect(enforced.status).toBe(403);
    const disabled = await request(buildApp([], ['*'], '127.0.0.1', 8080))
      .post('/mcp')
      .set('Host', 'evil.com')
      .send({});
    expect(disabled.status).toBe(200);
  });
});
