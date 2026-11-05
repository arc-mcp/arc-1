import { Socket } from 'node:net';
import { type Dispatcher, getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { observeNativeHttp } from '../../../scripts/qualification/pr1142/native-observed-http.js';
import { AdtHttpClient, type AdtRequestOptions } from '../../../src/adt/http.js';
import { RequestAttemptBudget } from '../../../src/adt/request-attempt-budget.js';
import { Semaphore } from '../../../src/adt/semaphore.js';

// Actual transports and final dispatch policies, synthetic dispatchers only (including long operations).
vi.mock('undici', async (original) => {
  const actual = await original<typeof import('undici')>();
  return {
    ...actual,
    Agent: vi.fn(function syntheticAgent() {
      return actual.getGlobalDispatcher();
    }),
    Client: class {
      async request(options: Dispatcher.RequestOptions) {
        const url = new URL(options.path);
        return (actual.getGlobalDispatcher() as MockAgent)
          .get(url.origin)
          .request({ ...options, path: url.pathname + url.search });
      }
      async close() {}
    },
  };
});
const origin = 'https://native-boundary.invalid';
const path = '/sap/bc/adt/ddic/ddl/sources/zowned/source/main';
let agent: MockAgent, prior: Dispatcher, puts: number, unlocks: number, heads: number;
let afterCsrf: () => void;
let records: { stage?: string; method?: string }[];
beforeEach(() => {
  vi.spyOn(Socket.prototype, 'connect').mockImplementation(() => {
    throw new Error('OFFLINE_SOCKET_GUARD');
  });
  prior = getGlobalDispatcher();
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  puts = unlocks = heads = 0;
  records = [];
  afterCsrf = () => {};
  agent
    .get(origin)
    .intercept({ method: 'HEAD', path: /.*/ })
    .reply(() => {
      heads++;
      afterCsrf();
      return { statusCode: 200, data: '', responseOptions: { headers: { 'x-csrf-token': 'synthetic' } } };
    })
    .persist();
  agent
    .get(origin)
    .intercept({ method: 'PUT', path: /.*/ })
    .reply(() => {
      puts++;
      return { statusCode: 200, data: '' };
    })
    .persist();
  agent
    .get(origin)
    .intercept({ method: 'POST', path: /_action=UNLOCK/ })
    .reply(() => {
      unlocks++;
      return { statusCode: 200, data: '' };
    })
    .persist();
});
afterEach(async () => {
  setGlobalDispatcher(prior);
  await agent.close();
  vi.restoreAllMocks();
});

for (const proxy of [false, true]) {
  for (const wait of ['queue', 'csrf', 'bearer', ...(proxy ? ['proxy-token'] : [])]) {
    it.each(['source', 'history', 'stop', 'freshness'])(
      `revalidates %s after ${wait}, proxy=${proxy}`,
      async (fault) => {
        let armed = false,
          broken = false,
          time = Date.now();
        const freshUntil = time + 1000;
        const change = () => {
          if (armed) {
            if (fault === 'freshness') time += 2000;
            else broken = true;
          }
        };
        const sem = new Semaphore(1);
        const http = new AdtHttpClient({
          baseUrl: origin,
          semaphore: wait === 'queue' ? sem : undefined,
          bearerTokenProvider: async () => {
            await Promise.resolve();
            if (wait === 'bearer') change();
            return 'synthetic';
          },
          ...(proxy
            ? {
                btpProxy: {
                  protocol: 'http',
                  host: 'proxy.invalid',
                  port: 20003,
                  getProxyToken: async () => {
                    await Promise.resolve();
                    if (wait === 'proxy-token') change();
                    return 'synthetic';
                  },
                },
              }
            : {}),
        });
        if (wait !== 'csrf') await http.fetchCsrfToken();
        else afterCsrf = change;
        vi.spyOn(Date, 'now').mockImplementation(() => time);
        const observed = observeNativeHttp(
          http,
          (_method, url) => {
            if (url.includes('_action=UNLOCK')) return;
            if (broken || time >= freshUntil) throw new Error(fault);
          },
          (row) => records.push(row as (typeof records)[number]),
          async () => {},
        );
        const budget = new RequestAttemptBudget(8);
        const handoffs = vi.fn();
        budget.dispatched = handoffs;
        armed = true;
        if (wait === 'queue') await sem.acquire();
        const pending = observed.put(path, 'owned', 'text/plain', undefined, {
          deadline: time + 60_000,
          attemptBudget: budget,
          fetchTimeoutMs: 60_000,
        });
        if (wait === 'queue') {
          expect(sem.waiting).toBe(1);
          change();
          sem.release();
        }
        await expect(pending).rejects.toThrow();
        expect(puts).toBe(0);
        expect(records.some((row) => row.stage === 'request' && row.method === 'PUT')).toBe(true);
        expect(records.some((row) => row.stage === 'dispatch' && row.method === 'PUT')).toBe(false);
        expect(handoffs.mock.calls.every(([method]) => method === 'HEAD')).toBe(true);
        expect(records.some((row) => row.stage === 'refused-before-dispatch')).toBe(true);
        // The original allowance is charged; a proof wrapper cannot replenish it.
        expect(budget.used).toBeGreaterThan(0);
        armed = false;
        await observed.post('/sap/bc/adt/owned?_action=UNLOCK&lockHandle=own', undefined, undefined, undefined, {
          deadline: time + 5000,
        });
        expect(unlocks).toBe(1);
      },
    );
  }
  it(`counts CSRF separately and retains the original allowance and handoff callback, proxy=${proxy}`, async () => {
    const http = new AdtHttpClient({
      baseUrl: origin,
      ...(proxy
        ? { btpProxy: { protocol: 'http', host: 'proxy.invalid', port: 20003, getProxyToken: async () => 'synthetic' } }
        : {}),
    });
    const budget = new RequestAttemptBudget(2);
    budget.dispatched = vi.fn();
    const observed = observeNativeHttp(
      http,
      () => {},
      (row) => records.push(row as (typeof records)[number]),
      async () => {},
    );
    const options = { deadline: Date.now() + 60_000, attemptBudget: budget, fetchTimeoutMs: 60_000 };
    await observed.put(path, 'owned', 'text/plain', undefined, options);
    expect(heads).toBe(1);
    expect(puts).toBe(1);
    expect(budget.used).toBe(2);
    expect(budget.dispatched).toHaveBeenNthCalledWith(1, 'HEAD');
    expect(budget.dispatched).toHaveBeenNthCalledWith(2, 'PUT');
    expect(records.filter((row) => row.stage === 'dispatch')).toEqual([expect.objectContaining({ method: 'PUT' })]);
    await expect(observed.put(path, 'owned', 'text/plain', undefined, options)).rejects.toThrow();
    expect(puts).toBe(1);
    expect(budget.used).toBe(2);
  });
  it(`rechecks effective deadline after synchronous final validation, proxy=${proxy}`, async () => {
    const http = new AdtHttpClient({
      baseUrl: origin,
      ...(proxy
        ? { btpProxy: { protocol: 'http', host: 'proxy.invalid', port: 20003, getProxyToken: async () => 'synthetic' } }
        : {}),
    });
    await http.fetchCsrfToken();
    let time = Date.now(),
      proofs = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => time);
    const budget = new RequestAttemptBudget(4);
    budget.dispatched = vi.fn();
    const observed = observeNativeHttp(
      http,
      () => {
        if (++proofs === 2) time += 30_000;
      },
      (row) => records.push(row as (typeof records)[number]),
      async () => {},
    );
    await expect(
      observed.put(path, 'owned', 'text/plain', undefined, { deadline: time + 90_000, attemptBudget: budget }),
    ).rejects.toThrow();
    expect(puts).toBe(0);
    expect(budget.used).toBe(1);
    expect(budget.dispatched).not.toHaveBeenCalled();
  });
  it(`preserves unknown submission when its handoff receipt fails, proxy=${proxy}`, async () => {
    const http = new AdtHttpClient({
      baseUrl: origin,
      ...(proxy
        ? { btpProxy: { protocol: 'http', host: 'proxy.invalid', port: 20003, getProxyToken: async () => 'synthetic' } }
        : {}),
    });
    await http.fetchCsrfToken();
    const budget = new RequestAttemptBudget(4);
    budget.dispatched = () => {
      throw new Error('synthetic handoff receipt failure');
    };
    const observed = observeNativeHttp(
      http,
      () => {},
      (row) => records.push(row as (typeof records)[number]),
      async () => {},
    );
    await expect(
      observed.put(path, 'owned', 'text/plain', undefined, { deadline: Date.now() + 60_000, attemptBudget: budget }),
    ).rejects.toThrow();
    expect(puts).toBe(1);
    expect(budget.used).toBe(1);
    expect(records.some((row) => row.stage === 'error')).toBe(true);
    expect(records.some((row) => row.stage === 'refused-before-dispatch' || row.stage === 'refused-before-send')).toBe(
      false,
    );
  });
  it(`validates after a parent's synchronous proof, proxy=${proxy}`, async () => {
    const http = new AdtHttpClient({
      baseUrl: origin,
      ...(proxy
        ? { btpProxy: { protocol: 'http', host: 'proxy.invalid', port: 20003, getProxyToken: async () => 'synthetic' } }
        : {}),
    });
    await http.fetchCsrfToken();
    let broken = false;
    class ParentProof extends RequestAttemptBudget {
      override consume() {
        super.consume();
        broken = true;
      }
    }
    const budget = new ParentProof(4);
    const observed = observeNativeHttp(
      http,
      () => {
        if (broken) throw new Error('parent-proof-drift');
      },
      () => {},
      async () => {},
    );
    await expect(
      observed.put(path, 'owned', 'text/plain', undefined, {
        deadline: Date.now() + 60_000,
        attemptBudget: budget,
      } satisfies AdtRequestOptions),
    ).rejects.toThrow();
    expect(puts).toBe(0);
    expect(budget.used).toBe(1);
  });
}
