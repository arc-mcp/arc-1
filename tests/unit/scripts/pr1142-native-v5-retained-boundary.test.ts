import { expect, it, vi } from 'vitest';
import { retainedService } from '../../../scripts/qualification/pr1142/native-v5-retained-fixed.js';
import {
  checkRetainedRequest,
  retainedTransport,
} from '../../../scripts/qualification/pr1142/native-v5-retained-transport.js';
import { DataResponseBudget } from '../../../src/adt/data-result-context.js';
import { Semaphore } from '../../../src/adt/semaphore.js';
import { retainedHarness } from './pr1142-native-v5-retained-harness.js';

const path = `${retainedService.owner}/source/main?lockHandle=synthetic`;
for (const proxy of [false, true])
  for (const wait of ['queue', 'csrf', 'token'])
    it.each(['source', 'stop', 'expiry'])(`refuses %s after ${wait}, proxy=${proxy}`, async (fault) => {
      let broken = false,
        stopped = false,
        time = Date.now(),
        armed = false;
      const deadline = time + 1000;
      const change = () => {
        if (!armed) return;
        if (fault === 'expiry') time += 2000;
        else if (fault === 'stop') stopped = true;
        else broken = true;
      };
      const sem = new Semaphore(1),
        h = retainedHarness({
          proxy,
          semaphore: wait === 'queue' ? sem : undefined,
          token:
            wait === 'token'
              ? async () => {
                  await Promise.resolve();
                  change();
                  return 'synthetic';
                }
              : undefined,
        });
      if (wait !== 'csrf') await h.client.http.fetchCsrfToken();
      h.hooks.before = (r) => {
        if (wait === 'csrf' && r.method === 'HEAD') change();
      };
      vi.spyOn(Date, 'now').mockImplementation(() => time);
      const bounded = retainedTransport(h.client.http, {
        stage: () => 'correct',
        verify: () => {
          if (broken) throw new Error('Synthetic source/history changed.');
        },
        shouldStop: () => stopped,
        deadline,
        record: () => {},
      });
      if (wait === 'queue') await sem.acquire();
      armed = true;
      const pending = bounded.http.put(path, retainedService.source, 'text/plain');
      if (wait === 'queue') {
        await Promise.resolve();
        change();
        sem.release();
      }
      await expect(pending).rejects.toThrow();
      expect(h.calls.filter((r) => r.method === 'PUT')).toHaveLength(0);
    });
it.each([false, true])('checks effective deadline after synchronous parent proof with proxy=%s', async (proxy) => {
  const h = retainedHarness({ proxy });
  await h.client.http.fetchCsrfToken();
  let time = Date.now(),
    calls = 0;
  const deadline = time + 1000;
  vi.spyOn(Date, 'now').mockImplementation(() => time);
  const budget = new (await import('../../../src/adt/request-attempt-budget.js')).RequestAttemptBudget(10);
  budget.consume = () => {
    time += 2000;
  };
  const bounded = retainedTransport(h.client.http, {
    stage: () => 'correct',
    verify: () => {
      calls++;
    },
    shouldStop: () => false,
    deadline,
    record: () => {},
  });
  await expect(
    bounded.http.put(path, retainedService.source, 'text/plain', undefined, { attemptBudget: budget }),
  ).rejects.toThrow();
  expect(calls).toBeGreaterThan(1);
  expect(h.calls.filter((r) => r.method === 'PUT')).toHaveLength(0);
});
it('preserves a smaller caller response allowance', async () => {
  const h = retainedHarness();
  const bounded = retainedTransport(h.client.http, {
    stage: () => 'inspect',
    verify: () => {},
    shouldStop: () => false,
    deadline: Date.now() + 30000,
    record: () => {},
  });
  await expect(
    bounded.http.get(retainedService.owner, undefined, { responseBudget: new DataResponseBudget(40, 'caller', true) }),
  ).rejects.toThrow();
});
it('does not replay a submitted fixed PUT', async () => {
  const h = retainedHarness();
  const bounded = retainedTransport(h.client.http, {
    stage: () => 'correct',
    verify: () => {},
    shouldStop: () => false,
    deadline: Date.now() + 30000,
    record: () => {},
  });
  await bounded.http.put(path, retainedService.source, 'text/plain');
  await expect(bounded.http.put(path, retainedService.source, 'text/plain')).rejects.toThrow();
  expect(h.calls.filter((r) => r.method === 'PUT')).toHaveLength(1);
});
it.each([
  ['correct', 'POST', retainedService.owner.replace(/\/[^/]+$/, ''), ''],
  ['correct', 'PUT', path, retainedService.updatedSource],
  ['revise-label', 'PUT', path, retainedService.source],
  ['correct', 'DELETE', `${retainedService.owner}?lockHandle=x`, ''],
  ['inspect', 'GET', '/sap/bc/adt/oo/classes/zforeign', ''],
  ['inspect', 'GET', `${retainedService.owner}?version=active&version=inactive`, ''],
  ['activate-corrected', 'PUT', path, retainedService.source],
  ['delete-view', 'DELETE', `${retainedService.owner}?lockHandle=x`, ''],
] as const)('rejects stage scope %s %s %s', (stage, method, url, body) =>
  expect(() => checkRetainedRequest(stage, method, url, body)).toThrow(),
);
