import { type AdtClient, clampSearchResults } from '../adt/client.js';
import {
  findInterfaceImplementersViaSeoMetaRel,
  findReferences,
  findWhereUsed,
  type ReferenceResult,
  type WhereUsedResult,
} from '../adt/codeintel.js';
import { AdtApiError } from '../adt/errors.js';
import { isOperationAllowed, OperationType } from '../adt/safety.js';
import { normalizeObjectType, objectUrlForType } from './object-types.js';

export type LiveUsageResult = WhereUsedResult | ReferenceResult;

/** Default page size for where-used. A bare lookup on a common type returns thousands of rows
 *  (CL_ABAP_TYPEDESCR: 6,644 refs ≈ 968k tokens) — far past any context window. */
const DEFAULT_USAGE_RESULTS = 100;

export interface LiveUsageLookup {
  /** At most `maxResults` entries. */
  results: LiveUsageResult[];
  /** Matches after objectType filtering, BEFORE slicing — what makes a truncated page honest. */
  total: number;
  truncated: boolean;
  fallbackUsed: boolean;
}

/** Match a result's ADT type against a filter: "CLAS" matches "CLAS/OC", "CLAS/OC" matches exactly.
 *  Trimmed — a padded `" CLAS "` would otherwise match nothing and read as "no references found". */
function matchesObjectType(resultType: string, filter: string): boolean {
  const type = resultType.trim().toUpperCase();
  const wanted = filter.trim().toUpperCase();
  return type === wanted || type.startsWith(`${wanted}/`);
}

/** Resolve the canonical ADT object URI used by the where-used APIs. */
export async function resolveWhereUsedUri(
  client: AdtClient,
  objectType: string,
  objectName: string,
): Promise<string | null> {
  const type = normalizeObjectType(objectType);
  const name = objectName.toUpperCase();
  if (type === 'FUNC') {
    const group = await client.resolveFunctionGroup(name);
    return group
      ? `/sap/bc/adt/functions/groups/${encodeURIComponent(group)}/fmodules/${encodeURIComponent(name)}`
      : null;
  }
  if (type === 'TABL') {
    return client.resolveTablObjectUrl(name);
  }
  return objectUrlForType(type, name);
}

/**
 * Run the live SAP-authorized where-used lookup shared by SAPNavigate.references and
 * SAPContext.usages. Older systems fall back to the simple references endpoint.
 *
 * Filtering and paging are both client-side: SAP's `usageReferences` endpoint declares only
 * `{?uri}` and ignores every limit/filter we can send — `objectTypeFilter` in the body, and
 * `maxResults`/`maxItemCount`/`searchFromIndex` as query params all return byte-identical
 * responses (verified live on 758, 9 variants). So the full set always crosses the wire; we bound
 * what reaches the model, not what SAP computes.
 */
export async function lookupLiveUsages(
  client: AdtClient,
  uri: string,
  objectType?: string,
  maxResults?: number,
): Promise<LiveUsageLookup> {
  // Normalize the filter ONCE, at the entry, and use only this value below. A whitespace-only filter
  // means "no filter" (matching the empty type would match nothing and read as "No references
  // found"). Trimming here rather than at the comparison is what keeps `" CLAS/OC "` behaving like
  // `"CLAS/OC"` for augmentInterfaceImplementers too — its /^CLAS/i check would otherwise skip
  // augmentation for a padded value and silently drop implementers the later filter cannot recover.
  const filter = objectType?.trim() ? objectType.trim() : undefined;

  let results: LiveUsageResult[];
  let fallbackUsed = false;
  try {
    results = await findWhereUsed(client.http, client.safety, uri, filter);
  } catch (err) {
    if (!(err instanceof AdtApiError) || ![404, 405, 415, 501].includes(err.statusCode)) throw err;
    results = await findReferences(client.http, client.safety, uri);
    fallbackUsed = true;
  }

  // Kept outside the try: an augment failure must not be mistaken for a missing where-used endpoint.
  if (!fallbackUsed) {
    await augmentInterfaceImplementers(client, uri, filter, results as WhereUsedResult[]);
  }

  const filtered = filter ? results.filter((result) => matchesObjectType(result.type, filter)) : results;
  const limit = clampSearchResults(maxResults, DEFAULT_USAGE_RESULTS);
  return {
    results: filtered.slice(0, limit),
    total: filtered.length,
    truncated: filtered.length > limit,
    fallbackUsed,
  };
}

async function augmentInterfaceImplementers(
  client: AdtClient,
  uri: string,
  objectType: string | undefined,
  results: WhereUsedResult[],
): Promise<void> {
  const intfMatch = uri.match(/\/sap\/bc\/adt\/oo\/interfaces\/([^/?]+)/i);
  if (!intfMatch || (objectType && !/^CLAS/i.test(objectType))) return;

  const interfaceName = decodeURIComponent(intfMatch[1]!).toUpperCase();
  const canFreeSQL = isOperationAllowed(client.safety, OperationType.FreeSQL);
  const canQuery = isOperationAllowed(client.safety, OperationType.Query);

  try {
    let implementers: WhereUsedResult[] = [];
    if (canFreeSQL) {
      implementers = await findInterfaceImplementersViaSeoMetaRel(
        (sql, max) => client.runQuery(sql, max),
        interfaceName,
      );
    } else if (canQuery) {
      implementers = await findInterfaceImplementersViaSeoMetaRel(
        (_sql, max) => client.getTableContents('SEOMETAREL', max, `REFCLSNAME = '${interfaceName}' AND RELTYPE = '1'`),
        interfaceName,
      );
    }

    const existingNames = new Set(results.map((result) => result.name?.toUpperCase()).filter(Boolean));
    results.push(...implementers.filter((result) => !existingNames.has(result.name.toUpperCase())));
  } catch {
    // Best-effort augmentation: retain the native where-used response when SEOMETAREL is unavailable.
  }
}
