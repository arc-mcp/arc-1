/**
 * In-memory cache implementation.
 *
 * Default cache backend for stdio transport — fast, ephemeral.
 * Data is lost when the process exits.
 * Thread-safe by default in Node.js (single-threaded event loop).
 */

import type {
  Cache,
  CacheApi,
  CachedDepGraph,
  CachedSource,
  CacheEdge,
  CacheListSourcesQuery,
  CacheListSourcesResult,
  CacheNode,
  CacheSourceSummary,
  CacheStats,
} from './cache.js';
import { hashSource, sourceKey } from './cache.js';

export class MemoryCache implements Cache {
  private nodes = new Map<string, CacheNode>();
  private edges = new Map<string, CacheEdge[]>();
  private reverseEdges = new Map<string, CacheEdge[]>();
  private apis = new Map<string, CacheApi>();
  private sources = new Map<string, CachedSource>();
  private depGraphs = new Map<string, CachedDepGraph>();
  private funcGroups = new Map<string, string>();

  // ─── Node Operations ──────────────────────────────────────────────

  putNode(node: CacheNode): void {
    this.nodes.set(node.id, { ...node });
  }

  getNode(id: string): CacheNode | null {
    return this.nodes.get(id) ?? null;
  }

  getNodesByPackage(packageName: string): CacheNode[] {
    const upper = packageName.toUpperCase();
    const result: CacheNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.packageName.toUpperCase() === upper) {
        result.push(node);
      }
    }
    return result;
  }

  invalidateNode(id: string): void {
    const node = this.nodes.get(id);
    if (node) {
      node.valid = false;
    }
  }

  // ─── Edge Operations ──────────────────────────────────────────────

  putEdge(edge: CacheEdge): void {
    const edgeCopy = { ...edge };
    // Forward index
    const fwd = this.edges.get(edge.fromId) ?? [];
    // Replace existing edge with same (from, to, type) or add new
    const fwdIdx = fwd.findIndex((e) => e.toId === edge.toId && e.edgeType === edge.edgeType);
    if (fwdIdx >= 0) {
      fwd[fwdIdx] = edgeCopy;
    } else {
      fwd.push(edgeCopy);
    }
    this.edges.set(edge.fromId, fwd);

    // Reverse index
    const rev = this.reverseEdges.get(edge.toId) ?? [];
    const revIdx = rev.findIndex((e) => e.fromId === edge.fromId && e.edgeType === edge.edgeType);
    if (revIdx >= 0) {
      rev[revIdx] = edgeCopy;
    } else {
      rev.push(edgeCopy);
    }
    this.reverseEdges.set(edge.toId, rev);
  }

  getEdgesFrom(fromId: string): CacheEdge[] {
    return this.edges.get(fromId) ?? [];
  }

  getEdgesTo(toId: string): CacheEdge[] {
    return this.reverseEdges.get(toId) ?? [];
  }

  // ─── API Operations ───────────────────────────────────────────────

  putApi(api: CacheApi): void {
    this.apis.set(`${api.type}:${api.name}`, { ...api });
  }

  getApi(name: string, type: string): CacheApi | null {
    return this.apis.get(`${type}:${name}`) ?? null;
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
    this.sources.set(key, {
      objectType: objectType.toUpperCase(),
      objectName: objectName.toUpperCase(),
      version,
      source,
      hash: hashSource(source),
      etag: opts.etag,
      cachedAt: new Date().toISOString(),
    });
  }

  getSource(objectType: string, objectName: string, version: 'active' | 'inactive' = 'active'): CachedSource | null {
    return this.sources.get(sourceKey(objectType, objectName, version)) ?? null;
  }

  listSources(query: CacheListSourcesQuery = {}): CacheListSourcesResult {
    const limit = clampLimit(query.limit);
    const offset = clampOffset(query.offset);
    const objectType = query.objectType?.trim().toUpperCase();
    const nameQuery = query.query?.trim().toUpperCase();

    const filtered = Array.from(this.sources.values())
      .filter((entry) => !objectType || entry.objectType === objectType)
      .filter((entry) => !query.version || entry.version === query.version)
      .filter((entry) => !nameQuery || entry.objectName.includes(nameQuery))
      .sort((a, b) => {
        const typeCompare = a.objectType.localeCompare(b.objectType);
        if (typeCompare !== 0) return typeCompare;
        const nameCompare = a.objectName.localeCompare(b.objectName);
        if (nameCompare !== 0) return nameCompare;
        return a.version.localeCompare(b.version);
      });

    return {
      total: filtered.length,
      limit,
      offset,
      items: filtered.slice(offset, offset + limit).map(toSourceSummary),
    };
  }

  invalidateSource(objectType: string, objectName: string, version: 'active' | 'inactive' | 'all' = 'active'): void {
    if (version === 'all') {
      this.sources.delete(sourceKey(objectType, objectName, 'active'));
      this.sources.delete(sourceKey(objectType, objectName, 'inactive'));
      return;
    }
    this.sources.delete(sourceKey(objectType, objectName, version));
  }

  // ─── Dependency Graph Cache ───────────────────────────────────────

  putDepGraph(graph: CachedDepGraph): void {
    this.depGraphs.set(graph.sourceHash, { ...graph });
  }

  getDepGraph(sourceHash: string): CachedDepGraph | null {
    return this.depGraphs.get(sourceHash) ?? null;
  }

  // ─── Function Group Resolution ────────────────────────────────────

  putFuncGroup(funcName: string, groupName: string): void {
    this.funcGroups.set(funcName.toUpperCase(), groupName.toUpperCase());
  }

  getFuncGroup(funcName: string): string | null {
    return this.funcGroups.get(funcName.toUpperCase()) ?? null;
  }

  // ─── Management ───────────────────────────────────────────────────

  clear(): void {
    this.nodes.clear();
    this.edges.clear();
    this.reverseEdges.clear();
    this.apis.clear();
    this.sources.clear();
    this.depGraphs.clear();
    this.funcGroups.clear();
  }

  stats(): CacheStats {
    let edgeCount = 0;
    for (const edges of this.edges.values()) {
      edgeCount += edges.length;
    }
    return {
      nodeCount: this.nodes.size,
      edgeCount,
      apiCount: this.apis.size,
      sourceCount: this.sources.size,
      contractCount: this.depGraphs.size,
    };
  }

  transaction<T>(fn: () => T): T {
    return fn();
  }

  close(): void {
    this.clear();
  }
}

function toSourceSummary(entry: CachedSource): CacheSourceSummary {
  return {
    objectType: entry.objectType,
    objectName: entry.objectName,
    version: entry.version,
    hash: entry.hash,
    etagPresent: !!entry.etag,
    cachedAt: entry.cachedAt,
    sourceLength: entry.source.length,
  };
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return 50;
  return Math.max(1, Math.min(200, Math.trunc(limit)));
}

function clampOffset(offset: number | undefined): number {
  if (offset === undefined || !Number.isFinite(offset)) return 0;
  return Math.max(0, Math.trunc(offset));
}
