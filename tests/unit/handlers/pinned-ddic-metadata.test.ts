import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pinnedPublicAuth } from '../../helpers/pinned-public-auth.js';
import {
  config,
  context,
  createWorld,
  fixture,
  install,
  nativeClient,
  posts,
  puts,
  type World,
} from './pinned-ddic-harness.js';

const { createPinnedDdicContext } = await import('../../../src/handlers/write/pinned-ddic-context.js');
const { executePinnedSourceWrite } = await import('../../../src/handlers/write/pinned-source-write.js');
const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures, setCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const { featuresOff } = await import('./handler-test-config.js');

const team = (xml: string) => xml.replace(/(packageRef[^>]*adtcore:name=")[^"]*/, '$1ZTEAM');
const message = (extra = '') =>
  `<?xml version="1.0"?><mc:messageClass xmlns:mc="http://www.sap.com/adt/MessageClass" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="ZM" adtcore:type="MSAG/N" adtcore:version="inactive" adtcore:language="EN" adtcore:masterLanguage="EN" adtcore:description="d"><adtcore:packageRef adtcore:type="DEVC/K" adtcore:name="ZTEAM"/><mc:messages mc:msgno="001" mc:msgtext="one" mc:selfexplainatory="true" mc:documented="false"${extra}/></mc:messageClass>`;

const profiles = [
  {
    type: 'DOMA',
    name: 'BUKRS',
    path: '/sap/bc/adt/ddic/domains/BUKRS',
    metadata: () => team(fixture('xml/domain-metadata.xml')),
    update: { outputLength: '000010' },
    contentType: 'application/vnd.sap.adt.domains.v2+xml',
    preserved: [
      '<doma:datatype>CHAR</doma:datatype>',
      'adtcore:name="T001"',
      'adtcore:masterLanguage="DE"',
      'adtcore:masterSystem="SAP"',
      'adtcore:responsible="SAP"',
    ],
    changed: '<doma:length>000010</doma:length>',
  },
  {
    type: 'DTEL',
    name: 'BUKRS',
    path: '/sap/bc/adt/ddic/dataelements/BUKRS',
    metadata: () => team(fixture('xml/dataelement-metadata.xml')),
    update: { shortLabel: 'Co' },
    contentType: 'application/vnd.sap.adt.dataelements.v2+xml',
    preserved: [
      '<dtel:mediumFieldLabel>Company Code</dtel:mediumFieldLabel>',
      '<dtel:searchHelp>C_T001</dtel:searchHelp>',
      '<dtel:changeDocument>true</dtel:changeDocument>',
      '<dtel:deactivateInputHistory>false</dtel:deactivateInputHistory>',
      '<dtel:setGetParameter>BUK</dtel:setGetParameter>',
    ],
    changed: '<dtel:shortFieldLabel>Co</dtel:shortFieldLabel>',
  },
  {
    type: 'TTYP',
    name: 'STRINGTAB',
    path: '/sap/bc/adt/ddic/tabletypes/STRINGTAB',
    metadata: () => team(fixture('xml/tabletype-stringtab.xml')),
    update: { description: 'renamed' },
    contentType: 'application/vnd.sap.adt.tabletype.v1+xml',
    preserved: ['<ttyp:dataType>STRING</ttyp:dataType>', '<ttyp:accessType>standard</ttyp:accessType>'],
    changed: 'adtcore:description="renamed"',
  },
  {
    type: 'ENQU',
    name: 'EMEKKOE',
    path: '/sap/bc/adt/ddic/lockobjects/sources/EMEKKOE',
    metadata: () => team(fixture('xml/lockobject-emekkoe.xml')),
    update: { source: '{"allowRFC":true}' },
    contentType: 'application/vnd.sap.adt.lockobjects.v1+xml',
    preserved: [
      '<enqu:tableName>EKKO</enqu:tableName>',
      '<enqu:parameterWanted>false</enqu:parameterWanted>',
      '<enqu:parameterName>EBELP</enqu:parameterName>',
    ],
    changed: '<enqu:allowRFC>true</enqu:allowRFC>',
  },
  {
    type: 'MSAG',
    name: 'ZM',
    path: '/sap/bc/adt/messageclass/ZM',
    metadata: () => message(),
    update: {
      messages: [
        { number: '001', shortText: 'one' },
        { number: '002', shortText: 'two' },
      ],
    },
    contentType: 'application/vnd.sap.adt.mc.messageclass+xml',
    preserved: ['mc:msgno="001"', 'adtcore:language="EN"'],
    changed: 'mc:msgno="002"',
  },
];

let world: World;
const profile = (type: string) => profiles.find((candidate) => candidate.type === type)!;

beforeEach(() => {
  vi.restoreAllMocks();
  resetCachedFeatures();
  world = createWorld();
  install(world);
});
afterEach(() => {
  expect(world.unexpected).toEqual([]);
  resetCachedFeatures();
});

const NATIVE: Record<string, string> = {
  DOMA: 'DOMA/DD',
  DTEL: 'DTEL/DE',
  TTYP: 'TTYP/DA',
  ENQU: 'ENQU/DL',
  MSAG: 'MSAG/N',
};
function seed(selected: (typeof profiles)[number], metadata = selected.metadata()) {
  world.objects.set(selected.path, { metadata, nativeType: NATIVE[selected.type]! });
}

async function run(args: Record<string, unknown>) {
  const client = nativeClient();
  const mutation = context(client, world.abort);
  const ctx = await createPinnedDdicContext(client, args, config, mutation);
  const result = await executePinnedSourceWrite(ctx);
  return { result, payload: JSON.parse(result.content[0]!.text), cleanup: mutation.cleanup };
}

const update = (selected: (typeof profiles)[number], extra: Record<string, unknown> = {}) =>
  run({ action: 'update', type: selected.type, name: selected.name, ...selected.update, ...extra });

describe('metadata update', () => {
  it.each([
    { type: 'DOMA', args: { valueTable: 'T002' }, saved: ['adtcore:name="T002"'] },
    {
      type: 'DOMA',
      args: {
        fixedValues: [
          { low: '007', description: 'first' },
          { low: '008', description: 'second' },
        ],
      },
      saved: ['<doma:low>007</doma:low>', '<doma:low>008</doma:low>', '<doma:position>0002</doma:position>'],
    },
    {
      type: 'TTYP',
      args: { rowType: 'P', rowTypeKind: 'builtin', rowTypeLength: '3', rowTypeDecimals: '2' },
      saved: [
        '<ttyp:dataType>P</ttyp:dataType>',
        '<ttyp:length>000003</ttyp:length>',
        '<ttyp:decimals>000002</ttyp:decimals>',
      ],
    },
    {
      type: 'ENQU',
      args: { source: '{"primaryTable":{"tableName":"EKKO","lockMode":"S"}}' },
      saved: ['<enqu:primaryTable><enqu:tableName>EKKO</enqu:tableName><enqu:lockMode>S</enqu:lockMode>'],
    },
    {
      type: 'ENQU',
      args: { source: '{"secondaryTables":[{"tableName":"EKPO","lockMode":"S"}]}' },
      saved: ['<enqu:secondaryTable><enqu:tableName>EKPO</enqu:tableName><enqu:lockMode>S</enqu:lockMode>'],
    },
    {
      type: 'ENQU',
      args: {
        source:
          '{"lockParameters":[{"parameterName":"MANDT","tableName":"EKKO","fieldName":"MANDT","parameterWanted":true},{"parameterName":"EBELN","tableName":"EKKO","fieldName":"EBELN","parameterWanted":false}]}',
      },
      saved: [
        '<enqu:parameterName>MANDT</enqu:parameterName>',
        '<enqu:parameterWanted>false</enqu:parameterWanted><enqu:parameterName>EBELN</enqu:parameterName>',
      ],
    },
  ])('still edits the exact intended $type subtree with $args', async ({ type, args, saved }) => {
    const selected = profile(type);
    seed(selected);
    const { result, payload, cleanup } = await run({ action: 'update', type, name: selected.name, ...args });
    expect(result.isError, result.content[0]!.text).toBeUndefined();
    expect(payload.state).toBe('saved-inactive');
    expect(puts(world)).toHaveLength(1);
    for (const fragment of saved) expect(puts(world)[0]!.body).toContain(fragment);
    expect(cleanup).toMatchObject({ unlockFailed: false, sessionClosed: true });
  });
  it.each([
    {
      type: 'DOMA',
      sibling: 'fixValuesExtra',
      close: '</doma:valueInformation>',
      prefix: 'doma',
      args: { fixedValues: [] },
    },
    {
      type: 'DOMA',
      sibling: 'valueTableRefExtra',
      close: '</doma:valueInformation>',
      prefix: 'doma',
      args: { valueTable: 'T001' },
    },
    ...[
      { rowType: 'STRING' },
      { rowTypeKind: 'builtin' },
      { rowTypeLength: '000000' },
      { rowTypeDecimals: '000000' },
    ].map((args) => ({ type: 'TTYP', sibling: 'rowTypeOptions', close: '</ttyp:tableType>', prefix: 'ttyp', args })),
    {
      type: 'ENQU',
      sibling: 'primaryTableOptions',
      close: '</enqu:content>',
      prefix: 'enqu',
      args: { source: '{"primaryTable":{"tableName":"EKKO","lockMode":"E"}}' },
    },
    {
      type: 'ENQU',
      sibling: 'secondaryTablesExtra',
      close: '</enqu:content>',
      prefix: 'enqu',
      args: { source: '{"secondaryTables":[{"tableName":"EKPO","lockMode":"E"}]}' },
    },
    {
      type: 'ENQU',
      sibling: 'lockParametersExtra',
      close: '</enqu:content>',
      prefix: 'enqu',
      args: {
        source:
          '{"lockParameters":[{"parameterName":"MANDT","tableName":"EKKO","fieldName":"MANDT","parameterWanted":true}]}',
      },
    },
  ])(
    'refuses to remove an unselected native prefix sibling $sibling with $args',
    async ({ type, sibling, close, prefix, args }) => {
      const selected = profile(type);
      const stored = selected.metadata().replace(close, `<${prefix}:${sibling}>kept</${prefix}:${sibling}>${close}`);
      seed(selected, stored);
      const { result, payload, cleanup } = await run({ action: 'update', type, name: selected.name, ...args });
      expect(result.isError).toBe(true);
      expect(payload).toMatchObject({ error: 'PINNED_WRITE_REFUSED', state: 'unchanged' });
      expect(payload.message).toContain(sibling);
      expect(puts(world)).toEqual([]);
      expect(world.objects.get(selected.path)?.metadata).toBe(stored);
      expect(cleanup).toMatchObject({ unlockFailed: false, sessionClosed: true });
      expect(world.calls.filter((call) => call.path.includes('_action=UNLOCK'))).toMatchObject([{ locked: true }]);
      expect(world.locked).toBeUndefined();
    },
  );
  it.each(profiles)('$type merges fresh draft state under the lock and preserves stored fields', async (selected) => {
    seed(selected);
    const snapshot = await handleToolCall(nativeClient(), config, 'SAPRead', {
      type: selected.type,
      name: selected.name,
      format: 'editable',
    });
    expect(snapshot.isError, snapshot.content[0]!.text).toBeUndefined();
    expect(JSON.parse(snapshot.content[0]!.text).metadataHash).toMatch(/^[a-f0-9]{64}$/);
    expect(world.calls.every((call) => call.method === 'GET')).toBe(true);
    world.calls.length = 0;
    const { result, payload, cleanup } = await update(selected, {
      expectedMetadataHash: JSON.parse(snapshot.content[0]!.text).metadataHash,
    });
    expect(result.isError, result.content[0]!.text).toBeUndefined();
    expect(payload).toMatchObject({ type: selected.type, state: 'saved-inactive', nativeVersion: 'inactive' });
    expect(payload.metadataHash).toMatch(/^[a-f0-9]{64}$/);
    expect(cleanup).toMatchObject({ unlockFailed: false, sessionClosed: true });
    const [put] = puts(world);
    expect(puts(world)).toHaveLength(1);
    expect(put!.locked).toBe(true);
    expect(put!.path).toContain('lockHandle=native-lock');
    expect(String(put!.contentType)).toContain(selected.contentType);
    for (const stored of selected.preserved) expect(put!.body).toContain(stored);
    expect(put!.body).toContain(selected.changed);
    // Explicit draft view under the lock, then its read-back; never an activation.
    const draftReads = world.calls.filter(
      (call) =>
        call.method === 'GET' && call.path.split('?')[0] === selected.path && call.path.includes('version=inactive'),
    );
    expect(draftReads.map((call) => call.locked)).toEqual([true, true]);
    expect(world.calls.some((call) => call.path.includes('/activation'))).toBe(false);
  });

  it('never replaces the stored responsible or master system with an unverified identity', async () => {
    const selected = profile('DOMA');
    seed(selected);
    await update(selected);
    const [put] = puts(world);
    expect(put!.body.match(/adtcore:responsible="[^"]*"/g)).toEqual(['adtcore:responsible="SAP"']);
    expect(put!.body).not.toContain('H00');
  });

  it.each([
    { before: '007', after: '7' },
    { before: '9007199254740992', after: '9007199254740993' },
  ])('sends a numeric-looking description change from $before to $after', async ({ before, after }) => {
    const selected = profile('DOMA');
    seed(
      selected,
      selected.metadata().replace('adtcore:description="Company code"', `adtcore:description="${before}"`),
    );
    const { result, payload } = await run({ action: 'update', type: 'DOMA', name: 'BUKRS', description: after });
    expect(result.isError, result.content[0]!.text).toBeUndefined();
    expect(payload.state).toBe('saved-inactive');
    expect(puts(world)).toHaveLength(1);
    expect(puts(world)[0]!.body).toContain(`adtcore:description="${after}"`);
  });

  it('reports an ignored numeric-looking description change as an unconfirmed save', async () => {
    const selected = profile('DOMA');
    seed(selected, selected.metadata().replace('adtcore:description="Company code"', 'adtcore:description="007"'));
    world.faults.add('readback');
    const { payload, cleanup } = await run({ action: 'update', type: 'DOMA', name: 'BUKRS', description: '7' });
    expect(payload).toMatchObject({
      state: 'metadata-save-unknown',
      error: 'PINNED_WRITE_INCOMPLETE',
      retryable: false,
    });
    expect(puts(world)).toHaveLength(1);
    expect(cleanup).toMatchObject({ unlockFailed: false, sessionClosed: true });
  });

  it('applies an explicit DTEL domain change that the shared merge alone would ignore', async () => {
    const selected = profile('DTEL');
    seed(selected);
    const { payload } = await run({ action: 'update', type: 'DTEL', name: 'BUKRS', domainName: 'ZDOM' });
    expect(puts(world)[0]!.body).toContain('<dtel:typeName>ZDOM</dtel:typeName>');
    expect(payload.state).toBe('saved-inactive');
  });

  it.each(profiles)('$type reports unchanged and sends no save when the values already match', async (selected) => {
    seed(selected);
    const { payload, cleanup } = await run({
      action: 'update',
      type: selected.type,
      name: selected.name,
      description: /adtcore:description="([^"]*)"/.exec(selected.metadata())![1]!,
    });
    expect(payload.state).toBe('unchanged');
    expect(puts(world)).toEqual([]);
    expect(cleanup.sessionClosed).toBe(true);
  });

  it.each([
    {
      label: 'unknown stored element',
      type: 'DOMA',
      mutate: (xml: string) =>
        xml.replace('<doma:style>00</doma:style>', '<doma:style>00</doma:style><doma:future>x</doma:future>'),
    },
    {
      label: 'same-local-name namespace collision',
      type: 'DOMA',
      mutate: (xml: string) =>
        xml.replace('</doma:datatype>', '</doma:datatype><ext:datatype xmlns:ext="urn:extension">CHAR</ext:datatype>'),
    },
    {
      label: 'foreign derived-list lookalike',
      type: 'DOMA',
      mutate: (xml: string) =>
        xml.replace(
          '</doma:content>',
          '<ext:valueHelps xmlns:ext="urn:extension">kept</ext:valueHelps></doma:content>',
        ),
    },
    {
      label: 'foreign extension inside an explicitly selected list',
      type: 'DOMA',
      mutate: (xml: string) =>
        xml.replace('<doma:fixValues/>', '<doma:fixValues><ext:future xmlns:ext="urn:extension"/></doma:fixValues>'),
      args: { fixedValues: [] },
    },
    {
      label: 'non-default style',
      type: 'DOMA',
      mutate: (xml: string) => xml.replace('<doma:style>00', '<doma:style>07'),
    },
    {
      label: 'value table of another subtype',
      type: 'DOMA',
      mutate: (xml: string) =>
        xml.replace('adtcore:type="TABL/DT" adtcore:name="T001"', 'adtcore:type="VIEW/DV" adtcore:name="T001"'),
    },
    {
      label: 'unsupported DTEL type kind',
      type: 'DTEL',
      mutate: (xml: string) => xml.replace('<dtel:typeKind>domain<', '<dtel:typeKind>refToDictionaryType<'),
    },
    {
      label: 'non-standard table type even with rowType',
      type: 'TTYP',
      mutate: (xml: string) => xml.replace('<ttyp:accessType>standard<', '<ttyp:accessType>sorted<'),
      args: { rowType: 'STRING' },
    },
    {
      label: 'plain lookup of a non-standard table type',
      type: 'TTYP',
      mutate: (xml: string) => xml.replace('<ttyp:accessType>standard<', '<ttyp:accessType>sorted<'),
    },
  ])('refuses to drop stored state: $label', async ({ type, mutate, args }) => {
    const selected = profile(type);
    seed(selected, mutate(selected.metadata()));
    const { result, payload, cleanup } = await update(selected, args ?? {});
    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({ error: 'PINNED_WRITE_REFUSED', state: 'unchanged' });
    expect(puts(world)).toEqual([]);
    expect(cleanup).toMatchObject({ unlockFailed: false, sessionClosed: true });
  });

  it('preserves documented-message flags instead of resetting the native row', async () => {
    const selected = profile('MSAG');
    seed(
      selected,
      selected
        .metadata()
        .replace('mc:documented="false"', 'mc:documented="true"')
        .replace('mc:selfexplainatory="true"', 'mc:selfexplainatory="false"'),
    );
    const { result } = await update(selected);
    expect(result.isError).not.toBe(true);
    expect(puts(world)).toHaveLength(1);
    expect(puts(world)[0].body).toContain('mc:documented="true"');
  });

  it('refuses a message-class edit outside the master language', async () => {
    const selected = profile('MSAG');
    seed(selected, message().replace('adtcore:language="EN"', 'adtcore:language="DE"'));
    const { payload } = await update(selected);
    expect(payload.state).toBe('unchanged');
    expect(payload.message).toMatch(/master language/);
    expect(puts(world)).toEqual([]);
  });

  it.each([
    { label: 'both absent', rewrite: (xml: string) => xml.replace(/ adtcore:(?:masterLanguage|language)="EN"/g, '') },
    {
      label: 'both empty',
      rewrite: (xml: string) => xml.replace(/(adtcore:(?:masterLanguage|language)=)"EN"/g, '$1""'),
    },
    {
      label: 'both blank',
      rewrite: (xml: string) => xml.replace(/(adtcore:(?:masterLanguage|language)=)"EN"/g, '$1"  "'),
    },
    { label: 'language absent', rewrite: (xml: string) => xml.replace(' adtcore:language="EN"', '') },
    { label: 'master absent', rewrite: (xml: string) => xml.replace(' adtcore:masterLanguage="EN"', '') },
    {
      label: 'language ambiguous',
      rewrite: (xml: string) =>
        xml.replace('adtcore:language="EN"', 'adtcore:language="EN" ext:language="EN" xmlns:ext="urn:other"'),
    },
    {
      label: 'master ambiguous',
      rewrite: (xml: string) =>
        xml.replace(
          'adtcore:masterLanguage="EN"',
          'adtcore:masterLanguage="EN" ext:masterLanguage="EN" xmlns:ext="urn:other"',
        ),
    },
    {
      label: 'both padded',
      rewrite: (xml: string) => xml.replace(/(adtcore:(?:masterLanguage|language)=)"EN"/g, '$1" EN "'),
    },
  ])('refuses unproven MSAG language identity ($label) before PUT', async ({ rewrite }) => {
    const selected = profile('MSAG');
    seed(selected, rewrite(message()));
    const { result, payload, cleanup } = await update(selected);
    expect(result.isError).toBe(true);
    expect(payload.state).toBe('unchanged');
    expect(puts(world)).toEqual([]);
    expect(cleanup.unlockFailed).toBe(false);
    expect(world.locked).toBeUndefined();
  });

  it('enforces an optional stored-metadata precondition under the lock and accepts its native hash', async () => {
    const selected = profile('DOMA');
    seed(selected);
    const stale = await update(selected, { expectedMetadataHash: 'a'.repeat(64) });
    expect(stale.payload).toMatchObject({ state: 'unchanged', phase: 'metadata-read' });
    expect(puts(world)).toEqual([]);
    const first = await update(selected);
    const fresh = await run({
      action: 'update',
      type: 'DOMA',
      name: 'BUKRS',
      description: 'next',
      expectedMetadataHash: first.payload.metadataHash,
    });
    expect(fresh.payload.state).toBe('saved-inactive');
  });

  it('refuses a denied native package before LOCK and never trusts a caller package', async () => {
    const selected = profile('DOMA');
    seed(selected, selected.metadata().replace('adtcore:name="ZTEAM"', 'adtcore:name="ZDENIED"'));
    const { payload } = await update(selected);
    expect(payload.state).toBe('unchanged');
    expect(world.calls.some((call) => call.path.includes('_action=LOCK'))).toBe(false);
    await expect(update(selected, { package: 'ZTEAM' })).rejects.toThrow(/allowlist/);
  });

  it.each(['package-drift', 'identity-drift', 'cancel'])('refuses %s under the lock and cleans it', async (fault) => {
    const selected = profile('DOMA');
    seed(selected);
    world.faults.add(fault);
    if (fault === 'cancel') world.abort = new AbortController();
    const { result, payload, cleanup } = await update(selected);
    expect(result.isError).toBe(true);
    expect(payload.state).toBe('unchanged');
    expect(puts(world)).toEqual([]);
    expect(cleanup.unlockFailed).toBe(false);
    expect(world.locked).toBeUndefined();
  });

  it('records transportable saves on the verified parent, and refuses another CTS tree', async () => {
    const selected = profile('DOMA');
    seed(selected);
    world.transported = true;
    const { payload } = await update(selected, { transport: 'A4HK900002' });
    expect(payload.transport).toBe('A4HK900001');
    expect(puts(world)[0]!.path).toContain('corrNr=A4HK900001');
    world.calls.length = 0;
    world.faults.add('cts');
    const refused = await update(selected, { transport: 'A4HK900002' });
    expect(refused.payload.state).toBe('unchanged');
    expect(puts(world)).toEqual([]);
  });

  it('refuses a local object naming a CTS request and an empty request', async () => {
    const selected = profile('DOMA');
    seed(selected);
    const local = await update(selected, { transport: 'A4HK900001' });
    expect(local.payload.message).toMatch(/local object/);
    await expect(update(selected, { transport: ' ' })).rejects.toThrow(/must not be empty/);
  });

  it.each([
    { fault: 'save-unknown', state: 'metadata-save-unknown', error: 'PINNED_WRITE_INCOMPLETE' },
    { fault: 'save-rejected', state: 'metadata-save-rejected', error: 'PINNED_WRITE_REFUSED' },
    { fault: 'readback', state: 'metadata-save-unknown', error: 'PINNED_WRITE_INCOMPLETE' },
  ])('reports $fault truthfully, once, with cleanup', async ({ fault, state, error }) => {
    const selected = profile('DOMA');
    seed(selected);
    world.faults.add(fault);
    const { payload, cleanup } = await update(selected);
    expect(payload).toMatchObject({ error, state, retryable: false });
    expect(puts(world)).toHaveLength(1);
    expect(cleanup).toMatchObject({ unlockFailed: false, sessionClosed: true });
  });

  it('reports a saved value whose unlock failed as incomplete with cleanup evidence', async () => {
    const selected = profile('DOMA');
    seed(selected);
    world.faults.add('unlock');
    const { result, payload } = await update(selected);
    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({ state: 'saved-inactive', cleanupFailed: true, retryable: false });
  });

  it('stays bounded by the metadata budget', async () => {
    const selected = profile('DOMA');
    seed(selected);
    world.faults.add('budget');
    const { result, payload } = await update(selected);
    expect(result.isError).toBe(true);
    expect(payload.state).toBe('unchanged');
    expect(puts(world)).toEqual([]);
  });
});

describe('metadata create', () => {
  const absent = (selected: (typeof profiles)[number]) => seed(selected, '');

  it('creates a DOMA with the POST alone and proves the requested definition by read-back', async () => {
    const selected = profile('DOMA');
    absent(selected);
    const { result, payload } = await run({
      action: 'create',
      type: 'DOMA',
      name: 'BUKRS',
      package: 'zteam',
      dataType: 'CHAR',
      length: 4,
    });
    expect(result.isError, result.content[0]!.text).toBeUndefined();
    expect(payload).toMatchObject({ state: 'created', nativeVersion: 'inactive' });
    expect(puts(world)).toEqual([]);
    const post = world.calls.find((call) => call.method === 'POST' && call.path.startsWith('/sap/bc/adt/ddic/domains'));
    expect(post!.body).toContain('adtcore:name="ZTEAM"');
    expect(post!.body).not.toContain('adtcore:responsible');
  });

  it.each([
    { type: 'DTEL', args: { typeKind: 'domain', typeName: 'BUKRS', shortLabel: 'Co' } },
    { type: 'TTYP', args: { rowType: 'STRING' } },
    { type: 'MSAG', args: { messages: [{ number: '001', shortText: 'one' }] } },
  ])('$type follows the POST with its required locked save', async ({ type, args }) => {
    const selected = profile(type);
    absent(selected);
    const { result, payload, cleanup } = await run({
      action: 'create',
      type,
      name: selected.name,
      package: 'ZTEAM',
      ...args,
    });
    expect(result.isError, result.content[0]!.text).toBeUndefined();
    expect(payload.state).toBe('created');
    expect(puts(world)).toHaveLength(1);
    expect(puts(world)[0]!.locked).toBe(true);
    expect(cleanup.sessionClosed).toBe(true);
  });

  it('creates a lock object from its JSON definition without a follow-up save', async () => {
    const selected = profile('ENQU');
    absent(selected);
    const { payload } = await run({
      action: 'create',
      type: 'ENQU',
      name: 'EMEKKOE',
      package: 'ZTEAM',
      source: '{"primaryTable":{"tableName":"EKKO","lockMode":"E"}}',
    });
    expect(payload.state).toBe('created');
    expect(puts(world)).toEqual([]);
  });

  it('never repeats the POST and reports the created shell after a failed follow-up', async () => {
    const selected = profile('DTEL');
    absent(selected);
    world.faults.add('save-unknown');
    const { payload } = await run({
      action: 'create',
      type: 'DTEL',
      name: 'BUKRS',
      package: 'ZTEAM',
      typeKind: 'domain',
      typeName: 'BUKRS',
    });
    expect(payload).toMatchObject({
      state: 'created-metadata-unknown',
      error: 'PINNED_WRITE_INCOMPLETE',
      retryable: false,
    });
    expect(posts(world, selected.path.replace(/\/[^/]+$/, ''))).toHaveLength(1);
  });

  it.each([
    { fault: 'create-rejected', state: 'creation-rejected', error: 'PINNED_WRITE_REFUSED' },
    { fault: 'create-unknown', state: 'creation-unknown', error: 'PINNED_WRITE_INCOMPLETE' },
  ])('preserves $fault', async ({ fault, state, error }) => {
    const selected = profile('DOMA');
    absent(selected);
    world.faults.add(fault);
    const { payload } = await run({
      action: 'create',
      type: 'DOMA',
      name: 'BUKRS',
      package: 'ZTEAM',
      dataType: 'CHAR',
      length: 4,
    });
    expect(payload).toMatchObject({ state, error });
  });

  it('refuses a denied requested package before any recording request', async () => {
    const selected = profile('DOMA');
    absent(selected);
    const { payload } = await run({
      action: 'create',
      type: 'DOMA',
      name: 'BUKRS',
      package: 'ZDENIED',
      dataType: 'CHAR',
      length: 4,
    }).catch((error) => ({ payload: { message: String(error) } }) as never);
    expect(JSON.stringify(payload)).toMatch(/ZDENIED|package|allow/i);
    expect(world.calls.some((call) => call.path.includes('/transportchecks'))).toBe(false);
    expect(world.calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it.each([
    { type: 'DOMA', args: { dataType: 'CHAR' }, reason: /explicit package/ },
    { type: 'TTYP', args: { package: 'ZTEAM' }, reason: /rowType/ },
    { type: 'ENQU', args: { package: 'ZTEAM' }, reason: /JSON source/ },
    { type: 'ENQU', args: { package: 'ZTEAM', source: '[]' }, reason: /JSON object/ },
    { type: 'DOMA', args: { package: 'ZTEAM', fixedValues: [{ wrong: 'x' }] }, reason: /fixedValues/ },
    { type: 'MSAG', args: { package: 'ZTEAM', messages: 'x' }, reason: /messages/ },
  ])('refuses unusable $type create input before HTTP', async ({ type, args, reason }) => {
    await expect(run({ action: 'create', type, name: 'ZNAME', ...args })).rejects.toThrow(reason);
    expect(world.calls).toEqual([]);
  });

  it.each([
    { type: 'DOMA', flag: 'domains' },
    { type: 'TTYP', flag: 'tabletypes' },
    { type: 'ENQU', flag: 'lockobjects' },
  ])('refuses $type create where discovery proves the endpoint absent', async ({ type }) => {
    setCachedFeatures({
      ...featuresOff(),
      discoveryMap: new Map([['/sap/bc/adt/programs/programs', ['application/*']]]),
    } as never);
    await expect(
      run({ action: 'create', type, name: 'ZNAME', package: 'ZTEAM', rowType: 'STRING', source: '{}' }),
    ).rejects.toThrow();
    expect(world.calls).toEqual([]);
  });
});

describe('metadata delete', () => {
  it.each(profiles)('$type deletes under the owning lock and proves typed absence', async (selected) => {
    seed(selected);
    const { result, payload, cleanup } = await run({ action: 'delete', type: selected.type, name: selected.name });
    expect(result.isError, result.content[0]!.text).toBeUndefined();
    expect(payload).toMatchObject({ ok: true, state: 'deleted' });
    expect(cleanup).toMatchObject({ unlockFailed: false, sessionClosed: true });
    expect(world.calls.find((call) => call.method === 'DELETE')!.locked).toBe(true);
  });

  it.each([
    { fault: 'delete-rejected', state: 'delete-rejected' },
    { fault: 'delete-unknown', state: 'delete-unconfirmed' },
    { fault: 'package-drift', state: 'unchanged' },
  ])('reports $fault without retrying the DELETE', async ({ fault, state }) => {
    const selected = profile('DOMA');
    seed(selected);
    world.faults.add(fault);
    const { result, payload } = await run({ action: 'delete', type: 'DOMA', name: 'BUKRS' });
    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({ ok: false, state, retryable: false });
    expect(world.calls.filter((call) => call.method === 'DELETE').length).toBeLessThanOrEqual(1);
  });

  it('refuses metadata inputs on delete', async () => {
    await expect(run({ action: 'delete', type: 'DOMA', name: 'BUKRS', dataType: 'CHAR' })).rejects.toThrow(/allowlist/);
  });
});

describe('private profile boundaries', () => {
  it.each(['batch_create', 'edit_method', 'edit_text_symbols', undefined])('refuses action %s', async (action) => {
    await expect(run({ action, type: 'DOMA', name: 'BUKRS' })).rejects.toThrow(/create, update and delete only/);
    expect(world.calls).toEqual([]);
  });

  it.each([
    { group: 'ZG' },
    { include: 'main' },
    { lintBeforeWrite: false },
    { checkBeforeWrite: false },
    { preflightBeforeWrite: false },
    { expectedSourceHash: 'a'.repeat(64) },
    { refObjectType: 'DDLS/DF' },
  ])('refuses unreviewed input %j', async (extra) => {
    await expect(run({ action: 'update', type: 'DOMA', name: 'BUKRS', length: 4, ...extra })).rejects.toThrow(
      /allowlist/,
    );
    expect(world.calls).toEqual([]);
  });

  it('refuses an update selecting nothing and a malformed metadata precondition', async () => {
    await expect(run({ action: 'update', type: 'DOMA', name: 'BUKRS' })).rejects.toThrow(/at least one/);
    await expect(
      run({ action: 'update', type: 'DOMA', name: 'BUKRS', length: 4, expectedMetadataHash: 'x' }),
    ).rejects.toThrow(/SHA-256/);
  });

  it.each(['SHLP', 'VIEW', 'SKTD', 'SRVB', 'ENHO', 'TRAN'])('keeps %s refused', async (type) => {
    await expect(run({ action: 'update', type, name: 'ZNAME' })).rejects.toThrow(new RegExp(type));
    expect(world.calls).toEqual([]);
  });

  it('refuses to build a context without a registered pinned mutation context', async () => {
    const client = nativeClient();
    await expect(
      createPinnedDdicContext(
        client,
        { action: 'update', type: 'DOMA', name: 'BUKRS', length: 4 },
        config,
        {} as never,
      ),
    ).rejects.toThrow(/mutation context/);
  });

  it.each(profiles)('keeps public pinned $type writes closed', async (selected) => {
    seed(selected);
    for (const args of [
      { action: 'create', package: 'ZTEAM' },
      { action: 'update', description: 'x' },
      { action: 'delete' },
    ]) {
      const result = await handleToolCall(nativeClient(), config, 'SAPWrite', {
        type: selected.type,
        name: selected.name,
        ...args,
      });
      expect(result.isError).toBe(true);
    }
    expect(world.calls).toEqual([]);
  });

  it('keeps every DDIC mutation closed on a read-only pinned route', async () => {
    const { multiTargetWrite: _omitted, ...readOnly } = config;
    const client = nativeClient(undefined, { allowWrites: false, multiTargetWrite: undefined as never });
    const result = await handleToolCall(client, { ...readOnly, allowWrites: false } as never, 'SAPWrite', {
      action: 'update',
      type: 'DOMA',
      name: 'BUKRS',
      description: 'x',
    });
    expect(result.isError).toBe(true);
    expect(() => context(client)).toThrow(/pinned mutation policy/);
    expect(world.calls.filter((call) => call.method !== 'GET' && call.method !== 'HEAD')).toEqual([]);
  });
});

it.each(profiles)('public $type editable metadata guards reach the shared native merge', async (selected) => {
  seed(selected);
  const client = nativeClient();
  const settings = { ...config, multiTargetAuthorization: 'xsuaa-attribute' as const };
  const read = await handleToolCall(
    client,
    settings,
    'SAPRead',
    { type: selected.type, name: selected.name, format: 'editable' },
    pinnedPublicAuth(),
    undefined,
    undefined,
    true,
  );
  expect(read.isError, read.content[0].text).toBeUndefined();
  const evidence = JSON.parse(read.content[0].text);
  expect(evidence.metadataHash).toMatch(/^[a-f0-9]{64}$/);
  const args = {
    action: 'update',
    type: selected.type,
    name: selected.name,
    ...selected.update,
    expectedMetadataHash: evidence.metadataHash,
  };
  const stale = await handleToolCall(
    client,
    settings,
    'SAPWrite',
    { ...args, expectedMetadataHash: '0'.repeat(64) },
    pinnedPublicAuth(),
    undefined,
    undefined,
    true,
  );
  expect(stale.isError).toBe(true);
  expect(puts(world)).toHaveLength(0);
  const result = await handleToolCall(
    client,
    settings,
    'SAPWrite',
    args,
    pinnedPublicAuth(),
    undefined,
    undefined,
    true,
  );
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(puts(world)).toHaveLength(1);
  for (const preserved of selected.preserved) expect(world.objects.get(selected.path)!.metadata).toContain(preserved);
});
