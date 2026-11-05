import { expect, it, vi } from 'vitest';
import { cleanupHarness, fixtures, retained } from './pr1142-native-ddic-cleanup-harness.js';

const { structureCleanupPreflight, checkStructureCleanupRequest } = await import(
  '../../../scripts/qualification/pr1142/native-ddic-structure-cleanup-runner.js'
);
const owner = fixtures[0].owner;
it('uses the real context/client/delete pipeline for one exact new retained owner', async () => {
  const h = cleanupHarness(),
    r = await h.run();
  expect(r).toMatchObject({
    failure: false,
    completed: ['delete-TABL/DS'],
    created: [],
    confirmedDeleted: [owner],
    remaining: [],
    inspectionRequired: [],
    cleanupUnconfirmed: false,
    finalAbsenceConfirmed: true,
  });
  expect(h.world.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
  expect(
    h.world.calls.some(
      (c) =>
        c.method === 'PUT' ||
        c.path.startsWith('/sap/bc/adt/activation?') ||
        (c.method === 'POST' && c.path.startsWith('/sap/bc/adt/ddic/structures?')),
    ),
  ).toBe(false);
  expect(h.records.filter((r) => r.snapshot === owner).every((r) => r.nativeVersion === 'new')).toBe(true);
  expect(h.world.calls.filter((c) => c.path.includes('_action=LOCK'))).toHaveLength(1);
  expect(h.world.calls.filter((c) => c.path.includes('_action=UNLOCK'))).toHaveLength(1);
});
it('preflight is seven GETs, retaining native new instead of inferring active or absence', async () => {
  const h = cleanupHarness();
  h.client.safety.allowWrites = false;
  await structureCleanupPreflight(h.client, fixtures, (v) => h.records.push(v), h.verify);
  expect(h.world.calls).toHaveLength(7);
  expect(h.world.calls.every((c) => c.method === 'GET')).toBe(true);
  expect(h.records.some((r) => r.inventoryScope === 'valid-unfiltered' && r.retainedOwner === owner)).toBe(true);
});
it.each(['source', 'active', 'inactive', 'package', 'author', 'responsible', 'description', 'unknown-field'])(
  'refuses changed %s before lock/DELETE and retains known owner',
  async (fault) => {
    const h = cleanupHarness(),
      o = h.world.objects.get(owner)!;
    if (fault === 'source') o.source += '\n';
    else if (fault === 'active' || fault === 'inactive')
      o.metadata = o.metadata.replace('version="new"', `version="${fault}"`);
    else if (fault === 'package') o.metadata = o.metadata.replace('$TMP', 'ZFOREIGN');
    else if (fault === 'author') o.metadata = o.metadata.replace('createdBy="MARIAN"', 'createdBy="OTHER"');
    else if (fault === 'responsible') o.metadata = o.metadata.replace('responsible="MARIAN"', 'responsible="OTHER"');
    else if (fault === 'description') o.metadata = o.metadata.replace('ARC1 collections', 'OTHER collections');
    else o.metadata = o.metadata.replace('<blue:blueSource ', '<blue:blueSource unknown="new" ');
    const r = await h.run();
    expect(r).toMatchObject({ failure: true, remaining: [owner], inspectionRequired: [owner], confirmedDeleted: [] });
    expect(h.world.calls.some((c) => c.method === 'DELETE' || c.path.includes('_action=LOCK'))).toBe(false);
  },
);
it.each(['source', 'metadata'])(
  'repeats exact %s proof under its owning lock and still unlocks on refusal',
  async (kind) => {
    const h = cleanupHarness();
    h.hooks.before = (url) => {
      if (url.searchParams.get('_action') === 'LOCK') {
        const o = h.world.objects.get(owner)!;
        if (kind === 'source') o.source += ' changed';
        else o.metadata = o.metadata.replace('description="ARC1', 'description="OTHER');
      }
    };
    const r = await h.run();
    expect(r).toMatchObject({ failure: true, remaining: [owner], cleanupUnconfirmed: false });
    expect(h.world.calls.some((c) => c.method === 'DELETE')).toBe(false);
    expect(h.world.calls.some((c) => c.path.includes('_action=UNLOCK'))).toBe(true);
  },
);
it('retains submitted deletion uncertainty without retry or other cleanup mutation', async () => {
  const h = cleanupHarness();
  h.world.faults.add('delete-unknown');
  const r = await h.run();
  expect(r).toMatchObject({ failure: true, remaining: [owner], confirmedDeleted: [] });
  expect(h.world.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
  expect(h.world.calls.some((c) => c.path.includes('_action=UNLOCK'))).toBe(true);
});
it.each(['present', 'uncertain'])(
  'keeps historical deletion but current residual after a later %s observation',
  async (kind) => {
    const h = cleanupHarness();
    let armed = false,
      observed = 0;
    h.hooks.record = (row) => {
      if (row.stageCompleted === 'delete-TABL/DS') armed = true;
    };
    h.hooks.before = (url, init) => {
      if (armed && init.method === 'GET' && url.pathname === owner) {
        observed++;
        if (kind === 'present') h.world.objects.get(owner)!.metadata = retained.metadata;
        else throw new Error('Synthetic absence unavailable');
      }
    };
    const r = await h.run();
    expect(observed).toBe(1);
    expect(r).toMatchObject({
      failure: true,
      confirmedDeleted: [owner],
      remaining: [owner],
      inspectionRequired: [owner],
      finalAbsenceConfirmed: false,
    });
    expect(h.world.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
  },
);
it('terminal source/history drift never erases confirmed native deletion facts', async () => {
  const h = cleanupHarness();
  h.hooks.before = (url, init) => {
    if (
      init.method === 'GET' &&
      url.pathname === '/sap/bc/adt/activation/inactiveobjects' &&
      h.world.calls.some((c) => c.method === 'DELETE')
    )
      h.breakSource();
  };
  const r = await h.run();
  expect(r.failure).toBe(true);
  expect(r.confirmedDeleted).toEqual([owner]);
  expect(r.inspectionRequired).toEqual([owner]);
  expect(h.world.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
});
it('rechecks history/freshness after final synchronous DELETE proof, preserving owning unlock', async () => {
  const h = cleanupHarness();
  let now = Date.now(),
    armed = false;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  h.hooks.record = (r) => {
    if (r.stage === 'request' && r.method === 'DELETE') armed = true;
  };
  h.hooks.verify = () => {
    if (armed) now += 30_001;
  };
  const r = await h.run();
  expect(r.failure).toBe(true);
  expect(h.world.calls.some((c) => c.method === 'DELETE')).toBe(false);
  expect(h.world.calls.some((c) => c.path.includes('_action=UNLOCK'))).toBe(true);
});
it.each([
  ['PUT', `${owner}/source/main?lockHandle=x`],
  ['POST', '/sap/bc/adt/ddic/structures?_package=$TMP'],
  ['POST', '/sap/bc/adt/activation?method=activate&preauditRequested=false'],
  ['DELETE', `${owner}?lockHandle=x&cascade=true`],
  ['DELETE', '/sap/bc/adt/ddic/structures/OTHER?lockHandle=x'],
])('refuses out-of-graph %s %s', (method, path) =>
  expect(() => checkStructureCleanupRequest(fixtures, fixtures[0], 'delete-TABL/DS', method, path, '')).toThrow(),
);
it('refuses changed client policy or owner graph before DELETE', async () => {
  const h = cleanupHarness();
  h.client.safety.allowedPackages = ['*'];
  await expect(h.run()).rejects.toThrow('policy');
  expect(h.world.calls).toHaveLength(0);
  const j = cleanupHarness();
  await expect(j.run([{ ...fixtures[0], name: 'OTHER' }])).rejects.toThrow('graph');
  expect(j.world.calls).toHaveLength(0);
});
