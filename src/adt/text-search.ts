/**
 * ADT repository text-search request and response contract.
 *
 * This lives outside the client facade and the shared XML parser because the
 * endpoint has its own discovery vocabulary, paging model, proxy-URI encoding,
 * and release fallbacks.
 */

import type { AdtHttpClient } from './http.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import type { SourceSearchResult } from './types.js';
import { decodeXmlEntities, findDeepNodes, getNestedArray, parseXml } from './xml-parser.js';

const MAX_SEARCH_RESULTS = 1_000;

/** Coerce a caller-supplied search-result limit into a safe positive integer. */
export function clampSearchResults(requested: number | undefined, fallback: number): number {
  if (requested === undefined || !Number.isFinite(requested) || requested < 1) return fallback;
  return Math.min(Math.floor(requested), MAX_SEARCH_RESULTS);
}

/** Reduce an ADT object type to the short form the text-search filter expects.
 *
 * `/informationsystem/textsearch/objecttypes` advertises each supported type as
 * a named item whose `name` is the short form (`CLAS`) and whose `data` is the
 * slash form (`CLAS/OC`). Function modules are the live-advertised exception to
 * prefix truncation: `FUGR/F` maps to `FUGR`, while `FUGR/FF` maps to `FUNC`.
 */
export function toTextSearchObjectType(objectType: string): string {
  const normalized = String(objectType).trim().toUpperCase();
  if (normalized === 'FUGR/FF') return 'FUNC';
  return normalized.split('/')[0];
}

/** Execute a bounded source search using the lowercase discovery collection. */
export async function searchSource(
  http: AdtHttpClient,
  safety: SafetyConfig,
  pattern: string,
  maxResults = 50,
  objectType?: string,
  packageName?: string,
): Promise<SourceSearchResult[]> {
  checkOperation(safety, OperationType.Search, 'SearchSource');
  const params = new URLSearchParams({
    searchString: pattern,
    searchFromIndex: '1',
    searchToIndex: String(clampSearchResults(maxResults, 50)),
  });
  if (objectType) params.set('objectType', toTextSearchObjectType(objectType));
  if (packageName) params.set('packageName', packageName);
  const response = await http.get(`/sap/bc/adt/repository/informationsystem/textsearch?${params.toString()}`);
  return parseSourceSearchResults(response.body);
}

/** Pull `objectName` out of an ADT proxy-URI mapping. */
function parseProxyUriObjectName(uri: string): string {
  if (!uri) return '';
  const content = /[?&]content=([^&]*)/.exec(uri.replace(/&amp;/g, '&'));
  if (!content) return '';
  let decoded = content[1];
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Malformed percent-encoding — fall through with the raw value.
  }
  const named = /objectName:([^,#]+)/i.exec(decoded);
  const raw = named ? named[1] : decoded.split('#')[0];
  return raw.replace(/=+.*$/, '').trim();
}

/** Pull the 1-based line number out of a text-line proxy URI. */
function parseTextLineNumber(uri: string): number {
  if (!uri) return 0;
  let decoded = uri.replace(/&amp;/g, '&');
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Malformed percent-encoding — fall through with the raw value.
  }
  const match = /#start=(\d+)/.exec(decoded) ?? /\bposition:(\d+)/.exec(decoded);
  return match ? Number(match[1]) : 0;
}

function cleanTextSearchSnippet(raw: unknown): string {
  return decodeXmlEntities(String(raw ?? ''))
    .replace(/<\/?b>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parse live text-search results plus the older object-reference and Atom fallbacks. */
export function parseSourceSearchResults(xml: string): SourceSearchResult[] {
  const parsed = parseXml(xml);
  const results: SourceSearchResult[] = [];

  const searchObjects = findDeepNodes(parsed, 'textSearchObject');
  if (searchObjects.length > 0) {
    for (const obj of searchObjects) {
      const matches = findDeepNodes(obj, 'textLine').map((line) => ({
        line: parseTextLineNumber(String(line['@_uri'] ?? '')),
        snippet: cleanTextSearchSnippet(line.content),
      }));
      // Ancestor nodes provide navigation context but contain no actual hits.
      if (matches.length === 0) continue;

      const uri = decodeXmlEntities(String(obj['@_uri'] ?? ''));
      const mainObject = (obj.adtMainObject ?? {}) as Record<string, unknown>;
      results.push({
        objectType: String(mainObject['@_type'] ?? ''),
        objectName: parseProxyUriObjectName(uri) || String(mainObject['@_name'] ?? ''),
        uri,
        matches,
      });
    }
    return results;
  }

  const refs = getNestedArray(parsed, 'objectReferences', 'objectReference');
  if (refs.length > 0) {
    for (const ref of refs) {
      const matches = findDeepNodes(ref, 'textSearchResult').map((match) => ({
        line: Number(match['@_line'] ?? 0),
        snippet: String(match['@_snippet'] ?? match['#text'] ?? ''),
      }));
      results.push({
        objectType: String(ref['@_type'] ?? ''),
        objectName: String(ref['@_name'] ?? ''),
        uri: String(ref['@_uri'] ?? ''),
        matches,
      });
    }
    return results;
  }

  const entries = getNestedArray(parsed, 'feed', 'entry');
  for (const entry of entries) {
    const uri = String(entry.id ?? entry['@_href'] ?? '');
    const title = String(entry.title ?? '');
    results.push({
      objectType: '',
      objectName: title || uri.split('/').pop() || '',
      uri,
      matches: [],
    });
  }

  if (results.length === 0) {
    for (const node of findDeepNodes(parsed, 'match')) {
      results.push({
        objectType: String(node['@_type'] ?? ''),
        objectName: String(node['@_name'] ?? node['@_objectName'] ?? ''),
        uri: String(node['@_uri'] ?? ''),
        matches: [
          {
            line: Number(node['@_line'] ?? 0),
            snippet: String(node['@_snippet'] ?? node['#text'] ?? ''),
          },
        ],
      });
    }
  }

  return results;
}
