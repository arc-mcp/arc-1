/**
 * Generic "server-driven object" (SDO) read/write path. Most SDO types need ABAP Platform 2025
 * (SAP_BASIS 8.16+), but some (DTDC, DSFD, EVTB) also ship on S/4HANA 2023 (758) — availability is
 * discovery-gated per type, never a hardcoded release.
 *
 * These repository object types share ONE AFF generic-object contract:
 *   - metadata: GET …/{name}   (Accept = per-type metadataContentType) → <blue:blueSource> or <dtdc:dtdcSource>
 *   - content : GET …/{name}/source/main                                                → AFF JSON *or* DDL text
 * Rather than per-type plumbing, this module exposes a curated registry of high-value types
 * and ONE generic engine, discovery-gated so pre-8.16 systems degrade cleanly.
 *
 * WRITE (create/update-source/delete) is supported and reuses the verified machinery:
 *   - CREATE = POST <collection-href>  (Content-Type = the type's metadataContentType) with a minimal
 *             metadata body (blue:blueSource / dtdc:dtdcSource; adtcore:type/name/description + packageRef) → 201.
 *   - SOURCE = lock (crud.ts) → PUT <url>/source/main?lockHandle=… → unlock. The Content-Type is
 *             per-type (registry `sourceFormat`): application/json for the AFF-JSON types,
 *             text/plain for the DDL-text ones (DTSC, DSFD, DTDC). The wrong one is a hard 415.
 *   - DELETE = lock → http.delete(<url>?lockHandle=…) → unlock.
 *   - ACTIVATE is the generic devtools activate() against the object URL (callers use SAPActivate).
 * Create leaves the object inactive — callers follow with SAPActivate (never auto-activated).
 *
 * The create `adtcore:type` subtype is NOT uniformly "<code>/TYP" (EVTB=EVTB/EVB, DTDC=DTDC/DF) and
 * the metadata content-type varies (blues v1, EVTO=blues v2, DTDC=ddic.dtdc.v1) — all stored per
 * registry entry, verified live: the blue family on 816, DTDC create→activate on 758 + 816.
 */
import { lockObject, unlockObject } from './crud.js';
import { AdtApiError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import type { ServerDrivenObjectResult } from './types.js';
import { escapeXmlAttr, parseServerDrivenMetadata } from './xml-parser.js';

/** Registry entry for a curated server-driven object type. */
export interface SdoRegistryEntry {
  /** ADT collection href (parent URL — the create POST target). */
  href: string;
  /** Human-readable label. */
  label: string;
  /**
   * `adtcore:type` used in the create body. NOT uniformly "<code>/TYP" — EVTB uses EVTB/EVB.
   * Verified live on 816.
   */
  createType: string;
  /**
   * Metadata content-type for BOTH the metadata GET (Accept) and the create POST (Content-Type).
   * Most types use `application/vnd.sap.adt.blues.vN+xml` (EVTO is v2, the rest v1); DTDC uses its
   * own `application/vnd.sap.adt.ddic.dtdc.v1+xml`. Matched by `discoveryMarker` in the gate.
   */
  metadataContentType: string;
  /**
   * Local name of the metadata root element AFTER the parser strips namespace prefixes
   * (`removeNSPrefix: true`): `blueSource` for the blue family, `dtdcSource` for DTDC. Drives the
   * parse path (`parseServerDrivenMetadata`).
   */
  metadataRootLocalName: string;
  /**
   * Qualified root element name + its namespace URI for the create body. Blue family:
   * `blue:blueSource` / `http://www.sap.com/wbobj/blue`. DTDC: `dtdc:dtdcSource` /
   * `http://www.sap.com/adt/ddic/dtdcsources`. Drives the build path.
   */
  metadataRootQName: string;
  metadataNamespace: string;
  /**
   * Substring the discovery gate matches against the collection's advertised Accept type: `blues`
   * for the blue family, `dtdc` for DTDC. Version-agnostic (matches v1/v2).
   */
  discoveryMarker: string;
  /**
   * Source flavor — drives BOTH the client-side validation and the PUT Content-Type. NOT uniform:
   * the AFF-JSON types 415 on text/plain, and the DDL-text types (DTSC, DSFD, DTDC) 415 on
   * application/json. Live-verified per type on 816.
   */
  sourceFormat: SdoSourceFormat;
}

/** AFF JSON body vs plain DDL text. Required per entry — a wrong guess is a hard 415 from SAP. */
export type SdoSourceFormat = 'json' | 'text';

/**
 * Shared metadata-format fields for the "blue" family (DESD/DTSC/CSNM/EVTB/EVTO/COTA/DSFD) — every
 * blue type has the identical root element/namespace/discovery marker; only its content-type version
 * (v1/v2) and source flavor differ. Spread into each blue entry so the shape can't drift.
 */
const BLUE_METADATA = {
  metadataRootLocalName: 'blueSource',
  metadataRootQName: 'blue:blueSource',
  metadataNamespace: 'http://www.sap.com/wbobj/blue',
  discoveryMarker: 'blues',
} as const;

const BLUES_V1 = 'application/vnd.sap.adt.blues.v1+xml';
const BLUES_V2 = 'application/vnd.sap.adt.blues.v2+xml';

/** Content-Type for the source PUT, derived from the type's declared source flavor. */
export function serverDrivenSourceContentType(code: string): string {
  const format = sdoEntry(code).sourceFormat;
  switch (format) {
    case 'json':
      return 'application/json';
    case 'text':
      return 'text/plain';
    default: {
      // A new SdoSourceFormat must map to a content type here — falling through would only
      // surface as a live 415. Exhaustiveness is a compile error, not a runtime surprise.
      const unhandled: never = format;
      throw new AdtApiError(`Unhandled server-driven source format "${String(unhandled)}".`, 500, '');
    }
  }
}

/** Declared source flavor for a registered type (drives the client-side JSON parse gate). */
export function serverDrivenSourceFormat(code: string): SdoSourceFormat {
  return sdoEntry(code).sourceFormat;
}

/**
 * The registered server-driven type codes, in registry (= LLM tool-surface) order. The SAPRead/
 * SAPWrite rows in src/handlers/tool-registry.ts derive from this tuple, so registering a type
 * here is the ONLY step needed to expose it — `btp: true` by construction (runtime availability is
 * discovery-gated per system, so a type absent on a release degrades cleanly).
 */
export const SDO_TYPES = ['DESD', 'DTSC', 'CSNM', 'EVTB', 'EVTO', 'COTA', 'DSFD', 'DTDC'] as const;

/** Curated registry of high-value server-driven object types — keys are exactly SDO_TYPES. */
export const SDO_REGISTRY = {
  DESD: {
    href: '/sap/bc/adt/ddic/desd',
    label: 'CDS Logical External Schema',
    createType: 'DESD/TYP',
    metadataContentType: BLUES_V1,
    ...BLUE_METADATA,
    sourceFormat: 'json',
  },
  DTSC: {
    href: '/sap/bc/adt/ddic/dtsc/sources',
    label: 'CDS Static Cache (table-entity buffer)',
    createType: 'DTSC/TYP',
    metadataContentType: BLUES_V1,
    ...BLUE_METADATA,
    sourceFormat: 'text',
  },
  CSNM: {
    href: '/sap/bc/adt/csn/csnm',
    label: 'Core Schema Notation Model (CSN)',
    createType: 'CSNM/TYP',
    metadataContentType: BLUES_V1,
    ...BLUE_METADATA,
    sourceFormat: 'json',
  },
  EVTB: {
    href: '/sap/bc/adt/businessservices/evtbevb',
    label: 'RAP Event Binding',
    createType: 'EVTB/EVB',
    metadataContentType: BLUES_V1,
    ...BLUE_METADATA,
    sourceFormat: 'json',
  },
  EVTO: {
    href: '/sap/bc/adt/businessservices/evtoevo',
    label: 'RAP Event Object',
    createType: 'EVTO/EVO',
    metadataContentType: BLUES_V2,
    ...BLUE_METADATA,
    sourceFormat: 'json',
  },
  COTA: {
    href: '/sap/bc/adt/conn/commtargets',
    label: 'Communication Target',
    createType: 'COTA/TYP',
    metadataContentType: BLUES_V1,
    ...BLUE_METADATA,
    sourceFormat: 'json',
  },
  DSFD: {
    href: '/sap/bc/adt/ddic/dsfd/sources',
    label: 'CDS Scalar Function Definition',
    createType: 'DSFD/SCF',
    metadataContentType: BLUES_V1,
    ...BLUE_METADATA,
    sourceFormat: 'text',
  },
  // DTDC is the first NON-blue server-driven type: its own metadata format (<dtdc:dtdcSource> +
  // application/vnd.sap.adt.ddic.dtdc.v1+xml), DDL-text source. Available on 758 + 816.
  DTDC: {
    href: '/sap/bc/adt/ddic/dtdc/sources',
    label: 'CDS Dynamic Cache',
    createType: 'DTDC/DF',
    metadataContentType: 'application/vnd.sap.adt.ddic.dtdc.v1+xml',
    metadataRootLocalName: 'dtdcSource',
    metadataRootQName: 'dtdc:dtdcSource',
    metadataNamespace: 'http://www.sap.com/adt/ddic/dtdcsources',
    discoveryMarker: 'dtdc',
    sourceFormat: 'text',
  },
} satisfies Record<(typeof SDO_TYPES)[number], SdoRegistryEntry>;

// String-indexed view of the registry for the unknown-code lookups below (the satisfies-typed
// object has exactly the SDO_TYPES keys, which a plain `string` cannot index).
const REGISTRY_BY_CODE: Record<string, SdoRegistryEntry | undefined> = SDO_REGISTRY;

/** True when `code` is one of the registered server-driven object types. */
export function isServerDrivenObjectType(code: string): boolean {
  return Object.hasOwn(SDO_REGISTRY, code);
}

/** Registry lookup that throws a clean 400 for an unknown code (shared by every engine fn). */
function sdoEntry(code: string): SdoRegistryEntry {
  const entry = REGISTRY_BY_CODE[code];
  if (!entry) throw new AdtApiError(`Unknown server-driven object type "${code}".`, 400, '');
  return entry;
}

/** ADT object URL for a server-driven object: collection href + url-encoded name. */
export function serverDrivenObjectUrl(code: string, name: string): string {
  return `${sdoEntry(code).href}/${encodeURIComponent(name)}`;
}

/**
 * The metadata content-type for a type — used as the metadata GET Accept (incl. package resolution,
 * where the metadata root's packageRef only renders under this Accept) and the create POST
 * Content-Type. Per type (EVTO → blues v2, DTDC → its own dtdc type). Throws for an unknown code.
 */
export function serverDrivenMetadataContentType(code: string): string {
  return sdoEntry(code).metadataContentType;
}

/**
 * Capability gate — true iff ADT discovery advertises the type's collection with its per-type
 * metadata accept (the blue family's `blues`, DTDC's `dtdc`; present on the releases that ship the
 * type, absent otherwise). Returns undefined when discovery has not been loaded (caller may attempt
 * and let a 404 surface). Mirrors supportsExplicitTransportTarget() / supportsCdsTestCases().
 * Version-agnostic: `discoveryMarker` is a substring, so it matches v1 and v2.
 */
export function supportsServerDrivenObject(http: AdtHttpClient, code: string): boolean | undefined {
  const entry = REGISTRY_BY_CODE[code];
  if (!entry) return false;
  if (!http.hasDiscoveryData()) return undefined;
  return (http.discoveryAcceptFor(entry.href) ?? '').includes(entry.discoveryMarker);
}

/**
 * Read a server-driven object: its metadata (blue:blueSource or dtdc:dtdcSource) + source (AFF JSON
 * or DDL text). The source is JSON-parsed when possible (raw text otherwise). Throws AdtApiError 404
 * for a nonexistent object. Gate availability with supportsServerDrivenObject() on unknown systems.
 */
export async function getServerDrivenObject(
  http: AdtHttpClient,
  safety: SafetyConfig,
  code: string,
  name: string,
): Promise<ServerDrivenObjectResult> {
  checkOperation(safety, OperationType.Read, 'GetServerDrivenObject');
  const entry = sdoEntry(code);
  const objUrl = serverDrivenObjectUrl(code, name);

  const metaResp = await http.get(objUrl, { Accept: entry.metadataContentType });
  const metadata = parseServerDrivenMetadata(metaResp.body, entry.metadataRootLocalName);

  const srcResp = await http.get(`${objUrl}/source/main`, { Accept: 'application/json, */*' });
  let source: unknown = srcResp.body;
  try {
    source = JSON.parse(srcResp.body);
  } catch {
    // Non-JSON source — keep the raw text.
  }
  return { ...metadata, source };
}

/**
 * Build the minimal metadata create body for a server-driven object — the per-type root element
 * (blue:blueSource or dtdc:dtdcSource) with the verified `createType` for `adtcore:type`
 * (e.g. DESD/TYP, EVTB/EVB, DTDC/DF) + the package ref.
 *
 * NOTE — no `adtcore:masterLanguage`: live-verified on a4h-2025 (816) that ADT *silently ignores*
 * that attribute for these objects (create with masterLanguage="DE" → object still read back as the
 * session language). The object's master language comes from the `sap-language` request param (the
 * session = `config.language` / SAP_LANGUAGE), as with other source-based objects (cf. #343). Emitting
 * it would be an ADT-ignored attribute — so the body here is exactly the form proven to create every
 * registered type.
 */
export function buildServerDrivenMetadataXml(code: string, name: string, pkg: string, description: string): string {
  const entry = sdoEntry(code);
  const [prefix] = entry.metadataRootQName.split(':');
  return `<?xml version="1.0" encoding="UTF-8"?>
<${entry.metadataRootQName} xmlns:${prefix}="${entry.metadataNamespace}" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:type="${escapeXmlAttr(entry.createType)}" adtcore:name="${escapeXmlAttr(name)}" adtcore:description="${escapeXmlAttr(description)}">
  <adtcore:packageRef adtcore:name="${escapeXmlAttr(pkg)}"/>
</${entry.metadataRootQName}>`;
}

/** Options shared by the SDO write operations. */
export interface ServerDrivenWriteOptions {
  transport?: string;
}

/**
 * Create a server-driven object (metadata only — POST the <blue:blueSource> body to the collection
 * href with the type's blues content-type). Leaves the object INACTIVE; callers follow with source
 * write + activation. Returns the raw response body. Verified live: 201 for all 6 registered types.
 */
export async function createServerDrivenObject(
  http: AdtHttpClient,
  safety: SafetyConfig,
  code: string,
  name: string,
  opts: { package: string; description: string; transport?: string },
): Promise<string> {
  checkOperation(safety, OperationType.Create, 'CreateServerDrivenObject');
  const entry = sdoEntry(code);
  const body = buildServerDrivenMetadataXml(code, name, opts.package, opts.description);
  const url = opts.transport ? `${entry.href}?corrNr=${encodeURIComponent(opts.transport)}` : entry.href;
  const resp = await http.post(url, body, entry.metadataContentType);
  return resp.body;
}

/**
 * Write the source of a server-driven object: lock → PUT …/source/main → unlock (guaranteed via
 * try-finally). The Content-Type comes from the type's declared sourceFormat — AFF-JSON types take
 * application/json, DDL-text types (DTSC, DSFD) take text/plain; sending the wrong one is a 415.
 * Auto-propagates the lock's corrNr when no explicit transport is supplied (same contract as
 * crud.ts safeUpdateSource).
 */
export async function updateServerDrivenObjectSource(
  http: AdtHttpClient,
  safety: SafetyConfig,
  code: string,
  name: string,
  source: string,
  opts: ServerDrivenWriteOptions = {},
): Promise<void> {
  checkOperation(safety, OperationType.Update, 'UpdateServerDrivenObjectSource');
  const objUrl = serverDrivenObjectUrl(code, name);
  await http.withStatefulSession(async (session) => {
    const lock = await lockObject(session, safety, objUrl, 'MODIFY');
    const transport = opts.transport ?? (lock.corrNr || undefined);
    try {
      const params = [`lockHandle=${encodeURIComponent(lock.lockHandle)}`];
      if (transport) params.push(`corrNr=${encodeURIComponent(transport)}`);
      await session.put(`${objUrl}/source/main?${params.join('&')}`, source, serverDrivenSourceContentType(code));
    } finally {
      await unlockObject(session, objUrl, lock.lockHandle);
    }
  });
}

/**
 * Delete a server-driven object: lock → http.delete(…?lockHandle=…) → best-effort unlock.
 * The unlock is swallowed on failure (the object is already gone after the delete).
 */
export async function deleteServerDrivenObject(
  http: AdtHttpClient,
  safety: SafetyConfig,
  code: string,
  name: string,
  opts: ServerDrivenWriteOptions = {},
): Promise<void> {
  checkOperation(safety, OperationType.Delete, 'DeleteServerDrivenObject');
  const objUrl = serverDrivenObjectUrl(code, name);
  await http.withStatefulSession(async (session) => {
    const lock = await lockObject(session, safety, objUrl, 'MODIFY');
    const transport = opts.transport ?? (lock.corrNr || undefined);
    try {
      let url = `${objUrl}?lockHandle=${encodeURIComponent(lock.lockHandle)}`;
      if (transport) url += `&corrNr=${encodeURIComponent(transport)}`;
      await session.delete(url);
    } finally {
      try {
        await unlockObject(session, objUrl, lock.lockHandle);
      } catch {
        // Object already deleted — unlock failure is expected.
      }
    }
  });
}
