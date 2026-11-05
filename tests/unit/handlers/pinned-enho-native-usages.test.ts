import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { config, context, createWorld, fixture, install, nativeClient, type World } from './pinned-ddic-harness.js';
import { mockFetch } from './setup-undici-mock.js';

const { parsePinnedDocument, pinnedDocumentSelection, documentStableValue, readNativeDocument } = await import(
  '../../../src/adt/pinned-document-owner.js'
);
const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { handlePrivatePinnedDocumentWrite: write } = await import(
  '../../../src/handlers/write/pinned-document-write.js'
);
const selected = pinnedDocumentSelection('ENHO', 'ZABAPGIT_REPOS');
const xml = fixture('xml/enhancement-implementation-mixed-usages.xml');
const enho = 'http://www.sap.com/adt/enhancements/enho',
  enhcore = 'http://www.sap.com/abapsource/enhancementscore';
const usageRows = (body: string) =>
  [...body.matchAll(/<enhcore:referencedObject\b[\s\S]*?<\/enhcore:referencedObject>/g)].map((match) => match[0]);
const replaceRows = (rows: string[]) =>
  xml.replace(/<enho:usages>[\s\S]*?<\/enho:usages>/, `<enho:usages>${rows.join('')}</enho:usages>`);
const usages = (body: string) =>
  parsePinnedDocument(body, selected).root.child('contentCommon', enho)!.child('usages', enho)!.canonicalValue({});
const settings = {
  ...config,
  allowedPackages: ['$TEST_ABAPGIT'],
  multiTargetWrite: { ...config.multiTargetWrite, allowedPackages: ['$TEST_ABAPGIT'] },
};
const readonly = {
  ...settings,
  allowWrites: false,
  allowedPackages: ['$DENIED'],
  multiTargetWrite: { ...settings.multiTargetWrite, enabled: false, allowedPackages: ['$DENIED'] },
};
let world: World;
beforeEach(() => {
  vi.restoreAllMocks();
  world = createWorld();
  install(world);
  world.objects.set(selected.objectUrl, { metadata: xml, nativeType: selected.native });
  // Controlled spot dependency; the complete owner fixture is the sanitized native receipt.
  const spot = fixture('xml/enhancement-spot.xml')
    .replaceAll('ES_MY_SPOT', 'SADT_REST_RFC_APPLICATION')
    .replaceAll('BADI_MY_FILTERED', 'BADI_ADT_REST_RFC_APPLICATION')
    .replaceAll('BADI_MY_PLAIN', 'BADI_ADT_DISCOVERY_PROVIDER')
    .replace('<enhs:contentSpecific>', '<enhs:contentCommon enhs:internal="false"/><enhs:contentSpecific>');
  world.objects.set('/sap/bc/adt/enhancements/enhsxsb/sadt_rest_rfc_application', {
    metadata: spot,
    nativeType: 'ENHS/XSB',
  });
});
afterEach(() => expect(world.unexpected).toEqual([]));
async function update(expectedMetadataHash = parsePinnedDocument(xml, selected).hash) {
  const client = nativeClient(undefined, settings);
  return write(
    client,
    { action: 'update', type: 'ENHO', name: selected.name, description: 'Updated description', expectedMetadataHash },
    settings,
    context(client),
  );
}
it.each([undefined, 'active', 'inactive'] as const)(
  'reads the complete native mixed-usage shape in %s view without write grants',
  async (version) => {
    const parsed = await readNativeDocument(nativeClient(undefined, readonly), selected, version);
    expect(parsed).toMatchObject({
      xml,
      version: 'active',
      packageName: '$TEST_ABAPGIT',
      refName: 'SADT_REST_RFC_APPLICATION',
      refType: 'ENHS/XSB',
    });
    expect(world.calls).toHaveLength(1);
    expect(world.calls[0]!.method).toBe('GET');
    expect(
      parsed.root.child('contentCommon', enho)!.child('usages', enho)!.children('referencedObject', enhcore),
    ).toHaveLength(4);
  },
);
it('returns the complete editable metadata through the actual read-only public handler', async () => {
  const result = await handleToolCall(
    nativeClient(undefined, readonly),
    readonly,
    'SAPRead',
    { type: 'ENHO', name: selected.name, format: 'editable' },
    { token: 'reader', clientId: 'reader', scopes: ['read'] },
  );
  expect(result.isError, result.content[0]?.text).toBeUndefined();
  expect(JSON.parse(result.content[0]!.text)).toMatchObject({
    metadataXml: xml,
    nativeVersion: 'active',
    package: '$TEST_ABAPGIT',
    metadataHash: parsePinnedDocument(xml, selected).hash,
  });
  expect(world.calls).toHaveLength(1);
  expect(world.calls[0]!.method).toBe('GET');
});
it('selects the unique spot independently of usage order and native prefix spelling', () => {
  const rows = usageRows(xml);
  for (const order of [[rows[1]!, rows[0]!, rows[3]!, rows[2]!], [...rows].reverse()])
    expect(parsePinnedDocument(replaceRows(order), selected).refName).toBe('SADT_REST_RFC_APPLICATION');
  expect(
    parsePinnedDocument(xml.replaceAll('enhcore:', 'native:').replaceAll('xmlns:enhcore=', 'xmlns:native='), selected)
      .refName,
  ).toBe('SADT_REST_RFC_APPLICATION');
});
const mutations = [
  ['duplicate spot', (rows: string[]) => [...rows, rows[1]!]],
  [
    'different second spot',
    (rows: string[]) => [
      ...rows,
      rows[1]!.replaceAll('SADT_REST_RFC_APPLICATION', 'ZOTHER').replaceAll('sadt_rest_rfc_application', 'zother'),
    ],
  ],
  ['missing spot', (rows: string[]) => rows.filter((_, i) => i !== 1)],
  ['unknown usage type', (rows: string[]) => [rows[0]!.replaceAll('CLAS/OC', 'FUGR/F'), ...rows.slice(1)]],
  [
    'foreign object namespace',
    (rows: string[]) => [
      rows[0]!.replace('<enhcore:objectReference ', '<bad:objectReference xmlns:bad="urn:foreign" '),
      ...rows.slice(1),
    ],
  ],
  [
    'foreign usage namespace',
    (rows: string[]) => [
      rows[0]!.replace('http://www.sap.com/abapsource/enhancementscore', 'urn:foreign'),
      ...rows.slice(1),
    ],
  ],
  [
    'missing main reference',
    (rows: string[]) => [rows[0]!.replace(/<enhcore:mainObjectReference[^>]*\/>/, ''), ...rows.slice(1)],
  ],
  [
    'mismatched main name',
    (rows: string[]) => [
      rows[0]!.replace(/(<enhcore:mainObjectReference[^>]*adtcore:name=")[^"]*/, '$1ZOTHER'),
      ...rows.slice(1),
    ],
  ],
  [
    'mismatched main type',
    (rows: string[]) => [
      rows[0]!.replace(/(<enhcore:mainObjectReference[^>]*adtcore:type=")[^"]*/, '$1INTF/OI'),
      ...rows.slice(1),
    ],
  ],
  [
    'extra query on usage URI',
    (rows: string[]) => [
      rows[0]!.replaceAll('/zcl_abapgit_res_repos_app', '/zcl_abapgit_res_repos_app?version=active'),
      ...rows.slice(1),
    ],
  ],
  [
    'mismatched main URI',
    (rows: string[]) => [
      rows[0]!.replace(/(<enhcore:mainObjectReference[^>]*adtcore:uri=")[^"]*/, '$1/sap/bc/adt/oo/classes/zother'),
      ...rows.slice(1),
    ],
  ],
  [
    'wrong native route',
    (rows: string[]) => [...rows.slice(0, 2), rows[2]!.replaceAll('/oo/interfaces/', '/oo/classes/'), rows[3]!],
  ],
  [
    'absolute foreign URI',
    (rows: string[]) => [
      rows[0]!.replaceAll('/sap/bc/adt/oo/classes/', 'https://foreign.invalid/sap/bc/adt/oo/classes/'),
      ...rows.slice(1),
    ],
  ],
  [
    'traversal URI',
    (rows: string[]) => [rows[0]!.replaceAll('/oo/classes/', '/oo/classes/../classes/'), ...rows.slice(1)],
  ],
  [
    'encoded unexpected name',
    (rows: string[]) => [
      rows[0]!.replaceAll('/zcl_abapgit_res_repos_app', '/%7acl_abapgit_res_repos_app'),
      ...rows.slice(1),
    ],
  ],
] as const;
it.each(mutations)('refuses %s before a lock or save', async (_name, mutate) => {
  const expected = parsePinnedDocument(xml, selected).hash;
  world.objects.get(selected.objectUrl)!.metadata = replaceRows(mutate(usageRows(xml)));
  expect(() => parsePinnedDocument(world.objects.get(selected.objectUrl)!.metadata, selected)).toThrow();
  expect((await update(expected)).isError).toBe(true);
  expect(world.calls.some((c) => c.method === 'PUT' || c.path.includes('_action=LOCK'))).toBe(false);
});
it('preserves every native common usage and opaque implementation field through a guarded save', async () => {
  const result = await update();
  expect(result.isError, result.content[0]?.text).toBeUndefined();
  expect(JSON.parse(result.content[0]!.text).state).toBe('saved-inactive');
  const stored = world.objects.get(selected.objectUrl)!.metadata;
  expect(usages(stored)).toEqual(usages(xml));
  expect(parsePinnedDocument(stored, selected).root.child('contentSpecific', enho)!.canonicalValue({})).toEqual(
    parsePinnedDocument(xml, selected).root.child('contentSpecific', enho)!.canonicalValue({}),
  );
  expect(stored).toContain('enho:runtimeBehaviorShorttext=');
  expect(stored).toContain('enho:filterProperty=');
  expect(world.calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
  expect(world.calls.filter((c) => c.path.includes('_action=UNLOCK'))).toHaveLength(1);
});
const drift = (body: string) =>
  body.replaceAll('IF_ADT_DISCOVERY_PROVIDER', 'IF_CHANGED').replaceAll('if_adt_discovery_provider', 'if_changed');
it('includes other native references in both the expected metadata hash and stable state', () => {
  expect(parsePinnedDocument(drift(xml), selected).hash).not.toBe(parsePinnedDocument(xml, selected).hash);
  expect(documentStableValue(drift(xml), selected)).not.toBe(documentStableValue(xml, selected));
});
it('refuses usage drift appearing only under the owning lock without PUT', async () => {
  const original = mockFetch.getMockImplementation()!;
  mockFetch.mockImplementation(async (...args: Parameters<typeof original>) => {
    if (world.locked)
      world.objects.get(selected.objectUrl)!.metadata = drift(world.objects.get(selected.objectUrl)!.metadata);
    return original(...args);
  });
  expect((await update()).isError).toBe(true);
  expect(world.calls.some((c) => c.method === 'PUT')).toBe(false);
  expect(world.calls.some((c) => c.path.includes('_action=UNLOCK'))).toBe(true);
});
it('keeps a one-shot save unconfirmed if native readback changes an additional reference', async () => {
  const original = mockFetch.getMockImplementation()!;
  mockFetch.mockImplementation(async (...args: Parameters<typeof original>) => {
    const response = await original(...args);
    if (args[1]?.method === 'PUT')
      world.objects.get(selected.objectUrl)!.metadata = drift(world.objects.get(selected.objectUrl)!.metadata);
    return response;
  });
  const result = await update();
  expect(result.isError).toBe(true);
  expect(JSON.parse(result.content[0]!.text).state).toBe('document-save-unconfirmed');
  expect(world.calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
});

it('refuses a stale metadata precondition after additional usage drift before locking', async () => {
  const expected = parsePinnedDocument(xml, selected).hash;
  world.objects.get(selected.objectUrl)!.metadata = drift(xml);
  expect((await update(expected)).isError).toBe(true);
  expect(world.calls.some((c) => c.method === 'PUT' || c.path.includes('_action=LOCK'))).toBe(false);
});

it('reuses exact-owner activation with the mixed native usages retained', async () => {
  world.objects.get(selected.objectUrl)!.metadata = xml.replace(
    'adtcore:version="active"',
    'adtcore:version="inactive"',
  );
  const { handlePrivatePinnedDocumentActivation: activate } = await import(
    '../../../src/handlers/write/pinned-activation.js'
  );
  const result = await activate(nativeClient(undefined, settings), { type: 'ENHO', name: selected.name });
  expect(result.isError, result.content[0]?.text).toBeUndefined();
  expect(JSON.parse(result.content[0]!.text).state).toBe('activated');
  expect(usages(world.objects.get(selected.objectUrl)!.metadata)).toEqual(usages(xml));
  expect(
    world.calls.filter((c) => c.path.includes('/activation') && !c.path.includes('preauditRequested=true')),
  ).toHaveLength(1);
});
