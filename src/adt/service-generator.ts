/**
 * SAP's RAP service generators ("Generate ABAP Repository Objects" in ADT): one database table →
 * a RAP OData UI or Web API service stack. Request sequence, all on endpoints the generator feed links:
 *
 *   GET  /sap/bc/adt/repository/generators?referencedObject=<table uri>  → Atom feed, one entry per generator
 *   GET  <content>?referencedObject=…&package=…        → SAP's proposed input (JSON)
 *   POST <validation>?referencedObject=…&package=…     → severity per problem; nothing persisted
 *   POST <preview>?referencedObject=…                  → planned objects; nothing persisted
 *   POST <generator>?referencedObject=…[&corrNr=…]     → creates the objects
 *
 * Ids, paths, media types and response shapes differ per release (7.58: `uiservice` under
 * /businessservices/generators/; 8.16: `ui-service` under /rap/generators/ui/). Contract and evidence:
 * docs/research/2026-11-22-rap-service-generators.md.
 */
import { postCreate } from './create-request.js';
import { AdtError, AdtSafetyError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import { canonicalHostRelativeAdtPath } from './path-safety.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import { parseXml } from './xml-parser.js';

/** ARC-1's stable generator names → the ids SAP's feed uses for them (8.16, 7.58). */
export const SERVICE_GENERATORS = {
  'ui-service': ['ui-service', 'uiservice'],
  'webapi-service': ['webapi-service', 'webapiservice'],
} as const;
export type ServiceGeneratorName = keyof typeof SERVICE_GENERATORS;

// Feed hrefs come from SAP; only <prefix><id> and paths below it are ever called.
const PATH_PREFIXES = ['/sap/bc/adt/rap/generators/ui/', '/sap/bc/adt/businessservices/generators/'];
const REL = 'http://www.sap.com/adt/repository/generator';
// Both releases advertise exactly these checks on the validation link.
const VALIDATION_CHECKS = 'package,referencedobject,authorization';
// A 7.58 run took 34 s; leave headroom over the 120 s default.
const RUN_TIMEOUT_MS = 300_000;

type Rel = 'content' | 'validation' | 'preview' | 'generator';
interface Endpoint {
  path: string;
  mediaType: string;
}
export interface ServiceGenerator {
  id: string;
  endpoints: Record<Rel, Endpoint>;
}
export interface GeneratorMessage {
  severity: string;
  text: string;
}
export interface PlannedObject {
  type: string;
  name: string;
  operation: string;
}

type XmlNode = Record<string, unknown>;
const nodes = (value: unknown): XmlNode[] =>
  value === undefined || value === null ? [] : ((Array.isArray(value) ? value : [value]) as XmlNode[]);

function withQuery(path: string, params: Record<string, string | undefined>): string {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${encodeURIComponent(value as string)}`)
    .join('&');
  return `${path}?${query}`;
}

/** The table as ADT addresses it in `referencedObject` (lower case, as ADT itself sends it). */
export function tableUri(table: string): string {
  return `/sap/bc/adt/ddic/tables/${encodeURIComponent(table.toLowerCase())}`;
}

/** The canonical endpoint path when the href stays at or below one generator root, else undefined. */
function generatorPath(href: string, id: string): string | undefined {
  for (const root of PATH_PREFIXES.map((prefix) => `${prefix}${id}`)) {
    const path = canonicalHostRelativeAdtPath(href, root);
    if (path === root || path?.startsWith(`${root}/`)) return path;
  }
  return undefined;
}

/**
 * Find the generator in the feed for one table. Returns the ids offered when it is missing;
 * a 404 (no generator framework, e.g. 7.50) propagates to the caller.
 */
export async function findServiceGenerator(
  http: AdtHttpClient,
  safety: SafetyConfig,
  name: ServiceGeneratorName,
  table: string,
): Promise<ServiceGenerator | { offered: string[] }> {
  checkOperation(safety, OperationType.Read, 'ListGenerators');
  const resp = await http.get(withQuery('/sap/bc/adt/repository/generators', { referencedObject: tableUri(table) }), {
    Accept: 'application/atom+xml;type=feed',
  });
  const entries = nodes(parseXml(resp.body).feed).flatMap((feed) => nodes(feed.entry));
  const ids: readonly string[] = SERVICE_GENERATORS[name];
  const entry = entries.find((e) => ids.includes(String(e.id ?? '')));
  if (!entry) return { offered: entries.map((e) => String(e.id ?? '')) };
  const id = String(entry.id);
  const endpoints = {} as Record<Rel, Endpoint>;
  for (const rel of ['content', 'validation', 'preview', 'generator'] as const) {
    const link = nodes(entry.link).find((l) => l['@_rel'] === (rel === 'generator' ? REL : `${REL}/${rel}`));
    // SAP's own query (referencedObject, checks) is dropped; ARC-1 builds it per request.
    const href = String(link?.['@_href'] ?? '').split('?')[0] ?? '';
    const path = generatorPath(href, id);
    if (!path || !link?.['@_type']) {
      throw new AdtSafetyError(`Generator '${id}' advertises no usable '${rel}' endpoint (${href || 'none'}).`);
    }
    endpoints[rel] = { path, mediaType: String(link['@_type']) };
  }
  return { id, endpoints };
}

/** SAP's proposed input for the table and target package. */
export async function proposeInput(
  http: AdtHttpClient,
  safety: SafetyConfig,
  gen: ServiceGenerator,
  table: string,
  packageName: string,
): Promise<Record<string, unknown>> {
  checkOperation(safety, OperationType.Read, 'ProposeGeneratorInput');
  const { path, mediaType } = gen.endpoints.content;
  const resp = await http.get(withQuery(path, { referencedObject: tableUri(table), package: packageName }), {
    Accept: mediaType,
  });
  let content: unknown;
  try {
    content = JSON.parse(resp.body);
  } catch {
    throw new AdtError('SAP returned a generator proposal that is not JSON.');
  }
  if (!isObject(content)) throw new AdtError('SAP returned a generator proposal that is not a JSON object.');
  return content;
}

/** Validate the input (a POST that persists nothing, hence Read). */
export async function validateInput(
  http: AdtHttpClient,
  safety: SafetyConfig,
  gen: ServiceGenerator,
  table: string,
  input: Record<string, unknown>,
  packageName: string,
): Promise<GeneratorMessage[]> {
  checkOperation(safety, OperationType.Read, 'ValidateGeneratorInput');
  const { path, mediaType } = gen.endpoints.validation;
  const params = { referencedObject: tableUri(table), package: packageName, checks: VALIDATION_CHECKS };
  const resp = await http.post(withQuery(path, params), JSON.stringify(input), gen.endpoints.content.mediaType, {
    Accept: mediaType,
  });
  const parsed = parseXml(resp.body);
  // 8.16: validationMessages/validationMessage with severity + shorttext.
  const messages = nodes(parsed.validationMessages)
    .flatMap((root) => nodes(root.validationMessage))
    .map((m) => ({ severity: String(m.severity ?? ''), text: String(m.shorttext ?? m.longtext ?? '') }));
  // 7.58: asx:abap StatusMessage with DATA/SEVERITY + SHORT_TEXT.
  const status = nodes(parsed.abap)
    .flatMap((abap) => nodes(abap.values))
    .flatMap((values) => nodes(values.DATA))
    .map((d) => ({ severity: String(d.SEVERITY ?? ''), text: String(d.SHORT_TEXT ?? '') }));
  return [...messages, ...status].map((m) => ({ severity: m.severity.toUpperCase(), text: m.text.trim() }));
}

/** Only an explicit OK passes; an empty or unknown answer never does. */
export function validationPassed(messages: GeneratorMessage[]): boolean {
  return messages.length > 0 && messages.every((m) => m.severity === 'OK');
}

/** The objects the run would create (a POST that persists nothing, hence Read). */
export async function previewObjects(
  http: AdtHttpClient,
  safety: SafetyConfig,
  gen: ServiceGenerator,
  table: string,
  input: Record<string, unknown>,
): Promise<PlannedObject[]> {
  checkOperation(safety, OperationType.Read, 'PreviewGenerator');
  const { path, mediaType } = gen.endpoints.preview;
  const resp = await http.post(
    withQuery(path, { referencedObject: tableUri(table) }),
    JSON.stringify(input),
    gen.endpoints.content.mediaType,
    { Accept: mediaType },
  );
  const parsed = parseXml(resp.body);
  const planned = (ref: XmlNode, operation: unknown): PlannedObject => ({
    type: String(ref['@_type'] ?? ''),
    name: String(ref['@_name'] ?? '').toUpperCase(),
    operation: String(operation ?? '').toUpperCase(),
  });
  // 7.58: flat adtcore:objectReferences; the operation travels in adtcore:description.
  const flat = nodes(parsed.objectReferences)
    .flatMap((root) => nodes(root.objectReference))
    .map((ref) => planned(ref, ref['@_description']));
  // 8.16: nested massOperation groups; each object carries an "Operation" property.
  const walk = (group: XmlNode): PlannedObject[] => [
    ...nodes(group.object).flatMap((obj) => {
      const op = nodes(obj.property).find((p) => p['@_key'] === 'Operation')?.['#text'];
      return nodes(obj.objectReference).map((ref) => planned(ref, op));
    }),
    ...nodes(group.group).flatMap(walk),
  ];
  const objects = [...flat, ...nodes(parsed.group).flatMap(walk)].filter((o) => o.type && o.name);
  if (objects.length === 0) throw new AdtError('SAP returned no objects in the generator preview.');
  return objects;
}

/**
 * Run the generator once. Never replayed: a lost response must not create a second stack. The
 * response names only part of what was created, so callers read the planned objects back.
 */
export async function runGenerator(
  http: AdtHttpClient,
  safety: SafetyConfig,
  gen: ServiceGenerator,
  table: string,
  input: Record<string, unknown>,
  transport: string | undefined,
): Promise<void> {
  checkOperation(safety, OperationType.Create, 'RunGenerator');
  const { path, mediaType } = gen.endpoints.generator;
  await postCreate(
    http,
    withQuery(path, { referencedObject: tableUri(table), corrNr: transport }),
    JSON.stringify(input),
    gen.endpoints.content.mediaType,
    { Accept: mediaType },
    { fetchTimeoutMs: RUN_TIMEOUT_MS, noReplay: true },
  );
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// The field naming the table (7.58 / 8.16); SAP's validation does not check it against referencedObject.
const TABLE_NAME_KEYS = ['referenceObjectName', 'referencedObjectName'];

/**
 * Merge caller overrides into SAP's proposal. Only keys SAP proposed, with the same shape (objects
 * recurse, plain values replace plain values); never `metadata` or the table name. The proposal's
 * key order is kept because SAP's parser is order-sensitive.
 */
export function applyOverrides(
  proposal: Record<string, unknown>,
  overrides: Record<string, unknown>,
  path = '',
): Record<string, unknown> {
  const merged = { ...proposal };
  for (const [key, value] of Object.entries(overrides)) {
    const at = path ? `${path}.${key}` : key;
    const proposed = proposal[key];
    if (at === 'metadata') throw new AdtSafetyError('metadata is set by ARC-1 from "package"; remove it from source.');
    if (!Object.hasOwn(proposal, key)) {
      throw new AdtSafetyError(`source key "${at}" is not in SAP's proposal; use the keys shown in dryRun "input".`);
    }
    if (isObject(proposed) !== isObject(value) || Array.isArray(proposed) || Array.isArray(value)) {
      throw new AdtSafetyError(`source key "${at}" must keep the shape of SAP's proposal.`);
    }
    if (TABLE_NAME_KEYS.includes(key) && String(value).toUpperCase() !== String(proposed).toUpperCase()) {
      throw new AdtSafetyError(`source key "${at}" names the table; pass another table as "name" instead.`);
    }
    merged[key] = isObject(proposed) ? applyOverrides(proposed, value as Record<string, unknown>, at) : value;
  }
  return merged;
}

/** The input sent to SAP: `metadata` first (SAP's parser expects it first) with ARC-1's package and language. */
export function buildInput(
  proposal: Record<string, unknown>,
  overrides: Record<string, unknown>,
  packageName: string,
  masterLanguage: string,
): Record<string, unknown> {
  const { metadata, ...rest } = applyOverrides(proposal, overrides);
  return { metadata: { ...(isObject(metadata) ? metadata : {}), package: packageName, masterLanguage }, ...rest };
}
