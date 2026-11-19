import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtApiError, AdtSafetyError } from '../../../src/adt/errors.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import {
  AdtPackageHierarchyResolver,
  fetchSuperPackage,
  parseSuperPackage,
} from '../../../src/adt/package-hierarchy.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';

describe('AdtPackageHierarchyResolver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** `parents` maps a package to its super-package; absent = top-level. */
  function buildFetcher(parents: Record<string, string>) {
    return vi.fn(async (pkg: string) => parents[pkg.toUpperCase()]);
  }

  // ZROOT ── ZA ── ZA1 ── ZA2
  //      └─ ZB
  // ZOTHER (top-level)
  const TREE = { ZA: 'ZROOT', ZA1: 'ZA', ZA2: 'ZA1', ZB: 'ZROOT' };

  it('returns true for the root itself without calling the fetcher', async () => {
    const fetcher = buildFetcher({});
    const resolver = new AdtPackageHierarchyResolver(fetcher);
    expect(await resolver.isDescendantOrSelf('ZFOO', 'ZFOO')).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('matches case-insensitively on root and descendant', async () => {
    const resolver = new AdtPackageHierarchyResolver(buildFetcher(TREE));
    expect(await resolver.isDescendantOrSelf('zroot', 'za2')).toBe(true);
    expect(await resolver.isDescendantOrSelf('ZRoot', 'Zb')).toBe(true);
  });

  it('walks the super-package chain, one request per level', async () => {
    const fetcher = buildFetcher(TREE);
    const resolver = new AdtPackageHierarchyResolver(fetcher);
    expect(await resolver.isDescendantOrSelf('ZROOT', 'ZA2')).toBe(true);
    // ZA2 -> ZA1 -> ZA -> ZROOT -> (top): four requests, independent of how many packages ZROOT holds.
    expect(fetcher.mock.calls.map(([pkg]) => pkg)).toEqual(['ZA2', 'ZA1', 'ZA', 'ZROOT']);
  });

  it('does not match packages outside the subtree', async () => {
    const resolver = new AdtPackageHierarchyResolver(buildFetcher({ ...TREE, ZOTHER_CHILD: 'ZOTHER' }));
    expect(await resolver.isDescendantOrSelf('ZROOT', 'ZOTHER_CHILD')).toBe(false);
    expect(await resolver.isDescendantOrSelf('ZA', 'ZB')).toBe(false);
    // A root below the package is not an ancestor.
    expect(await resolver.isDescendantOrSelf('ZA1', 'ZA')).toBe(false);
  });

  it('one chain answers every root', async () => {
    const fetcher = buildFetcher(TREE);
    const resolver = new AdtPackageHierarchyResolver(fetcher);
    expect(await resolver.isDescendantOrSelf('ZOTHER', 'ZA2')).toBe(false);
    expect(await resolver.isDescendantOrSelf('ZB', 'ZA2')).toBe(false);
    expect(await resolver.isDescendantOrSelf('ZROOT', 'ZA2')).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('an unknown package (fetcher returns undefined) matches no root', async () => {
    const resolver = new AdtPackageHierarchyResolver(buildFetcher(TREE));
    expect(await resolver.isDescendantOrSelf('ZROOT', 'ZNEW_PACKAGE')).toBe(false);
  });

  it('caches the resolved chain for the TTL window', async () => {
    const fetcher = buildFetcher(TREE);
    const resolver = new AdtPackageHierarchyResolver(fetcher, { ttlMs: 60_000 });
    await resolver.isDescendantOrSelf('ZROOT', 'ZA');
    await resolver.isDescendantOrSelf('ZROOT', 'ZA');
    vi.advanceTimersByTime(59_000);
    await resolver.isDescendantOrSelf('ZROOT', 'ZA');
    expect(fetcher).toHaveBeenCalledTimes(2); // ZA -> ZROOT, once
  });

  it('refreshes the chain once the TTL elapses', async () => {
    const fetcher = buildFetcher(TREE);
    const resolver = new AdtPackageHierarchyResolver(fetcher, { ttlMs: 1000 });
    await resolver.isDescendantOrSelf('ZROOT', 'ZA');
    vi.advanceTimersByTime(1001);
    await resolver.isDescendantOrSelf('ZROOT', 'ZA');
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('invalidate() clears every cached chain, with or without a package name', async () => {
    const fetcher = buildFetcher(TREE);
    const resolver = new AdtPackageHierarchyResolver(fetcher);
    await resolver.isDescendantOrSelf('ZROOT', 'ZA');
    await resolver.isDescendantOrSelf('ZROOT', 'ZB');
    resolver.invalidate('ZROOT');
    await resolver.isDescendantOrSelf('ZROOT', 'ZA');
    resolver.invalidate();
    await resolver.isDescendantOrSelf('ZROOT', 'ZB');
    expect(fetcher).toHaveBeenCalledTimes(8);
  });

  it('a fetcher error is wrapped in AdtSafetyError and surfaces (fail-closed)', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('403 Forbidden');
    });
    const resolver = new AdtPackageHierarchyResolver(fetcher);
    const err = await resolver.isDescendantOrSelf('ZROOT', 'ZA').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdtSafetyError);
    expect((err as Error).message).toMatch(/denying for safety.*403 Forbidden/);
  });

  it('an error above a match still denies (no partial chain is used)', async () => {
    const fetcher = vi.fn(async (pkg: string) => {
      if (pkg === 'ZA') return 'ZROOT';
      throw new Error('500 Internal Server Error');
    });
    const resolver = new AdtPackageHierarchyResolver(fetcher);
    await expect(resolver.isDescendantOrSelf('ZROOT', 'ZA')).rejects.toBeInstanceOf(AdtSafetyError);
  });

  it('a failed resolution is purged from the cache so a retry can succeed', async () => {
    let fail = true;
    const fetcher = vi.fn(async (pkg: string) => {
      if (fail) throw new Error('network');
      return pkg === 'ZA' ? 'ZROOT' : undefined;
    });
    const resolver = new AdtPackageHierarchyResolver(fetcher);
    await expect(resolver.isDescendantOrSelf('ZROOT', 'ZA')).rejects.toBeInstanceOf(AdtSafetyError);
    fail = false;
    expect(await resolver.isDescendantOrSelf('ZROOT', 'ZA')).toBe(true);
  });

  it('the depth cap aborts a pathological chain', async () => {
    const fetcher = vi.fn(async (pkg: string) => `${pkg}X`);
    const resolver = new AdtPackageHierarchyResolver(fetcher, { maxDepth: 3 });
    await expect(resolver.isDescendantOrSelf('ZROOT', 'Z')).rejects.toThrow(/maxDepth=3/);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('a cycle in TDEVC.PARENTCL is refused (fail-closed, no endless walk)', async () => {
    const resolver = new AdtPackageHierarchyResolver(buildFetcher({ ZA: 'ZB', ZB: 'ZA' }));
    await expect(resolver.isDescendantOrSelf('ZROOT', 'ZA')).rejects.toThrow(/cycle at 'ZA'/);
  });

  it('concurrent calls share the same in-flight chain resolution', async () => {
    let resolveFetcher: (value: string | undefined) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<string | undefined>((resolve) => {
          resolveFetcher = resolve;
        }),
    );
    const resolver = new AdtPackageHierarchyResolver(fetcher);

    const p1 = resolver.isDescendantOrSelf('ZFOO', 'ZBAR');
    const p2 = resolver.isDescendantOrSelf('ZOTHER', 'ZBAR');
    expect(fetcher).toHaveBeenCalledTimes(1);

    resolveFetcher!(undefined);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(false);
    expect(r2).toBe(false);
  });
});

describe('parseSuperPackage', () => {
  const pkg = (superPackage: string) =>
    '<?xml version="1.0" encoding="utf-8"?><pak:package xmlns:pak="http://www.sap.com/adt/packages" ' +
    'xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="ZCHILD" adtcore:type="DEVC/K">' +
    `<pak:attributes pak:packageType="development"/>${superPackage}<pak:transport/></pak:package>`;

  it('returns the uppercased super-package name', () => {
    expect(
      parseSuperPackage(
        pkg(
          '<pak:superPackage adtcore:uri="/sap/bc/adt/packages/zparent" adtcore:type="DEVC/K" adtcore:name="zparent"/>',
        ),
      ),
    ).toBe('ZPARENT');
  });

  it('keeps namespaced names', () => {
    expect(parseSuperPackage(pkg('<pak:superPackage adtcore:name="/COMPANY/PARENT"/>'))).toBe('/COMPANY/PARENT');
  });

  it('returns undefined for a top-level package (empty or missing element)', () => {
    expect(parseSuperPackage(pkg('<pak:superPackage adtcore:name=""/>'))).toBeUndefined();
    expect(parseSuperPackage(pkg('<pak:superPackage/>'))).toBeUndefined();
    expect(parseSuperPackage(pkg(''))).toBeUndefined();
  });
});

describe('fetchSuperPackage', () => {
  const httpFailingWith = (status: number) =>
    ({
      get: vi.fn(async (path: string) => {
        throw new AdtApiError(`HTTP ${status}`, status, path);
      }),
    }) as unknown as AdtHttpClient;

  it('treats an unknown package (404) as the end of the chain', async () => {
    await expect(fetchSuperPackage(httpFailingWith(404), unrestrictedSafetyConfig(), 'ZNEW')).resolves.toBeUndefined();
  });

  it.each([401, 403, 500])('rethrows HTTP %s so the subtree check denies', async (status) => {
    await expect(fetchSuperPackage(httpFailingWith(status), unrestrictedSafetyConfig(), 'ZA')).rejects.toThrow(
      `HTTP ${status}`,
    );
  });

  it('reads the namespaced package path encoded', async () => {
    const get = vi.fn(async (_path: string) => ({ statusCode: 200, headers: {}, body: '<pak:package/>' }));
    const http = { get } as unknown as AdtHttpClient;
    await expect(fetchSuperPackage(http, unrestrictedSafetyConfig(), '/COMPANY/PKG')).resolves.toBeUndefined();
    expect(get.mock.calls[0]?.[0]).toBe('/sap/bc/adt/packages/%2FCOMPANY%2FPKG');
  });
});
