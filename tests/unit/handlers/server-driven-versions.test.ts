import { beforeEach, expect, it, vi } from 'vitest';
import { SDO_REGISTRY, serverDrivenObjectUrl } from '../../../src/adt/server-driven.js';
import { CachingLayer } from '../../../src/cache/caching-layer.js';
import { MemoryCache } from '../../../src/cache/memory.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const name = 'ZVERSION';
const types = ['DRTY', 'DESD', 'DTDC', 'UIAD'] as const;
type Type = (typeof types)[number];
function backend(type: Type, options: { returnedVersion?: string; status?: number; failSource?: boolean } = {}) {
  const sends: URL[] = [];
  const entry = SDO_REGISTRY[type];
  mockFetch.mockImplementation(async (url) => {
    const path = new URL(String(url));
    if (path.pathname.endsWith('/discovery')) {
      return mockResponse(
        200,
        `<app:service xmlns:app="http://www.w3.org/2007/app"><app:workspace><app:collection href="${entry.href}"><app:accept>${entry.metadataContentType}</app:accept></app:collection></app:workspace></app:service>`,
      );
    }
    sends.push(path);
    const version = options.returnedVersion ?? path.searchParams.get('version') ?? 'inactive';
    const isSource = path.pathname.endsWith('/source/main');
    if (options.status && (!options.failSource || isSource)) return mockResponse(options.status, 'Unavailable');
    const source = version === 'active' ? 'activated' : 'draft';
    return mockResponse(
      200,
      isSource
        ? entry.sourceFormat === 'text'
          ? source
          : JSON.stringify({ source })
        : `<${entry.metadataRootQName} xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="${name}" adtcore:type="${entry.createType}"${version ? ` adtcore:version="${version}"` : ''}/>`,
    );
  });
  return sends;
}
beforeEach(() => vi.resetAllMocks());

it.each(types)('honors explicit versions for %s metadata and source, without source-cache reuse', async (type) => {
  const sends = backend(type);
  const cache = new CachingLayer(new MemoryCache());
  const cachedRead = vi.spyOn(cache, 'getSource');
  for (const version of ['active', 'inactive'] as const) {
    const result = await handleToolCall(
      createClient(),
      DEFAULT_CONFIG,
      'SAPRead',
      { type, name, version },
      undefined,
      undefined,
      cache,
    );
    expect(result.isError, result.content[0]?.text).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text!);
    expect(data.version).toBe(version);
    expect(JSON.stringify(data.source)).toContain(version === 'active' ? 'activated' : 'draft');
  }
  expect(sends.map((url) => `${url.pathname}?version=${url.searchParams.get('version')}`)).toEqual(
    ['active', 'inactive'].flatMap((version) => [
      `${serverDrivenObjectUrl(type, name)}?version=${version}`,
      `${serverDrivenObjectUrl(type, name)}/source/main?version=${version}`,
    ]),
  );
  expect(cachedRead).not.toHaveBeenCalled();
});
it.each([undefined, 'auto'])('preserves the developer view for version=%s', async (version) => {
  const sends = backend('DRTY');
  const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'DRTY', name, version });
  expect(result.isError).toBeUndefined();
  expect(JSON.parse(result.content[0]!.text!).source).toBe('draft');
  expect(sends).toHaveLength(2);
  expect(sends.every((url) => !url.searchParams.has('version'))).toBe(true);
});
it.each([
  { type: 'DRTY' as const, requested: 'active', returned: 'inactive' },
  { type: 'UIAD' as const, requested: 'inactive', returned: 'active' },
  { type: 'DTDC' as const, requested: 'active', returned: '' },
])('refuses unconfirmed $requested selection when $type reports "$returned"', async ({ type, requested, returned }) => {
  const sends = backend(type, { returnedVersion: returned });
  const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type, name, version: requested });
  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).toContain('version');
  expect(sends).toHaveLength(1);
});
it.each([404, 403, 400])('propagates version-read HTTP %s without retrying another version', async (status) => {
  const sends = backend('DRTY', { status, failSource: true });
  const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
    type: 'DRTY',
    name,
    version: 'active',
  });
  expect(result.isError).toBe(true);
  expect(sends.every((url) => url.searchParams.get('version') === 'active')).toBe(true);
});
