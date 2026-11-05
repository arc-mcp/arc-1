import { expect, it, vi } from 'vitest';
import { TABLE_STAGES, tableDeletedOwners } from '../../../scripts/qualification/pr1142/native-ddic-table-fixtures.js';
import {
  indexTailOwners,
  TABLE_INDEX_STAGES,
} from '../../../scripts/qualification/pr1142/native-ddic-table-index-fixed.js';
import { fixtures, indexTailHarness } from './pr1142-native-ddic-table-index-harness.js';

const { checkIndexTailRequest } = await import(
  '../../../scripts/qualification/pr1142/native-ddic-table-index-runner.js'
);
it.each([false, true])('fixed direct/proxy activation then three deletes only %s', async (proxy) => {
  const h = indexTailHarness({ proxy }),
    r = await h.run();
  expect(r, JSON.stringify(h.records.slice(-8))).toMatchObject({
    failure: false,
    completed: TABLE_INDEX_STAGES,
    created: [],
    retainedOwners: indexTailOwners(),
    confirmedDeleted: tableDeletedOwners(fixtures),
    removedWithParent: [fixtures[1].owner],
    remaining: [],
    inspectionRequired: [],
    cleanupUnconfirmed: false,
    finalAbsenceConfirmed: true,
  });
  expect(h.world.calls.filter((c) => c.method === 'DELETE').map((c) => c.path.split('?')[0])).toEqual(
    tableDeletedOwners(fixtures),
  );
  expect(
    h.world.calls
      .filter((c) => c.path.startsWith('/sap/bc/adt/activation?'))
      .every((c) => c.body.includes(fixtures[3].owner) && !c.body.includes(fixtures[0].owner)),
  ).toBe(true);
  expect(h.world.calls.some((c) => c.method === 'PUT')).toBe(false);
  expect(h.records.some((r: any) => r.implicitActivationParentRefreshed)).toBe(false);
});
it.each([
  'table',
  'table-source',
  'settings',
  'enqu',
  'index',
  'index-source',
  'active-index',
  'active-source',
  'opaque',
  'creator',
  'foreign-alias',
  'double-encoding',
])('initial %s drift refuses every mutation', async (fault) => {
  const h = indexTailHarness(),
    o = fixtures.map((f) => h.world.objects.get(f.owner)!);
  if (fault === 'table') o[0].metadata += ' ';
  if (fault === 'table-source') o[0].source += ' ';
  if (fault === 'settings') o[1].metadata += ' ';
  if (fault === 'enqu') o[2].metadata += ' ';
  if (fault === 'index') o[3].metadata += ' ';
  if (fault === 'index-source') o[3].source += ' ';
  if (fault === 'active-index') h.views.indexActive += ' ';
  if (fault === 'active-source') h.views.indexActiveSource += ' ';
  if (fault === 'opaque')
    o[3].metadata = o[3].metadata.replace('fixPointArithmetic="false"', 'fixPointArithmetic="true"');
  if (fault === 'creator') o[3].metadata = o[3].metadata.replace('createdBy="MARIAN"', 'createdBy="OTHER"');
  if (fault === 'foreign-alias') o[3].metadata = o[3].metadata.replace('%7e001?version', '%7e002?version');
  if (fault === 'double-encoding') o[3].metadata = o[3].metadata.replace('%7e001?version', '%257e001?version');
  const r = await h.run();
  expect(r.failure).toBe(true);
  expect(r.remaining).toEqual(indexTailOwners());
  expect(h.world.calls.some((c) => !['GET', 'HEAD'].includes(c.method))).toBe(false);
});
it.each(TABLE_STAGES.slice(0, 15))('never authorizes consumed %s stage', (stage) => {
  expect(() => checkIndexTailRequest(fixtures, fixtures[3], stage, 'GET', fixtures[3].owner)).toThrow();
});
it.each(['reactivate-TABL/DTI', 'delete-TABL/DTI', 'delete-ENQU', 'delete-TABL/DT'])(
  'parent drift before %s refuses further native mutation',
  async (stage) => {
    const h = indexTailHarness();
    h.hooks.record = (r: any) => {
      if (r.stageStarted === stage) h.world.objects.get(fixtures[0].owner)!.metadata += ' ';
    };
    const r = await h.run();
    expect(r.failure).toBe(true);
    expect(r.stoppedAt).toBe(stage);
    expect(r.remaining).toContain(fixtures[0].owner);
    const selected = fixtures.find((f) => stage.endsWith('-' + f.type))!;
    expect(h.world.calls.some((c) => c.method === 'DELETE' && c.path.split('?')[0] === selected.owner)).toBe(false);
  },
);
it('implicit settings drift blocks parent delete after two confirmed deletions', async () => {
  const h = indexTailHarness();
  h.hooks.record = (r: any) => {
    if (r.stageStarted === 'delete-TABL/DT') h.world.objects.get(fixtures[1].owner)!.metadata += ' ';
  };
  const r = await h.run();
  expect(r.confirmedDeleted).toEqual([fixtures[3].owner, fixtures[2].owner]);
  expect(r.remaining).toEqual(indexTailOwners().slice(0, 2));
  expect(r.cleanupUnconfirmed).toBe(false);
});
it.each([false, true])('expiry during final proof refuses activation before send %s', async (proxy) => {
  const h = indexTailHarness({ proxy }),
    now = Date.now;
  let expired = false;
  vi.spyOn(Date, 'now').mockImplementation(() => now() + (expired ? 300000 : 0));
  h.hooks.record = (r: any) => {
    if (r.phase === 'reactivate-TABL/DTI' && r.stage === 'response' && r.path === fixtures[0].owner.toLowerCase())
      expired = true;
  };
  const r = await h.run();
  expect(r.failure).toBe(true);
  expect(h.world.calls.some((c) => c.path.startsWith('/sap/bc/adt/activation?'))).toBe(false);
  expect(r.remaining).toEqual(indexTailOwners());
});
it.each([false, true])('post-lock proof failure still sends own UNLOCK only %s', async (proxy) => {
  const h = indexTailHarness({ proxy });
  h.hooks.record = (r: any) => {
    if (r.phase === 'delete-TABL/DTI' && r.stage === 'response' && r.path?.includes('_action=LOCK')) h.breakSource();
  };
  const r = await h.run();
  expect(r.failure).toBe(true);
  expect(r.cleanupUnconfirmed).toBe(false);
  expect(h.world.calls.some((c) => c.method === 'DELETE')).toBe(false);
  expect(h.world.calls.some((c) => c.path.includes('_action=UNLOCK'))).toBe(true);
  expect(r.remaining).toEqual(indexTailOwners());
});
it('uncertain DELETE is one-shot and retains all current owners', async () => {
  const h = indexTailHarness();
  h.world.faults.add('delete-unknown');
  const r = await h.run();
  expect(r.failure).toBe(true);
  expect(h.world.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
  expect(r.remaining).toEqual(indexTailOwners());
  expect(r.confirmedDeleted).toEqual([]);
});

it('final contradictory presence retains inspection owner without replaying confirmed deletes', async () => {
  const h = indexTailHarness(),
    original = h.hooks.reply!,
    saved = h.world.objects.get(fixtures[3].owner)!.metadata;
  h.hooks.reply = (u, m, b) => {
    if (m === 'GET' && u.pathname === fixtures[3].owner && !h.world.objects.get(fixtures[0].owner)!.metadata)
      return { statusCode: 200, data: saved, responseOptions: { headers: { 'content-type': 'application/xml' } } };
    return original(u, m, b);
  };
  const r = await h.run();
  expect(r.failure).toBe(true);
  expect(r.confirmedDeleted).toEqual(tableDeletedOwners(fixtures));
  expect(r.remaining).toEqual([fixtures[3].owner]);
  expect(r.inspectionRequired).toContain(fixtures[3].owner);
  expect(r.finalAbsenceConfirmed).toBe(false);
  expect(h.world.calls.filter((c) => c.method === 'DELETE')).toHaveLength(3);
});
it('cleanup failure preserves confirmed deletion and lists its own session for inspection', async () => {
  const h = indexTailHarness();
  h.world.faults.add('unlock');
  const r = await h.run();
  expect(r.failure).toBe(true);
  expect(r.cleanupUnconfirmed).toBe(true);
  expect(r.inspectionRequired).toContain(fixtures[3].owner);
  expect(h.world.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
});

it.each([false, true])('effective per-request expiry during auth wait prevents activation %s', async (proxy) => {
  let pending = false,
    expired = false;
  const now = Date.now;
  vi.spyOn(Date, 'now').mockImplementation(() => now() + (expired ? 31000 : 0));
  const h = indexTailHarness({
    proxy,
    token: async () => {
      if (pending) expired = true;
      return 'synthetic-token';
    },
  });
  h.hooks.record = (r: any) => {
    if (r.stage === 'request' && r.method === 'POST' && r.path?.startsWith('/sap/bc/adt/activation?')) pending = true;
  };
  const r = await h.run();
  expect(pending).toBe(true);
  expect(expired).toBe(true);
  expect(r.failure).toBe(true);
  expect(h.world.calls.some((c) => c.method === 'POST' && c.path.startsWith('/sap/bc/adt/activation?'))).toBe(false);
  expect(r.remaining).toEqual(indexTailOwners());
});
