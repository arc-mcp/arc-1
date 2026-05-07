/**
 * Context compression orchestrator for SAPContext.
 *
 * Pipeline:
 * 1. Parse source → extract dependency names (deps.ts)
 * 2. Filter (remove self-refs, SAP built-ins)
 * 3. Sort (custom objects first)
 * 4. Limit to maxDeps
 * 5. Fetch dependency sources (parallel, bounded to MAX_CONCURRENT)
 *    → With caching layer: check cache first, only fetch on miss
 * 6. Extract contracts (public API only) (contract.ts)
 * 7. If depth > 1, recurse on each dependency's source
 * 8. Format output prologue
 * 9. Cache the resolved dep graph (keyed by source hash)
 */

import type { Version } from '@abaplint/core';
import type { AdtClient, SourceReadResult } from '../adt/client.js';
import type { CachingLayer } from '../cache/caching-layer.js';
import { extractCdsDependencies } from './cds-deps.js';
import { extractContract } from './contract.js';
import { extractDependencies } from './deps.js';
import type { CdsDependency, ContextResult, Contract, Dependency } from './types.js';

const DEFAULT_MAX_DEPS = 20;
const DEFAULT_DEPTH = 1;
const MAX_DEPTH = 3;
const MAX_CONCURRENT = 5;

function readResultSource(result: SourceReadResult | string): string {
  return typeof result === 'string' ? result : result.source;
}

/**
 * Compress dependency context for an ABAP object.
 *
 * @param client - ADT client for fetching dependency sources
 * @param source - ABAP source code of the target object
 * @param objectName - Target object name
 * @param objectType - Target object type (CLAS, INTF, PROG, FUNC)
 * @param maxDeps - Maximum number of dependencies to resolve (default 20)
 * @param depth - Dependency expansion depth 1-3 (default 1)
 * @param abaplintVersion - abaplint parser version (detected from SAP system, defaults to Cloud)
 * @param cachingLayer - Optional caching layer for source and contract caching
 */
export async function compressContext(
  client: AdtClient,
  source: string,
  objectName: string,
  objectType: string,
  maxDeps = DEFAULT_MAX_DEPS,
  depth = DEFAULT_DEPTH,
  abaplintVersion?: Version,
  cachingLayer?: CachingLayer,
): Promise<ContextResult> {
  const effectiveDepth = Math.min(Math.max(depth, 1), MAX_DEPTH);
  const seen = new Set<string>([objectName.toUpperCase()]);
  const allContracts: Contract[] = [];
  let totalFiltered = 0;

  const deps = extractDependencies(source, objectName, true, abaplintVersion);
  totalFiltered = deps.length; // extractDependencies already filters, but we track the count

  await resolveDepthLevel(client, deps, maxDeps, effectiveDepth, seen, allContracts, abaplintVersion, cachingLayer);

  const result = formatResult(objectName, objectType, deps.length, allContracts, totalFiltered);

  // Cache the resolved dep graph keyed by source hash.
  // Cache even when allContracts is empty — avoids re-resolving on every call
  // for objects with no resolvable dependencies.
  if (cachingLayer) {
    cachingLayer.putDepGraph(
      source,
      objectName,
      objectType,
      allContracts.map((c) => ({
        name: c.name,
        type: c.type,
        methodCount: c.methodCount,
        source: c.source,
        fullSource: c.fullSource,
        success: c.success,
        error: c.error,
      })),
    );
  }

  return result;
}

/**
 * Resolve one level of dependencies and recurse if needed.
 */
async function resolveDepthLevel(
  client: AdtClient,
  deps: Dependency[],
  maxDeps: number,
  depth: number,
  seen: Set<string>,
  contracts: Contract[],
  abaplintVersion?: Version,
  cachingLayer?: CachingLayer,
): Promise<void> {
  // Filter already-seen and limit
  const newDeps = deps.filter((d) => !seen.has(d.name.toUpperCase()));

  // Mark as seen immediately (before fetching) to prevent duplicates in recursive calls
  for (const dep of newDeps) {
    seen.add(dep.name.toUpperCase());
  }

  // Limit to maxDeps
  const limited = newDeps.slice(0, maxDeps);

  // Fetch and extract contracts (bounded parallel)
  const fetched = await fetchContractsParallel(client, limited, abaplintVersion, cachingLayer);
  contracts.push(...fetched);

  // Recurse if depth > 1
  if (depth > 1) {
    for (const contract of fetched) {
      if (contract.success && (contract.fullSource || contract.source)) {
        // Extract deps from the full source (not compressed contract) for accuracy
        const subDeps = extractDependencies(
          contract.fullSource || contract.source,
          contract.name,
          true,
          abaplintVersion,
        );
        const unseenSubDeps = subDeps.filter((d) => !seen.has(d.name.toUpperCase()));
        if (unseenSubDeps.length > 0) {
          await resolveDepthLevel(
            client,
            unseenSubDeps,
            maxDeps,
            depth - 1,
            seen,
            contracts,
            abaplintVersion,
            cachingLayer,
          );
        }
      }
    }
  }
}

/**
 * Fetch source and extract contract for each dependency.
 * Bounded to MAX_CONCURRENT parallel requests.
 */
async function fetchContractsParallel(
  client: AdtClient,
  deps: Dependency[],
  abaplintVersion?: Version,
  cachingLayer?: CachingLayer,
): Promise<Contract[]> {
  const results: Contract[] = [];
  for (let i = 0; i < deps.length; i += MAX_CONCURRENT) {
    const batch = deps.slice(i, i + MAX_CONCURRENT);
    const batchResults = await Promise.all(
      batch.map((dep) => fetchSingleContract(client, dep, abaplintVersion, cachingLayer)),
    );
    results.push(...batchResults);
  }
  return results;
}

/**
 * Fetch source for a single dependency and extract its contract.
 */
async function fetchSingleContract(
  client: AdtClient,
  dep: Dependency,
  abaplintVersion?: Version,
  cachingLayer?: CachingLayer,
): Promise<Contract> {
  try {
    const objectType = inferObjectType(dep);
    const source = await fetchSource(client, dep.name, objectType, cachingLayer);
    const contract = extractContract(source, dep.name, objectType, abaplintVersion);
    // Store full source for recursive dependency extraction
    contract.fullSource = source;
    return contract;
  } catch (err) {
    return {
      name: dep.name,
      type: 'UNKNOWN',
      methodCount: 0,
      source: '',
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Infer the object type from the dependency kind and naming convention.
 */
export function inferObjectType(dep: Dependency): 'CLAS' | 'INTF' | 'FUNC' | 'UNKNOWN' {
  // Function calls are always function modules
  if (dep.kind === 'function_call') return 'FUNC';

  // Interface usage → interface
  if (dep.kind === 'interface') return 'INTF';

  const upper = dep.name.toUpperCase();

  // Naming conventions
  if (/^[ZY]?IF_/i.test(upper) || /^IF_/i.test(upper)) return 'INTF';
  if (/^\/\w+\/IF_/i.test(upper)) return 'INTF'; // Namespaced interface like /DMO/IF_*
  if (/^[ZY]?CL_/i.test(upper) || /^CL_/i.test(upper)) return 'CLAS';
  if (/^\/\w+\/CL_/i.test(upper)) return 'CLAS'; // Namespaced class
  if (/^[ZY]?CX_/i.test(upper) || /^CX_/i.test(upper)) return 'CLAS'; // Exception classes
  if (/^\/\w+\/CX_/i.test(upper)) return 'CLAS'; // Namespaced exception

  // Default: assume class
  return 'CLAS';
}

/**
 * Fetch source code for a dependency from the SAP system (with cache support).
 */
async function fetchSource(
  client: AdtClient,
  name: string,
  type: 'CLAS' | 'INTF' | 'FUNC' | 'UNKNOWN',
  cachingLayer?: CachingLayer,
): Promise<string> {
  // Helper: get source with cache
  const cachedGet = async (
    objType: string,
    objName: string,
    fetcher: (ifNoneMatch?: string) => Promise<SourceReadResult>,
  ): Promise<string> => {
    if (!cachingLayer) return readResultSource(await fetcher());
    const { source } = await cachingLayer.getSource(objType, objName, fetcher);
    return source;
  };

  switch (type) {
    case 'CLAS':
      return cachedGet('CLAS', name, (ifNoneMatch) => client.getClass(name, undefined, { ifNoneMatch }));
    case 'INTF':
      return cachedGet('INTF', name, (ifNoneMatch) => client.getInterface(name, { ifNoneMatch }));
    case 'FUNC': {
      // Use cached func group resolution if available
      if (cachingLayer) {
        const group = await cachingLayer.resolveFuncGroup(client, name);
        if (group) {
          return cachedGet('FUNC', name, (ifNoneMatch) => client.getFunction(group, name, { ifNoneMatch }));
        }
        throw new Error(`Cannot determine function group for ${name}`);
      }
      // Original fallback: search for function group
      const results = await client.searchObject(name, 5);
      const fmResult = results.find(
        (r) => r.objectName.toUpperCase() === name.toUpperCase() && r.objectType?.includes('FUNC'),
      );
      if (fmResult) {
        // Extract function group from URI: .../groups/<group>/fmodules/<name>
        const match = fmResult.uri.match(/groups\/([^/]+)/);
        if (match) {
          return readResultSource(await client.getFunction(match[1], name));
        }
      }
      // Fallback: try all search results for a URI match
      for (const r of results) {
        const match = r.uri.match(/groups\/([^/]+)\/fmodules/);
        if (match) {
          return readResultSource(await client.getFunction(match[1], name));
        }
      }
      throw new Error(`Cannot determine function group for ${name}`);
    }
    default:
      // Try as class first, then interface
      try {
        return await cachedGet('CLAS', name, (ifNoneMatch) => client.getClass(name, undefined, { ifNoneMatch }));
      } catch {
        return cachedGet('INTF', name, (ifNoneMatch) => client.getInterface(name, { ifNoneMatch }));
      }
  }
}

/**
 * Format the final context result with prologue.
 */
function formatResult(
  objectName: string,
  objectType: string,
  depsFound: number,
  contracts: Contract[],
  _totalFiltered: number,
): ContextResult {
  const successful = contracts.filter((c) => c.success);
  const failed = contracts.filter((c) => !c.success);

  const lines: string[] = [];
  lines.push(
    `* === Dependency context for ${objectName} (${successful.length} deps resolved${failed.length > 0 ? `, ${failed.length} failed` : ''}) ===`,
  );
  lines.push('');

  for (const contract of successful) {
    const typeLabel = contract.type.toLowerCase();
    const methodLabel = contract.methodCount > 0 ? `, ${contract.methodCount} methods` : '';
    lines.push(`* --- ${contract.name} (${typeLabel}${methodLabel}) ---`);
    lines.push(contract.source.trim());
    lines.push('');
  }

  if (failed.length > 0) {
    lines.push('* --- Failed dependencies ---');
    for (const f of failed) {
      lines.push(`* ${f.name}: ${f.error}`);
    }
    lines.push('');
  }

  const totalLines = lines.length;
  lines.push(
    `* Stats: ${depsFound} deps found, ${successful.length} resolved, ${failed.length} failed, ${totalLines} lines`,
  );

  return {
    objectName,
    objectType,
    depsFound,
    depsResolved: successful.length,
    depsFiltered: depsFound - contracts.length,
    depsFailed: failed.length,
    totalLines,
    output: lines.join('\n'),
  };
}

// ─── CDS Context Compression ───────────────────────────────────────

/** Resolved CDS dependency with fetched source */
interface CdsResolvedDep {
  name: string;
  kind: CdsDependency['kind'];
  resolvedType: 'ddls' | 'table' | 'structure';
  source: string;
  success: boolean;
  error?: string;
}

/**
 * Compress dependency context for a CDS entity.
 *
 * Unlike ABAP context (AST-based), CDS context uses regex to extract
 * dependencies from DDL source, then fetches each dependency's source
 * with a type fallback chain: DDLS → TABL (TABL covers both transparent tables and structures).
 *
 * @param client - ADT client for fetching dependency sources
 * @param ddlSource - CDS DDL source code of the target entity
 * @param objectName - CDS entity name
 * @param maxDeps - Maximum dependencies to resolve (default 20)
 * @param depth - Dependency depth 1-3 (default 1)
 * @param cachingLayer - Optional caching layer for source caching
 */
export async function compressCdsContext(
  client: AdtClient,
  ddlSource: string,
  objectName: string,
  maxDeps = DEFAULT_MAX_DEPS,
  depth = DEFAULT_DEPTH,
  cachingLayer?: CachingLayer,
): Promise<ContextResult> {
  const effectiveDepth = Math.min(Math.max(depth, 1), MAX_DEPTH);
  const seen = new Set<string>([objectName.toUpperCase()]);
  const allResolved: CdsResolvedDep[] = [];

  const deps = extractCdsDependencies(ddlSource);

  await resolveCdsDepthLevel(client, deps, maxDeps, effectiveDepth, seen, allResolved, cachingLayer);

  return formatCdsResult(objectName, deps.length, allResolved);
}

/**
 * Resolve one level of CDS dependencies and recurse if needed.
 */
async function resolveCdsDepthLevel(
  client: AdtClient,
  deps: CdsDependency[],
  maxDeps: number,
  depth: number,
  seen: Set<string>,
  resolved: CdsResolvedDep[],
  cachingLayer?: CachingLayer,
): Promise<void> {
  const newDeps = deps.filter((d) => !seen.has(d.name.toUpperCase()));
  for (const dep of newDeps) {
    seen.add(dep.name.toUpperCase());
  }
  const limited = newDeps.slice(0, maxDeps);

  // Fetch in bounded parallel batches
  for (let i = 0; i < limited.length; i += MAX_CONCURRENT) {
    const batch = limited.slice(i, i + MAX_CONCURRENT);
    const results = await Promise.all(batch.map((dep) => fetchCdsDependency(client, dep, cachingLayer)));
    resolved.push(...results);
  }

  // Recurse into resolved DDLS sources if depth > 1
  if (depth > 1) {
    for (const r of resolved) {
      if (r.success && r.resolvedType === 'ddls') {
        const subDeps = extractCdsDependencies(r.source);
        const unseenSubDeps = subDeps.filter((d) => !seen.has(d.name.toUpperCase()));
        if (unseenSubDeps.length > 0) {
          await resolveCdsDepthLevel(client, unseenSubDeps, maxDeps, depth - 1, seen, resolved, cachingLayer);
        }
      }
    }
  }
}

/**
 * Fetch a single CDS dependency's source with type fallback.
 * Try DDLS first (another CDS view), then TABL — TABL covers both transparent
 * tables and DDIC structures (they share TADIR R3TR TABL, distinguished by
 * DD02L-TABCLASS). client.getTabl() handles the /tables/→/structures/ fallback
 * internally, so a separate STRU branch is no longer needed.
 * With caching: also caches which type succeeded to avoid future fallback attempts.
 */
async function fetchCdsDependency(
  client: AdtClient,
  dep: CdsDependency,
  cachingLayer?: CachingLayer,
): Promise<CdsResolvedDep> {
  // Helper: get source with cache
  const cachedGet = async (
    objType: string,
    objName: string,
    fetcher: (ifNoneMatch?: string) => Promise<SourceReadResult>,
  ): Promise<string> => {
    if (!cachingLayer) return readResultSource(await fetcher());
    const { source } = await cachingLayer.getSource(objType, objName, fetcher);
    return source;
  };

  // Try DDLS first
  try {
    const source = await cachedGet('DDLS', dep.name, (ifNoneMatch) => client.getDdls(dep.name, { ifNoneMatch }));
    return { name: dep.name, kind: dep.kind, resolvedType: 'ddls', source, success: true };
  } catch {
    // Not a DDLS — try TABL (covers both transparent tables and structures)
  }

  try {
    const source = await cachedGet('TABL', dep.name, (ifNoneMatch) => client.getTabl(dep.name, { ifNoneMatch }));
    return { name: dep.name, kind: dep.kind, resolvedType: 'table', source, success: true };
  } catch (err) {
    return {
      name: dep.name,
      kind: dep.kind,
      resolvedType: 'ddls',
      source: '',
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Format CDS context result with prologue.
 */
function formatCdsResult(objectName: string, depsFound: number, resolved: CdsResolvedDep[]): ContextResult {
  const successful = resolved.filter((r) => r.success);
  const failed = resolved.filter((r) => !r.success);

  const lines: string[] = [];
  lines.push(
    `* === CDS dependency context for ${objectName} (${successful.length} deps resolved${failed.length > 0 ? `, ${failed.length} failed` : ''}) ===`,
  );
  lines.push('');

  for (const r of successful) {
    lines.push(`* --- ${r.name} (${r.resolvedType}, ${r.kind}) ---`);
    lines.push(r.source.trim());
    lines.push('');
  }

  if (failed.length > 0) {
    lines.push('* --- Failed dependencies ---');
    for (const f of failed) {
      lines.push(`* ${f.name}: ${f.error}`);
    }
    lines.push('');
  }

  const totalLines = lines.length;
  lines.push(
    `* Stats: ${depsFound} deps found, ${successful.length} resolved, ${failed.length} failed, ${totalLines} lines`,
  );

  return {
    objectName,
    objectType: 'DDLS',
    depsFound,
    depsResolved: successful.length,
    depsFiltered: depsFound - resolved.length,
    depsFailed: failed.length,
    totalLines,
    output: lines.join('\n'),
  };
}
