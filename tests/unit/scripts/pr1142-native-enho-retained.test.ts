import { expect, it, vi } from 'vitest';
import {
  ENHO_RETAINED_MODE,
  ENHO_RETAINED_STAGES,
} from '../../../scripts/qualification/pr1142/native-enho-retained-fixed.js';
import { retainedFixtures as f, retainedHarness } from './pr1142-native-enho-retained-harness.js';

const child = f[1],
  parent = f[0];
it.each([false, true])(
  'runs only retained reactivation and reverse cleanup through real dispatchers proxy=%s',
  async (proxy) => {
    const h = await retainedHarness({ proxy }),
      r = await h.run();
    expect(
      r,
      JSON.stringify(h.records.filter((v) => v.failure || v.adapter || v.stage === 'refused-before-send')),
    ).toMatchObject({
      failure: false,
      completed: ENHO_RETAINED_STAGES,
      created: [],
      remaining: [],
      confirmedDeleted: [child.owner, parent.owner],
      cleanupUnconfirmed: false,
      finalAbsenceConfirmed: true,
    });
    expect(h.world.unexpected).toEqual([]);
    expect(h.world.calls.filter((v) => v.method === 'PUT')).toEqual([]);
    expect(h.world.calls.filter((v) => v.method === 'DELETE').map((v) => v.path.split('?')[0])).toEqual([
      child.owner,
      parent.owner,
    ]);
    expect(
      h.world.calls
        .filter(
          (v) =>
            v.method === 'POST' &&
            !v.path.includes('_action=') &&
            !v.path.startsWith('/sap/bc/adt/cts/transportchecks'),
        )
        .every((v) => v.path.startsWith('/sap/bc/adt/activation?')),
    ).toBe(true);
  },
);
it('preflights existing inactive owners without claiming suffix absence', async () => {
  const { enhoGetOnlyPreflight } = await import('../../../scripts/qualification/pr1142/native-enho-runner.js');
  const h = await retainedHarness();
  await enhoGetOnlyPreflight(h.client, f, (v) => h.records.push(v), h.verify, ENHO_RETAINED_MODE);
  expect(h.world.calls.every((v) => v.method === 'GET')).toBe(true);
  expect(h.records).toContainEqual({ inventoryScope: 'valid-unfiltered', retainedOwners: f.map((v) => v.owner) });
});
it.each(['parent', 'draft', 'active', 'dependency'])(
  'refuses changed %s before any mutation and retains both owners',
  async (fault) => {
    const h = await retainedHarness();
    if (fault === 'parent') h.world.objects.get(parent.owner)!.source += 'foreign';
    if (fault === 'draft') h.world.objects.get(child.owner)!.metadata += ' ';
    if (fault === 'active') h.changeActive(h.activeDocument()! + ' ');
    if (fault === 'dependency') h.dependency.source += 'foreign';
    const r = await h.run();
    expect(r).toMatchObject({ failure: true, remaining: f.map((v) => v.owner), mutationDispatched: false });
    expect(h.world.calls.every((v) => v.method === 'GET')).toBe(true);
  },
);
it('rejects drift between the raw reads and semantic adoption', async () => {
  const h = await retainedHarness();
  let changed = false;
  h.hooks.record = (r) => {
    if (!changed && r.retainedRead?.endsWith('interfaces/if_adt_discovery_provider/source/main')) {
      changed = true;
      h.world.objects.get(parent.owner)!.metadata += ' ';
    }
  };
  expect((await h.run()).failure).toBe(true);
  expect(changed).toBe(true);
  expect(h.world.calls.every((v) => v.method === 'GET')).toBe(true);
});
it.each(['parent', 'active'])('rechecks %s after preaudit before actual activation', async (fault) => {
  const h = await retainedHarness();
  let changed = false;
  h.hooks.record = (r) => {
    if (!changed && r.stage === 'response' && r.path?.includes('preauditRequested=true')) {
      changed = true;
      if (fault === 'parent') h.world.objects.get(parent.owner)!.source += 'foreign';
      else h.changeActive(h.activeDocument()! + ' ');
    }
  };
  const r = await h.run();
  expect(changed).toBe(true);
  expect(r.failure).toBe(true);
  expect(h.world.calls.some((v) => v.path.includes('preauditRequested=false'))).toBe(false);
});
it('rechecks the owned class while holding the ENHO delete lock', async () => {
  const h = await retainedHarness();
  let selected = false,
    changed = false;
  h.hooks.record = (r) => {
    if (r.stageStarted === 'delete-ENHO') selected = true;
  };
  h.hooks.before = (u, v) => {
    if (
      selected &&
      !changed &&
      u.pathname === child.owner &&
      u.searchParams.get('_action') === 'LOCK' &&
      v.method === 'POST'
    ) {
      changed = true;
      h.world.objects.get(parent.owner)!.source += 'foreign';
    }
  };
  const r = await h.run();
  expect(changed).toBe(true);
  expect(r).toMatchObject({ failure: true, cleanupUnconfirmed: false, remaining: f.map((v) => v.owner) });
  expect(h.world.calls.some((v) => v.method === 'DELETE')).toBe(false);
  expect(h.world.calls.some((v) => v.path.includes('_action=UNLOCK'))).toBe(true);
});
it.each([false, true])('source expiry after auth awaits stops activation proxy=%s', async (proxy) => {
  let armed = false;
  const h = await retainedHarness({
    proxy,
    token: async () => {
      await Promise.resolve();
      if (armed) h.breakSource();
      return 'synthetic';
    },
  });
  h.hooks.record = (r) => {
    if (r.stage === 'request' && r.path?.includes('preauditRequested=true')) armed = true;
  };
  const r = await h.run();
  expect(armed).toBe(true);
  expect(r.failure).toBe(true);
  expect(h.world.calls.some((v) => v.path.includes('/activation?'))).toBe(false);
});
it('enforces the effective deadline after final synchronous source proof', async () => {
  const h = await retainedHarness();
  let armed = false,
    offset = 0;
  const now = Date.now.bind(Date);
  vi.spyOn(Date, 'now').mockImplementation(() => now() + offset);
  h.hooks.record = (r) => {
    if (r.stage === 'request' && r.path?.includes('preauditRequested=true')) armed = true;
  };
  h.hooks.verify = () => {
    if (armed) offset = 300001;
  };
  expect((await h.run()).failure).toBe(true);
  expect(h.world.calls.some((v) => v.path.includes('/activation?'))).toBe(false);
});
it.each(['delete-unknown', 'unlock'])('retains honest %s outcome without a second deletion attempt', async (fault) => {
  const h = await retainedHarness();
  h.world.faults.add(fault);
  const r = await h.run();
  expect(r.failure).toBe(true);
  expect(r.inspectionRequired.length).toBeGreaterThan(0);
  expect(h.world.calls.filter((v) => v.method === 'DELETE').length).toBeLessThanOrEqual(1);
});
it.each(['present', 'unknown'])('keeps historical child deletion and later %s evidence distinct', async (fault) => {
  const h = await retainedHarness();
  let deleted = false,
    body = '';
  const reply = h.hooks.reply!;
  h.hooks.record = (r) => {
    if (r.stageStarted === 'delete-ENHO') body = h.world.objects.get(child.owner)!.metadata;
    if (r.stageCompleted === 'delete-ENHO') deleted = true;
  };
  h.hooks.reply = (u, m, b) =>
    deleted && m === 'GET' && u.pathname === child.owner
      ? { statusCode: fault === 'present' ? 200 : 503, data: body }
      : reply(u, m, b);
  const r = await h.run();
  expect(r).toMatchObject({ failure: true, confirmedDeleted: [child.owner] });
  expect(new Set(r.remaining)).toEqual(new Set(f.map((v) => v.owner)));
  expect(h.world.calls.filter((v) => v.method === 'DELETE')).toHaveLength(1);
});

it('keeps only its own unlock available after cancellation under the delete lock', async () => {
  const h = await retainedHarness();
  let armed = false;
  h.hooks.record = (r) => {
    if (r.stageStarted === 'delete-ENHO') armed = true;
    if (armed && r.stage === 'response' && r.path?.includes('_action=LOCK')) h.stop();
  };
  const r = await h.run();
  expect(r).toMatchObject({
    failure: true,
    stopped: true,
    cleanupUnconfirmed: false,
    remaining: f.map((v) => v.owner),
  });
  expect(h.world.calls.some((v) => v.method === 'DELETE')).toBe(false);
  expect(h.world.calls.some((v) => v.path.includes('_action=UNLOCK'))).toBe(true);
});

it('source drift across a semaphore wait refuses the actual first activation send', async () => {
  const { Semaphore } = await import('../../../src/adt/semaphore.js');
  const gate = new Semaphore(1);
  const h = await retainedHarness({ semaphore: gate });
  let acquired = false;
  h.hooks.record = (r) => {
    if (r.stage === 'request' && r.path?.includes('preauditRequested=true'))
      void gate.acquire().then(() => {
        acquired = true;
        h.breakSource();
        gate.release();
      });
  };
  expect((await h.run()).failure).toBe(true);
  expect(acquired).toBe(true);
  expect(h.world.calls.some((v) => v.path.includes('/activation?'))).toBe(false);
});
it('a final unknown inventory retains both owners for inspection after both historical deletes', async () => {
  const h = await retainedHarness();
  let count = 0;
  h.hooks.before = (u) => {
    if (u.pathname === '/sap/bc/adt/activation/inactiveobjects' && ++count === 2)
      throw new Error('Synthetic unknown inventory');
  };
  const r = await h.run();
  expect(r).toMatchObject({
    failure: true,
    confirmedDeleted: [child.owner, parent.owner],
    cleanupUnconfirmed: false,
    finalAbsenceConfirmed: false,
  });
  expect(new Set(r.remaining)).toEqual(new Set(f.map((v) => v.owner)));
});
