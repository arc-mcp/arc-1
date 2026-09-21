/**
 * MCP era-contract regression tests (ADR-0006).
 *
 * ARC-1 deliberately stays legacy-era (protocol ≤ 2025-11-25, TS SDK v1). The entire
 * "2026-07-28 clients keep working" posture rests on SDK transport behaviors, not ARC-1
 * code — these tests freeze them so a future dependency bump (e.g. an SDK 1.29.x carrying
 * the unreleased #2444 Content-Type rework) turns a silent contract change into a CI failure:
 *
 *  - T1: unknown MCP-Protocol-Version → 400 + JSON-RPC -32000. This is the exact legacy-server
 *    discriminator dual-era (2026-07-28) clients use to fall back to `initialize` — the modern
 *    error codes are -32020..-32022, so -32000 means "legacy server" to them.
 *  - T2: absent MCP-Protocol-Version header on a non-initialize request → accepted (spec:
 *    assume 2025-03-26). Clients that omit the header (observed in the wild: VS Code
 *    pre-negotiation) must not be rejected.
 *  - T3: initialize proposing 2025-11-25 → answered 2025-11-25 (what VS Code 1.107+/Claude send);
 *    T3b: unknown body-level proposal (2026-07-28) → 200 counter-offer, not rejection.
 *  - T4 (CORS preflight allow-list) lives in http-security-headers.test.ts.
 *  - T5: Content-Type with charset parameter → accepted (the shape .NET/Power Platform stacks
 *    send — Copilot Studio depends on this).
 *  - T6: Accept without text/event-stream → 406 -32000 (the dual-Accept requirement clients
 *    must satisfy; a silent relaxation/tightening would change client behavior).
 *  - T7: stateless GET → SSE stream, DELETE → 200 (VS Code SSE-fallback probe / Copilot Studio
 *    session teardown).
 *
 * Wiring mirrors production: express.json() then createMcpHandler with a fresh Server per
 * request (src/server/http.ts). bearerAuth is intentionally out of scope — auth is orthogonal
 * to the era discriminator, which lives in StreamableHTTPServerTransport.
 */
import { createServer, type Server as NodeHttpServer } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import express from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createMcpHandler } from '../../../src/server/http.js';

const ACCEPT = 'application/json, text/event-stream';

function serverFactory(): Server {
  return new Server({ name: 'era-contract-test', version: '0.0.0' }, { capabilities: { tools: {} } });
}

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.all('/mcp', createMcpHandler(serverFactory));
  return app;
}

function initializeBody(protocolVersion: string) {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion, capabilities: {}, clientInfo: { name: 'era-probe', version: '0.0.0' } },
  };
}

/** The initialize result arrives as an SSE frame (`event: message\ndata: {...}`); parse the data line. */
function parseSseResult(text: string): { protocolVersion?: string } {
  const dataLine = text.split('\n').find((l) => l.startsWith('data: '));
  expect(dataLine, `no SSE data line in response: ${text.slice(0, 200)}`).toBeDefined();
  return JSON.parse((dataLine as string).slice('data: '.length)).result;
}

describe('MCP era contract (ADR-0006) — legacy-server discriminator', () => {
  it('T1: unknown MCP-Protocol-Version (2026-07-28) → 400 + JSON-RPC -32000, NOT a modern error code', async () => {
    const res = await request(buildApp())
      .post('/mcp')
      .set('Accept', ACCEPT)
      .set('MCP-Protocol-Version', '2026-07-28')
      .send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(-32000);
    expect(res.body.error.message).toContain('Unsupported protocol version');
    // Dual-era clients classify -32000 as "legacy server" and fall back to initialize;
    // -32020..-32022 would signal a modern server and BREAK the fallback.
  });

  it('T2: absent MCP-Protocol-Version header on a NON-initialize request is accepted (spec: assume 2025-03-26)', async () => {
    // Must be a non-initialize request — the SDK only runs validateProtocolVersion on
    // that branch, so an initialize probe would freeze nothing. ping is auto-handled
    // by the SDK Protocol core, no tool handlers needed.
    const res = await request(buildApp())
      .post('/mcp')
      .set('Accept', ACCEPT)
      .send({ jsonrpc: '2.0', id: 3, method: 'ping' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('"result"');
  });

  it('T2b: initialize echoes a supported proposed version (2025-03-26)', async () => {
    const res = await request(buildApp()).post('/mcp').set('Accept', ACCEPT).send(initializeBody('2025-03-26'));
    expect(res.status).toBe(200);
    expect(parseSseResult(res.text).protocolVersion).toBe('2025-03-26');
  });

  it('T3: initialize proposing 2025-11-25 is answered with 2025-11-25 (current stable revision)', async () => {
    const res = await request(buildApp()).post('/mcp').set('Accept', ACCEPT).send(initializeBody('2025-11-25'));
    expect(res.status).toBe(200);
    expect(parseSseResult(res.text).protocolVersion).toBe('2025-11-25');
  });

  it('T3b: initialize proposing UNKNOWN 2026-07-28 in the body gets a 200 counter-offer of 2025-11-25', async () => {
    // Body-level negotiation safety net: initialize skips header validation, and the
    // server counter-offers its latest supported version for any unknown proposal.
    // A 400 here, or an echo of 2026-07-28, would both signal an era change.
    const res = await request(buildApp()).post('/mcp').set('Accept', ACCEPT).send(initializeBody('2026-07-28'));
    expect(res.status).toBe(200);
    expect(parseSseResult(res.text).protocolVersion).toBe('2025-11-25');
  });

  it('T3c: notifications/initialized (sent by every client post-initialize) → 202', async () => {
    const res = await request(buildApp())
      .post('/mcp')
      .set('Accept', ACCEPT)
      .send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(res.status).toBe(202);
  });

  it('T5: Content-Type with charset parameter is accepted (Copilot Studio / .NET stacks)', async () => {
    const res = await request(buildApp())
      .post('/mcp')
      .set('Accept', ACCEPT)
      .set('Content-Type', 'application/json; charset=utf-8')
      .send(JSON.stringify(initializeBody('2025-03-26')));
    expect(res.status).toBe(200);
    expect(parseSseResult(res.text).protocolVersion).toBe('2025-03-26');
  });

  it('T6: Accept without text/event-stream → 406 + JSON-RPC -32000', async () => {
    const res = await request(buildApp())
      .post('/mcp')
      .set('Accept', 'application/json')
      .send(initializeBody('2025-03-26'));
    expect(res.status).toBe(406);
    expect(res.body.error.code).toBe(-32000);
  });
});

describe('MCP era contract (ADR-0006) — stateless GET/DELETE', () => {
  let httpServer: NodeHttpServer | undefined;

  afterAll(() => {
    httpServer?.close();
  });

  it('T7a: GET /mcp opens an SSE stream (VS Code SSE-fallback probe must not 4xx/5xx)', async () => {
    // The stream stays open, so supertest's await would hang — use a raw request
    // against a real listener and inspect only the response head.
    httpServer = createServer(buildApp());
    await new Promise<void>((resolve) => {
      (httpServer as NodeHttpServer).listen(0, '127.0.0.1', resolve);
    });
    const address = httpServer.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      headers: { Accept: 'text/event-stream' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    await res.body?.cancel();
  });

  it('T7b: DELETE /mcp responds 200 in stateless mode (Copilot Studio session teardown)', async () => {
    const res = await request(buildApp()).delete('/mcp');
    expect(res.status).toBe(200);
  });
});
