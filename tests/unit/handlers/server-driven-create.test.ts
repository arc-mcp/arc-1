import { beforeEach, expect, it, vi } from 'vitest';
import { AdtNetworkError } from '../../../src/adt/errors.js';
import { CachingLayer } from '../../../src/cache/caching-layer.js';
import { MemoryCache } from '../../../src/cache/memory.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const source = '{"formatVersion":"1","generalInformation":{"className":"ZCL_JOB","catalogName":"ZARC1_CAT"}}';
const posts = () => mockFetch.mock.calls.filter(([, init]) => init?.method === 'POST');

beforeEach(() => {
  vi.resetAllMocks();
  mockFetch.mockResolvedValue(mockResponse(200, '<a><LOCK_HANDLE>L1</LOCK_HANDLE></a>', { 'x-csrf-token': 'T' }));
});

// I1: a create targets the caller's package, so the allowlist must refuse it before the POST.
it.each(['APLO', 'SAJC', 'SAJT'])('refuses a %s create outside the package allowlist before any POST', async (type) => {
  const client = createClient();
  const result = await handleToolCall(
    client.withSafety({ ...client.safety, allowedPackages: ['$TMP'] }),
    DEFAULT_CONFIG,
    'SAPWrite',
    { action: 'create', type, name: 'ZARC1_APP', package: 'ZOTHER', source },
  );
  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).toContain("'ZOTHER'");
  expect(posts()).toHaveLength(0);
});

// The POST already created the object (APLO: active); a bare PUT error invites the same create again.
it.each(['APLO', 'SAJT'])('names the created %s when the follow-up source write fails', async (type) => {
  mockFetch.mockImplementation(async (_url: string | URL, init?: { method?: string }) =>
    mockResponse(init?.method === 'PUT' ? 400 : 200, '<a><LOCK_HANDLE>L1</LOCK_HANDLE></a>', { 'x-csrf-token': 'T' }),
  );
  const result = await handleToolCall(createClient(), { ...DEFAULT_CONFIG, minimalErrors: true }, 'SAPWrite', {
    action: 'create',
    type,
    name: 'ZARC1_APP',
    package: '$TMP',
    source,
  });
  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).toContain(
    `${type} ZARC1_APP was created in package $TMP${type === 'APLO' ? ' and is active' : ''},`,
  );
  expect(result.content[0]?.text).toContain('do not repeat create');
});

// Name validation is local: an overlong APLO name must not become an ambiguous server-side create error.
it('refuses an APLO name longer than 20 characters before any POST', async () => {
  const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
    action: 'create',
    type: 'APLO',
    name: 'Z'.repeat(21),
    package: '$TMP',
  });
  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).toContain('at most 20');
  expect(posts()).toHaveLength(0);
});

it('keeps the created-object guidance on a network failure even when cache invalidation fails', async () => {
  const client = createClient();
  vi.spyOn(client.http, 'withStatefulSession').mockRejectedValue(new AdtNetworkError('Connection interrupted'));
  const cache = new CachingLayer(new MemoryCache());
  const invalidate = vi.spyOn(cache, 'invalidate').mockImplementation(() => {
    throw new Error('SQLITE_BUSY');
  });
  const result = await handleToolCall(
    client,
    { ...DEFAULT_CONFIG, minimalErrors: true },
    'SAPWrite',
    {
      action: 'create',
      type: 'APLO',
      name: 'ZARC1_APP',
      package: '$TMP',
      source,
    },
    undefined,
    undefined,
    cache,
  );
  expect(result.isError).toBe(true);
  expect(posts()).toHaveLength(1);
  expect(invalidate).toHaveBeenCalled();
  expect(result.content[0]?.text).toContain('APLO ZARC1_APP was created');
  expect(result.content[0]?.text).toContain('do not repeat create');
  expect(result.content[0]?.text).not.toContain('SQLITE_BUSY');
});

// SAP object (node) types take their creation wizard input as additionalCreationProperties (Eclipse ADT trace).
const creationProperties = (body: string) =>
  JSON.parse(
    (/<adtcore:content [^>]*>([^<]*)<\/adtcore:content>/.exec(body)?.[1] ?? '').replaceAll('&quot;', '"'),
  ) as Record<string, unknown>;
const createPost = () =>
  posts().find(([url]) => /\/businessobjects\/(rontrot|nontnot)$/.test(new URL(String(url)).pathname));

it('creates a RONT with the wizard category from the AFF source, then writes the source', async () => {
  const ront =
    '{"formatVersion":"1","header":{"description":"Test","originalLanguage":"en"},"typeCategory":"technicalObject","name":"ZX_SOT","objectTypeCode":"90100"}';
  const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
    action: 'create',
    type: 'RONT',
    name: 'ZX_SOT',
    package: '$TMP',
    description: 'Test',
    source: ront,
  });
  expect(result.isError, result.content[0]?.text).toBeUndefined();
  const [, init] = createPost() ?? [];
  expect(String(init?.body)).toContain('adtcore:type="RONT/ROT"');
  expect(init?.headers?.['Content-Type']).toBe('application/vnd.sap.adt.blues.v2+xml');
  expect(creationProperties(String(init?.body))).toEqual({
    name: 'ZX_SOT',
    typeCategory: 'to',
    metadata: { name: 'ZX_SOT', description: 'Test', package: '$TMP' },
  });
  const put = mockFetch.mock.calls.find(([, i]) => i?.method === 'PUT');
  expect(String(put?.[0])).toContain('/sap/bc/adt/businessobjects/rontrot/ZX_SOT/source/main?lockHandle=L1');
  expect(String(put?.[1]?.body)).toBe(ront);
});

it('creates a RONT without source as a business object named like the object', async () => {
  const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
    action: 'create',
    type: 'RONT',
    name: 'ZX_SOT',
    package: '$TMP',
  });
  expect(result.isError, result.content[0]?.text).toBeUndefined();
  expect(creationProperties(String(createPost()?.[1]?.body))).toMatchObject({ name: 'ZX_SOT', typeCategory: 'bo' });
});

it.each(['businessobject', 'constructor', 42])('refuses RONT typeCategory %s before any POST', async (typeCategory) => {
  const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
    action: 'create',
    type: 'RONT',
    name: 'ZX_SOT',
    package: '$TMP',
    source: JSON.stringify({ formatVersion: '1', typeCategory, name: 'ZX_SOT' }),
  });
  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).toContain('businessObject, technicalObject');
  expect(posts()).toHaveLength(0);
});

it('creates a NONT with its SAP object type and root node flag', async () => {
  const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
    action: 'create',
    type: 'NONT',
    name: 'ZX_SOT',
    package: '$TMP',
    description: 'Node',
    source:
      '{"formatVersion":"1","header":{"description":"Node","originalLanguage":"en"},"name":"ZX_SOT","sapObjectType":"ZX_SOT","rootNode":true}',
  });
  expect(result.isError, result.content[0]?.text).toBeUndefined();
  const [url, init] = createPost() ?? [];
  expect(new URL(String(url)).pathname).toBe('/sap/bc/adt/businessobjects/nontnot');
  expect(String(init?.body)).toContain('adtcore:type="NONT/NOT"');
  expect(creationProperties(String(init?.body))).toEqual({
    name: 'ZX_SOT',
    sapObjectType: 'ZX_SOT',
    rootNode: true,
    metadata: { name: 'ZX_SOT', description: 'Node', package: '$TMP' },
  });
});

it.each([undefined, '{"formatVersion":"1","name":"ZX_NODE"}', '{"sapObjectType":" "}'])(
  'refuses a NONT without source.sapObjectType before any POST (%s)',
  async (source) => {
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'create',
      type: 'NONT',
      name: 'ZX_NODE',
      package: '$TMP',
      ...(source ? { source } : {}),
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('requires source.sapObjectType');
    expect(posts()).toHaveLength(0);
  },
);
