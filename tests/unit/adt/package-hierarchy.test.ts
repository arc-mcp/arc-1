import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtApiError, AdtSafetyError } from '../../../src/adt/errors.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import {
  AdtPackageHierarchyResolver,
  fetchSuperPackage,
  normalizePackageName,
  parsePackageDocument,
  type SuperPackageLookup,
} from '../../../src/adt/package-hierarchy.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';

describe('AdtPackageHierarchyResolver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** `parents` maps a package to its super-package ('' = top-level); a package absent from it is not found (404). */
  function buildFetcher(parents: Record<string, string>) {
    return vi.fn(async (pkg: string): Promise<SuperPackageLookup> => {
      const parent = parents[pkg.toUpperCase()];
      return parent === undefined ? { found: false } : { found: true, superPackage: parent || undefined };
    });
  }

  // ZROOT ── ZA ── ZA1 ── ZA2
  //      └─ ZB
  // ZOTHER (top-level)
  const TREE = { ZROOT: '', ZOTHER: '', ZA: 'ZROOT', ZA1: 'ZA', ZA2: 'ZA1', ZB: 'ZROOT' };

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

  it('an unknown package (not found) matches no root without a top-down fallback', async () => {
    const resolver = new AdtPackageHierarchyResolver(buildFetcher(TREE));
    expect(await resolver.isDescendantOrSelf('ZROOT', 'ZNEW_PACKAGE')).toBe(false);
  });

  it('an unknown super-package (not found) ends the chain without the fallback', async () => {
    const fetchSubpackages = vi.fn(async () => ['ZC']);
    const resolver = new AdtPackageHierarchyResolver(buildFetcher({ ZC: 'ZGONE' }), { fetchSubpackages });
    expect(await resolver.isDescendantOrSelf('ZROOT', 'ZC')).toBe(false);
    expect(fetchSubpackages).not.toHaveBeenCalled();
  });

  describe('top-down fallback when the checked package is not found (packages resource absent before 7.52)', () => {
    const CHILDREN: Record<string, string[]> = { ZROOT: ['ZA', 'ZB'], ZA: ['ZA1'], ZA1: ['ZA2'] };
    const allNotFound = () => vi.fn(async (): Promise<SuperPackageLookup> => ({ found: false }));
    const subpackages = () => vi.fn(async (root: string) => CHILDREN[root] ?? []);

    it('expands the rule subtree and matches a descendant', async () => {
      const fetchSubpackages = subpackages();
      const resolver = new AdtPackageHierarchyResolver(allNotFound(), { fetchSubpackages });
      expect(await resolver.isDescendantOrSelf('ZROOT', 'za2')).toBe(true);
      expect(await resolver.isDescendantOrSelf('ZROOT', 'ZOTHER')).toBe(false);
      expect(fetchSubpackages.mock.calls.map(([root]) => root)).toEqual(['ZROOT', 'ZA', 'ZB', 'ZA1', 'ZA2']);
    });

    it('is not used once the packages resource finds the checked package', async () => {
      const fetchSubpackages = subpackages();
      const resolver = new AdtPackageHierarchyResolver(buildFetcher(TREE), { fetchSubpackages });
      expect(await resolver.isDescendantOrSelf('ZROOT', 'ZA2')).toBe(true);
      expect(fetchSubpackages).not.toHaveBeenCalled();
    });

    it('a subtree fetch error denies (fail-closed) and is purged for a retry', async () => {
      let fail = true;
      const fetchSubpackages = vi.fn(async (root: string) => {
        if (fail) throw new Error('403 Forbidden');
        return CHILDREN[root] ?? [];
      });
      const resolver = new AdtPackageHierarchyResolver(allNotFound(), { fetchSubpackages });
      await expect(resolver.isDescendantOrSelf('ZROOT', 'ZA')).rejects.toThrow(/subtree under 'ZROOT'.*403/);
      fail = false;
      expect(await resolver.isDescendantOrSelf('ZROOT', 'ZA')).toBe(true);
    });

    it('caps the subtree size and depth', async () => {
      const wide = vi.fn(async (root: string) => (root === 'ZROOT' ? ['Z1', 'Z2', 'Z3'] : []));
      await expect(
        new AdtPackageHierarchyResolver(allNotFound(), { fetchSubpackages: wide, maxPackages: 2 }).isDescendantOrSelf(
          'ZROOT',
          'ZX',
        ),
      ).rejects.toThrow(/maxPackages=2/);
      const deep = vi.fn(async (root: string) => [`${root}X`]);
      await expect(
        new AdtPackageHierarchyResolver(allNotFound(), { fetchSubpackages: deep, maxDepth: 3 }).isDescendantOrSelf(
          'ZROOT',
          'ZY',
        ),
      ).rejects.toThrow(/maxDepth=3/);
    });
  });

  it('refuses an invalid checked package name before any request', async () => {
    const fetcher = buildFetcher(TREE);
    const resolver = new AdtPackageHierarchyResolver(fetcher);
    for (const bad of ['..', '.', 'ZA/../ZB', 'Z A', 'ZA?x=1', '', 'Z'.repeat(31)]) {
      await expect(resolver.isDescendantOrSelf('ZROOT', bad)).rejects.toBeInstanceOf(AdtSafetyError);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuses an invalid super-package name returned by SAP (fail-closed)', async () => {
    const resolver = new AdtPackageHierarchyResolver(buildFetcher({ ZA: '../ZROOT' }));
    await expect(resolver.isDescendantOrSelf('ZROOT', 'ZA')).rejects.toThrow(/not a valid package name/);
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
    const fetcher = vi.fn(async (pkg: string): Promise<SuperPackageLookup> => {
      if (pkg === 'ZA') return { found: true, superPackage: 'ZROOT' };
      throw new Error('500 Internal Server Error');
    });
    const resolver = new AdtPackageHierarchyResolver(fetcher);
    await expect(resolver.isDescendantOrSelf('ZROOT', 'ZA')).rejects.toBeInstanceOf(AdtSafetyError);
  });

  it('a failed resolution is purged from the cache so a retry can succeed', async () => {
    let fail = true;
    const fetcher = vi.fn(async (pkg: string): Promise<SuperPackageLookup> => {
      if (fail) throw new Error('network');
      return { found: true, superPackage: pkg === 'ZA' ? 'ZROOT' : undefined };
    });
    const resolver = new AdtPackageHierarchyResolver(fetcher);
    await expect(resolver.isDescendantOrSelf('ZROOT', 'ZA')).rejects.toBeInstanceOf(AdtSafetyError);
    fail = false;
    expect(await resolver.isDescendantOrSelf('ZROOT', 'ZA')).toBe(true);
  });

  it('the depth cap aborts a pathological chain', async () => {
    const fetcher = vi.fn(
      async (pkg: string): Promise<SuperPackageLookup> => ({ found: true, superPackage: `${pkg}X` }),
    );
    const resolver = new AdtPackageHierarchyResolver(fetcher, { maxDepth: 3 });
    await expect(resolver.isDescendantOrSelf('ZROOT', 'Z')).rejects.toThrow(/maxDepth=3/);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('a cycle in TDEVC.PARENTCL is refused (fail-closed, no endless walk)', async () => {
    const resolver = new AdtPackageHierarchyResolver(buildFetcher({ ZA: 'ZB', ZB: 'ZA' }));
    await expect(resolver.isDescendantOrSelf('ZROOT', 'ZA')).rejects.toThrow(/cycle at 'ZA'/);
  });

  it('concurrent calls share the same in-flight chain resolution', async () => {
    let resolveFetcher: (value: SuperPackageLookup) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<SuperPackageLookup>((resolve) => {
          resolveFetcher = resolve;
        }),
    );
    const resolver = new AdtPackageHierarchyResolver(fetcher);

    const p1 = resolver.isDescendantOrSelf('ZFOO', 'ZBAR');
    const p2 = resolver.isDescendantOrSelf('ZOTHER', 'ZBAR');
    expect(fetcher).toHaveBeenCalledTimes(1);

    resolveFetcher!({ found: true });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(false);
    expect(r2).toBe(false);
  });
});

describe('normalizePackageName', () => {
  it('accepts customer, local and namespaced names, uppercased', () => {
    expect(normalizePackageName(' zfoo_1 ')).toBe('ZFOO_1');
    expect(normalizePackageName('$tmp')).toBe('$TMP');
    expect(normalizePackageName('/company/pkg')).toBe('/COMPANY/PKG');
    expect(normalizePackageName('Z'.repeat(30))).toBe('Z'.repeat(30));
  });

  it.each(['..', '.', '', 'ZA/ZB', '/COMPANY/', 'Z-A', 'Z%2FA', 'Z'.repeat(31)])('refuses %j', (bad) => {
    expect(() => normalizePackageName(bad)).toThrow(AdtSafetyError);
  });
});

describe('parsePackageDocument', () => {
  const pkg = (superPackage: string, name = 'zchild') =>
    '<?xml version="1.0" encoding="utf-8"?><pak:package xmlns:pak="http://www.sap.com/adt/packages" ' +
    `xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="${name}" adtcore:type="DEVC/K">` +
    `<pak:attributes pak:packageType="development"/>${superPackage}<pak:transport/></pak:package>`;

  it('returns the uppercased package and super-package names', () => {
    expect(
      parsePackageDocument(
        pkg(
          '<pak:superPackage adtcore:uri="/sap/bc/adt/packages/zparent" adtcore:type="DEVC/K" adtcore:name="zparent"/>',
        ),
      ),
    ).toEqual({ name: 'ZCHILD', superPackage: 'ZPARENT' });
  });

  it('keeps namespaced names', () => {
    expect(parsePackageDocument(pkg('<pak:superPackage adtcore:name="/COMPANY/PARENT"/>')).superPackage).toBe(
      '/COMPANY/PARENT',
    );
  });

  it('a top-level package has no super-package (empty or missing element)', () => {
    expect(parsePackageDocument(pkg('<pak:superPackage adtcore:name=""/>'))).toEqual({ name: 'ZCHILD' });
    expect(parsePackageDocument(pkg('<pak:superPackage/>'))).toEqual({ name: 'ZCHILD' });
    expect(parsePackageDocument(pkg(''))).toEqual({ name: 'ZCHILD' });
  });

  it('reads only the direct child, never a nested superPackage', () => {
    const nested = '<pak:superPackage/><pak:subPackages><x:superPackage adtcore:name="ZROOT"/></pak:subPackages>';
    expect(parsePackageDocument(pkg(nested))).toEqual({ name: 'ZCHILD' });
  });

  it('throws on a document that is not a package or has several super-packages', () => {
    expect(() => parsePackageDocument('<html><body>login</body></html>')).toThrow(/not an ADT package document/);
    expect(() =>
      parsePackageDocument(pkg('<pak:superPackage adtcore:name="ZA"/><pak:superPackage adtcore:name="ZB"/>')),
    ).toThrow(/unexpected pak:superPackage/);
  });
});

describe('fetchSuperPackage', () => {
  const httpFailingWith = (status: number) =>
    ({
      get: vi.fn(async (path: string) => {
        throw new AdtApiError(`HTTP ${status}`, status, path);
      }),
    }) as unknown as AdtHttpClient;
  const httpReturning = (body: string) => {
    const get = vi.fn(async (_path: string) => ({ statusCode: 200, headers: {}, body }));
    return { get, http: { get } as unknown as AdtHttpClient };
  };
  const doc = (name: string, superPackage = '') =>
    '<pak:package xmlns:pak="http://www.sap.com/adt/packages" xmlns:adtcore="http://www.sap.com/adt/core" ' +
    `adtcore:name="${name}"><pak:superPackage adtcore:name="${superPackage}"/></pak:package>`;

  it('reports an unknown package (404) as not found', async () => {
    await expect(fetchSuperPackage(httpFailingWith(404), unrestrictedSafetyConfig(), 'ZNEW')).resolves.toEqual({
      found: false,
    });
  });

  it.each([401, 403, 500])('rethrows HTTP %s so the subtree check denies', async (status) => {
    await expect(fetchSuperPackage(httpFailingWith(status), unrestrictedSafetyConfig(), 'ZA')).rejects.toThrow(
      `HTTP ${status}`,
    );
  });

  it('reads the namespaced package path encoded', async () => {
    const { get, http } = httpReturning(doc('/COMPANY/PKG', '/COMPANY/PARENT'));
    await expect(fetchSuperPackage(http, unrestrictedSafetyConfig(), '/company/pkg')).resolves.toEqual({
      found: true,
      superPackage: '/COMPANY/PARENT',
    });
    expect(get.mock.calls[0]?.[0]).toBe('/sap/bc/adt/packages/%2FCOMPANY%2FPKG');
  });

  it('throws when SAP returns the document of another package', async () => {
    const { http } = httpReturning(doc('ZOTHER', 'ZROOT'));
    await expect(fetchSuperPackage(http, unrestrictedSafetyConfig(), 'ZA')).rejects.toThrow(
      /returned the document of 'ZOTHER'/,
    );
  });

  it('refuses an invalid name without a request', async () => {
    const { get, http } = httpReturning(doc('..'));
    await expect(fetchSuperPackage(http, unrestrictedSafetyConfig(), '..')).rejects.toBeInstanceOf(AdtSafetyError);
    expect(get).not.toHaveBeenCalled();
  });
});
