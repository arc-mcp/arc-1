import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { pinnedDdicSelection, readPinnedDdicEvidence } from '../../../src/adt/pinned-ddic-owner.js';
import { pinnedBindingSelection, readPinnedBinding } from '../../../src/adt/pinned-service-binding-owner.js';
import { CachingLayer } from '../../../src/cache/caching-layer.js';
import { MemoryCache } from '../../../src/cache/memory.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { bindingUri, bindingXml } from '../adt/pinned-managed-harness.js';
import {
  blueSource,
  config,
  context,
  createWorld,
  fixture,
  install,
  nativeClient,
  puts,
  type World,
} from './pinned-ddic-harness.js';
import { mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { createPinnedDdicContext } = await import('../../../src/handlers/write/pinned-ddic-context.js');
const { executePinnedSourceWrite } = await import('../../../src/handlers/write/pinned-source-write.js');
const { resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const path = '/sap/bc/adt/ddic/domains/BUKRS';
const readonly = {
  ...config,
  allowWrites: false,
  allowedPackages: ['$DENIED'],
  multiTargetWrite: {
    ...config.multiTargetWrite,
    enabled: false,
    allowedPackages: ['$DENIED'],
  },
};
let world: World;
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
function seedDomain() {
  const value = {
    metadata: fixture('xml/domain-metadata.xml').replace(/(packageRef[^>]*adtcore:name=")[^"]*/, '$1ZTEAM'),
    nativeType: 'DOMA/DD',
  };
  world.objects.set(path, value);
  return value;
}
const input = { type: 'DOMA', name: 'BUKRS', format: 'editable' };
async function read(args: Record<string, unknown> = input) {
  return handleToolCall(nativeClient(undefined, readonly), readonly, 'SAPRead', args, {
    token: 'test',
    clientId: 'reader',
    scopes: ['read'],
  });
}
const json = (result: Awaited<ReturnType<typeof read>>) => {
  expect(result.isError, result.content[0]?.text).toBeUndefined();
  return JSON.parse(result.content[0]!.text);
};

it('reads fresh metadata outside both write allowlists and reports active fallback as active', async () => {
  const object = seedDomain();
  const result = json(await read());
  expect(result).toMatchObject({
    type: 'DOMA',
    name: 'BUKRS',
    package: 'ZTEAM',
    metadataView: 'inactive',
    nativeVersion: 'active',
    metadataXml: object.metadata,
  });
  expect(result.metadataHash).toMatch(/^[a-f0-9]{64}$/);
  expect(result.sourceHash).toBeUndefined();
  expect(world.calls).toHaveLength(1);
  expect(world.calls[0]).toMatchObject({ method: 'GET' });
  expect(world.calls[0]!.path).toContain('version=inactive');
  await expect(
    readPinnedDdicEvidence(nativeClient(undefined, readonly), pinnedDdicSelection('DOMA', 'BUKRS'), 'inactive'),
  ).rejects.toThrow();
});

it.each(['inactive', 'new'])('reports the native %s metadata state verbatim', async (version) => {
  const object = seedDomain();
  object.metadata = object.metadata.replace('adtcore:version="active"', `adtcore:version="${version}"`);
  expect(json(await read()).nativeVersion).toBe(version);
});

it('ignores cached metadata and obtains a changed hash from a second native read', async () => {
  const object = seedDomain();
  const client = nativeClient(undefined, readonly),
    cache = new CachingLayer(new MemoryCache());
  const first = json(await handleToolCall(client, readonly, 'SAPRead', input, undefined, undefined, cache));
  object.metadata = object.metadata.replace('adtcore:description="', 'adtcore:description="Changed ');
  const second = json(await handleToolCall(client, readonly, 'SAPRead', input, undefined, undefined, cache));
  expect(second.metadataHash).not.toBe(first.metadataHash);
  expect(world.calls).toHaveLength(2);
  expect(world.calls.every((call) => call.method === 'GET')).toBe(true);
});

it.each([
  ['identity', (xml: string) => xml.replace('adtcore:name="BUKRS"', 'adtcore:name="OTHER"')],
  ['type', (xml: string) => xml.replace('DOMA/DD', 'DTEL/DE')],
  ['version', (xml: string) => xml.replace('adtcore:version="active"', '')],
  ['namespace', (xml: string) => xml.replace('http://www.sap.com/adt/core', 'urn:foreign')],
  ['malformed XML', () => '<html>not native metadata</html>'],
  ['oversized metadata', () => `<x>${'y'.repeat(1024 * 1024 + 1)}</x>`],
] as const)('refuses %s before returning any usable hash', async (_label, transform) => {
  const object = seedDomain();
  object.metadata = transform(object.metadata);
  const result = await read();
  expect(result.isError).toBe(true);
  expect(result.content[0]!.text).not.toContain('"metadataHash"');
  expect(world.calls.every((call) => call.method === 'GET')).toBe(true);
});

it('propagates native absence instead of manufacturing an empty metadata snapshot', async () => {
  const result = await read();
  expect(result.isError).toBe(true);
  expect(world.calls).toHaveLength(1);
  expect(result.content[0]!.text).not.toContain('"metadataHash"');
});

it('uses a read-derived hash to reject stale or cross-object metadata under the private writer lock', async () => {
  const object = seedDomain();
  const snapshot = json(await read());
  object.metadata = object.metadata.replace('adtcore:description="', 'adtcore:description="Changed ');
  const client = nativeClient();
  const ctx = await createPinnedDdicContext(
    client,
    {
      action: 'update',
      type: 'DOMA',
      name: 'BUKRS',
      description: 'replacement',
      expectedMetadataHash: snapshot.metadataHash,
    },
    config,
    context(client),
  );
  const result = await executePinnedSourceWrite(ctx);
  expect(result.isError).toBe(true);
  expect(puts(world)).toHaveLength(0);
  // A different native identity must not share the metadata precondition, even with the same content fields.
  world.objects.set('/sap/bc/adt/ddic/domains/OTHER', {
    ...object,
    metadata: snapshot.metadataXml.replace('adtcore:name="BUKRS"', 'adtcore:name="OTHER"'),
  });
  const other = json(await read({ ...input, name: 'OTHER' }));
  expect(other.metadataHash).not.toBe(snapshot.metadataHash);
  const wrongIdentity = await createPinnedDdicContext(
    client,
    {
      action: 'update',
      type: 'DOMA',
      name: 'OTHER',
      description: 'replacement',
      expectedMetadataHash: snapshot.metadataHash,
    },
    config,
    context(client),
  );
  expect((await executePinnedSourceWrite(wrongIdentity)).isError).toBe(true);
  expect(puts(world)).toHaveLength(0);
});

it.each(['single', 'pinned', 'basic', 'aggregate'] as const)(
  'keeps editable snapshots mutation-free in %s read configurations',
  async (mode) => {
    seedDomain();
    const settings =
      mode === 'single'
        ? { ...DEFAULT_CONFIG, allowWrites: false, allowedPackages: ['$DENIED'] }
        : {
            ...readonly,
            ...(mode === 'basic' ? { ppEnabled: false, ppStrict: false } : {}),
            ...(mode === 'aggregate' ? { targetId: undefined } : {}),
          };
    const client = nativeClient().withSafety({ ...nativeClient().safety, ...settings });
    expect(json(await handleToolCall(client, settings, 'SAPRead', input)).metadataHash).toMatch(/^[a-f0-9]{64}$/);
    expect(world.calls.every((call) => call.method === 'GET')).toBe(true);
  },
);

it('keeps read scope and action denials ahead of native evidence', async () => {
  seedDomain();
  const denied = await handleToolCall(nativeClient(), config, 'SAPRead', input, {
    token: 'test',
    clientId: 'none',
    scopes: [],
  });
  expect(denied.isError).toBe(true);
  expect(world.calls).toHaveLength(0);
  const actionDenied = await handleToolCall(
    nativeClient(),
    { ...config, denyActions: ['SAPRead.DOMA'] },
    'SAPRead',
    input,
  );
  expect(actionDenied.isError).toBe(true);
  expect(world.calls).toHaveLength(0);
});

it.each([
  { version: 'inactive' },
  { action: 'diff' },
  { include: 'main' },
  { group: 'ZG' },
  { grep: 'x' },
  { lineStart: 1, lineEnd: 2 },
])('refuses incompatible native read arguments %j', async (extra) => {
  seedDomain();
  expect((await read({ ...input, ...extra })).isError).toBe(true);
  expect(world.calls).toHaveLength(0);
});

it.each(['SAPWrite', 'SAPActivate'])('does not silently strip a public %s metadata precondition', async (tool) => {
  const client = nativeClient().withSafety({ ...nativeClient().safety, multiTargetWrite: undefined });
  const result = await handleToolCall(client, { ...DEFAULT_CONFIG, allowWrites: true }, tool, {
    type: 'DOMA',
    name: 'BUKRS',
    ...(tool === 'SAPWrite' ? { action: 'update', description: 'changed' } : {}),
    expectedMetadataHash: '0'.repeat(64),
  });
  expect(result.isError).toBe(true);
  expect(result.content[0]!.text).toContain('expectedMetadataHash');
  expect(world.calls).toHaveLength(0);
});

it('returns the SRVB full native hash without a write package grant, while its write wrapper still refuses', async () => {
  const body = bindingXml().replace('$TMP', 'ZOUTSIDE');
  world.objects.set(bindingUri, { metadata: body, nativeType: 'SRVB/SVB' });
  const result = json(await read({ type: 'SRVB', name: 'ZBIND', format: 'editable' }));
  expect(result).toMatchObject({
    metadataXml: body,
    nativeVersion: 'inactive',
    metadataView: 'developer',
    package: 'ZOUTSIDE',
  });
  expect(result.metadataHash).toMatch(/^[a-f0-9]{64}$/);
  await expect(readPinnedBinding(nativeClient(undefined, readonly), pinnedBindingSelection('ZBIND'))).rejects.toThrow();
  expect(world.calls.every((call) => call.method === 'GET')).toBe(true);
});

it.each(['version', 'alternative', 'identity', 'package'])(
  'refuses source snapshots when native %s changes between evidence reads',
  async (field) => {
    const owner = '/sap/bc/adt/ddic/drty/ZTEST';
    const initial = blueSource('ZTEST', 'DRTY/DRT', 'ZTEAM');
    // Use the actual registry identity/path rather than treating the source URL as identity evidence.
    const { SDO_REGISTRY } = await import('../../../src/adt/server-driven.js');
    const entry = SDO_REGISTRY.DRTY,
      path = `${entry.href}/ZTEST`;
    const object = {
      metadata: initial.replace('DRTY/DRT', entry.createType),
      nativeType: entry.createType,
      source: 'define type ztest : abap.char(1);',
    };
    world.objects.set(path, object);
    const original = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation(async (...args: Parameters<typeof original>) => {
      const response = await original(...args);
      if (String(args[0]).includes('/source/main')) {
        object.metadata =
          field === 'version'
            ? object.metadata.replace('version="inactive"', 'version="active"')
            : field === 'identity'
              ? object.metadata.replace('name="ZTEST"', 'name="ZOTHER"')
              : field === 'package'
                ? object.metadata.replace('ZTEAM', 'ZOTHER')
                : object.metadata.replace(
                    '</blue:blueSource>',
                    `<atom:link xmlns:atom="http://www.w3.org/2005/Atom" rel="http://www.sap.com/adt/relations/objectstates" href="${owner}?version=active"/></blue:blueSource>`,
                  );
      }
      return response;
    });
    expect((await read({ type: 'DRTY', name: 'ZTEST', format: 'editable' })).isError).toBe(true);
    expect(world.calls.every((call) => call.method === 'GET')).toBe(true);
  },
);

it('bounds cumulative reads and cancellation without mutation requests', async () => {
  seedDomain();
  const abort = new AbortController();
  abort.abort();
  const result = await handleToolCall(
    nativeClient(undefined, readonly),
    readonly,
    'SAPRead',
    input,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    abort.signal,
  );
  expect(result.isError).toBe(true);
  expect(world.calls).toHaveLength(0);
  mockFetch.mockResolvedValue(mockResponse(200, 'x'.repeat(9 * 1024 * 1024)));
  expect((await read()).isError).toBe(true);
});

it.each(['malformed', 'oversized', 'stale'] as const)(
  'refuses %s server-driven source snapshots or preconditions',
  async (fault) => {
    const { SDO_REGISTRY } = await import('../../../src/adt/server-driven.js');
    const entry = SDO_REGISTRY.DESD;
    const object = {
      metadata: blueSource('ZTEST', entry.createType, 'ZTEAM'),
      nativeType: entry.createType,
      source:
        fault === 'malformed'
          ? '<html>login</html>'
          : fault === 'oversized'
            ? ' '.repeat(4 * 1024 * 1024 + 1)
            : '{"formatVersion":"1"}',
    };
    world.objects.set(`${entry.href}/ZTEST`, object);
    const result = await read({ type: 'DESD', name: 'ZTEST', format: 'editable' });
    if (fault !== 'stale') {
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).not.toContain('"sourceHash"');
    } else {
      const snapshot = json(result);
      object.source = '{"formatVersion":"1","changed":true}';
      const client = nativeClient(new Map([[entry.href, [entry.metadataContentType]]]));
      const ctx = await createPinnedDdicContext(
        client,
        {
          action: 'update',
          type: 'DESD',
          name: 'ZTEST',
          source: '{"formatVersion":"1","replacement":true}',
          expectedSourceHash: snapshot.sourceHash,
        },
        config,
        context(client),
      );
      expect((await executePinnedSourceWrite(ctx)).isError).toBe(true);
      expect(puts(world)).toHaveLength(0);
    }
  },
);
