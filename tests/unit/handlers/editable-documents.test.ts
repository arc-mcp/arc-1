import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CachingLayer } from '../../../src/cache/caching-layer.js';
import { MemoryCache } from '../../../src/cache/memory.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { config, context, createWorld, fixture, install, nativeClient, type World } from './pinned-ddic-harness.js';
import { mockFetch } from './setup-undici-mock.js';

// HTTP-bearing adapters load after the shared undici mock, never through schema imports.
const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { parsePinnedDocument, pinnedDocumentSelection, readPinnedDocument } = await import(
  '../../../src/adt/pinned-document-owner.js'
);
const { handlePrivatePinnedDocumentWrite } = await import('../../../src/handlers/write/pinned-document-write.js');
const { requestContext } = await import('../../../src/server/context.js');
const readonly = {
  ...config,
  allowWrites: false,
  allowedPackages: ['$DENIED'],
  multiTargetWrite: { ...config.multiTargetWrite, enabled: false, allowedPackages: ['$DENIED'] },
};
const name = 'ZTEST';
const opaque = '<x:opaque xmlns:x="urn:unknown" x:value="001">  retained  </x:opaque>';
const node = `<sktd:element sktd:canHaveDocumentation="true" sktd:longTextObligation="optional"><sktd:id>ZTEST</sktd:id><sktd:text>${Buffer.from('root text').toString('base64')}</sktd:text><sktd:shortText sktd:text="Um9vdA==" sktd:obligation="optional"/></sktd:element>`;
let world: World;
function seed(type: 'ENHO' | 'SKTD') {
  const selected = pinnedDocumentSelection(type, name);
  const metadata =
    type === 'SKTD'
      ? `<sktd:docu xmlns:sktd="http://www.sap.com/wbobj/texts/sktd" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="ZTEST" adtcore:type="SKTD/TYP" adtcore:version="inactive" adtcore:masterLanguage="EN"><adtcore:packageRef adtcore:name="ZTEAM" adtcore:type="DEVC/K"/><sktd:refObject adtcore:name="ZTEST" adtcore:type="DDLS/DF" adtcore:uri="/sap/bc/adt/ddic/ddl/sources/ztest"/>${node}${opaque}</sktd:docu>`
      : fixture('xml/enhancement-implementation.xml')
          .replaceAll('SFW_BCF_TCD', name)
          .replaceAll('SFWTOOLS', 'ZTEAM')
          .replace('adtcore:version="active"', 'adtcore:version="inactive"')
          .replace('</enho:objectData>', `${opaque}</enho:objectData>`);
  const object = { metadata, nativeType: selected.native };
  world.objects.set(selected.objectUrl, object);
  return { selected, object };
}
async function read(type = 'SKTD', extra = {}, scopes = ['read']) {
  return handleToolCall(
    nativeClient(undefined, readonly),
    readonly,
    'SAPRead',
    { type, name, format: 'editable', ...extra },
    { token: 'reader-token', clientId: 'reader', scopes },
  );
}
const json = (result: Awaited<ReturnType<typeof read>>) => {
  expect(result.isError, result.content[0]?.text).toBeUndefined();
  return JSON.parse(result.content[0]!.text);
};
beforeEach(() => {
  vi.restoreAllMocks();
  world = createWorld();
  install(world);
});
afterEach(() => expect(world.unexpected).toEqual([]));

it.each(['ENHO', 'SKTD'] as const)(
  '%s reads complete metadata outside both write-package ceilings with only read scope',
  async (type) => {
    const { selected, object } = seed(type);
    const result = json(await read(type));
    expect(result).toMatchObject({
      type,
      name,
      nativeType: selected.native,
      objectUrl: selected.objectUrl,
      package: 'ZTEAM',
      metadataView: 'developer',
      nativeVersion: 'inactive',
      inactiveAlternative: false,
      metadataXml: object.metadata,
      metadataHash: parsePinnedDocument(object.metadata, selected).hash,
    });
    expect(result.sourceHash).toBeUndefined();
    expect(world.calls).toHaveLength(1);
    expect(world.calls[0]!.path.split('?')[0]).toBe(selected.objectUrl);
    expect(world.calls[0]).toMatchObject({ method: 'GET', accept: selected.contentType });
    await expect(readPinnedDocument(nativeClient(undefined, readonly), selected)).rejects.toThrow();
    expect(world.calls.every((call) => call.method === 'GET')).toBe(true);
  },
);
it.each(['KTD', 'SKTD/TYP', 'sktd', 'ktd'])('preserves the existing %s type alias', async (type) => {
  seed('SKTD');
  expect(json(await read(type)).type).toBe('SKTD');
  expect(world.calls).toHaveLength(1);
});
it.each(['ENHO', 'SKTD'] as const)(
  '%s retains XML prefix aliases, opaque namespaces and exact unknown text',
  async (type) => {
    const { object } = seed(type);
    const before = json(await read(type));
    const prefix = type === 'ENHO' ? 'enho' : 'sktd';
    object.metadata = object.metadata
      .replaceAll(`${prefix}:`, 'renamed:')
      .replaceAll(`xmlns:${prefix}=`, 'xmlns:renamed=');
    const after = json(await read(type));
    expect(after.metadataXml).toBe(object.metadata);
    expect(after.metadataXml).toContain(opaque);
    expect(after.metadataHash).toBe(before.metadataHash);
  },
);
it.each(['active', 'inactive', 'new'])(
  'reports the native %s state without claiming an inactive draft',
  async (version) => {
    const { object } = seed('SKTD');
    object.metadata = object.metadata.replace('version="inactive"', `version="${version}"`);
    expect(json(await read()).nativeVersion).toBe(version);
    expect(world.calls[0]!.path).not.toContain('version=');
  },
);
it('reports a verified inactive alternative without requesting it or losing pending nodes', async () => {
  const { selected, object } = seed('SKTD');
  object.metadata = object.metadata.replace(
    '</sktd:docu>',
    `<atom:link xmlns:atom="http://www.w3.org/2005/Atom" rel="http://www.sap.com/adt/relations/objectstates" href="${selected.objectUrl}?version=inactive"/>${node.replaceAll('ZTEST', 'ZTEST.FIELD')}</sktd:docu>`,
  );
  const result = json(await read());
  expect(result.inactiveAlternative).toBe(true);
  expect(result.metadataXml).toContain('ZTEST.FIELD');
  expect(result.metadataXml).toContain('Um9vdA==');
  expect(world.calls).toHaveLength(1);
});
it('fresh reads bypass cache and retain changes to native version and unknown state in the writer hash', async () => {
  const { object } = seed('SKTD');
  const client = nativeClient(undefined, readonly),
    cache = new CachingLayer(new MemoryCache());
  const get = () =>
    handleToolCall(
      client,
      readonly,
      'SAPRead',
      { type: 'SKTD', name, format: 'editable' },
      undefined,
      undefined,
      cache,
    );
  const first = json(await get());
  object.metadata = object.metadata.replace('x:value="001"', 'x:value="002"');
  const second = json(await get());
  object.metadata = object.metadata.replace('version="inactive"', 'version="active"');
  const third = json(await get());
  expect(new Set([first.metadataHash, second.metadataHash, third.metadataHash]).size).toBe(3);
  expect(world.calls).toHaveLength(3);
});
it.each(['ENHO', 'SKTD'] as const)(
  '%s public read hash guards the actual private writer, including unknown-field drift',
  async (type) => {
    const { object } = seed(type);
    const observed = json(await read(type));
    const input = {
      action: 'update',
      type,
      name,
      expectedMetadataHash: observed.metadataHash,
      ...(type === 'ENHO' ? { description: 'Updated' } : { source: 'Updated' }),
    };
    object.metadata = object.metadata.replace('x:value="001"', 'x:value="002"');
    const client = nativeClient();
    expect((await handlePrivatePinnedDocumentWrite(client, input, config, context(client))).isError).toBe(true);
    expect(world.calls.every((call) => call.method === 'GET')).toBe(true);
    object.metadata = observed.metadataXml;
    if (type === 'ENHO') {
      const spot = fixture('xml/enhancement-spot.xml')
        .replaceAll('ES_MY_SPOT', 'BCF_REMOTE_TCD')
        .replaceAll('BADI_MY_PLAIN', 'BCF_TCD_REMOTE_BADI')
        .replace('<enhs:contentSpecific>', '<enhs:contentCommon enhs:internal="false"/><enhs:contentSpecific>');
      world.objects.set('/sap/bc/adt/enhancements/enhsxsb/bcf_remote_tcd', { metadata: spot, nativeType: 'ENHS/XSB' });
    }
    const result = await handlePrivatePinnedDocumentWrite(client, input, config, context(client));
    expect(result.isError, result.content[0]?.text).toBeUndefined();
    expect(JSON.parse(result.content[0]!.text).state).toBe('saved-inactive');
    expect(world.calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
    expect((await read(type)).isError).toBeUndefined();
  },
);
it.each([
  ['name="ZTEST"', 'name="ZOTHER"'],
  ['version="inactive"', 'version="unknown"'],
  ['type="SKTD/TYP"', 'type="ENHO/XHB"'],
  ['http://www.sap.com/wbobj/texts/sktd', 'urn:foreign'],
  ['type="DDLS/DF"', 'type="FUNC/FF"'],
  ['ddl/sources/ztest', 'ddl/sources/zother'],
  ['name="ZTEAM"', 'name=" "'],
])('refuses unknown or contradictory native KTD metadata %s', async (from, to) => {
  const { object } = seed('SKTD');
  object.metadata = object.metadata.replace(from, to);
  expect((await read()).isError).toBe(true);
  expect(world.calls).toHaveLength(1);
});
it('refuses unsupported ENHO technology', async () => {
  const { object } = seed('ENHO');
  object.metadata = object.metadata.replace('BADI_IMPL', 'HOOK_IMPL');
  expect((await read('ENHO')).isError).toBe(true);
});
it('treats a foreign nested sktd prefix as opaque data and preserves it in the hash', async () => {
  const { object } = seed('SKTD');
  const nested =
    '<f:extension xmlns:f="urn:extension" xmlns:sktd="urn:foreign"><sktd:text>001</sktd:text></f:extension>';
  object.metadata = object.metadata.replace('</sktd:docu>', `${nested}</sktd:docu>`);
  const first = json(await read());
  expect(first.metadataXml).toContain(nested);
  object.metadata = object.metadata.replace('>001</sktd:text>', '>002</sktd:text>');
  expect(json(await read()).metadataHash).not.toBe(first.metadataHash);
});
it.each([403, 404, 500])('refuses native status %s without returning an empty metadata hash', async (status) => {
  seed('SKTD');
  mockFetch.mockResolvedValue(mockResponse(status, 'native failure'));
  const result = await read();
  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).not.toContain('metadataHash');
});
it('caps complete XML responses before exposing a hash', async () => {
  const { object } = seed('SKTD');
  object.metadata = object.metadata.replace('  retained  ', 'x'.repeat(1024 * 1024));
  const result = await read();
  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).not.toContain('metadataHash');
  expect(mockFetch).toHaveBeenCalledTimes(1);
});
it('honors cancellation before native access', async () => {
  seed('SKTD');
  const abort = new AbortController();
  abort.abort();
  expect((await requestContext.run({ signal: abort.signal } as any, () => read())).isError).toBe(true);
  expect(mockFetch).not.toHaveBeenCalled();
});
it.each([{ version: 'inactive' }, { include: 'main' }, { method: 'x' }, { grep: 'x' }, { source: 'x' }])(
  'refuses unsupported editable selectors before native access: %j',
  async (args) => {
    seed('SKTD');
    expect((await read('SKTD', args)).isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  },
);
it('requires read scope and retains public metadata-write refusal', async () => {
  seed('SKTD');
  expect((await read('SKTD', {}, [])).isError).toBe(true);
  expect(mockFetch).not.toHaveBeenCalled();
  const result = json(await read());
  world.calls.length = 0;
  expect(
    (
      await handleToolCall(nativeClient(), config, 'SAPWrite', {
        action: 'update',
        type: 'SKTD',
        name,
        source: 'x',
        expectedMetadataHash: result.metadataHash,
      })
    ).isError,
  ).toBe(true);
  expect(world.calls).toEqual([]);
});
it.each(['ENHO', 'SKTD'] as const)('%s preserves ordinary read output when format is omitted', async (type) => {
  seed(type);
  const result = await handleToolCall(nativeClient(undefined, readonly), readonly, 'SAPRead', { type, name });
  expect(result.isError, result.content[0]?.text).toBeUndefined();
  expect(result.content[0]?.text).not.toContain('metadataHash');
  expect(world.calls.every((call) => call.method === 'GET')).toBe(true);
});

it('applies ordinary read denials before native document access', async () => {
  seed('SKTD');
  const denied = { ...readonly, denyActions: ['SAPRead.SKTD'] };
  const result = await handleToolCall(
    nativeClient(undefined, denied),
    denied,
    'SAPRead',
    { type: 'SKTD', name, format: 'editable' },
    { token: 'reader-token', clientId: 'reader', scopes: ['read'] },
  );
  expect(result.isError).toBe(true);
  expect(mockFetch).not.toHaveBeenCalled();
});
it('counts oversized native error bodies in the same read response allowance', async () => {
  seed('SKTD');
  mockFetch.mockResolvedValue(mockResponse(500, 'x'.repeat(1024 * 1024 + 1)));
  const result = await read();
  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).not.toContain('metadataHash');
  expect(mockFetch).toHaveBeenCalledTimes(1);
});
