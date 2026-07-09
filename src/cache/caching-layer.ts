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
 * - Tier 1 (default/auto): MemoryCache, dies with process. Eliminates
 *   duplicate fetches within a session and avoids source-at-rest by default.
 * - Tier 2 (explicit sqlite): SqliteCache, persists. Multiple sessions
 *   share the warm cache when operators accept the source-at-rest posture.
 * - Tier 3 (explicit sqlite + warmup): SqliteCache pre-populated via TADIR
 *   scan. Enables reverse dependency lookup.
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

/** How long after a successful activation the active source cache is treated as authoritative.
 *  During this window the active read is served from the promoted draft WITHOUT revalidating
 *  against SAP, and the "unactivated draft" note is suppressed — both defeat the backend's
 *  read-after-activate consistency lag (observed on BTP/Steampunk) that otherwise serves a
 *  stale/empty shell until force_refresh. Must comfortably exceed the inactive-list TTL (60s)
 *  so a list re-fetched mid-lag cannot outlive it. Cleared early by any write/force_refresh
 *  (which route through invalidate()). ponytail: fixed window; a backend that lags >2min would
 *  need a real consistency signal instead. Residual gap: a non-invalidating mutator (SAPGit
 *  pull / SAPTransport import) to the same object within the window is masked until it expires —
 *  rare and gated; use force_refresh to see such an external change immediately. */
const ACTIVATION_FRESH_MS = 120_000;

interface ActivationFreshness {
  until: number;
  /** Whether a draft source was promoted into the active slot (vs. only note-suppression). */
  promoted: boolean;
}

export class CachingLayer {
  readonly cache: Cache;
  readonly inactiveLists = new InactiveListCache();
  /** (TYPE:NAME) → activation freshness, set by markActivated() after a successful SAPActivate. */
  private readonly recentlyActivated = new Map<string, ActivationFreshness>();
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

    // Post-activation consistency guard: right after a successful activation the active
    // version equals the draft we promoted into cache, but the backend's active /source/main
    // can briefly still serve the pre-activation (empty) shell. Serve the promoted source
    // directly — no revalidation — until the freshness window expires. See ACTIVATION_FRESH_MS.
    if (version === 'active' && this.isActivationFresh(objectType, objectName)) {
      const promoted = this.cache.getSource(objectType, objectName, 'active');
      if (promoted) {
        this.recordActivity('source_hit', {
          objectType,
          objectName,
          version,
          hash: promoted.hash,
          sourceLength: promoted.source.length,
          etagPresent: !!promoted.etag,
          detail: 'post-activation source (consistency guard)',
        });
        return { source: promoted.source, hit: true, revalidated: false };
      }
    }

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
    // Any explicit invalidation (write, delete, force_refresh) means "give me the truth" —
    // drop the post-activation freshness guard so a fresh draft/read is never masked by it.
    this.recentlyActivated.delete(activationKey(objectType, objectName));
    this.recordActivity('source_invalidate', { objectType, objectName, version, removed });
  }

  // ─── Post-Activation Freshness ────────────────────────────────────

  /**
   * Record a successful activation so the next active read returns the just-activated source
   * without being clobbered by a lagging backend (see ACTIVATION_FRESH_MS).
   *
   * When `promotedSource` is provided it is written to the active slot (and the inactive draft
   * dropped) — this is the authoritative content for source objects, whose active version equals
   * the draft byte-for-byte. When omitted (draft unavailable / non-source type) only the
   * "unactivated draft" note is suppressed; the active source falls back to a normal fetch.
   */
  markActivated(objectType: string, objectName: string, promotedSource?: string): void {
    if (promotedSource !== undefined) {
      this.cache.putSource(objectType, objectName, promotedSource, { version: 'active' });
      this.cache.invalidateSource(objectType, objectName, 'inactive');
    }
    const now = Date.now();
    // Opportunistic sweep so the map can't accumulate expired entries on a long-lived server
    // (activations are infrequent, so the O(n) cost is negligible).
    for (const [k, v] of this.recentlyActivated) {
      if (now >= v.until) this.recentlyActivated.delete(k);
    }
    this.recentlyActivated.set(activationKey(objectType, objectName), {
      until: now + ACTIVATION_FRESH_MS,
      promoted: promotedSource !== undefined,
    });
    this.recordActivity('source_refresh', {
      objectType,
      objectName,
      version: 'active',
      sourceLength: promotedSource?.length,
      detail: promotedSource !== undefined ? 'promoted activated draft' : 'activation (note-suppress only)',
    });
  }

  /** Whether the object was activated within the freshness window (used to suppress the draft note). */
  wasRecentlyActivated(objectType: string, objectName: string): boolean {
    return this.activationFreshness(objectType, objectName) !== undefined;
  }

  /** Whether a promoted active source should be served without revalidation. */
  private isActivationFresh(objectType: string, objectName: string): boolean {
    return this.activationFreshness(objectType, objectName)?.promoted === true;
  }

  private activationFreshness(objectType: string, objectName: string): ActivationFreshness | undefined {
    const key = activationKey(objectType, objectName);
    const entry = this.recentlyActivated.get(key);
    if (!entry) return undefined;
    if (Date.now() >= entry.until) {
      this.recentlyActivated.delete(key);
      return undefined;
    }
    return entry;
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

/** Key for the post-activation freshness map (version-independent: one entry per object). */
function activationKey(objectType: string, objectName: string): string {
  return `${objectType.toUpperCase()}:${objectName.toUpperCase()}`;
}
