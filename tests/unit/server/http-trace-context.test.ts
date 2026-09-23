/**
 * Inbound trace-context / agent capture at the HTTP edge.
 *
 * The validators are unit-tested in trace-context.test.ts; this covers the WIRING — that
 * `serveMcpRequest` actually opens a request context around the SDK transport, so a tool call
 * (and every SAP request beneath it) sees the caller's trace. Wiring mirrors production:
 * express.json() → createMcpHandler with a fresh Server per request.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { PingRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { getCurrentContext, type RequestContext } from '../../../src/server/context.js';
import { createMcpHandler } from '../../../src/server/http.js';

const ACCEPT = 'application/json, text/event-stream';
const TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

/**
 * Build an app whose `ping` handler snapshots the ambient request context — the same context an
 * ADT call would read via `traceHeaders(getCurrentContext())`.
 */
function buildApp(seen: RequestContext[]): express.Express {
  const app = express();
  app.use(express.json());
  app.all(
    '/mcp',
    createMcpHandler(() => {
      const server = new Server({ name: 'trace-test', version: '0.0.0' }, { capabilities: {} });
      server.setRequestHandler(PingRequestSchema, async () => {
        const ctx = getCurrentContext();
        if (ctx) seen.push({ ...ctx });
        return {};
      });
      return server;
    }),
  );
  return app;
}

async function ping(app: express.Express, headers: Record<string, string>) {
  let req = request(app).post('/mcp').set('Accept', ACCEPT);
  for (const [name, value] of Object.entries(headers)) req = req.set(name, value);
  return req.send({ jsonrpc: '2.0', id: 1, method: 'ping' });
}

describe('HTTP edge: trace context and agent capture', () => {
  it('exposes a valid traceparent and tracestate to the handler', async () => {
    const seen: RequestContext[] = [];
    const res = await ping(buildApp(seen), { traceparent: TRACEPARENT, tracestate: 'rojo=1' });

    expect(res.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0].traceparent).toBe(TRACEPARENT);
    expect(seen[0].tracestate).toBe('rojo=1');
  });

  it('drops a malformed traceparent instead of forwarding it', async () => {
    const seen: RequestContext[] = [];
    await ping(buildApp(seen), { traceparent: '00-not-a-trace-id-01' });

    expect(seen[0].traceparent).toBeUndefined();
  });

  it('drops tracestate when traceparent is invalid (spec: MUST NOT travel alone)', async () => {
    const seen: RequestContext[] = [];
    await ping(buildApp(seen), { traceparent: 'garbage', tracestate: 'rojo=1' });

    expect(seen[0].traceparent).toBeUndefined();
    expect(seen[0].tracestate).toBeUndefined();
  });

  it('captures the User-Agent as the calling agent', async () => {
    const seen: RequestContext[] = [];
    await ping(buildApp(seen), { 'User-Agent': 'cursor/0.44.1' });

    expect(seen[0].clientAgent).toBe('cursor/0.44.1');
  });

  it('always opens a context with a requestId, even with no trace headers', async () => {
    const seen: RequestContext[] = [];
    await ping(buildApp(seen), {});

    expect(seen[0].requestId).toMatch(/^REQ-\d+$/);
    expect(seen[0].traceparent).toBeUndefined();
  });
});
