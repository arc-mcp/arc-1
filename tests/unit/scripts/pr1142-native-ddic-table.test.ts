import { expect, it, vi } from 'vitest';
import { tableDeletedOwners } from '../../../scripts/qualification/pr1142/native-ddic-table-fixtures.js';
import { fixtures, TABLE_STAGES, tableHarness } from './pr1142-native-ddic-table-harness.js';

it.each([false, true])('real table/settings/ENQU/index graph (%s)', async (proxy) => {
  const h = tableHarness({ proxy });
  const result = await h.run();
  expect(result, JSON.stringify(h.records.slice(-20))).toMatchObject({
    failure: false,
    completed: [...TABLE_STAGES],
    confirmedDeleted: tableDeletedOwners(fixtures),
    removedWithParent: [fixtures[1].owner],
    adopted: [fixtures[1].owner],
    remaining: [],
    inspectionRequired: [],
    finalAbsenceConfirmed: true,
    cleanupUnconfirmed: false,
  });
  expect(h.world.calls.filter((c) => c.method === 'DELETE').map((c) => c.path.split('?')[0])).toEqual(
    tableDeletedOwners(fixtures),
  );
  expect(h.world.calls.filter((c) => c.method === 'PUT')).toHaveLength(5);
  expect(h.world.calls.some((c) => c.method === 'DELETE' && c.path.startsWith(fixtures[1].owner))).toBe(false);
  expect(h.records.filter((r) => r.adapter?.startsWith('stale-')).map((r) => r.result.state)).toEqual([
    'unchanged',
    'unchanged',
    'unchanged',
  ]);
  expect(h.world.unexpected).toEqual([]);
  expect(h.world.calls.length).toBeLessThan(640);
  expect(JSON.stringify(h.records)).not.toContain('native-lock');
});

it.each(['create-unknown', 'save-unknown', 'readback', 'still-inactive', 'unlock', 'delete-unknown'])(
  'uncertain %s stops without catch cleanup',
  async (fault) => {
    const h = tableHarness();
    h.world.faults.add(fault);
    const r = await h.run();
    expect(r.failure).toBe(true);
    expect(r.inspectionRequired).not.toHaveLength(0);
    expect(h.world.calls.filter((c) => c.method === 'DELETE')).toHaveLength(fault === 'delete-unknown' ? 1 : 0);
  },
);
it.each(['creator', 'package', 'source', 'version', 'description'])(
  'table %s drift refuses child mutation',
  async (fault) => {
    const h = tableHarness();
    h.hooks.record = (r) => {
      if (r.stageCompleted === 'activate-TABL/DT') {
        const o = h.world.objects.get(fixtures[0].owner)!;
        if (fault === 'creator') o.metadata = o.metadata.replaceAll('MARIAN', 'OTHER');
        if (fault === 'package') o.metadata = o.metadata.replace('$TMP', 'ZFOREIGN');
        if (fault === 'source') o.source += ' foreign';
        if (fault === 'version') o.metadata = o.metadata.replace('version="active"', 'version="inactive"');
        if (fault === 'description') o.metadata = o.metadata.replace(fixtures[0].description, 'FOREIGN');
      }
    };
    const r = await h.run();
    expect(r).toMatchObject({ failure: true, stoppedAt: 'adopt-TABL/DTT' });
    expect(h.world.calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
    expect(h.world.calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
  },
);
it.each([false, true])('own parent recheck sees drift after child pre-reads (%s)', async (proxy) => {
  const h = tableHarness({ proxy });
  let phase = '';
  h.hooks.record = (r) => {
    if (r.stageStarted) phase = r.stageStarted;
  };
  h.hooks.before = (url, init) => {
    if (
      phase === 'update-TABL/DTT' &&
      init.method === 'GET' &&
      url.pathname === fixtures[1].owner &&
      url.searchParams.get('version') === 'inactive'
    ) {
      const o = h.world.objects.get(fixtures[0].owner)!;
      o.metadata = o.metadata.replace(fixtures[0].description, 'FOREIGN');
    }
  };
  const r = await h.run();
  expect(r.failure).toBe(true);
  expect(h.world.calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
  expect(
    h.world.calls.filter(
      (c) => c.method === 'POST' && c.path.startsWith(fixtures[1].owner) && c.path.includes('_action=UNLOCK'),
    ),
  ).toHaveLength(2);
  expect(r.cleanupUnconfirmed).toBe(false);
});
it.each(['present', 'unknown'])('settings %s after parent deletion stays visible for inspection', async (fault) => {
  const h = tableHarness(),
    reply = h.hooks.reply!;
  let saved = '';
  h.hooks.before = (url, init) => {
    if (init.method === 'DELETE' && url.pathname === fixtures[0].owner)
      saved = h.world.objects.get(fixtures[1].owner)!.metadata;
  };
  h.hooks.reply = (url, m, b) => {
    if (saved && m === 'GET' && url.pathname === fixtures[1].owner)
      return { statusCode: fault === 'present' ? 200 : 503, data: fault === 'present' ? saved : '' };
    return reply(url, m, b);
  };
  const r = await h.run();
  expect(r).toMatchObject({
    failure: true,
    confirmedDeleted: tableDeletedOwners(fixtures),
    remaining: [fixtures[1].owner],
    finalAbsenceConfirmed: false,
    cleanupUnconfirmed: false,
  });
  expect(r.inspectionRequired).toContain(fixtures[1].owner);
  expect(h.world.calls.filter((c) => c.method === 'DELETE')).toHaveLength(3);
});
it.each(['present', 'unknown'])('deleted child %s blocks parent deletion without erasing history', async (fault) => {
  const h = tableHarness(),
    reply = h.hooks.reply!;
  let saved = '',
    armed = false;
  h.hooks.before = (url, init) => {
    if (init.method === 'DELETE' && url.pathname === fixtures[3].owner)
      saved = h.world.objects.get(fixtures[3].owner)!.metadata;
    if (
      saved &&
      init.method === 'POST' &&
      url.pathname === fixtures[0].owner &&
      url.searchParams.get('_action') === 'LOCK'
    )
      armed = true;
  };
  h.hooks.reply = (url, m, b) =>
    armed && m === 'GET' && url.pathname === fixtures[3].owner
      ? { statusCode: fault === 'present' ? 200 : 503, data: fault === 'present' ? saved : '' }
      : reply(url, m, b);
  const r = await h.run();
  expect(r.failure).toBe(true);
  expect(r.confirmedDeleted).toEqual([fixtures[3].owner, fixtures[2].owner]);
  expect(r.remaining).toContain(fixtures[3].owner);
  expect(r.remaining).toContain(fixtures[0].owner);
  expect(h.world.calls.filter((c) => c.method === 'DELETE')).toHaveLength(2);
});
it('warning-only index activation is unverified and retains all resources', async () => {
  const h = tableHarness(),
    reply = h.hooks.reply!;
  h.hooks.reply = (url, m, b) =>
    m === 'POST' &&
    url.pathname === '/sap/bc/adt/activation' &&
    url.searchParams.get('preauditRequested') === 'false' &&
    b.includes(fixtures[3].owner)
      ? {
          statusCode: 200,
          data: '<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><chkl:properties activationExecuted="true"/><chkl:message chkl:type="W" chkl:shortText="Database operation warning"/></chkl:messages>',
        }
      : reply(url, m, b);
  const r = await h.run();
  expect(r.failure).toBe(true);
  expect(r.remaining).toHaveLength(4);
  expect(h.world.calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
});
it.each([false, true])('auth wait expiry blocks first write and never claims creation (%s)', async (proxy) => {
  let offset = 0;
  const now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now + offset);
  const h = tableHarness({
    proxy,
    token: async () => {
      if (
        h.records.some(
          (r) =>
            r.stage === 'request' &&
            r.method === 'POST' &&
            typeof r.path === 'string' &&
            new URL(r.path, 'https://synthetic.invalid').pathname === '/sap/bc/adt/ddic/tables',
        )
      )
        offset = 300001;
      return 'synthetic';
    },
  });
  const r = await h.run();
  expect(offset).toBe(300001);
  expect(r.failure).toBe(true);
  expect(r.created).toEqual([]);
  expect(
    h.world.calls.filter((c) => c.method === 'POST' && c.path.split('?')[0] === '/sap/bc/adt/ddic/tables'),
  ).toHaveLength(0);
});

it('index saved as native new remains a draft until explicit activation', async () => {
  const h = tableHarness();
  let phase = '';
  h.hooks.record = (r) => {
    if (r.stageStarted) phase = r.stageStarted;
  };
  h.hooks.before = (url, init) => {
    if (phase === 'update-TABL/DTI' && init.method === 'GET' && url.pathname === fixtures[3].owner) {
      const o = h.world.objects.get(fixtures[3].owner)!;
      o.metadata = o.metadata.replace('version="inactive"', 'version="new"');
    }
  };
  expect(await h.run()).toMatchObject({ failure: false, finalAbsenceConfirmed: true });
  expect(h.records.some((r) => r.snapshot === fixtures[3].owner && r.nativeVersion === 'new')).toBe(true);
});
it('unknown settings fields cannot disappear during a partial update', async () => {
  const h = tableHarness();
  let changed = false;
  h.hooks.record = (r) => {
    if (r.stageCompleted === 'adopt-TABL/DTT') {
      const o = h.world.objects.get(fixtures[1].owner)!;
      o.metadata = o.metadata.replace(
        '</ts:tableSettings>',
        '<ext:flag xmlns:ext="urn:foreign">keep</ext:flag></ts:tableSettings>',
      );
      changed = true;
    }
  };
  expect((await h.run()).failure).toBe(true);
  expect(changed).toBe(true);
  expect(h.world.calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
});

it.each(['missing', 'foreign'])('settings %s size metadata cannot become a defaulted proof', async (fault) => {
  const h = tableHarness();
  h.hooks.record = (r) => {
    if (r.stageCompleted === 'activate-TABL/DT') {
      const o = h.world.objects.get(fixtures[1].owner)!;
      o.metadata = o.metadata.replace(
        /<ts:sizeCategory>.*?<\/ts:sizeCategory>/,
        fault === 'missing' ? '' : '<foreign:sizeCategory xmlns:foreign="urn:foreign">0</foreign:sizeCategory>',
      );
    }
  };
  const r = await h.run();
  expect(r).toMatchObject({ failure: true, stoppedAt: 'adopt-TABL/DTT' });
  expect(h.world.calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
  expect(h.world.calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
});
it('updated settings cannot be relabelled native new', async () => {
  const h = tableHarness();
  let stage = '';
  h.hooks.record = (r) => {
    if (r.stageStarted) stage = r.stageStarted;
  };
  h.hooks.before = (url, init) => {
    if (stage === 'update-TABL/DTT' && init.method === 'GET' && url.pathname === fixtures[1].owner) {
      const o = h.world.objects.get(fixtures[1].owner)!;
      o.metadata = o.metadata.replace('version="inactive"', 'version="new"');
    }
  };
  const r = await h.run();
  expect(r.failure).toBe(true);
  expect(h.world.calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
  expect(r.remaining).toContain(fixtures[1].owner);
});
it.each([false, true])(
  'preflight is bounded real-client discovery plus four typed absences/inventory (%s)',
  async (proxy) => {
    const { tableGetOnlyPreflight } = await import('../../../scripts/qualification/pr1142/native-ddic-table-runner.js');
    const h = tableHarness({ proxy });
    h.client.safety.allowWrites = false;
    await tableGetOnlyPreflight(
      h.client,
      fixtures,
      (v) => h.records.push(v as never),
      () => {},
    );
    expect(h.world.calls).toHaveLength(6);
    expect(h.world.calls.every((c) => c.method === 'GET')).toBe(true);
    expect(h.world.calls.map((c) => c.path.split('?')[0])).toEqual([
      '/sap/bc/adt/discovery',
      ...fixtures.map((f) => f.owner),
      '/sap/bc/adt/activation/inactiveobjects',
    ]);
  },
);
