/**
 * ADT object generators ("Generate ABAP Repository Objects", issue #1121).
 *
 * SAP ships server-side generators behind one framework (`framework=generators.v1`). The system
 * lists them as an Atom feed; every entry links its own endpoints by rel:
 *
 *   GET  /sap/bc/adt/repository/generators?fetchAllGenerators=true | ?referencedObject=<uri>
 *   GET  <schema>?referencedObject=…&package=…   → JSON Schema 2020-12 of the generator input
 *   GET  <content>?referencedObject=…&package=…  → SAP's proposed input (JSON)
 *   POST <validation>?referencedObject=…         → validationMessages (severity + text)
 *   POST <preview>?referencedObject=…            → massOperation tree of the objects to create
 *   POST <generator>?referencedObject=…&corrNr=… → objectReferences of the main object
 *
 * The three POSTs take the identical input JSON. Endpoint paths, ids and media types differ per
 * generator and release (`/bct/generators/ui/smbc` and `/rap/generators/ui/ui-service` on 816,
 * `/businessservices/generators/uiservice` on 758), so paths and media types are taken from the
 * feed, and paths must stay under one of the registry entry's prefixes. Only generators in
 * GENERATOR_REGISTRY run; the feed shows the rest as unsupported.
 *
 * SAP leaves several checks to the caller (#1202, live on 758): validation answers OK for an
 * unknown package, an invalid corrNr or another referenced object; the preview reports CREATE for
 * existing objects; the run response names only part of what was created; the JSON parser is
 * order-sensitive (`metadata` first). Callers therefore pin package, language and referenced
 * object, keep SAP's key order, fail closed on unknown validation shapes and read every previewed
 * object back after the run.
 * Evidence: docs/research/2026-10-28-adt-object-generators.md, docs/research/2026-11-06-rap-service-generators.md.
 */
import { postCreate } from './create-request.js';
import { AdtError, AdtSafetyError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import { canonicalHostRelativeAdtPath } from './path-safety.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import { parseXml } from './xml-parser.js';

export const GENERATORS_COLLECTION = '/sap/bc/adt/repository/generators';

const CONTENT_TYPE = 'application/vnd.sap.adt.serverdriven.content.v1+json; framework=generators.v1';
const SCHEMA_ACCEPT =
  'application/vnd.sap.adt.serverdriven.schema.v1+json; framework=generators.v1, application/vnd.sap.adt.repository.generator.schema.v1+json';
const CONTENT_ACCEPT = `${CONTENT_TYPE}, application/vnd.sap.adt.repository.generator.content.v1+json`;
const VALIDATION_ACCEPT =
  'application/vnd.sap.adt.validationMessages.v1+xml, application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.StatusMessage';
const PREVIEW_ACCEPT = 'application/vnd.sap.adt.repository.objects.massoperation.v1+xml';
// SAP declares this JSON type but answers the run with adtcore:objectReferences XML (816).
const RUN_ACCEPT = 'application/vnd.sap.adt.repository.generator.v1+json';
// The smbc run took 34 s of server time for 24 objects on 816; leave headroom over the 120 s default.
const RUN_TIMEOUT_MS = 300_000;

const REL_PREFIX = 'http://www.sap.com/adt/repository/generator';

/** A generator ARC-1 runs. Adding one = a row here plus fixtures and tests. */
export interface GeneratorRegistryEntry {
  /** SAPWrite types accepted as the referenced object. */
  referencedTypes: readonly string[];
  /** Every endpoint the feed links for this generator must stay under one of these paths. */
  pathPrefixes: readonly string[];
  /**
   * Input values ARC-1 enforces, by dot path. `overwriteExistingObjects` would let the generator
   * replace objects whose package was never checked, so it stays false.
   */
  pinnedInput: Readonly<Record<string, unknown>>;
  /**
   * Dot path of the input field that names the referenced object. SAP's validation does not check
   * it against `referencedObject`, so ARC-1 sets it and refuses overrides naming another object.
   */
  referencedNamePath?: string;
}

const RAP_SERVICE: Omit<GeneratorRegistryEntry, 'pathPrefixes'> = {
  referencedTypes: ['TABL'],
  pinnedInput: {},
  referencedNamePath: 'general.referenceObjectName',
};

/**
 * The RAP service generators carry different ids and paths per release: `ui-service` /
 * `webapi-service` under `/rap/generators/ui/` (816, BTP), `uiservice` / `webapiservice` under
 * `/businessservices/generators/` (758).
 */
export const GENERATOR_REGISTRY: Readonly<Record<string, GeneratorRegistryEntry>> = {
  smbc: {
    referencedTypes: ['TABL'],
    pathPrefixes: ['/sap/bc/adt/bct/generators/ui/smbc'],
    pinnedInput: { 'options.overwriteExistingObjects': false },
  },
  'ui-service': { ...RAP_SERVICE, pathPrefixes: ['/sap/bc/adt/rap/generators/ui/ui-service'] },
  'webapi-service': { ...RAP_SERVICE, pathPrefixes: ['/sap/bc/adt/rap/generators/ui/webapi-service'] },
  uiservice: { ...RAP_SERVICE, pathPrefixes: ['/sap/bc/adt/businessservices/generators/uiservice'] },
  webapiservice: { ...RAP_SERVICE, pathPrefixes: ['/sap/bc/adt/businessservices/generators/webapiservice'] },
};

export function isSupportedGenerator(id: string): boolean {
  return Object.hasOwn(GENERATOR_REGISTRY, id);
}

export interface GeneratorInfo {
  id: string;
  title: string;
  description: string;
  category: string;
  /** Object types the generator starts from; empty when it needs no referenced object. */
  referencedObjectTypes: string[];
  supported: boolean;
  /** Endpoint hrefs by short rel name (content, schema, validation, preview, generator, …). */
  links: Record<string, string>;
  /** Media type SAP declares per link, by the same short rel name. */
  linkTypes: Record<string, string>;
}

export interface GeneratorMessage {
  severity: string;
  text: string;
}

export interface GeneratorPlannedObject {
  group: string;
  operation: string;
  type: string;
  name: string;
  uri: string;
}

export interface GeneratorObjectReference {
  type: string;
  name: string;
  uri: string;
}

export interface GeneratorField {
  path: string;
  type?: string;
  title?: string;
  enum?: string[];
  maxLength?: number;
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function shortRel(rel: string): string {
  if (rel === REL_PREFIX) return 'generator';
  return rel.slice(rel.lastIndexOf('/') + 1);
}

/** Parse the generator Atom feed. */
export function parseGeneratorFeed(xml: string): GeneratorInfo[] {
  const feed = (parseXml(xml).feed ?? {}) as Record<string, unknown>;
  return asArray(feed.entry as Record<string, unknown>[]).map((entry) => {
    const id = String(entry.id ?? '');
    const category = (asArray(entry.category as Record<string, unknown>[])[0] ?? {}) as Record<string, unknown>;
    const links: Record<string, string> = {};
    const linkTypes: Record<string, string> = {};
    for (const link of asArray(entry.link as Record<string, unknown>[])) {
      const rel = String(link['@_rel'] ?? '');
      const href = String(link['@_href'] ?? '');
      const type = String(link['@_type'] ?? '');
      if (rel && href) links[shortRel(rel)] = href;
      if (rel && type) linkTypes[shortRel(rel)] = type;
    }
    const refTypes = String(entry['@_referencedObjectTypes'] ?? '');
    return {
      id,
      title: String(entry.title ?? ''),
      description: stripHtml(String(entry.summary ?? '')),
      category: String(category['@_term'] ?? ''),
      referencedObjectTypes: refTypes
        .split(';')
        .map((t) => t.trim())
        .filter(Boolean),
      supported: isSupportedGenerator(id),
      links,
      linkTypes,
    };
  });
}

/** List the generators the system offers, optionally only those applicable to one object. */
export async function listGenerators(
  http: AdtHttpClient,
  safety: SafetyConfig,
  referencedObjectUri?: string,
): Promise<GeneratorInfo[]> {
  checkOperation(safety, OperationType.Read, 'ListGenerators');
  const query = referencedObjectUri
    ? `referencedObject=${encodeURIComponent(referencedObjectUri)}`
    : 'fetchAllGenerators=true';
  const resp = await http.get(`${GENERATORS_COLLECTION}?${query}`, {
    Accept: 'application/atom+xml;type=feed',
    'X-sap-adt-feed': '',
  });
  return parseGeneratorFeed(resp.body);
}

/**
 * Resolve one endpoint of a supported generator. The href comes from SAP's feed, so it is only
 * used when it stays under the registry path; the query SAP put on it is dropped.
 */
export function generatorEndpoint(generator: GeneratorInfo, rel: string): string {
  const entry = GENERATOR_REGISTRY[generator.id];
  if (!entry) throw new AdtSafetyError(`Generator '${generator.id}' is not supported by ARC-1.`);
  const href = generator.links[rel];
  if (!href) {
    throw new AdtError(`Generator '${generator.id}' does not advertise a '${rel}' endpoint on this system.`);
  }
  for (const prefix of entry.pathPrefixes) {
    const canonical = canonicalHostRelativeAdtPath(href.split('?')[0] ?? '', prefix);
    if (canonical && (canonical === prefix || canonical.startsWith(`${prefix}/`))) return canonical;
  }
  throw new AdtSafetyError(`Generator '${generator.id}' advertises an unexpected '${rel}' endpoint: ${href}`);
}

/** The media type SAP declares for one link, else the 816 default. */
function linkType(generator: GeneratorInfo, rel: string, fallback: string): string {
  return generator.linkTypes?.[rel] || fallback;
}

/** Content type of the input JSON for validation, preview and run: SAP's own type of the content link. */
function inputContentType(generator: GeneratorInfo): string {
  return linkType(generator, 'content', CONTENT_TYPE);
}

function withQuery(path: string, params: Array<[string, string]>): string {
  return `${path}?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}

function parseJson(body: string, what: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw new AdtError(`SAP returned an unreadable ${what} (not JSON).`);
  }
}

/** SAP's JSON Schema for the input and its proposed input for one referenced object and package. */
export async function getGeneratorDefaults(
  http: AdtHttpClient,
  safety: SafetyConfig,
  generator: GeneratorInfo,
  referencedObjectUri: string,
  packageName: string,
): Promise<{ schema: unknown; content: Record<string, unknown> }> {
  checkOperation(safety, OperationType.Read, 'GetGeneratorDefaults');
  const params: Array<[string, string]> = [
    ['referencedObject', referencedObjectUri],
    ['package', packageName],
  ];
  const schemaResp = await http.get(withQuery(generatorEndpoint(generator, 'schema'), params), {
    Accept: linkType(generator, 'schema', SCHEMA_ACCEPT),
  });
  const contentResp = await http.get(withQuery(generatorEndpoint(generator, 'content'), params), {
    Accept: linkType(generator, 'content', CONTENT_ACCEPT),
  });
  const content = parseJson(contentResp.body, 'generator content');
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    throw new AdtError('SAP returned generator content that is not a JSON object.');
  }
  return { schema: parseJson(schemaResp.body, 'generator schema'), content: content as Record<string, unknown> };
}

/**
 * Parse SAP's validation answer: `validationMessages` (816, BTP) or an `asx:abap` StatusMessage
 * with `DATA/SEVERITY`/`SHORT_TEXT` entries (758). An `OK` entry without text means the input passed.
 */
export function parseGeneratorValidation(xml: string): GeneratorMessage[] {
  const parsed = parseXml(xml);
  const root = (parsed.validationMessages ?? {}) as Record<string, unknown>;
  const messages = asArray(root.validationMessage as Record<string, unknown>[]).map((msg) => ({
    severity: String(msg.severity ?? '').toUpperCase(),
    text: String(msg.shorttext ?? msg.longtext ?? ''),
  }));
  const status = asArray(parsed.abap as Record<string, unknown>[])
    .flatMap((abap) => asArray(abap.values as Record<string, unknown>[]))
    .flatMap((values) => asArray(values.DATA as Record<string, unknown>[]))
    .map((entry) => ({ severity: String(entry.SEVERITY ?? '').toUpperCase(), text: String(entry.SHORT_TEXT ?? '') }));
  return [...messages, ...status];
}

/** True when SAP reported an error (or worse) for the input. */
export function hasGeneratorErrors(messages: GeneratorMessage[]): boolean {
  return messages.some((m) => m.severity === 'ERROR' || m.severity === 'FATAL' || m.severity === 'ABORT');
}

/**
 * The input passed SAP's validation: at least one recognized message and no error. An answer
 * ARC-1 cannot read never counts as a pass, so an unknown shape cannot allow a run.
 */
export function generatorValidationPassed(messages: GeneratorMessage[]): boolean {
  return messages.length > 0 && messages.every((m) => m.severity !== '') && !hasGeneratorErrors(messages);
}

/**
 * Validate the input. A POST that changes nothing, hence Read (see AGENTS.md: ADT POSTs that look
 * like reads).
 */
export async function validateGeneratorInput(
  http: AdtHttpClient,
  safety: SafetyConfig,
  generator: GeneratorInfo,
  referencedObjectUri: string,
  input: Record<string, unknown>,
): Promise<GeneratorMessage[]> {
  checkOperation(safety, OperationType.Read, 'ValidateGeneratorInput');
  const path = withQuery(generatorEndpoint(generator, 'validation'), [['referencedObject', referencedObjectUri]]);
  const resp = await http.post(path, JSON.stringify(input), inputContentType(generator), {
    Accept: linkType(generator, 'validation', VALIDATION_ACCEPT),
  });
  return parseGeneratorValidation(resp.body);
}

/**
 * Flatten the preview into the planned objects: a massOperation tree with an `Operation` per object
 * (816, BTP) or a flat `adtcore:objectReferences` list without one (758).
 */
export function parseGeneratorPreview(xml: string): GeneratorPlannedObject[] {
  const parsed = parseXml(xml);
  if (parsed.objectReferences !== undefined) {
    return parseGeneratorRunResult(xml).map((ref) => ({ group: '', operation: '', ...ref }));
  }
  const planned: GeneratorPlannedObject[] = [];
  const walk = (group: Record<string, unknown>, label: string): void => {
    for (const obj of asArray(group.object as Record<string, unknown>[])) {
      const props = asArray(obj.property as Record<string, unknown>[]);
      const operation = props.find((p) => p['@_key'] === 'Operation');
      for (const ref of asArray(obj.objectReference as Record<string, unknown>[])) {
        planned.push({
          group: label,
          operation: String(operation?.['#text'] ?? ''),
          type: String(ref['@_type'] ?? ''),
          name: String(ref['@_name'] ?? ''),
          uri: String(ref['@_uri'] ?? ''),
        });
      }
    }
    for (const child of asArray(group.group as Record<string, unknown>[])) {
      walk(child, String(child['@_name'] ?? label));
    }
  };
  walk((parsed.group ?? {}) as Record<string, unknown>, '');
  return planned;
}

/** Preview the objects the generator would create. Changes nothing (see validateGeneratorInput). */
export async function previewGenerator(
  http: AdtHttpClient,
  safety: SafetyConfig,
  generator: GeneratorInfo,
  referencedObjectUri: string,
  input: Record<string, unknown>,
): Promise<GeneratorPlannedObject[]> {
  checkOperation(safety, OperationType.Read, 'PreviewGenerator');
  const path = withQuery(generatorEndpoint(generator, 'preview'), [['referencedObject', referencedObjectUri]]);
  const resp = await http.post(path, JSON.stringify(input), inputContentType(generator), {
    Accept: linkType(generator, 'preview', PREVIEW_ACCEPT),
  });
  const planned = parseGeneratorPreview(resp.body).filter((o) => o.type !== '' && o.name !== '');
  if (planned.length === 0) throw new AdtError('SAP returned no objects in the generator preview.');
  return planned;
}

/** Parse the run response (`adtcore:objectReferences`). */
export function parseGeneratorRunResult(xml: string): GeneratorObjectReference[] {
  const root = (parseXml(xml).objectReferences ?? {}) as Record<string, unknown>;
  return asArray(root.objectReference as Record<string, unknown>[]).map((ref) => ({
    type: String(ref['@_type'] ?? ''),
    name: String(ref['@_name'] ?? ''),
    uri: String(ref['@_uri'] ?? ''),
  }));
}

/**
 * Run the generator. Never replayed: a lost response must not create a second set of objects. The
 * response names only part of what was created (758: one of nine), so callers read the previewed
 * objects back themselves.
 */
export async function runGenerator(
  http: AdtHttpClient,
  safety: SafetyConfig,
  generator: GeneratorInfo,
  referencedObjectUri: string,
  input: Record<string, unknown>,
  transport?: string,
): Promise<GeneratorObjectReference[]> {
  checkOperation(safety, OperationType.Create, 'RunGenerator');
  const params: Array<[string, string]> = [['referencedObject', referencedObjectUri]];
  if (transport) params.push(['corrNr', transport]);
  const resp = await postCreate(
    http,
    withQuery(generatorEndpoint(generator, 'generator'), params),
    JSON.stringify(input),
    inputContentType(generator),
    { Accept: linkType(generator, 'generator', RUN_ACCEPT) },
    { fetchTimeoutMs: RUN_TIMEOUT_MS, noReplay: true },
  );
  return parseGeneratorRunResult(resp.body);
}

/**
 * Throws when the package does not exist: neither SAP's validation nor the transport check notices
 * (both answered OK / RECORDING for an unknown package on 758).
 */
export async function assertGeneratorPackageExists(
  http: AdtHttpClient,
  safety: SafetyConfig,
  packageName: string,
): Promise<void> {
  checkOperation(safety, OperationType.Read, 'ReadGeneratorPackage');
  await http.get(`/sap/bc/adt/packages/${encodeURIComponent(packageName)}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Merge caller overrides into SAP's proposal. Objects merge by key, arrays item by item (by
 * position), anything else is replaced.
 */
export function mergeGeneratorInput(base: unknown, overrides: unknown): unknown {
  if (Array.isArray(base) && Array.isArray(overrides)) {
    const length = Math.max(base.length, overrides.length);
    return Array.from({ length }, (_, i) =>
      i < overrides.length ? mergeGeneratorInput(base[i], overrides[i]) : base[i],
    );
  }
  if (isPlainObject(base) && isPlainObject(overrides)) {
    const merged: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(overrides)) merged[key] = mergeGeneratorInput(base[key], value);
    return merged;
  }
  return overrides === undefined ? base : overrides;
}

function getPath(obj: Record<string, unknown>, path: string): unknown {
  let current: unknown = obj;
  for (const key of path.split('.')) {
    if (!isPlainObject(current)) return undefined;
    current = current[key];
  }
  return current;
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let current = obj;
  for (const key of keys.slice(0, -1)) {
    if (!isPlainObject(current[key])) current[key] = {};
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1] as string] = value;
}

/**
 * Build the input sent to SAP: proposal + overrides, then the values ARC-1 owns. `metadata`
 * carries the target package that the package gate checked, so callers may not set it; pinned
 * inputs and the referenced object's name may not be changed. SAP's parser is order-sensitive, so
 * the proposal's key order is kept (overrides merge in place) and `metadata` comes first.
 */
export function buildGeneratorInput(
  generatorId: string,
  proposal: Record<string, unknown>,
  overrides: Record<string, unknown> | undefined,
  packageName: string,
  masterLanguage: string,
  referencedName: string,
): Record<string, unknown> {
  const entry = GENERATOR_REGISTRY[generatorId];
  if (!entry) throw new AdtSafetyError(`Generator '${generatorId}' is not supported by ARC-1.`);
  if (overrides && Object.hasOwn(overrides, 'metadata')) {
    throw new AdtSafetyError(
      'metadata is set by ARC-1 (package from "package", language from SAP_LANGUAGE) and cannot be overridden.',
    );
  }
  for (const [path, value] of Object.entries(entry.pinnedInput)) {
    const requested = overrides ? getPath(overrides, path) : undefined;
    if (requested !== undefined && requested !== value) {
      throw new AdtSafetyError(`${path} must be ${JSON.stringify(value)} in ARC-1.`);
    }
  }
  const namePath = entry.referencedNamePath;
  if (namePath && overrides) {
    const requested = getPath(overrides, namePath);
    if (requested !== undefined && String(requested).toUpperCase() !== referencedName.toUpperCase()) {
      throw new AdtSafetyError(
        `${namePath} names the referenced object and must be ${referencedName.toUpperCase()}; pass another object as type/name instead.`,
      );
    }
  }
  const merged = mergeGeneratorInput(proposal, overrides ?? {}) as Record<string, unknown>;
  const { metadata: _metadata, ...rest } = merged;
  const input: Record<string, unknown> = {
    metadata: {
      ...(isPlainObject(proposal.metadata) ? proposal.metadata : {}),
      package: packageName,
      masterLanguage,
    },
    ...rest,
  };
  for (const [path, value] of Object.entries(entry.pinnedInput)) setPath(input, path, value);
  // Only where SAP's proposal has the field: adding it would change the structure SAP parses.
  if (namePath && getPath(proposal, namePath) !== undefined) setPath(input, namePath, referencedName.toUpperCase());
  return input;
}

/** Compact list of the input fields from SAP's JSON Schema, without the ARC-1-owned `metadata`. */
export function summarizeGeneratorSchema(schema: unknown): GeneratorField[] {
  const fields: GeneratorField[] = [];
  const walk = (node: unknown, path: string): void => {
    if (!isPlainObject(node)) return;
    const properties = node.properties;
    if (isPlainObject(properties)) {
      for (const [key, child] of Object.entries(properties)) {
        if (!path && key === 'metadata') continue;
        walk(child, path ? `${path}.${key}` : key);
      }
      return;
    }
    if (node.type === 'array' && isPlainObject(node.items)) {
      walk(node.items, `${path}[]`);
      return;
    }
    if (!path) return;
    const field: GeneratorField = { path };
    if (typeof node.type === 'string') field.type = node.type;
    if (typeof node.title === 'string') field.title = node.title;
    if (Array.isArray(node.enum)) field.enum = node.enum.map(String);
    if (typeof node.maxLength === 'number') field.maxLength = node.maxLength;
    fields.push(field);
  };
  walk(schema, '');
  return fields;
}
