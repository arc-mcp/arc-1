import { clampUrlLimit } from './result-limits.js';

/** ADT quick search provides neither a total nor proof of full package coverage. */
export function describePackageListing(returned: number, requested: number | undefined) {
  const effectiveLimit = clampUrlLimit(requested, 200);
  const limitReached = returned >= effectiveLimit;
  return {
    returned,
    effectiveLimit,
    limitReached,
    possiblyTruncated: limitReached,
    completeness: 'unknown' as const,
    total: null,
    coverage: 'adt-search' as const,
    note:
      (limitReached
        ? `Result limit reached; listing may be truncated. ${effectiveLimit < 1000 ? 'Raise maxResults up to 1000 or use targeted SAPSearch queries. ' : 'Use targeted SAPSearch queries. '}`
        : '') + 'ADT search omits many repository object types; this is not a complete package inventory.',
  };
}
