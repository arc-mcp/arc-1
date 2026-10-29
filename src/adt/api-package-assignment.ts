/**
 * API package assignments (SOD2) — read-only access to what the two Eclipse editor buttons
 * "ORD Document" and "Resource Definition" download.
 *
 * ADT contract (Eclipse ADT 3.60, SAP_BASIS 8.16; docs/research/abap-types/types/sod2.md):
 *   GET /sap/bc/adt/aps/com/sod2/{name lowercase}                       blues.v1 XML, root <sod2:sod2>
 *   GET /sap/bc/adt/aps/com/sod2/$ordfile?packageAssignmentId={NAME}    <sod2:ordFile><sod2:ordDocumentFile>
 *   GET /sap/bc/adt/aps/com/sod2/$swaggerfile?packageAssignmentId={NAME} <sod2:swaggerFile> with the two
 *       slots <sod2:jsonFile> and <sod2:edmxFile> (the "JSON" and "EDMX" tabs of the Eclipse dialog)
 *
 * The documents are embedded as escaped text. The slot names do not describe the content: SOAP puts a
 * WSDL into edmxFile, events put AsyncAPI into both, SEGW OData V2 leaves jsonFile empty, and API types
 * with one format repeat it in both slots. Availability is therefore decided from the content, not from
 * the API type and not from the ORD resourceDefinitions (which advertise formats ADT does not deliver).
 */
import { apiCatalogObjectUrl } from './api-packages.js';
import type { AdtHttpClient } from './http.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import { getNestedArray, parseXml } from './xml-parser.js';

export const SOD2_COLLECTION = '/sap/bc/adt/aps/com/sod2';

/** Resource definition kinds, named by content. `unknown` keeps a format arc-1 does not recognize reachable. */
export const SOD2_SPEC_KINDS = ['openapi', 'edmx', 'wsdl', 'asyncapi', 'sqlapi', 'rfc', 'unknown'] as const;
export type Sod2SpecKind = (typeof SOD2_SPEC_KINDS)[number];

/** Values of SAPRead include= for type SOD2. Omitted include reads the assignment metadata. */
export const SOD2_INCLUDES = ['ord', 'specs', ...SOD2_SPEC_KINDS] as const;

export interface ApiPackageAssignmentInfo {
  name: string;
  description: string;
  package: string;
  apiPackage: string;
  apiObject: { type: string; name: string; subType?: string; subName?: string };
  apiKind: string;
  apiDetails: Record<string, string>;
  leadingBusinessObjectType?: string;
  released: boolean;
  documentationLink?: string;
  /** `category` is SAP's tag category code; its text comes from a value help this read does not call. */
  tags: Array<{ category: string; value: string }>;
}

export interface ResourceDefinition {
  kind: Sod2SpecKind;
  version: string;
  mediaType: 'application/json' | 'application/xml' | 'text/plain';
  /** Eclipse dialog tab the document came from. */
  slot: 'JSON' | 'EDMX';
  /** True when the other tab held a different document of the same kind (seen for events). */
  otherSlotDiffers: boolean;
  content: string;
}

function text(value: unknown): string {
  return value === undefined || value === null || typeof value === 'object' ? '' : String(value).trim();
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** apiDetails group that is filled decides the protocol; CLAS-based APIs are custom implementations. */
function apiKindOf(details: Record<string, string>, apiObjectType: string): string {
  if (details.odataV2ServiceName) return 'odata-v2';
  if (details.odataV4ServiceName || details.odataV4ServiceGroupName) return 'odata-v4';
  if (details.soapServiceName) return 'soap-inbound';
  if (details.soapOutboundServiceName) return 'soap-outbound';
  if (details.eventName || details.eventRapBusinessObjectName || details.eventRapProducerNamespace) return 'event';
  if (details.rfcFunctionModuleName) return 'rfc';
  if (details.sqlServiceName) return 'sql';
  if (apiObjectType === 'CLAS') return 'custom';
  return apiObjectType || 'unknown';
}

/** Parse the <sod2:sod2> metadata document into the compact SAPRead answer. */
export function parseApiPackageAssignment(xml: string): ApiPackageAssignmentInfo {
  const root = record(parseXml(xml).sod2);
  if (!root['@_name']) throw new Error('SAP response is not an API package assignment (SOD2) document.');
  const content = record(root.content);
  const apiDetails: Record<string, string> = {};
  for (const [key, value] of Object.entries(record(root.apiDetails))) {
    const v = text(value);
    // Unused version fields come back as 0000.
    if (!v || v === '0000' || !key.startsWith('api')) continue;
    apiDetails[key.charAt(3).toLowerCase() + key.slice(4)] = v;
  }
  const apiObjectType = text(content.apiWbObjectType);
  const subType = text(content.apiSubWbObjectType);
  const subName = text(content.apiSubWbObjectName);
  const leadingBusinessObjectType = text(content.leadingBusinessObjectType);
  const documentationLink = text(content.documentationLink);
  return {
    name: text(root['@_name']),
    description: text(root['@_description']),
    package: text(record(root.packageRef)['@_name']),
    apiPackage: text(content.packageID),
    apiObject: {
      type: apiObjectType,
      name: text(content.apiWbObjectName),
      ...(subType ? { subType } : {}),
      ...(subName ? { subName } : {}),
    },
    apiKind: apiKindOf(apiDetails, apiObjectType),
    apiDetails,
    ...(leadingBusinessObjectType ? { leadingBusinessObjectType } : {}),
    released: text(content.isReleased) === 'true',
    ...(documentationLink ? { documentationLink } : {}),
    tags: getNestedArray(content, 'tags', 'tag').map((tag) => ({
      category: text(tag.category),
      value: text(tag.value),
    })),
  };
}

export async function getApiPackageAssignment(
  http: AdtHttpClient,
  safety: SafetyConfig,
  name: string,
): Promise<ApiPackageAssignmentInfo> {
  checkOperation(safety, OperationType.Read, 'GetSOD2');
  // Eclipse lowercases the name in the object path; the query parameters below keep it upper case.
  const resp = await http.get(apiCatalogObjectUrl('SOD2', name), {
    Accept: 'application/vnd.sap.adt.blues.v1+xml',
  });
  return parseApiPackageAssignment(resp.body);
}

/** Decoded text of one wrapper slot; '' for an empty element, a missing slot or an empty body. */
function slot(body: string, wrapper: string, name: string): string {
  if (!body.trim()) return '';
  // Whitespace-preserving parse: the slot text is the downloaded document and must stay byte-identical.
  const value = record(record(parseXml(body, true))[wrapper])[name];
  return typeof value === 'string' ? value : '';
}

function documentUrl(file: '$ordfile' | '$swaggerfile', name: string): string {
  return `${SOD2_COLLECTION}/${file}?packageAssignmentId=${encodeURIComponent(name.toUpperCase())}`;
}

/** The ORD document of one assignment ("ORD Document" button); '' when SAP returns none. */
export async function getOrdDocument(http: AdtHttpClient, safety: SafetyConfig, name: string): Promise<string> {
  checkOperation(safety, OperationType.Read, 'GetSOD2OrdDocument');
  const resp = await http.get(documentUrl('$ordfile', name), {
    Accept: 'application/vnd.sap.adt.oda.ordfile+xml',
  });
  const ord = slot(resp.body, 'ordFile', 'ordDocumentFile');
  return isEmptyDocument(ord) ? '' : ord;
}

/** Both tabs of the "Resource Definition" dialog, classified and merged by kind. Empty when SAP has none. */
export async function getResourceDefinitions(
  http: AdtHttpClient,
  safety: SafetyConfig,
  name: string,
): Promise<ResourceDefinition[]> {
  checkOperation(safety, OperationType.Read, 'GetSOD2ResourceDefinition');
  const resp = await http.get(documentUrl('$swaggerfile', name), {
    Accept: 'application/vnd.sap.adt.oda.swaggerfile+xml',
  });
  return mergeResourceDefinitions(
    slot(resp.body, 'swaggerFile', 'jsonFile'),
    slot(resp.body, 'swaggerFile', 'edmxFile'),
  );
}

/** Eclipse shows an empty slot as "null"; SAP may also send the literal. */
function isEmptyDocument(content: string): boolean {
  const trimmed = content.trim();
  return trimmed === '' || trimmed === 'null';
}

/** First element of an XML document: local name, namespace URI and attributes. */
function xmlRoot(content: string): { local: string; ns: string; attrs: Record<string, string> } | undefined {
  // Skip the declaration, processing instructions, comments and a DOCTYPE before the root element.
  const prolog = /^\s*(?:<\?[\s\S]*?\?>\s*|<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*/.exec(content)?.[0] ?? '';
  const tag = /^<([A-Za-z_][\w.:-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?>/.exec(
    content.slice(prolog.length),
  );
  if (!tag) return undefined;
  const attrs: Record<string, string> = {};
  for (const m of tag[2]!.matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[m[1]!] = m[2] ?? m[3] ?? '';
  const [prefix, local] = tag[1]!.includes(':') ? tag[1]!.split(':', 2) : ['', tag[1]!];
  return { local: local!, ns: attrs[prefix ? `xmlns:${prefix}` : 'xmlns'] ?? '', attrs };
}

const EDMX_NAMESPACES = new Set([
  'http://docs.oasis-open.org/odata/ns/edmx',
  'http://schemas.microsoft.com/ado/2007/06/edmx',
]);

/** Name a document by its content. Never throws: an unrecognized document is `unknown`. */
export function classifyResourceDefinition(
  content: string,
): Pick<ResourceDefinition, 'kind' | 'version' | 'mediaType'> {
  const trimmed = content.trimStart();
  if (trimmed.startsWith('{')) {
    let parsed: Record<string, unknown> = {};
    try {
      // Parsed only to read the top-level marker; the document itself is returned unparsed.
      parsed = record(JSON.parse(content));
    } catch {
      return { kind: 'unknown', version: '', mediaType: 'text/plain' };
    }
    for (const [key, kind] of [
      ['openapi', 'openapi'],
      ['swagger', 'openapi'],
      ['asyncapi', 'asyncapi'],
      ['sqlapi', 'sqlapi'],
    ] as const) {
      if (parsed[key] !== undefined) return { kind, version: text(parsed[key]), mediaType: 'application/json' };
    }
    return { kind: 'unknown', version: '', mediaType: 'application/json' };
  }
  if (trimmed.startsWith('<')) {
    const root = xmlRoot(trimmed);
    if (root?.local === 'Edmx' && EDMX_NAMESPACES.has(root.ns))
      return { kind: 'edmx', version: root.attrs.Version ?? '', mediaType: 'application/xml' };
    if (root?.local === 'definitions' && root.ns === 'http://schemas.xmlsoap.org/wsdl/')
      return { kind: 'wsdl', version: '1.1', mediaType: 'application/xml' };
    if (root?.local === 'rfcSignature' && root.ns === 'http://www.sap.com/aco')
      return { kind: 'rfc', version: '', mediaType: 'application/xml' };
    return { kind: 'unknown', version: '', mediaType: 'application/xml' };
  }
  return { kind: 'unknown', version: '', mediaType: 'text/plain' };
}

/**
 * One entry per kind. The JSON tab wins a tie: for events it is the superset (the EDMX tab drops the
 * maxLength constraints), and identical copies collapse.
 */
export function mergeResourceDefinitions(jsonSlot: string, edmxSlot: string): ResourceDefinition[] {
  const definitions: ResourceDefinition[] = [];
  for (const [slotName, content] of [
    ['JSON', jsonSlot],
    ['EDMX', edmxSlot],
  ] as const) {
    if (isEmptyDocument(content)) continue;
    const classified = classifyResourceDefinition(content);
    const existing = definitions.find((d) => d.kind === classified.kind);
    if (existing) {
      if (existing.content !== content) existing.otherSlotDiffers = true;
      continue;
    }
    definitions.push({ ...classified, slot: slotName, otherSlotDiffers: false, content });
  }
  return definitions;
}
