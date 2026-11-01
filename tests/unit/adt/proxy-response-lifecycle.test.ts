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
import { logger } from '../../../src/server/logger.js';

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

describe('stateful Connectivity proxy ownership', () => {
  it('reuses the lock connection through write, unlock and SAP context cleanup', async () => {
    const requests: Array<{ path: string; socket: unknown; headers: Record<string, unknown> }> = [];
    const { server, client } = await setup((req, res) => {
      const path = new URL(req.url!).pathname;
      requests.push({ path, socket: req.socket, headers: req.headers });
      if (req.method === 'HEAD') {
        res.setHeader('x-csrf-token', 'T');
        res.setHeader('set-cookie', 'sap-contextid=CONTEXT; Path=/');
      }
      res.end('ok');
    });

    expect(
      await client.withStatefulSession(async (session) => {
        await session.post('/lock');
        await session.put('/source', 'REPORT ztest.');
        await session.post('/unlock');
        return 'written';
      }),
    ).toBe('written');

    expect(requests.map(({ path }) => path)).toEqual([
      '/sap/bc/adt/core/discovery',
      '/lock',
      '/source',
      '/unlock',
      '/sap/bc/adt/core/http/sessions',
    ]);
    // SAP can open the context during CSRF HEAD, whose connection may close before LOCK.
    expect(new Set(requests.slice(1).map(({ socket }) => socket)).size).toBe(1);
    for (const request of requests.slice(1, 4)) {
      expect(request.headers).toMatchObject({ cookie: 'sap-contextid=CONTEXT', 'x-sap-adt-sessiontype': 'stateful' });
    }
    expect(requests[4]!.headers).toMatchObject({
      cookie: 'sap-contextid=CONTEXT',
      'sap-contextid': 'CONTEXT',
      'x-sap-adt-sessiontype': 'stateless',
      'sap-adt-purpose': 'close-session',
    });
    await expectConnectionsClosed(server);
  });

  it('isolates overlapping sessions, PP identities, and subsequent stateless parent calls', async () => {
    const seen: Array<{ path: string; socket: unknown; cookie?: string; identity?: string }> = [];
    const { server, config } = await setup((req, res) => {
      const path = new URL(req.url!).pathname;
      seen.push({
        path,
        socket: req.socket,
        cookie: req.headers.cookie,
        identity: req.headers['sap-connectivity-authentication'] as string | undefined,
      });
      if (path.endsWith('/open')) res.setHeader('set-cookie', `sap-contextid=${path.split('/')[1]}; Path=/`);
      res.end('ok');
    });
    const userA = new AdtHttpClient({ ...config, sapConnectivityAuth: 'user-a' });
    const userB = new AdtHttpClient({ ...config, sapConnectivityAuth: 'user-b' });
    let opened = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    await Promise.all(
      [
        { parent: userA, id: 'a1' },
        { parent: userA, id: 'a2' },
        { parent: userB, id: 'b1' },
      ].map(async ({ parent, id }) => {
        await parent.withStatefulSession(async (session) => {
          await session.get(`/${id}/open`);
          if (++opened === 3) release();
          await barrier;
          await session.get(`/${id}/follow-up`);
        });
      }),
    );
    await userA.get('/parent1');
    await userA.get('/parent2');
    expect(new Set(seen.map(({ socket }) => socket)).size).toBe(5);
    for (const id of ['a1', 'a2', 'b1']) {
      const first = seen.find(({ path }) => path === `/${id}/open`)!;
      const own = seen.filter(({ socket }) => socket === first.socket);
      expect(own).toHaveLength(3);
      expect(own.map(({ cookie }) => cookie)).toEqual([undefined, `sap-contextid=${id}`, `sap-contextid=${id}`]);
      expect(own.map(({ identity }) => identity)).toEqual(Array(3).fill(id === 'b1' ? 'user-b' : 'user-a'));
    }
    expect(seen.slice(-2).map(({ cookie }) => cookie)).toEqual([undefined, undefined]);
    await expectConnectionsClosed(server);
  });

  it.each(['bounded', 'discard', 'limit'])('keeps %s responses on a dedicated connection', async (mode) => {
    const sockets: unknown[] = [];
    const { server, client } = await setup((req, res) => {
      sockets.push(req.socket);
      res.end('data');
    });
    await client.withStatefulSession(async (session) => {
      await session.get('/before');
      const data = session.get(
        '/data',
        undefined,
        mode === 'discard'
          ? { discardResponseBody: true }
          : { responseBudget: new DataResponseBudget(mode === 'limit' ? 1 : 10) },
      );
      if (mode === 'limit') await expect(data).rejects.toMatchObject({ name: 'AdtResponseLimitError' });
      else expect((await data).body).toBe(mode === 'discard' ? '' : 'data');
      expect((await session.get('/after')).body).toBe('data');
    });
    expect(sockets).toHaveLength(3);
    expect(sockets[0]).toBe(sockets[2]);
    expect(sockets[1]).not.toBe(sockets[0]);
    await expectConnectionsClosed(server);
  });

  it.each([204, 205, 304])('survives HTTP %i body disposal before the next session request', async (status) => {
    const requests = vi.spyOn(Client.prototype, 'request');
    const { server, client } = await setup((req, res) => {
      if (new URL(req.url!).pathname === '/empty') res.writeHead(status);
      res.end();
    });
    await client.withStatefulSession(async (session) => {
      expect((await session.get('/empty')).statusCode).toBe(status);
      expect((await session.get('/after')).statusCode).toBe(200);
    });
    expect(requests.mock.contexts[0]).toBe(requests.mock.contexts[1]);
    await expectConnectionsClosed(server);
  });

  it.each([false, true])('preserves the callback outcome on close failure (callback fails=%s)', async (fails) => {
    const requests = vi.spyOn(Client.prototype, 'request');
    const close = vi.spyOn(Client.prototype, 'close').mockRejectedValueOnce(new Error('PRIVATE_CLOSE_ERROR'));
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const { client } = await setup((_req, res) => res.end('ok'));
    const original = new Error('operation failed');
    const result = client.withStatefulSession(async (session) => {
      await session.get('/work');
      if (fails) throw original;
      return 'written';
    });
    if (fails) await expect(result).rejects.toBe(original);
    else await expect(result).resolves.toBe('written');
    // The injected close failure intentionally leaves this connection for test teardown.
    rawClients.push(requests.mock.contexts[0] as Client);
    expect(close).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledExactlyOnceWith('Failed to close stateful Connectivity proxy client.');
  });

  it.each([200, 500])('attempts SAP cleanup and closes the proxy after an abort (cleanup HTTP %i)', async (status) => {
    const paths: string[] = [];
    const { server, client } = await setup((req, res) => {
      const path = new URL(req.url!).pathname;
      paths.push(path);
      if (path === '/open') res.setHeader('set-cookie', 'sap-contextid=CONTEXT; Path=/');
      if (path === '/slow') {
        res.write('unfinished');
        return;
      }
      if (path === '/sap/bc/adt/core/http/sessions') res.writeHead(status);
      res.end('ok');
    });
    await expect(
      client.withStatefulSession(async (session) => {
        await session.get('/open');
        await session.get('/slow', undefined, { fetchTimeoutMs: 100 });
      }),
    ).rejects.toMatchObject({ name: 'AdtNetworkError' });
    expect(paths).toEqual(['/open', '/slow', '/sap/bc/adt/core/http/sessions']);
    await expectConnectionsClosed(server);
  });

  it.each([false, true])('applies timeout overrides per request (long operation first=%s)', async (longFirst) => {
    const requests = vi.spyOn(Client.prototype, 'request');
    const { server, client } = await setup((_req, res) => res.end('ok'));
    const timeouts = longFirst ? [600_000, undefined] : [undefined, 600_000];
    await client.withStatefulSession(async (session) => {
      for (const fetchTimeoutMs of timeouts) await session.get('/work', undefined, { fetchTimeoutMs });
    });
    expect(requests.mock.contexts[0]).toBe(requests.mock.contexts[1]);
    expect(requests.mock.calls.map(([options]) => [options.headersTimeout, options.bodyTimeout])).toEqual(
      timeouts.map((timeout) => (timeout === undefined ? [undefined, undefined] : [0, 0])),
    );
    await expectConnectionsClosed(server);
  });
});
