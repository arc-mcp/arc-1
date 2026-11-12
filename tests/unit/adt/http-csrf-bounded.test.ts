import { createServer, type RequestListener, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataResponseBudget } from '../../../src/adt/data-result-context.js';
import { AdtNetworkError } from '../../../src/adt/errors.js';
import { AdtHttpClient } from '../../../src/adt/http.js';
import { AdtRequestBudgetError, RequestAttemptBudget } from '../../../src/adt/request-attempt-budget.js';

const CORE = '/sap/bc/adt/core/discovery';
const LEGACY = '/sap/bc/adt/discovery';
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

async function setup(proxy: boolean, listener: RequestListener) {
  const sends: string[] = [];
  const server = createServer((req, res) => {
    sends.push(`${req.method} ${new URL(req.url!, 'http://sap.test').pathname}`);
    listener(req, res);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a local TCP listener');
  const onUnauthorized = vi.fn();
  const client = new AdtHttpClient({
    baseUrl: proxy ? 'http://sap.invalid:8000' : `http://127.0.0.1:${address.port}`,
    onUnauthorized,
    ...(proxy
      ? {
          btpProxy: {
            protocol: 'http' as const,
            host: '127.0.0.1',
            port: address.port,
            getProxyToken: async () => 'proxy-test-token',
          },
        }
      : {}),
  });
  return { client, sends, onUnauthorized };
}

const options = (limit = 8, countAllResponses = false) => ({
  attemptBudget: new RequestAttemptBudget(limit),
  responseBudget: new DataResponseBudget(128, 'test', countAllResponses),
  deadline: Date.now() + 2000,
});
const post = (client: AdtHttpClient, request?: ReturnType<typeof options>) =>
  client.post('/sap/bc/adt/test', '<read/>', 'application/xml', undefined, request);

describe.each([false, true])('tokenless CSRF fallback, Connectivity proxy=%s', (proxy) => {
  it.each(['empty', 'streamed', 'Required'])('disposes of %s control bodies before legacy fallback', async (body) => {
    const closed: Promise<void>[] = [];
    const { client, sends } = await setup(proxy, (req, res) => {
      const path = new URL(req.url!, 'http://sap.test').pathname;
      if (req.method === 'HEAD') return void res.end();
      if (path === CORE) {
        res.setHeader('content-type', 'text/html');
        if (body === 'Required') res.setHeader('x-csrf-token', 'Required');
        if (body === 'empty') res.end();
        else {
          closed.push(new Promise<void>((resolve) => res.once('close', resolve)));
          res.write('x'.repeat(16384)); // No end: a header-only probe must cancel, not buffer.
        }
      } else if (path === LEGACY) {
        res.setHeader('x-csrf-token', 'TOKEN');
        res.end('<service/>');
      } else res.end('OK');
    });
    const request = options();
    await expect(post(client, request)).resolves.toMatchObject({ body: 'OK' });
    await Promise.all(closed);
    expect(sends).toEqual([`HEAD ${CORE}`, `GET ${CORE}`, `GET ${LEGACY}`, 'POST /sap/bc/adt/test']);
    expect(request.attemptBudget.used).toBe(4);
    expect(request.responseBudget.consumedBytes).toBe(2);
    expect(request.responseBudget.reservedBytes).toBe(0);
  });

  it('never sends the operation if neither endpoint supplies a usable token', async () => {
    const { client, sends } = await setup(proxy, (_req, res) => {
      res.setHeader('x-csrf-token', 'Required');
      res.end();
    });
    await expect(post(client, options())).rejects.toMatchObject({
      name: 'AdtCsrfBootstrapError',
      statusCode: 200,
      path: LEGACY,
    });
    expect(sends).toEqual([`HEAD ${CORE}`, `GET ${CORE}`, `GET ${LEGACY}`]);
  });

  it.each([401, 403, 500])('preserves HTTP %s and stops before legacy fallback', async (status) => {
    const { client, sends, onUnauthorized } = await setup(proxy, (req, res) => {
      if (req.method !== 'HEAD') {
        res.statusCode = status;
        res.setHeader('x-csrf-token', 'REJECTED_TOKEN');
      }
      res.end();
    });
    await expect(post(client, options())).rejects.toMatchObject({ statusCode: status, path: CORE });
    expect(sends).toEqual([`HEAD ${CORE}`, `GET ${CORE}`]);
    expect(onUnauthorized).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
  });

  it('stops at the send allowance before legacy fallback', async () => {
    const { client, sends } = await setup(proxy, (_req, res) => res.end());
    const request = options(2);
    await expect(post(client, request)).rejects.toBeInstanceOf(AdtRequestBudgetError);
    expect(sends).toEqual([`HEAD ${CORE}`, `GET ${CORE}`]);
    expect(request.attemptBudget.used).toBe(2);
  });

  it.each(['abort', 'deadline'])('honors caller %s while waiting for the tokenless GET', async (kind) => {
    const controller = new AbortController();
    const { client, sends } = await setup(proxy, (req, res) => {
      if (req.method === 'HEAD') res.end();
      else if (kind === 'abort') controller.abort();
      // The deadline variant deliberately leaves the response pending.
    });
    const request = { ...options(), signal: controller.signal, deadline: Date.now() + 200 };
    await expect(post(client, request)).rejects.toBeInstanceOf(AdtNetworkError);
    expect(sends).toEqual([`HEAD ${CORE}`, `GET ${CORE}`]);
    expect(request.attemptBudget.used).toBe(2);
    expect(request.responseBudget.reservedBytes).toBe(0);
  });

  it.each(['unbounded', 'all responses'])('still recognizes HTML login when bodies are retained: %s', async (mode) => {
    const { client, sends, onUnauthorized } = await setup(proxy, (req, res) => {
      if (req.method === 'HEAD') res.end();
      else {
        res.setHeader('content-type', 'text/html');
        res.end('<html><body>Logon</body></html>');
      }
    });
    await expect(post(client, mode === 'unbounded' ? undefined : options(8, true))).rejects.toMatchObject({
      statusCode: 401,
      path: CORE,
    });
    expect(sends).toEqual([`HEAD ${CORE}`, `GET ${CORE}`]);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('requires a token even when a header-only probe cannot classify HTML', async () => {
    const { client, sends, onUnauthorized } = await setup(proxy, (req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end(req.method === 'HEAD' ? undefined : '<html><body>Logon</body></html>');
    });
    await expect(post(client, options())).rejects.toMatchObject({
      name: 'AdtCsrfBootstrapError',
      statusCode: 200,
      path: LEGACY,
    });
    expect(sends).toEqual([`HEAD ${CORE}`, `GET ${CORE}`, `GET ${LEGACY}`]);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('keeps cumulative control-body accounting when explicitly requested', async () => {
    const { client, sends } = await setup(proxy, (req, res) => {
      const path = new URL(req.url!, 'http://sap.test').pathname;
      if (req.method === 'HEAD') res.end();
      else if (path === CORE) res.end('<core/>');
      else if (path === LEGACY) {
        res.setHeader('x-csrf-token', 'TOKEN');
        res.end('<legacy/>');
      } else res.end('OK');
    });
    const request = options(8, true);
    await expect(post(client, request)).resolves.toMatchObject({ body: 'OK' });
    expect(sends).toHaveLength(4);
    expect(request.attemptBudget.used).toBe(4);
    expect(request.responseBudget.consumedBytes).toBe(Buffer.byteLength('<core/><legacy/>OK'));
    expect(request.responseBudget.reservedBytes).toBe(0);
  });
});
