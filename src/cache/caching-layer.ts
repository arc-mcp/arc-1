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

export class CachingLayer {
  readonly cache: Cache;
  readonly inactiveLists = new InactiveListCache();
  private warmupDone = false;

  constructor(cache: Cache) {
    this.cache = cache;
  }

  /** Mark warmup as complete (enables reverse dep lookups) */
  setWarmupDone(done: boolean): void {
    this.warmupDone = done;
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
      const result = await fetcher(undefined);
      this.cache.putSource(objectType, objectName, result.source, { version, etag: result.etag });
      logger.debug(`[cache] source MISS ${objectType}:${objectName}:${version} (${result.source.length} chars stored)`);
      return { source: result.source, hit: false, revalidated: false };
    }

    try {
      const result = await fetcher(cached.etag);
      if (cached.etag && result.notModified) {
        logger.debug(`[cache] source HIT ${objectType}:${objectName}:${version} revalidated`);
        return { source: cached.source, hit: true, revalidated: true };
      }

      this.cache.putSource(objectType, objectName, result.source, { version, etag: result.etag });
      logger.debug(
        `[cache] source REFRESH ${objectType}:${objectName}:${version} (${result.source.length} chars stored)`,
      );
      return { source: result.source, hit: false, revalidated: false };
    } catch (err) {
      if (err instanceof AdtApiError && (err.statusCode === 404 || err.statusCode === 410)) {
        this.cache.invalidateSource(objectType, objectName, version);
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
      logger.debug(`[cache] depgraph HIT ${cached.objectType}:${cached.objectName} (hash ${hash.slice(0, 8)})`);
    }
    return cached;
  }

  /**
   * Store a resolved dep graph keyed by source hash.
   */
  putDepGraph(source: string, objectName: string, objectType: string, contracts: CachedDepGraph['contracts']): void {
    const hash = hashSource(source);
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
    if (cached) return cached;

    const results = await client.searchObject(funcName, 5);
    for (const r of results) {
      const match = r.uri.match(/groups\/([^/]+)/);
      if (match) {
        const group = match[1]!;
        this.cache.putFuncGroup(funcName, group);
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
    this.cache.invalidateSource(objectType, objectName, version);
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
}
