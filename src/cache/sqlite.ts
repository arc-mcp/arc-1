/**
 * SQLite cache implementation using better-sqlite3.
 *
 * Persistent cache — survives process restarts.
 * Explicit opt-in backend for persistent cache across restarts.
 * Uses WAL mode for concurrent read performance.
 * better-sqlite3 is synchronous, which is actually faster than async
 * alternatives for single-process use (no Promise overhead).
 */

import { chmodSync, closeSync, openSync } from 'node:fs';
import Database from 'better-sqlite3';
import type {
  Cache,
  CacheApi,
  CachedDepGraph,
  CachedSource,
  CacheListSourcesQuery,
  CacheListSourcesResult,
  CacheStats,
} from './cache.js';
import { hashSource, sourceKey } from './cache.js';

export class SqliteCache implements Cache {
  private db: Database.Database;

  constructor(dbPath: string) {
    ensurePrivateSqliteFile(dbPath);
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.dropOldSourcesTableIfNeeded();
    this.dropRetiredGraphTables();
    this.createTables();
  }

  private dropRetiredGraphTables(): void {
    this.db.transaction(() => {
      this.db.exec('DROP TABLE IF EXISTS edges; DROP TABLE IF EXISTS nodes;');
    })();
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

      CREATE INDEX IF NOT EXISTS idx_sources_hash ON sources(hash);
      CREATE INDEX IF NOT EXISTS idx_sources_objname_version ON sources(object_name, object_type, version);
    `);
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

  listSources(query: CacheListSourcesQuery = {}): CacheListSourcesResult {
    const limit = clampLimit(query.limit);
    const offset = clampOffset(query.offset);
    const where: string[] = [];
    const params: unknown[] = [];

    if (query.objectType?.trim()) {
      where.push('object_type = ?');
      params.push(query.objectType.trim().toUpperCase());
    }
    if (query.version) {
      where.push('version = ?');
      params.push(query.version);
    }
    if (query.query?.trim()) {
      where.push("UPPER(object_name) LIKE ? ESCAPE '\\'");
      params.push(`%${escapeLike(query.query.trim().toUpperCase())}%`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const countRow = this.db.prepare(`SELECT COUNT(*) as cnt FROM sources ${whereSql}`).get(...params) as {
      cnt: number;
    };
    const rows = this.db
      .prepare(
        `SELECT object_type, object_name, version, hash, etag IS NOT NULL AND etag != '' AS etag_present, cached_at, LENGTH(source) AS source_length
         FROM sources
         ${whereSql}
         ORDER BY object_type ASC, object_name ASC, version ASC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as Array<Record<string, unknown>>;

    return {
      total: countRow.cnt,
      limit,
      offset,
      items: rows.map((row) => ({
        objectType: String(row.object_type),
        objectName: String(row.object_name),
        version: String(row.version) as 'active' | 'inactive',
        hash: String(row.hash),
        etagPresent: row.etag_present === 1,
        cachedAt: String(row.cached_at),
        sourceLength: Number(row.source_length),
      })),
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
    this.db.exec('DELETE FROM apis; DELETE FROM sources; DELETE FROM dep_graphs; DELETE FROM func_groups;');
  }

  stats(): CacheStats {
    const apiCount = (this.db.prepare('SELECT COUNT(*) as cnt FROM apis').get() as { cnt: number }).cnt;
    const sourceCount = (this.db.prepare('SELECT COUNT(*) as cnt FROM sources').get() as { cnt: number }).cnt;
    const contractCount = (this.db.prepare('SELECT COUNT(*) as cnt FROM dep_graphs').get() as { cnt: number }).cnt;
    return { apiCount, sourceCount, contractCount };
  }

  close(): void {
    this.db.close();
  }
}

const PRIVATE_FILE_MODE = 0o600;

function ensurePrivateSqliteFile(dbPath: string): void {
  if (dbPath === ':memory:') return;
  const fd = openSync(dbPath, 'a', PRIVATE_FILE_MODE);
  closeSync(fd);
  chmodSync(dbPath, PRIVATE_FILE_MODE);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return 50;
  return Math.max(1, Math.min(200, Math.trunc(limit)));
}

function clampOffset(offset: number | undefined): number {
  if (offset === undefined || !Number.isFinite(offset)) return 0;
  return Math.max(0, Math.trunc(offset));
}
