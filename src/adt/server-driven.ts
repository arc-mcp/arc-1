/**
 * Generic "server-driven object" (SDO) read path for ABAP Platform 2025 (SAP_BASIS 8.16+).
 *
 * 816 introduced ~46 repository object types that all share ONE AFF generic-object contract:
 *   - metadata: GET …/{name}              (Accept application/vnd.sap.adt.blues.v1+xml) → <blue:blueSource>
 *   - content : GET …/{name}/source/main                                                → AFF JSON
 * Rather than per-type plumbing, this module exposes a curated registry of high-value types
 * and ONE generic reader, discovery-gated so pre-8.16 systems degrade cleanly.
 *
 * Read-only. The write path (lock → PUT JSON → activate, validated against the live `$schema`)
 * is a deliberate follow-up — "read before write" (the 816 ADT research, §4).
 *
 * Verified live on a4h-2025 (816): DESD `DEMO_CDS_LOGICL_EXTERNL_SCHEMA` and
 * EVTB `S_BUSINESSPARTNER_CHANGE` round-trip; 758 omits the collections → gate returns false.
 */
import { AdtApiError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import type { ServerDrivenObjectResult } from './types.js';
import { parseBlueSource } from './xml-parser.js';

/** Curated registry of high-value 816 server-driven object types (code → collection href). */
export const SDO_REGISTRY: Record<string, { href: string; label: string }> = {
  DESD: { href: '/sap/bc/adt/ddic/desd', label: 'CDS Logical External Schema' },
  DTSC: { href: '/sap/bc/adt/ddic/dtsc/sources', label: 'CDS Static Cache (table-entity buffer)' },
  CSNM: { href: '/sap/bc/adt/csn/csnm', label: 'Core Schema Notation Model (CSN)' },
  EVTB: { href: '/sap/bc/adt/businessservices/evtbevb', label: 'RAP Event Binding' },
  EVTO: { href: '/sap/bc/adt/businessservices/evtoevo', label: 'RAP Event Object' },
  COTA: { href: '/sap/bc/adt/conn/commtargets', label: 'Communication Target' },
};

/** True when `code` is one of the registered server-driven object types. */
export function isServerDrivenObjectType(code: string): boolean {
  return Object.hasOwn(SDO_REGISTRY, code);
}

/**
 * Capability gate — true iff ADT discovery advertises the type's collection with the
 * server-driven `blues` accept (present on 8.16+, absent on 7.5x / 758). Returns undefined
 * when discovery has not been loaded (caller may attempt and let a 404 surface). Mirrors
 * supportsExplicitTransportTarget() / supportsCdsTestCases().
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
  const entry = SDO_REGISTRY[code];
  if (!entry) throw new AdtApiError(`Unknown server-driven object type "${code}".`, 400, '');

  const objUrl = `${entry.href}/${encodeURIComponent(name)}`;
  const metaResp = await http.get(objUrl, { Accept: 'application/vnd.sap.adt.blues.v1+xml' });
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
