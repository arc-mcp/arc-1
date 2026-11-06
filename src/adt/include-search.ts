/**
 * Native 757/758 quickSearch filters miss function-group includes. INCL means both include
 * families, so INCL and FUGR/I use bounded unfiltered candidates and local type matching.
 * PROG/I's standalone-include filter works on 758 and stays server-side.
 */
import type { AdtSearchResult } from './types.js';

const INCLUDE_HIT_TYPES = ['PROG/I', 'FUGR/I'];

/** Include search types. `INCL` is ARC-1's alias for both hit types. */
export function isIncludeSearchType(objectType: string | undefined): boolean {
  const type = objectType?.trim().toUpperCase();
  return type === 'INCL' || INCLUDE_HIT_TYPES.includes(type ?? '');
}

/** Only these searches need candidates from both repository families. */
export function requiresUnfilteredIncludeSearch(objectType: string | undefined): boolean {
  const type = objectType?.trim().toUpperCase();
  return type === 'INCL' || type === 'FUGR/I';
}

/** Keep the hits matching an include search type; any other type is returned untouched. */
export function filterIncludeHits(hits: AdtSearchResult[], objectType: string | undefined): AdtSearchResult[] {
  if (!isIncludeSearchType(objectType)) return hits;
  const type = (objectType as string).trim().toUpperCase();
  const wanted = type === 'INCL' ? INCLUDE_HIT_TYPES : [type];
  return hits.filter((r) => wanted.includes(r.objectType.toUpperCase()));
}
