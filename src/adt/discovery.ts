import { logger } from '../server/logger.js';
import { AdtApiError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import type { DiscoveryMap } from './types.js';
import { parseDiscoveryDocument } from './xml-parser.js';

export interface DiscoveryFetchResult {
  map: DiscoveryMap;
  /** True when the discovery document contains any NHI (Native HANA Integration) endpoint. */
  nhiPresent: boolean;
}

/**
 * Return true when the raw ADT discovery XML contains at least one NHI collection href.
 * NHI (/sap/bc/adt/nhi/*) workspaces are only registered on HANA-based systems.
 *
 * The match is anchored to an `href="..."` attribute so that mentions of the path in
 * `<atom:title>` text, descriptions, or non-href attributes do not false-positive.
 * The optional `https://host` prefix lets us still match the rare absolute-URL form some
 * SAP servers emit. Namespace prefix on the surrounding element is irrelevant.
 *
 * Exported for unit testing.
 */
export function hasNhiWorkspace(xml: string): boolean {
  return /href\s*=\s*["'](?:https?:\/\/[^"'/]+)?\/sap\/bc\/adt\/nhi\//i.test(xml);
}

/**
 * Fetch ADT discovery service document.
 *
 * Graceful degradation: never throws, always returns a result.
 */
export async function fetchDiscoveryDocument(client: AdtHttpClient): Promise<DiscoveryFetchResult> {
  try {
    const resp = await client.get('/sap/bc/adt/discovery', { Accept: 'application/atomsvc+xml' }, { probe: true });
    return { map: parseDiscoveryDocument(resp.body), nhiPresent: hasNhiWorkspace(resp.body) };
  } catch (err) {
    const reason =
      err instanceof AdtApiError
        ? `HTTP ${err.statusCode}`
        : err instanceof Error
          ? err.message
          : String(err ?? 'unknown');
    logger.warn(`ADT discovery unavailable (${reason}) — continuing without proactive MIME negotiation`);
    return { map: new Map(), nhiPresent: false };
  }
}

/** Resolve best matching Accept type for a request path. */
export function resolveAcceptType(discoveryMap: DiscoveryMap, path: string): string | undefined {
  const types = resolveTypesForPath(discoveryMap, path);
  return types?.[0];
}

/** Resolve best matching Content-Type for a request path. */
export function resolveContentType(discoveryMap: DiscoveryMap, path: string): string | undefined {
  const types = resolveTypesForPath(discoveryMap, path);
  return types?.[0];
}

function resolveTypesForPath(discoveryMap: DiscoveryMap, rawPath: string): string[] | undefined {
  if (discoveryMap.size === 0) return undefined;

  const path = normalizeRequestPath(rawPath);
  if (!path) return undefined;

  let matchedPath: string | undefined;
  for (const key of discoveryMap.keys()) {
    if (!isShallowMatch(key, path)) continue;
    if (!matchedPath || key.length > matchedPath.length) {
      matchedPath = key;
    }
  }

  return matchedPath ? discoveryMap.get(matchedPath) : undefined;
}

function normalizeRequestPath(rawPath: string): string {
  if (!rawPath) return '';

  let path = rawPath.trim();
  if (!path) return '';

  if (/^https?:\/\//i.test(path)) {
    try {
      const url = new URL(path);
      path = url.pathname;
    } catch {
      return '';
    }
  }

  const hashIdx = path.indexOf('#');
  if (hashIdx >= 0) {
    path = path.slice(0, hashIdx);
  }

  const queryIdx = path.indexOf('?');
  if (queryIdx >= 0) {
    path = path.slice(0, queryIdx);
  }

  if (!path.startsWith('/')) {
    path = `/${path}`;
  }

  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }

  return path;
}

/**
 * Match if path is the collection itself or at most one segment deeper (object name).
 *
 * Discovery MIME types describe the collection endpoint (e.g., /sap/bc/adt/oo/classes).
 * They apply to the collection and to direct child resources (object metadata reads/writes),
 * but NOT to deeper sub-resources like /source/main or /includes/testclasses — those
 * require different Accept headers (typically text/plain or *\/*).
 *
 * Examples for collection "/sap/bc/adt/oo/classes":
 *   ✓ /sap/bc/adt/oo/classes                        (exact)
 *   ✓ /sap/bc/adt/oo/classes/ZCL_FOO                (1 segment deeper — metadata)
 *   ✗ /sap/bc/adt/oo/classes/ZCL_FOO/source/main    (3 segments deeper — source code)
 *   ✗ /sap/bc/adt/oo/classes/ZCL_FOO/includes/defs  (3 segments deeper — includes)
 */
function isShallowMatch(collectionPath: string, requestPath: string): boolean {
  if (requestPath === collectionPath) return true;
  if (!requestPath.startsWith(`${collectionPath}/`)) return false;
  // Check depth: only allow one additional segment after the collection path
  const remainder = requestPath.slice(collectionPath.length + 1);
  return !remainder.includes('/');
}
