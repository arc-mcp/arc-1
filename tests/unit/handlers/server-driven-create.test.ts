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
