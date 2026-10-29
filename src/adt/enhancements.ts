/** ENHO read routing: XHB BAdIs, XHH source plug-ins, the legacy/generic XH route, and the include fallback. */

import { XMLValidator } from 'fast-xml-parser';
import type { AdtClient } from './client.js';
import { enhancementIncludeName, readEnhancementIncludeRevision } from './enhancement-include.js';
import { withFilterConditions } from './enho-filter.js';
import { AdtApiError, AdtError, extractExceptionType } from './errors.js';
import type { AdtRequestOptions } from './http-deadline.js';
import { RevisionHistoryError } from './revision-feed.js';
import { checkOperation, OperationType } from './safety.js';
import type { EnhancementImplementationInfo } from './types.js';
import { getNestedArray, parseEnhancementImplementation, parseXml } from './xml-parser.js';

const ROUTES = {
  'ENHO/XHB': ['enhoxhb', 'application/vnd.sap.adt.enh.enhoxhb.v4+xml'],
  'ENHO/XHH': ['enhoxhh', 'application/vnd.sap.adt.enh.enhoxhh.v3+xml'],
  'ENHO/XH': ['enhoxh', 'application/vnd.sap.adt.enh.enho.v1+xml'],
} as const;
type Subtype = keyof typeof ROUTES;
/** SAP's own failure statuses at an ENHO route; auth, throttling and network errors never reroute. */
const REROUTE_STATUSES = [400, 404, 500];

/** Release-scoped wire evidence; an arbitrary server error never authorizes a source fallback. */
export function enhancementSourceUnavailable(error: unknown, release?: string): boolean {
  if (!(error instanceof AdtApiError)) return false;
  if (error.statusCode === 404) return true;
  if (error.statusCode !== 500) return false;
  const body = error.responseBody ?? '';
  const type = extractExceptionType(body);
  if (type === 'ExceptionResourceReadFailure') return true;
  if (release === '750' && type === 'ExceptionInternalServerError')
    return /Enhancement technology (?:CLASENH|HOOK_IMPL) is not supported yet\./.test(body);
  return (
    release === '758' &&
    type === undefined &&
    /<span id="msgText">Dereferencing of the NULL reference\s*<\/span>/.test(body)
  );
}

/** Read one already discovered ENHO at its exact subtype, with an explicitly active representation. */
export async function readActiveClassEnhancementSource(
  client: Pick<AdtClient, 'http' | 'safety' | 'getRevisions' | 'getRevisionSource'>,
  identity: { name: string; type: string },
  request: AdtRequestOptions,
  expectedOwners: ReadonlyArray<{ name: string; type: string; uri: string }>,
  release?: string,
): Promise<EnhancementImplementationInfo> {
  checkOperation(client.safety, OperationType.Read, 'GetEnhancementImplementation');
  if (!expectedOwners.length) throw new RevisionHistoryError();
  const include = enhancementIncludeName(identity.name);
  if (identity.type !== 'ENHO/XH' && identity.type !== 'ENHO/XHH')
    throw new AdtError('No qualified class enhancement source provider for this native type.');
  const [collection, accept] = ROUTES[identity.type];
  const path = `/sap/bc/adt/enhancements/${collection}/${encodeURIComponent(identity.name.toLowerCase())}`;
  try {
    const xml = (await client.http.get(`${path}?version=active`, { Accept: accept }, request)).body;
    if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new RevisionHistoryError();
    const document = parseXml(xml);
    const metadata = (document.enhancement ?? document.objectData) as Record<string, unknown> | undefined;
    if (metadata?.['@_version'] && metadata['@_version'] !== 'active') throw new RevisionHistoryError();
    let result: EnhancementImplementationInfo;
    try {
      result = parseEnhancementMetadata(xml);
    } catch {
      throw new RevisionHistoryError();
    }
    if (result.name.toUpperCase() !== identity.name.toUpperCase()) throw new RevisionHistoryError();
    if (
      result.enhancedObject &&
      !expectedOwners.some(
        (owner) =>
          result.enhancedObject!.uri === owner.uri &&
          result.enhancedObject!.type === owner.type &&
          result.enhancedObject!.name.toUpperCase() === owner.name.toUpperCase(),
      )
    )
      throw new RevisionHistoryError();
    if (identity.type === 'ENHO/XHH')
      result.source = (
        await client.http.get(`${path}/source/main?version=active`, { Accept: 'text/plain' }, request)
      ).body;
    return result;
  } catch (error) {
    // This path is only for a known class-bound ENHO. Never search/reroute on an unexpected failure.
    if (request.attemptBudget?.authorizationFailureObserved || !enhancementSourceUnavailable(error, release))
      throw error;
    const read = await readEnhancementIncludeRevision(client, include, { ...request, version: 'active' });
    if (!read) throw error;
    return {
      name: identity.name,
      description: '',
      package: '',
      technology: '',
      switchSupported: false,
      badiImplementations: [],
      source: read.source,
      enhancementInclude: { name: read.include, revision: read.revision },
      note: 'Generated active include revision; technology and runtime switch applicability remain unknown.',
    };
  }
}

/**
 * Releases whose ADT serves only the generic `enhoxh` route (SAP_BASIS 750) fail inside SAP for
 * source-code plug-ins; their include's `/source/main` fails as well, but its revision feed still
 * lists the active version. Returns `undefined` when that route fails too, so the caller keeps the
 * original SAP error.
 */
async function readSourcePlugInFromInclude(
  client: Pick<AdtClient, 'getRevisions' | 'getRevisionSource'>,
  name: string,
  attempted: string[],
): Promise<EnhancementImplementationInfo | undefined> {
  const include = enhancementIncludeName(name);
  attempted.push(`programs/includes/${include}/source/main/versions`);
  let read: Awaited<ReturnType<typeof readEnhancementIncludeRevision>>;
  try {
    read = await readEnhancementIncludeRevision(client, include);
  } catch (error) {
    if (error instanceof RevisionHistoryError) return undefined;
    if (error instanceof AdtApiError && REROUTE_STATUSES.includes(error.statusCode)) return undefined;
    throw error;
  }
  if (!read) return undefined;
  return {
    name,
    description: '',
    package: '',
    // Source-code plug-ins and class enhancements both store `ENHANCEMENT n` blocks here; the include
    // does not identify the technology, so it is left empty rather than guessed.
    technology: '',
    switchSupported: false,
    badiImplementations: [],
    source: read.source,
    enhancementInclude: { name: read.include, revision: read.revision },
    note:
      'ADT does not serve this enhancement implementation on this SAP release; source is the active ' +
      'revision of its enhancement include. Technology (source-code plug-in or class enhancement), ' +
      'description, package, enhanced object, hook positions and switch state are not available here — ' +
      'use SE19/SE80 or Eclipse for them.',
  };
}

/** Preserve the existing BAdI payload; source plug-ins additionally expose their hook locations. */
export function parseEnhancementMetadata(xml: string): EnhancementImplementationInfo {
  const parsed = parseXml(xml);
  if (parsed.objectData && typeof parsed.objectData === 'object') {
    return withFilterConditions(parsed, parseEnhancementImplementation(xml));
  }
  const root = parsed.enhancement as Record<string, unknown> | undefined;
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    throw new AdtError('Invalid ENHO metadata: expected objectData or enhancement.');
  }
  const pkg = (root.packageRef ?? {}) as Record<string, unknown>;
  const common = (root.contentCommon ?? {}) as Record<string, unknown>;
  const specific = (root.contentSpecific ?? {}) as Record<string, unknown>;
  const hook = (specific.hookTechnology ?? {}) as Record<string, unknown>;
  const enhanced = (hook.enhancedObject ?? {}) as Record<string, unknown>;
  return {
    name: String(root['@_name'] ?? ''),
    description: String(root['@_description'] ?? ''),
    package: String(pkg['@_name'] ?? ''),
    technology: String(common['@_toolType'] ?? ''),
    switchSupported: String(common['@_switchSupported'] ?? '') === 'true',
    badiImplementations: [],
    enhancedObject: {
      name: String(enhanced['@_name'] ?? ''),
      type: String(enhanced['@_type'] ?? ''),
      uri: String(enhanced['@_uri'] ?? ''),
    },
    hookImplementations: getNestedArray(specific, 'hookTechnology', 'hookImplementation').map((item) => ({
      id: String(item['@_id'] ?? ''),
      spotName: String(item['@_spotname'] ?? ''),
      programName: String(item['@_programname'] ?? ''),
      method: String(item['@_method'] ?? ''),
      overwrite: ['true', 'X'].includes(String(item['@_overwrite'] ?? '')),
      fullName: String(item['@_full_name'] ?? ''),
      description: String(item['@_full_description'] ?? ''),
      uri: String(
        getNestedArray({ item }, 'item', 'link').find((link) => link['@_rel'] === 'enclosure')?.['@_href'] ?? '',
      ),
    })),
  };
}

export async function readEnhancementImplementation(
  client: Pick<AdtClient, 'http' | 'safety' | 'searchObject' | 'getRevisions' | 'getRevisionSource'>,
  name: string,
): Promise<EnhancementImplementationInfo> {
  checkOperation(client.safety, OperationType.Read, 'GetEnhancementImplementation');
  const attempted: string[] = [];
  const pathFor = (subtype: Subtype) => `/sap/bc/adt/enhancements/${ROUTES[subtype][0]}/${encodeURIComponent(name)}`;
  const read = async (subtype: Subtype) => {
    const [collection, accept] = ROUTES[subtype];
    attempted.push(collection);
    // Construct only known endpoints. Repository/source links are data, never request URLs.
    const path = pathFor(subtype);
    const result = parseEnhancementMetadata((await client.http.get(path, { Accept: accept })).body);
    if (subtype === 'ENHO/XHH')
      result.source = (await client.http.get(`${path}/source/main`, { Accept: 'text/plain' })).body;
    return result;
  };
  try {
    try {
      return await read('ENHO/XHB');
    } catch (initial) {
      // These statuses include SAP's wrong-subtype transformation errors. Do not reroute auth or network failures.
      if (!(initial instanceof AdtApiError) || !REROUTE_STATUSES.includes(initial.statusCode)) throw initial;
      const matches = await client.searchObject(name, 100, 'ENHO');
      const subtypes = new Set(
        matches
          .filter(
            (m) =>
              m.objectName.toUpperCase() === name.toUpperCase() ||
              // 7.50 decorates names with a display label; its exact relative object URI still identifies the object.
              (Object.hasOwn(ROUTES, m.objectType) &&
                m.uri.toUpperCase() === pathFor(m.objectType as Subtype).toUpperCase()),
          )
          .map((m) => m.objectType),
      );
      const subtype = subtypes.size === 1 ? [...subtypes][0] : undefined;
      if (!subtype || subtype === 'ENHO/XHB' || !Object.hasOwn(ROUTES, subtype)) throw initial;
      try {
        return await read(subtype as Subtype);
      } catch (generic) {
        // Only the generic route has no source resource of its own; SAP fails there for source-code
        // plug-ins on releases that advertise nothing else (750). Keep every other failure as it is.
        if (subtype !== 'ENHO/XH' || !enhancementSourceUnavailable(generic)) throw generic;
        const fallback = await readSourcePlugInFromInclude(client, name, attempted);
        if (fallback) return fallback;
        throw generic;
      }
    }
  } catch (error) {
    if (error instanceof AdtApiError && REROUTE_STATUSES.includes(error.statusCode)) {
      error.extraHint = `ENHO read attempted ${attempted.join(', ')}. If this enhancement cannot be exposed by ADT, inspect it in SAP GUI (SE80/SE19) or Eclipse's SAP GUI integration.`;
    }
    throw error;
  }
}
