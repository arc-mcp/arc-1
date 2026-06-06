/**
 * Slow integration tests for cache warmup and warmup-backed usages.
 *
 * These tests intentionally run broad TADIR enumeration and repeated warmup
 * passes. Keep them out of the default PR path.
 *
 * Run: npm run test:integration:slow
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { AdtClient } from '../../src/adt/client.js';
import { CachingLayer } from '../../src/cache/caching-layer.js';
import { MemoryCache } from '../../src/cache/memory.js';
import { runWarmup } from '../../src/cache/warmup.js';
import { handleToolCall } from '../../src/handlers/intent.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import { requireOrSkip } from '../helpers/skip-policy.js';
import { getTestClient, requireSapCredentials } from './helpers.js';

const TEST_CLASS_WITH_DEPS = 'ZCL_DEMO_D_CALC_AMOUNT';
const TEST_PACKAGE_WITH_DEPS = '$DEMO_SOI_DRAFT';

describe('Cache Warmup Slow Integration Tests', () => {
  let client: AdtClient;
  let hasTestClassWithDeps = false;

  beforeAll(async () => {
    requireSapCredentials();
    client = getTestClient();
    try {
      await client.getClass(TEST_CLASS_WITH_DEPS);
      hasTestClassWithDeps = true;
    } catch {
      hasTestClassWithDeps = false;
    }
  });

  function requireDepGraphFixture(ctx: import('vitest').TaskContext): void {
    if (!hasTestClassWithDeps) {
      requireOrSkip(ctx, undefined, `NO_FIXTURE (${TEST_CLASS_WITH_DEPS}) — S/4 BOBF demo not on this system`);
    }
  }

  it('TADIR query returns custom CLAS/INTF objects (Z prefix)', async (ctx) => {
    const cl = new CachingLayer(new MemoryCache());
    const result = await runWarmup(client, cl, 'Z*,Y*,$DEMO_SOI_DRAFT,$TMP');
    // A fresh SAP system may have zero custom objects — that's a valid state,
    // not a product bug. Skip rather than pretend warmup is broken.
    if (result.totalObjects === 0) {
      requireOrSkip(ctx, undefined, 'No custom CLAS/INTF found — system has no Z*/Y* or $DEMO_SOI_DRAFT/$TMP objects');
    }
    expect(result.totalObjects).toBeGreaterThan(0);
  }, 60000);

  it('warmup indexes objects into cache (nodes + sources)', async (ctx) => {
    const cl = new CachingLayer(new MemoryCache());
    const result = await runWarmup(client, cl, '$DEMO_SOI_DRAFT,$TMP');

    if (result.totalObjects === 0) {
      requireOrSkip(ctx, undefined, 'No objects in $DEMO_SOI_DRAFT/$TMP — system has nothing to index');
    }
    const stats = cl.stats();
    expect(result.fetched).toBeGreaterThan(0);
    expect(stats.sourceCount).toBeGreaterThan(0);
    expect(stats.nodeCount).toBeGreaterThan(0);
  }, 60000);

  it('warmup sets isWarmupAvailable flag', async () => {
    const cl = new CachingLayer(new MemoryCache());
    expect(cl.isWarmupAvailable).toBe(false);

    await runWarmup(client, cl, '$TMP');
    expect(cl.isWarmupAvailable).toBe(true);
  }, 60000);

  it('second warmup run skips unchanged objects (delta by hash)', async (ctx) => {
    requireDepGraphFixture(ctx);
    const cl = new CachingLayer(new MemoryCache());

    const run1 = await runWarmup(client, cl, TEST_PACKAGE_WITH_DEPS);
    if (run1.totalObjects === 0) {
      requireOrSkip(ctx, undefined, `No objects in ${TEST_PACKAGE_WITH_DEPS} — system has nothing stable to index`);
    }
    expect(run1.fetched).toBeGreaterThan(0);
    expect(run1.failed).toBe(0);

    // Second run uses the stable demo package rather than $TMP, which can
    // change underneath CI when other live-SAP tests create transient objects.
    const run2 = await runWarmup(client, cl, TEST_PACKAGE_WITH_DEPS);
    expect(run2.totalObjects).toBe(run1.totalObjects);
    expect(run2.failed).toBe(0);
    expect(run2.skipped).toBe(run1.fetched + run1.skipped);
    expect(run2.fetched).toBe(0);
  }, 120000);

  it('usages returns reverse deps after warmup', async (ctx) => {
    requireDepGraphFixture(ctx);
    const cl = new CachingLayer(new MemoryCache());
    await runWarmup(client, cl, TEST_PACKAGE_WITH_DEPS);

    cl.setWarmupDone(true);

    // After indexing the demo package, getUsages should return edges or empty array (not null).
    const usages = cl.getUsages(TEST_CLASS_WITH_DEPS);
    expect(usages).not.toBeNull();
    expect(Array.isArray(usages)).toBe(true);
  }, 120000);

  it('SAPContext usages action returns result after warmup', async (ctx) => {
    requireDepGraphFixture(ctx);
    const cl = new CachingLayer(new MemoryCache());
    await runWarmup(client, cl, TEST_PACKAGE_WITH_DEPS);

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
    expect(text.toLowerCase()).not.toMatch(/warmup.*not.*available|cache.*not.*available/);
    expect(text).toContain(TEST_CLASS_WITH_DEPS.toUpperCase());
  }, 120000);
});
