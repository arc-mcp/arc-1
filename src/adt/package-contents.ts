import { AdtError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import { clampUrlLimit } from './result-limits.js';
import { findDeepNodes, parseXml } from './xml-parser.js';

export const DIRECT_PACKAGE_NAME = /^(?=.{1,30}$)(?:\/[A-Z0-9_]+\/)?[A-Z0-9_$]+$/i;
export const DIRECT_PACKAGE_TYPE = /^[A-Z0-9_]{1,8}(?:\/[A-Z0-9_]{1,8})?$/;

/** Require SAP's advertised filter for getPackageContents' request (no objectType/useSearchProvider).
 *  Slash-typed objectType or useSearchProvider overrides can select classic search, which ignores packageName. */
export function supportsPackageFilteredSearch(xml: string): boolean {
  const searchPath = '/sap/bc/adt/repository/informationsystem/search';
  for (const workspace of findDeepNodes(parseXml(xml), 'workspace')) {
    for (const collection of findDeepNodes(workspace, 'collection')) {
      const href = String(collection['@_href'] ?? '');
      if (new URL(href, 'https://adt.invalid').pathname.replace(/\/$/, '') !== searchPath) continue;
      for (const link of findDeepNodes(collection, 'templateLink')) {
        if (link['@_rel'] !== 'http://www.sap.com/adt/relations/informationsystem/search/quicksearch') continue;
        const template = String(link['@_template'] ?? '');
        if (new URL(template.split('{')[0]!, 'https://adt.invalid').pathname !== searchPath) continue;
        if (/[?&,]packageName\*?(?=[,}])/.test(template)) return true;
      }
    }
  }
  return false;
}

export async function requirePackageFilteredSearch(http: AdtHttpClient): Promise<void> {
  const discovery = await http.get('/sap/bc/adt/discovery', { Accept: 'application/atomsvc+xml' });
  if (!supportsPackageFilteredSearch(discovery.body)) {
    throw new AdtError(
      'Package contents are unavailable: this SAP system does not advertise package-filtered ADT search. ' +
        'Use SAPRead type=DEVC with packageScope="direct" for bounded native browsing; an unfiltered search could return unrelated objects.',
    );
  }
}

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
