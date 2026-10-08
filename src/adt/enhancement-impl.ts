/**
 * BAdI enhancement implementations (ENHO/XHB) — create/update XML and the JSON definition SAPWrite accepts.
 *
 * ADT models an XHB enhancement implementation as ONE metadata document (no /source/main):
 *   GET/PUT /sap/bc/adt/enhancements/enhoxhb/{name}   application/vnd.sap.adt.enh.enhoxhb.v4+xml
 *   <enho:objectData adtcore:type="ENHO/XHB" …><adtcore:packageRef/>
 *     <enho:contentCommon enho:toolType="BADI_IMPL"><enho:usages> → the enhancement spot (ENHS/XSB)
 *     <enho:contentSpecific><enho:badiTechnology><enho:badiImplementations><enho:badiImplementation …>
 *       enhancementSpot, badiDefinition (ENHS/XB), implementingClass (CLAS/OC)
 *
 * The body mirrors SAP's own GET serialization (tests/fixtures/xml/enhancement-implementation.xml).
 * Create follows Eclipse: POST the container (spot, no implementations), then lock → PUT the full
 * document with the transport → unlock (`badiContainerXml`).
 * Live evidence: docs/research/2026-10-07-enho-xhb-write-contract.md.
 *
 * SAPRead returns the implementation as JSON and SAPWrite takes the same JSON in "source", so a
 * read → edit → write cycle needs no reshaping. Read-only keys (name, package, technology, …) are ignored.
 */
import {
  ABAP_NAME_RE,
  buildFilterTreeXml,
  type FilterDeclaration,
  normalizeFilterCondition,
  parseFilterCondition,
  withFilterConditions,
} from './enho-filter.js';
import { AdtApiError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import type { EnhancementImplementationInfo } from './types.js';
import {
  escapeXmlAttr,
  getNestedArray,
  parseEnhancementImplementation,
  parseXml,
  toRecordArray,
} from './xml-parser.js';

export const ENHO_XHB_CONTENT_TYPE = 'application/vnd.sap.adt.enh.enhoxhb.v4+xml';
export const ENHO_XHB_COLLECTION = '/sap/bc/adt/enhancements/enhoxhb';
/** Media type of the spot read, live-verified from discovery and the response Content-Type. */
export const ENHS_XSB_CONTENT_TYPE = 'application/vnd.sap.adt.enh.enhs.v2+xml';

export interface BadiImplementationEntry {
  name: string;
  badiDefinition: string;
  implementingClass: string;
  shortText?: string;
  active?: boolean;
  default?: boolean;
  /** Filter condition as SAPRead shows it, e.g. `COUNTRY = 'BE'`; '' removes a stored filter. */
  filter?: string;
  /** Set by the merge: the stored `<enho:filterTree>` stays as it is (filter unchanged or not given). */
  keepStoredFilter?: boolean;
  /** Set by resolveBadiFilters: a new filter tree built from `filter` and the BAdI's declarations. */
  filterTreeXml?: string;
  /** Stored content ARC-1 does not model, carried through an update unchanged (set by the merge only). */
  preserved?: PreservedImplementation;
}

/** Per-implementation content an update must not drop: SAP keeps only what the PUT sends (live 816). */
export interface PreservedImplementation {
  example: string;
  customizingLock: string;
  /** SAP's own `<enho:filterTree>` element, re-sent verbatim. */
  filterTreeXml: string;
}

/** The writable part of an XHB enhancement implementation — what SAPWrite accepts as JSON in "source". */
export interface BadiImplementationDefinition {
  enhancementSpot?: string;
  badiImplementations?: BadiImplementationEntry[];
}

/** Stored implementation plus the spot named in its usages (also present when it has no BAdI implementations). */
export type StoredBadiImplementation = EnhancementImplementationInfo & {
  enhancementSpot?: string;
  /** Keyed by upper-case implementation name. */
  preserved?: Map<string, PreservedImplementation>;
};

/**
 * A raw attribute value from a regex-captured attribute list, or ''. Only for ABAP names and type codes,
 * which never contain entity references; free text comes from the (decoding) parser.
 */
function rawAttr(attrs: string, qualifiedName: string): string {
  return attrs.match(new RegExp(`(?:^|\\s)${qualifiedName}="([^"]*)"`))?.[1] ?? '';
}

/** Keep per implementation what the JSON model does not carry. */
function preservedImplementations(xml: string, doc: Record<string, unknown>): Map<string, PreservedImplementation> {
  // The filter tree is cut out of the raw XML: it must be re-sent as SAP serialized it.
  const trees = new Map<string, string>();
  for (const match of xml.matchAll(
    /<enho:badiImplementation\s([^>]*?)(?:\/>|>([\s\S]*?)<\/enho:badiImplementation>)/g,
  )) {
    const tree = (match[2] ?? '').match(/<enho:filterTree[\s>][\s\S]*<\/enho:filterTree>|<enho:filterTree\/>/)?.[0];
    if (tree) trees.set(rawAttr(match[1] ?? '', 'enho:name').toUpperCase(), tree);
  }
  // Attribute values come from the parser, already decoded, so escapeXmlAttr does not encode them twice.
  const specific = asRecord(asRecord(doc.objectData)?.contentSpecific) ?? {};
  const result = new Map<string, PreservedImplementation>();
  for (const node of getNestedArray(
    asRecord(specific.badiTechnology) ?? {},
    'badiImplementations',
    'badiImplementation',
  )) {
    const name = text(node['@_name']).toUpperCase();
    if (!name) continue;
    result.set(name, {
      example: text(node['@_example']),
      customizingLock: String(node['@_customizingLock'] ?? ''),
      filterTreeXml: trees.get(name) ?? '',
    });
  }
  return result;
}

/** The ENHS/XSB spot from `<enho:contentCommon><enho:usages>`, or '' when the document names none. */
function usageSpot(doc: Record<string, unknown>): string {
  const common = asRecord(asRecord(doc.objectData)?.contentCommon) ?? {};
  for (const ref of getNestedArray(common, 'usages', 'referencedObject')) {
    // The parser yields objectReference as an array; mainObjectReference as a single node.
    for (const target of [...toRecordArray(ref.objectReference), ...toRecordArray(ref.mainObjectReference)]) {
      if (text(target['@_type']) === 'ENHS/XSB') return text(target['@_name']).toUpperCase();
    }
  }
  return '';
}

/** Read an XHB implementation. Omitting `version` returns SAP's developer view (a pending inactive edit). */
export async function getBadiEnhancementImplementation(
  http: AdtHttpClient,
  safety: SafetyConfig,
  name: string,
): Promise<StoredBadiImplementation> {
  checkOperation(safety, OperationType.Read, 'GetEnhancementImplementation');
  const resp = await http.get(`${ENHO_XHB_COLLECTION}/${encodeURIComponent(name)}`, { Accept: ENHO_XHB_CONTENT_TYPE });
  const doc = parseXml(resp.body);
  const info: StoredBadiImplementation = withFilterConditions(doc, parseEnhancementImplementation(resp.body));
  const spot = usageSpot(doc);
  if (spot) info.enhancementSpot = spot;
  info.preserved = preservedImplementations(resp.body, doc);
  return info;
}

/** Keys SAPRead emits that are not writable — accepted (and ignored) so read output round-trips. */
const READ_ONLY_KEYS = ['name', 'description', 'package', 'technology', 'switchSupported'];
const WRITABLE_KEYS = ['enhancementSpot', 'badiImplementations'];
const ENTRY_KEYS = [
  'name',
  'badiDefinition',
  'implementingClass',
  'enhancementSpot',
  'shortText',
  'active',
  'default',
  'filter',
];

function invalid(message: string): Error {
  return new Error(`Invalid ENHO source: ${message}`);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string {
  return value === undefined || value === null ? '' : String(value).trim();
}

function rejectUnknownKeys(rec: Record<string, unknown>, allowed: string[], where: string): void {
  const unknown = Object.keys(rec).filter((key) => !allowed.includes(key));
  if (unknown.length) throw invalid(`${where}: unknown key(s) ${unknown.map((key) => `"${key}"`).join(', ')}.`);
}

function validateName(value: unknown, where: string): string {
  const name = text(value).toUpperCase();
  if (!name) throw invalid(`${where} is required.`);
  if (!ABAP_NAME_RE.test(name) || name.length > 30)
    throw invalid(`${where} "${text(value)}" is not a valid ABAP name.`);
  return name;
}

function optionalBoolean(value: unknown, where: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 'false') return value === 'true';
  throw invalid(`${where} must be true or false.`);
}

/**
 * Parse and validate the JSON definition from SAPWrite "source". Unknown keys are rejected (a typo
 * such as "implementingclass" would otherwise silently keep the stored value); SAPRead's read-only
 * keys are ignored so its output can be edited and written back unchanged.
 */
export function parseBadiImplementationDefinition(source: string): BadiImplementationDefinition {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch (err) {
    throw invalid(`expected a JSON object (${err instanceof Error ? err.message : String(err)}).`);
  }
  const rec = asRecord(raw);
  if (!rec) throw invalid('expected a JSON object.');
  rejectUnknownKeys(rec, [...WRITABLE_KEYS, ...READ_ONLY_KEYS], 'definition');
  if (rec.technology !== undefined && !['', 'BADI_IMPL'].includes(text(rec.technology))) {
    throw invalid(`only BAdI implementations (technology "BADI_IMPL") are writable, got "${text(rec.technology)}".`);
  }
  // One enhancement implementation implements exactly one spot. SAPRead repeats it per entry.
  const spots = new Set<string>();
  if (rec.enhancementSpot !== undefined) spots.add(validateName(rec.enhancementSpot, 'enhancementSpot'));
  const def: BadiImplementationDefinition = {};
  if (rec.badiImplementations !== undefined) {
    if (!Array.isArray(rec.badiImplementations)) throw invalid('badiImplementations must be an array.');
    const seen = new Set<string>();
    def.badiImplementations = rec.badiImplementations.map((entry, i) => {
      const where = `badiImplementations[${i}]`;
      const erec = asRecord(entry);
      if (!erec) throw invalid(`${where} must be an object.`);
      rejectUnknownKeys(erec, ENTRY_KEYS, where);
      const name = validateName(erec.name, `${where}.name`);
      if (seen.has(name)) throw invalid(`${where}.name "${name}" is listed twice.`);
      seen.add(name);
      if (erec.enhancementSpot !== undefined && text(erec.enhancementSpot) !== '') {
        spots.add(validateName(erec.enhancementSpot, `${where}.enhancementSpot`));
      }
      const parsed: BadiImplementationEntry = {
        name,
        badiDefinition: validateName(erec.badiDefinition, `${where}.badiDefinition`),
        implementingClass: validateName(erec.implementingClass, `${where}.implementingClass`),
      };
      if (erec.shortText !== undefined && erec.shortText !== null) {
        if (typeof erec.shortText !== 'string') throw invalid(`${where}.shortText must be a text.`);
        parsed.shortText = erec.shortText;
      }
      const active = optionalBoolean(erec.active, `${where}.active`);
      if (active !== undefined) parsed.active = active;
      const isDefault = optionalBoolean(erec.default, `${where}.default`);
      if (isDefault !== undefined) parsed.default = isDefault;
      if (erec.filter !== undefined && erec.filter !== null) {
        if (typeof erec.filter !== 'string') throw invalid(`${where}.filter must be a text such as "COUNTRY = 'DE'".`);
        // Check the syntax now; the BAdI's declared filter names are checked against the spot later.
        parsed.filter = erec.filter.trim() === '' ? '' : normalizeFilterCondition(erec.filter);
      }
      return parsed;
    });
  }
  if (spots.size > 1) {
    throw invalid(`an enhancement implementation belongs to one enhancement spot, got ${[...spots].join(', ')}.`);
  }
  if (spots.size === 1) def.enhancementSpot = [...spots][0];
  return def;
}

/**
 * Overlay a definition on the stored implementation for a full-document PUT. A supplied
 * badiImplementations list replaces the stored one (entries left out are removed); within an entry
 * that already exists, omitted shortText/active/default keep their stored value, so changing one
 * flag cannot silently reset the others. The spot cannot change.
 *
 * SAP stores only what the PUT sends (live 816: `example`, `customizingLock` and filter trees were reset
 * by a rebuilt document), so stored content outside the JSON model is carried over per entry. An omitted
 * or unchanged `filter` keeps SAP's stored filter tree verbatim; a changed one is rebuilt by
 * resolveBadiFilters; `filter: ""` removes it.
 */
export function mergeBadiImplementationDefinition(
  existing: StoredBadiImplementation,
  def: BadiImplementationDefinition,
): BadiImplementationDefinition {
  // Rewriting another technology through the BAdI document would replace its content.
  if (existing.technology && existing.technology !== 'BADI_IMPL') {
    throw invalid(`${existing.name} is a ${existing.technology} enhancement; only BAdI implementations are writable.`);
  }
  const existingSpot =
    existing.enhancementSpot ||
    (existing.badiImplementations.find((impl) => impl.enhancementSpot)?.enhancementSpot ?? '');
  if (def.enhancementSpot && existingSpot && def.enhancementSpot !== existingSpot.toUpperCase()) {
    throw invalid(
      `the enhancement spot cannot change (stored: ${existingSpot}, given: ${def.enhancementSpot}). ` +
        'Create a new enhancement implementation for the other spot.',
    );
  }
  const stored = new Map(existing.badiImplementations.map((impl) => [impl.name.toUpperCase(), impl]));
  const entries = def.badiImplementations ?? existing.badiImplementations;
  return {
    enhancementSpot: def.enhancementSpot ?? (existingSpot.toUpperCase() || undefined),
    badiImplementations: entries.map((entry) => {
      const previous = stored.get(entry.name.toUpperCase());
      const preserved = existing.preserved?.get(entry.name.toUpperCase());
      // Decide on the stored tree itself, not on its text form: a tree ARC-1 cannot render (no `filter`
      // in SAPRead) must still survive an update that leaves `filter` out.
      const hasStoredTree = /<enho:filterToken[\s/>]/.test(preserved?.filterTreeXml ?? '');
      const storedFilter = hasStoredTree ? (previous?.filter ?? '') : '';
      const sameBadi = previous?.badiDefinition.toUpperCase() === entry.badiDefinition.toUpperCase();
      const keepStoredFilter =
        hasStoredTree && sameBadi && (entry.filter === undefined || (!!storedFilter && entry.filter === storedFilter));
      if (hasStoredTree && !sameBadi && entry.filter === undefined) {
        throw invalid(
          `${entry.name}: its filter (${storedFilter || 'stored filter'}) belongs to BAdI ${previous?.badiDefinition}. ` +
            'Give the filter for the new BAdI definition explicitly, or "filter": "" to remove it.',
        );
      }
      return {
        name: entry.name,
        badiDefinition: entry.badiDefinition,
        implementingClass: entry.implementingClass,
        shortText: entry.shortText ?? previous?.shortText,
        active: entry.active ?? previous?.active,
        default: entry.default ?? previous?.default,
        ...(keepStoredFilter ? { keepStoredFilter } : entry.filter ? { filter: entry.filter } : {}),
        ...(preserved ? { preserved } : {}),
      };
    }),
  };
}

export interface BadiImplementationXmlParams {
  name: string;
  description: string;
  package: string;
  definition: BadiImplementationDefinition;
  /** Master language, e.g. "EN" (normalized by the caller). */
  masterLanguage: string;
  /** Pre-built ` adtcore:responsible="…"` attribute, or ''. */
  responsibleAttr: string;
}

/**
 * The create POST body: the same document without BAdI implementations. Eclipse creates the empty
 * container first and saves the implementations with a locked PUT. Posting them with the create fails in
 * a transportable package with HTTP 500 "Screen output without connection to user" and leaves a TADIR
 * entry without content (live 816, 2026-10-07); in $TMP both ways work.
 */
export function badiContainerXml(xml: string): string {
  return xml.replace(
    /<enho:badiImplementations>[\s\S]*<\/enho:badiImplementations>/,
    '<enho:badiImplementations></enho:badiImplementations>',
  );
}

/** True when the document carries at least one BAdI implementation. */
export function hasBadiImplementations(xml: string): boolean {
  return /<enho:badiImplementation\s/.test(xml);
}

/**
 * Read the BAdI definitions of an enhancement spot (`GET /sap/bc/adt/enhancements/enhsxsb/{spot}`):
 * BAdI name → its declared filters (type and DDIC check) from `<enhs:badiDefinition><enhs:filters>`.
 */
export async function getEnhancementSpotBadis(
  http: AdtHttpClient,
  safety: SafetyConfig,
  spot: string,
): Promise<Map<string, Map<string, FilterDeclaration>>> {
  return (await readEnhancementSpot(http, safety, spot)).badis;
}

async function readEnhancementSpot(
  http: AdtHttpClient,
  safety: SafetyConfig,
  spot: string,
): Promise<{ internal: boolean; badis: Map<string, Map<string, FilterDeclaration>> }> {
  checkOperation(safety, OperationType.Read, 'GetEnhancementSpot');
  const resp = await http.get(`/sap/bc/adt/enhancements/enhsxsb/${encodeURIComponent(spot.toLowerCase())}`, {
    Accept: ENHS_XSB_CONTENT_TYPE,
  });
  const result = new Map<string, Map<string, FilterDeclaration>>();
  // A regex, not the parser: each filter's `<enhs:filterCheck>` is copied into the implementation as SAP wrote it.
  for (const badi of resp.body.matchAll(/<enhs:badiDefinition\s([^>]*?)(?:\/>|>([\s\S]*?)<\/enhs:badiDefinition>)/g)) {
    const name = rawAttr(badi[1], 'enhs:name').toUpperCase();
    if (!name) continue;
    const body = badi[2] ?? '';
    const filters = new Map<string, FilterDeclaration>();
    // `<enhs:filter\s` does not match the `<enhs:filters>` wrapper or `<enhs:filterCheck>`.
    for (const filter of body.matchAll(/<enhs:filter\s([^>]*?)(?:\/>|>([\s\S]*?)<\/enhs:filter>)/g)) {
      const filterName = rawAttr(filter[1], 'enhs:filterName').toUpperCase();
      if (!filterName) continue;
      const check = (filter[2] ?? '').match(
        /<enhs:filterCheck[\s>][\s\S]*?<\/enhs:filterCheck>|<enhs:filterCheck[^>]*\/>/,
      )?.[0];
      filters.set(filterName, {
        type: rawAttr(filter[1], 'enhs:filterType'),
        checkXml: check ? check.replace(/<(\/?)enhs:filterCheck/g, '<$1enho:filterCheck') : '',
      });
    }
    result.set(name, filters);
  }
  // `<enhs:contentCommon enhs:internal="true">`: SAP refuses implementations in the customer namespace.
  const common = resp.body.match(/<enhs:contentCommon\s([^>]*)>/)?.[1] ?? '';
  return { internal: rawAttr(common, 'enhs:internal') === 'true', badis: result };
}

/**
 * Check every BAdI implementation against the spot and build the filter trees that are new or changed.
 * The spot read is best-effort for the check alone (SAP repeats it at activation), but required when a
 * filter has to be built, because its type and DDIC check come from the BAdI definition.
 *
 * `createName` (create only): a Z/Y implementation of an SAP-internal spot is refused here, because SAP
 * refuses the create POST with HTTP 400 but still leaves a TADIR entry that ADT can neither read nor
 * delete (live 2026-10-08).
 */
export async function resolveBadiFilters(
  http: AdtHttpClient,
  safety: SafetyConfig,
  definition: BadiImplementationDefinition,
  createName?: string,
): Promise<BadiImplementationDefinition> {
  const spot = definition.enhancementSpot;
  const entries = definition.badiImplementations ?? [];
  const needTree = entries.filter((entry) => entry.filter && !entry.keepStoredFilter);
  if (!spot || !entries.length) return definition;
  let badis = new Map<string, Map<string, FilterDeclaration>>();
  let internal = false;
  try {
    ({ badis, internal } = await readEnhancementSpot(http, safety, spot));
  } catch (err) {
    if (err instanceof AdtApiError && err.statusCode === 404) throw invalid(`enhancement spot ${spot} does not exist.`);
    if (needTree.length) throw err;
  }
  if (internal && /^[ZY]/i.test(createName ?? '')) {
    throw invalid(
      `enhancement spot ${spot} is SAP-internal; SAP allows no implementation of it in the customer namespace.`,
    );
  }
  if (!badis.size && needTree.length) {
    throw invalid(`could not read the BAdI filter declarations of enhancement spot ${spot}.`);
  }
  if (badis.size) {
    for (const entry of entries) {
      if (!badis.has(entry.badiDefinition)) {
        throw invalid(
          `BAdI ${entry.badiDefinition} is not defined in enhancement spot ${spot} ` +
            `(defined: ${[...badis.keys()].join(', ')}).`,
        );
      }
    }
  }
  return {
    ...definition,
    badiImplementations: entries.map((entry) => {
      if (!entry.filter || entry.keepStoredFilter) return entry;
      const filters = badis.get(entry.badiDefinition) ?? new Map<string, FilterDeclaration>();
      return {
        ...entry,
        filterTreeXml: buildFilterTreeXml(
          parseFilterCondition(entry.filter),
          entry.name,
          filters,
          entry.badiDefinition,
        ),
      };
    }),
  };
}

function lowerUriName(name: string): string {
  return encodeURIComponent(name.toLowerCase());
}

/**
 * Build the create/update body. Element order and references follow SAP's own GET serialization.
 * New entries default to active=true and default=false, the Eclipse defaults.
 */
export function buildBadiImplementationXml(params: BadiImplementationXmlParams): string {
  const { definition } = params;
  const spot = definition.enhancementSpot;
  if (!spot) {
    throw invalid(
      'enhancementSpot is required, e.g. {"enhancementSpot":"ES_MY_SPOT","badiImplementations":[{"name":"ZMY_IMPL",' +
        '"badiDefinition":"BADI_MY","implementingClass":"ZCL_MY_IMPL"}]}.',
    );
  }
  const spotRef = `adtcore:uri="/sap/bc/adt/enhancements/enhsxsb/${lowerUriName(spot)}" adtcore:type="ENHS/XSB" adtcore:name="${escapeXmlAttr(spot)}"`;
  const implementations = (definition.badiImplementations ?? [])
    .map((impl) => {
      const kept = impl.preserved;
      const filterTree = impl.filterTreeXml ?? (impl.keepStoredFilter ? kept?.filterTreeXml : '') ?? '';
      // Guard: a new filter must have been resolved against the spot (resolveBadiFilters) before building.
      if (impl.filter && !filterTree) throw invalid(`${impl.name}: the filter was not resolved against the spot.`);
      // Stored values of attributes outside the JSON model; omitted on create, where SAP sets its defaults.
      const example = kept?.example === 'true' ? 'true' : 'false';
      const lock = kept ? ` enho:customizingLock="${escapeXmlAttr(kept.customizingLock)}"` : '';
      return (
        `<enho:badiImplementation enho:name="${escapeXmlAttr(impl.name)}" enho:shortText="${escapeXmlAttr(impl.shortText ?? '')}" enho:example="${example}" enho:default="${impl.default === true}" enho:active="${impl.active !== false}"${lock}>` +
        `<enho:enhancementSpot ${spotRef}/>` +
        `<enho:badiDefinition adtcore:uri="/sap/bc/adt/vit/wb/object_type/enhsxb/object_name/${encodeURIComponent(spot)}" adtcore:type="ENHS/XB" adtcore:name="${escapeXmlAttr(impl.badiDefinition)}"/>` +
        `<enho:implementingClass adtcore:uri="/sap/bc/adt/oo/classes/${lowerUriName(impl.implementingClass)}" adtcore:type="CLAS/OC" adtcore:name="${escapeXmlAttr(impl.implementingClass)}"/>` +
        // SAP's stored tree re-sent verbatim, or the one built from `filter`; an update must not drop it.
        filterTree +
        '</enho:badiImplementation>'
      );
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<enho:objectData xmlns:enho="http://www.sap.com/adt/enhancements/enho" xmlns:adtcore="http://www.sap.com/adt/core" xmlns:enhcore="http://www.sap.com/abapsource/enhancementscore" adtcore:type="ENHO/XHB" adtcore:name="${escapeXmlAttr(params.name)}" adtcore:description="${escapeXmlAttr(params.description)}" adtcore:masterLanguage="${escapeXmlAttr(params.masterLanguage)}"${params.responsibleAttr}>
  <adtcore:packageRef adtcore:name="${escapeXmlAttr(params.package)}"/>
  <enho:contentCommon enho:toolType="BADI_IMPL"><enho:usages><enhcore:referencedObject enhcore:program_id="R3TR" enhcore:element_usage="EXTO"><enhcore:objectReference ${spotRef}/><enhcore:mainObjectReference ${spotRef}/></enhcore:referencedObject></enho:usages></enho:contentCommon>
  <enho:contentSpecific><enho:badiTechnology><enho:badiImplementations>${implementations}</enho:badiImplementations></enho:badiTechnology></enho:contentSpecific>
</enho:objectData>`;
}
