import { Socket } from 'node:net';
import { type Dispatcher, getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DataResponseBudget } from '../../../src/adt/data-result-context.js';
import { AdtNetworkError } from '../../../src/adt/errors.js';
import { AdtHttpClient } from '../../../src/adt/http.js';
import { RequestAttemptBudget } from '../../../src/adt/request-attempt-budget.js';

// Preserve the actual Connectivity send construction; only its socket is replaced.
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

const origin = 'https://proof.invalid';
let agent: MockAgent, prior: ReturnType<typeof getGlobalDispatcher>, deletes: number, unlocks: number;
beforeEach(() => {
  vi.spyOn(Socket.prototype, 'connect').mockImplementation(() => {
    throw new Error('OFFLINE_SOCKET_GUARD');
  });
  prior = getGlobalDispatcher();
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  deletes = 0;
  unlocks = 0;
  agent
    .get(origin)
    .intercept({ method: 'HEAD', path: /.*/ })
    .reply(200, '', { headers: { 'x-csrf-token': 'synthetic' } })
    .persist();
  agent
    .get(origin)
    .intercept({ method: 'POST', path: /_action=UNLOCK/ })
    .reply(() => {
      unlocks++;
      return { statusCode: 200, data: '' };
    })
    .persist();
  agent
    .get(origin)
    .intercept({ method: 'DELETE', path: /.*/ })
    .reply(() => {
      deletes++;
      return { statusCode: 204, data: '' };
    })
    .persist();
});
afterEach(async () => {
  setGlobalDispatcher(prior);
  await agent.close();
  vi.restoreAllMocks();
});
class ProofBudget extends RequestAttemptBudget {
  constructor(private readonly proof: () => void) {
    super(8);
  }
  override consume() {
    this.proof();
    super.consume();
  }
}
async function client(proxy: boolean, authenticate = async () => 'synthetic') {
  const http = new AdtHttpClient({
    baseUrl: origin,
    bearerTokenProvider: authenticate,
    ...(proxy
      ? { btpProxy: { protocol: 'http', host: 'synthetic-proxy', port: 20003, getProxyToken: async () => 'synthetic' } }
      : {}),
  });
  await http.fetchCsrfToken();
  return http;
}
for (const proxy of [false, true]) {
  it.each([6000, 30000])(`blocks effective %i ms deadline reached inside final proof, proxy=${proxy}`, async (cap) => {
    const http = await client(proxy);
    let time = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => time);
    const budget = new ProofBudget(() => {
      time += cap;
    });
    budget.dispatched = vi.fn();
    const options = {
      deadline: time + cap,
      attemptBudget: budget,
      noReplay: true,
      retryTransientErrors: false,
      responseBudget: new DataResponseBudget(2 * 1024 * 1024, 'final-proof-test', true),
    };
    expect(options.deadline).toBe(time + cap);
    await expect(http.delete('/sap/bc/adt/owned', undefined, options)).rejects.toBeInstanceOf(AdtNetworkError);
    expect(deletes).toBe(0);
    expect(budget.used).toBe(1);
    expect(budget.dispatched).not.toHaveBeenCalled();
    // Cleanup receives a separate bounded policy, never the expired mutation allowance.
    await expect(
      http.post('/sap/bc/adt/owned?_action=UNLOCK&lockHandle=own', undefined, undefined, undefined, {
        deadline: time + 5000,
        noReplay: true,
      }),
    ).resolves.toMatchObject({ statusCode: 200 });
    expect(deletes).toBe(0);
    expect(unlocks).toBe(1);
  });
  it(`preserves cancellation during final authentication, proxy=${proxy}`, async () => {
    const controller = new AbortController();
    let cancel = false;
    const http = await client(proxy, async () => {
      if (cancel) controller.abort();
      return 'synthetic';
    });
    const proof = vi.fn();
    const budget = new ProofBudget(proof);
    cancel = true;
    await expect(
      http.delete('/sap/bc/adt/owned', undefined, {
        signal: controller.signal,
        deadline: Date.now() + 60000,
        attemptBudget: budget,
        noReplay: true,
      }),
    ).rejects.toBeInstanceOf(AdtNetworkError);
    expect(deletes).toBe(0);
    expect(proof).not.toHaveBeenCalled();
  });
  it(`sends exactly once with a valid final proof and with an ordinary legacy call, proxy=${proxy}`, async () => {
    const http = await client(proxy),
      budget = new ProofBudget(() => {});
    budget.dispatched = vi.fn();
    await expect(
      http.delete('/sap/bc/adt/owned', undefined, {
        deadline: Date.now() + 60000,
        attemptBudget: budget,
        noReplay: true,
      }),
    ).resolves.toMatchObject({ statusCode: 204 });
    expect(deletes).toBe(1);
    expect(budget.dispatched).toHaveBeenCalledExactlyOnceWith('DELETE');
    expect(budget.used).toBe(1);
    await expect(http.delete('/sap/bc/adt/owned')).resolves.toMatchObject({ statusCode: 204 });
    expect(deletes).toBe(2);
  });
}
