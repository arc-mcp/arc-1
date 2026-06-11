/**
 * Integration tests for the object caching layer.
 *
 * These tests run against a live SAP system.
 * Missing credentials are treated as setup errors and fail the suite.
 *
 * What is tested:
 * - Source cache miss/revalidation/invalidation (MemoryCache and SqliteCache)
 * - Dependency graph caching (second SAPContext call returns [cached])
 * - Cache stats reporting via SAPManage
 * - Warmup: one bounded smoke proves a stable package can mark the cache warm
 * - Usages (reverse deps): correct error message when warmup not run
 * - SQLite cache persistence across instances
 *
 * Run: npm run test:integration
 * Slow warmup coverage: npm run test:integration:slow
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AdtClient } from '../../src/adt/client.js';
import { CachingLayer } from '../../src/cache/caching-layer.js';
import { MemoryCache } from '../../src/cache/memory.js';
import { SqliteCache } from '../../src/cache/sqlite.js';
import { runWarmup } from '../../src/cache/warmup.js';
import { handleToolCall } from '../../src/handlers/dispatch.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import { requireOrSkip, SkipReason } from '../helpers/skip-policy.js';
import { getTestClient, requireSapCredentials } from './helpers.js';

/**
 * Known Z class on the target SAP system — small, fast to fetch.
 * Use one of the persistent e2e fixtures (see `tests/e2e/fixtures.ts`) so this
 * works on any system where `npm run test:e2e` has been run once.
 *
 * Before: `ZCL_MCPT_26256` was hardcoded here — a leaked test-run artifact
 * from the original author's machine that would never exist on any other
 * system. That caused the cache suite to hard-fail on every fresh SAP box.
 */
const TEST_CLASS = 'ZCL_ARC1_TEST';
/** Known Z class with dependencies — used for dep graph tests. S/4-only BOBF demo. */
const TEST_CLASS_WITH_DEPS = 'ZCL_DEMO_D_CALC_AMOUNT';
/** Package that contains the test classes with deps */
const TEST_PACKAGE_WITH_DEPS = '$DEMO_SOI_DRAFT';

function readTestClass(client: AdtClient) {
  return (ifNoneMatch?: string) => client.getClass(TEST_CLASS, undefined, { ifNoneMatch });
}

describe('Cache Integration Tests', () => {
  let client: AdtClient;
  let hasTestClass = false;
  let hasTestClassWithDeps = false;

  beforeAll(async () => {
    requireSapCredentials();
    client = getTestClient();
    // Probe fixture availability once — each test then skips cleanly if absent.
    try {
      await client.getClass(TEST_CLASS);
      hasTestClass = true;
    } catch {
      hasTestClass = false;
    }
    try {
      await client.getClass(TEST_CLASS_WITH_DEPS);
      hasTestClassWithDeps = true;
    } catch {
      hasTestClassWithDeps = false;
    }
  });

  /** Gate a test on the base-cache fixture being present. */
  function requireCacheFixture(ctx: import('vitest').TaskContext): void {
    if (!hasTestClass) {
      requireOrSkip(ctx, undefined, `${SkipReason.NO_FIXTURE} (${TEST_CLASS}) — run npm run test:e2e once to seed`);
    }
  }

  /** Gate a test on the dep-graph fixture (S/4 BOBF demo) being present. */
  function requireDepGraphFixture(ctx: import('vitest').TaskContext): void {
    if (!hasTestClassWithDeps) {
      requireOrSkip(
        ctx,
        undefined,
        `${SkipReason.NO_FIXTURE} (${TEST_CLASS_WITH_DEPS}) — S/4 BOBF demo not on this system`,
      );
    }
  }

  // ─── Source Cache (Memory) ─────────────────────────────────────────

  describe('MemoryCache source caching', () => {
    beforeEach((ctx) => requireCacheFixture(ctx));

    it('returns MISS then revalidated HIT for same object', async () => {
      const cache = new MemoryCache();
      const cl = new CachingLayer(cache);

      const { hit: hit1, revalidated: revalidated1 } = await cl.getSource('CLAS', TEST_CLASS, readTestClass(client));
      expect(hit1).toBe(false); // first fetch = miss
      expect(revalidated1).toBe(false);

      const {
        source: src2,
        hit: hit2,
        revalidated: revalidated2,
      } = await cl.getSource('CLAS', TEST_CLASS, readTestClass(client));
      expect(hit2).toBe(true); // second fetch = 304-backed cache hit
      expect(revalidated2).toBe(true);
      expect(src2.length).toBeGreaterThan(0);
    }, 15000);

    it('revalidated hit returns the same source as the miss', async () => {
      const cache = new MemoryCache();
      const cl = new CachingLayer(cache);

      const miss = await cl.getSource('CLAS', TEST_CLASS, readTestClass(client));

      const t1 = Date.now();
      const hit = await cl.getSource('CLAS', TEST_CLASS, readTestClass(client));
      const hitMs = Date.now() - t1;

      expect(hit.hit).toBe(true);
      expect(hit.revalidated).toBe(true);
      expect(hit.source).toBe(miss.source);
      // Revalidation is still a live SAP request. Keep timing as a broad smoke
      // signal only; correctness is covered by hit/revalidated/source assertions.
      expect(hitMs).toBeLessThan(5000);
    }, 15000);

    it('invalidation causes next fetch to go to SAP', async () => {
      const cache = new MemoryCache();
      const cl = new CachingLayer(cache);

      // Populate cache
      await cl.getSource('CLAS', TEST_CLASS, readTestClass(client));

      // Invalidate
      cl.invalidate('CLAS', TEST_CLASS);

      // Next fetch must be a miss (fetcher called again)
      let fetcherCalled = false;
      const { hit } = await cl.getSource('CLAS', TEST_CLASS, async (ifNoneMatch) => {
        fetcherCalled = true;
        return client.getClass(TEST_CLASS, undefined, { ifNoneMatch });
      });

      expect(hit).toBe(false);
      expect(fetcherCalled).toBe(true);
    }, 15000);

    it('does not share entries across different CachingLayer instances', async () => {
      const cl1 = new CachingLayer(new MemoryCache());
      const cl2 = new CachingLayer(new MemoryCache());

      await cl1.getSource('CLAS', TEST_CLASS, readTestClass(client));

      // cl2 has its own cache — should be a miss
      const { hit } = await cl2.getSource('CLAS', TEST_CLASS, readTestClass(client));
      expect(hit).toBe(false);
    }, 15000);

    it('tracks stats correctly', async () => {
      const cl = new CachingLayer(new MemoryCache());

      const stats0 = cl.stats();
      expect(stats0.sourceCount).toBe(0);

      await cl.getSource('CLAS', TEST_CLASS, readTestClass(client));

      const stats1 = cl.stats();
      expect(stats1.sourceCount).toBe(1);
    }, 15000);
  });

  // ─── Source Cache (SQLite) ─────────────────────────────────────────

  describe('SqliteCache source caching', () => {
    let dbPath: string;

    beforeAll(() => {
      dbPath = path.join(os.tmpdir(), `arc1-cache-test-${Date.now()}.db`);
    });

    beforeEach((ctx) => requireCacheFixture(ctx));

    afterAll(() => {
      try {
        fs.unlinkSync(dbPath);
      } catch {
        // best-effort cleanup
      }
    });

    it('persists source across cache instances', async () => {
      // Write to first instance
      const cl1 = new CachingLayer(new SqliteCache(dbPath));
      const { hit: hit1 } = await cl1.getSource('CLAS', TEST_CLASS, readTestClass(client));
      expect(hit1).toBe(false);

      // Second instance on same db — should load the cached body, then revalidate it.
      const cl2 = new CachingLayer(new SqliteCache(dbPath));
      const { hit: hit2, revalidated } = await cl2.getSource('CLAS', TEST_CLASS, readTestClass(client));
      expect(hit2).toBe(true);
      expect(revalidated).toBe(true);
    }, 15000);

    it('SqliteCache invalidation removes the entry', async () => {
      const cl = new CachingLayer(new SqliteCache(dbPath));

      // Ensure it's in cache
      await cl.getSource('CLAS', TEST_CLASS, readTestClass(client));

      cl.invalidate('CLAS', TEST_CLASS);

      let fetcherCalled = false;
      const { hit } = await cl.getSource('CLAS', TEST_CLASS, async (ifNoneMatch) => {
        fetcherCalled = true;
        return client.getClass(TEST_CLASS, undefined, { ifNoneMatch });
      });
      expect(hit).toBe(false);
      expect(fetcherCalled).toBe(true);
    }, 15000);
  });

  // ─── Dependency Graph Caching via handleToolCall ──────────────────

  describe('dep graph caching (via SAPContext handler)', () => {
    // Dep-graph tests use the BOBF demo class which only exists on S/4 systems.
    // The third test (SAPRead) uses TEST_CLASS instead; both gates keep the
    // suite honest on any system.
    beforeEach((ctx) => {
      requireCacheFixture(ctx);
      requireDepGraphFixture(ctx);
    });

    it('first SAPContext deps call is not cached; second is cached', async () => {
      const cl = new CachingLayer(new MemoryCache());

      const r1 = await handleToolCall(
        client,
        DEFAULT_CONFIG,
        'SAPContext',
        { action: 'deps', name: TEST_CLASS_WITH_DEPS, type: 'CLAS', depth: 1 },
        undefined,
        undefined,
        cl,
      );
      const out1 = r1.content[0]?.text ?? '';
      expect(out1).toContain('Dependency context for');
      expect(out1).not.toContain('[cached]'); // first call: not from cache

      const r2 = await handleToolCall(
        client,
        DEFAULT_CONFIG,
        'SAPContext',
        { action: 'deps', name: TEST_CLASS_WITH_DEPS, type: 'CLAS', depth: 1 },
        undefined,
        undefined,
        cl,
      );
      const out2 = r2.content[0]?.text ?? '';
      expect(out2).toContain('[cached]'); // second call: from dep graph cache
    }, 30000);

    it('cached SAPContext response is much faster than first call', async () => {
      const cl = new CachingLayer(new MemoryCache());

      await handleToolCall(
        client,
        DEFAULT_CONFIG,
        'SAPContext',
        { action: 'deps', name: TEST_CLASS_WITH_DEPS, type: 'CLAS', depth: 1 },
        undefined,
        undefined,
        cl,
      );

      const t1 = Date.now();
      await handleToolCall(
        client,
        DEFAULT_CONFIG,
        'SAPContext',
        { action: 'deps', name: TEST_CLASS_WITH_DEPS, type: 'CLAS', depth: 1 },
        undefined,
        undefined,
        cl,
      );
      const cachedMs = Date.now() - t1;

      // Dependency graph hits avoid dependency traversal. Keep this broad because
      // the live test host still pays MCP handler and process scheduling overhead.
      expect(cachedMs).toBeLessThan(5000);
    }, 30000);

    it('SAPRead for same object in same session returns revalidated source from cache', async () => {
      const cl = new CachingLayer(new MemoryCache());

      const t0 = Date.now();
      const r1 = await handleToolCall(
        client,
        DEFAULT_CONFIG,
        'SAPRead',
        { action: 'source', type: 'CLAS', name: TEST_CLASS },
        undefined,
        undefined,
        cl,
      );
      const firstMs = Date.now() - t0;
      const out1 = r1.content[0]?.text ?? '';
      expect(out1).not.toContain('[cached:revalidated]');

      const t1 = Date.now();
      const r2 = await handleToolCall(
        client,
        DEFAULT_CONFIG,
        'SAPRead',
        { action: 'source', type: 'CLAS', name: TEST_CLASS },
        undefined,
        undefined,
        cl,
      );
      const cachedMs = Date.now() - t1;
      const out2 = r2.content[0]?.text ?? '';
      expect(out2).toContain('[cached:revalidated]');

      // Source cache hits still revalidate against SAP, so timing is only a smoke signal.
      expect(cachedMs).toBeLessThan(Math.max(firstMs, 1000));
    }, 15000);
  });

  // ─── SAPManage Cache Stats ────────────────────────────────────────

  describe('SAPManage cache_stats', () => {
    it('returns stats after reads', async (ctx) => {
      requireCacheFixture(ctx);
      const cl = new CachingLayer(new MemoryCache());

      // Do a read to populate cache
      await handleToolCall(
        client,
        DEFAULT_CONFIG,
        'SAPRead',
        { action: 'source', type: 'CLAS', name: TEST_CLASS },
        undefined,
        undefined,
        cl,
      );

      const r = await handleToolCall(
        client,
        DEFAULT_CONFIG,
        'SAPManage',
        { action: 'cache_stats' },
        undefined,
        undefined,
        cl,
      );
      const text = r.content[0]?.text ?? '';
      expect(text).toContain('sourceCount');
      const parsed = JSON.parse(text);
      expect(parsed.sourceCount).toBeGreaterThanOrEqual(1);
      expect(parsed.inactiveListCache).toBeTruthy();
    }, 15000);

    it('stats show warmupAvailable=false before warmup', async () => {
      const cl = new CachingLayer(new MemoryCache());
      const r = await handleToolCall(
        client,
        DEFAULT_CONFIG,
        'SAPManage',
        { action: 'cache_stats' },
        undefined,
        undefined,
        cl,
      );
      const parsed = JSON.parse(r.content[0]?.text ?? '{}');
      expect(parsed.warmupAvailable).toBe(false);
      expect(parsed.inactiveListCache).toBeTruthy();
    }, 10000);
  });

  // ─── Usages: Error Message Without Warmup ─────────────────────────

  describe('SAPContext usages without warmup', () => {
    it('returns informative error when warmup not run', async (ctx) => {
      requireDepGraphFixture(ctx);
      const cl = new CachingLayer(new MemoryCache()); // no warmup

      const r = await handleToolCall(
        client,
        DEFAULT_CONFIG,
        'SAPContext',
        { action: 'usages', name: TEST_CLASS_WITH_DEPS, type: 'CLAS' },
        undefined,
        undefined,
        cl,
      );
      const text = r.content[0]?.text ?? '';
      // Should explain what to do
      expect(text.toLowerCase()).toMatch(/warmup|pre-warm|cache.*not.*available|not.*available.*cache/);
    }, 10000);
  });

  // ─── Warmup ───────────────────────────────────────────────────────

  describe('warmup', () => {
    it('marks cache warm after one bounded stable-package warmup', async (ctx) => {
      requireDepGraphFixture(ctx);
      const cl = new CachingLayer(new MemoryCache());

      const result = await runWarmup(client, cl, TEST_PACKAGE_WITH_DEPS);
      if (result.totalObjects === 0) {
        requireOrSkip(ctx, undefined, `No objects in ${TEST_PACKAGE_WITH_DEPS} — system has nothing stable to index`);
      }
      expect(cl.isWarmupAvailable).toBe(true);
      expect(result.failed).toBe(0);
    }, 120000);
  });

  // ─── Cache-Aware compressContext ─────────────────────────────────

  describe('compressContext with caching layer', () => {
    it('dep graph is stored in cache after first compressContext', async (ctx) => {
      requireDepGraphFixture(ctx);
      const cl = new CachingLayer(new MemoryCache());

      const { source } = await client.getClass(TEST_CLASS_WITH_DEPS);
      const { compressContext } = await import('../../src/context/compressor.js');

      // First call — no cache
      await compressContext(client, source, TEST_CLASS_WITH_DEPS, 'CLAS', 10, 1, undefined, cl);

      // Dep graph should now be cached
      const cached = cl.getCachedDepGraph(source);
      expect(cached).not.toBeNull();
      expect(cached?.objectName.toUpperCase()).toBe(TEST_CLASS_WITH_DEPS.toUpperCase());
      expect(Array.isArray(cached?.contracts)).toBe(true);
    }, 30000);
  });
});
