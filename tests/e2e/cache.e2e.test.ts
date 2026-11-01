/**
 * E2E cache tests — verify caching behavior through the live MCP server.
 *
 * The e2e server runs with ARC1_CACHE=memory (no SQLite needed in CI).
 * These tests verify:
 *  - SAPManage cache_stats returns valid structure
 *  - Repeated SAPRead calls for an ETag-capable fixture use conditional GET revalidation
 *  - SAPContext(deps) rebuilds valid context on every call; no aggregate-cache marker
 *  - SAPContext(usages) performs a live lookup without cache preloading
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callTool, connectClient, expectToolSuccess } from './helpers.js';

function stripCachedMarker(text: string): string {
  return text.replace(/^\[cached(?::revalidated)?\]\n/, '');
}

describe('E2E Cache Tests', () => {
  let client: Client;

  beforeAll(async () => {
    client = await connectClient();
  });

  afterAll(async () => {
    try {
      await client?.close();
    } catch {
      // Ignore close errors
    }
  });

  // ── SAPManage cache_stats ─────────────────────────────────────

  it('SAPManage cache_stats — returns valid cache statistics', async () => {
    const result = await callTool(client, 'SAPManage', { action: 'cache_stats' });
    const text = expectToolSuccess(result);
    const stats = JSON.parse(text);

    // Required fields
    expect(stats).toHaveProperty('sourceCount');
    expect(stats).toHaveProperty('contractCount');
    expect(stats).toHaveProperty('apiCount');
    expect(stats).toHaveProperty('inactiveListCache');

    // All counts are non-negative integers
    expect(typeof stats.sourceCount).toBe('number');
    expect(stats.sourceCount).toBeGreaterThanOrEqual(0);
    expect(typeof stats.contractCount).toBe('number');
    expect(stats.contractCount).toBeGreaterThanOrEqual(0);

    expect(stats).not.toHaveProperty('warmupAvailable');
    expect(stats).not.toHaveProperty('nodeCount');
    expect(stats).not.toHaveProperty('edgeCount');

    console.log(`    Cache stats: ${JSON.stringify(stats)}`);
  });

  // ── SAPRead cache hit ─────────────────────────────────────────

  it('SAPRead — second call for same object is served from cache', async () => {
    const args = { type: 'PROG', name: 'ZARC1_TEST_REPORT' };

    // First call — force-refreshes any cache state left by earlier E2E files.
    const t0 = Date.now();
    const r1 = await callTool(client, 'SAPRead', { ...args, force_refresh: true });
    const firstMs = Date.now() - t0;
    const text1 = expectToolSuccess(r1);
    const normalizedText1 = stripCachedMarker(text1);
    expect(normalizedText1.length).toBeGreaterThan(0);

    // Second call — should revalidate the memory cache via If-None-Match/304.
    const t1 = Date.now();
    const r2 = await callTool(client, 'SAPRead', args);
    const cachedMs = Date.now() - t1;
    const text2 = expectToolSuccess(r2);

    // Source cache hits prepend "[cached:revalidated]" after the server returns 304.
    expect(text2).toContain('[cached:revalidated]');
    const normalizedCachedText = stripCachedMarker(text2);
    expect(normalizedCachedText).toBe(normalizedText1);

    // Revalidation still performs one SAP roundtrip, so timing is only a broad smoke signal.
    expect(cachedMs).toBeLessThan(5000);

    console.log(`    SAPRead first: ${firstMs}ms, cached: ${cachedMs}ms`);
  });

  it('SAPRead cache_stats — sourceCount increases after reads', async () => {
    // Read a known object
    await callTool(client, 'SAPRead', { type: 'PROG', name: 'RSHOWTIM' });

    const result = await callTool(client, 'SAPManage', { action: 'cache_stats' });
    const text = expectToolSuccess(result);
    const stats = JSON.parse(text);

    // After reading, sourceCount must be at least 1
    expect(stats.sourceCount).toBeGreaterThanOrEqual(1);
  });

  it('SAPRead INACTIVE_OBJECTS — returns a valid inactive object list', async () => {
    const result = await callTool(client, 'SAPRead', { type: 'INACTIVE_OBJECTS' });
    const text = expectToolSuccess(result);
    const parsed = JSON.parse(text);

    expect(typeof parsed.count).toBe('number');
    expect(Array.isArray(parsed.objects)).toBe(true);
    expect(parsed.count).toBe(parsed.objects.length);

    if (parsed.objects.length > 0) {
      const first = parsed.objects[0];
      expect(typeof first.name).toBe('string');
      expect(typeof first.type).toBe('string');
      expect(typeof first.uri).toBe('string');
    }
  });

  it('SAPRead version=auto — returns the active source when no draft exists', async () => {
    const args = { type: 'CLAS', name: 'CL_ABAP_CHAR_UTILITIES' };

    const active = expectToolSuccess(await callTool(client, 'SAPRead', { ...args, version: 'active' }));
    const auto = expectToolSuccess(await callTool(client, 'SAPRead', { ...args, version: 'auto' }));

    expect(stripCachedMarker(auto)).toBe(stripCachedMarker(active));
  });

  it('SAPRead version=inactive — reports active fallback when no draft exists', async () => {
    const text = expectToolSuccess(
      await callTool(client, 'SAPRead', { type: 'CLAS', name: 'CL_ABAP_CHAR_UTILITIES', version: 'inactive' }),
    );

    expect(text).toContain('No inactive draft exists');
    expect(text).toContain('CL_ABAP_CHAR_UTILITIES');
  });

  // ── Fresh SAPContext dependency results ───────────────────────

  it('SAPContext deps — repeated calls return fresh context without aggregate-cache markers', async () => {
    // Use RSHOWTIM (a standard program guaranteed to exist on any SAP system).
    // Even an empty dependency graph is rebuilt; normal source caching still revalidates with SAP.
    const args = { action: 'deps', type: 'PROG', name: 'RSHOWTIM', depth: 1 };

    const r1 = await callTool(client, 'SAPContext', args);
    const out1 = expectToolSuccess(r1);
    expect(out1).toContain('Dependency context for RSHOWTIM');
    expect(out1).not.toContain('[cached]');

    // Repeat through MCP; no aggregate shortcut or cache-hit latency promise.
    const r2 = await callTool(client, 'SAPContext', args);
    const out2 = expectToolSuccess(r2);

    expect(out2).toContain('Dependency context for RSHOWTIM');
    expect(out2).not.toContain('[cached]');
  });

  it('SAPContext deps — fresh output keeps the requested object identity', async () => {
    const args = { action: 'deps', type: 'CLAS', name: 'CL_ABAP_CHAR_UTILITIES', depth: 1 };

    const r1 = await callTool(client, 'SAPContext', args);
    const out1 = expectToolSuccess(r1);

    const r2 = await callTool(client, 'SAPContext', args);
    const out2 = expectToolSuccess(r2);

    // Both should mention the object name
    expect(out1).toContain('CL_ABAP_CHAR_UTILITIES');
    expect(out2).toContain('CL_ABAP_CHAR_UTILITIES');
    expect(out1).toContain('Dependency context for');
    expect(out2).toContain('Dependency context for');
    expect(out1).not.toContain('[cached]');
    expect(out2).not.toContain('[cached]');
  });

  // ── SAPContext usages — live SAP lookup ──────────────────────

  it('SAPContext usages — works without cache preloading', async () => {
    const result = await callTool(client, 'SAPContext', {
      action: 'usages',
      type: 'CLAS',
      name: 'ZCL_ARC1_TEST',
    });

    const parsed = JSON.parse(expectToolSuccess(result));
    expect(parsed.source).toBe('live');
    expect(parsed.resolvedObject).toMatchObject({ type: 'CLAS', name: 'ZCL_ARC1_TEST' });
    expect(parsed.usages).toBeInstanceOf(Array);
    // usageCount is the TOTAL match count, not the page size — it only equals usages.length when
    // the result was not truncated. `shown` is the page length.
    expect(parsed.shown).toBe(parsed.usages.length);
    expect(parsed.usageCount).toBeGreaterThanOrEqual(parsed.usages.length);
    if (!parsed.truncated) expect(parsed.usageCount).toBe(parsed.usages.length);
  });
});
