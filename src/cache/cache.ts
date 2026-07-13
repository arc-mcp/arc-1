/**
 * Cache interface and types for ARC-1.
 *
 * Two implementations:
 * - MemoryCache: fast, ephemeral (default/auto)
 * - SqliteCache: persistent, cross-session (explicit opt-in; stores source bodies at rest)
 *
 * Cache stores four types of data:
 * - APIs: Released API objects (for clean core checks)
 * - Sources: Raw source code keyed by (type, name, version) with content hash
 * - Contracts: Compressed dependency contracts keyed by source hash
 * - Function groups: Function-module to function-group mappings
 */

import { createHash } from 'node:crypto';

/** Released API object */
export interface CacheApi {
  name: string;
  type: string;
  releaseState: string;
  cleanCoreLevel?: string;
  applicationComponent?: string;
}

/** Cache statistics */
export interface CacheStats {
  apiCount: number;
  sourceCount: number;
  contractCount: number;
}

/** Metadata-only cached source listing entry. Never includes ABAP source text. */
export interface CacheSourceSummary {
  objectType: string;
  objectName: string;
  version: 'active' | 'inactive';
  hash: string;
  etagPresent: boolean;
  cachedAt: string;
  sourceLength: number;
}

/** Query options for metadata-only source cache inventory. */
export interface CacheListSourcesQuery {
  objectType?: string;
  query?: string;
  version?: 'active' | 'inactive';
  limit?: number;
  offset?: number;
}

export interface CacheListSourcesResult {
  total: number;
  limit: number;
  offset: number;
  items: CacheSourceSummary[];
}

// ─── Source Cache Types ──────────────────────────────────────────────

/** Cached source code entry */
export interface CachedSource {
  objectType: string;
  objectName: string;
  version: 'active' | 'inactive';
  source: string;
  hash: string;
  etag?: string;
  cachedAt: string;
}

// ─── Contract Cache Types ────────────────────────────────────────────

/** Serializable contract for cache storage (matches context/types.ts Contract) */
export interface CachedContract {
  name: string;
  type: string;
  methodCount: number;
  source: string;
  fullSource?: string;
  success: boolean;
  error?: string;
}

/** Cached dependency resolution result */
export interface CachedDepGraph {
  sourceHash: string;
  objectName: string;
  objectType: string;
  contracts: CachedContract[];
  cachedAt: string;
}

// ─── Cache Interface ────────────────────────────────────────────────

/** Cache interface — both MemoryCache and SqliteCache implement this */
export interface Cache {
  // API operations (released APIs for clean core)
  putApi(api: CacheApi): void;
  getApi(name: string, type: string): CacheApi | null;

  // Source code cache
  putSource(
    objectType: string,
    objectName: string,
    source: string,
    opts?: { version?: 'active' | 'inactive'; etag?: string },
  ): void;
  getSource(objectType: string, objectName: string, version?: 'active' | 'inactive'): CachedSource | null;
  listSources(query?: CacheListSourcesQuery): CacheListSourcesResult;
  invalidateSource(objectType: string, objectName: string, version?: 'active' | 'inactive' | 'all'): void;

  // Dependency contract cache (keyed by source hash)
  putDepGraph(graph: CachedDepGraph): void;
  getDepGraph(sourceHash: string): CachedDepGraph | null;

  // Function group resolution cache
  putFuncGroup(funcName: string, groupName: string): void;
  getFuncGroup(funcName: string): string | null;

  // Management
  clear(): void;
  stats(): CacheStats;
  close(): void;
}

// ─── Helpers ─────────────────────────────────────────────────────────

/** Compute SHA-256 hash of source code (used as dep graph cache key) */
export function hashSource(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

/** Build a source cache key from type + name + source version */
export function sourceKey(objectType: string, objectName: string, version: 'active' | 'inactive' = 'active'): string {
  return `${objectType.toUpperCase()}:${objectName.toUpperCase()}:${version}`;
}
