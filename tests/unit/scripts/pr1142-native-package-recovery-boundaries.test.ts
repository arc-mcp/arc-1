import { setImmediate as immediate } from 'node:timers/promises';
import { expect, it, vi } from 'vitest';
import { Semaphore } from '../../../src/adt/semaphore.js';
import { graph, recoveryHarness } from './pr1142-native-package-recovery-harness.js';

const { RequestAttemptBudget } = await import('../../../src/adt/request-attempt-budget.js');

it.each(['source', 'stop', 'expired'] as const)(
  'blocks %s across a semaphore wait and preserves owning cleanup',
  async (fault) => {
    const semaphore = new Semaphore(1),
      h = recoveryHarness({ semaphore }),
      now = Date.now.bind(Date);
    let offset = 0,
      queued = false;
    vi.spyOn(Date, 'now').mockImplementation(() => now() + offset);
    h.hooks.record = (r) => {
      if (r.stage === 'request' && r.method === 'DELETE' && !queued) {
        queued = true;
        void (async () => {
          await semaphore.acquire();
          await immediate();
          if (fault === 'source') h.breakSource();
          else if (fault === 'stop') h.stop();
          else offset = 300001;
          semaphore.release();
        })();
      }
    };
    const result = await h.run();
    expect(queued).toBe(true);
    expect(result.failure).toBe(true);
    expect(h.calls.filter((r) => r.method === 'DELETE')).toEqual([]);
    expect(h.calls.some((r) => r.path.includes('_action=UNLOCK'))).toBe(true);
    expect(result.cleanupUnconfirmed).toBe(false);
  },
);
it.each([false, true])('rechecks bindings after async auth through proxy=%s', async (proxy) => {
  let deleting = false;
  const h = recoveryHarness({
    proxy,
    token: async () => {
      await Promise.resolve();
      if (deleting) h.breakSource();
      return 'synthetic';
    },
  });
  h.hooks.record = (r) => {
    if (r.stage === 'request' && r.method === 'DELETE') deleting = true;
  };
  const result = await h.run();
  expect(deleting).toBe(true);
  expect(result.failure).toBe(true);
  expect(h.calls.filter((r) => r.method === 'DELETE')).toEqual([]);
  expect(result.cleanupUnconfirmed).toBe(false);
});
it.each([false, true])(
  'rechecks the effective send deadline after attempt consumption through proxy=%s',
  async (proxy) => {
    const h = recoveryHarness({ proxy }),
      consume = RequestAttemptBudget.prototype.consume,
      now = Date.now.bind(Date);
    let deleting = false,
      offset = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now() + offset);
    h.hooks.record = (r) => {
      if (r.stage === 'request' && r.method === 'DELETE') deleting = true;
    };
    vi.spyOn(RequestAttemptBudget.prototype, 'consume').mockImplementation(function (
      this: InstanceType<typeof RequestAttemptBudget>,
    ) {
      consume.call(this);
      if (deleting) offset = 31001;
    });
    expect((await h.run()).failure).toBe(true);
    expect(deleting).toBe(true);
    expect(h.calls.filter((r) => r.method === 'DELETE')).toEqual([]);
  },
);
it('keeps a dispatched class DELETE uncertain if freshness expires afterward, without deleting another owner', async () => {
  const h = recoveryHarness(),
    now = Date.now.bind(Date);
  let offset = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => now() + offset);
  h.hooks.before = (r) => {
    if (r.method === 'DELETE') offset = 300001;
  };
  const result = await h.run();
  expect(result.failure).toBe(true);
  expect(result.confirmedDeleted).toEqual([]);
  expect(h.calls.filter((r) => r.method === 'DELETE')).toHaveLength(1);
  expect(result.remaining).toContain(graph.clas.owner);
  expect(result.cleanupUnconfirmed).toBe(false);
});
it('preserves all three confirmed deletions when history changes during terminal inventory', async () => {
  const h = recoveryHarness();
  h.hooks.before = (r) => {
    if (h.existing.size === 0 && r.path.endsWith('/inactiveobjects')) h.breakSource();
  };
  const result = await h.run();
  expect(result.failure).toBe(true);
  expect(result.confirmedDeleted).toHaveLength(3);
  expect(result.remaining).toEqual([]);
  expect(result.stoppedAt).toBe('terminal-binding');
  expect(result.inspectionRequired).toHaveLength(3);
});
it('refuses under-lock metadata drift before deletion', async () => {
  const h = recoveryHarness();
  h.hooks.before = (r) => {
    if (r.path.includes('_action=LOCK'))
      h.metadata[graph.clas.owner] = h.metadata[graph.clas.owner].replace(
        'adtcore:changedBy="MARIAN"',
        'adtcore:changedBy="FOREIGN"',
      );
  };
  const result = await h.run();
  expect(result.failure).toBe(true);
  expect(h.calls.filter((r) => r.method === 'DELETE')).toEqual([]);
  expect(result.cleanupUnconfirmed).toBe(false);
});
