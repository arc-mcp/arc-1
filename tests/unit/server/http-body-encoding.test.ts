import { EventEmitter } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createRequire } from 'node:module';
import type { XsuaaCredentials } from '@arc-mcp/xsuaa-auth';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { startHttpServer } from '../../../src/server/http.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

// body-parser uses the mutable CommonJS builtin object; observing an ESM namespace misses it.
const zlib = createRequire(import.meta.url)('node:zlib') as typeof import('node:zlib');
const codecs = [
  { encoding: 'gzip', compress: zlib.gzipSync, factory: 'createGunzip' },
  { encoding: 'deflate', compress: zlib.deflateSync, factory: 'createInflate' },
  { encoding: 'br', compress: zlib.brotliCompressSync, factory: 'createBrotliDecompress' },
  { encoding: 'zstd', compress: zlib.zstdCompressSync, factory: 'createZstdDecompress' },
] as const;
const types = ['application/json', 'application/x-www-form-urlencoded'] as const;
const bodyFor = (type: string) => (type === 'application/json' ? '{"private":"test-value"}' : 'private=test-value');

function observeDecoders() {
  return codecs.map(({ factory }) => vi.spyOn(zlib, factory));
}

async function serverApp(xsuaa: boolean) {
  let app!: express.Express;
  const listen = vi.spyOn(express.application, 'listen').mockImplementation(function (this: express.Express) {
    app = this;
    return new EventEmitter() as never;
  });
  try {
    await startHttpServer(
      () => new Server({ name: 'encoding-test', version: '1' }, { capabilities: {} }),
      {
        ...DEFAULT_CONFIG,
        httpAddr: '127.0.0.1:0',
        xsuaaAuth: xsuaa,
        apiKeys: [{ key: 'encoding-test-key', profile: 'viewer' }],
        authRateLimit: 0,
        mcpHttpRateLimit: 0,
      },
      xsuaa
        ? ({
            url: 'https://tenant.authentication.example.test',
            clientid: 'encoding-test',
            clientsecret: 'test-only-secret-with-enough-entropy',
            xsappname: 'encoding-test!t1',
            uaadomain: 'authentication.example.test',
          } satisfies XsuaaCredentials)
        : undefined,
    );
  } finally {
    listen.mockRestore();
  }
  return app;
}

afterEach(() => vi.restoreAllMocks());

it.each(codecs)(
  'observes the real $encoding decoder in inflation-enabled controls',
  async ({ encoding, compress, factory }) => {
    for (const type of types) {
      const calls = observeDecoders();
      const app = express();
      app.use(express.json({ inflate: true }), express.urlencoded({ extended: false, inflate: true }));
      app.use((_req, res) => res.sendStatus(200));
      await request(app)
        .post('/control')
        .set('Content-Type', type)
        .set('Content-Encoding', encoding)
        .serialize((value) => value)
        .send(compress(Buffer.from(bodyFor(type))))
        .expect(200);
      expect(calls[codecs.findIndex((codec) => codec.factory === factory)]).toHaveBeenCalledTimes(1);
      vi.restoreAllMocks();
    }
  },
);

describe.each([false, true])('real HTTP stack (XSUAA=%s)', (xsuaa) => {
  let app: express.Express;
  beforeAll(async () => {
    app = await serverApp(xsuaa);
  });

  it.each(codecs)(
    'rejects $encoding JSON and forms across public and MCP paths before decoding',
    async ({ encoding, compress }) => {
      const calls = observeDecoders();
      for (const type of types) {
        for (const path of [
          '/mcp',
          '/MCP///',
          '/A4H/001/mcp',
          '/A4H-2025/001/mcp',
          '/multi/mcp',
          '/authorize',
          '/AUTHORIZE/',
          '/token',
          '/register',
          '/revoke',
          '/unknown',
        ]) {
          const response = await request(app)
            .post(path)
            .set('Content-Type', type)
            .set('Content-Encoding', encoding)
            .serialize((value) => value)
            .send(compress(Buffer.from(bodyFor(type))))
            .expect(415);
          expect(response.body).toEqual({
            error: 'UNSUPPORTED_CONTENT_ENCODING',
            message: 'Send an uncompressed request body.',
          });
          expect(response.headers['accept-encoding']).toBe('identity');
        }
      }
      for (const call of calls) expect(call).not.toHaveBeenCalled();
    },
  );

  it.each(['GZip', 'BR', 'x-gzip', 'gzip, br', 'unknown'])(
    'rejects unsupported coding %s without decoding',
    async (encoding) => {
      const calls = observeDecoders();
      for (const type of types) {
        await request(app)
          .post('/mcp')
          .set('Content-Type', type)
          .set('Content-Encoding', encoding)
          .set('Authorization', 'Bearer encoding-test-key')
          .serialize((value) => value)
          .send(Buffer.from('not compressed; private=test-value'))
          .expect(415);
      }
      for (const call of calls) expect(call).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, '', 'identity', 'IDENTITY'])(
    'keeps plain JSON authentication with coding %s',
    async (encoding) => {
      const response = request(app).post('/mcp').type('json');
      if (encoding !== undefined) response.set('Content-Encoding', encoding);
      await response.send('{}').expect(401);
    },
  );

  it('does not mislabel an unsupported JSON charset as compression', async () => {
    const calls = observeDecoders();
    const response = await request(app)
      .post('/mcp')
      .set('Content-Type', 'application/json; charset=latin1')
      .set('Content-Encoding', 'gzip')
      .serialize((value) => value)
      .send(Buffer.from('{}'))
      .expect(415);
    expect(response.body.error).toBe('INVALID_JSON_REQUEST');
    expect(response.headers['accept-encoding']).toBeUndefined();
    for (const call of calls) expect(call).not.toHaveBeenCalled();
  });

  it('rejects encoded zero-length JSON, but leaves unmatched MIME types undecoded', async () => {
    const calls = observeDecoders();
    await request(app).post('/mcp').type('json').set('Content-Encoding', 'gzip').set('Content-Length', '0').expect(415);
    await request(app).post('/mcp').type('text').set('Content-Encoding', 'br').send('plain').expect(401);
    for (const call of calls) expect(call).not.toHaveBeenCalled();
  });

  it('keeps plain JSON errors and fixed form size limits private', async () => {
    const invalid = await request(app).post('/mcp').type('json').send('{"private":"test-value"').expect(400);
    expect(invalid.body.error).toBe('INVALID_JSON_REQUEST');
    const large = await request(app)
      .post('/token')
      .type('form')
      .send({ private: 'x'.repeat(102400) })
      .expect(413);
    expect(large.body.error).toBe('HTTP_REQUEST_TOO_LARGE');
    expect(JSON.stringify([invalid.body, large.body])).not.toMatch(/test-value|stack|ARC1_MAX_HTTP_REQUEST_BYTES/);
  });

  it('keeps supported JSON charsets and truly bodyless requests undecoded', async () => {
    const calls = observeDecoders();
    await request(app)
      .post('/mcp')
      .set('Content-Type', 'application/json; charset=utf-16le')
      .serialize((value) => value)
      .send(Buffer.from('{}', 'utf16le'))
      .expect(401);
    await request(app).get('/mcp').type('json').set('Content-Encoding', 'br').expect(401);
    for (const call of calls) expect(call).not.toHaveBeenCalled();
  });

  it('rejects compressed data before the plain size limit and keeps form parameter errors private', async () => {
    const calls = observeDecoders();
    for (const type of types) {
      await request(app)
        .post('/mcp')
        .set('Content-Type', type)
        .set('Content-Encoding', 'gzip')
        .serialize((value) => value)
        .send(Buffer.alloc(102401))
        .expect(415);
    }
    const parameters = await request(app).post('/token').type('form').send('x=1&'.repeat(1001)).expect(413);
    expect(parameters.body).toEqual({
      error: 'HTTP_REQUEST_TOO_LARGE',
      message: 'Invalid or oversized form request body.',
    });
    for (const call of calls) expect(call).not.toHaveBeenCalled();
  });

  it('does not decode transfer codings or duplicate content codings', async () => {
    const calls = observeDecoders();
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    try {
      for (const headers of [{ 'Transfer-Encoding': 'gzip, chunked' }, { 'Content-Encoding': ['gzip', 'br'] }]) {
        const status = await new Promise<number | undefined>((resolve, reject) => {
          const req = httpRequest(
            {
              host: '127.0.0.1',
              port: (server.address() as { port: number }).port,
              method: 'POST',
              path: '/mcp',
              headers: { 'Content-Type': 'application/json', ...headers },
            },
            (res) => {
              res.resume();
              res.on('end', () => resolve(res.statusCode));
            },
          );
          req.on('error', reject);
          req.write(zlib.gzipSync('{}'));
          req.end();
        });
        expect(status).toBe('Content-Encoding' in headers ? 415 : 400);
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    for (const call of calls) expect(call).not.toHaveBeenCalled();
  });
});
