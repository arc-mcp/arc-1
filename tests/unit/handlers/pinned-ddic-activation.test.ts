import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SDO_REGISTRY } from '../../../src/adt/server-driven.js';
import { blueSource, config, createWorld, fixture, install, nativeClient, type World } from './pinned-ddic-harness.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { handlePinnedActivation, handlePrivatePinnedDdicActivation } = await import(
  '../../../src/handlers/write/pinned-activation.js'
);

const team = (xml: string) =>
  xml
    .replace(/(packageRef[^>]*adtcore:name=")[^"]*/, '$1ZTEAM')
    .replace('adtcore:version="active"', 'adtcore:version="inactive"');
const tablePath = '/sap/bc/adt/ddic/tables/ZTEST';
const cases = [
  {
    type: 'DOMA',
    name: 'BUKRS',
    path: '/sap/bc/adt/ddic/domains/BUKRS',
    metadata: () => team(fixture('xml/domain-metadata.xml')),
    native: 'DOMA/DD',
  },
  {
    type: 'DTEL',
    name: 'BUKRS',
    path: '/sap/bc/adt/ddic/dataelements/BUKRS',
    metadata: () => team(fixture('xml/dataelement-metadata.xml')),
    native: 'DTEL/DE',
  },
  {
    type: 'TTYP',
    name: 'STRINGTAB',
    path: '/sap/bc/adt/ddic/tabletypes/STRINGTAB',
    metadata: () => team(fixture('xml/tabletype-stringtab.xml')),
    native: 'TTYP/DA',
  },
  {
    type: 'ENQU',
    name: 'EMEKKOE',
    path: '/sap/bc/adt/ddic/lockobjects/sources/EMEKKOE',
    metadata: () => team(fixture('xml/lockobject-emekkoe.xml')),
    native: 'ENQU/DL',
  },
  {
    type: 'DRTY',
    name: 'ZTEST',
    path: `${SDO_REGISTRY.DRTY.href}/ZTEST`,
    metadata: () => blueSource('ZTEST', 'DRTY/STY', 'ZTEAM'),
    native: 'DRTY/STY',
    source: 'define type ztest : abap.char(1);',
  },
  {
    type: 'DESD',
    name: 'ZTEST',
    path: `${SDO_REGISTRY.DESD.href}/ZTEST`,
    metadata: () => blueSource('ZTEST', 'DESD/TYP', 'ZTEAM'),
    native: 'DESD/TYP',
    source: '{"formatVersion":"1"}',
  },
];

let world: World;
beforeEach(() => {
  vi.restoreAllMocks();
  world = createWorld();
  install(world);
});
afterEach(() => {
  expect(world.unexpected).toEqual([]);
});

function seed(selected: (typeof cases)[number]) {
  world.objects.set(selected.path, {
    metadata: selected.metadata(),
    nativeType: selected.native,
    ...(selected.source ? { source: selected.source } : {}),
  });
}
const activate = (args: Record<string, unknown>) =>
  handlePrivatePinnedDdicActivation(nativeClient(new Map()), args).then((result) => ({
    result,
    payload: JSON.parse(result.content[0]!.text),
  }));
const submissions = () => world.calls.filter((call) => call.path.startsWith('/sap/bc/adt/activation'));

function seedTable() {
  world.objects.set(tablePath, {
    metadata: blueSource('ZTEST', 'TABL/DT', 'ZTEAM'),
    nativeType: 'TABL/DT',
    source: 'define table ztest {}',
  });
  world.search = [{ type: 'TABL/DT', name: 'ZTEST' }];
}

describe('private DDIC activation', () => {
  it.each(cases)('$type activates the exact owner with native active-state evidence', async (selected) => {
    seed(selected);
    const { result, payload } = await activate({ type: selected.type, name: selected.name });
    expect(result.isError, result.content[0]!.text).toBeUndefined();
    expect(payload).toMatchObject({
      type: selected.type,
      state: 'activated',
      success: true,
      nativeStateVerified: true,
      previousNativeVersion: 'inactive',
      scope: 'selected-ddic-owner-only',
    });
    expect(payload.warnings).toMatch(/dependent objects/);
    if (selected.source) expect(payload).toMatchObject({ activeSourceVerified: true, sourceHash: expect.any(String) });
    else expect(payload.metadataHash).toMatch(/^[a-f0-9]{64}$/);
    expect(submissions()).toHaveLength(2);
    expect(submissions().every((call) => call.body.includes(selected.path))).toBe(true);
    expect(world.calls.some((call) => call.path.includes('_action=LOCK'))).toBe(false);
  });

  it('resolves a bare TABL to its native subtype before activation', async () => {
    seedTable();
    const { payload } = await activate({ type: 'TABL', name: 'ZTEST' });
    expect(payload).toMatchObject({ state: 'activated', activeSourceVerified: true });
    expect(submissions().every((call) => call.body.includes(tablePath))).toBe(true);
  });

  it('reports an already active owner truthfully', async () => {
    const selected = cases[0]!;
    world.objects.set(selected.path, {
      metadata: fixture('xml/domain-metadata.xml').replace('adtcore:name="BF"', 'adtcore:name="ZTEAM"'),
      nativeType: 'DOMA/DD',
    });
    const { payload } = await activate({ type: 'DOMA', name: 'BUKRS' });
    expect(payload.state).toBe('already-active');
  });

  it('refuses every expanded reference before confirmation, including a sibling settings resource', async () => {
    seedTable();
    world.preauditRefs = [{ uri: '/sap/bc/adt/ddic/db/settings/ztest', name: 'ZTEST', type: 'TABL/DTT' }];
    const { result, payload } = await activate({ type: 'TABL/DT', name: 'ZTEST' });
    expect(result.isError).toBe(true);
    expect(payload.state).toBe('activation-not-confirmed');
    expect(world.calls.filter((call) => call.path.includes('preauditRequested=false'))).toEqual([]);
  });

  it('refuses a denied package before any activation request', async () => {
    const selected = cases[0]!;
    world.objects.set(selected.path, {
      metadata: selected.metadata().replace('adtcore:name="ZTEAM"', 'adtcore:name="ZDENIED"'),
      nativeType: 'DOMA/DD',
    });
    const { payload } = await activate({ type: 'DOMA', name: 'BUKRS' });
    expect(payload.state).toBe('unchanged');
    expect(submissions()).toEqual([]);
  });

  it('stops when the draft changes between preaudit and confirmation', async () => {
    world.faults.add('draft-drift');
    for (const selected of cases.filter((candidate) => candidate.type === 'DOMA' || candidate.source)) {
      seed(selected);
      world.calls.length = 0;
      const { payload } = await activate({ type: selected.type, name: selected.name });
      expect(payload.message).toMatch(/changed during preaudit/);
      expect(world.calls.filter((call) => call.path.includes('preauditRequested=false'))).toEqual([]);
      world.objects.delete(selected.path);
    }
  });

  it('keeps native success separate from an active state that does not verify', async () => {
    const selected = cases[0]!;
    seed(selected);
    world.faults.add('still-inactive');
    const { result, payload } = await activate({ type: 'DOMA', name: 'BUKRS' });
    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({
      state: 'activation-not-confirmed',
      phase: 'ddic-active-verification',
      retryable: false,
    });
    expect(payload.warnings).toMatch(/before the later verification failed/);
    expect(payload.nativeActivation.success).toBe(true);
  });

  it('refuses an active source that differs from the captured draft', async () => {
    seedTable();
    // The active version keeps an older body although SAP reported success.
    Object.defineProperty(world.objects.get(tablePath)!, 'activeSource', {
      configurable: true,
      get: () => 'different',
      set: () => {},
    });
    const { payload } = await activate({ type: 'TABL/DT', name: 'ZTEST' });
    expect(payload).toMatchObject({ state: 'activation-not-confirmed', phase: 'ddic-active-verification' });
  });

  function activateRewriting(selected: (typeof cases)[number], rewrite: (active: string) => string) {
    seed(selected);
    const object = world.objects.get(selected.path)!;
    const draft = object.metadata;
    let activated = false;
    Object.defineProperty(object, 'metadata', {
      configurable: true,
      get: () => (activated ? rewrite(draft.replace('adtcore:version="inactive"', 'adtcore:version="active"')) : draft),
      set: () => {
        activated = true;
      },
    });
    return activate({ type: selected.type, name: selected.name });
  }

  it('refuses success while another draft remains visible in the explicit inactive view', async () => {
    const selected = cases[0]!;
    seed(selected);
    const object = world.objects.get(selected.path)!;
    const draft = object.metadata;
    let activated = false;
    let reads = 0;
    Object.defineProperty(object, 'metadata', {
      configurable: true,
      // Lifecycle lookups read this repeatedly; only the last metadata read after activation sees the draft.
      get: () => {
        if (!activated) return draft;
        reads += 1;
        return world.calls.at(-1)?.path.includes('version=inactive')
          ? draft
          : draft.replace('adtcore:version="inactive"', 'adtcore:version="active"');
      },
      set: () => {
        activated = true;
      },
    });
    const { payload } = await activate({ type: 'DOMA', name: 'BUKRS' });
    expect(reads).toBeGreaterThan(0);
    expect(payload).toMatchObject({ state: 'activation-not-confirmed', phase: 'ddic-active-verification' });
  });

  it('refuses a stored definition that activation changed', async () => {
    const { payload } = await activateRewriting(cases[0]!, (active) =>
      active.replace('<doma:datatype>CHAR<', '<doma:datatype>NUMC<'),
    );
    expect(payload).toMatchObject({ state: 'activation-not-confirmed', phase: 'ddic-active-verification' });
  });

  it('tolerates only the values activation derives from another object', async () => {
    const { result, payload } = await activateRewriting(cases[1]!, (active) =>
      active.replace('<dtel:dataTypeLength>000004<', '<dtel:dataTypeLength>000010<'),
    );
    expect(result.isError, result.content[0]!.text).toBeUndefined();
    expect(payload.state).toBe('activated');
  });

  it.each([
    {
      label: 'built-in DTEL datatype',
      index: 1,
      draft: (xml: string) => xml.replace('<dtel:typeKind>domain<', '<dtel:typeKind>predefinedAbapType<'),
      rewrite: (xml: string) => xml.replace('<dtel:dataType>CHAR<', '<dtel:dataType>NUMC<'),
    },
    {
      label: 'built-in DTEL length',
      index: 1,
      draft: (xml: string) => xml.replace('<dtel:typeKind>domain<', '<dtel:typeKind>predefinedAbapType<'),
      rewrite: (xml: string) => xml.replace('<dtel:dataTypeLength>000004<', '<dtel:dataTypeLength>000020<'),
    },
    {
      label: 'built-in DTEL decimals',
      index: 1,
      draft: (xml: string) => xml.replace('<dtel:typeKind>domain<', '<dtel:typeKind>predefinedAbapType<'),
      rewrite: (xml: string) => xml.replace('<dtel:dataTypeDecimals>000000<', '<dtel:dataTypeDecimals>000002<'),
    },
    {
      label: 'built-in TTYP datatype',
      index: 2,
      draft: (xml: string) => xml,
      rewrite: (xml: string) => xml.replace('<ttyp:dataType>STRING<', '<ttyp:dataType>NUMC<'),
    },
    {
      label: 'built-in TTYP length',
      index: 2,
      draft: (xml: string) => xml,
      rewrite: (xml: string) => xml.replace('<ttyp:length>000000<', '<ttyp:length>000020<'),
    },
    {
      label: 'built-in TTYP decimals',
      index: 2,
      draft: (xml: string) => xml,
      rewrite: (xml: string) => xml.replace('<ttyp:decimals>000000<', '<ttyp:decimals>000002<'),
    },
    {
      label: 'explicit ENQU parameter',
      index: 3,
      draft: (xml: string) => xml,
      rewrite: (xml: string) => xml.replace('<enqu:parameterWanted>false<', '<enqu:parameterWanted>true<'),
    },
  ])('refuses an active but different $label', async ({ index, draft, rewrite }) => {
    const selected = cases[index]!;
    const changed = { ...selected, metadata: () => draft(selected.metadata()) };
    const { result, payload } = await activateRewriting(changed, rewrite);
    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({
      state: 'activation-not-confirmed',
      phase: 'ddic-active-verification',
      retryable: false,
    });
    expect(submissions()).toHaveLength(2);
    expect(world.objects.get(selected.path)!.metadata).toContain('adtcore:version="active"');
    expect(payload.message).toMatch(/read-back differs/);
  });

  it('allows TTYP dimensions derived from a captured dictionary row type', async () => {
    const selected = cases[2]!;
    const dictionary = {
      ...selected,
      metadata: () =>
        selected
          .metadata()
          .replace('<ttyp:typeKind>predefinedAbapType<', '<ttyp:typeKind>dictionaryType<')
          .replace('<ttyp:typeName/>', '<ttyp:typeName>BUKRS</ttyp:typeName>'),
    };
    const { result, payload } = await activateRewriting(dictionary, (xml) =>
      xml
        .replace('<ttyp:dataType>STRING<', '<ttyp:dataType>CHAR<')
        .replace('<ttyp:length>000000<', '<ttyp:length>000004<'),
    );
    expect(result.isError, result.content[0]!.text).toBeUndefined();
    expect(payload).toMatchObject({ state: 'activated', nativeStateVerified: true });
  });

  it('allows new derived ENQU parameters only when the captured definition has no explicit parameters', async () => {
    const selected = cases[3]!;
    const parameters = /<enqu:lockParameters>.*?<\/enqu:lockParameters>/.exec(selected.metadata())![0];
    const generated = { ...selected, metadata: () => selected.metadata().replace(parameters, '') };
    const { result, payload } = await activateRewriting(generated, (xml) =>
      xml.replace('</enqu:content>', `${parameters}</enqu:content>`),
    );
    expect(result.isError, result.content[0]!.text).toBeUndefined();
    expect(payload).toMatchObject({ state: 'activated', nativeStateVerified: true });
  });

  it('never claims a warned index activation as verified', async () => {
    world.objects.set('/sap/bc/adt/ddic/db/indexes/ztest~001', {
      metadata: fixture('table-index-metadata-758.xml')
        .replace('adtcore:version="new"', 'adtcore:version="inactive"')
        .replace('adtcore:name="$TMP"', 'adtcore:name="ZTEAM"'),
      nativeType: 'TABL/DTI',
      source: '{"a":1}',
    });
    world.objects.set('/sap/bc/adt/ddic/tables/ztest', {
      metadata: blueSource('ZTEST', 'TABL/DT', 'ZTEAM'),
      nativeType: 'TABL/DT',
    });
    world.activationMessages =
      '<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><chkl:properties activationExecuted="true"/><msg type="W" objDescr="i" href="/sap/bc/adt/ddic/db/indexes/ztest~001"><shortText><txt>Index could not be created</txt></shortText></msg></chkl:messages>';
    const { result, payload } = await activate({ type: 'TABL/DTI', name: 'ZTEST~001' });
    expect(result.isError).toBe(true);
    expect(payload.message).toMatch(/warnings; database state is unverified/);
  });

  it('directs new technical settings to parent activation before sending anything', async () => {
    world.objects.set('/sap/bc/adt/ddic/db/settings/ztest', {
      metadata: fixture('table-settings-758.xml').replace('adtcore:version="inactive"', 'adtcore:version="new"'),
      nativeType: 'TABL/DTT',
    });
    world.objects.set('/sap/bc/adt/ddic/tables/ztest', {
      metadata: blueSource('ZTEST', 'TABL/DT', 'ZTEAM'),
      nativeType: 'TABL/DT',
    });
    const { payload } = await activate({ type: 'TABL/DTT', name: 'ZTEST' });
    expect(payload.state).toBe('unchanged');
    expect(payload.message).toMatch(/activate TABL ZTEST/);
    expect(submissions()).toEqual([]);
  });

  it('activates existing technical settings and verifies their native state', async () => {
    world.objects.set('/sap/bc/adt/ddic/db/settings/ztest', {
      metadata: fixture('table-settings-758.xml'),
      nativeType: 'TABL/DTT',
    });
    world.objects.set('/sap/bc/adt/ddic/tables/ztest', {
      metadata: blueSource('ZTEST', 'TABL/DT', 'ZTEAM'),
      nativeType: 'TABL/DT',
    });
    const { result, payload } = await activate({ type: 'TABL/DTT', name: 'ZTEST' });
    expect(result.isError, result.content[0]!.text).toBeUndefined();
    expect(payload).toMatchObject({ state: 'activated', nativeStateVerified: true });
  });

  it.each(['APLO', 'UIAD'])('refuses a separate activation for immediately active %s', async (type) => {
    const { payload } = await activate({ type, name: 'ZTEST' });
    expect(payload.state).toBe('unchanged');
    expect(payload.message).toMatch(/active immediately/);
    expect(world.calls).toEqual([]);
  });

  it.each([
    { type: 'DOMA', name: 'BUKRS', preaudit: false },
    { type: 'DOMA', name: 'BUKRS', preaudit: 'true' },
    { type: 'DOMA', name: 'BUKRS', objects: [] },
    { type: 'DOMA', name: 'BUKRS', action: 'publish_srvb' },
    { type: 'DOMA', name: 'BUKRS', group: 'ZG' },
    { type: 'SRVB', name: 'ZS' },
    { type: 'SHLP', name: 'ZS' },
    { type: 'VIEW', name: 'ZS' },
  ])('refuses unsupported activation input before HTTP: %j', async (args) => {
    const { result } = await activate(args).catch((error) => ({ result: { isError: true, error } }) as never);
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(submissions()).toEqual([]);
  });

  it.each([...cases.map((selected) => selected.type), 'TABL', 'TABL/DT', 'TABL/DS', 'TABL/DTT', 'TABL/DTI'])(
    'requires verified authorization before public %s activation',
    async (type) => {
      const result = await handleToolCall(nativeClient(new Map()), config, 'SAPActivate', {
        type,
        name: type === 'TABL/DTI' ? 'ZTEST~001' : 'ZTEST',
      });
      expect(result.isError).toBe(true);
      expect(world.calls).toEqual([]);
    },
  );

  it('does not let a tool argument grant private admission', async () => {
    const result = await handlePinnedActivation(nativeClient(new Map()), {
      type: 'DOMA',
      name: 'BUKRS',
      privateDdicGrant: true,
    });
    expect(result.isError).toBe(true);
    expect(world.calls).toEqual([]);
  });
});
