/**
 * Cache warmup — pre-indexes all custom objects from the SAP system.
 *
 * Pipeline:
 * 1. Query TADIR for all custom objects (CLAS, INTF, FUNC) matching package filter
 * 2. Fetch source code for each object (bounded parallel)
 * 3. Extract dependencies from each source (local AST, no ADT calls)
 * 4. Store source + deps + edges in cache
 * 5. Build reverse dependency index (edges indexed by toId)
 *
 * Delta strategy:
 * - On-premise: query REPOSRC for objects changed since last warmup (UDAT field)
 * - BTP: full re-scan (no reliable change timestamp available)
 * - Fallback: compare source hash — if unchanged, skip dep extraction
 *
 * Timing estimates (5 concurrent requests):
 * - 500 objects: ~2-3 minutes
 * - 2,000 objects: ~8-12 minutes
 * - 5,000 objects: ~20-30 minutes
 */

import type { AdtClient } from '../adt/client.js';
import { extractDependencies } from '../context/deps.js';
import { logger } from '../server/logger.js';
import { hashSource } from './cache.js';
import type { CachingLayer } from './caching-layer.js';

const WARMUP_CONCURRENT = 5;
const WARMUP_MAX_OBJECTS = 10000;

/** Result of a warmup run */
export interface WarmupResult {
  totalObjects: number;
  fetched: number;
  skipped: number;
  failed: number;
  edgesCreated: number;
  durationMs: number;
}

/** A TADIR entry for an object to index */
interface TadirEntry {
  objectType: string;
  objectName: string;
  packageName: string;
}

type WarmupIndexStatus = 'fetched' | 'skipped' | 'failed';

interface WarmupIndexResult {
  status: WarmupIndexStatus;
  edges: number;
  write?: () => void;
}

/**
 * Run cache warmup: enumerate + fetch + index all custom objects.
 *
 * @param client - ADT client for SAP access
 * @param cachingLayer - Caching layer to populate
 * @param packageFilter - Package name filter (supports wildcards, e.g. "Z*,Y*")
 * @param systemType - System type for choosing delta strategy
 */
export async function runWarmup(
  client: AdtClient,
  cachingLayer: CachingLayer,
  packageFilter?: string,
  _systemType?: string,
): Promise<WarmupResult> {
  const start = Date.now();
  let fetched = 0;
  let skipped = 0;
  let failed = 0;
  let edgesCreated = 0;

  // Phase 1: Enumerate objects from TADIR
  logger.info('Cache warmup: enumerating objects from TADIR...');
  const entries = await enumerateObjects(client, packageFilter);
  logger.info(`Cache warmup: found ${entries.length} objects to index`);

  // Phase 2: Fetch + index in parallel batches
  for (let i = 0; i < entries.length; i += WARMUP_CONCURRENT) {
    const batch = entries.slice(i, i + WARMUP_CONCURRENT);
    const results = await Promise.all(
      batch.map(async (entry) => {
        try {
          return await indexObject(client, cachingLayer, entry);
        } catch (err) {
          logger.debug(`Cache warmup: failed to index ${entry.objectType}:${entry.objectName}`, {
            error: err instanceof Error ? err.message : String(err),
          });
          return { status: 'failed' as const, edges: 0 };
        }
      }),
    );

    try {
      applyWarmupWrites(cachingLayer, results);
    } catch (err) {
      logger.warn('Cache warmup: failed to store indexed batch', {
        error: err instanceof Error ? err.message : String(err),
      });
      failed += results.length;
      continue;
    }

    for (const r of results) {
      if (r.status === 'fetched') {
        fetched++;
        edgesCreated += r.edges;
      } else if (r.status === 'skipped') {
        skipped++;
      } else {
        failed++;
      }
    }

    // Progress logging every 50 objects
    if ((i + WARMUP_CONCURRENT) % 50 === 0 || i + WARMUP_CONCURRENT >= entries.length) {
      logger.info(
        `Cache warmup: ${fetched + skipped + failed}/${entries.length} (${fetched} fetched, ${skipped} skipped, ${failed} failed)`,
      );
    }
  }

  cachingLayer.setWarmupDone(true);

  const durationMs = Date.now() - start;
  logger.info('Cache warmup complete', {
    totalObjects: entries.length,
    fetched,
    skipped,
    failed,
    edgesCreated,
    durationMs,
  });

  return { totalObjects: entries.length, fetched, skipped, failed, edgesCreated, durationMs };
}

function applyWarmupWrites(cachingLayer: CachingLayer, results: WarmupIndexResult[]): void {
  const writers = results.flatMap((result) => (result.write ? [result.write] : []));
  if (writers.length === 0) return;

  cachingLayer.cache.transaction(() => {
    for (const write of writers) write();
  });
}

/**
 * Enumerate all custom CLAS/INTF/FUNC objects from TADIR.
 *
 * Runs separate queries per OBJ_NAME prefix (Z%, Y%, /%) to avoid
 * parenthesized OR-LIKE clauses that some ADT systems reject.
 * Package filtering is done in-memory after fetching.
 */
async function enumerateObjects(client: AdtClient, packageFilter?: string): Promise<TadirEntry[]> {
  // TADIR uses PGMID = 'R3TR' for main repository objects
  const objectTypes = "'CLAS','INTF','FUGR'"; // FUGR not FUNC — TADIR stores function groups
  const baseWhere = `PGMID = 'R3TR' AND OBJECT IN (${objectTypes})`;

  // Custom object name prefixes: Z*, Y*, namespaced /XX/*
  // We run one query per prefix to avoid OR-in-parens which some ADT systems reject
  const namePrefixes = ['Z%', 'Y%', '/%'];

  // Compile package filter patterns into regex for in-memory filtering
  let packageRegexes: RegExp[] | null = null;
  if (packageFilter) {
    const patterns = packageFilter
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (patterns.length > 0) {
      packageRegexes = patterns.map((p) => {
        // Convert glob-style wildcards to regex
        const escaped = p
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.');
        return new RegExp(`^${escaped}$`, 'i');
      });
    }
  }

  const seen = new Set<string>();
  const entries: TadirEntry[] = [];

  for (const prefix of namePrefixes) {
    const sql = `SELECT OBJECT, OBJ_NAME, DEVCLASS FROM TADIR WHERE ${baseWhere} AND OBJ_NAME LIKE '${prefix}' ORDER BY OBJECT, OBJ_NAME`;

    try {
      const data = await client.runQuery(sql, WARMUP_MAX_OBJECTS);
      for (const row of data.rows) {
        const objectType = String(row.OBJECT ?? '').trim();
        const objectName = String(row.OBJ_NAME ?? '').trim();
        const packageName = String(row.DEVCLASS ?? '').trim();

        if (!objectType || !objectName) continue;

        // Deduplicate (shouldn't happen, but defensive)
        const key = `${objectType}:${objectName}`;
        if (seen.has(key)) continue;

        // Apply package filter in memory
        if (packageRegexes && !packageRegexes.some((r) => r.test(packageName))) continue;

        // Map TADIR types to our types
        if (objectType === 'CLAS' || objectType === 'INTF' || objectType === 'FUGR') {
          seen.add(key);
          entries.push({ objectType, objectName, packageName });
        }
      }
    } catch (err) {
      logger.warn(`Cache warmup: TADIR query failed for prefix '${prefix}'`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (entries.length === 0) {
    logger.warn('Cache warmup: no objects found in TADIR — check package filter or system content');
  } else if (entries.length >= WARMUP_MAX_OBJECTS) {
    logger.warn(
      `Cache warmup: found ${entries.length} objects (limit: ${WARMUP_MAX_OBJECTS}). ` +
        'Results may be truncated. Consider narrowing the package filter (--cache-warmup-packages).',
    );
  }

  return entries;
}

/**
 * Index a single object: fetch source, extract deps, store in cache.
 * Returns 'skipped' if source hash matches cached version.
 */
async function indexObject(
  client: AdtClient,
  cachingLayer: CachingLayer,
  entry: TadirEntry,
): Promise<WarmupIndexResult> {
  const { objectType, objectName, packageName } = entry;

  // For FUGR: we enumerate the function modules within the group
  if (objectType === 'FUGR') {
    return indexFunctionGroup(client, cachingLayer, objectName, packageName);
  }

  // Fetch source
  let source: string;
  let etag: string | undefined;
  try {
    const cached = cachingLayer.getCachedSourceWithEtag(objectType, objectName);
    if (objectType === 'CLAS') {
      const result = await client.getClass(objectName, undefined, { ifNoneMatch: cached?.etag });
      source = result.notModified && cached ? cached.source : result.source;
      etag = result.notModified && cached ? cached.etag : result.etag;
    } else if (objectType === 'INTF') {
      const result = await client.getInterface(objectName, { ifNoneMatch: cached?.etag });
      source = result.notModified && cached ? cached.source : result.source;
      etag = result.notModified && cached ? cached.etag : result.etag;
    } else {
      return { status: 'failed', edges: 0 };
    }
  } catch {
    return { status: 'failed', edges: 0 };
  }

  // Check if source changed since last cache
  const cached = cachingLayer.getCachedSource(objectType, objectName);
  const newHash = hashSource(source);
  if (cached && cached.hash === newHash) {
    return { status: 'skipped', edges: 0 };
  }

  const cachedAt = new Date().toISOString();
  const node = {
    id: `${objectType}:${objectName}`.toUpperCase(),
    objectType,
    objectName: objectName.toUpperCase(),
    packageName: packageName.toUpperCase(),
    sourceHash: newHash,
    cachedAt,
    valid: true,
  };

  // Extract dependencies before opening the SQLite transaction. Only the
  // synchronous cache writes are batched; SAP/network work never runs inside it.
  const deps = extractDependencies(source, objectName, true);
  const fromId = objectName.toUpperCase();
  const edgeRecords = deps.map((dep) => ({
    fromId,
    toId: dep.name.toUpperCase(),
    edgeType: mapDepKindToEdgeType(dep.kind),
    discoveredAt: cachedAt,
    valid: true,
  }));

  return {
    status: 'fetched',
    edges: edgeRecords.length,
    write: () => {
      cachingLayer.cache.putSource(objectType, objectName, source, { etag });
      cachingLayer.cache.putNode(node);
      for (const edge of edgeRecords) cachingLayer.cache.putEdge(edge);
    },
  };
}

/**
 * Index a function group: fetch its function modules and index each.
 */
async function indexFunctionGroup(
  client: AdtClient,
  cachingLayer: CachingLayer,
  groupName: string,
  packageName: string,
): Promise<WarmupIndexResult> {
  try {
    const fg = await client.getFunctionGroup(groupName);
    let totalEdges = 0;
    let anyFetched = false;
    const writers: Array<() => void> = [];

    // fg is a parsed object with functions list
    const fgData = typeof fg === 'string' ? JSON.parse(fg) : fg;
    const functions: string[] = fgData.functions ?? [];

    for (const funcName of functions) {
      const funcWriters: Array<() => void> = [() => cachingLayer.cache.putFuncGroup(funcName, groupName)];

      try {
        const cached = cachingLayer.getCachedSource('FUNC', funcName);
        const result = await client.getFunction(groupName, funcName, { ifNoneMatch: cached?.etag });
        const source = result.notModified && cached ? cached.source : result.source;
        const etag = result.notModified && cached ? cached.etag : result.etag;
        const newHash = hashSource(source);

        if (cached && cached.hash === newHash) {
          writers.push(() => {
            for (const write of funcWriters) write();
          });
          continue;
        }

        const cachedAt = new Date().toISOString();
        const node = {
          id: `FUNC:${funcName}`.toUpperCase(),
          objectType: 'FUNC',
          objectName: funcName.toUpperCase(),
          packageName: packageName.toUpperCase(),
          sourceHash: newHash,
          cachedAt,
          valid: true,
        };

        const deps = extractDependencies(source, funcName, true);
        const edgeRecords = deps.map((dep) => ({
          fromId: funcName.toUpperCase(),
          toId: dep.name.toUpperCase(),
          edgeType: mapDepKindToEdgeType(dep.kind),
          discoveredAt: cachedAt,
          valid: true,
        }));
        totalEdges += edgeRecords.length;
        funcWriters.push(
          () => cachingLayer.cache.putSource('FUNC', funcName, source, { etag }),
          () => cachingLayer.cache.putNode(node),
          ...edgeRecords.map((edge) => () => cachingLayer.cache.putEdge(edge)),
        );
        writers.push(() => {
          for (const write of funcWriters) write();
        });
        anyFetched = true;
      } catch {
        // Individual func fetch failure — continue with others
        writers.push(() => {
          for (const write of funcWriters) write();
        });
      }
    }

    return {
      status: anyFetched ? 'fetched' : 'skipped',
      edges: totalEdges,
      write:
        writers.length > 0
          ? () => {
              for (const write of writers) write();
            }
          : undefined,
    };
  } catch {
    return { status: 'failed', edges: 0 };
  }
}

/** Map dependency kind to cache edge type */
function mapDepKindToEdgeType(kind: string): 'CALLS' | 'USES' | 'IMPLEMENTS' | 'INCLUDES' {
  switch (kind) {
    case 'function_call':
      return 'CALLS';
    case 'interface':
    case 'inheritance':
      return 'IMPLEMENTS';
    default:
      return 'USES';
  }
}
