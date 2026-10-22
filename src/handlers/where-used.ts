import { type AdtClient, clampSearchResults } from '../adt/client.js';
import {
  findInterfaceImplementersViaSeoMetaRel,
  findReferences,
  findWhereUsedWithScope,
  type ReferenceResult,
  type WhereUsedResult,
} from '../adt/codeintel.js';
import { DataSourcePolicyError } from '../adt/data-source-policy.js';
import { AdtApiError } from '../adt/errors.js';
import { internalOperationWarning } from '../adt/internal-data-operations.js';
import { isOperationAllowed, OperationType } from '../adt/safety.js';
import { loadNativeUsages, matchesUsageType, type UsageOptions } from '../adt/where-used-native.js';
import { normalizeObjectType, objectUrlForType } from './object-types.js';
import { expandUsageDetails } from './where-used-details.js';

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
  /** Present when an optional internal lookup was denied and the result may be incomplete. */
  warning?: string;
  /** The symbol SAP searched for, from its result scope (absent on the fallback endpoint). */
  searchedFor?: string;
  scopeFiltering?: 'server' | 'client';
  usageDetails?: Awaited<ReturnType<typeof expandUsageDetails>>;
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
 * Legacy filtering and paging are client-side: the older `usageReferences` endpoint declares only
 * `{?uri}` and ignores every limit/filter we can send — `objectTypeFilter` in the body, and
 * `maxResults`/`maxItemCount`/`searchFromIndex` as query params all return byte-identical
 * responses (verified live on 758, 9 variants). So the full set always crosses the wire; we bound
 * what reaches the model, not what SAP computes. SAPNavigate optionally uses native scope
 * on systems advertising it; paging remains client-side.
 */
export async function lookupLiveUsages(
  client: AdtClient,
  uri: string,
  objectType?: string,
  maxResults?: number,
  options?: UsageOptions,
): Promise<LiveUsageLookup> {
  // Normalize the filter ONCE, at the entry, and use only this value below. A whitespace-only filter
  // means "no filter" (matching the empty type would match nothing and read as "No references
  // found"). Trimming here rather than at the comparison is what keeps `" CLAS/OC "` behaving like
  // `"CLAS/OC"` for augmentInterfaceImplementers too — its /^CLAS/i check would otherwise skip
  // augmentation for a padded value and silently drop implementers the later filter cannot recover.
  const filter = objectType?.trim() ? objectType.trim() : undefined;
  const scoped = Boolean(uri.split('#')[1]);

  let results: LiveUsageResult[];
  let searchedFor: string | undefined;
  let referencedObjectIdentifier: string | undefined;
  let fallbackUsed = false;
  let native: Awaited<ReturnType<typeof loadNativeUsages>> | undefined;
  try {
    native =
      options && (options.packages?.length || (options.detail && options.detail !== 'objects'))
        ? await loadNativeUsages(client, uri, options)
        : undefined;
    ({ results, searchedFor, referencedObjectIdentifier } =
      native ?? (await findWhereUsedWithScope(client.http, client.safety, uri, filter)));
  } catch (err) {
    if (
      !(err instanceof AdtApiError) ||
      ![404, 405, 415, 501].includes(err.statusCode) ||
      !/\/usageReferences(?:\?|$)/.test(err.path)
    )
      throw err;
    if (options?.packages?.length)
      throw new Error(
        'This legacy reference endpoint cannot provide package-filtered results. Retry without packages.',
      );
    results = await findReferences(client.http, client.safety, uri);
    fallbackUsed = true;
  }

  // Kept outside the try: an augment failure must not be mistaken for a missing where-used endpoint.
  let warning: string | undefined;
  // Empty also occurs when SAP reports an unsupported search. Require native rows before
  // treating an empty cursor identifier as fallback to the original object.
  if (!fallbackUsed && (!scoped || (referencedObjectIdentifier === '' && results.length > 0))) {
    warning = await augmentInterfaceImplementers(
      client,
      uri,
      filter,
      results as WhereUsedResult[],
      Boolean(options?.packages?.length),
    );
  }
  if (scoped && !searchedFor) {
    const scopeWarning =
      'SAP did not report the searched symbol. Results may refer to the whole object; confirm the scope before using them.';
    warning = warning ? `${warning} ${scopeWarning}` : scopeWarning;
  }

  const filtered = results.filter(
    (result) =>
      (!filter || matchesUsageType(result.type, filter)) &&
      (!options?.packages?.length ||
        (result.type !== 'DEVC/K' &&
          'packageName' in result &&
          options.packages.includes(result.packageName.toUpperCase()))),
  );
  const limit = clampSearchResults(maxResults, DEFAULT_USAGE_RESULTS);
  const usageDetails =
    options?.detail && options.detail !== 'objects'
      ? await expandUsageDetails(
          client,
          results as WhereUsedResult[],
          filter,
          options,
          limit,
          native?.supportsSnippets ?? false,
          native?.deadline ?? Date.now(),
        )
      : undefined;
  return {
    results: filtered.slice(0, limit).map(({ ...row }) => {
      if ('objectIdentifier' in row) delete row.objectIdentifier;
      return row;
    }),
    ...(native && options?.packages?.length ? { scopeFiltering: native.scopeFiltering } : {}),
    ...(usageDetails ? { usageDetails } : {}),
    total: filtered.length,
    truncated: filtered.length > limit,
    fallbackUsed,
    ...(warning ? { warning } : {}),
    ...(searchedFor ? { searchedFor } : {}),
  };
}

async function augmentInterfaceImplementers(
  client: AdtClient,
  uri: string,
  objectType: string | undefined,
  results: WhereUsedResult[],
  packageFiltered: boolean,
): Promise<string | undefined> {
  const intfMatch = uri.match(/\/sap\/bc\/adt\/oo\/interfaces\/([^/?#]+)/i);
  if (!intfMatch || (objectType && !/^CLAS/i.test(objectType))) return undefined;

  const interfaceName = decodeURIComponent(intfMatch[1]!).toUpperCase();
  const canFreeSQL = isOperationAllowed(client.safety, OperationType.FreeSQL);
  const canQuery = isOperationAllowed(client.safety, OperationType.Query);
  if (packageFiltered && (canFreeSQL || canQuery))
    return 'Interface-implementer enrichment was skipped: SEOMETAREL does not provide packages for filtering. Native results are retained.';

  try {
    let implementers: WhereUsedResult[] = [];
    if (canFreeSQL) {
      implementers = await findInterfaceImplementersViaSeoMetaRel(
        (sql, max) => client.runQuery(sql, max),
        interfaceName,
      );
    } else if (canQuery) {
      // Structured query rather than getTableContents(sqlFilter): the filtered DDIC preview is a
      // condition language outside the analyzed subset and is refused whenever the blocklist is
      // active. The structured form is the supported path and expresses the same restriction.
      implementers = await findInterfaceImplementersViaSeoMetaRel(
        (_sql, max) =>
          client.runTableQuery('SEOMETAREL', {
            columns: ['CLSNAME', 'REFCLSNAME', 'RELTYPE'],
            where: [
              { field: 'REFCLSNAME', op: '=', value: interfaceName },
              { field: 'RELTYPE', op: '=', value: '1' },
            ],
            maxRows: max,
          }),
        interfaceName,
      );
    }

    const existingNames = new Set(results.map((result) => result.name?.toUpperCase()).filter(Boolean));
    results.push(...implementers.filter((result) => !existingNames.has(result.name.toUpperCase())));
    return undefined;
  } catch (error) {
    // Optional enrichment: the native where-used response is still correct, but the caller must be
    // TOLD it may be incomplete. A bare catch here would let the model read a short list as
    // authoritative - the exact silent degradation the internal registry exists to prevent.
    return internalOperationWarning(
      'interface_implementers',
      error instanceof DataSourcePolicyError ? error.code : 'the SEOMETAREL lookup failed',
    );
  }
}
