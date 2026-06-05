/**
 * Generic "server-driven object" (SDO) read/write path for ABAP Platform 2025 (SAP_BASIS 8.16+).
 *
 * 816 introduced ~46 repository object types that all share ONE AFF generic-object contract:
 *   - metadata: GET …/{name}              (Accept application/vnd.sap.adt.blues.vN+xml) → <blue:blueSource>
 *   - content : GET …/{name}/source/main                                                → AFF JSON
 * Rather than per-type plumbing, this module exposes a curated registry of high-value types
 * and ONE generic engine, discovery-gated so pre-8.16 systems degrade cleanly.
 *
 * WRITE (create/update-source/delete) is supported and reuses the verified machinery:
 *   - CREATE = POST <collection-href>  (Content-Type = the type's blues.vN+xml) with a minimal
 *             <blue:blueSource> body (adtcore:type/name/description + packageRef) → 201.
 *   - SOURCE = lock (crud.ts) → PUT <url>/source/main?lockHandle=… (Content-Type application/json,
 *             the AFF JSON body) → unlock.
 *   - DELETE = lock → http.delete(<url>?lockHandle=…) → unlock.
 *   - ACTIVATE is the generic devtools activate() against the object URL (callers use SAPActivate).
 * Create leaves the object inactive — callers follow with SAPActivate (never auto-activated).
 *
 * The create `adtcore:type` subtype is NOT uniformly "<code>/TYP" (EVTB uses EVTB/EVB) and the
 * blues content-type is NOT uniformly v1 (EVTO uses v2) — both are stored per registry entry,
 * verified live on a4h-2025 (816): DESD/DTSC/CSNM/EVTB/COTA create with blues.v1, EVTO with blues.v2.
 */
import { lockObject, unlockObject } from './crud.js';
import { AdtApiError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import type { ServerDrivenObjectResult } from './types.js';
import { escapeXmlAttr, parseBlueSource } from './xml-parser.js';

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
   * blues content-type for BOTH the metadata GET (Accept) and the create POST (Content-Type).
   * NOT uniformly v1 — EVTO advertises/accepts v2. The supportsServerDrivenObject() gate matches
   * either via a `.includes('blues')` substring test, so it is version-agnostic.
   */
  blueContentType: string;
}

const BLUES_V1 = 'application/vnd.sap.adt.blues.v1+xml';
const BLUES_V2 = 'application/vnd.sap.adt.blues.v2+xml';
/** AFF source is JSON for every server-driven type (read GET + write PUT). */
const SDO_SOURCE_CONTENT_TYPE = 'application/json';

/** Curated registry of high-value 816 server-driven object types. */
export const SDO_REGISTRY: Record<string, SdoRegistryEntry> = {
  DESD: {
    href: '/sap/bc/adt/ddic/desd',
    label: 'CDS Logical External Schema',
    createType: 'DESD/TYP',
    blueContentType: BLUES_V1,
  },
  DTSC: {
    href: '/sap/bc/adt/ddic/dtsc/sources',
    label: 'CDS Static Cache (table-entity buffer)',
    createType: 'DTSC/TYP',
    blueContentType: BLUES_V1,
  },
  CSNM: {
    href: '/sap/bc/adt/csn/csnm',
    label: 'Core Schema Notation Model (CSN)',
    createType: 'CSNM/TYP',
    blueContentType: BLUES_V1,
  },
  EVTB: {
    href: '/sap/bc/adt/businessservices/evtbevb',
    label: 'RAP Event Binding',
    createType: 'EVTB/EVB',
    blueContentType: BLUES_V1,
  },
  EVTO: {
    href: '/sap/bc/adt/businessservices/evtoevo',
    label: 'RAP Event Object',
    createType: 'EVTO/EVO',
    blueContentType: BLUES_V2,
  },
  COTA: {
    href: '/sap/bc/adt/conn/commtargets',
    label: 'Communication Target',
    createType: 'COTA/TYP',
    blueContentType: BLUES_V1,
  },
};

/** True when `code` is one of the registered server-driven object types. */
export function isServerDrivenObjectType(code: string): boolean {
  return Object.hasOwn(SDO_REGISTRY, code);
}

/** Registry lookup that throws a clean 400 for an unknown code (shared by every engine fn). */
function sdoEntry(code: string): SdoRegistryEntry {
  const entry = SDO_REGISTRY[code];
  if (!entry) throw new AdtApiError(`Unknown server-driven object type "${code}".`, 400, '');
  return entry;
}

/** ADT object URL for a server-driven object: collection href + url-encoded name. */
export function serverDrivenObjectUrl(code: string, name: string): string {
  return `${sdoEntry(code).href}/${encodeURIComponent(name)}`;
}

/**
 * The blues content-type for a type — used as the metadata GET Accept (incl. package resolution,
 * where the <blue:blueSource> packageRef only renders under this Accept). Version-correct per type
 * (EVTO → v2). Throws AdtApiError for an unknown code.
 */
export function serverDrivenBlueContentType(code: string): string {
  return sdoEntry(code).blueContentType;
}

/**
 * Capability gate — true iff ADT discovery advertises the type's collection with the
 * server-driven `blues` accept (present on 8.16+, absent on 7.5x / 758). Returns undefined
 * when discovery has not been loaded (caller may attempt and let a 404 surface). Mirrors
 * supportsExplicitTransportTarget() / supportsCdsTestCases(). Version-agnostic: matches v1 and v2.
 */
export function supportsServerDrivenObject(http: AdtHttpClient, code: string): boolean | undefined {
  const entry = SDO_REGISTRY[code];
  if (!entry) return false;
  if (!http.hasDiscoveryData()) return undefined;
  return (http.discoveryAcceptFor(entry.href) ?? '').includes('blues');
}

/**
 * Read a server-driven object: its `<blue:blueSource>` metadata + AFF JSON source.
 * The source is JSON-parsed when possible (raw text otherwise). Throws AdtApiError 404 for a
 * nonexistent object. Gate availability with supportsServerDrivenObject() on unknown systems.
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

  const metaResp = await http.get(objUrl, { Accept: entry.blueContentType });
  const metadata = parseBlueSource(metaResp.body);

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
 * Build the minimal `<blue:blueSource>` create body for a server-driven object. Uses the type's
 * verified `createType` for `adtcore:type` (e.g. DESD/TYP, EVTB/EVB) + the package ref.
 *
 * NOTE — no `adtcore:masterLanguage`: live-verified on a4h-2025 (816) that ADT *silently ignores*
 * that attribute for these objects (create with masterLanguage="DE" → object still read back as the
 * session language). The object's master language comes from the `sap-language` request param (the
 * session = `config.language` / SAP_LANGUAGE), as with other source-based objects (cf. #343). Emitting
 * it would be an ADT-ignored attribute that's only ever been create-tested on DESD — so the body here
 * is exactly the form proven to create all 6 registered types.
 */
export function buildBlueSourceXml(code: string, name: string, pkg: string, description: string): string {
  const entry = sdoEntry(code);
  return `<?xml version="1.0" encoding="UTF-8"?>
<blue:blueSource xmlns:blue="http://www.sap.com/wbobj/blue" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:type="${escapeXmlAttr(entry.createType)}" adtcore:name="${escapeXmlAttr(name)}" adtcore:description="${escapeXmlAttr(description)}">
  <adtcore:packageRef adtcore:name="${escapeXmlAttr(pkg)}"/>
</blue:blueSource>`;
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
  const body = buildBlueSourceXml(code, name, opts.package, opts.description);
  const url = opts.transport ? `${entry.href}?corrNr=${encodeURIComponent(opts.transport)}` : entry.href;
  const resp = await http.post(url, body, entry.blueContentType);
  return resp.body;
}

/**
 * Write the AFF JSON source of a server-driven object: lock → PUT …/source/main (application/json)
 * → unlock (guaranteed via try-finally). Auto-propagates the lock's corrNr when no explicit
 * transport is supplied (same contract as crud.ts safeUpdateSource).
 */
export async function updateServerDrivenObjectSource(
  http: AdtHttpClient,
  safety: SafetyConfig,
  code: string,
  name: string,
  sourceJson: string,
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
      await session.put(`${objUrl}/source/main?${params.join('&')}`, sourceJson, SDO_SOURCE_CONTENT_TYPE);
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
