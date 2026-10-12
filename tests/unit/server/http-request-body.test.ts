import { EventEmitter } from 'node:events';
import { request as httpRequest } from 'node:http';
import { gzipSync } from 'node:zlib';
import express from 'express';
import request from 'supertest';
import { afterEach, expect, it, vi } from 'vitest';
import { resolveConfig } from '../../../src/server/config.js';
import { startHttpServer } from '../../../src/server/http.js';
import { createHttpJsonParser } from '../../../src/server/http-request-body.js';
import { DEFAULT_CONFIG, MAX_HTTP_REQUEST_BYTES } from '../../../src/server/types.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
const payload = (bytes: number) => JSON.stringify({ source: 'a'.repeat(bytes - 13) });
function appWithLimit(limit: number) {
  const app = express();
  app.use(createHttpJsonParser(limit));
  app.use((_req, res) => res.sendStatus(200));
  return app;
}

it('resolves a bounded integer with CLI precedence and source tracing', () => {
  vi.stubEnv('ARC1_MAX_HTTP_REQUEST_BYTES', undefined);
  expect(resolveConfig([]).config.maxHttpRequestBytes).toBe(102400);
  vi.stubEnv('ARC1_MAX_HTTP_REQUEST_BYTES', '262144');
  expect(resolveConfig([]).sources.maxHttpRequestBytes).toEqual({ env: 'ARC1_MAX_HTTP_REQUEST_BYTES' });
  const result = resolveConfig(['--max-http-request-bytes', '131072']);
  expect(result.config.maxHttpRequestBytes).toBe(131072);
  expect(result.sources.maxHttpRequestBytes).toEqual({ flag: '--max-http-request-bytes' });
});

it.each(['0', '-1', '1.5', '1mb', 'NaN', '16777217'])('rejects invalid configured size %s', (value) => {
  vi.stubEnv('ARC1_MAX_HTTP_REQUEST_BYTES', value);
  expect(() => resolveConfig([])).toThrow();
});

it.each(['/mcp', '/MCP///', '/multi/mcp', '/A4H/001/mcp', '/authorize', '/AUTHORIZE/'])(
  'enforces exact byte boundaries on %s',
  async (path) => {
    const app = appWithLimit(128 * 1024);
    await request(app)
      .post(path)
      .type('json')
      .send(payload(128 * 1024))
      .expect(200);
    const denied = await request(app)
      .post(path)
      .type('json')
      .send(payload(128 * 1024 + 1))
      .expect(413);
    expect(denied.body).toMatchObject({ error: 'HTTP_REQUEST_TOO_LARGE', limitBytes: 131072 });
  },
);

it('counts UTF-8 bytes, not JavaScript characters', async () => {
  const body = JSON.stringify({ source: 'ä'.repeat(100) });
  const app = appWithLimit(Buffer.byteLength(body) - 1);
  await request(app).post('/mcp').type('json').send(body).expect(413);
});

it('rejects an oversized chunked body without a Content-Length header', async () => {
  const server = appWithLimit(1024).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: (server.address() as { port: number }).port,
          path: '/mcp',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        },
      );
      req.on('error', reject);
      req.write(payload(1025));
      req.end();
    });
    expect(status).toBe(413);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('keeps non-MCP JSON at 100 KiB', async () => {
  await request(appWithLimit(MAX_HTTP_REQUEST_BYTES)).post('/register').type('json').send(payload(102401)).expect(413);
});

it('bounds decompressed bytes and releases failed parse reservations', async () => {
  const app = appWithLimit(1024);
  const compressed = gzipSync(payload(1025));
  await request(app)
    .post('/mcp')
    .type('json')
    .set('Content-Encoding', 'gzip')
    .serialize((value) => value)
    .send(compressed)
    .expect(413);
  const invalid = await request(app).post('/mcp').type('json').send('{"private":"secret"').expect(400);
  expect(JSON.stringify(invalid.body)).not.toContain('secret');
  await request(app).post('/mcp').type('json').send('{}').expect(200);
});

it.each([8 * 1024 * 1024, MAX_HTTP_REQUEST_BYTES])(
  'accounts for declared bytes (%i), leaving small requests available',
  async (bytes) => {
    const app = express();
    app.use(createHttpJsonParser(MAX_HTTP_REQUEST_BYTES));
    const finish: Array<() => void> = [];
    app.use((req, res) => {
      if (req.query.hold) finish.push(() => res.sendStatus(200));
      else res.sendStatus(200);
    });
    const held = Array.from({ length: (32 * 1024 * 1024) / bytes }, () =>
      request(app)
        .post('/mcp?hold=1')
        .type('json')
        .send(payload(bytes))
        .then((r) => r),
    );
    try {
      await vi.waitFor(() => expect(finish).toHaveLength(held.length));
      await request(app).post('/mcp').type('json').send(payload(102401)).expect(503).expect('Retry-After', '1');
      await request(app).post('/mcp').type('json').send(payload(102400)).expect(200);
      await request(app).get('/health').expect(200);
    } finally {
      for (const end of finish) end();
      await Promise.all(held);
    }
    await request(app).post('/mcp').type('json').send(payload(bytes)).expect(200);
  },
);

it('releases disconnected chunked requests', async () => {
  const app = appWithLimit(MAX_HTTP_REQUEST_BYTES);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const port = (server.address() as { port: number }).port;
  const open = () => {
    const req = httpRequest({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: '/mcp',
      headers: { 'Content-Type': 'application/json' },
    });
    req.on('error', () => {}); // Expected socket closure on the deliberate client abort.
    req.write('{');
    return req;
  };
  const first = open();
  const second = open();
  try {
    await vi.waitFor(async () => {
      expect((await request(server).post('/mcp').type('json').send(payload(102401))).status).toBe(503);
    });
    await request(server).post('/mcp').type('json').send('{}').expect(200);
    first.destroy();
    second.destroy();
    await vi.waitFor(async () => {
      expect((await request(server).post('/mcp').type('json').send(payload(102401))).status).toBe(200);
    });
  } finally {
    first.destroy();
    second.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('wires the limit into the real HTTP server while retaining bearer authentication', async () => {
  let app!: express.Express;
  vi.spyOn(express.application, 'listen').mockImplementation(function (this: express.Express) {
    app = this;
    return new EventEmitter() as never;
  });
  await startHttpServer((() => ({ connect: vi.fn() })) as never, {
    ...DEFAULT_CONFIG,
    maxHttpRequestBytes: 131072,
    apiKeys: [{ key: 'test-only', profile: 'viewer' }],
    authRateLimit: 0,
    mcpHttpRateLimit: 0,
  });
  await request(app).post('/mcp').type('json').send(payload(102401)).expect(401);
  await request(app).post('/mcp').type('json').send(payload(131073)).expect(413);
});

it('releases large reservations after encoded-body failures', async () => {
  const app = appWithLimit(MAX_HTTP_REQUEST_BYTES);
  for (let i = 0; i < 3; i++) {
    await request(app)
      .post('/mcp')
      .type('json')
      .set('Content-Encoding', 'gzip')
      .serialize((value) => value)
      .send(gzipSync('{"private":"secret"'))
      .expect(400);
  }
  await request(app).post('/mcp').type('json').send(payload(MAX_HTTP_REQUEST_BYTES)).expect(200);
});

it('releases a reservation when the client leaves during dispatch', async () => {
  const app = express();
  app.use(createHttpJsonParser(MAX_HTTP_REQUEST_BYTES));
  let pending = 0;
  app.use((req, res) => {
    if (req.query.hold)
      pending++; // Body parsed; the handler waits without sending a response.
    else res.sendStatus(200);
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const port = (server.address() as { port: number }).port;
  const clients = [0, 1].map(() => {
    const req = httpRequest({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: '/mcp?hold=1',
      headers: { 'Content-Type': 'application/json', 'Content-Length': MAX_HTTP_REQUEST_BYTES },
    });
    req.on('error', () => {}); // Expected socket closure on the deliberate client abort.
    req.end(payload(MAX_HTTP_REQUEST_BYTES));
    return req;
  });
  try {
    await vi.waitFor(() => expect(pending).toBe(2));
    await request(server).post('/mcp').type('json').send(payload(102401)).expect(503);
    for (const client of clients) client.destroy();
    await vi.waitFor(async () => {
      expect((await request(server).post('/mcp').type('json').send(payload(102401))).status).toBe(200);
    });
  } finally {
    for (const client of clients) client.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
