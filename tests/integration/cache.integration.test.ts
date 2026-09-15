/**
 * Integration tests for the object caching layer.
 *
 * These tests run against a live SAP system.
 * Missing credentials are treated as setup errors and fail the suite.
 *
 * What is tested:
 * - Source cache miss/revalidation/invalidation (MemoryCache and SqliteCache)
 * - Fresh dependency context on repeated calls, with ETag-revalidated source caching
 * - Cache stats reporting via SAPManage
 * - Live usages lookup without cache configuration
 * - SQLite cache persistence across instances
 *
 * Run: npm run test:integration
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdtClient } from '../../src/adt/client.js';
import { CachingLayer } from '../../src/cache/caching-layer.js';
import { MemoryCache } from '../../src/cache/memory.js';
import { SqliteCache } from '../../src/cache/sqlite.js';
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

function readTestClass(client: AdtClient) {
  return (ifNoneMatch?: string) => client.getClass(TEST_CLASS, undefined, { ifNoneMatch });
}

describe('Cache Integration Tests', () => {
  let client: AdtClient;
  let hasTestClass = false;
  let hasTestClassWithDeps = false;
  afterEach(() => vi.restoreAllMocks());

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
  function requireCacheFixture(ctx: import('vitest').TestContext): void {
    if (!hasTestClass) {
      requireOrSkip(ctx, undefined, `${SkipReason.NO_FIXTURE} (${TEST_CLASS}) — run npm run test:e2e once to seed`);
    }
  }

  /** Gate a test on the dep-graph fixture (S/4 BOBF demo) being present. */
  function requireDepGraphFixture(ctx: import('vitest').TestContext): void {
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

  // ─── Fresh Dependency Context via handleToolCall ──────────────────

  describe('fresh dependency context (via SAPContext handler)', () => {
    // Dep-graph tests use the BOBF demo class which only exists on S/4 systems.
    // The third test (SAPRead) uses TEST_CLASS instead; both gates keep the
    // suite honest on any system.
    beforeEach((ctx) => {
      requireCacheFixture(ctx);
      requireDepGraphFixture(ctx);
    });

    it('rebuilds dependency context on both cold and warm calls without aggregate cache reads/writes', async () => {
      const cl = new CachingLayer(new MemoryCache());
      expect(cl).not.toHaveProperty('getCachedDepGraph');
      expect(cl).not.toHaveProperty('putDepGraph');

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
      expect(r1.isError).toBeUndefined();
      expect(out1).toContain('Dependency context for');
      expect(out1).not.toContain('[cached]');

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
      expect(r2.isError).toBeUndefined();
      expect(out2).toContain(`Dependency context for ${TEST_CLASS_WITH_DEPS}`);
      expect(out2).not.toContain('[cached]');
      expect(cl.stats().contractCount).toBe(0);
    }, 30000);

    it('revalidates dependency sources with SAP on a warm context call', async () => {
      const cl = new CachingLayer(new MemoryCache());
      const sourceReads = vi.spyOn(cl, 'getSource');
      const httpReads = vi.spyOn(client.http, 'get');

      const first = await handleToolCall(
        client,
        DEFAULT_CONFIG,
        'SAPContext',
        { action: 'deps', name: TEST_CLASS_WITH_DEPS, type: 'CLAS', depth: 1 },
        undefined,
        undefined,
        cl,
      );
      expect(first.isError).toBeUndefined();
      const coldObjects = sourceReads.mock.calls.map(([type, name]) => `${type}:${name}`).sort();
      expect(coldObjects.length).toBeGreaterThan(0);
      sourceReads.mockClear();
      httpReads.mockClear();
      const second = await handleToolCall(
        client,
        DEFAULT_CONFIG,
        'SAPContext',
        { action: 'deps', name: TEST_CLASS_WITH_DEPS, type: 'CLAS', depth: 1 },
        undefined,
        undefined,
        cl,
      );
      expect(second.isError).toBeUndefined();
      expect(sourceReads.mock.calls.map(([type, name]) => `${type}:${name}`).sort()).toEqual(coldObjects);
      expect(httpReads.mock.calls.some(([, headers]) => Boolean(headers?.['If-None-Match']))).toBe(true);
      // Missing/inaccessible dependencies are represented separately by SAPContext; inspect
      // fulfilled source reads without turning their expected sibling errors into test failures.
      const responses = await Promise.allSettled(httpReads.mock.results.map((result) => result.value));
      expect(
        responses.some(
          (response) =>
            response.status === 'fulfilled' && response.value.statusCode === 304 && response.value.body === '',
        ),
      ).toBe(true);
    }, 30000);

    it('SAPRead for same object in same session returns revalidated source from cache', async () => {
      const cl = new CachingLayer(new MemoryCache());

      const t0 = Date.now();
      const r1 = await handleToolCall(
        client,
        DEFAULT_CONFIG,
        'SAPRead',
        { type: 'CLAS', name: TEST_CLASS },
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
        { type: 'CLAS', name: TEST_CLASS },
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
        { type: 'CLAS', name: TEST_CLASS },
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

    it('stats omit retired repository graph state', async () => {
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
      expect(parsed).not.toHaveProperty('warmupAvailable');
      expect(parsed).not.toHaveProperty('nodeCount');
      expect(parsed).not.toHaveProperty('edgeCount');
      expect(parsed.inactiveListCache).toBeTruthy();
    }, 10000);
  });

  // ─── Live Usages ──────────────────────────────────────────────────

  describe('SAPContext live usages', () => {
    it('works without cache configuration', async (ctx) => {
      requireDepGraphFixture(ctx);

      const r = await handleToolCall(
        client,
        DEFAULT_CONFIG,
        'SAPContext',
        { action: 'usages', name: TEST_CLASS_WITH_DEPS, type: 'CLAS' },
        undefined,
        undefined,
      );
      expect(r.isError).toBeUndefined();
      const payload = JSON.parse(r.content[0]?.text ?? '{}');
      expect(payload).toMatchObject({ name: TEST_CLASS_WITH_DEPS, source: 'live' });
      expect(Array.isArray(payload.usages)).toBe(true);
    }, 10000);
  });

  // ─── Cache-Aware compressContext ─────────────────────────────────

  describe('compressContext with caching layer', () => {
    it('stores revalidatable dependency sources but no aggregate graph after compressContext', async (ctx) => {
      requireDepGraphFixture(ctx);
      const cl = new CachingLayer(new MemoryCache());

      const { source } = await client.getClass(TEST_CLASS_WITH_DEPS);
      const { compressContext } = await import('../../src/context/compressor.js');

      const result = await compressContext(client, source, TEST_CLASS_WITH_DEPS, 'CLAS', 10, 1, undefined, cl);
      expect(result.objectName).toBe(TEST_CLASS_WITH_DEPS);
      expect(result.depsResolved).toBeGreaterThan(0);
      expect(cl.stats().sourceCount).toBeGreaterThan(0);
      expect(cl.stats().contractCount).toBe(0);
    }, 30000);
  });
});
