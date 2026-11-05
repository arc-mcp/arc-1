import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { blueSource, createWorld, install, nativeClient, type World } from '../handlers/pinned-ddic-harness.js';

const { isPinnedDdicType, pinnedDdicSelection, readPinnedDdicEvidence, readPinnedDdicOwner, resolvePinnedTableType } =
  await import('../../../src/adt/pinned-ddic-owner.js');
const { mutationClient } = await import('../../../src/adt/mutation-client.js');
const { context } = await import('../handlers/pinned-ddic-harness.js');

const xml = (path: string) => readFileSync(resolve(__dirname, '../../fixtures', path), 'utf8');
const toTeam = (document: string) => document.replace(/(packageRef[^>]*adtcore:name=")[^"]*/, '$1ZTEAM');

const observed = [
  { type: 'DOMA', name: 'BUKRS', path: '/sap/bc/adt/ddic/domains/BUKRS', file: 'xml/domain-metadata.xml' },
  { type: 'DTEL', name: 'BUKRS', path: '/sap/bc/adt/ddic/dataelements/BUKRS', file: 'xml/dataelement-metadata.xml' },
  {
    type: 'TTYP',
    name: 'STRINGTAB',
    path: '/sap/bc/adt/ddic/tabletypes/STRINGTAB',
    file: 'xml/tabletype-stringtab.xml',
  },
  {
    type: 'ENQU',
    name: 'EMEKKOE',
    path: '/sap/bc/adt/ddic/lockobjects/sources/EMEKKOE',
    file: 'xml/lockobject-emekkoe.xml',
  },
  {
    type: 'DESD',
    name: 'DEMO_CDS_LOGICL_EXTERNL_SCHEMA',
    path: '/sap/bc/adt/ddic/desd/DEMO_CDS_LOGICL_EXTERNL_SCHEMA',
    file: 'sdo/sdo-desd-metadata.xml',
  },
  {
    type: 'EVTB',
    name: 'S_BUSINESSPARTNER_CHANGE',
    path: '/sap/bc/adt/businessservices/evtbevb/S_BUSINESSPARTNER_CHANGE',
    file: 'sdo/sdo-evtb-metadata.xml',
  },
];

let world: World;
beforeEach(() => {
  vi.restoreAllMocks();
  world = createWorld();
  install(world);
});
const scoped = (overrides = {}) => {
  const client = nativeClient(undefined, overrides);
  return mutationClient(client, context(client));
};

describe('native DDIC identity', () => {
  it.each(observed)('reads the recorded $type identity and native package', async ({ type, name, path, file }) => {
    world.objects.set(path, { metadata: toTeam(xml(file)), nativeType: '' });
    expect(pinnedDdicSelection(type, name).objectUrl).toBe(path);
    expect(await readPinnedDdicOwner(scoped(), path)).toBe('ZTEAM');
  });

  it.each(observed)('refuses a mismatched $type identity, root and package', async ({ type, name, path, file }) => {
    const document = toTeam(xml(file));
    const selected = pinnedDdicSelection(type, name);
    for (const metadata of [
      document.replace(`adtcore:name="${name}"`, 'adtcore:name="ZOTHER"'),
      document.replace(/adtcore:type="[A-Z]{4}\/[A-Z]{2,3}"/, 'adtcore:type="ZZZZ/ZZ"'),
      document.replace(/(packageRef[^>]*adtcore:type=")DEVC\/K/, '$1ZZZZ/Z'),
      '<wrong/>',
    ]) {
      world.objects.set(path, { metadata, nativeType: '' });
      await expect(readPinnedDdicEvidence(scoped(), selected)).rejects.toThrow();
    }
  });

  it('refuses independently denied packages and an unknown metadata version', async () => {
    const path = observed[0]!.path;
    world.objects.set(path, { metadata: xml(observed[0]!.file), nativeType: '' });
    await expect(readPinnedDdicOwner(scoped(), path)).rejects.toThrow(/package|allowed|restrict/i);
    world.objects.set(path, {
      metadata: toTeam(xml(observed[0]!.file)).replace('adtcore:version="active"', 'adtcore:version="weird"'),
      nativeType: '',
    });
    await expect(readPinnedDdicOwner(scoped(), path)).rejects.toThrow(/version/);
  });

  it('ignores URIs owned by other adapters and refuses a non-canonical DDIC URI', async () => {
    expect(await readPinnedDdicOwner(scoped(), '/sap/bc/adt/oo/classes/zcl_a')).toBeUndefined();
    expect(await readPinnedDdicOwner(scoped(), '/sap/bc/adt/ddic/ddl/sources/z')).toBeUndefined();
    expect(await readPinnedDdicOwner(scoped(), '/sap/bc/adt/ddic/domains/Z/extra')).toBeUndefined();
    await expect(readPinnedDdicOwner(scoped(), '/sap/bc/adt/ddic/domains/%ZZ')).rejects.toThrow(/canonical/);
    await expect(readPinnedDdicOwner(scoped(), '/sap/bc/adt/ddic/domains/zlower')).rejects.toThrow(/canonical/);
  });

  it.each(['SHLP', 'VIEW', 'TRAN', 'SKTD', 'SRVB', 'ENHO'])('refuses %s with its concrete reason', (type) => {
    expect(isPinnedDdicType(type)).toBe(false);
    expect(() => pinnedDdicSelection(type, 'ZNAME')).toThrow(/SHLP|VIEW|TRAN|SKTD|SRVB|ENHO/);
  });

  it('refuses a bare TABL, lowercase, oversized and malformed names', () => {
    expect(() => pinnedDdicSelection('TABL', 'ZT')).toThrow(/native TABL\/DT or TABL\/DS/);
    expect(() => pinnedDdicSelection('DOMA', 'zlower')).toThrow();
    expect(() => pinnedDdicSelection('DOMA', `Z${'A'.repeat(30)}`)).toThrow(/maximum 30/);
    expect(() => pinnedDdicSelection('DOMA', 'Z/BAD')).toThrow();
    expect(() => pinnedDdicSelection('TABL/DTI', 'ZT')).toThrow(/TABLE~INDEX/);
    expect(() => pinnedDdicSelection('TABL/DTI', 'zt~001')).toThrow();
    expect(pinnedDdicSelection('DOMA', '/NS/ZD').objectUrl).toBe('/sap/bc/adt/ddic/domains/%2FNS%2FZD');
  });

  it('proves a technical-settings package only from the native parent table', async () => {
    const settings = xml('table-settings-758.xml');
    const selected = pinnedDdicSelection('TABL/DTT', 'ZTEST');
    expect(selected.objectUrl).toBe('/sap/bc/adt/ddic/db/settings/ztest');
    world.objects.set(selected.objectUrl, { metadata: settings, nativeType: '' });
    world.objects.set('/sap/bc/adt/ddic/tables/ztest', {
      metadata: blueSource('ZTEST', 'TABL/DT', 'ZTEAM'),
      nativeType: '',
    });
    const evidence = await readPinnedDdicEvidence(scoped(), selected);
    expect(evidence.packageName).toBe('ZTEAM');
    expect(evidence.version).toBe('inactive');
    world.objects.set('/sap/bc/adt/ddic/tables/ztest', {
      metadata: blueSource('ZTEST', 'TABL/DT', 'ZDENIED'),
      nativeType: '',
    });
    await expect(readPinnedDdicEvidence(scoped(), selected)).rejects.toThrow();
    world.objects.set('/sap/bc/adt/ddic/tables/ztest', {
      metadata: blueSource('ZTEST', 'TABL/DS', 'ZTEAM'),
      nativeType: '',
    });
    await expect(readPinnedDdicEvidence(scoped(), selected)).rejects.toThrow(/identity/);
    world.objects.set('/sap/bc/adt/ddic/tables/ztest', {
      metadata: blueSource('ZTEST', 'TABL/DT', 'ZTEAM'),
      nativeType: '',
    });
    world.objects.set(selected.objectUrl, {
      metadata: settings.replace(/<adtcore:containerRef[^>]*\/>/, ''),
      nativeType: '',
    });
    await expect(readPinnedDdicEvidence(scoped(), selected)).rejects.toThrow(/parent/);
  });

  it('requires an index package to agree with its native parent table', async () => {
    const index = xml('table-index-metadata-758.xml');
    const selected = pinnedDdicSelection('TABL/DTI', 'ZTEST~001');
    expect(selected.objectUrl).toBe('/sap/bc/adt/ddic/db/indexes/ztest~001');
    world.objects.set(selected.objectUrl, { metadata: index, nativeType: '' });
    world.objects.set('/sap/bc/adt/ddic/tables/ztest', {
      metadata: blueSource('ZTEST', 'TABL/DT', '$TMP'),
      nativeType: '',
    });
    expect((await readPinnedDdicEvidence(scoped(), selected)).version).toBe('new');
    world.objects.set('/sap/bc/adt/ddic/tables/ztest', {
      metadata: blueSource('ZTEST', 'TABL/DT', 'ZTEAM'),
      nativeType: '',
    });
    await expect(readPinnedDdicEvidence(scoped(), selected)).rejects.toThrow(/differs from its parent/);
  });

  it('enforces a one-mebibyte native metadata budget', async () => {
    world.objects.set(observed[0]!.path, { metadata: toTeam(xml(observed[0]!.file)), nativeType: '' });
    world.faults.add('budget');
    await expect(readPinnedDdicOwner(scoped(), observed[0]!.path)).rejects.toThrow();
  });
});

describe('native TABL subtype resolution', () => {
  it('resolves native subtypes and strips the legacy localized suffix', async () => {
    world.search = [{ type: 'TABL/DS', name: 'ZS (Structure)' }];
    expect(await resolvePinnedTableType(scoped(), 'TABL', 'ZS', true)).toBe('TABL/DS');
    world.search = [
      { type: 'PROG/P', name: 'ZT' },
      { type: 'TABL/DT', name: 'ZT' },
    ];
    expect(await resolvePinnedTableType(scoped(), 'TABL/DT', 'ZT', undefined)).toBe('TABL/DT');
  });

  it.each([
    { label: 'wrong asserted subtype', search: [{ type: 'TABL/DT', name: 'ZT' }], requested: 'TABL/DS' as const },
    { label: 'no native hit', search: [], requested: 'TABL' as const },
    { label: 'same-named other type', search: [{ type: 'PROG/P', name: 'ZT' }], requested: 'TABL' as const },
    {
      label: 'ambiguous subtypes',
      search: [
        { type: 'TABL/DT', name: 'ZT' },
        { type: 'TABL/DS', name: 'ZT' },
      ],
      requested: 'TABL' as const,
    },
  ])('refuses $label instead of probing a collection', async ({ search, requested }) => {
    world.search = search;
    await expect(resolvePinnedTableType(scoped(), requested, 'ZT', true)).rejects.toThrow();
    expect(world.calls.some((call) => call.path.includes('/ddic/'))).toBe(false);
  });

  it('refuses a search failure and a transparent table on a release without its endpoint', async () => {
    world.search = [{ type: 'TABL/DT', name: 'ZT' }];
    await expect(resolvePinnedTableType(scoped(), 'TABL', 'ZT', false)).rejects.toThrow(/SE11/);
    world.faults.add('search');
    await expect(resolvePinnedTableType(scoped(), 'TABL', 'ZT', true)).rejects.toThrow();
  });
});
