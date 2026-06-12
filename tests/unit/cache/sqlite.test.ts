import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CachedDepGraph, CacheNode } from '../../../src/cache/cache.js';
import { hashSource } from '../../../src/cache/cache.js';
import { SqliteCache } from '../../../src/cache/sqlite.js';

function makeNode(id: string, pkg = '$TMP'): CacheNode {
  return {
    id,
    objectType: 'CLAS',
    objectName: id,
    packageName: pkg,
    cachedAt: new Date().toISOString(),
    valid: true,
  };
}

describe('SqliteCache', () => {
  let cache: SqliteCache;

  beforeEach(() => {
    // Use in-memory SQLite for tests (no file cleanup needed)
    cache = new SqliteCache(':memory:');
  });

  afterEach(() => {
    cache.close();
  });

  it('stores and retrieves a node', () => {
    cache.putNode(makeNode('ZCL_TEST'));
    const node = cache.getNode('ZCL_TEST');
    expect(node).not.toBeNull();
    expect(node?.objectName).toBe('ZCL_TEST');
    expect(node?.valid).toBe(true);
  });

  it('returns null for missing node', () => {
    expect(cache.getNode('MISSING')).toBeNull();
  });

  it('finds nodes by package (case-insensitive)', () => {
    cache.putNode(makeNode('A', '$TMP'));
    cache.putNode(makeNode('B', '$tmp'));
    cache.putNode(makeNode('C', 'ZOTHER'));
    const nodes = cache.getNodesByPackage('$TMP');
    expect(nodes).toHaveLength(2);
  });

  it('invalidates a node', () => {
    cache.putNode(makeNode('ZCL_TEST'));
    cache.invalidateNode('ZCL_TEST');
    const node = cache.getNode('ZCL_TEST');
    expect(node?.valid).toBe(false);
  });

  it('stores and retrieves edges', () => {
    cache.putEdge({
      fromId: 'A',
      toId: 'B',
      edgeType: 'CALLS',
      discoveredAt: new Date().toISOString(),
      valid: true,
    });
    const edges = cache.getEdgesFrom('A');
    expect(edges).toHaveLength(1);
    expect(edges[0]?.toId).toBe('B');
  });

  it('stores and retrieves API objects', () => {
    cache.putApi({
      name: 'CL_ABAP_REGEX',
      type: 'CLAS',
      releaseState: 'released',
      cleanCoreLevel: 'A',
    });
    const api = cache.getApi('CL_ABAP_REGEX', 'CLAS');
    expect(api).not.toBeNull();
    expect(api?.cleanCoreLevel).toBe('A');
  });

  it('clears all data', () => {
    cache.putNode(makeNode('A'));
    cache.putApi({ name: 'X', type: 'CLAS', releaseState: 'released' });
    cache.clear();
    expect(cache.stats().nodeCount).toBe(0);
    expect(cache.stats().apiCount).toBe(0);
  });

  it('returns correct stats', () => {
    cache.putNode(makeNode('A'));
    cache.putNode(makeNode('B'));
    cache.putEdge({ fromId: 'A', toId: 'B', edgeType: 'USES', discoveredAt: '', valid: true });
    const stats = cache.stats();
    expect(stats.nodeCount).toBe(2);
    expect(stats.edgeCount).toBe(1);
  });

  it('stores metadata as JSON', () => {
    cache.putNode({ ...makeNode('A'), metadata: { foo: 'bar', count: 42 } });
    const node = cache.getNode('A');
    expect(node?.metadata).toEqual({ foo: 'bar', count: 42 });
  });

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

  it('migrates an old sources table by dropping and recreating', () => {
    const dbPath = path.join(os.tmpdir(), `arc1-migrate-test-${Date.now()}.db`);
    const rawDb = new Database(dbPath);
    rawDb.exec(
      'CREATE TABLE sources (cache_key TEXT PRIMARY KEY, object_type TEXT, object_name TEXT, source TEXT, hash TEXT, cached_at TEXT);',
    );
    rawDb
      .prepare('INSERT INTO sources VALUES (?, ?, ?, ?, ?, ?)')
      .run('PROG:Z_OLD', 'PROG', 'Z_OLD', 'REPORT.', 'h1', '2025-01-01');
    rawDb.close();

    const migrated = new SqliteCache(dbPath);
    const cols = (migrated as unknown as { db: Database.Database }).db
      .prepare("PRAGMA table_info('sources')")
      .all()
      .map((c) => (c as { name: string }).name);
    expect(cols).toContain('etag');
    expect(cols).toContain('version');
    expect(migrated.getSource('PROG', 'Z_OLD')).toBeNull();
    migrated.close();
    fs.unlinkSync(dbPath);
  });

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

  it('stores and retrieves function group mapping', () => {
    cache.putFuncGroup('Z_MY_FUNC', 'Z_MY_GROUP');
    expect(cache.getFuncGroup('Z_MY_FUNC')).toBe('Z_MY_GROUP');
  });

  it('returns null for missing function group', () => {
    expect(cache.getFuncGroup('MISSING_FUNC')).toBeNull();
  });

  it('resolves function groups case-insensitively', () => {
    cache.putFuncGroup('z_my_func', 'z_my_group');
    expect(cache.getFuncGroup('Z_MY_FUNC')).toBe('Z_MY_GROUP');
  });

  it('retrieves reverse edges with getEdgesTo', () => {
    cache.putEdge({ fromId: 'A', toId: 'C', edgeType: 'CALLS', discoveredAt: '', valid: true });
    cache.putEdge({ fromId: 'B', toId: 'C', edgeType: 'USES', discoveredAt: '', valid: true });
    cache.putEdge({ fromId: 'A', toId: 'D', edgeType: 'CALLS', discoveredAt: '', valid: true });

    const edges = cache.getEdgesTo('C');
    expect(edges).toHaveLength(2);
    expect(edges.map((e) => e.fromId).sort()).toEqual(['A', 'B']);
  });

  it('returns empty array for no reverse edges', () => {
    expect(cache.getEdgesTo('MISSING')).toEqual([]);
  });

  it('returns correct stats including sourceCount and contractCount', () => {
    cache.putNode(makeNode('A'));
    cache.putNode(makeNode('B'));
    cache.putEdge({ fromId: 'A', toId: 'B', edgeType: 'USES', discoveredAt: '', valid: true });
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
    expect(stats.nodeCount).toBe(2);
    expect(stats.edgeCount).toBe(1);
    expect(stats.sourceCount).toBe(2);
    expect(stats.contractCount).toBe(1);
  });

  it('rolls back transaction writes when the callback throws', () => {
    expect(() =>
      cache.transaction(() => {
        cache.putNode(makeNode('ROLLBACK'));
        throw new Error('boom');
      }),
    ).toThrow('boom');

    expect(cache.getNode('ROLLBACK')).toBeNull();
  });

  it('clears all data including sources, dep graphs, and func groups', () => {
    cache.putNode(makeNode('A'));
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

    expect(cache.stats().nodeCount).toBe(0);
    expect(cache.stats().apiCount).toBe(0);
    expect(cache.stats().sourceCount).toBe(0);
    expect(cache.stats().contractCount).toBe(0);
    expect(cache.getSource('CLAS', 'ZCL_A')).toBeNull();
    expect(cache.getFuncGroup('Z_FUNC')).toBeNull();
  });
});
