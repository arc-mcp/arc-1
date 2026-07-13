import { beforeEach, describe, expect, it } from 'vitest';
import type { CacheApi, CachedDepGraph } from '../../../src/cache/cache.js';
import { hashSource } from '../../../src/cache/cache.js';
import { MemoryCache } from '../../../src/cache/memory.js';

describe('MemoryCache', () => {
  let cache: MemoryCache;

  beforeEach(() => {
    cache = new MemoryCache();
  });

  describe('apis', () => {
    it('stores and retrieves API objects', () => {
      const api: CacheApi = {
        name: 'CL_ABAP_REGEX',
        type: 'CLAS',
        releaseState: 'released',
        cleanCoreLevel: 'A',
      };
      cache.putApi(api);
      const found = cache.getApi('CL_ABAP_REGEX', 'CLAS');
      expect(found).not.toBeNull();
      expect(found?.releaseState).toBe('released');
    });

    it('returns null for missing API', () => {
      expect(cache.getApi('MISSING', 'CLAS')).toBeNull();
    });
  });

  describe('sources', () => {
    it('stores and retrieves source with active version by default', () => {
      cache.putSource('CLAS', 'ZCL_TEST', 'CLASS zcl_test DEFINITION.');
      const src = cache.getSource('CLAS', 'ZCL_TEST');
      expect(src).not.toBeNull();
      expect(src?.source).toBe('CLASS zcl_test DEFINITION.');
      expect(src?.objectType).toBe('CLAS');
      expect(src?.objectName).toBe('ZCL_TEST');
      expect(src?.version).toBe('active');
      expect(src?.hash).toBe(hashSource('CLASS zcl_test DEFINITION.'));
    });

    it('stores etag when provided', () => {
      cache.putSource('PROG', 'ZTEST', 'REPORT ztest.', { etag: '20231201001' });
      expect(cache.getSource('PROG', 'ZTEST')?.etag).toBe('20231201001');
    });

    it('keeps active and inactive source entries separate', () => {
      cache.putSource('CLAS', 'ZCL_TEST', 'active body');
      cache.putSource('CLAS', 'ZCL_TEST', 'inactive body', { version: 'inactive' });
      expect(cache.getSource('CLAS', 'ZCL_TEST')?.source).toBe('active body');
      expect(cache.getSource('CLAS', 'ZCL_TEST', 'inactive')?.source).toBe('inactive body');
    });

    it('returns null for missing source', () => {
      expect(cache.getSource('CLAS', 'MISSING')).toBeNull();
    });

    it('invalidateSource defaults to active version', () => {
      cache.putSource('PROG', 'ZTEST', 'active');
      cache.putSource('PROG', 'ZTEST', 'inactive', { version: 'inactive' });
      cache.invalidateSource('PROG', 'ZTEST');
      expect(cache.getSource('PROG', 'ZTEST')).toBeNull();
      expect(cache.getSource('PROG', 'ZTEST', 'inactive')?.source).toBe('inactive');
    });

    it("invalidateSource with explicit 'inactive' clears that view only", () => {
      cache.putSource('PROG', 'ZTEST', 'active');
      cache.putSource('PROG', 'ZTEST', 'inactive', { version: 'inactive' });
      cache.invalidateSource('PROG', 'ZTEST', 'inactive');
      expect(cache.getSource('PROG', 'ZTEST')?.source).toBe('active');
      expect(cache.getSource('PROG', 'ZTEST', 'inactive')).toBeNull();
    });

    it("invalidateSource with 'all' clears both views", () => {
      cache.putSource('PROG', 'ZTEST', 'active');
      cache.putSource('PROG', 'ZTEST', 'inactive', { version: 'inactive' });
      cache.invalidateSource('PROG', 'ZTEST', 'all');
      expect(cache.getSource('PROG', 'ZTEST')).toBeNull();
      expect(cache.getSource('PROG', 'ZTEST', 'inactive')).toBeNull();
    });

    it('lists source metadata without source bodies', () => {
      cache.putSource('CLAS', 'ZCL_ALPHA', 'CLASS zcl_alpha DEFINITION.', { etag: 'abc' });
      cache.putSource('PROG', 'ZREPORT', 'REPORT zreport.');

      const result = cache.listSources({ objectType: 'CLAS', limit: 10 });

      expect(result.total).toBe(1);
      expect(result.items[0]).toMatchObject({
        objectType: 'CLAS',
        objectName: 'ZCL_ALPHA',
        version: 'active',
        etagPresent: true,
        sourceLength: 'CLASS zcl_alpha DEFINITION.'.length,
      });
      expect(result.items[0]).not.toHaveProperty('source');
    });

    it('filters source metadata by name query and clamps limits', () => {
      cache.putSource('CLAS', 'ZCL_ALPHA', 'alpha');
      cache.putSource('CLAS', 'ZCL_BETA', 'beta', { version: 'inactive' });

      const result = cache.listSources({ query: 'beta', version: 'inactive', limit: 999 });

      expect(result.limit).toBe(200);
      expect(result.total).toBe(1);
      expect(result.items[0]?.objectName).toBe('ZCL_BETA');
    });
  });

  describe('dep graphs', () => {
    it('stores and retrieves a dependency graph', () => {
      const graph: CachedDepGraph = {
        sourceHash: 'abc123',
        objectName: 'ZCL_TEST',
        objectType: 'CLAS',
        contracts: [{ name: 'ZCL_DEP', type: 'CLAS', methodCount: 3, source: 'compressed', success: true }],
        cachedAt: new Date().toISOString(),
      };
      cache.putDepGraph(graph);
      const found = cache.getDepGraph('abc123');
      expect(found).not.toBeNull();
      expect(found?.objectName).toBe('ZCL_TEST');
      expect(found?.contracts).toHaveLength(1);
      expect(found?.contracts[0]?.name).toBe('ZCL_DEP');
    });

    it('returns null for missing dep graph', () => {
      expect(cache.getDepGraph('missing_hash')).toBeNull();
    });
  });

  describe('function groups', () => {
    it('stores and retrieves function group mapping', () => {
      cache.putFuncGroup('Z_MY_FUNC', 'Z_MY_GROUP');
      expect(cache.getFuncGroup('Z_MY_FUNC')).toBe('Z_MY_GROUP');
    });

    it('returns null for missing function', () => {
      expect(cache.getFuncGroup('MISSING_FUNC')).toBeNull();
    });

    it('is case-insensitive', () => {
      cache.putFuncGroup('z_my_func', 'z_my_group');
      expect(cache.getFuncGroup('Z_MY_FUNC')).toBe('Z_MY_GROUP');
    });
  });

  describe('management', () => {
    it('returns correct stats including sourceCount and contractCount', () => {
      cache.putApi({ name: 'X', type: 'CLAS', releaseState: 'released' });
      cache.putSource('CLAS', 'ZCL_A', 'source a');
      cache.putSource('PROG', 'ZTEST', 'source b');
      cache.putDepGraph({
        sourceHash: 'h1',
        objectName: 'ZCL_A',
        objectType: 'CLAS',
        contracts: [],
        cachedAt: '',
      });

      const stats = cache.stats();
      expect(stats.apiCount).toBe(1);
      expect(stats.sourceCount).toBe(2);
      expect(stats.contractCount).toBe(1);
    });

    it('clears all data including sources, dep graphs, and func groups', () => {
      cache.putApi({ name: 'X', type: 'CLAS', releaseState: 'released' });
      cache.putSource('CLAS', 'ZCL_A', 'source');
      cache.putDepGraph({
        sourceHash: 'h1',
        objectName: 'ZCL_A',
        objectType: 'CLAS',
        contracts: [],
        cachedAt: '',
      });
      cache.putFuncGroup('Z_FUNC', 'Z_GROUP');
      cache.clear();

      expect(cache.stats().apiCount).toBe(0);
      expect(cache.stats().sourceCount).toBe(0);
      expect(cache.stats().contractCount).toBe(0);
      expect(cache.getSource('CLAS', 'ZCL_A')).toBeNull();
      expect(cache.getFuncGroup('Z_FUNC')).toBeNull();
    });
  });
});
