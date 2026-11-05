import { expect, it, vi } from 'vitest';
import { ENHO_STAGES } from '../../../scripts/qualification/pr1142/native-enho-fixtures.js';
import { enhoHarness, fixtures } from './pr1142-native-enho-harness.js';

it.each([false, true])(
  'composes the two-owner lifecycle through actual adapters and both dispatchers (proxy=%s)',
  async (proxy) => {
    const h = enhoHarness({ proxy }),
      result = await h.run();
    expect(h.world.unexpected).toEqual([]);
    expect(
      result,
      JSON.stringify(h.records.filter((v) => v.failure === true || v.adapter || v.stage === 'refused-before-send')),
    ).toMatchObject({
      failure: false,
      completed: [...ENHO_STAGES],
      created: fixtures.map((v) => v.owner),
      confirmedDeleted: [...fixtures].reverse().map((v) => v.owner),
      remaining: [],
      inspectionRequired: [],
      cleanupUnconfirmed: false,
      finalAbsenceConfirmed: true,
    });
    expect(h.world.calls.filter((v) => v.method === 'DELETE').map((v) => v.path.split('?')[0])).toEqual(
      [...fixtures].reverse().map((v) => v.owner),
    );
    expect(h.world.calls.filter((v) => v.method === 'PUT')).toHaveLength(3);
    expect(
      h.world.calls.some((v) => ['PUT', 'DELETE', 'POST'].includes(v.method) && /enhsxsb|interfaces/.test(v.path)),
    ).toBe(false);
    expect(h.records.filter((v) => v.ownSessionClosed !== undefined).every((v) => v.ownSessionClosed === true)).toBe(
      true,
    );
  },
);

const child = fixtures[1],
  parent = fixtures[0];
it('preflight reads only fixed discovery, dependencies, two absences and inventory', async () => {
  const { enhoGetOnlyPreflight } = await import('../../../scripts/qualification/pr1142/native-enho-runner.js');
  const h = enhoHarness();
  await enhoGetOnlyPreflight(h.client, fixtures, h.records.push.bind(h.records), h.verify);
  expect(h.world.calls.every((v) => v.method === 'GET')).toBe(true);
  expect(h.world.calls).toHaveLength(7);
});
it.each(['create-unknown', 'save-unknown', 'unlock', 'delete-unknown'])(
  'stops after %s without catch cleanup or replay',
  async (fault) => {
    const h = enhoHarness();
    h.world.faults.add(fault);
    const r = await h.run();
    expect(r.failure).toBe(true);
    expect(r.inspectionRequired.length).toBeGreaterThan(0);
    expect(h.world.calls.filter((v) => v.method === 'DELETE')).toHaveLength(fault === 'delete-unknown' ? 1 : 0);
  },
);
it.each([false, true])('rechecks the owned parent inside the actual child POST path proxy=%s', async (proxy) => {
  const h = enhoHarness({ proxy });
  let armed = false,
    drift = false;
  h.hooks.record = (r) => {
    if (r.stageStarted === 'create-ENHO') armed = true;
  };
  h.hooks.before = (u, init) => {
    if (armed && !drift && init.method === 'POST' && u.pathname === '/sap/bc/adt/cts/transportchecks') {
      drift = true;
      h.world.objects.get(parent.owner)!.source += 'foreign';
    }
  };
  const r = await h.run();
  expect(drift).toBe(true);
  expect(r.failure).toBe(true);
  expect(r.created).toEqual([parent.owner]);
  expect(
    h.world.calls.some(
      (v) => v.method === 'POST' && v.path.split('?')[0] === child.owner.slice(0, child.owner.lastIndexOf('/')),
    ),
  ).toBe(false);
});
it.each(['creator', 'package', 'opaque', 'filter', 'class'])(
  'refuses a changed %s after activation before an update',
  async (fault) => {
    const h = enhoHarness();
    h.hooks.record = (r) => {
      if (r.stageCompleted === 'activate-ENHO') {
        const o = h.world.objects.get(child.owner)!;
        o.metadata =
          fault === 'creator'
            ? o.metadata.replaceAll('MARIAN', 'OTHER')
            : fault === 'package'
              ? o.metadata.replace('$TMP', 'ZFOREIGN')
              : fault === 'opaque'
                ? o.metadata.replace('</enho:objectData>', '<x:opaque xmlns:x="urn:foreign"/></enho:objectData>')
                : fault === 'filter'
                  ? o.metadata.replace('/arc1/qualification/', '/foreign/')
                  : o.metadata.replace(parent.name, 'ZCL_FOREIGN');
      }
    };
    expect((await h.run()).failure).toBe(true);
    expect(h.world.calls.filter((v) => v.method === 'PUT' && v.path.startsWith(child.owner))).toHaveLength(1);
    expect(h.world.calls.some((v) => v.method === 'DELETE')).toBe(false);
  },
);
it('preserves the active counterpart while saving the owned draft', async () => {
  const h = enhoHarness();
  let puts = 0;
  h.hooks.record = (r) => {
    if (r.stage === 'response' && r.method === 'PUT' && r.path === child.owner && ++puts === 2)
      h.changeActive(h.activeDocument()!.replace('enho:active="false"', 'enho:active="true"'));
  };
  const r = await h.run();
  expect(puts).toBe(2);
  expect(r.failure).toBe(true);
  expect(r.completed).not.toContain('update-ENHO');
  expect(h.world.calls.some((v) => v.method === 'DELETE')).toBe(false);
});
it.each([false, true])('refuses source drift after token awaits before first CREATE proxy=%s', async (proxy) => {
  let intent = false;
  const h = enhoHarness({
    proxy,
    token: async () => {
      await Promise.resolve();
      if (intent) h.breakSource();
      return 'synthetic-token';
    },
  });
  h.hooks.record = (r) => {
    if (r.stage === 'request' && r.method === 'POST' && r.path === '/sap/bc/adt/oo/classes') intent = true;
  };
  const r = await h.run();
  expect(intent).toBe(true);
  expect(r.failure).toBe(true);
  expect(h.world.calls.some((v) => v.method === 'POST' && v.path === '/sap/bc/adt/oo/classes')).toBe(false);
});
it('checks the effective absolute deadline after synchronous source proof', async () => {
  const h = enhoHarness(),
    now = Date.now.bind(Date);
  let offset = 0,
    intent = false;
  vi.spyOn(Date, 'now').mockImplementation(() => now() + offset);
  h.hooks.record = (r) => {
    if (r.stage === 'request' && r.method === 'POST' && r.path === '/sap/bc/adt/oo/classes') intent = true;
  };
  h.hooks.verify = () => {
    if (intent) offset = 300001;
  };
  expect((await h.run()).failure).toBe(true);
  expect(intent).toBe(true);
  expect(h.world.calls.some((v) => v.method === 'POST' && v.path === '/sap/bc/adt/oo/classes')).toBe(false);
});
it('keeps owning unlock and session close available after a stop on ENHO PUT', async () => {
  const h = enhoHarness();
  h.hooks.record = (r) => {
    if (r.stage === 'response' && r.method === 'PUT' && r.path === child.owner) h.stop();
  };
  const r = await h.run();
  expect(r).toMatchObject({ failure: true, stopped: true, cleanupUnconfirmed: false });
  expect(r.remaining).toContain(child.owner);
  expect(
    h.world.calls.some(
      (v) => v.method === 'POST' && v.path.startsWith(child.owner + '?') && v.path.includes('_action=UNLOCK'),
    ),
  ).toBe(true);
  expect(h.world.calls.some((v) => v.method === 'DELETE')).toBe(false);
});
it.each(['present', 'unknown'])(
  'retains historical deletion plus later %s child evidence before parent deletion',
  async (fault) => {
    const h = enhoHarness();
    let deleted = false,
      old = '';
    const reply = h.hooks.reply!;
    h.hooks.record = (r) => {
      if (r.stageStarted === 'delete-ENHO') old = h.world.objects.get(child.owner)!.metadata;
      if (r.stageCompleted === 'delete-ENHO') deleted = true;
    };
    h.hooks.reply = (u, m, b) => {
      if (deleted && m === 'GET' && u.pathname === child.owner)
        return { statusCode: fault === 'present' ? 200 : 503, data: fault === 'present' ? old : '' };
      return reply(u, m, b);
    };
    const r = await h.run();
    expect(r).toMatchObject({ failure: true, confirmedDeleted: [child.owner], cleanupUnconfirmed: false });
    expect(new Set(r.remaining)).toEqual(new Set([parent.owner, child.owner]));
    expect(new Set(r.inspectionRequired)).toEqual(new Set([parent.owner, child.owner]));
    expect(h.world.calls.filter((v) => v.method === 'DELETE')).toHaveLength(1);
  },
);
it('detects a changed dependency after all deletions without hiding historical success', async () => {
  const h = enhoHarness();
  h.hooks.record = (r) => {
    if (r.stageCompleted === 'delete-CLAS') h.dependency.source += 'foreign';
  };
  const r = await h.run();
  expect(r).toMatchObject({
    failure: true,
    confirmedDeleted: [child.owner, parent.owner],
    cleanupUnconfirmed: false,
    finalAbsenceConfirmed: false,
  });
  expect(r.inspectionRequired).toHaveLength(2);
});
it('refuses an altered fixed owner graph before any native call', async () => {
  const h = enhoHarness();
  await expect(h.run(fixtures.map((f) => ({ ...f, description: 'foreign' })))).rejects.toThrow();
  expect(h.world.calls).toEqual([]);
});

it.each([false, true])('rechecks the parent under the child lock before update PUT proxy=%s', async (proxy) => {
  const h = enhoHarness({ proxy });
  let update = false,
    changed = false;
  h.hooks.record = (r) => {
    if (r.stageStarted === 'update-ENHO') update = true;
  };
  h.hooks.before = (u, v) => {
    if (
      update &&
      !changed &&
      v.method === 'POST' &&
      u.pathname === child.owner &&
      u.searchParams.get('_action') === 'LOCK'
    ) {
      changed = true;
      h.world.objects.get(parent.owner)!.source += 'foreign';
    }
  };
  const r = await h.run();
  expect(changed).toBe(true);
  expect(r).toMatchObject({ failure: true, cleanupUnconfirmed: false });
  expect(h.world.calls.filter((v) => v.method === 'PUT' && v.path.startsWith(child.owner))).toHaveLength(1);
  expect(h.world.calls.some((v) => v.method === 'DELETE')).toBe(false);
});
it('checks source after the semaphore wait before first CREATE', async () => {
  const { Semaphore } = await import('../../../src/adt/semaphore.js');
  const gate = new Semaphore(1);
  const h = enhoHarness({ semaphore: gate });
  let acquired = false;
  h.hooks.record = (r) => {
    if (r.stage === 'request' && r.method === 'POST' && r.path === '/sap/bc/adt/oo/classes') {
      void gate.acquire().then(() => {
        acquired = true;
        h.breakSource();
        gate.release();
      });
    }
  };
  const r = await h.run();
  expect(acquired).toBe(true);
  expect(r.failure).toBe(true);
  expect(h.world.calls.some((v) => v.method === 'POST' && v.path === '/sap/bc/adt/oo/classes')).toBe(false);
});
it('records a final unknown inventory as both owners requiring inspection after historical deletes', async () => {
  const h = enhoHarness();
  let count = 0;
  h.hooks.before = (u) => {
    if (u.pathname === '/sap/bc/adt/activation/inactiveobjects' && ++count === 2)
      throw new Error('Synthetic final inventory unavailable');
  };
  const r = await h.run();
  expect(r).toMatchObject({
    failure: true,
    confirmedDeleted: [child.owner, parent.owner],
    cleanupUnconfirmed: false,
    finalAbsenceConfirmed: false,
  });
  expect(new Set(r.remaining)).toEqual(new Set([parent.owner, child.owner]));
  expect(new Set(r.inspectionRequired)).toEqual(new Set([parent.owner, child.owner]));
});
