import { expect, it } from 'vitest';
import { ddicHash } from '../../../scripts/qualification/pr1142/native-ddic-evidence.js';
import { tableDeletedOwners } from '../../../scripts/qualification/pr1142/native-ddic-table-fixtures.js';
import {
  retainedTableOwners,
  TABLE_RETAINED_RECEIPTS,
  TABLE_RETAINED_STAGES,
} from '../../../scripts/qualification/pr1142/native-ddic-table-retained-fixed.js';
import {
  fixtures,
  retainedMetadata,
  retainedSettings,
  retainedSource,
  retainedTableHarness,
} from './pr1142-native-ddic-table-retained-harness.js';

const { checkRetainedTableRequest } = await import(
  '../../../scripts/qualification/pr1142/native-ddic-table-retained-runner.js'
);
it('actual retained raw bytes and saved hash are unchanged', () => {
  expect(ddicHash(retainedMetadata)).toBe(TABLE_RETAINED_RECEIPTS.metadata);
  expect(ddicHash(retainedSettings)).toBe(TABLE_RETAINED_RECEIPTS.settings);
  expect(ddicHash(retainedSource)).toBe(TABLE_RETAINED_RECEIPTS.source);
  expect(Buffer.byteLength(retainedSource)).toBe(360);
});
it.each([false, true])('real factory/client remaining graph, direct/proxy %s', async (proxy) => {
  const h = retainedTableHarness({ proxy }),
    r = await h.run();
  expect(r, JSON.stringify(h.records.slice(-20))).toMatchObject({
    failure: false,
    completed: TABLE_RETAINED_STAGES,
    retainedOwners: retainedTableOwners(),
    created: fixtures.slice(2).map((f) => f.owner),
    confirmedDeleted: tableDeletedOwners(fixtures),
    removedWithParent: [fixtures[1].owner],
    remaining: [],
    inspectionRequired: [],
    cleanupUnconfirmed: false,
    finalAbsenceConfirmed: true,
  });
  expect(h.world.calls.some((c) => c.method === 'POST' && c.path.split('?')[0] === '/sap/bc/adt/ddic/tables')).toBe(
    false,
  );
  expect(h.world.calls.some((c) => c.method === 'PUT' && c.path.startsWith(fixtures[0].owner + '/source/main'))).toBe(
    false,
  );
  expect(h.world.calls.filter((c) => c.method === 'DELETE').map((c) => c.path.split('?')[0])).toEqual(
    tableDeletedOwners(fixtures),
  );
  expect(h.world.unexpected).toEqual([]);
});
it.each([
  'source',
  'metadata',
  'version',
  'creator',
  'package',
  'settings',
  'settingsVersion',
  'presentChild',
  'unknownChild',
])('changed initial %s stops with retained owners and no native mutation', async (fault) => {
  const h = retainedTableHarness(),
    table = h.world.objects.get(fixtures[0].owner)!,
    settings = h.world.objects.get(fixtures[1].owner)!;
  if (fault === 'source') table.source += 'foreign';
  if (fault === 'metadata')
    table.metadata = table.metadata.replace('descriptionTextLimit="-1"', 'descriptionTextLimit="0"') + ' ';
  if (fault === 'version') table.metadata = table.metadata.replace('version="new"', 'version="active"');
  if (fault === 'creator') table.metadata = table.metadata.replace('createdBy="MARIAN"', 'createdBy="FOREIGN"');
  if (fault === 'package') table.metadata = table.metadata.replace('$TMP', 'ZFOREIGN');
  if (fault === 'settings') settings.metadata += ' ';
  if (fault === 'settingsVersion') settings.metadata = settings.metadata.replace('version="new"', 'version="inactive"');
  if (['presentChild', 'unknownChild'].includes(fault)) {
    const reply = h.hooks.reply!;
    h.hooks.reply = (u, m, b) =>
      m === 'GET' && u.pathname === fixtures[2].owner
        ? { statusCode: fault === 'presentChild' ? 200 : 503, data: 'unexpected' }
        : reply(u, m, b);
  }
  const r = await h.run();
  expect(r.failure).toBe(true);
  expect(r.remaining).toEqual(expect.arrayContaining(retainedTableOwners()));
  expect(h.world.calls.some((c) => !['GET', 'HEAD'].includes(c.method))).toBe(false);
  expect(r.confirmedDeleted).toEqual([]);
  if (['presentChild', 'unknownChild'].includes(fault)) expect(r.inspectionRequired).toContain(fixtures[2].owner);
});
it('retained settings drift after seed refuses the first table activation dispatch', async () => {
  const h = retainedTableHarness();
  h.hooks.record = (r) => {
    if (r.stageStarted === 'activate-TABL/DT') h.world.objects.get(fixtures[1].owner)!.metadata += ' ';
  };
  const r = await h.run();
  expect(r.failure).toBe(true);
  expect(h.world.calls.some((c) => c.method === 'POST' && c.path.startsWith('/sap/bc/adt/activation?'))).toBe(false);
  expect(r.remaining).toEqual(retainedTableOwners());
});
it.each(['create-unknown', 'save-unknown', 'still-inactive', 'unlock', 'delete-unknown'])(
  'later %s retains honest partial facts without catch cleanup',
  async (fault) => {
    const h = retainedTableHarness();
    h.world.faults.add(fault);
    const r = await h.run();
    expect(r.failure).toBe(true);
    expect(r.inspectionRequired.length).toBeGreaterThan(0);
    expect(h.world.calls.filter((c) => c.method === 'DELETE')).toHaveLength(fault === 'delete-unknown' ? 1 : 0);
    expect(h.world.calls.some((c) => c.method === 'PUT' && c.path.startsWith(fixtures[0].owner + '/source/main'))).toBe(
      false,
    );
  },
);
it('explicitly fences repeated table prefix and arbitrary graph/stage requests', () => {
  expect(() =>
    checkRetainedTableRequest(fixtures, fixtures[0], 'create-TABL/DT', 'POST', '/sap/bc/adt/ddic/tables', ''),
  ).toThrow();
  expect(() =>
    checkRetainedTableRequest(
      fixtures,
      fixtures[0],
      'activate-TABL/DT',
      'PUT',
      fixtures[0].owner + '/source/main?lockHandle=x',
      retainedSource,
    ),
  ).toThrow();
  expect(() =>
    checkRetainedTableRequest([...fixtures.slice(1)], undefined, undefined, 'GET', '/sap/bc/adt/discovery'),
  ).toThrow();
});
