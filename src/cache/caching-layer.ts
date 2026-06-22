/**
 * Caching layer — orchestrates source + dependency caching.
 *
 * Sits between the intent handler / compressor and the ADT client.
 * Provides cache-aware source fetching with hash-based dependency
 * graph invalidation.
 *
 * Design:
 * - Source code is cached by (type, name, active/inactive version) with a SHA-256 hash and SAP ETag.
 * - Dependency graphs (contracts[]) are cached by source hash.
 *   When the source changes, the hash changes, and deps are re-resolved.
 *   When the source hasn't changed, ALL downstream dep fetches are skipped.
 * - Function group mappings are cached permanently (rarely change).
 * - Writes invalidate the source cache for the written object.
 *
 * Three tiers:
 * - Tier 1 (stdio): MemoryCache, dies with process. Eliminates duplicate
 *   fetches within a session.
 * - Tier 2 (http-streamable): SqliteCache, persists. Multiple sessions
 *   share the warm cache.
 * - Tier 3 (Docker + warmup): SqliteCache pre-populated via TADIR scan.
 *   Enables reverse dependency lookup.
 */

import type { AdtClient, SourceReadResult } from '../adt/client.js';
import { AdtApiError } from '../adt/errors.js';
import { logger } from '../server/logger.js';
import type { Cache, CachedDepGraph, CachedSource, CacheListSourcesQuery, CacheListSourcesResult } from './cache.js';
import { hashSource } from './cache.js';
import { InactiveListCache } from './inactive-list-cache.js';

/** Cache hit/miss statistics for a single operation */
export interface CacheHitInfo {
  sourceHit: boolean;
  depGraphHit: boolean;
  depSourceHits: number;
  depSourceMisses: number;
}

export type CacheActivityEvent =
  | 'source_miss'
  | 'source_store'
  | 'source_hit'
  | 'source_refresh'
  | 'source_invalidate'
  | 'source_evict'
  | 'depgraph_hit'
  | 'depgraph_store'
  | 'func_group_hit'
  | 'func_group_store'
  | 'warmup_state';

export interface CacheActivityEntry {
  timestamp: string;
  event: CacheActivityEvent;
  objectType?: string;
  objectName?: string;
  version?: 'active' | 'inactive' | 'all';
  hash?: string;
  sourceLength?: number;
  etagPresent?: boolean;
  removed?: number;
  detail?: string;
}

export class CachingLayer {
  readonly cache: Cache;
  readonly inactiveLists = new InactiveListCache();
  private warmupDone = false;
  private readonly activityEntries: CacheActivityEntry[] = [];
  private readonly activityCounts: Partial<Record<CacheActivityEvent, number>> = {};

  constructor(
    cache: Cache,
    private readonly maxActivityEntries = 200,
  ) {
    this.cache = cache;
  }

  /** Mark warmup as complete (enables reverse dep lookups) */
  setWarmupDone(done: boolean): void {
    this.warmupDone = done;
    this.recordActivity('warmup_state', { detail: done ? 'warmup index available' : 'warmup index unavailable' });
  }

  /** Whether the warmup index is available */
  get isWarmupAvailable(): boolean {
    return this.warmupDone;
  }

  // ─── Source Fetching with Cache ────────────────────────────────────

  /**
   * Get source code, using cache if available.
   * Returns the source and whether it was a cache hit.
   */
  async getSource(
    objectType: string,
    objectName: string,
    fetcher: (ifNoneMatch?: string) => Promise<SourceReadResult>,
    opts: { version?: 'active' | 'inactive' } = {},
  ): Promise<{ source: string; hit: boolean; revalidated: boolean }> {
    const version = opts.version ?? 'active';
    const cached = this.cache.getSource(objectType, objectName, version);
    if (!cached) {
      this.recordActivity('source_miss', {
        objectType,
        objectName,
        version,
        detail: 'no cached source entry',
      });
      const result = await fetcher(undefined);
      this.cache.putSource(objectType, objectName, result.source, { version, etag: result.etag });
      this.recordActivity('source_store', {
        objectType,
        objectName,
        version,
        hash: hashSource(result.source),
        sourceLength: result.source.length,
        etagPresent: !!result.etag,
        detail: 'loaded from SAP',
      });
      logger.debug(`[cache] source MISS ${objectType}:${objectName}:${version} (${result.source.length} chars stored)`);
      return { source: result.source, hit: false, revalidated: false };
    }

    try {
      const result = await fetcher(cached.etag);
      if (cached.etag && result.notModified) {
        this.recordActivity('source_hit', {
          objectType,
          objectName,
          version,
          hash: cached.hash,
          sourceLength: cached.source.length,
          etagPresent: true,
        });
        logger.debug(`[cache] source HIT ${objectType}:${objectName}:${version} revalidated`);
        return { source: cached.source, hit: true, revalidated: true };
      }

      this.cache.putSource(objectType, objectName, result.source, { version, etag: result.etag });
      this.recordActivity('source_refresh', {
        objectType,
        objectName,
        version,
        hash: hashSource(result.source),
        sourceLength: result.source.length,
        etagPresent: !!result.etag,
        detail: 'reloaded from SAP',
      });
      logger.debug(
        `[cache] source REFRESH ${objectType}:${objectName}:${version} (${result.source.length} chars stored)`,
      );
      return { source: result.source, hit: false, revalidated: false };
    } catch (err) {
      if (err instanceof AdtApiError && (err.statusCode === 404 || err.statusCode === 410)) {
        this.cache.invalidateSource(objectType, objectName, version);
        this.recordActivity('source_evict', {
          objectType,
          objectName,
          version,
          removed: 1,
          detail: `conditional read returned ${err.statusCode}`,
        });
      }
      throw err;
    }
  }

  /**
   * Get cached source without fetching (for cache-only lookups).
   */
  getCachedSource(objectType: string, objectName: string): CachedSource | null {
    return this.cache.getSource(objectType, objectName);
  }

  /**
   * Get cached source body and ETag without fetching.
   */
  getCachedSourceWithEtag(
    objectType: string,
    objectName: string,
    version: 'active' | 'inactive' = 'active',
  ): { source: string; etag?: string } | null {
    const cached = this.cache.getSource(objectType, objectName, version);
    if (!cached) return null;
    return { source: cached.source, etag: cached.etag };
  }

  /**
   * List cached source metadata for read-only inspection UIs.
   * Intentionally returns no source bodies.
   */
  listCachedSources(query?: CacheListSourcesQuery): CacheListSourcesResult {
    return this.cache.listSources(query);
  }

  // ─── Dependency Graph Cache ───────────────────────────────────────

  /**
   * Check if we have a cached dep graph for the given source.
   * The graph is keyed by the source hash — if source changed, this returns null.
   */
  getCachedDepGraph(source: string): CachedDepGraph | null {
    const hash = hashSource(source);
    const cached = this.cache.getDepGraph(hash);
    if (cached) {
      this.recordActivity('depgraph_hit', {
        objectType: cached.objectType,
        objectName: cached.objectName,
        hash,
        detail: `${cached.contracts.length} contracts`,
      });
      logger.debug(`[cache] depgraph HIT ${cached.objectType}:${cached.objectName} (hash ${hash.slice(0, 8)})`);
    }
    return cached;
  }

  /**
   * Store a resolved dep graph keyed by source hash.
   */
  putDepGraph(source: string, objectName: string, objectType: string, contracts: CachedDepGraph['contracts']): void {
    const hash = hashSource(source);
    this.recordActivity('depgraph_store', {
      objectType,
      objectName,
      hash,
      detail: `${contracts.length} contracts`,
    });
    logger.debug(
      `[cache] depgraph STORE ${objectType}:${objectName} (${contracts.length} contracts, hash ${hash.slice(0, 8)})`,
    );
    this.cache.putDepGraph({
      sourceHash: hash,
      objectName,
      objectType,
      contracts,
      cachedAt: new Date().toISOString(),
    });
  }

  // ─── Function Group Resolution ────────────────────────────────────

  /**
   * Resolve a function module's group, with cache.
   */
  async resolveFuncGroup(client: AdtClient, funcName: string): Promise<string | null> {
    const cached = this.cache.getFuncGroup(funcName);
    if (cached) {
      this.recordActivity('func_group_hit', { objectType: 'FUNC', objectName: funcName, detail: cached });
      return cached;
    }

    const results = await client.searchObject(funcName, 5);
    for (const r of results) {
      const match = r.uri.match(/groups\/([^/]+)/);
      if (match) {
        const group = match[1]!;
        this.cache.putFuncGroup(funcName, group);
        this.recordActivity('func_group_store', { objectType: 'FUNC', objectName: funcName, detail: group });
        return group;
      }
    }
    return null;
  }

  // ─── Write Invalidation ───────────────────────────────────────────

  /**
   * Invalidate cache entries for a written object.
   * Called after SAPWrite to ensure stale source is not served.
   */
  invalidate(objectType: string, objectName: string, version: 'active' | 'inactive' | 'all' = 'active'): void {
    logger.debug(`[cache] invalidate ${objectType}:${objectName}:${version}`);
    const removed = this.countSourceEntries(objectType, objectName, version);
    this.cache.invalidateSource(objectType, objectName, version);
    this.recordActivity('source_invalidate', { objectType, objectName, version, removed });
  }

  // ─── Reverse Dependencies (Pre-warmer only) ───────────────────────

  /**
   * Find all objects that depend on the given object (reverse lookup).
   * Only available when pre-warmer has populated the edge index.
   * Returns null if warmup hasn't run (caller should show appropriate message).
   */
  getUsages(objectName: string): { fromId: string; edgeType: string }[] | null {
    if (!this.warmupDone) return null;
    const edges = this.cache.getEdgesTo(objectName.toUpperCase());
    return edges.map((e) => ({ fromId: e.fromId, edgeType: e.edgeType }));
  }

  // ─── Stats ────────────────────────────────────────────────────────

  stats(): Cache['stats'] extends (...args: infer _A) => infer R ? R : never {
    return this.cache.stats();
  }

  listActivity(limit = 50): {
    total: number;
    limit: number;
    counts: Partial<Record<CacheActivityEvent, number>>;
    items: CacheActivityEntry[];
  } {
    const clamped = Math.max(1, Math.min(200, Math.trunc(Number.isFinite(limit) ? limit : 50)));
    return {
      total: this.activityEntries.length,
      limit: clamped,
      counts: { ...this.activityCounts },
      items: this.activityEntries.slice(-clamped).reverse(),
    };
  }

  private countSourceEntries(objectType: string, objectName: string, version: 'active' | 'inactive' | 'all'): number {
    if (version === 'all') {
      return (
        (this.cache.getSource(objectType, objectName, 'active') ? 1 : 0) +
        (this.cache.getSource(objectType, objectName, 'inactive') ? 1 : 0)
      );
    }
    return this.cache.getSource(objectType, objectName, version) ? 1 : 0;
  }

  private recordActivity(
    event: CacheActivityEvent,
    details: Omit<CacheActivityEntry, 'timestamp' | 'event'> = {},
  ): void {
    if (this.maxActivityEntries < 1) return;
    const entry: CacheActivityEntry = {
      timestamp: new Date().toISOString(),
      event,
      ...details,
      objectType: details.objectType?.toUpperCase(),
      objectName: details.objectName?.toUpperCase(),
    };
    this.activityEntries.push(entry);
    while (this.activityEntries.length > this.maxActivityEntries) {
      this.activityEntries.shift();
    }
    this.activityCounts[event] = (this.activityCounts[event] ?? 0) + 1;
  }
}
