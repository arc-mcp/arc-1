/**
 * SQLite cache implementation using better-sqlite3.
 *
 * Persistent cache — survives process restarts.
 * Default backend for http-streamable transport and Docker deployments.
 * Uses WAL mode for concurrent read performance.
 * better-sqlite3 is synchronous, which is actually faster than async
 * alternatives for single-process use (no Promise overhead).
 */

import Database from 'better-sqlite3';
import type { Cache, CacheApi, CachedDepGraph, CachedSource, CacheEdge, CacheNode, CacheStats } from './cache.js';
import { hashSource, sourceKey } from './cache.js';

export class SqliteCache implements Cache {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.dropOldSourcesTableIfNeeded();
    this.createTables();
  }

  private dropOldSourcesTableIfNeeded(): void {
    const cols = this.db.prepare("PRAGMA table_info('sources')").all() as Array<{ name: string }>;
    if (cols.length === 0) return;
    const hasEtag = cols.some((c) => c.name === 'etag');
    const hasVersion = cols.some((c) => c.name === 'version');
    if (!hasEtag || !hasVersion) {
      this.db.exec('DROP TABLE IF EXISTS sources;');
    }
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        object_type TEXT NOT NULL,
        object_name TEXT NOT NULL,
        package_name TEXT NOT NULL,
        source_hash TEXT,
        cached_at TEXT NOT NULL,
        valid INTEGER NOT NULL DEFAULT 1,
        metadata TEXT
      );

      CREATE TABLE IF NOT EXISTS edges (
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        edge_type TEXT NOT NULL,
        source TEXT,
        discovered_at TEXT NOT NULL,
        valid INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (from_id, to_id, edge_type)
      );

      CREATE TABLE IF NOT EXISTS apis (
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        release_state TEXT NOT NULL,
        clean_core_level TEXT,
        application_component TEXT,
        PRIMARY KEY (type, name)
      );

      CREATE TABLE IF NOT EXISTS sources (
        cache_key TEXT PRIMARY KEY,
        object_type TEXT NOT NULL,
        object_name TEXT NOT NULL,
        version TEXT NOT NULL DEFAULT 'active',
        source TEXT NOT NULL,
        hash TEXT NOT NULL,
        etag TEXT,
        cached_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS dep_graphs (
        source_hash TEXT PRIMARY KEY,
        object_name TEXT NOT NULL,
        object_type TEXT NOT NULL,
        contracts TEXT NOT NULL,
        cached_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS func_groups (
        func_name TEXT PRIMARY KEY,
        group_name TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_nodes_package ON nodes(package_name);
      CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_id);
      CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_id);
      CREATE INDEX IF NOT EXISTS idx_sources_hash ON sources(hash);
      CREATE INDEX IF NOT EXISTS idx_sources_objname_version ON sources(object_name, object_type, version);
    `);
  }

  // ─── Node Operations ──────────────────────────────────────────────

  putNode(node: CacheNode): void {
    const stmt = this.db.prepare(
      'INSERT OR REPLACE INTO nodes (id, object_type, object_name, package_name, source_hash, cached_at, valid, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    stmt.run(
      node.id,
      node.objectType,
      node.objectName,
      node.packageName,
      node.sourceHash ?? null,
      node.cachedAt,
      node.valid ? 1 : 0,
      node.metadata ? JSON.stringify(node.metadata) : null,
    );
  }

  getNode(id: string): CacheNode | null {
    const row = this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return rowToNode(row);
  }

  getNodesByPackage(packageName: string): CacheNode[] {
    const rows = this.db.prepare('SELECT * FROM nodes WHERE UPPER(package_name) = UPPER(?)').all(packageName) as Array<
      Record<string, unknown>
    >;
    return rows.map(rowToNode);
  }

  invalidateNode(id: string): void {
    this.db.prepare('UPDATE nodes SET valid = 0 WHERE id = ?').run(id);
  }

  // ─── Edge Operations ──────────────────────────────────────────────

  putEdge(edge: CacheEdge): void {
    const stmt = this.db.prepare(
      'INSERT OR REPLACE INTO edges (from_id, to_id, edge_type, source, discovered_at, valid) VALUES (?, ?, ?, ?, ?, ?)',
    );
    stmt.run(edge.fromId, edge.toId, edge.edgeType, edge.source ?? null, edge.discoveredAt, edge.valid ? 1 : 0);
  }

  getEdgesFrom(fromId: string): CacheEdge[] {
    const rows = this.db.prepare('SELECT * FROM edges WHERE from_id = ?').all(fromId) as Array<Record<string, unknown>>;
    return rows.map(rowToEdge);
  }

  getEdgesTo(toId: string): CacheEdge[] {
    const rows = this.db.prepare('SELECT * FROM edges WHERE to_id = ?').all(toId) as Array<Record<string, unknown>>;
    return rows.map(rowToEdge);
  }

  // ─── API Operations ───────────────────────────────────────────────

  putApi(api: CacheApi): void {
    const stmt = this.db.prepare(
      'INSERT OR REPLACE INTO apis (name, type, release_state, clean_core_level, application_component) VALUES (?, ?, ?, ?, ?)',
    );
    stmt.run(api.name, api.type, api.releaseState, api.cleanCoreLevel ?? null, api.applicationComponent ?? null);
  }

  getApi(name: string, type: string): CacheApi | null {
    const row = this.db.prepare('SELECT * FROM apis WHERE type = ? AND name = ?').get(type, name) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return {
      name: String(row.name),
      type: String(row.type),
      releaseState: String(row.release_state),
      cleanCoreLevel: row.clean_core_level as string | undefined,
      applicationComponent: row.application_component as string | undefined,
    };
  }

  // ─── Source Code Cache ────────────────────────────────────────────

  putSource(
    objectType: string,
    objectName: string,
    source: string,
    opts: { version?: 'active' | 'inactive'; etag?: string } = {},
  ): void {
    const version = opts.version ?? 'active';
    const key = sourceKey(objectType, objectName, version);
    const stmt = this.db.prepare(
      'INSERT OR REPLACE INTO sources (cache_key, object_type, object_name, version, source, hash, etag, cached_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    stmt.run(
      key,
      objectType.toUpperCase(),
      objectName.toUpperCase(),
      version,
      source,
      hashSource(source),
      opts.etag ?? null,
      new Date().toISOString(),
    );
  }

  getSource(objectType: string, objectName: string, version: 'active' | 'inactive' = 'active'): CachedSource | null {
    const key = sourceKey(objectType, objectName, version);
    const row = this.db.prepare('SELECT * FROM sources WHERE cache_key = ?').get(key) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return {
      objectType: String(row.object_type),
      objectName: String(row.object_name),
      version: String(row.version) as 'active' | 'inactive',
      source: String(row.source),
      hash: String(row.hash),
      etag: row.etag ? String(row.etag) : undefined,
      cachedAt: String(row.cached_at),
    };
  }

  invalidateSource(objectType: string, objectName: string, version: 'active' | 'inactive' | 'all' = 'active'): void {
    if (version === 'all') {
      this.db
        .prepare('DELETE FROM sources WHERE object_type = ? AND object_name = ?')
        .run(objectType.toUpperCase(), objectName.toUpperCase());
      return;
    }
    const key = sourceKey(objectType, objectName, version);
    this.db.prepare('DELETE FROM sources WHERE cache_key = ?').run(key);
  }

  // ─── Dependency Graph Cache ───────────────────────────────────────

  putDepGraph(graph: CachedDepGraph): void {
    const stmt = this.db.prepare(
      'INSERT OR REPLACE INTO dep_graphs (source_hash, object_name, object_type, contracts, cached_at) VALUES (?, ?, ?, ?, ?)',
    );
    stmt.run(graph.sourceHash, graph.objectName, graph.objectType, JSON.stringify(graph.contracts), graph.cachedAt);
  }

  getDepGraph(sourceHash: string): CachedDepGraph | null {
    const row = this.db.prepare('SELECT * FROM dep_graphs WHERE source_hash = ?').get(sourceHash) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return {
      sourceHash: String(row.source_hash),
      objectName: String(row.object_name),
      objectType: String(row.object_type),
      contracts: JSON.parse(String(row.contracts)),
      cachedAt: String(row.cached_at),
    };
  }

  // ─── Function Group Resolution ────────────────────────────────────

  putFuncGroup(funcName: string, groupName: string): void {
    this.db
      .prepare('INSERT OR REPLACE INTO func_groups (func_name, group_name) VALUES (?, ?)')
      .run(funcName.toUpperCase(), groupName.toUpperCase());
  }

  getFuncGroup(funcName: string): string | null {
    const row = this.db.prepare('SELECT group_name FROM func_groups WHERE func_name = ?').get(funcName.toUpperCase()) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return String(row.group_name);
  }

  // ─── Management ───────────────────────────────────────────────────

  clear(): void {
    this.db.exec(
      'DELETE FROM nodes; DELETE FROM edges; DELETE FROM apis; DELETE FROM sources; DELETE FROM dep_graphs; DELETE FROM func_groups;',
    );
  }

  stats(): CacheStats {
    const nodeCount = (this.db.prepare('SELECT COUNT(*) as cnt FROM nodes').get() as { cnt: number }).cnt;
    const edgeCount = (this.db.prepare('SELECT COUNT(*) as cnt FROM edges').get() as { cnt: number }).cnt;
    const apiCount = (this.db.prepare('SELECT COUNT(*) as cnt FROM apis').get() as { cnt: number }).cnt;
    const sourceCount = (this.db.prepare('SELECT COUNT(*) as cnt FROM sources').get() as { cnt: number }).cnt;
    const contractCount = (this.db.prepare('SELECT COUNT(*) as cnt FROM dep_graphs').get() as { cnt: number }).cnt;
    return { nodeCount, edgeCount, apiCount, sourceCount, contractCount };
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  close(): void {
    this.db.close();
  }
}

function rowToNode(row: Record<string, unknown>): CacheNode {
  return {
    id: String(row.id),
    objectType: String(row.object_type),
    objectName: String(row.object_name),
    packageName: String(row.package_name),
    sourceHash: row.source_hash as string | undefined,
    cachedAt: String(row.cached_at),
    valid: row.valid === 1,
    metadata: row.metadata ? JSON.parse(String(row.metadata)) : undefined,
  };
}

function rowToEdge(row: Record<string, unknown>): CacheEdge {
  return {
    fromId: String(row.from_id),
    toId: String(row.to_id),
    edgeType: String(row.edge_type) as CacheEdge['edgeType'],
    source: row.source as string | undefined,
    discoveredAt: String(row.discovered_at),
    valid: row.valid === 1,
  };
}
