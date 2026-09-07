import { performance } from 'node:perf_hooks';
import { ConnectivityAuthenticationError } from '../connectivity.js';
import type { GraphStore } from '../graph/store/store.js';
import type { GraphEdgeInput, GraphImport, GraphNodeInput, SourceOutcome } from '../graph/types.js';
import { type RepositoryObject, searchRepository } from '../inventory.js';
import { SapAuthenticationError, SapClient } from '../sap.js';
import { sourcePathFromObject } from '../sources.js';
import { extractBounded } from './bounded-parser.js';
import { SourceParseError } from './extractor.js';

const SUPPORTED_TYPES = ['CLAS', 'INTF', 'PROG', 'DDLS'] as const;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for live collection`);
  return value;
}

function integer(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be ${minimum}..${maximum}`);
  }
  return value;
}

function packageAllowed(packageName: string, patterns: string[]): boolean {
  const name = packageName.toUpperCase();
  return patterns.some((pattern) => {
    const normalized = pattern.trim().toUpperCase();
    return normalized.endsWith('*') ? name.startsWith(normalized.slice(0, -1)) : name === normalized;
  });
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        const item = items[index];
        if (item !== undefined) results[index] = await worker(item);
      }
    }),
  );
  return results;
}

function graphNode(systemKey: string, object: RepositoryObject): GraphNodeInput {
  return {
    description: object.description,
    locator: object.uri,
    name: object.name,
    packageName: object.packageName,
    resolutionStatus: 'resolved',
    systemKey,
    type: object.type,
  };
}

export async function discoverLiveObjects(
  sap: SapClient,
  query: string,
  packagePatterns: string[],
  maximum: number,
): Promise<{ objects: RepositoryObject[]; requests: number; saturatedSearches: number }> {
  if (
    !Number.isInteger(maximum) ||
    maximum < 1 ||
    maximum > 500 ||
    !query.trim() ||
    query.length > 255 ||
    packagePatterns.length < 1 ||
    packagePatterns.length > 20 ||
    packagePatterns.some(
      (pattern) => !pattern.trim() || pattern.length > 128 || !/^[A-Z0-9_/$]*\*?$/.test(pattern.trim().toUpperCase()),
    )
  )
    throw new Error('Invalid bounded discovery scope');
  const packages = new Set<string>();
  let requests = 0;
  let saturatedSearches = 0;
  for (const pattern of packagePatterns) {
    const normalized = pattern.trim().toUpperCase();
    if (!normalized) continue;
    if (!normalized.endsWith('*')) {
      packages.add(normalized);
      continue;
    }
    const results = await searchRepository(sap, normalized, 1_000, 'DEVC');
    requests += 1;
    if (results.length >= 1_000) saturatedSearches += 1;
    for (const object of results) {
      if (object.type.split('/', 1)[0]?.toUpperCase() !== 'DEVC') continue;
      if (packageAllowed(object.name, packagePatterns)) packages.add(object.name.toUpperCase());
      if (packages.size >= 1000) {
        saturatedSearches += 1;
        break;
      }
    }
    if (packages.size >= 1000) break;
  }

  const found = new Map<string, RepositoryObject>();
  const accumulate = (objects: RepositoryObject[]) => {
    for (const object of objects) {
      const baseType = object.type.split('/', 1)[0]?.toUpperCase();
      if (!SUPPORTED_TYPES.some((supported) => supported === baseType)) continue;
      if (!object.packageName || !packageAllowed(object.packageName, packagePatterns)) continue;
      found.set(`${object.type}\u0000${object.name}`, object);
      if (found.size >= maximum) break;
    }
  };
  for (const packageName of [...packages].sort()) {
    if (found.size >= maximum) break;
    if (requests >= 200) {
      saturatedSearches += 1;
      break;
    }
    const limit = Math.min(1_000, maximum - found.size);
    const results = await searchRepository(sap, query, limit, undefined, packageName);
    requests += 1;
    if (results.length >= limit) saturatedSearches += 1;
    accumulate(results);
    // A capped mixed-type result must not let tables/domains starve supported source types.
    // Partition only when needed, preserving cheap one-request discovery for small packages.
    if (results.length >= limit && found.size < maximum) {
      for (const type of SUPPORTED_TYPES) {
        if (found.size >= maximum) break;
        if (requests >= 200) {
          saturatedSearches += 1;
          break;
        }
        const remaining = maximum - found.size;
        const partition = await searchRepository(sap, query, remaining, type, packageName);
        requests += 1;
        if (partition.length >= remaining) saturatedSearches += 1;
        accumulate(partition);
      }
    }
  }
  return { objects: [...found.values()], requests, saturatedSearches };
}

export interface LiveCollectionResult {
  discoveredObjects: number;
  downloadedBytes: number;
  durationMs: number;
  failedSources: number;
  observations: number;
  requests: number;
  sapRequestAttempts: number;
  proxyTokenRequests: number;
  saturatedSearches: number;
  successfulSources: number;
  systemKey: string;
  failedReads: number;
  failedParses: number;
  partialParses: number;
  dynamicTargets: number;
  collectionStatus: 'complete' | 'partial';
  sourceOutcomes: SourceOutcome[];
}

export async function collectLiveGraph(
  store: Pick<GraphStore, 'importGraph'>,
  mode: 'metadata' | 'transient-source',
): Promise<LiveCollectionResult> {
  const started = performance.now();
  const systemKey = required('ARC_GRAPH_SYSTEM_KEY').toUpperCase();
  const query = required('ARC_GRAPH_LIVE_QUERY');
  const packagePatterns = required('ARC_GRAPH_LIVE_PACKAGES').split(',').filter(Boolean);
  const maximum = integer('ARC_GRAPH_LIVE_MAX_OBJECTS', 500, 1, 500);
  const concurrency = integer('ARC_GRAPH_LIVE_CONCURRENCY', 2, 1, 5);
  const sap = await SapClient.create();
  let requests = 0;
  let saturatedSearches = 0;
  let downloadedBytes = 0;
  let failedSources = 0;
  let failedReads = 0;
  let failedParses = 0;
  let partialParses = 0;
  let dynamicTargets = 0;
  const sourceOutcomes: SourceOutcome[] = [];
  try {
    const discovered = await discoverLiveObjects(sap, query, packagePatterns, maximum);
    requests += discovered.requests;
    saturatedSearches += discovered.saturatedSearches;
    const objects = discovered.objects;
    const nodes = objects.map((object) => graphNode(systemKey, object));
    const packageNodes = [...new Set(objects.map((object) => object.packageName.toUpperCase()))].map(
      (packageName): GraphNodeInput => ({
        name: packageName,
        packageName,
        resolutionStatus: 'resolved',
        systemKey,
        type: 'DEVC',
      }),
    );
    const observations: GraphEdgeInput[] = objects.map((object) => ({
      evidenceMethod: 'adt-quick-search-v1',
      evidenceOwner: `CATALOG:${object.type}:${object.name}`,
      relation: 'belongs_to',
      source: graphNode(systemKey, object),
      sourceResource: `catalog:${object.type}:${object.name}`,
      target: { name: object.packageName, systemKey, type: 'DEVC' },
    }));
    const evidenceScopes = observations.map((edge) => ({
      evidenceOwner: edge.evidenceOwner,
      sourceResource: edge.sourceResource,
    }));
    let successfulSources = 0;
    if (mode === 'transient-source') {
      const extracted = await mapConcurrent(objects, concurrency, async (object) => {
        requests += 1;
        let sourceRead = false;
        try {
          const response = await sap.getText(
            sourcePathFromObject({ OBJECT_TYPE: object.type, OBJECT_URI: object.uri }),
            undefined,
            { accept: 'text/plain, */*', retries: 2, timeoutMs: 15_000 },
          );
          downloadedBytes += Buffer.byteLength(response.body);
          sourceRead = true;
          const result = await extractBounded({ ...graphNode(systemKey, object), source: response.body }, [
            ...nodes,
            ...packageNodes,
          ]);
          successfulSources += 1;
          dynamicTargets += result.analysis.dynamicTargets;
          sourceOutcomes.push({
            name: object.name,
            type: object.type,
            status: 'parsed',
            reasons: [],
            dynamicTargets: result.analysis.dynamicTargets,
          });
          return result;
        } catch (error) {
          if (error instanceof SapAuthenticationError || error instanceof ConnectivityAuthenticationError) throw error;
          failedSources += 1;
          if (!sourceRead) failedReads += 1;
          else if (error instanceof SourceParseError && error.analysis.status === 'partial') partialParses += 1;
          else failedParses += 1;
          sourceOutcomes.push({
            name: object.name,
            type: object.type,
            dynamicTargets: 0,
            status: !sourceRead ? 'read_failed' : error instanceof SourceParseError ? error.analysis.status : 'failed',
            reasons: !sourceRead
              ? ['read_failed']
              : error instanceof SourceParseError
                ? error.analysis.reasons
                : ['parse_exception'],
          });
          return null;
        }
      });
      for (const result of extracted) {
        if (!result) continue;
        observations.push(...result.observations);
        evidenceScopes.push(result.evidenceScope);
      }
    }
    sourceOutcomes.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
    const collectionStatus = failedSources || saturatedSearches ? 'partial' : 'complete';
    const graph: GraphImport = {
      collection: {
        status: collectionStatus,
        sources: sourceOutcomes,
        counters: {
          discoveredObjects: objects.length,
          downloadedBytes,
          requests,
          ...sap.metrics(),
          saturatedSearches,
          successfulSources,
          failedSources,
          failedReads,
          failedParses,
          partialParses,
          dynamicTargets,
        },
      },
      evidenceScopes,
      extractorVersion: mode === 'metadata' ? 'native-metadata-v1' : 'transient-source-v2-abap758',
      nodes: [...nodes, ...packageNodes],
      observations,
      scope: `${query}:${packagePatterns.join(',')}`,
      systemKey,
    };
    await store.importGraph(graph, true);
    return {
      discoveredObjects: objects.length,
      downloadedBytes,
      durationMs: performance.now() - started,
      failedSources,
      observations: observations.length,
      requests,
      ...sap.metrics(),
      saturatedSearches,
      successfulSources,
      systemKey,
      failedReads,
      failedParses,
      partialParses,
      dynamicTargets,
      collectionStatus,
      sourceOutcomes,
    };
  } finally {
    await sap.close();
  }
}
