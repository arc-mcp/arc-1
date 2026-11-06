/**
 * Include-aware repository search filtering.
 *
 * SAP's quickSearch `objectType` filter returns `[]` for include types even for an exact name
 * (live 7.57: INCL and FUGR/I; the unfiltered search finds the same objects typed FUGR/I or
 * PROG/I). Every ARC-1 path that forwards a caller-supplied type to quickSearch therefore drops
 * the filter for these types and applies it to the hits with `filterIncludeHits`.
 */
import type { AdtSearchResult } from './types.js';

const INCLUDE_HIT_TYPES = ['PROG/I', 'FUGR/I'];

/** Types whose server-side quickSearch filter is unreliable. `INCL` is ARC-1's alias for both hit types. */
export function isIncludeSearchType(objectType: string | undefined): boolean {
  const type = objectType?.trim().toUpperCase();
  return type === 'INCL' || INCLUDE_HIT_TYPES.includes(type ?? '');
}

/** Keep the hits matching an include search type; any other type is returned untouched. */
export function filterIncludeHits(hits: AdtSearchResult[], objectType: string | undefined): AdtSearchResult[] {
  if (!isIncludeSearchType(objectType)) return hits;
  const type = (objectType as string).trim().toUpperCase();
  const wanted = type === 'INCL' ? INCLUDE_HIT_TYPES : [type];
  return hits.filter((r) => wanted.includes(r.objectType.toUpperCase()));
}
