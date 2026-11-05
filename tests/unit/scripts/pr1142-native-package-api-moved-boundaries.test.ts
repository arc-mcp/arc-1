import { setImmediate as immediate } from 'node:timers/promises';
import { expect, it, vi } from 'vitest';
import { packageApiInterface } from '../../../scripts/qualification/pr1142/native-package-api-profile.js';
import { Semaphore } from '../../../src/adt/semaphore.js';
import { graph, movedHarness } from './pr1142-native-package-api-moved-harness.js';

it.each(
  [false, true].flatMap((proxy) =>
    ['source', 'stop', 'request-timeout', 'baseline-timeout'].map((fault) => ({ proxy, fault })),
  ),
)('rechecks queued recorded API PUT $fault on proxy=$proxy', async ({ proxy, fault }) => {
  const semaphore = new Semaphore(1),
    h = movedHarness({ semaphore, proxy });
  const now = Date.now.bind(Date);
  let offset = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => now() + offset);
  let queued = false;
  h.hooks.record = (r) => {
    if (r.recordedGuardVerified?.stage === 'release-api' && !queued) {
      queued = true;
      void semaphore.acquire();
      void (async () => {
        for (let n = 0; n < 100 && !semaphore.waiting; n++) await immediate();
        if (fault === 'source') h.breakSource();
        else if (fault === 'stop') h.stop();
        else offset = fault === 'request-timeout' ? 31_001 : 300_001;
        semaphore.release();
      })();
    }
  };
  const result = await h.run();
  expect(queued).toBe(true);
  expect(result).toMatchObject({ failure: true, stoppedAt: 'release-api' });
  expect(h.calls.filter((r) => r.method === 'PUT' && r.path.startsWith('/sap/bc/adt/apireleases/'))).toHaveLength(0);
  expect(result.remaining).toEqual([
    graph.root.owner,
    graph.child.owner,
    packageApiInterface(graph).owner,
    graph.clas.owner,
  ]);
});
it.each([false, true])('checks expiry after actual asynchronous auth on proxy=%s', async (proxy) => {
  const now = Date.now.bind(Date);
  let ready = false,
    offset = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => now() + offset);
  const h = movedHarness({
    proxy,
    token: async () => {
      await Promise.resolve();
      if (ready) offset = 300_001;
      return 'synthetic-token';
    },
  });
  h.hooks.record = (r) => {
    if (r.recordedGuardVerified?.stage === 'release-api') ready = true;
  };
  expect(await h.run()).toMatchObject({ failure: true, stoppedAt: 'release-api' });
  expect(ready).toBe(true);
  expect(h.calls.filter((r) => r.method === 'PUT' && r.path.startsWith('/sap/bc/adt/apireleases/'))).toHaveLength(0);
});
it.each(['server', 'destination', 'intersected-server'] as const)(
  'requires exact609 in the actual %s policy',
  async (policy) => {
    const h = movedHarness();
    if (policy === 'server') h.client.safety.allowedTransports = ['*'];
    if (policy === 'destination')
      h.client.safety.multiTargetWrite = { ...h.client.safety.multiTargetWrite!, allowedTransports: ['*'] };
    if (policy === 'intersected-server')
      h.client.safety.multiTargetWrite = { ...h.client.safety.multiTargetWrite!, serverAllowedTransports: ['*'] };
    await expect(h.run()).rejects.toThrow('Fixed package policies required.');
    expect(h.calls).toHaveLength(0);
  },
);
it.each([false, true])(
  'refuses native owner drift under the actual owning lock and still unlocks (proxy=%s)',
  async (proxy) => {
    const h = movedHarness({ proxy });
    let locked = false;
    h.hooks.before = (r) => {
      if (r.method === 'POST' && r.path.includes('_action=LOCK')) locked = true;
    };
    h.hooks.reply = (r) =>
      locked && r.method === 'GET' && r.path === graph.root.owner
        ? { statusCode: 200, data: 'changed metadata under lock' }
        : undefined;
    const result = await h.run();
    expect(result).toMatchObject({
      failure: true,
      cleanupUnconfirmed: false,
      completed: ['release-api', 'stale-api', 'revoke-api'],
    });
    expect(locked).toBe(true);
    expect(h.calls.some((r) => r.method === 'DELETE')).toBe(false);
    expect(h.calls.some((r) => r.path.includes('_action=UNLOCK'))).toBe(true);
  },
);
