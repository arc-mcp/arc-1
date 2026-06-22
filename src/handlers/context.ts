/**
 * SAPContext handler — object context: relatives, hierarchy, method listings, CDS upstream/
 * downstream dependency analysis.
 */

import {
  buildSiblingExtensionFinding,
  classifyCdsImpact,
  deriveSiblingStem,
  isSiblingNameMatch,
  type SiblingExtensionCandidate,
} from '../adt/cds-impact.js';
import type { AdtClient, SourceReadResult } from '../adt/client.js';
import { findWhereUsed } from '../adt/codeintel.js';
import { decodeKtdText } from '../adt/ddic-xml.js';
import { AdtApiError, isNotFoundError } from '../adt/errors.js';
import { mapSapReleaseToAbaplintVersion } from '../adt/features.js';
import type { CachingLayer } from '../cache/caching-layer.js';
import { extractCdsDependencies } from '../context/cds-deps.js';
import { compressCdsContext, compressContext } from '../context/compressor.js';
import { logger } from '../server/logger.js';
import { type CacheSecurityContext, contextCacheForDependencyPayloads } from './cache-security.js';
import { cachedFeatures } from './feature-cache.js';
import { normalizeObjectType, objectUrlForType } from './object-types.js';
import { errorResult, type ToolResult, textResult } from './shared.js';

// ─── SAPContext Handler ───────────────────────────────────────────────

const DEFAULT_SIBLING_MAX_CANDIDATES = 4;
const HARD_MAX_SIBLING_MAX_CANDIDATES = 10;

function parseSiblingMaxCandidates(value: unknown): number {
  const parsed = Number(value ?? DEFAULT_SIBLING_MAX_CANDIDATES);
  if (!Number.isFinite(parsed)) return DEFAULT_SIBLING_MAX_CANDIDATES;
  const rounded = Math.trunc(parsed);
  return Math.min(Math.max(rounded, 1), HARD_MAX_SIBLING_MAX_CANDIDATES);
}

export async function handleSAPContext(
  client: AdtClient,
  args: Record<string, unknown>,
  cachingLayer: CachingLayer | undefined,
  cacheSecurity: CacheSecurityContext,
): Promise<ToolResult> {
  const action = String(args.action ?? '');
  // action="impact" is DDLS-only on the server side — default the type so LLMs
  // don't have to supply it redundantly (and don't get a validation retry when
  // they don't). Any non-DDLS value still fails the guardrail below.
  const rawType = String(args.type ?? '');
  const type = normalizeObjectType(rawType || (action === 'impact' ? 'DDLS' : ''));
  const name = String(args.name ?? '');
  // Bound dependency fan-out: a huge maxDeps would fan out unbounded SAP fetches per level
  // (depth is already capped at 3). Clamp to [1, 100]; non-finite/<1 falls back to the default 20.
  const rawMaxDeps = Number(args.maxDeps ?? 20);
  const maxDeps = Number.isFinite(rawMaxDeps) && rawMaxDeps >= 1 ? Math.min(Math.floor(rawMaxDeps), 100) : 20;
  const depth = Math.min(Math.max(Number(args.depth ?? 1), 1), 3);

  // ─── Reverse dep lookup (pre-warmer only) ─────────────────────────
  if (action === 'usages') {
    if (!name) return errorResult('"name" is required for usages action.');
    if (cacheSecurity.isPerUserClient) {
      return errorResult(
        'SAPContext(action="usages") is disabled under principal propagation because it reads the shared warmup index. ' +
          `Use SAPNavigate(action="references", type="${type || 'CLAS'}", name="${name}") for a live SAP-authorized lookup.`,
      );
    }
    if (!cachingLayer) {
      return errorResult(
        'Reverse dependency lookup requires object caching. Cache is disabled (ARC1_CACHE=none). ' +
          'Enable caching and run cache warmup to use this feature.',
      );
    }
    const usages = cachingLayer.getUsages(name);
    if (usages === null) {
      return errorResult(
        `Reverse dependency lookup requires a pre-warmed cache. The cache warmup has not been run yet.\n\n` +
          `To enable this feature:\n` +
          `1. Start ARC-1 with --cache-warmup (or set ARC1_CACHE_WARMUP=true)\n` +
          `2. Wait for the warmup to complete (indexes all custom objects)\n` +
          `3. Then retry SAPContext(action="usages", name="${name}")\n\n` +
          `Alternative: Use SAPNavigate(action="references", type="CLAS", name="${name}") for a live ADT lookup (slower, but works without warmup).`,
      );
    }
    if (usages.length === 0) {
      return textResult(`No objects found that depend on "${name}" in the cached index.`);
    }
    return textResult(JSON.stringify({ name, usageCount: usages.length, usages }, null, 2));
  }

  if (!type || !name) {
    return errorResult('Both "type" and "name" are required for SAPContext.');
  }

  // Helper: get source with cache support
  const cachedGet = async (
    objType: string,
    objName: string,
    fetcher: (ifNoneMatch?: string) => Promise<SourceReadResult>,
  ): Promise<string> => {
    if (!cachingLayer) return (await fetcher()).source;
    const { source } = await cachingLayer.getSource(objType, objName, fetcher);
    return source;
  };

  if (action === 'impact') {
    if (type !== 'DDLS') {
      return errorResult(
        'SAPContext(action="impact") supports DDLS only. For non-CDS objects, use SAPNavigate(action="references").',
      );
    }

    const ddlSource = await cachedGet('DDLS', name, (ifNoneMatch) => client.getDdls(name, { ifNoneMatch }));
    const upstream = buildCdsUpstream(extractCdsDependencies(ddlSource));
    const includeIndirect = args.includeIndirect === true;
    const siblingCheck = args.siblingCheck !== false;
    const siblingMaxCandidates = parseSiblingMaxCandidates(args.siblingMaxCandidates);
    let downstream = classifyCdsImpact([], { includeIndirect });
    const warnings: string[] = [];
    const consistencyHints: string[] = [];
    let siblingExtensionAnalysis:
      | {
          enabled: boolean;
          stem: string;
          searchQuery: string;
          includeIndirect: boolean;
          maxCandidates: number;
          filters: {
            samePackage: boolean;
            siblingStem: string;
          };
          target: {
            name: string;
            packageName?: string;
            metadataExtensions: number;
          };
          consideredCandidates: number;
          checkedCandidates: Array<SiblingExtensionCandidate & { downstreamTotal: number }>;
          skipped: {
            self: number;
            nonDdls: number;
            packageMismatch: number;
            nameMismatch: number;
            overLimit: number;
          };
        }
      | undefined;

    try {
      const whereUsed = await findWhereUsed(client.http, client.safety, objectUrlForType('DDLS', name));
      downstream = classifyCdsImpact(whereUsed, { includeIndirect });
    } catch (err) {
      if (err instanceof AdtApiError && [404, 405, 415, 501].includes(err.statusCode)) {
        warnings.push('Where-used endpoint not available on this system');
      } else {
        throw err;
      }
    }

    if (siblingCheck && warnings.length === 0) {
      try {
        const targetName = name.toUpperCase();
        const stem = deriveSiblingStem(targetName);
        // Guard against over-broad sibling searches for short/degenerate stems
        // (e.g., target "Z1" -> stem "Z" -> searchQuery "Z*" would scan the full Z namespace).
        if (stem.length < 3) {
          warnings.push(
            `Sibling consistency check skipped: derived stem "${stem}" is too short to identify siblings safely.`,
          );
        } else {
          const targetMatches = await client.searchObject(targetName, 25);
          const targetMatch = targetMatches.find(
            (candidate) =>
              normalizeObjectType(candidate.objectType) === 'DDLS' && candidate.objectName.toUpperCase() === targetName,
          );
          const targetPackageName = targetMatch?.packageName;

          if (!targetPackageName) {
            warnings.push(`Sibling consistency check skipped: could not resolve package for DDLS "${targetName}".`);
          } else {
            const searchQuery = `${stem}*`;
            const searchMaxResults = Math.min(100, Math.max(siblingMaxCandidates * 4, siblingMaxCandidates + 4));
            const siblingCandidates = await client.searchObject(searchQuery, searchMaxResults);
            const skipped = {
              self: 0,
              nonDdls: 0,
              packageMismatch: 0,
              nameMismatch: 0,
              overLimit: 0,
            };
            const filteredCandidates: Array<{ name: string; packageName: string }> = [];
            const seenNames = new Set<string>();

            for (const candidate of siblingCandidates) {
              if (normalizeObjectType(candidate.objectType) !== 'DDLS') {
                skipped.nonDdls += 1;
                continue;
              }

              const candidateName = candidate.objectName.toUpperCase();
              if (candidateName === targetName) {
                skipped.self += 1;
                continue;
              }
              if (candidate.packageName !== targetPackageName) {
                skipped.packageMismatch += 1;
                continue;
              }
              if (!isSiblingNameMatch(targetName, candidateName, stem)) {
                skipped.nameMismatch += 1;
                continue;
              }
              if (seenNames.has(candidateName)) {
                continue;
              }
              seenNames.add(candidateName);
              filteredCandidates.push({ name: candidateName, packageName: candidate.packageName });
            }

            const selectedCandidates = filteredCandidates.slice(0, siblingMaxCandidates);
            skipped.overLimit = Math.max(filteredCandidates.length - selectedCandidates.length, 0);

            const checkedCandidates: Array<SiblingExtensionCandidate & { downstreamTotal: number }> = [];
            let skippedWhereUsedCandidates = 0;

            for (const candidate of selectedCandidates) {
              try {
                const siblingWhereUsed = await findWhereUsed(
                  client.http,
                  client.safety,
                  objectUrlForType('DDLS', candidate.name),
                );
                const siblingDownstream = classifyCdsImpact(siblingWhereUsed, { includeIndirect });
                checkedCandidates.push({
                  name: candidate.name,
                  packageName: candidate.packageName,
                  metadataExtensions: siblingDownstream.metadataExtensions.length,
                  downstreamTotal: siblingDownstream.summary.total,
                });
              } catch (err) {
                if (err instanceof AdtApiError && [404, 405, 415, 501].includes(err.statusCode)) {
                  skippedWhereUsedCandidates += 1;
                  continue;
                }
                throw err;
              }
            }

            if (skippedWhereUsedCandidates > 0) {
              warnings.push(
                `Sibling consistency check skipped ${skippedWhereUsedCandidates} candidate(s) due to where-used endpoint errors.`,
              );
            }

            const siblingFinding = buildSiblingExtensionFinding({
              targetName,
              targetPackageName,
              stem,
              targetMetadataExtensions: downstream.metadataExtensions.length,
              siblings: checkedCandidates,
            });
            if (siblingFinding) {
              consistencyHints.push(siblingFinding.message);
            }

            siblingExtensionAnalysis = {
              enabled: true,
              stem,
              searchQuery,
              includeIndirect,
              maxCandidates: siblingMaxCandidates,
              filters: {
                samePackage: true,
                siblingStem: stem,
              },
              target: {
                name: targetName,
                packageName: targetPackageName,
                metadataExtensions: downstream.metadataExtensions.length,
              },
              consideredCandidates: filteredCandidates.length,
              checkedCandidates,
              skipped,
            };
          }
        }
      } catch (err) {
        logger.debug('Sibling consistency check aborted', {
          name,
          error: err instanceof Error ? err.message : String(err),
        });
        warnings.push('Sibling consistency check skipped due to search or where-used processing errors.');
      }
    }

    const upstreamCount =
      upstream.tables.length + upstream.views.length + upstream.associations.length + upstream.compositions.length;

    const response = {
      name,
      type: 'DDLS',
      upstream,
      downstream,
      summary: {
        upstreamCount,
        downstreamTotal: downstream.summary.total,
        downstreamDirect: downstream.summary.direct,
      },
      ...(consistencyHints.length > 0 ? { consistencyHints } : {}),
      ...(siblingExtensionAnalysis ? { siblingExtensionAnalysis } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    };

    return textResult(JSON.stringify(response, null, 2));
  }

  // Get source — either provided or fetched from SAP
  let source: string;
  const shouldIncludeKtd = args.includeKtd !== false && !args.source && (action === '' || action === 'deps');
  if (args.source) {
    source = String(args.source);
  } else {
    switch (type) {
      case 'CLAS':
        source = await cachedGet('CLAS', name, (ifNoneMatch) => client.getClass(name, undefined, { ifNoneMatch }));
        break;
      case 'INTF':
        source = await cachedGet('INTF', name, (ifNoneMatch) => client.getInterface(name, { ifNoneMatch }));
        break;
      case 'PROG':
        source = await cachedGet('PROG', name, (ifNoneMatch) => client.getProgram(name, { ifNoneMatch }));
        break;
      case 'FUNC': {
        const group = String(args.group ?? '');
        if (!group) {
          return errorResult(
            'The "group" parameter is required for FUNC type. Use SAPSearch to find the function group.',
          );
        }
        source = await cachedGet('FUNC', name, (ifNoneMatch) => client.getFunction(group, name, { ifNoneMatch }));
        break;
      }
      case 'DDLS': {
        const ddlSource = await cachedGet('DDLS', name, (ifNoneMatch) => client.getDdls(name, { ifNoneMatch }));
        const cdsResult = await compressCdsContext(
          client,
          ddlSource,
          name,
          maxDeps,
          depth,
          contextCacheForDependencyPayloads(cachingLayer, cacheSecurity),
        );
        const ktdMarkdown = shouldIncludeKtd ? await readKtdMarkdown(client, name, cachingLayer) : undefined;
        return textResult(prependKtd(cdsResult.output, name, ktdMarkdown));
      }
      default:
        return errorResult(`SAPContext supports types: CLAS, INTF, PROG, FUNC, DDLS. Got: ${type}`);
    }
  }

  const ktdMarkdown = shouldIncludeKtd ? await readKtdMarkdown(client, name, cachingLayer) : undefined;

  // Check dep graph cache — if source hash matches, return cached contracts
  const dependencyPayloadCache = contextCacheForDependencyPayloads(cachingLayer, cacheSecurity);
  if (dependencyPayloadCache) {
    const cachedGraph = dependencyPayloadCache.getCachedDepGraph(source);
    if (cachedGraph) {
      const successful = cachedGraph.contracts.filter((c) => c.success);
      const failed = cachedGraph.contracts.filter((c) => !c.success);
      const lines: string[] = [];
      lines.push(
        `* === Dependency context for ${name} (${successful.length} deps resolved${failed.length > 0 ? `, ${failed.length} failed` : ''}) [cached] ===`,
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
        `* Stats: ${successful.length + failed.length} deps found, ${successful.length} resolved, ${failed.length} failed, ${totalLines} lines [from cache]`,
      );
      return textResult(prependKtd(lines.join('\n'), name, ktdMarkdown));
    }
  }

  // Use detected ABAP version from probe if available, otherwise Cloud (superset)
  const abaplintVersion = cachedFeatures?.abapRelease
    ? mapSapReleaseToAbaplintVersion(cachedFeatures.abapRelease)
    : undefined;

  const result = await compressContext(
    client,
    source,
    name,
    type,
    maxDeps,
    depth,
    abaplintVersion,
    dependencyPayloadCache,
  );
  return textResult(prependKtd(result.output, name, ktdMarkdown));
}

async function readKtdMarkdown(
  client: AdtClient,
  name: string,
  cachingLayer: CachingLayer | undefined,
): Promise<string | undefined> {
  try {
    const envelope = cachingLayer
      ? (
          await cachingLayer.getSource('SKTD', name, (ifNoneMatch) =>
            client.getKtd(name, { ifNoneMatch, version: 'active' }),
          )
        ).source
      : (await client.getKtd(name, { version: 'active' })).source;
    const markdown = decodeKtdText(envelope).trim();
    return markdown.length > 0 ? markdown : undefined;
  } catch (err) {
    if (isNotFoundError(err)) return undefined;
    throw err;
  }
}

function prependKtd(output: string, name: string, ktdMarkdown: string | undefined): string {
  if (!ktdMarkdown) return output;
  return `* === Knowledge Transfer Document for ${name} ===\n\n${ktdMarkdown}\n\n${output}`;
}

function buildCdsUpstream(
  deps: Array<{
    name: string;
    kind: 'data_source' | 'association' | 'composition' | 'projection_base';
  }>,
): {
  tables: Array<{ name: string }>;
  views: Array<{ name: string }>;
  associations: Array<{ name: string }>;
  compositions: Array<{ name: string }>;
} {
  const tableNames = new Set<string>();
  const viewNames = new Set<string>();
  const associationNames = new Set<string>();
  const compositionNames = new Set<string>();

  for (const dep of deps) {
    const upperName = dep.name.toUpperCase();
    if (dep.kind === 'association') {
      associationNames.add(upperName);
      continue;
    }
    if (dep.kind === 'composition') {
      compositionNames.add(upperName);
      continue;
    }
    if (dep.kind === 'projection_base') {
      viewNames.add(upperName);
      continue;
    }
    if (isLikelyCdsViewName(upperName)) {
      viewNames.add(upperName);
    } else {
      tableNames.add(upperName);
    }
  }

  return {
    tables: [...tableNames].sort().map((name) => ({ name })),
    views: [...viewNames].sort().map((name) => ({ name })),
    associations: [...associationNames].sort().map((name) => ({ name })),
    compositions: [...compositionNames].sort().map((name) => ({ name })),
  };
}

function isLikelyCdsViewName(name: string): boolean {
  if (name.startsWith('/')) {
    return /\/[ICRPAZ][A-Z0-9_]*_/.test(name);
  }
  return /^(ZI_|ZC_|ZR_|ZP_|I_|C_|R_|P_)/.test(name);
}
