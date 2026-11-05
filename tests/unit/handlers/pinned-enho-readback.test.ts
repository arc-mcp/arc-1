/** Synthetic owned bodies using the exact slots from target-bound XHB persistence/ST evidence. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { config, context, createWorld, fixture, install, type World } from './pinned-ddic-harness.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { parsePinnedDocument, pinnedDocumentSelection } = await import('../../../src/adt/pinned-document-owner.js');
const { enhoSavedMatches: compareSaved } = await import('../../../src/adt/pinned-enho-document.js');
const { defaultSafetyConfig } = await import('../../../src/adt/safety.js');
const { handlePrivatePinnedDocumentWrite } = await import('../../../src/handlers/write/pinned-document-write.js');

const selected = pinnedDocumentSelection('ENHO', 'ZTEST');
const enhoSavedMatches = (intended: string, saved: string, selection = selected) =>
  compareSaved(empty(true), intended, saved, selection);
const source = {
  enhancementSpot: 'BCF_REMOTE_TCD',
  badiImplementations: [
    {
      name: 'ZOWNED',
      badiDefinition: 'BCF_TCD_REMOTE_BADI',
      implementingClass: 'ZCL_OWNED',
      shortText: 'Owned',
      active: false,
      default: false,
    },
  ],
};
const opaque = '<x:opaque xmlns:x="urn:test" x:value="001">  keep  </x:opaque>';
let world: World;
let afterSave: (body: string) => string;
function render(body: string) {
  return body
    .replace(/<enho:badiImplementation\b[^>]*>/g, (open) => {
      open = open.replace(/ enho:runtimeBehaviorShorttext="[^"]*"/g, '');
      if (!open.includes('enho:customizingLock=')) open = open.replaceAll('>', ' enho:customizingLock="">');
      return open.replaceAll('>', ' enho:runtimeBehaviorShorttext="Synthetic read-only state">');
    })
    .replaceAll(
      '/sap/bc/adt/vit/wb/object_type/enhsxb/object_name/BCF_REMOTE_TCD',
      '/sap/bc/adt/enhancements/enhsxsb/bcf_remote_tcd#type=enhs%2fxb;name=bcf_tcd_remote_badi',
    )
    .replace(
      body.includes('enhcore:element_usage="USEO"') ? '__no_added_usage__' : '</enho:usages>',
      '<enhcore:referencedObject enhcore:program_id="R3TR" enhcore:element_usage="USEO" enhcore:upgrade="false" enhcore:automatic_transport="false"><enhcore:objectReference adtcore:name="ZCL_OWNED" adtcore:type="CLAS/OC" adtcore:uri="/sap/bc/adt/oo/classes/zcl_owned"/><enhcore:mainObjectReference adtcore:name="ZCL_OWNED" adtcore:type="CLAS/OC" adtcore:uri="/sap/bc/adt/oo/classes/zcl_owned"/></enhcore:referencedObject></enho:usages>',
    );
}
function empty(withList = false) {
  return fixture('xml/enhancement-implementation.xml')
    .replaceAll('SFW_BCF_TCD', 'ZTEST')
    .replaceAll('SFWTOOLS', 'ZTEAM')
    .replace('adtcore:version="active"', 'adtcore:version="inactive"')
    .replace(
      /<enho:badiImplementations>[\s\S]*?<\/enho:badiImplementations>/,
      withList ? '<enho:badiImplementations/>' : '',
    )
    .replace('</enho:badiTechnology>', `${opaque}</enho:badiTechnology>`);
}
function client() {
  return new AdtClient({
    baseUrl: 'https://enho.invalid',
    client: '001',
    safety: { ...defaultSafetyConfig(), ...config },
  });
}
async function write(action = 'update', extra: Record<string, unknown> = {}) {
  const c = client(),
    metadata = world.objects.get(selected.objectUrl)!.metadata;
  return handlePrivatePinnedDocumentWrite(
    c,
    {
      action,
      type: 'ENHO',
      name: 'ZTEST',
      ...(action === 'create' ? { package: 'ZTEAM' } : {}),
      description: 'Owned',
      source: JSON.stringify(source),
      ...(action === 'update'
        ? { expectedMetadataHash: extra.expectedMetadataHash ?? parsePinnedDocument(metadata, selected).hash }
        : {}),
      ...extra,
    },
    config,
    context(c),
  );
}
beforeEach(() => {
  vi.restoreAllMocks();
  world = createWorld();
  afterSave = (body) => body;
  install(world);
  const spot = fixture('xml/enhancement-spot.xml')
    .replaceAll('ES_MY_SPOT', 'BCF_REMOTE_TCD')
    .replaceAll('BADI_MY_PLAIN', 'BCF_TCD_REMOTE_BADI')
    .replace('<enhs:contentSpecific>', '<enhs:contentCommon enhs:internal="false"/><enhs:contentSpecific>');
  world.objects.set('/sap/bc/adt/enhancements/enhsxsb/bcf_remote_tcd', { metadata: spot, nativeType: 'ENHS/XSB' });
  world.objects.set(selected.objectUrl, { metadata: empty(), nativeType: 'ENHO/XHB' });
  const original = mockFetch.getMockImplementation()!;
  mockFetch.mockImplementation(async (url, init: any = {}) => {
    const response = await original(url, init);
    if (init.method === 'PUT' && new URL(String(url)).pathname === selected.objectUrl) {
      const obj = world.objects.get(selected.objectUrl)!;
      obj.metadata = afterSave(render(obj.metadata));
    }
    return response;
  });
});
afterEach(() => expect(world.unexpected).toEqual([]));
it.each([false, true])(
  'updates the source-proved empty slot (%s) then verifies native derived readback',
  async (list) => {
    world.objects.get(selected.objectUrl)!.metadata = empty(list);
    const result = await write();
    expect(result.isError, result.content[0]?.text).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toMatchObject({ state: 'saved-inactive', nativeVersion: 'inactive' });
    expect(world.calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
    expect(world.objects.get(selected.objectUrl)!.metadata).toContain(opaque);
    expect(world.locked).toBeUndefined();
  },
);
it('full create composes empty native container → owning PUT → derived native readback', async () => {
  world.objects.get(selected.objectUrl)!.metadata = '';
  world.createdMetadata = (body) =>
    body
      .replace(/<enho:badiImplementations>[\s\S]*?<\/enho:badiImplementations>/, '')
      .replace('<enho:objectData ', '<enho:objectData adtcore:version="new" ')
      .replace('<adtcore:packageRef ', '<adtcore:packageRef adtcore:type="DEVC/K" ');
  const result = await write('create');
  expect(result.isError, result.content[0]?.text).toBeUndefined();
  expect(JSON.parse(result.content[0].text).state).toBe('created');
  expect(world.calls.filter((c) => c.method === 'POST' && c.path.split('?')[0] === selected.collection)).toHaveLength(
    1,
  );
  expect(world.calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
  expect(world.locked).toBeUndefined();
});
it.each(['technology-missing', 'technology-foreign', 'list-foreign', 'list-duplicate', 'list-malformed'])(
  'refuses %s before PUT',
  async (fault) => {
    let xml = empty(true);
    if (fault === 'technology-missing') xml = xml.replace(/<enho:badiTechnology>[\s\S]*?<\/enho:badiTechnology>/, '');
    if (fault === 'technology-foreign')
      xml = xml
        .replaceAll('enho:badiTechnology', 'x:badiTechnology')
        .replace('<x:badiTechnology>', '<x:badiTechnology xmlns:x="urn:foreign">');
    if (fault === 'list-foreign')
      xml = xml.replace('<enho:badiImplementations/>', '<x:badiImplementations xmlns:x="urn:foreign"/>');
    if (fault === 'list-duplicate')
      xml = xml.replace('<enho:badiImplementations/>', '<enho:badiImplementations/><enho:badiImplementations/>');
    if (fault === 'list-malformed')
      xml = xml.replace('<enho:badiImplementations/>', '<enho:badiImplementations>invalid</enho:badiImplementations>');
    world.objects.get(selected.objectUrl)!.metadata = xml;
    expect((await write('update', { expectedMetadataHash: '0'.repeat(64) })).isError).toBe(true);
    expect(world.calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  },
);
it.each(['runtime', 'empty-lock', 'mapped-uri', 'usage', 'all'])(
  'post-save comparison permits only known %s presentation',
  async (field) => {
    await write();
    const body = world.calls.find((c) => c.method === 'PUT')!.body;
    let saved = body;
    if (field === 'runtime')
      saved = saved.replace(
        '<enho:badiImplementation ',
        '<enho:badiImplementation enho:runtimeBehaviorShorttext="Native display" ',
      );
    if (field === 'empty-lock')
      saved = saved.replace('<enho:badiImplementation ', '<enho:badiImplementation enho:customizingLock="" ');
    if (field === 'mapped-uri')
      saved = saved.replaceAll(
        '/sap/bc/adt/vit/wb/object_type/enhsxb/object_name/BCF_REMOTE_TCD',
        '/sap/bc/adt/enhancements/enhsxsb/bcf_remote_tcd#type=enhs%2fxb;name=bcf_tcd_remote_badi',
      );
    if (field === 'usage')
      saved = render(body)
        .replace(/ enho:runtimeBehaviorShorttext="[^"]*"/g, '')
        .replace(/ enho:customizingLock=""/g, '');
    if (field === 'all') saved = render(body);
    expect(enhoSavedMatches(body, saved, selected)).toBe(true);
    expect(parsePinnedDocument(body, selected).hash).not.toBe(parsePinnedDocument(saved, selected).hash);
  },
);
it.each([
  'customizing',
  'opaque',
  'foreign-attribute',
  'spot',
  'definition',
  'class',
  'filter',
  'unknown-usage',
  'usage-role',
  'usage-duplicate',
])('post-save comparison rejects %s loss/drift', async (field) => {
  await write();
  let body = world.calls.find((c) => c.method === 'PUT')!.body,
    saved = render(body);
  if (field === 'customizing') {
    body = body.replace('<enho:badiImplementation ', '<enho:badiImplementation enho:customizingLock="X" ');
  }
  if (field === 'opaque') saved = saved.replace(opaque, '');
  if (field === 'foreign-attribute')
    saved = saved.replace(
      '<enho:badiImplementation ',
      '<enho:badiImplementation xmlns:x="urn:foreign" x:runtimeBehaviorShorttext="decoy" ',
    );
  if (field === 'spot')
    saved = saved.replaceAll('BCF_REMOTE_TCD', 'OTHER_SPOT').replaceAll('bcf_remote_tcd', 'other_spot');
  if (field === 'definition')
    saved = saved.replaceAll('BCF_TCD_REMOTE_BADI', 'OTHER_BADI').replaceAll('bcf_tcd_remote_badi', 'other_badi');
  if (field === 'class') saved = saved.replaceAll('ZCL_OWNED', 'ZCL_FOREIGN').replaceAll('zcl_owned', 'zcl_foreign');
  if (field === 'filter')
    saved = saved.replace(
      '</enho:badiImplementation>',
      '<enho:filterTree><enho:filterToken enho:filterName="FOREIGN"/></enho:filterTree></enho:badiImplementation>',
    );
  if (field === 'unknown-usage') {
    body = body.replace(
      'enhcore:element_usage="EXTO"',
      'enhcore:element_usage="EXTO" xmlns:x="urn:test" x:preserve="yes"',
    );
  }
  if (field === 'usage-role') saved = saved.replace('enhcore:element_usage="USEO"', 'enhcore:element_usage="EXTO"');
  if (field === 'usage-duplicate')
    saved = saved.replace(
      '</enho:usages>',
      saved.match(/<enhcore:referencedObject[^>]*element_usage="USEO"[\s\S]*?<\/enhcore:referencedObject>/)![0] +
        '</enho:usages>',
    );
  let refused = false;
  try {
    refused = !enhoSavedMatches(body, saved, selected);
  } catch {
    refused = true;
  }
  expect(refused).toBe(true);
});

it.each(['opaque', 'customizing', 'foreign-uri'])(
  'real save retains incomplete outcome and own cleanup for %s readback drift',
  async (fault) => {
    expect((await write()).isError).toBeUndefined();
    if (fault === 'customizing')
      world.objects.get(selected.objectUrl)!.metadata = world.objects
        .get(selected.objectUrl)!
        .metadata.replace('enho:customizingLock=""', 'enho:customizingLock="X"');
    world.calls.length = 0;
    afterSave = (body) =>
      fault === 'opaque'
        ? body.replace(opaque, '')
        : fault === 'customizing'
          ? body.replace('enho:customizingLock="X"', 'enho:customizingLock=""')
          : body.replace('/sap/bc/adt/oo/classes/zcl_owned', '/sap/bc/adt/oo/classes/foreign');
    const result = await write('update', { description: 'Changed again' });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      state: 'document-save-unconfirmed',
      phase: 'document-readback',
      sessionClosed: true,
      retryable: false,
    });
    expect(world.calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
    expect(world.calls.some((c) => c.method === 'DELETE' || c.path.startsWith('/sap/bc/adt/activation'))).toBe(false);
    expect(world.locked).toBeUndefined();
  },
);
it('calculated display drift still invalidates the full optimistic hash before PUT', async () => {
  expect((await write()).isError).toBeUndefined();
  const obj = world.objects.get(selected.objectUrl)!,
    hash = parsePinnedDocument(obj.metadata, selected).hash;
  obj.metadata = obj.metadata.replace('Synthetic read-only state', 'Changed read-only state');
  world.calls.length = 0;
  const result = await write('update', { description: 'Different', expectedMetadataHash: hash });
  expect(result.isError).toBe(true);
  expect(JSON.parse(result.content[0].text).state).toBe('unchanged');
  expect(world.calls.some((c) => c.method === 'PUT')).toBe(false);
});
it('a fully empty list can be omitted but opaque list state cannot disappear', () => {
  const withList = empty(true),
    withoutList = empty(false);
  expect(enhoSavedMatches(withList, withoutList, selected)).toBe(true);
  expect(() =>
    enhoSavedMatches(
      withList.replace('<enho:badiImplementations/>', '<enho:badiImplementations> \n </enho:badiImplementations>'),
      withoutList,
      selected,
    ),
  ).toThrow();
  expect(
    enhoSavedMatches(
      withList.replace('<enho:badiImplementations/>', `<enho:badiImplementations>${opaque}</enho:badiImplementations>`),
      withoutList,
      selected,
    ),
  ).toBe(false);
});
