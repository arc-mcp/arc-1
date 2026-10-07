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
import { withFilterConditions } from './enho-filter.js';
import type { AdtHttpClient } from './http.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import type { EnhancementImplementationInfo } from './types.js';
import { escapeXmlAttr, parseEnhancementImplementation, parseXml } from './xml-parser.js';

export const ENHO_XHB_CONTENT_TYPE = 'application/vnd.sap.adt.enh.enhoxhb.v4+xml';
export const ENHO_XHB_COLLECTION = '/sap/bc/adt/enhancements/enhoxhb';

export interface BadiImplementationEntry {
  name: string;
  badiDefinition: string;
  implementingClass: string;
  shortText?: string;
  active?: boolean;
  default?: boolean;
  /** SAPRead's read-only filter condition; it must match the stored one (filters cannot be written yet). */
  filter?: string;
  /** Stored content ARC-1 does not model, carried through an update unchanged (set by the merge only). */
  preserved?: PreservedImplementation;
}

/** Per-implementation content an update must not drop: SAP keeps only what the PUT sends (live 816). */
export interface PreservedImplementation {
  badiDefinition: string;
  example: string;
  customizingLock: string;
  filter: string;
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

/** Cut each `<enho:badiImplementation>` out of SAP's XML and keep what the JSON model does not carry. */
function preservedImplementations(
  xml: string,
  info: EnhancementImplementationInfo,
): Map<string, PreservedImplementation> {
  const result = new Map<string, PreservedImplementation>();
  const filters = new Map(info.badiImplementations.map((impl) => [impl.name.toUpperCase(), impl]));
  for (const match of xml.matchAll(
    /<enho:badiImplementation\s([^>]*?)(?:\/>|>([\s\S]*?)<\/enho:badiImplementation>)/g,
  )) {
    const attrs = match[1] ?? '';
    const attr = (key: string) => attrs.match(new RegExp(`enho:${key}="([^"]*)"`))?.[1] ?? '';
    const name = attr('name').toUpperCase();
    if (!name) continue;
    const parsed = filters.get(name);
    result.set(name, {
      badiDefinition: (parsed?.badiDefinition ?? '').toUpperCase(),
      example: attr('example'),
      customizingLock: attr('customizingLock'),
      filter: parsed?.filter ?? '',
      filterTreeXml:
        (match[2] ?? '').match(/<enho:filterTree[\s>][\s\S]*<\/enho:filterTree>|<enho:filterTree\/>/)?.[0] ?? '',
    });
  }
  return result;
}

/** The ENHS/XSB spot from `<enho:contentCommon><enho:usages>`, or '' when the document names none. */
function usageSpot(xml: string): string {
  const root = asRecord(parseXml(xml).objectData);
  const usages = asRecord(asRecord(root?.contentCommon)?.usages);
  const refs = usages?.referencedObject;
  const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined ? [] : [value]);
  for (const ref of list(refs)) {
    const rec = asRecord(ref);
    // The parser yields objectReference as an array; mainObjectReference as a single node.
    for (const target of [...list(rec?.objectReference), ...list(rec?.mainObjectReference)].map(asRecord)) {
      if (text(target?.['@_type']) === 'ENHS/XSB') return text(target?.['@_name']).toUpperCase();
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
  const info: StoredBadiImplementation = withFilterConditions(resp.body, parseEnhancementImplementation(resp.body));
  const spot = usageSpot(resp.body);
  if (spot) info.enhancementSpot = spot;
  info.preserved = preservedImplementations(resp.body, info);
  return info;
}

const NAME_RE = /^(?:\/[A-Z0-9_]+\/)?[A-Z0-9_]+$/;
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
  if (!NAME_RE.test(name) || name.length > 30) throw invalid(`${where} "${text(value)}" is not a valid ABAP name.`);
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
      if (erec.shortText !== undefined) parsed.shortText = String(erec.shortText);
      const active = optionalBoolean(erec.active, `${where}.active`);
      if (active !== undefined) parsed.active = active;
      const isDefault = optionalBoolean(erec.default, `${where}.default`);
      if (isDefault !== undefined) parsed.default = isDefault;
      if (erec.filter !== undefined && text(erec.filter) !== '') parsed.filter = text(erec.filter);
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
 * by a rebuilt document), so stored content outside the JSON model is carried over per entry. Filter
 * values are kept as stored and cannot be changed; a changed BAdI definition would invalidate them.
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
      const storedFilter = preserved?.filter ?? '';
      if (entry.filter !== undefined && normalizeFilter(entry.filter) !== normalizeFilter(storedFilter)) {
        throw invalid(
          `${entry.name}: filter values cannot be changed through ARC-1 yet ` +
            `(stored: ${storedFilter ? `"${storedFilter}"` : 'none'}). Change them in Eclipse ADT or SE19.`,
        );
      }
      if (preserved?.filterTreeXml && preserved.badiDefinition !== entry.badiDefinition.toUpperCase()) {
        throw invalid(
          `${entry.name}: its BAdI definition cannot change while it has filter values (${storedFilter}). ` +
            'Remove the entry and add a new implementation instead.',
        );
      }
      return {
        name: entry.name,
        badiDefinition: entry.badiDefinition,
        implementingClass: entry.implementingClass,
        shortText: entry.shortText ?? previous?.shortText,
        active: entry.active ?? previous?.active,
        default: entry.default ?? previous?.default,
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

function normalizeFilter(filter: string): string {
  return filter.replace(/\s+/g, ' ').trim();
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
      if (impl.filter && !kept?.filterTreeXml) {
        throw invalid(
          `${impl.name}: filter values cannot be written through ARC-1 yet. Create the implementation without ` +
            '"filter" and maintain the filter in Eclipse ADT or SE19.',
        );
      }
      // Stored values of attributes outside the JSON model; omitted on create, where SAP sets its defaults.
      const example = kept?.example === 'true' ? 'true' : 'false';
      const lock = kept ? ` enho:customizingLock="${escapeXmlAttr(kept.customizingLock)}"` : '';
      return (
        `<enho:badiImplementation enho:name="${escapeXmlAttr(impl.name)}" enho:shortText="${escapeXmlAttr(impl.shortText ?? '')}" enho:example="${example}" enho:default="${impl.default === true}" enho:active="${impl.active !== false}"${lock}>` +
        `<enho:enhancementSpot ${spotRef}/>` +
        `<enho:badiDefinition adtcore:uri="/sap/bc/adt/vit/wb/object_type/enhsxb/object_name/${encodeURIComponent(spot)}" adtcore:type="ENHS/XB" adtcore:name="${escapeXmlAttr(impl.badiDefinition)}"/>` +
        `<enho:implementingClass adtcore:uri="/sap/bc/adt/oo/classes/${lowerUriName(impl.implementingClass)}" adtcore:type="CLAS/OC" adtcore:name="${escapeXmlAttr(impl.implementingClass)}"/>` +
        // SAP's own filter tree, re-sent verbatim so an update does not delete the filter values.
        (kept?.filterTreeXml ?? '') +
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
