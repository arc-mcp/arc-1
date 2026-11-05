import { setImmediate as immediate } from 'node:timers/promises';
import { expect, it, vi } from 'vitest';
import { RequestAttemptBudget } from '../../../src/adt/request-attempt-budget.js';
import { Semaphore } from '../../../src/adt/semaphore.js';
import { harness } from './pr1142-native-cts-harness.js';

it.each([false, true])('rechecks source after actual async auth on direct/proxy=%s', async (proxy) => {
  let intent = false;
  const h = harness(undefined, {
    proxy,
    token: async () => {
      await Promise.resolve();
      if (intent) h.breakSource();
      return 'synthetic-token';
    },
  });
  h.hooks.record = (r) => {
    if (r.stage === 'request' && r.path === '/sap/bc/adt/cts/transports') intent = true;
  };
  const r = await h.run('A');
  expect(r.failure).toBe(true);
  expect(h.calls.some((c) => c.method === 'POST')).toBe(false);
  h.assertSafe();
});
it.each([false, true])('enforces effective deadline after synchronous proof on direct/proxy=%s', async (proxy) => {
  const now = Date.now.bind(Date),
    consume = RequestAttemptBudget.prototype.consume;
  let offset = 0,
    intent = false;
  vi.spyOn(Date, 'now').mockImplementation(() => now() + offset);
  const h = harness(undefined, { proxy });
  h.hooks.record = (r) => {
    if (r.stage === 'request' && r.path === '/sap/bc/adt/cts/transports') intent = true;
  };
  vi.spyOn(RequestAttemptBudget.prototype, 'consume').mockImplementation(function (this: RequestAttemptBudget) {
    consume.call(this);
    if (intent) offset = 30_001;
  });
  expect((await h.run('A')).failure).toBe(true);
  expect(h.calls.some((c) => c.method === 'POST')).toBe(false);
  h.assertSafe();
});
it.each(['stop', 'source', 'expiry'] as const)(
  'checks %s after the queued class PUT and still sends only own cleanup',
  async (fault) => {
    const semaphore = new Semaphore(1),
      h = harness(undefined, { semaphore }),
      now = Date.now.bind(Date);
    let armed = false,
      offset = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now() + offset);
    h.hooks.record = (r) => {
      if (
        !armed &&
        r.stage === 'request' &&
        r.method === 'PUT' &&
        r.path.startsWith(`${h.graph.classes[0].owner}/source/main`)
      ) {
        armed = true;
        void semaphore.acquire();
        void (async () => {
          for (let i = 0; i < 100 && semaphore.waiting === 0; i++) await immediate();
          if (fault === 'stop') h.stop();
          if (fault === 'source') h.breakSource();
          if (fault === 'expiry') offset = 300_001;
          semaphore.release();
        })();
      }
    };
    const r = await h.run('A');
    expect(r.failure).toBe(true);
    expect(armed).toBe(true);
    expect(h.calls.filter((c) => c.method === 'PUT' && c.path.includes('/source/main'))).toHaveLength(0);
    expect(h.calls.filter((c) => c.path.includes('_action=UNLOCK'))).toHaveLength(1);
    expect(h.calls.at(-1)?.path).toBe('/sap/bc/adt/core/http/sessions');
    h.assertSafe();
  },
);
it('keeps a rejected or ambiguous C DELETE one-shot and retains exact IDs', async () => {
  const h = harness(),
    a = await h.run('A'),
    b = await h.run('B', a);
  let deletes = 0;
  h.hooks.reply = (r) => {
    if (r.method === 'DELETE' && r.path.includes('/cts/transportrequests/')) {
      deletes++;
      return { statusCode: 503, data: 'Synthetic uncertainty' };
    }
  };
  const r = await h.run('C', b);
  expect(r.failure).toBe(true);
  expect(deletes).toBe(1);
  expect(r.inspectionRequired).toEqual(expect.arrayContaining(['A4HK910005', 'A4HK910006']));
  h.assertSafe();
});
