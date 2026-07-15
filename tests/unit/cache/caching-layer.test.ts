import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdtClient } from '../../../src/adt/client.js';
import { AdtApiError } from '../../../src/adt/errors.js';
import { CachingLayer } from '../../../src/cache/caching-layer.js';
import { MemoryCache } from '../../../src/cache/memory.js';

/** Minimal mock of AdtClient with the methods CachingLayer uses */
function makeMockClient() {
  return {
    getClass: vi.fn(),
    getInterface: vi.fn(),
    searchObject: vi.fn(),
  } as unknown as AdtClient;
}

describe('CachingLayer', () => {
  let cache: MemoryCache;
  let layer: CachingLayer;
  let client: AdtClient;

  beforeEach(() => {
    cache = new MemoryCache();
    layer = new CachingLayer(cache);
    client = makeMockClient();
  });

  // ─── Source Caching ──────────────────────────────────────────────────

  describe('source caching', () => {
    it('cache miss calls fetcher with undefined ifNoneMatch and stores result with etag', async () => {
      const fetcher = vi
        .fn()
        .mockResolvedValue({ source: 'CLASS zcl_test. ENDCLASS.', etag: 'e1', notModified: false, statusCode: 200 });

      const result = await layer.getSource('CLAS', 'ZCL_TEST', fetcher);
      expect(result).toEqual({ source: 'CLASS zcl_test. ENDCLASS.', hit: false, revalidated: false });
      expect(fetcher).toHaveBeenCalledWith(undefined);
      expect(layer.getCachedSourceWithEtag('CLAS', 'ZCL_TEST')).toEqual({
        source: 'CLASS zcl_test. ENDCLASS.',
        etag: 'e1',
      });
    });

    it('cache hit with etag sends If-None-Match and returns cached on 304', async () => {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce({ source: 'body', etag: 'e1', notModified: false, statusCode: 200 })
        .mockResolvedValueOnce({ source: '', etag: 'e1', notModified: true, statusCode: 304 });

      await layer.getSource('PROG', 'ZTEST', fetcher);
      const second = await layer.getSource('PROG', 'ZTEST', fetcher);
      expect(fetcher).toHaveBeenNthCalledWith(2, 'e1');
      expect(second).toEqual({ source: 'body', hit: true, revalidated: true });
    });

    it('cache hit with etag fetches fresh on 200 when etag changed', async () => {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce({ source: 'oldbody', etag: 'e1', notModified: false, statusCode: 200 })
        .mockResolvedValueOnce({ source: 'newbody', etag: 'e2', notModified: false, statusCode: 200 });

      await layer.getSource('PROG', 'ZTEST', fetcher);
      const second = await layer.getSource('PROG', 'ZTEST', fetcher);
      expect(second).toEqual({ source: 'newbody', hit: false, revalidated: false });
      expect(layer.getCachedSourceWithEtag('PROG', 'ZTEST')).toEqual({ source: 'newbody', etag: 'e2' });
    });

    it('cache hit with no etag falls back to plain GET and replaces cache', async () => {
      cache.putSource('PROG', 'ZTEST', 'old');
      const fetcher = vi.fn().mockResolvedValue({ source: 'fresh', notModified: false, statusCode: 200 });

      const result = await layer.getSource('PROG', 'ZTEST', fetcher);
      expect(fetcher).toHaveBeenCalledWith(undefined);
      expect(result).toEqual({ source: 'fresh', hit: false, revalidated: false });
      expect(layer.getCachedSourceWithEtag('PROG', 'ZTEST')).toEqual({ source: 'fresh', etag: undefined });
    });

    it('cache miss when fetcher returns no etag stores entry without etag', async () => {
      const fetcher = vi.fn().mockResolvedValue({ source: 'body', notModified: false, statusCode: 200 });

      await layer.getSource('PROG', 'ZTEST', fetcher);
      expect(layer.getCachedSourceWithEtag('PROG', 'ZTEST')).toEqual({ source: 'body', etag: undefined });
    });

    it('active and inactive entries do not collide', async () => {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce({ source: 'active', etag: 'a1', notModified: false, statusCode: 200 })
        .mockResolvedValueOnce({ source: 'inactive', etag: 'i1', notModified: false, statusCode: 200 });

      await layer.getSource('CLAS', 'ZCL_TEST', fetcher, { version: 'active' });
      await layer.getSource('CLAS', 'ZCL_TEST', fetcher, { version: 'inactive' });
      expect(layer.getCachedSourceWithEtag('CLAS', 'ZCL_TEST', 'active')).toEqual({ source: 'active', etag: 'a1' });
      expect(layer.getCachedSourceWithEtag('CLAS', 'ZCL_TEST', 'inactive')).toEqual({
        source: 'inactive',
        etag: 'i1',
      });
    });

    it('returns cache miss after invalidation', async () => {
      const fetcher = vi
        .fn()
        .mockResolvedValue({ source: 'REPORT zprog.', etag: 'e1', notModified: false, statusCode: 200 });

      await layer.getSource('PROG', 'ZPROG', fetcher);
      expect(fetcher).toHaveBeenCalledTimes(1);

      layer.invalidate('PROG', 'ZPROG');

      const fetcherV2 = vi.fn().mockResolvedValue({
        source: 'REPORT zprog. " updated',
        etag: 'e2',
        notModified: false,
        statusCode: 200,
      });
      const result = await layer.getSource('PROG', 'ZPROG', fetcherV2);
      expect(result.hit).toBe(false);
      expect(result.source).toBe('REPORT zprog. " updated');
      expect(fetcherV2).toHaveBeenCalledTimes(1);
    });

    it('records source cache activity for UI inspection', async () => {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce({ source: 'REPORT zprog.', etag: 'e1', notModified: false, statusCode: 200 })
        .mockResolvedValueOnce({ source: '', etag: 'e1', notModified: true, statusCode: 304 });

      await layer.getSource('PROG', 'ZPROG', fetcher);
      await layer.getSource('PROG', 'ZPROG', fetcher);
      layer.invalidate('PROG', 'ZPROG');

      const activity = layer.listActivity();

      expect(activity.counts).toMatchObject({
        source_miss: 1,
        source_store: 1,
        source_hit: 1,
        source_invalidate: 1,
      });
      expect(activity.items.map((item) => item.event)).toEqual([
        'source_invalidate',
        'source_hit',
        'source_store',
        'source_miss',
      ]);
      expect(activity.items[0]).toMatchObject({
        objectType: 'PROG',
        objectName: 'ZPROG',
        version: 'active',
        removed: 1,
      });
      expect(activity.items[2]).toMatchObject({
        objectType: 'PROG',
        objectName: 'ZPROG',
        version: 'active',
        sourceLength: 'REPORT zprog.'.length,
        etagPresent: true,
        detail: 'loaded from SAP',
      });
      expect(activity.items[3]).toMatchObject({
        objectType: 'PROG',
        objectName: 'ZPROG',
        version: 'active',
        detail: 'no cached source entry',
      });
      expect(activity.items[3]).not.toHaveProperty('sourceLength');
    });

    it('can disable source cache activity recording', async () => {
      const silentLayer = new CachingLayer(new MemoryCache(), 0);
      const fetcher = vi.fn().mockResolvedValue({
        source: 'REPORT zsilent.',
        etag: 'e1',
        notModified: false,
        statusCode: 200,
      });

      await silentLayer.getSource('PROG', 'ZSILENT', fetcher);
      silentLayer.invalidate('PROG', 'ZSILENT');

      expect(silentLayer.listActivity()).toMatchObject({
        total: 0,
        counts: {},
        items: [],
      });
    });

    it('invalidate(type, name) defaults to active version', async () => {
      cache.putSource('PROG', 'ZTEST', 'active');
      cache.putSource('PROG', 'ZTEST', 'inactive', { version: 'inactive' });
      layer.invalidate('PROG', 'ZTEST');
      expect(layer.getCachedSourceWithEtag('PROG', 'ZTEST')).toBeNull();
      expect(layer.getCachedSourceWithEtag('PROG', 'ZTEST', 'inactive')).toEqual({
        source: 'inactive',
        etag: undefined,
      });
    });

    it('getSource invalidates cache and re-throws when conditional GET returns 404', async () => {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce({ source: 'body', etag: 'e1', notModified: false, statusCode: 200 })
        .mockRejectedValueOnce(
          new AdtApiError(
            'Resource does not exist',
            404,
            '/sap/bc/adt/programs/programs/ZTEST/source/main',
            '<exc:type id="ExceptionResourceNotFound"/>',
          ),
        );

      await layer.getSource('PROG', 'ZTEST', fetcher);
      await expect(layer.getSource('PROG', 'ZTEST', fetcher)).rejects.toBeInstanceOf(AdtApiError);
      expect(layer.getCachedSourceWithEtag('PROG', 'ZTEST')).toBeNull();
    });

    it('getSource invalidates cache and re-throws on 410 Gone', async () => {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce({ source: 'body', etag: 'e1', notModified: false, statusCode: 200 })
        .mockRejectedValueOnce(new AdtApiError('Gone', 410, '/sap/bc/adt/programs/programs/ZTEST/source/main'));

      await layer.getSource('PROG', 'ZTEST', fetcher);
      await expect(layer.getSource('PROG', 'ZTEST', fetcher)).rejects.toBeInstanceOf(AdtApiError);
      expect(layer.getCachedSourceWithEtag('PROG', 'ZTEST')).toBeNull();
    });

    it('getSource does not invalidate cache on transient errors', async () => {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce({ source: 'body', etag: 'e1', notModified: false, statusCode: 200 })
        .mockRejectedValueOnce(new AdtApiError('Unavailable', 503, '/sap/bc/adt/programs/programs/ZTEST/source/main'));

      await layer.getSource('PROG', 'ZTEST', fetcher);
      await expect(layer.getSource('PROG', 'ZTEST', fetcher)).rejects.toBeInstanceOf(AdtApiError);
      expect(layer.getCachedSourceWithEtag('PROG', 'ZTEST')).toEqual({ source: 'body', etag: 'e1' });
    });

    it('getCachedSource returns null on miss', () => {
      expect(layer.getCachedSource('CLAS', 'ZCL_MISSING')).toBeNull();
    });

    it('getCachedSource returns entry after getSource populates cache', async () => {
      const fetcher = vi.fn().mockResolvedValue({ source: 'source code', notModified: false, statusCode: 200 });
      await layer.getSource('CLAS', 'ZCL_HIT', fetcher);

      const cached = layer.getCachedSource('CLAS', 'ZCL_HIT');
      expect(cached).not.toBeNull();
      expect(cached?.source).toBe('source code');
    });
  });

  // ─── Dependency Graph Caching ────────────────────────────────────────

  describe('dep graph caching', () => {
    it('getCachedDepGraph returns null on miss', () => {
      expect(layer.getCachedDepGraph('some source')).toBeNull();
    });

    it('getCachedDepGraph returns graph on hit', () => {
      const source = 'CLASS zcl_foo. ENDCLASS.';
      const contracts = [{ name: 'IF_BAR', type: 'INTF', methodCount: 2, source: 'compressed', success: true }];
      layer.putDepGraph(source, 'ZCL_FOO', 'CLAS', contracts);

      const result = layer.getCachedDepGraph(source);
      expect(result).not.toBeNull();
      expect(result?.objectName).toBe('ZCL_FOO');
      expect(result?.objectType).toBe('CLAS');
      expect(result?.contracts).toHaveLength(1);
      expect(result?.contracts[0]?.name).toBe('IF_BAR');
    });

    it('putDepGraph + getCachedDepGraph round-trip preserves contracts', () => {
      const source = 'INTERFACE if_x. ENDINTERFACE.';
      const contracts = [
        { name: 'CL_A', type: 'CLAS', methodCount: 5, source: 'contract_a', success: true },
        { name: 'CL_B', type: 'CLAS', methodCount: 0, source: '', success: false, error: 'not found' },
      ];
      layer.putDepGraph(source, 'IF_X', 'INTF', contracts);

      const graph = layer.getCachedDepGraph(source);
      expect(graph).not.toBeNull();
      expect(graph?.contracts).toHaveLength(2);
      expect(graph?.contracts[0]?.success).toBe(true);
      expect(graph?.contracts[1]?.success).toBe(false);
      expect(graph?.contracts[1]?.error).toBe('not found');
    });

    it('returns null when source changes (hash mismatch)', () => {
      const sourceV1 = 'version 1';
      const sourceV2 = 'version 2';
      layer.putDepGraph(sourceV1, 'ZCL_X', 'CLAS', []);

      expect(layer.getCachedDepGraph(sourceV1)).not.toBeNull();
      expect(layer.getCachedDepGraph(sourceV2)).toBeNull();
    });
  });

  // ─── Function Group Resolution ───────────────────────────────────────

  describe('function group resolution', () => {
    it('resolves function group from search and caches it', async () => {
      (client.searchObject as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          objectType: 'FUGR/FF',
          objectName: 'Z_MY_FM',
          description: 'My Function Module',
          packageName: '$TMP',
          uri: '/sap/bc/adt/functions/groups/Z_MY_GROUP/fmodules/Z_MY_FM',
        },
      ]);

      const group = await layer.resolveFuncGroup(client, 'Z_MY_FM');
      expect(group).toBe('Z_MY_GROUP');
      expect(client.searchObject).toHaveBeenCalledTimes(1);

      // Second call should use cache, not call searchObject again
      const group2 = await layer.resolveFuncGroup(client, 'Z_MY_FM');
      expect(group2).toBe('Z_MY_GROUP');
      expect(client.searchObject).toHaveBeenCalledTimes(1);
    });

    it('returns null when search has no matching URI', async () => {
      (client.searchObject as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          objectType: 'PROG',
          objectName: 'Z_UNRELATED',
          description: 'No group match',
          packageName: '$TMP',
          uri: '/sap/bc/adt/programs/programs/Z_UNRELATED',
        },
      ]);

      const group = await layer.resolveFuncGroup(client, 'Z_MISSING_FM');
      expect(group).toBeNull();
    });

    it('returns null when search returns empty results', async () => {
      (client.searchObject as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const group = await layer.resolveFuncGroup(client, 'Z_NONEXISTENT');
      expect(group).toBeNull();
    });
  });

  // ─── Write Invalidation ──────────────────────────────────────────────

  describe('write invalidation', () => {
    it('invalidate removes source from cache', async () => {
      const fetcher = vi.fn().mockResolvedValue({ source: 'old source', notModified: false, statusCode: 200 });
      await layer.getSource('CLAS', 'ZCL_EDIT', fetcher);

      expect(layer.getCachedSource('CLAS', 'ZCL_EDIT')).not.toBeNull();

      layer.invalidate('CLAS', 'ZCL_EDIT');

      expect(layer.getCachedSource('CLAS', 'ZCL_EDIT')).toBeNull();
    });

    it('invalidate for non-existent entry does not throw', () => {
      expect(() => layer.invalidate('CLAS', 'ZCL_NONEXISTENT')).not.toThrow();
    });
  });

  // ─── Stats ───────────────────────────────────────────────────────────

  describe('stats', () => {
    it('reports empty stats on fresh cache', () => {
      const stats = layer.stats();
      expect(stats.apiCount).toBe(0);
      expect(stats.sourceCount).toBe(0);
      expect(stats.contractCount).toBe(0);
    });

    it('reports correct counts after populating cache', async () => {
      // Add a source via getSource
      const fetcher = vi.fn().mockResolvedValue({ source: 'source', notModified: false, statusCode: 200 });
      await layer.getSource('CLAS', 'ZCL_A', fetcher);
      await layer.getSource(
        'PROG',
        'ZPROG',
        vi.fn().mockResolvedValue({ source: 'report', notModified: false, statusCode: 200 }),
      );

      // Add a dep graph
      layer.putDepGraph('source', 'ZCL_A', 'CLAS', []);

      const stats = layer.stats();
      expect(stats.sourceCount).toBe(2);
      expect(stats.contractCount).toBe(1);
    });
  });

  // ─── Post-Activation Freshness Guard ─────────────────────────────────
  // Regression for the "stale active read after SAPActivate" bug: on an eventually-consistent
  // backend (BTP/Steampunk) the active /source/main can briefly still serve the pre-activation
  // shell. markActivated() promotes the just-activated draft and the guard serves it without
  // revalidating, so the next active read returns the real source WITHOUT force_refresh.
  describe('post-activation freshness', () => {
    const STALE = 'CLASS zcl_x. " empty pre-activation shell\nENDCLASS.';
    const REAL = 'CLASS zcl_x.\n  METHOD hello.\n    r = `hi`.\n  ENDMETHOD.\nENDCLASS.';

    it('serves the promoted draft as active without calling the (lagging) fetcher', async () => {
      // Pre-activation read cached the empty shell with an etag.
      cache.putSource('CLAS', 'ZCL_X', STALE, { version: 'active', etag: 'e0' });
      // Activation promotes the captured draft.
      layer.markActivated('CLAS', 'ZCL_X', REAL);

      // A backend that still serves the stale shell on the post-activate read.
      const laggingFetcher = vi
        .fn()
        .mockResolvedValue({ source: STALE, etag: 'e0', notModified: false, statusCode: 200 });

      const result = await layer.getSource('CLAS', 'ZCL_X', laggingFetcher, { version: 'active' });
      expect(result).toEqual({ source: REAL, hit: true, revalidated: false });
      expect(laggingFetcher).not.toHaveBeenCalled();
      // Inactive slot is dropped on promotion (the draft is now active).
      expect(layer.getCachedSourceWithEtag('CLAS', 'ZCL_X', 'inactive')).toBeNull();
    });

    it('flags the object as recently activated (drives draft-note suppression)', () => {
      expect(layer.wasRecentlyActivated('CLAS', 'ZCL_X')).toBe(false);
      layer.markActivated('CLAS', 'ZCL_X', REAL);
      expect(layer.wasRecentlyActivated('CLAS', 'ZCL_X')).toBe(true);
      expect(layer.wasRecentlyActivated('CLAS', 'ZCL_OTHER')).toBe(false);
      // Case-insensitive, like the source cache keys.
      expect(layer.wasRecentlyActivated('clas', 'zcl_x')).toBe(true);
    });

    it('clears freshness on invalidate (write / force_refresh resets to backend truth)', async () => {
      cache.putSource('CLAS', 'ZCL_X', STALE, { version: 'active', etag: 'e0' });
      layer.markActivated('CLAS', 'ZCL_X', REAL);
      layer.invalidate('CLAS', 'ZCL_X', 'all');

      expect(layer.wasRecentlyActivated('CLAS', 'ZCL_X')).toBe(false);
      const fetcher = vi.fn().mockResolvedValue({ source: REAL, etag: 'e1', notModified: false, statusCode: 200 });
      const result = await layer.getSource('CLAS', 'ZCL_X', fetcher, { version: 'active' });
      expect(fetcher).toHaveBeenCalledOnce();
      expect(result.source).toBe(REAL);
    });

    it('without a promoted draft, suppresses the note but still fetches the active source', async () => {
      layer.markActivated('CLAS', 'ZCL_Y'); // note-suppress only (no draft captured)
      expect(layer.wasRecentlyActivated('CLAS', 'ZCL_Y')).toBe(true);

      const fetcher = vi.fn().mockResolvedValue({ source: REAL, etag: 'e1', notModified: false, statusCode: 200 });
      const result = await layer.getSource('CLAS', 'ZCL_Y', fetcher, { version: 'active' });
      expect(fetcher).toHaveBeenCalledOnce();
      expect(result.source).toBe(REAL);
    });

    it('only guards active reads, not inactive', async () => {
      layer.markActivated('CLAS', 'ZCL_X', REAL);
      const fetcher = vi.fn().mockResolvedValue({ source: 'draft', etag: 'e1', notModified: false, statusCode: 200 });
      await layer.getSource('CLAS', 'ZCL_X', fetcher, { version: 'inactive' });
      expect(fetcher).toHaveBeenCalledOnce();
    });

    it('expires after the freshness window so reads revalidate again', async () => {
      vi.useFakeTimers();
      try {
        cache.putSource('CLAS', 'ZCL_X', REAL, { version: 'active' });
        layer.markActivated('CLAS', 'ZCL_X', REAL);
        expect(layer.wasRecentlyActivated('CLAS', 'ZCL_X')).toBe(true);

        vi.advanceTimersByTime(120_001);
        expect(layer.wasRecentlyActivated('CLAS', 'ZCL_X')).toBe(false);

        const fetcher = vi.fn().mockResolvedValue({ source: REAL, etag: 'e1', notModified: false, statusCode: 200 });
        await layer.getSource('CLAS', 'ZCL_X', fetcher, { version: 'active' });
        expect(fetcher).toHaveBeenCalledOnce();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
