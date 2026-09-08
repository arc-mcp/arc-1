import { createServer, type RequestListener, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { DataResponseBudget } from '../../../src/adt/data-result-context.js';
import { AdtHttpClient } from '../../../src/adt/http.js';
import { AdtRequestBudgetError, RequestAttemptBudget } from '../../../src/adt/request-attempt-budget.js';
import { Semaphore } from '../../../src/adt/semaphore.js';

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
async function setup(proxy: boolean, listener: RequestListener) {
  const server = createServer(listener);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
  const semaphore = new Semaphore(1);
  return {
    semaphore,
    client: new AdtHttpClient({
      baseUrl: proxy ? 'http://sap.invalid:8000' : `http://127.0.0.1:${address.port}`,
      semaphore,
      ...(proxy
        ? {
            btpProxy: {
              protocol: 'http' as const,
              host: '127.0.0.1',
              port: address.port,
              getProxyToken: async () => 'local-test-token',
            },
          }
        : {}),
    }),
  };
}
describe.each([false, true])('request attempt budget, Connectivity proxy=%s', (proxy) => {
  it.each(['GET', 'POST'] as const)('never hides an implicit 421 %s replay outside the allowance', async (method) => {
    const sends: string[] = [];
    const { client, semaphore } = await setup(proxy, (req, res) => {
      sends.push(req.method!);
      if (req.method === 'HEAD') {
        res.setHeader('x-csrf-token', 'TEST');
        res.end();
      } else {
        res.writeHead(421);
        res.end('Misdirected');
      }
    });
    const attemptBudget = new RequestAttemptBudget(method === 'GET' ? 1 : 2);
    const options = { attemptBudget, deadline: Date.now() + 2000 };
    const call =
      method === 'GET'
        ? client.get('/sap/bc/adt/test', undefined, options)
        : client.post('/sap/bc/adt/test', '<read/>', 'text/xml', undefined, options);
    if (proxy) await expect(call).rejects.toMatchObject({ statusCode: 421 });
    else await expect(call).rejects.toBeInstanceOf(AdtRequestBudgetError);
    expect(sends).toEqual(method === 'GET' ? ['GET'] : ['HEAD', 'POST']);
    expect(attemptBudget.used).toBe(sends.length);
    expect(semaphore.inflight).toBe(0);
  });
  it.each([401, 403])('retains HTTP %i evidence when its body exceeds the byte cap', async (status) => {
    const { client } = await setup(proxy, (_req, res) => {
      res.writeHead(status);
      res.end('x'.repeat(500));
    });
    const options = { responseBudget: new DataResponseBudget(100), attemptBudget: new RequestAttemptBudget(2) };
    await expect(client.get('/denied', undefined, options)).rejects.toMatchObject({ name: 'AdtResponseLimitError' });
    expect(options.attemptBudget.authorizationFailureObserved).toBe(true);
  });
  it('counts CSRF + original + retry and refuses before the third send', async () => {
    const methods: string[] = [];
    const { client, semaphore } = await setup(proxy, (req, res) => {
      methods.push(req.method!);
      if (req.method === 'HEAD') {
        res.setHeader('x-csrf-token', 'TEST');
        res.end();
      } else {
        res.writeHead(429, { 'Retry-After': '0' });
        res.end('Busy');
      }
    });
    const attemptBudget = new RequestAttemptBudget(2);
    await expect(
      client.post('/sap/bc/adt/test', '<read/>', 'text/xml', undefined, {
        attemptBudget,
        responseBudget: new DataResponseBudget(1024),
        deadline: Date.now() + 2000,
      }),
    ).rejects.toBeInstanceOf(AdtRequestBudgetError);
    expect(methods).toEqual(['HEAD', 'POST']);
    expect(attemptBudget.used).toBe(2);
    expect(semaphore.inflight).toBe(0);
  });
  it('disposes of streaming CSRF GET bodies, preserving token/session headers', async () => {
    const methods: string[] = [];
    let receivedCookie = '',
      receivedToken = '';
    const { client } = await setup(proxy, (req, res) => {
      methods.push(req.method!);
      if (req.method === 'HEAD') {
        res.setHeader('set-cookie', 'SAP_SESSIONID=one; Path=/');
        res.end();
      } else if (req.method === 'GET') {
        res.writeHead(200, { 'x-csrf-token': 'TEST', 'set-cookie': 'SAP_EXTRA=two; Path=/' });
        res.write('x'.repeat(16384)); // Never ends: only headers are needed, so the client must cancel.
      } else {
        receivedCookie = req.headers.cookie ?? '';
        receivedToken = String(req.headers['x-csrf-token']);
        res.end('ok');
      }
    });
    const attemptBudget = new RequestAttemptBudget(3),
      responseBudget = new DataResponseBudget(10);
    expect(
      (
        await client.post('/sap/bc/adt/test', '<read/>', 'text/xml', undefined, {
          attemptBudget,
          responseBudget,
          deadline: Date.now() + 1500,
        })
      ).body,
    ).toBe('ok');
    expect(methods).toEqual(['HEAD', 'GET', 'POST']);
    expect(receivedCookie).toContain('SAP_SESSIONID=one');
    expect(receivedCookie).toContain('SAP_EXTRA=two');
    expect(receivedToken).toBe('TEST');
    expect(responseBudget.consumedBytes).toBe(2);
  });
  it('does not follow redirects outside the send budget', async () => {
    let sends = 0;
    const { client } = await setup(proxy, (_req, res) => {
      sends++;
      res.writeHead(302, { Location: '/redirected' });
      res.end();
    });
    await expect(
      client.get('/sap/bc/adt/test', undefined, { attemptBudget: new RequestAttemptBudget(1) }),
    ).rejects.toThrow();
    expect(sends).toBe(1);
  });
  it('includes HTTP queue wait in the deadline, sends nothing and frees the queue', async () => {
    let sends = 0;
    const { client, semaphore } = await setup(proxy, (_req, res) => {
      sends++;
      res.end('ok');
    });
    await semaphore.acquire();
    const attemptBudget = new RequestAttemptBudget(2);
    try {
      await expect(
        client.get('/sap/bc/adt/test', undefined, { attemptBudget, deadline: Date.now() + 30 }),
      ).rejects.toThrow();
      expect(sends).toBe(0);
      expect(attemptBudget.used).toBe(0);
      expect(semaphore.waiting).toBe(0);
    } finally {
      semaphore.release();
    }
  });
  it('enforces cumulative body bytes and frees the semaphore after an overrun', async () => {
    const { client, semaphore } = await setup(proxy, (_req, res) => res.end('123456'));
    const options = { responseBudget: new DataResponseBudget(10), attemptBudget: new RequestAttemptBudget(5) };
    await client.get('/first', undefined, options);
    await expect(client.get('/second', undefined, options)).rejects.toMatchObject({ name: 'AdtResponseLimitError' });
    expect(options.responseBudget.reservedBytes).toBe(0);
    expect(semaphore.inflight).toBe(0);
    expect((await client.get('/third')).body).toBe('123456');
  });
  it('cancels a stalled body at the deadline', async () => {
    const { client, semaphore } = await setup(proxy, (_req, res) => {
      res.writeHead(200);
      res.write('partial');
    });
    const options = {
      responseBudget: new DataResponseBudget(1024),
      attemptBudget: new RequestAttemptBudget(2),
      deadline: Date.now() + 40,
    };
    await expect(client.get('/slow', undefined, options)).rejects.toThrow();
    expect(options.responseBudget.reservedBytes).toBe(0);
    expect(semaphore.inflight).toBe(0);
  });
});

it.each(['GET', 'POST'] as const)(
  'counts a successful implicit direct %s replay when allowance remains',
  async (method) => {
    let reads = 0,
      sends = 0;
    const { client } = await setup(false, (req, res) => {
      sends++;
      if (req.method === 'HEAD') res.setHeader('x-csrf-token', 'TEST');
      else res.writeHead(++reads === 1 ? 421 : 200);
      res.end('ok');
    });
    const attemptBudget = new RequestAttemptBudget(method === 'GET' ? 2 : 3);
    const options = { attemptBudget, deadline: Date.now() + 2000 };
    const result =
      method === 'GET'
        ? await client.get('/sap/bc/adt/test', undefined, options)
        : await client.post('/sap/bc/adt/test', '<read/>', 'text/xml', undefined, options);
    expect(result.body).toBe('ok');
    expect(attemptBudget.used).toBe(sends);
    expect(reads).toBe(2);
  },
);
