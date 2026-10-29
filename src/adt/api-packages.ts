/**
 * API packages (SOD1) and the write path shared by API packages and API package assignments (SOD2).
 *
 * ADT contract (Eclipse ADT 3.60, SAP_BASIS 8.16; docs/research/abap-types/types/sod1.md and sod2.md):
 *   read   GET  /sap/bc/adt/aps/com/{sod1|sod2}/{name lowercase}          blues.v1 XML, root <sod1:sod1>/<sod2:sod2>
 *   list   GET  /sap/bc/adt/aps/com/sod1/$packageassignments?name={NAME}  assignments of one API package
 *   create POST /sap/bc/adt/aps/com/{sod1|sod2}?corrNr=…                   minimal metadata document → 201
 *   update lock → PUT the complete metadata document → unlock              no activation: Eclipse never activates
 *   delete POST /sap/bc/adt/deletion/check, then /sap/bc/adt/deletion/delete (no lock), like Eclipse
 *
 * Updates patch the fresh SAP document element by element, so everything a caller did not address
 * (tag ids, plugin configuration, atom links, unknown elements) goes back unchanged.
 */
import { postCreate } from './create-request.js';
import { lockObject, unlockObject, updateObject } from './crud.js';
import { AdtError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import { escapeXmlAttr, getNestedArray, parseXml } from './xml-parser.js';

export type ApiCatalogType = 'SOD1' | 'SOD2';

const BLUES_V1 = 'application/vnd.sap.adt.blues.v1+xml';
const COLLECTIONS: Record<ApiCatalogType, string> = {
  SOD1: '/sap/bc/adt/aps/com/sod1',
  SOD2: '/sap/bc/adt/aps/com/sod2',
};
const NAMESPACES: Record<ApiCatalogType, string> = {
  SOD1: 'http://www.sap.com/oda/sod1',
  SOD2: 'http://www.sap.com/oda/sod2',
};
const LABELS: Record<ApiCatalogType, string> = { SOD1: 'API package', SOD2: 'API package assignment' };

export function apiCatalogObjectUrl(type: ApiCatalogType, name: string): string {
  return `${COLLECTIONS[type]}/${encodeURIComponent(name.toLowerCase())}`;
}

/** False only when discovery is loaded and lacks the collection; an unloaded map lets SAP answer. */
export function apiCatalogAvailable(http: AdtHttpClient, type: ApiCatalogType): boolean {
  if (!http.hasDiscoveryData()) return true;
  // Presence, not media types: a display-only user gets the collection without `accept` elements.
  return http.discoveryListsCollection(COLLECTIONS[type]);
}

export function apiCatalogUnavailableMessage(type: ApiCatalogType): string {
  return `${LABELS[type]}s (${type}) are not available on this system: ADT discovery does not list ${COLLECTIONS[type]}.`;
}

function text(value: unknown): string {
  return value === undefined || value === null || typeof value === 'object' ? '' : String(value).trim();
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

// ─── SOD1 read ──────────────────────────────────────────────────────

export interface ApiPackageUrl {
  technicalName: string;
  displayName: string;
  value: string;
  version: string;
  text: string;
}

export interface ApiPackageInfo {
  name: string;
  description: string;
  package: string;
  abbreviation: string;
  alias: string;
  namespace: string;
  type: string;
  isScopeDependent: boolean;
  tags: Array<{ category: string; value: string }>;
  urls: ApiPackageUrl[];
}

export interface ApiPackageAssignmentRef {
  name: string;
  description: string;
  apiObject: { type: string; name: string; subName?: string };
  isVirtual: boolean;
}

/** Parse the <sod1:sod1> metadata document. */
export function parseApiPackage(xml: string): ApiPackageInfo {
  const root = record(parseXml(xml).sod1);
  if (!root['@_name']) throw new Error('SAP response is not an API package (SOD1) document.');
  const content = record(root.content);
  return {
    name: text(root['@_name']),
    description: text(root['@_description']),
    package: text(record(root.packageRef)['@_name']),
    abbreviation: text(content.abbreviation),
    alias: text(content.alias),
    namespace: text(content.namespace),
    type: text(content.type),
    isScopeDependent: text(content.isScopeDependent) === 'true',
    tags: getNestedArray(content, 'tags', 'tag').map((tag) => ({
      category: text(tag.category),
      value: text(tag.value),
    })),
    urls: getNestedArray(content, 'urls', 'url').map((url) => ({
      technicalName: text(url.technicalName),
      displayName: text(url.displayName),
      value: text(url.value),
      version: text(url.version),
      text: text(url.text),
    })),
  };
}

/** Parse the $packageassignments listing of one API package. */
export function parseApiPackageAssignments(xml: string): ApiPackageAssignmentRef[] {
  return getNestedArray(parseXml(xml), 'packageAssignments', 'packageAssignment').map((row) => {
    const subName = text(row.apiSubWbObjectName);
    return {
      name: text(row.name),
      description: text(row.description),
      apiObject: {
        type: text(row.apiWbObjectType),
        name: text(row.apiWbObjectName),
        ...(subName ? { subName } : {}),
      },
      isVirtual: text(row.isVirtual) === 'true',
    };
  });
}

/** The API package with the assignments that point to it (two GETs, like the Eclipse editor). */
export async function getApiPackage(
  http: AdtHttpClient,
  safety: SafetyConfig,
  name: string,
): Promise<ApiPackageInfo & { assignments: ApiPackageAssignmentRef[] }> {
  checkOperation(safety, OperationType.Read, 'GetSOD1');
  const metadata = await http.get(apiCatalogObjectUrl('SOD1', name), { Accept: BLUES_V1 });
  const info = parseApiPackage(metadata.body);
  const listing = await http.get(
    `${COLLECTIONS.SOD1}/$packageassignments?name=${encodeURIComponent(name.toUpperCase())}`,
    { Accept: 'application/vnd.sap.adt.oda.packageassignments+xml' },
  );
  return { ...info, assignments: parseApiPackageAssignments(listing.body) };
}

// ─── Write input ────────────────────────────────────────────────────

/** Fields of the SAPRead JSON that SAPWrite accepts, per type. Everything else in the read answer is read-only. */
const WRITABLE: Record<ApiCatalogType, readonly string[]> = {
  SOD1: ['description', 'abbreviation', 'alias', 'namespace', 'type', 'isScopeDependent', 'tags', 'urls'],
  SOD2: ['description', 'apiPackage', 'apiObject', 'leadingBusinessObjectType', 'documentationLink', 'tags'],
};
const READ_ONLY: Record<ApiCatalogType, readonly string[]> = {
  SOD1: ['name', 'package', 'assignments'],
  SOD2: ['name', 'package', 'apiKind', 'apiDetails', 'released', 'next'],
};
/** Fixed at creation: SAP keys the assignment on them. */
const CREATE_ONLY: Record<ApiCatalogType, readonly string[]> = { SOD1: [], SOD2: ['apiPackage', 'apiObject'] };

export interface ApiCatalogDefinition {
  description?: string;
  abbreviation?: string;
  alias?: string;
  namespace?: string;
  type?: string;
  isScopeDependent?: boolean;
  tags?: Array<{ category: string; value: string }>;
  urls?: ApiPackageUrl[];
  apiPackage?: string;
  apiObject?: { type: string; name: string; subType?: string; subName?: string };
  leadingBusinessObjectType?: string;
  documentationLink?: string;
}

export interface ParsedApiCatalogSource {
  definition: ApiCatalogDefinition;
  /** Read-only keys that were present and skipped (a SAPRead answer can be sent back as is). */
  ignored: string[];
}

function requireString(key: string, value: unknown): string {
  if (typeof value !== 'string') throw new AdtError(`"${key}" must be a string.`);
  return value;
}

function stringFields<K extends string>(key: string, value: unknown, fields: readonly K[]): Record<K, string> {
  const entry = record(value);
  if (entry !== value) throw new AdtError(`Each entry of "${key}" must be an object.`);
  const unknown = Object.keys(entry).filter((k) => !(fields as readonly string[]).includes(k));
  if (unknown.length) throw new AdtError(`Unknown field(s) in "${key}": ${unknown.join(', ')}.`);
  return Object.fromEntries(
    fields.map((field) => [field, entry[field] === undefined ? '' : requireString(`${key}.${field}`, entry[field])]),
  ) as Record<K, string>;
}

function list<T>(key: string, value: unknown, item: (entry: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new AdtError(`"${key}" must be an array (it replaces the whole list).`);
  return value.map(item);
}

/** Validate the JSON "source" of SAPWrite type=SOD1/SOD2. Unknown keys are refused; read-only keys are skipped. */
export function parseApiCatalogSource(
  type: ApiCatalogType,
  source: string,
  action: 'create' | 'update',
): ParsedApiCatalogSource {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    throw new AdtError(`${type} source must be a JSON object (the SAPRead answer, or the fields to change).`);
  }
  const input = record(raw);
  if (input !== raw) throw new AdtError(`${type} source must be a JSON object.`);
  const definition: ApiCatalogDefinition = {};
  const ignored: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (READ_ONLY[type].includes(key) || (action === 'update' && CREATE_ONLY[type].includes(key))) {
      ignored.push(key);
      continue;
    }
    if (!WRITABLE[type].includes(key))
      throw new AdtError(`Unknown ${type} field "${key}". Writable fields: ${WRITABLE[type].join(', ')}.`);
    switch (key) {
      case 'isScopeDependent':
        if (typeof value !== 'boolean') throw new AdtError('"isScopeDependent" must be true or false.');
        definition.isScopeDependent = value;
        break;
      case 'tags':
        definition.tags = list('tags', value, (entry) => stringFields('tags', entry, ['category', 'value'] as const));
        break;
      case 'urls':
        definition.urls = list('urls', value, (entry) =>
          stringFields('urls', entry, ['technicalName', 'displayName', 'value', 'version', 'text'] as const),
        );
        break;
      case 'apiObject': {
        const object = stringFields('apiObject', value, ['type', 'name', 'subType', 'subName'] as const);
        definition.apiObject = object;
        break;
      }
      default:
        (definition as Record<string, unknown>)[key] = requireString(key, value);
    }
  }
  return { definition, ignored };
}

// ─── XML ────────────────────────────────────────────────────────────

const xmlText = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function tagsXml(prefix: string, tags: Array<{ category: string; value: string }>): string {
  // Element order as Eclipse sends it; SAP assigns the tag ids.
  return tags
    .map(
      (tag) =>
        `<${prefix}:tag><${prefix}:value>${xmlText(tag.value)}</${prefix}:value><${prefix}:category>${xmlText(tag.category)}</${prefix}:category></${prefix}:tag>`,
    )
    .join('');
}

function urlsXml(urls: ApiPackageUrl[]): string {
  return urls
    .map(
      (url) =>
        '<sod1:url>' +
        (['technicalName', 'displayName', 'value', 'version', 'text'] as const)
          .map((field) => `<sod1:${field}>${xmlText(url[field])}</sod1:${field}>`)
          .join('') +
        '</sod1:url>',
    )
    .join('');
}

/** Minimal create document, as Eclipse posts it. */
export function buildApiCatalogCreateXml(
  type: ApiCatalogType,
  name: string,
  pkg: string,
  description: string,
  definition: ApiCatalogDefinition,
): string {
  const prefix = type.toLowerCase();
  let content: string;
  if (type === 'SOD1') {
    if (!definition.abbreviation?.trim()) throw new AdtError('Creating an API package (SOD1) requires "abbreviation".');
    content = `<sod1:abbreviation>${xmlText(definition.abbreviation)}</sod1:abbreviation>`;
  } else {
    const object = definition.apiObject;
    if (!definition.apiPackage?.trim() || !object?.type.trim() || !object.name.trim())
      throw new AdtError(
        'Creating an API package assignment (SOD2) requires "apiPackage" and "apiObject" {type, name, subType?, subName?}.',
      );
    content =
      `<sod2:packageID>${xmlText(definition.apiPackage)}</sod2:packageID>` +
      `<sod2:apiWbObjectType>${xmlText(object.type)}</sod2:apiWbObjectType>` +
      `<sod2:apiWbObjectName>${xmlText(object.name)}</sod2:apiWbObjectName>` +
      `<sod2:apiSubWbObjectType>${xmlText(object.subType ?? '')}</sod2:apiSubWbObjectType>` +
      // The sub-object name is fixed-width (service name padded, then version): passed through verbatim.
      `<sod2:apiSubWbObjectName>${xmlText(object.subName ?? '')}</sod2:apiSubWbObjectName>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<${prefix}:${prefix} xmlns:${prefix}="${NAMESPACES[type]}" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:type="${type}" adtcore:name="${escapeXmlAttr(name)}" adtcore:description="${escapeXmlAttr(description)}">
  <adtcore:packageRef adtcore:name="${escapeXmlAttr(pkg)}"/>
  <${prefix}:content>${content}</${prefix}:content>
</${prefix}:${prefix}>`;
}

/** Replace one element (empty or not) by name; a missing element is an error, never an insertion. */
function replaceElement(xml: string, qname: string, inner: string): string {
  const pattern = new RegExp(`<${qname}(?:\\s[^>]*)?/>|<${qname}(?:\\s[^>]*)?>[\\s\\S]*?</${qname}>`);
  if (!pattern.test(xml)) throw new AdtError(`SAP's metadata document has no <${qname}> element; nothing was saved.`);
  return xml.replace(pattern, () => `<${qname}>${inner}</${qname}>`);
}

/** Fields that the create POST does not carry and therefore need a follow-up save. */
export function needsFollowUpSave(type: ApiCatalogType, definition: ApiCatalogDefinition): boolean {
  const createFields = type === 'SOD1' ? ['description', 'abbreviation'] : ['description', 'apiPackage', 'apiObject'];
  return Object.keys(definition).some((key) => !createFields.includes(key));
}

/** Apply a definition to the current SAP document; untouched parts are returned byte for byte. */
export function applyApiCatalogDefinition(type: ApiCatalogType, xml: string, definition: ApiCatalogDefinition): string {
  const prefix = type.toLowerCase();
  const root = new RegExp(`<${prefix}:${prefix}\\s[^>]*>`).exec(xml);
  if (!root) throw new AdtError(`SAP returned no ${type} metadata document; nothing was saved.`);
  let out = xml;
  if (definition.description !== undefined) {
    const attr = `adtcore:description="${escapeXmlAttr(definition.description)}"`;
    const tag = /\sadtcore:description="[^"]*"/.test(root[0])
      ? root[0].replace(/adtcore:description="[^"]*"/, () => attr)
      : root[0].replace(/\s*>$/, () => ` ${attr}>`);
    out = out.replace(root[0], () => tag);
  }
  const set = (local: string, inner: string) => {
    out = replaceElement(out, `${prefix}:${local}`, inner);
  };
  for (const key of ['abbreviation', 'alias', 'namespace', 'type', 'leadingBusinessObjectType'] as const) {
    const value = definition[key];
    if (value !== undefined) set(key, xmlText(value));
  }
  // Eclipse's "Documentation Link" field writes the replacement element; SAP derives documentationLink.
  if (definition.documentationLink !== undefined)
    set('documentationLinkReplacement', xmlText(definition.documentationLink));
  if (definition.isScopeDependent !== undefined) set('isScopeDependent', String(definition.isScopeDependent));
  if (definition.tags !== undefined) set('tags', tagsXml(prefix, definition.tags));
  if (definition.urls !== undefined) set('urls', urlsXml(definition.urls));
  return out;
}

// ─── Write operations ───────────────────────────────────────────────

export async function createApiCatalogObject(
  http: AdtHttpClient,
  safety: SafetyConfig,
  type: ApiCatalogType,
  name: string,
  opts: { package: string; description: string; definition: ApiCatalogDefinition; transport?: string },
): Promise<void> {
  checkOperation(safety, OperationType.Create, `Create${type}`);
  const body = buildApiCatalogCreateXml(type, name, opts.package, opts.description, opts.definition);
  const url = opts.transport ? `${COLLECTIONS[type]}?corrNr=${encodeURIComponent(opts.transport)}` : COLLECTIONS[type];
  await postCreate(http, url, body, BLUES_V1, { Accept: BLUES_V1 });
}

/** lock → fresh GET → patch → PUT → unlock. No activation: Eclipse saves these objects active. */
export async function updateApiCatalogObject(
  http: AdtHttpClient,
  safety: SafetyConfig,
  type: ApiCatalogType,
  name: string,
  definition: ApiCatalogDefinition,
  transport?: string,
): Promise<void> {
  checkOperation(safety, OperationType.Update, `Update${type}`);
  const url = apiCatalogObjectUrl(type, name);
  await http.withStatefulSession(async (session) => {
    const lock = await lockObject(session, safety, url, 'MODIFY');
    try {
      const current = await session.get(url, { Accept: BLUES_V1, 'Cache-Control': 'no-cache' });
      const body = applyApiCatalogDefinition(type, current.body, definition);
      await updateObject(
        session,
        safety,
        url,
        body,
        lock.lockHandle,
        BLUES_V1,
        transport ?? (lock.corrNr || undefined),
      );
    } finally {
      await unlockObject(session, url, lock.lockHandle);
    }
  });
}

function messagesOf(node: Record<string, unknown>): string[] {
  const raw = node.message;
  const messages = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return messages.map((m) => text(record(m).text)).filter(Boolean);
}

function singleObject(body: string, rootName: string): Record<string, unknown> | undefined {
  const raw = record(parseXml(body)[rootName]).object;
  const objects = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return objects.length === 1 ? record(objects[0]) : undefined;
}

/**
 * Delete through SAP's deletion framework, as Eclipse does. Dependent objects that SAP deletes only
 * together with the parent (a KTD) are refused: deleting both in one request was observed to remove
 * the KTD and keep the assignment.
 */
export async function deleteApiCatalogObject(
  http: AdtHttpClient,
  safety: SafetyConfig,
  type: ApiCatalogType,
  name: string,
  transport?: string,
): Promise<{ transport?: string }> {
  checkOperation(safety, OperationType.Delete, `Delete${type}`);
  const url = apiCatalogObjectUrl(type, name);
  const objectRef = `adtcore:uri="${escapeXmlAttr(url)}"`;
  const namespaces = 'xmlns:adtcore="http://www.sap.com/adt/core" xmlns:del="http://www.sap.com/adt/deletion"';
  const check = await http.post(
    '/sap/bc/adt/deletion/check',
    `<?xml version="1.0" encoding="UTF-8"?><del:checkRequest ${namespaces}><del:object ${objectRef}/></del:checkRequest>`,
    'application/vnd.sap.adt.deletion.check.request.v1+xml',
    { Accept: 'application/vnd.sap.adt.deletion.check.response.v1+xml' },
  );
  const checked = singleObject(check.body, 'checkResponse');
  if (!checked || checked['@_uri'] !== url || checked['@_isDeletable'] !== 'true') {
    const reason = checked ? messagesOf(checked).join(' ') : '';
    throw new AdtError(
      `SAP does not allow deleting ${type} ${name}${reason ? `: ${reason}` : '.'} Nothing was deleted.`,
    );
  }
  const included = getNestedArray({ c: checked }, 'c', 'includedObject');
  if (included.length) {
    const names = included.map((o) => `${text(o['@_type'])} ${text(o['@_name'])}`).join(', ');
    throw new AdtError(
      `${type} ${name} has dependent objects that SAP deletes only together with it: ${names}. ` +
        'Delete them first (a KTD with SAPWrite(action="delete", type="SKTD", name=…)), then delete ' +
        `${type} ${name}. Nothing was deleted.`,
    );
  }
  const locking = record(record(checked.lockingTransport).lockingTransport);
  const effectiveTransport = transport ?? (text(locking.trkorr) || undefined);
  const transportXml = effectiveTransport
    ? `<del:transportNumber>${xmlText(effectiveTransport)}</del:transportNumber>`
    : '';
  const result = await http.post(
    '/sap/bc/adt/deletion/delete',
    `<?xml version="1.0" encoding="UTF-8"?><del:deletionRequest ${namespaces}><del:object ${objectRef}>${transportXml}</del:object></del:deletionRequest>`,
    'application/vnd.sap.adt.deletion.request.v1+xml',
    { Accept: 'application/vnd.sap.adt.deletion.response.v1+xml' },
    // A repeated delete after an unknown outcome would hit a missing object; report instead of replaying.
    { retryTransientErrors: false },
  );
  const deleted = singleObject(result.body, 'deletionResult');
  if (deleted?.['@_isDeleted'] !== 'true') {
    const reason = deleted ? messagesOf(deleted).join(' ') : '';
    throw new AdtError(`SAP did not delete ${type} ${name}${reason ? `: ${reason}` : '.'}`);
  }
  return { transport: effectiveTransport };
}
