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
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { postCreate } from './create-request.js';
import { updateObject, withLockedMutation } from './crud.js';
import { syntaxCheck } from './devtools.js';
import { AdtApiError, AdtError } from './errors.js';
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
  return http.hasDiscoveryCollection(COLLECTIONS[type]) !== false;
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
  isScopeDependent?: boolean;
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
    ...(content.isScopeDependent !== undefined ? { isScopeDependent: text(content.isScopeDependent) === 'true' } : {}),
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
  return { ...info, assignments: await getAssignments(http, safety, name) };
}

async function getAssignments(http: AdtHttpClient, safety: SafetyConfig, name: string) {
  checkOperation(safety, OperationType.Read, 'GetSOD1Assignments');
  const listing = await http.get(
    `${COLLECTIONS.SOD1}/$packageassignments?name=${encodeURIComponent(name.toUpperCase())}`,
    { Accept: 'application/vnd.sap.adt.oda.packageassignments+xml' },
  );
  return parseApiPackageAssignments(listing.body);
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
    content = `<sod1:abbreviation>${escapeXmlAttr(definition.abbreviation)}</sod1:abbreviation>`;
  } else {
    const object = definition.apiObject;
    if (!definition.apiPackage?.trim() || !object?.type.trim() || !object.name.trim())
      throw new AdtError(
        'Creating an API package assignment (SOD2) requires "apiPackage" and "apiObject" {type, name, subType?, subName?}.',
      );
    content =
      `<sod2:packageID>${escapeXmlAttr(definition.apiPackage)}</sod2:packageID>` +
      `<sod2:apiWbObjectType>${escapeXmlAttr(object.type)}</sod2:apiWbObjectType>` +
      `<sod2:apiWbObjectName>${escapeXmlAttr(object.name)}</sod2:apiWbObjectName>` +
      `<sod2:apiSubWbObjectType>${escapeXmlAttr(object.subType ?? '')}</sod2:apiSubWbObjectType>` +
      // The sub-object name is fixed-width (service name padded, then version): passed through verbatim.
      `<sod2:apiSubWbObjectName>${escapeXmlAttr(object.subName ?? '')}</sod2:apiSubWbObjectName>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<${prefix}:${prefix} xmlns:${prefix}="${NAMESPACES[type]}" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:type="${type}" adtcore:name="${escapeXmlAttr(name)}" adtcore:description="${escapeXmlAttr(description)}">
  <adtcore:packageRef adtcore:name="${escapeXmlAttr(pkg)}"/>
  <${prefix}:content>${content}</${prefix}:content>
</${prefix}:${prefix}>`;
}

/** Fields that the create POST does not carry and therefore need a follow-up save. */
export function needsFollowUpSave(type: ApiCatalogType, definition: ApiCatalogDefinition): boolean {
  const createFields = type === 'SOD1' ? ['description', 'abbreviation'] : ['description', 'apiPackage', 'apiObject'];
  return Object.keys(definition).some((key) => !createFields.includes(key));
}

// SOD1 fields SAP can switch off per API package (Eclipse greys them out). SAP keeps its value and
// still answers the save with success, so a change to a switched-off field is refused up front.
const UI_ATTRIBUTES = { type: 'ui_attribute__type', isScopeDependent: 'ui_attribute__is_scope_dependent' } as const;

function assertFieldsEnabled(type: ApiCatalogType, xml: string, definition: ApiCatalogDefinition): void {
  if (type !== 'SOD1') return;
  const items = getNestedArray(record(parseXml(xml).sod1), 'adtConfigurationItems', 'adtConfigurationItem');
  const disabled = new Set(items.filter((i) => text(i.isEnabled) === 'false').map((i) => text(i.uiObjectId)));
  const current = parseApiPackage(xml);
  const blocked = (Object.keys(UI_ATTRIBUTES) as Array<keyof typeof UI_ATTRIBUTES>).filter(
    (key) => disabled.has(UI_ATTRIBUTES[key]) && definition[key] !== undefined && definition[key] !== current[key],
  );
  if (blocked.length)
    throw new AdtError(
      `SAP does not allow changing ${blocked.join(', ')} of this API package (switched off for its package, ` +
        'as in Eclipse); SAP would keep the old value. Nothing was saved.',
    );
}

// Keep qualified names and source offsets for edits to the original SAP document.
const catalogParser = new XMLParser({
  ignoreAttributes: false,
  processEntities: false,
  alwaysCreateTextNode: true,
  captureMetaData: true,
});

const OPENING_TAG = /^<(?:[^>"']|"[^"]*"|'[^']*')+>/;
function catalogChild(
  local: string,
  namespace: string,
  parent: Record<string, unknown>,
  ...ancestors: Record<string, unknown>[]
) {
  const matches = [];
  for (const [name, children] of Object.entries(parent)) {
    if (name.startsWith('@_') || (name !== local && !name.endsWith(`:${local}`))) continue;
    const prefix = name.slice(0, -local.length);
    const binding = prefix ? `@_xmlns:${prefix.slice(0, -1)}` : '@_xmlns';
    for (const node of Array.isArray(children) ? children : [children]) {
      const scope = [node, parent, ...ancestors].find((ancestor) => Object.hasOwn(ancestor, binding));
      if (scope?.[binding] !== namespace) continue;
      const { startIndex, endIndex } = node[XMLParser.getMetaDataSymbol() as symbol];
      matches.push({ name, prefix, node: record(node), start: Number(startIndex), end: Number(endIndex) });
    }
  }
  if (matches.length > 1) throw new AdtError(`Ambiguous metadata: duplicate ${local} element.`);
  return matches[0];
}

/** Apply a definition to the current SAP document; untouched parts are returned byte for byte. */
export function applyApiCatalogDefinition(type: ApiCatalogType, xml: string, definition: ApiCatalogDefinition): string {
  const ns = NAMESPACES[type];
  const fields = new Map<string, (prefix: string) => string>();
  for (const key of [
    'abbreviation',
    'alias',
    'namespace',
    'type',
    'leadingBusinessObjectType',
    'isScopeDependent',
  ] as const) {
    if (definition[key] !== undefined) fields.set(key, () => escapeXmlAttr(String(definition[key])));
  }
  const { documentationLink, tags, urls } = definition;
  if (documentationLink !== undefined)
    fields.set('documentationLinkReplacement', () => escapeXmlAttr(documentationLink));
  const element = (name: string, inner: string) => `<${name}>${inner}</${name}>`;
  if (tags)
    fields.set('tags', (prefix) =>
      tags
        .map((tag) =>
          element(
            `${prefix}tag`,
            element(`${prefix}value`, escapeXmlAttr(tag.value)) +
              element(`${prefix}category`, escapeXmlAttr(tag.category)),
          ),
        )
        .join(''),
    );
  if (urls)
    fields.set('urls', (prefix) =>
      urls
        .map((url) =>
          element(
            `${prefix}url`,
            (['technicalName', 'displayName', 'value', 'version', 'text'] as const)
              .map((key) => element(prefix + key, escapeXmlAttr(url[key])))
              .join(''),
          ),
        )
        .join(''),
    );

  if (XMLValidator.validate(xml) !== true) throw new AdtError('Invalid SAP catalog XML; nothing was saved.');
  const document = catalogParser.parse(xml) as Record<string, unknown>;
  const root = catalogChild(type.toLowerCase(), ns, document);
  if (
    !root ||
    Array.isArray(document[root.name]) ||
    Object.keys(document).filter((key) => !key.startsWith('?')).length !== 1
  )
    throw new AdtError(`SAP returned no ${type} metadata document; nothing was saved.`);
  const content = catalogChild('content', ns, root.node);
  if (!content) throw new AdtError(`SAP returned no ${type} content element; nothing was saved.`);

  const edits: Array<{ start: number; end: number; value: string }> = [];
  if (definition.description !== undefined) {
    const opening = xml.slice(root.start, root.end).match(OPENING_TAG)![0];
    const descriptions = [...opening.matchAll(/([^\s=]+)\s*=\s*("[^"]*"|'[^']*')/g)].filter(([, name]) => {
      const [prefix, local] = name!.split(':');
      return local === 'description' && root.node[`@_xmlns:${prefix}`] === 'http://www.sap.com/adt/core';
    });
    if (descriptions.length !== 1)
      throw new AdtError('Expected one ADT core description on the metadata root; nothing was saved.');
    const attr = descriptions[0]!;
    const end = root.start + attr.index + attr[0].length - 1;
    edits.push({ start: end - (attr[2]!.length - 2), end, value: escapeXmlAttr(definition.description) });
  }
  for (const [local, render] of fields) {
    const field = catalogChild(local, ns, content.node, root.node);
    if (!field)
      throw new AdtError(`SAP's metadata document has no <${type.toLowerCase()}:${local}> element; nothing was saved.`);
    const inner = render(field.prefix);
    const opening = xml.slice(field.start, field.end).match(OPENING_TAG)![0];
    const afterOpening = field.start + opening.length;
    if (opening.endsWith('/>')) {
      edits.push({ start: afterOpening - 2, end: afterOpening, value: `>${inner}</${field.name}>` });
    } else {
      edits.push({ start: afterOpening, end: xml.lastIndexOf('</', field.end - 1), value: inner });
    }
  }
  assertFieldsEnabled(type, xml, definition);
  let out = xml;
  for (const { start, end, value } of edits.sort((a, b) => b.start - a.start))
    out = out.slice(0, start) + value + out.slice(end);
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
  transport: string | undefined,
  minimalErrors: boolean,
): Promise<void> {
  checkOperation(safety, OperationType.Update, `Update${type}`);
  const url = apiCatalogObjectUrl(type, name);
  await withLockedMutation(http, safety, url, async (session, lock) => {
    const current = await session.get(url, { Accept: BLUES_V1, 'Cache-Control': 'no-cache' });
    const body = applyApiCatalogDefinition(type, current.body, definition);
    try {
      await updateObject(
        session,
        safety,
        url,
        body,
        lock.lockHandle,
        BLUES_V1,
        transport ?? (lock.corrNr || undefined),
      );
    } catch (err) {
      if (!minimalErrors && err instanceof AdtApiError && err.statusCode === 400)
        await explainRefusedSave(session, safety, url, body, err);
      throw err;
    }
  });
}

/**
 * SAP refuses an invalid save with one generic message ("… contains errors and cannot be saved").
 * Eclipse checks the edited document beforehand with a check run that carries it as an artifact;
 * the same check names the faulty fields. Best effort: without findings the original error stands.
 */
async function explainRefusedSave(
  http: AdtHttpClient,
  safety: SafetyConfig,
  url: string,
  body: string,
  err: AdtApiError,
): Promise<void> {
  try {
    const diagnostics = AdtApiError.extractDdicDiagnostics(err.responseBody ?? '');
    if (!diagnostics.some((d) => d.messageId === 'SWB_TOOL' && d.messageNumber === '036')) return;
    const check = await syntaxCheck(http, safety, url, {
      content: body,
      artifactUri: url,
      artifactContentType: `${BLUES_V1}; charset=utf-8`,
    });
    const findings = check.messages.filter((m) => m.severity !== 'info').map((m) => m.text);
    if (findings.length) err.extraHint = `SAP's check of the document reports: ${findings.join(' | ')}`;
  } catch {
    // Diagnostics only; the refused save is the error to report.
  }
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
    ? `<del:transportNumber>${escapeXmlAttr(effectiveTransport)}</del:transportNumber>`
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
  if (deleted?.['@_uri'] !== url || !['true', 'false'].includes(text(deleted['@_isDeleted'])))
    throw new AdtError(
      `SAP did not confirm the deletion outcome for ${type} ${name}. Check the object before retrying.`,
    );
  if (deleted['@_isDeleted'] === 'false') {
    const reason = messagesOf(deleted).join(' ');
    const assignments = type === 'SOD1' ? await getAssignments(http, safety, name).catch(() => []) : [];
    const names = assignments.map((a) => a.name).filter(Boolean);
    throw new AdtError(
      `SAP did not delete ${type} ${name}${reason ? `: ${reason}` : '.'}${names.length ? ` Current assignments: ${names.join(', ')}.` : ''}`,
    );
  }
  return { transport: effectiveTransport };
}
