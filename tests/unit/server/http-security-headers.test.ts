import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applySecurityMiddleware } from '../../../src/server/http.js';
import { logger } from '../../../src/server/logger.js';

function buildApp(allowedOrigins: string[]): express.Express {
  const app = express();
  app.set('trust proxy', 1);
  applySecurityMiddleware(app, allowedOrigins);
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.post('/mcp', (_req, res) => {
    res.json({ jsonrpc: '2.0', result: 'ok', id: 1 });
  });
  return app;
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

  it('T4: allows the MCP protocol headers in preflight (mcp-protocol-version, last-event-id)', async () => {
    // Every SDK-based client sends MCP-Protocol-Version on post-initialize requests
    // (spec 2025-06-18+) and last-event-id on SSE reconnects; both are preflighted.
    // Preflight is answered by the cors middleware BEFORE auth — no token needed.
    // mcp-method is deliberately INCLUDED in the request: if the explicit allowedHeaders
    // list is ever removed, the cors middleware falls back to reflecting requested
    // headers verbatim — the negative assertion below catches that regression.
    const res = await request(buildApp(['https://app.example.com']))
      .options('/mcp')
      .set('Origin', 'https://app.example.com')
      .set('Access-Control-Request-Method', 'POST')
      .set(
        'Access-Control-Request-Headers',
        'content-type,authorization,mcp-protocol-version,last-event-id,mcp-method',
      );
    expect(res.status).toBe(204);
    const allowed = res.headers['access-control-allow-headers']?.toLowerCase() ?? '';
    expect(allowed).toContain('mcp-protocol-version');
    expect(allowed).toContain('last-event-id');
    // 2026-07-28 modern-era headers stay deliberately absent (ADR-0006).
    expect(allowed).not.toContain('mcp-method');
    expect(allowed).not.toContain('mcp-name');
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
