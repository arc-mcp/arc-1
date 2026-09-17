import { createServer, type RequestListener, type Server } from 'node:http';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { Client } from 'undici';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectivityProxyResponse } from '../../../src/adt/bounded-response.js';
import { AdtClient } from '../../../src/adt/client.js';
import { DataResponseBudget } from '../../../src/adt/data-result-context.js';
import { AdtHttpClient } from '../../../src/adt/http.js';
import { CachingLayer } from '../../../src/cache/caching-layer.js';
import { MemoryCache } from '../../../src/cache/memory.js';

const servers: Server[] = [];
const rawClients: Client[] = [];

afterEach(async () => {
  await Promise.all(rawClients.splice(0).map((client) => client.destroy()));
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
  vi.restoreAllMocks();
});

async function setup(listener: RequestListener) {
  const server = createServer(listener);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
  const config = {
    baseUrl: 'http://sap.invalid:8000',
    btpProxy: {
      protocol: 'http' as const,
      host: '127.0.0.1',
      port: address.port,
      getProxyToken: async () => 'local-test-token',
    },
  };
  return { server, config, client: new AdtHttpClient(config), origin: `http://127.0.0.1:${address.port}` };
}

async function expectConnectionsClosed(server: Server) {
  // BodyReadable can emit its teardown error after the adapter has already returned.
  // Leave these errors unhandled by the test so Vitest fails if the adapter misses one.
  await nextTurn();
  await nextTurn();
  await vi.waitFor(async () => {
    const count = await new Promise<number>((resolve, reject) =>
      server.getConnections((error, total) => (error ? reject(error) : resolve(total))),
    );
    expect(count).toBe(0);
  });
}

describe('proxy response lifecycle with real Undici bodies', () => {
  describe.each([false, true])('bounded=%s', (bounded) => {
    it.each([204, 205, 304])('returns HTTP %i with empty body and preserved headers', async (status) => {
      const { server, client } = await setup((_req, res) => {
        res.writeHead(status, { etag: 'test-etag' });
        res.end();
      });
      const budget = new DataResponseBudget(1);
      const response = await client.get('/resource', undefined, bounded ? { responseBudget: budget } : undefined);
      expect(response).toMatchObject({ statusCode: status, body: '', headers: { etag: 'test-etag' } });
      expect(budget.consumedBytes).toBe(0);
      expect(budget.reservedBytes).toBe(0);
      await expectConnectionsClosed(server);
    });
  });

  it('revalidates cached source through the actual proxy adapter and keeps serving', async () => {
    const validators: Array<string | undefined> = [];
    const { server, config } = await setup((req, res) => {
      const validator = req.headers['if-none-match'];
      validators.push(validator);
      res.setHeader('etag', 'source-etag');
      if (validator === 'source-etag') {
        res.writeHead(304);
        res.end();
      } else {
        res.end('REPORT ztest.');
      }
    });
    const client = new AdtClient(config);
    const cache = new CachingLayer(new MemoryCache());
    const read = () => cache.getSource('PROG', 'ZTEST', (ifNoneMatch) => client.getProgram('ZTEST', { ifNoneMatch }));
    expect(await read()).toEqual({ source: 'REPORT ztest.', hit: false, revalidated: false });
    for (let i = 0; i < 3; i++) {
      expect(await read()).toEqual({ source: 'REPORT ztest.', hit: true, revalidated: true });
      await expectConnectionsClosed(server);
    }
    expect(validators).toEqual([undefined, 'source-etag', 'source-etag', 'source-etag']);
  });

  it('discards an unfinished 205 response without waiting for its body', async () => {
    const { server, client } = await setup((_req, res) => {
      res.writeHead(205);
      res.flushHeaders();
    });
    const response = await client.get('/unfinished', undefined, { fetchTimeoutMs: 5000 });
    expect(response).toMatchObject({ statusCode: 205, body: '' });
    await expectConnectionsClosed(server);
  }, 2000);

  it('discards a completed headers-only response and retains its control headers', async () => {
    const { server, client } = await setup((_req, res) => {
      res.writeHead(200, { 'x-csrf-token': 'TEST' });
      res.end('unneeded discovery body');
    });
    const response = await client.get('/control', undefined, { discardResponseBody: true, fetchTimeoutMs: 5000 });
    expect(response).toMatchObject({ statusCode: 200, body: '', headers: { 'x-csrf-token': 'TEST' } });
    await expectConnectionsClosed(server);
  }, 2000);

  it('returns the encoding error and closes a completed unread response', async () => {
    const { server, client } = await setup((_req, res) => {
      res.writeHead(200, { 'content-encoding': 'gzip' });
      res.end('compressed');
    });
    await expect(
      client.get('/encoded', undefined, { responseBudget: new DataResponseBudget(10), fetchTimeoutMs: 5000 }),
    ).rejects.toMatchObject({
      name: 'AdtNetworkError',
      message: expect.stringContaining("Unexpected Content-Encoding 'gzip'"),
    });
    await expectConnectionsClosed(server);
  }, 2000);

  it('handles cancellation before the streaming adapter starts its first read', async () => {
    const { server, origin } = await setup((_req, res) => res.end('body'));
    const client = new Client(origin);
    rawClients.push(client);
    const destroy = vi.spyOn(client, 'destroy');
    const close = vi.spyOn(client, 'close');
    const raw = await client.request({ path: '/', method: 'GET' });
    const reason = new Error('cancelled before first read');
    const response = await connectivityProxyResponse(raw, client, AbortSignal.abort(reason), true);
    await expect(response.text()).rejects.toBe(reason);
    await expectConnectionsClosed(server);
    expect(destroy).toHaveBeenCalledWith(reason);
    expect(client.destroyed).toBe(true);
    expect(close).not.toHaveBeenCalled();
  });
});
