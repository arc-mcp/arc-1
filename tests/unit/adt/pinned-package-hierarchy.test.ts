import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtClient } from '../../../src/adt/client.js';
import { AdtSafetyError } from '../../../src/adt/errors.js';
import { createPinnedPackageHierarchyResolver } from '../../../src/adt/package-hierarchy.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { mockResponse } from '../../helpers/mock-fetch.js';

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.mock('undici', async (original) => ({ ...(await original<typeof import('undici')>()), fetch: mockFetch }));

function client() {
  return new AdtClient({
    baseUrl: 'http://sap:8000',
    safety: {
      ...defaultSafetyConfig(),
      multiTargetWrite: {
        enabled: true,
        target: 'A4H/001',
        allowedPackages: ['ZROOT/**'],
        allowedTransports: [],
        serverAllowedTransports: [],
      },
    },
  });
}
const policy = () => ({ deadline: Date.now() + 300_000, noReplay: true, retryTransientErrors: false });
const nodes = (names: string[]) =>
  `<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><TREE_CONTENT>${names
    .map(
      (name) =>
        `<SEU_ADT_REPOSITORY_OBJ_NODE><OBJECT_TYPE>DEVC/K</OBJECT_TYPE><OBJECT_NAME>${name}</OBJECT_NAME></SEU_ADT_REPOSITORY_OBJ_NODE>`,
    )
    .join('')}</TREE_CONTENT></DATA></asx:values></asx:abap>`;

beforeEach(() => {
  vi.restoreAllMocks();
  mockFetch.mockReset();
  mockFetch.mockResolvedValue(mockResponse(200, '', { 'x-csrf-token': 'token' }));
});

describe('pinned package hierarchy policy', () => {
  it('stops a positive check at its native path without reading remaining branches or the target children', async () => {
    const fetcher = vi.fn(async (root: string) =>
      root === 'ZROOT' ? ['ZMID', 'ZUNRELATED'] : root === 'ZMID' ? ['ZTARGET'] : [],
    );
    const resolver = createPinnedPackageHierarchyResolver(fetcher, policy());
    expect(await resolver.isDescendantOrSelf('ZROOT', 'ZTARGET')).toBe(true);
    expect(fetcher.mock.calls.map(([root]) => root)).toEqual(['ZROOT', 'ZMID']);
    fetcher.mockClear();
    expect(await resolver.isDescendantOrSelf('ZROOT', 'ZUNRELATED')).toBe(true);
    expect(fetcher.mock.calls.map(([root]) => root)).toEqual(['ZROOT']);
  });

  it('fully explores a negative decision, terminates cycles and refreshes the next decision', async () => {
    const fetcher = vi.fn(async (root: string) => (root === 'ZROOT' ? ['ZA', 'ZB'] : ['ZROOT']));
    const resolver = createPinnedPackageHierarchyResolver(fetcher, policy());
    expect(await resolver.isDescendantOrSelf('ZROOT', 'ZTARGET')).toBe(false);
    expect(fetcher.mock.calls.map(([root]) => root)).toEqual(['ZROOT', 'ZA', 'ZB']);
    fetcher.mockResolvedValue(['ZTARGET']);
    expect(await resolver.isDescendantOrSelf('ZROOT', 'ZTARGET')).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('retains traversal limits and rejects cancellation even when the response contains the target', async () => {
    const broad = createPinnedPackageHierarchyResolver(
      async () => Array.from({ length: 10_001 }, (_, i) => `Z${i}`),
      policy(),
    );
    expect(await broad.isDescendantOrSelf('ZROOT', 'Z9998')).toBe(true);
    await expect(broad.isDescendantOrSelf('ZROOT', 'Z9999')).rejects.toThrow('maxPackages');
    await expect(broad.isDescendantOrSelf('ZROOT', 'ZMISSING')).rejects.toThrow('maxPackages');
    const deep = createPinnedPackageHierarchyResolver(async (root) => [`Z${Number(root.slice(1)) + 1}`], policy());
    expect(await deep.isDescendantOrSelf('Z0', 'Z50')).toBe(true);
    await expect(deep.isDescendantOrSelf('Z0', 'Z51')).rejects.toThrow('maxDepth');
    const controller = new AbortController();
    const cancelled = createPinnedPackageHierarchyResolver(
      async () => {
        controller.abort();
        return ['ZTARGET'];
      },
      { ...policy(), signal: controller.signal },
    );
    await expect(cancelled.isDescendantOrSelf('ZROOT', 'ZTARGET')).rejects.toThrow(AdtSafetyError);
  });
  it('refuses a missing, unbounded or replayable request policy', () => {
    const c = client();
    for (const options of [undefined, {}, { ...policy(), deadline: Infinity }, { ...policy(), noReplay: false }])
      expect(() => c.getPackageHierarchyResolver(options)).toThrow('bounded mutation request policy');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not retain a positive subtree result between policy checks or requests', async () => {
    const c = client();
    const fetcher = vi.spyOn(c, 'getSubpackages').mockImplementation(async (root) => (root === 'ZROOT' ? ['ZA'] : []));
    const resolver = c.getPackageHierarchyResolver(policy());
    expect(await resolver.isDescendantOrSelf('ZROOT', 'ZA')).toBe(true);
    fetcher.mockResolvedValue([]);
    expect(await resolver.isDescendantOrSelf('ZROOT', 'ZA')).toBe(false);
    expect(await c.getPackageHierarchyResolver(policy()).isDescendantOrSelf('ZROOT', 'ZA')).toBe(false);
  });

  it('carries one deadline and cancellation signal into every nodestructure POST', async () => {
    const c = client();
    const budget = { ...policy(), signal: new AbortController().signal };
    const post = vi.spyOn(c.http, 'post').mockImplementation(async (url) => ({
      statusCode: 200,
      body: nodes(url.includes('parent_name=ZROOT') ? ['ZA'] : ['ZB']),
      headers: {},
    }));
    expect(await c.getPackageHierarchyResolver(budget).isDescendantOrSelf('ZROOT', 'ZB')).toBe(true);
    expect(post).toHaveBeenCalledTimes(2);
    for (const call of post.mock.calls) expect(call[4]).toEqual(budget);
  });

  it.each(['abort', 'deadline'] as const)('stops before SAP I/O when the request has expired: %s', async (reason) => {
    const controller = new AbortController();
    const budget = { ...policy(), signal: controller.signal };
    if (reason === 'abort') controller.abort();
    else budget.deadline = Date.now() - 1;
    await expect(client().getPackageHierarchyResolver(budget).isDescendantOrSelf('ZROOT', 'ZA')).rejects.toThrow(
      AdtSafetyError,
    );
    await expect(client().getPackageHierarchyResolver(budget).isDescendantOrSelf('ZROOT', 'ZROOT')).rejects.toThrow(
      AdtSafetyError,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('cancels between hierarchy levels without sending a child request', async () => {
    const controller = new AbortController();
    mockFetch.mockImplementation(async (url: unknown) => {
      if (String(url).includes('/repository/nodestructure')) {
        controller.abort();
        return mockResponse(200, nodes(['ZA']));
      }
      return mockResponse(200, '', { 'x-csrf-token': 'token' });
    });
    await expect(
      client()
        .getPackageHierarchyResolver({ ...policy(), signal: controller.signal })
        .isDescendantOrSelf('ZROOT', 'ZB'),
    ).rejects.toThrow(AdtSafetyError);
    expect(mockFetch.mock.calls.filter(([url]) => String(url).includes('parent_name=ZA'))).toHaveLength(0);
  });

  it('does not inherit a legacy clone cache or unrelated mutation response options', async () => {
    const c = client();
    const legacy = c.withSafety(defaultSafetyConfig());
    const fetcher = vi
      .spyOn(legacy, 'getSubpackages')
      .mockImplementation(async (root) => (root === 'ZROOT' ? ['ZA'] : []));
    expect(await legacy.getPackageHierarchyResolver().isDescendantOrSelf('ZROOT', 'ZA')).toBe(true);
    fetcher.mockResolvedValue([]);
    const pinned = legacy.withSafety(c.safety);
    const pinnedFetcher = vi.spyOn(pinned, 'getSubpackages').mockResolvedValue([]);
    const budget = { ...policy(), discardResponseBody: true };
    expect(await pinned.getPackageHierarchyResolver(budget).isDescendantOrSelf('ZROOT', 'ZA')).toBe(false);
    expect(pinnedFetcher.mock.lastCall?.[2]).toMatchObject({ deadline: budget.deadline, noReplay: true });
    expect(pinnedFetcher.mock.lastCall?.[2]).not.toHaveProperty('discardResponseBody');
    expect(await legacy.getPackageHierarchyResolver().isDescendantOrSelf('ZROOT', 'ZA')).toBe(true);
  });

  it('aborts during CSRF fetch without sending the hierarchy POST', async () => {
    const controller = new AbortController();
    mockFetch.mockImplementation(async () => {
      controller.abort();
      return mockResponse(200, '', { 'x-csrf-token': 'token' });
    });
    await expect(
      client()
        .getPackageHierarchyResolver({ ...policy(), signal: controller.signal })
        .isDescendantOrSelf('ZROOT', 'ZA'),
    ).rejects.toThrow(AdtSafetyError);
    expect(mockFetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(0);
  });

  it('does not replay a hierarchy POST rejected with a CSRF error', async () => {
    mockFetch.mockImplementation(async (_url: unknown, options: RequestInit) =>
      options.method === 'POST'
        ? mockResponse(403, '', { 'x-csrf-token': 'Required' })
        : mockResponse(200, '', { 'x-csrf-token': 'token' }),
    );
    await expect(client().getPackageHierarchyResolver(policy()).isDescendantOrSelf('ZROOT', 'ZA')).rejects.toThrow(
      AdtSafetyError,
    );
    expect(mockFetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1);
  });
});
