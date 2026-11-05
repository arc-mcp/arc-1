import { expect, it } from 'vitest';
import { tableDeletedOwners } from '../../../scripts/qualification/pr1142/native-ddic-table-fixtures.js';
import {
  settingsTailOwners,
  TABLE_SETTINGS_STAGES,
} from '../../../scripts/qualification/pr1142/native-ddic-table-settings-fixed.js';
import { fixtures, settingsTailHarness } from './pr1142-native-ddic-table-settings-harness.js';

const { checkSettingsTailRequest } = await import(
  '../../../scripts/qualification/pr1142/native-ddic-table-settings-runner.js'
);
it.each([false, true])('actual fixed tail through direct/proxy factory and HTTP %s', async (proxy) => {
  const h = settingsTailHarness({ proxy }),
    r = await h.run();
  expect(r, JSON.stringify(h.records.slice(-10))).toMatchObject({
    failure: false,
    completed: TABLE_SETTINGS_STAGES,
    created: fixtures.slice(2).map((f) => f.owner),
    confirmedDeleted: tableDeletedOwners(fixtures),
    removedWithParent: [fixtures[1].owner],
    remaining: [],
    inspectionRequired: [],
    cleanupUnconfirmed: false,
    finalAbsenceConfirmed: true,
  });
  expect(h.records.some((r) => (r as any).implicitActivationParentRefreshed === fixtures[0].owner)).toBe(true);
  expect(
    h.world.calls.some(
      (c) => c.method === 'PUT' && (c.path.startsWith(fixtures[0].owner) || c.path.startsWith(fixtures[1].owner)),
    ),
  ).toBe(false);
  expect(h.world.calls.some((c) => c.method === 'POST' && c.path === '/sap/bc/adt/ddic/tables')).toBe(false);
  expect(h.world.calls.filter((c) => c.path.startsWith('/sap/bc/adt/activation?'))[0].body).toContain(
    fixtures[1].owner,
  );
  expect(h.world.calls.filter((c) => c.method === 'DELETE').map((c) => c.path.split('?')[0])).toEqual(
    tableDeletedOwners(fixtures),
  );
});
it.each(['table', 'table-inactive', 'source', 'settings', 'settings-active', 'etag', 'creator', 'opaque'])(
  'initial %s drift stops before mutations',
  async (fault) => {
    const h = settingsTailHarness(),
      table = h.world.objects.get(fixtures[0].owner)!,
      settings = h.world.objects.get(fixtures[1].owner)!;
    if (fault === 'table') table.metadata += ' ';
    if (fault === 'table-inactive') h.views.tableInactive += ' ';
    if (fault === 'source') table.source += ' ';
    if (fault === 'settings') settings.metadata += ' ';
    if (fault === 'settings-active') h.views.settingsActive = h.views.settingsActive.replace('>0<', '>2<');
    if (fault === 'etag') h.views.tableInactive = h.views.tableInactive.replace('000text/plain2', '001text/plain2');
    if (fault === 'creator') table.metadata = table.metadata.replace('createdBy="MARIAN"', 'createdBy="OTHER"');
    if (fault === 'opaque')
      h.views.tableInactive = h.views.tableInactive.replace('fixPointArithmetic="false"', 'fixPointArithmetic="true"');
    const r = await h.run();
    expect(r.failure).toBe(true);
    expect(r.remaining).toEqual(settingsTailOwners());
    expect(h.world.calls.some((c) => !['GET', 'HEAD'].includes(c.method))).toBe(false);
  },
);
it.each(['parent-source', 'parent-link', 'parent-draft', 'settings-opaque'])(
  'owned activation refuses unrelated %s changes before children',
  async (fault) => {
    const h = settingsTailHarness(),
      previous = h.hooks.reply!;
    h.hooks.reply = (u, m, b) => {
      const result = previous(u, m, b);
      if (
        m === 'POST' &&
        u.pathname === '/sap/bc/adt/activation' &&
        u.searchParams.get('preauditRequested') === 'false' &&
        b.includes(fixtures[1].owner)
      ) {
        const table = h.world.objects.get(fixtures[0].owner)!,
          settings = h.world.objects.get(fixtures[1].owner)!;
        if (fault === 'parent-source') table.source += 'foreign';
        if (fault === 'parent-link')
          table.metadata = table.metadata.replace('title="Documentation"', 'title="Foreign"');
        if (fault === 'parent-draft') table.metadata = table.metadata.replace('version="active"', 'version="inactive"');
        if (fault === 'settings-opaque') settings.metadata = settings.metadata.replace('>APPL0<', '>APPL1<');
      }
      return result;
    };
    const r = await h.run();
    expect(r.failure).toBe(true);
    expect(r.stoppedAt).toBe('activate-TABL/DTT');
    expect(h.world.calls.some((c) => c.method === 'POST' && c.path === '/sap/bc/adt/ddic/lockobjects/sources')).toBe(
      false,
    );
    expect(r.remaining).toEqual(settingsTailOwners());
  },
);
it.each(['create-ENQU', 'create-TABL/DTI', 'delete-TABL/DTI', 'delete-ENQU', 'delete-TABL/DT'])(
  'refreshed parent receipt drift blocks %s native write',
  async (stage) => {
    const h = settingsTailHarness();
    h.hooks.record = (r: any) => {
      if (r.stageStarted === stage) h.world.objects.get(fixtures[0].owner)!.metadata += ' ';
    };
    const r = await h.run();
    expect(r.failure).toBe(true);
    expect(r.stoppedAt).toBe(stage);
    expect(r.inspectionRequired).toContain(fixtures[0].owner);
    const selected = fixtures.find((f) => stage.endsWith('-' + f.type))!;
    expect(h.world.calls.some((c) => c.method === 'DELETE' && c.path.split('?')[0] === selected.owner)).toBe(false);
  },
);
it('settings drift before parent delete is retained without deleting the implicit child', async () => {
  const h = settingsTailHarness();
  h.hooks.record = (r: any) => {
    if (r.stageStarted === 'delete-TABL/DT')
      h.world.objects.get(fixtures[1].owner)!.metadata = h.world.objects
        .get(fixtures[1].owner)!
        .metadata.replace('>2<', '>3<');
  };
  const r = await h.run();
  expect(r.failure).toBe(true);
  expect(r.confirmedDeleted).toEqual([fixtures[3].owner, fixtures[2].owner]);
  expect(r.remaining).toEqual(settingsTailOwners());
  expect(h.world.calls.some((c) => c.method === 'DELETE' && c.path.startsWith(fixtures[0].owner))).toBe(false);
});
it.each(['create-TABL/DT', 'activate-TABL/DT', 'adopt-TABL/DTT', 'stale-TABL/DTT', 'update-TABL/DTT'])(
  'completed prefix %s can never enter wire scope',
  (stage) => {
    expect(() => checkSettingsTailRequest(fixtures, fixtures[0], stage, 'GET', fixtures[0].owner)).toThrow();
  },
);
it.each([false, true])('stop after activation dependency reads refuses dispatch, proxy%s', async (proxy) => {
  const h = settingsTailHarness({ proxy });
  h.hooks.record = (r: any) => {
    if (r.phase === 'activate-TABL/DTT' && r.stage === 'response' && r.path?.includes(fixtures[0].owner)) h.stop();
  };
  const r = await h.run();
  expect(r.failure).toBe(true);
  expect(h.world.calls.some((c) => c.method === 'POST' && c.path.startsWith('/sap/bc/adt/activation?'))).toBe(false);
  expect(r.remaining).toEqual(settingsTailOwners());
});

it.each([false, true])(
  'deadline expiry after native dependency proof refuses the first activation, proxy%s',
  async (proxy) => {
    const h = settingsTailHarness({ proxy });
    const original = Date.now;
    let expired = false;
    const { vi } = await import('vitest');
    vi.spyOn(Date, 'now').mockImplementation(() => original() + (expired ? 300000 : 0));
    h.hooks.record = (r: any) => {
      if (r.phase === 'activate-TABL/DTT' && r.stage === 'response' && r.path?.includes(fixtures[0].owner))
        expired = true;
    };
    const r = await h.run();
    expect(r.failure).toBe(true);
    expect(h.world.calls.some((c) => c.method === 'POST' && c.path.startsWith('/sap/bc/adt/activation?'))).toBe(false);
    expect(r.remaining).toEqual(settingsTailOwners());
  },
);
it('a later uncertain absence reinstates a historically deleted owner in residuals', async () => {
  const h = settingsTailHarness();
  let final = false;
  const previous = h.hooks.reply!;
  h.hooks.record = (r: any) => {
    if (r.stageCompleted === 'delete-TABL/DT') final = true;
  };
  h.hooks.reply = (u, m, b) =>
    final && m === 'GET' && u.pathname === fixtures[3].owner
      ? { statusCode: 503, data: 'uncertain' }
      : previous(u, m, b);
  const r = await h.run();
  expect(r.failure).toBe(true);
  expect(r.confirmedDeleted).toContain(fixtures[3].owner);
  expect(r.remaining).toContain(fixtures[3].owner);
  expect(r.inspectionRequired).toContain(fixtures[3].owner);
  expect(r.cleanupUnconfirmed).toBe(false);
});
