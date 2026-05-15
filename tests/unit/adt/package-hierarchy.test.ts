import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtSafetyError } from '../../../src/adt/errors.js';
import { AdtPackageHierarchyResolver } from '../../../src/adt/package-hierarchy.js';

describe('AdtPackageHierarchyResolver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function buildFetcher(graph: Record<string, string[]>) {
    return vi.fn(async (root: string) => graph[root.toUpperCase()] ?? []);
  }

  it('returns true for the root itself without calling fetcher', async () => {
    const fetcher = buildFetcher({});
    const resolver = new AdtPackageHierarchyResolver(fetcher);
    expect(await resolver.isDescendantOrSelf('ZFOO', 'ZFOO')).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('case-insensitive match on root and descendant', async () => {
    const fetcher = buildFetcher({ ZFOO: ['ZBAR'] });
    const resolver = new AdtPackageHierarchyResolver(fetcher);
    expect(await resolver.isDescendantOrSelf('zfoo', 'ZBAR')).toBe(true);
    expect(await resolver.isDescendantOrSelf('ZFOO', 'zbar')).toBe(true);
  });

  it('walks the DEVCLASS subtree breadth-first', async () => {
    const fetcher = buildFetcher({
      ZFOO: ['ZBAR', 'ZBAZ'],
      ZBAR: ['ZQUX'],
      ZBAZ: [],
      ZQUX: ['ZDEEP'],
      ZDEEP: [],
    });
    const resolver = new AdtPackageHierarchyResolver(fetcher);
    expect(await resolver.isDescendantOrSelf('ZFOO', 'ZBAR')).toBe(true);
    expect(await resolver.isDescendantOrSelf('ZFOO', 'ZBAZ')).toBe(true);
    expect(await resolver.isDescendantOrSelf('ZFOO', 'ZQUX')).toBe(true);
    expect(await resolver.isDescendantOrSelf('ZFOO', 'ZDEEP')).toBe(true);
    expect(await resolver.isDescendantOrSelf('ZFOO', 'ZOTHER')).toBe(false);
  });

  it('does NOT match packages outside the subtree', async () => {
    const fetcher = buildFetcher({
      ZFOO: ['ZBAR'],
      ZBAR: [],
      ZSIBLING: ['SHOULD_NOT_APPEAR'],
    });
    const resolver = new AdtPackageHierarchyResolver(fetcher);
    expect(await resolver.isDescendantOrSelf('ZFOO', 'ZSIBLING')).toBe(false);
    expect(await resolver.isDescendantOrSelf('ZFOO', 'SHOULD_NOT_APPEAR')).toBe(false);
  });

  it('caches the resolved subtree for the TTL window', async () => {
    const fetcher = buildFetcher({ ZFOO: ['ZBAR'], ZBAR: [] });
    const resolver = new AdtPackageHierarchyResolver(fetcher, { ttlMs: 60_000 });

    expect(await resolver.isDescendantOrSelf('ZFOO', 'ZBAR')).toBe(true);
    expect(await resolver.isDescendantOrSelf('ZFOO', 'ZBAR')).toBe(true);
    expect(await resolver.isDescendantOrSelf('ZFOO', 'OTHER')).toBe(false);

    // BFS visits ZFOO once and ZBAR once. No re-fetch within TTL.
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('refreshes the subtree once the TTL elapses', async () => {
    const fetcher = buildFetcher({ ZFOO: [], ZNEW: [] });
    const resolver = new AdtPackageHierarchyResolver(fetcher, { ttlMs: 1000 });
    await resolver.isDescendantOrSelf('ZFOO', 'ANYTHING');
    expect(fetcher).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1001);

    await resolver.isDescendantOrSelf('ZFOO', 'ANYTHING');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('manual invalidate(root) forces a re-fetch on next call', async () => {
    const fetcher = buildFetcher({ ZFOO: [] });
    const resolver = new AdtPackageHierarchyResolver(fetcher);
    await resolver.isDescendantOrSelf('ZFOO', 'X');
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolver.invalidate('ZFOO');
    await resolver.isDescendantOrSelf('ZFOO', 'X');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('invalidate() with no argument clears all cached subtrees', async () => {
    const fetcher = buildFetcher({ ZFOO: [], ZBAR: [] });
    const resolver = new AdtPackageHierarchyResolver(fetcher);
    await resolver.isDescendantOrSelf('ZFOO', 'X');
    await resolver.isDescendantOrSelf('ZBAR', 'X');
    expect(fetcher).toHaveBeenCalledTimes(2);
    resolver.invalidate();
    await resolver.isDescendantOrSelf('ZFOO', 'X');
    await resolver.isDescendantOrSelf('ZBAR', 'X');
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('fetcher error is wrapped in AdtSafetyError and surfaces (fail-closed)', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('network down');
    });
    const resolver = new AdtPackageHierarchyResolver(fetcher);
    await expect(resolver.isDescendantOrSelf('ZFOO', 'ZBAR')).rejects.toThrow(AdtSafetyError);
    await expect(resolver.isDescendantOrSelf('ZFOO', 'ZBAR')).rejects.toThrow(/network down/);
  });

  it('failed resolution is purged from cache so a retry can succeed', async () => {
    let callCount = 0;
    const fetcher = vi.fn(async () => {
      callCount++;
      if (callCount === 1) throw new Error('first call fails');
      return ['ZBAR'];
    });
    const resolver = new AdtPackageHierarchyResolver(fetcher);
    await expect(resolver.isDescendantOrSelf('ZFOO', 'ZBAR')).rejects.toThrow(AdtSafetyError);
    expect(await resolver.isDescendantOrSelf('ZFOO', 'ZBAR')).toBe(true);
  });

  it('depth cap aborts a pathological linear chain', async () => {
    // ZA → ZB → ZC → ZD → ZE; with maxDepth=2 we should bail.
    const chain: Record<string, string[]> = { ZA: ['ZB'], ZB: ['ZC'], ZC: ['ZD'], ZD: ['ZE'], ZE: [] };
    const fetcher = buildFetcher(chain);
    const resolver = new AdtPackageHierarchyResolver(fetcher, { maxDepth: 2 });
    await expect(resolver.isDescendantOrSelf('ZA', 'NEVER')).rejects.toThrow(/maxDepth/);
  });

  it('cycle in TDEVC.PARENTCL is handled by BFS dedup (no infinite loop)', async () => {
    // ZA → ZB → ZA. BFS dedup must terminate before any depth cap.
    const fetcher = buildFetcher({ ZA: ['ZB'], ZB: ['ZA'] });
    const resolver = new AdtPackageHierarchyResolver(fetcher);
    expect(await resolver.isDescendantOrSelf('ZA', 'ZB')).toBe(true);
    expect(await resolver.isDescendantOrSelf('ZA', 'OTHER')).toBe(false);
    // 2 fetcher calls (ZA, ZB) — no third.
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('size protection: caps subtree size', async () => {
    // Fan-out exceeds maxPackages on first hop.
    const fetcher = vi.fn(async () => Array.from({ length: 20 }, (_, i) => `Z${i.toString().padStart(3, '0')}`));
    const resolver = new AdtPackageHierarchyResolver(fetcher, { maxPackages: 5 });
    await expect(resolver.isDescendantOrSelf('ZROOT', 'Z000')).rejects.toThrow(/maxPackages/);
  });

  it('deduplicates: diamond-shape DAG visits a node only once', async () => {
    // ZROOT -> [ZA, ZB] -> both -> ZTAIL (DAG, not strictly a tree)
    const fetcher = vi.fn(async (root: string) =>
      root === 'ZROOT' ? ['ZA', 'ZB'] : root === 'ZA' || root === 'ZB' ? ['ZTAIL'] : [],
    );
    const resolver = new AdtPackageHierarchyResolver(fetcher);
    expect(await resolver.isDescendantOrSelf('ZROOT', 'ZTAIL')).toBe(true);
    // ZROOT(1) + ZA(1) + ZB(1) + ZTAIL(1) = 4 fetcher calls — NOT 5.
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('concurrent calls share the same in-flight subtree resolution', async () => {
    let resolveFetcher: (value: string[]) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<string[]>((resolve) => {
          resolveFetcher = resolve;
        }),
    );
    const resolver = new AdtPackageHierarchyResolver(fetcher);

    const p1 = resolver.isDescendantOrSelf('ZFOO', 'ZBAR');
    const p2 = resolver.isDescendantOrSelf('ZFOO', 'ZBAR');
    expect(fetcher).toHaveBeenCalledTimes(1); // only the first call triggered BFS

    resolveFetcher!([]);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(false);
    expect(r2).toBe(false);
  });
});
