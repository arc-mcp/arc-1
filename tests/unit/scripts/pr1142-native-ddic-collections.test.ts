import { expect, it, vi } from 'vitest';
import { checkCollectionsRequest } from '../../../scripts/qualification/pr1142/native-ddic-collections-transport.js';
import { COLLECTIONS_STAGES, collectionsHarness, fixtures } from './pr1142-native-ddic-collections-harness.js';

const { collectionsGetOnlyPreflight } = await import(
  '../../../scripts/qualification/pr1142/native-ddic-collections-runner.js'
);

it('uses actual context/client/writers for source→row-type transition and independent message replacement', async () => {
  const h = collectionsHarness(),
    r = await h.run();
  expect(r, JSON.stringify(h.records.slice(-10))).toMatchObject({
    failure: false,
    completed: [...COLLECTIONS_STAGES],
    cleanupUnconfirmed: false,
    confirmedDeleted: [...fixtures].reverse().map((f) => f.owner),
    finalAbsenceConfirmed: true,
  });
  expect(h.world.unexpected).toEqual([]);
  expect(h.world.calls.length).toBeLessThan(384);
  expect(h.world.calls.length).toBeGreaterThan(256);
  const puts = h.world.calls.filter((c) => c.method === 'PUT');
  expect(puts).toHaveLength(6);
  expect(puts.filter((c) => c.path.startsWith(fixtures[0].owner)).map((c) => c.body)).toEqual([
    fixtures[0].create.source,
    fixtures[0].update.source,
  ]);
  expect(puts.filter((c) => c.path.startsWith(fixtures[1].owner))).toHaveLength(2);
  expect(puts.findLast((c) => c.path.startsWith(fixtures[1].owner))?.body).toContain(fixtures[0].name);
  const messages = puts.findLast((c) => c.path.startsWith(fixtures[2].owner))!.body;
  expect(messages).toContain('Preserved message');
  expect(messages).toContain('Updated collection');
  expect(messages).toContain('Added message');
  expect(messages).not.toContain('Removed message');
  expect(h.records.filter((r) => r.adapter?.startsWith('stale-')).map((r) => [r.result.state, r.result.phase])).toEqual(
    [
      ['unchanged', 'source-read'],
      ['unchanged', 'metadata-read'],
    ],
  );
  expect(h.world.calls.filter((c) => c.method === 'DELETE').map((c) => c.path.split('?')[0])).toEqual(
    [...fixtures].reverse().map((f) => f.owner),
  );
  expect(JSON.stringify(h.records)).not.toContain('native-lock');
}, 30000);
it('uses the same bounded DDL proof in production saves and qualification snapshots', async () => {
  const h = collectionsHarness();
  const normalized = (body: string) => body.replace(/\{\n+/, '{\n\n').replace(/\n+}/, '\n\n}').trimEnd();
  h.hooks.before = (url, init) => {
    if (init.method === 'GET' && url.pathname === `${fixtures[0].owner}/source/main`) {
      const object = h.world.objects.get(fixtures[0].owner)!;
      if (object.source !== undefined) object.source = normalized(object.source);
    }
  };
  const result = await h.run();
  expect(result, JSON.stringify(h.records.slice(-6))).toMatchObject({
    failure: false,
    completed: [...COLLECTIONS_STAGES],
    finalAbsenceConfirmed: true,
  });
  expect(h.world.calls.filter((call) => call.method === 'PUT' && call.path.startsWith(fixtures[0].owner))).toHaveLength(
    2,
  );
  expect(h.world.objects.get(fixtures[0].owner)?.source).toBe(normalized(fixtures[0].update.source!));
  expect(normalized(fixtures[0].update.source!)).not.toBe(fixtures[0].update.source);
  expect(h.records.filter((r) => r.adapter?.startsWith('stale-')).map((r) => r.result.state)).toEqual([
    'unchanged',
    'unchanged',
  ]);
}, 30000);

it('preflight is exactly three typed absence GETs and one inventory GET', async () => {
  const h = collectionsHarness();
  await collectionsGetOnlyPreflight(h.client, fixtures, h.records.push.bind(h.records), h.verify);
  expect(h.world.calls.map((c) => c.method)).toEqual(['GET', 'GET', 'GET', 'GET']);
});
it.each(['create-unknown', 'save-unknown', 'readback', 'still-inactive', 'unlock', 'delete-unknown'])(
  'retains a failed %s without automatic catch cleanup or retry',
  async (fault) => {
    const h = collectionsHarness();
    h.world.faults.add(fault);
    const r = await h.run();
    expect(r.failure).toBe(true);
    expect(r.inspectionRequired.length).toBeGreaterThan(0);
    expect(h.world.calls.filter((c) => c.method === 'DELETE')).toHaveLength(fault === 'delete-unknown' ? 1 : 0);
  },
);
it.each(['source', 'creator', 'package', 'state'])('refuses %s receipt drift before later writes', async (fault) => {
  const h = collectionsHarness();
  h.hooks.record = (r) => {
    if (r.stageCompleted === 'reactivate-TABL/DS') {
      const o = h.world.objects.get(fixtures[0].owner)!;
      if (fault === 'source') o.source += ' foreign';
      if (fault === 'creator') o.metadata = o.metadata.replaceAll('MARIAN', 'OTHER');
      if (fault === 'package') o.metadata = o.metadata.replace('$TMP', 'ZFOREIGN');
      if (fault === 'state') o.metadata = o.metadata.replace('version="active"', 'version="inactive"');
    }
  };
  const r = await h.run();
  expect(r.failure).toBe(true);
  expect(r.created).toEqual([fixtures[0].owner]);
  expect(h.world.calls.some((c) => c.method === 'DELETE')).toBe(false);
});
it.each(['documented', 'master-language', 'foreign-field'])(
  'refuses MSAG %s rather than erasing stored evidence',
  async (fault) => {
    const h = collectionsHarness();
    h.hooks.record = (r) => {
      if (r.stageCompleted === 'activate-MSAG') {
        const o = h.world.objects.get(fixtures[2].owner)!;
        o.metadata =
          fault === 'documented'
            ? o.metadata.replace('documented="false"', 'documented="true"')
            : fault === 'master-language'
              ? o.metadata.replace('masterLanguage="EN"', 'masterLanguage="DE"')
              : o.metadata.replace(
                  '</mc:messageClass>',
                  '<x:opaque xmlns:x="urn:foreign">keep</x:opaque></mc:messageClass>',
                );
      }
    };
    const r = await h.run();
    expect(r.failure).toBe(true);
    expect(h.world.calls.filter((c) => c.method === 'PUT' && c.path.startsWith(fixtures[2].owner))).toHaveLength(1);
  },
);
it.each([
  '/sap/bc/adt/repository/informationsystem/search?operation=quickSearch&query=FOREIGN&maxResults=5',
  `${fixtures[0].owner}/source/main?version=active&version=inactive`,
  `${fixtures[0].owner}/source/main/foreign`,
  `${fixtures[0].owner}/source/main?version=active#fragment`,
])('refuses scope escape %s', (path) => {
  expect(() => checkCollectionsRequest(fixtures, fixtures[0], 'update-TABL/DS', 'GET', path)).toThrow();
});
it('refuses a different source payload, stale PUT and extra owner before HTTP', () => {
  for (const stage of ['stale-TABL/DS', 'update-TABL/DS'])
    expect(() =>
      checkCollectionsRequest(
        fixtures,
        fixtures[0],
        stage,
        'PUT',
        `${fixtures[0].owner}/source/main?lockHandle=secret`,
        'foreign',
      ),
    ).toThrow();
});

it('rechecks source after the Connectivity token wait before first actual CREATE', async () => {
  let intent = false;
  const h = collectionsHarness({
    proxy: true,
    token: async () => {
      await Promise.resolve();
      if (intent) h.breakSource();
      return 'synthetic-token';
    },
  });
  h.hooks.record = (r) => {
    if (r.stage === 'request' && r.method === 'POST' && r.path?.split('?')[0] === '/sap/bc/adt/ddic/structures')
      intent = true;
  };
  expect((await h.run()).failure).toBe(true);
  expect(intent).toBe(true);
  expect(h.world.calls.some((c) => c.method === 'POST' && c.path.split('?')[0] === '/sap/bc/adt/ddic/structures')).toBe(
    false,
  );
});
it('honors the effective deadline after synchronous proof and preserves first-mutation refusal', async () => {
  const h = collectionsHarness(),
    now = Date.now.bind(Date);
  let offset = 0,
    intent = false;
  vi.spyOn(Date, 'now').mockImplementation(() => now() + offset);
  h.hooks.record = (r) => {
    if (r.stage === 'request' && r.method === 'POST' && r.path?.split('?')[0] === '/sap/bc/adt/ddic/structures')
      intent = true;
  };
  h.hooks.verify = () => {
    if (intent) offset = 300001;
  };
  expect((await h.run()).failure).toBe(true);
  expect(intent).toBe(true);
  expect(h.world.calls.some((c) => c.method === 'POST' && c.path.split('?')[0] === '/sap/bc/adt/ddic/structures')).toBe(
    false,
  );
});
it('refuses any altered fixed graph before reads or mutations', async () => {
  const h = collectionsHarness(),
    other = fixtures.map((fixture) =>
      fixture.type === 'TABL/DS'
        ? { ...fixture, update: { ...fixture.update, source: `${fixture.update.source}foreign` } }
        : fixture,
    );
  await expect(h.run(other)).rejects.toThrow('exact fixed');
  expect(h.world.calls).toEqual([]);
});

it('retains all three historical deletions after an unavailable final inventory', async () => {
  const h = collectionsHarness();
  let inventories = 0;
  h.hooks.before = (u) => {
    if (u.pathname.endsWith('/inactiveobjects') && ++inventories === 2)
      throw new Error('Synthetic final inventory unavailable');
  };
  const r = await h.run();
  expect(r).toMatchObject({
    failure: true,
    confirmedDeleted: [...fixtures].reverse().map((f) => f.owner),
    cleanupUnconfirmed: false,
    finalAbsenceConfirmed: false,
  });
  expect(new Set(r.remaining)).toEqual(new Set(fixtures.map((f) => f.owner)));
  expect(new Set(r.inspectionRequired)).toEqual(new Set(fixtures.map((f) => f.owner)));
});
