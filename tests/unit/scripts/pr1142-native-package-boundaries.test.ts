import { setImmediate as immediate } from 'node:timers/promises';
import { expect, it, vi } from 'vitest';
import { Semaphore } from '../../../src/adt/semaphore.js';
import { graph, harness } from './pr1142-native-package-harness.js';

const { RequestAttemptBudget } = await import('../../../src/adt/request-attempt-budget.js');
it.each([false, true])('completes the fixed lifecycle through mocked Connectivity=%s', async (proxy) => {
  expect((await harness({ proxy }).run()).failure).toBe(false);
});
it.each(['source', 'stop', 'expired'] as const)(
  'rejects %s after actual semaphore wait before class PUT and still closes its own lock',
  async (fault) => {
    const semaphore = new Semaphore(1),
      h = harness({ semaphore }),
      now = Date.now.bind(Date);
    let offset = 0,
      queued = false;
    vi.spyOn(Date, 'now').mockImplementation(() => now() + offset);
    h.hooks.record = (r) => {
      if (r.stage === 'request' && r.method === 'PUT' && !queued) {
        queued = true;
        void semaphore.acquire();
        void (async () => {
          for (let i = 0; i < 100 && semaphore.waiting === 0; i++) await immediate();
          if (fault === 'source') h.breakSource();
          else if (fault === 'stop') h.stop();
          else offset = 300_001;
          semaphore.release();
        })();
      }
    };
    const result = await h.run();
    expect(queued).toBe(true);
    expect(result.failure).toBe(true);
    expect(h.calls.some((r) => r.method === 'PUT')).toBe(false);
    expect(h.calls.some((r) => r.path.includes('_action=UNLOCK'))).toBe(true);
    expect(h.calls.some((r) => r.path === '/sap/bc/adt/core/http/sessions')).toBe(true);
    expect(result.cleanupUnconfirmed).toBe(false);
  },
);
it.each([false, true])('revalidates after async auth on direct/proxy=%s', async (proxy) => {
  let intent = false;
  const h = harness({
    proxy,
    token: async () => {
      await Promise.resolve();
      if (intent) h.breakSource();
      return 'synthetic-token';
    },
  });
  h.hooks.record = (r) => {
    if (r.stage === 'request' && r.method === 'POST' && r.path === '/sap/bc/adt/packages') intent = true;
  };
  const result = await h.run();
  expect(result.failure).toBe(true);
  expect(h.calls.some((r) => r.method === 'POST')).toBe(false);
});
it.each([false, true])('checks the effective deadline after synchronous proof on direct/proxy=%s', async (proxy) => {
  let intent = false,
    offset = 0;
  const now = Date.now.bind(Date),
    consume = RequestAttemptBudget.prototype.consume;
  vi.spyOn(Date, 'now').mockImplementation(() => now() + offset);
  const h = harness({ proxy });
  h.hooks.record = (r) => {
    if (r.stage === 'request' && r.method === 'POST' && r.path === '/sap/bc/adt/packages') intent = true;
  };
  vi.spyOn(RequestAttemptBudget.prototype, 'consume').mockImplementation(function (
    this: InstanceType<typeof RequestAttemptBudget>,
  ) {
    consume.call(this);
    if (intent) offset = 300_001;
  });
  expect((await h.run()).failure).toBe(true);
  expect(h.calls.some((r) => r.method === 'POST')).toBe(false);
});
it('keeps the original baseline deadline for a later actual DELETE and allows only cleanup after expiry', async () => {
  const h = harness(),
    now = Date.now.bind(Date);
  let offset = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => now() + offset);
  h.hooks.before = (r) => {
    if (r.method === 'DELETE' && r.path.startsWith(graph.clas.owner)) offset = 300_001;
  };
  const result = await h.run();
  expect(result.failure).toBe(true);
  expect(h.calls.filter((r) => r.method === 'DELETE')).toHaveLength(3);
  expect(result.expectedRefusals).toHaveLength(2);
  expect(h.calls.at(-1)?.path).toBe('/sap/bc/adt/core/http/sessions');
  expect(result.cleanupUnconfirmed).toBe(false);
});
it('runs the independent native preflight with only four fixed GETs and no mutation', async () => {
  const h = harness(),
    { packageGetOnlyPreflight } = await import('../../../scripts/qualification/pr1142/native-package-runner.js');
  await packageGetOnlyPreflight(
    h.client,
    graph,
    (r) => h.records.push(r),
    () => {},
  );
  expect(h.calls).toHaveLength(4);
  expect(h.calls.every((r) => r.method === 'GET')).toBe(true);
  expect(JSON.stringify(h.records)).not.toContain('UNRELATED_DRAFT');
});
it('refuses a source change during the final preflight inventory read', async () => {
  const h = harness(),
    { packageGetOnlyPreflight } = await import('../../../scripts/qualification/pr1142/native-package-runner.js');
  let changed = false;
  h.hooks.before = (r) => {
    if (r.path.endsWith('/inactiveobjects')) changed = true;
  };
  await expect(
    packageGetOnlyPreflight(
      h.client,
      graph,
      () => {},
      () => {
        if (changed) throw new Error('changed');
      },
    ),
  ).rejects.toThrow();
  expect(h.calls.every((r) => r.method === 'GET')).toBe(true);
});
