/** Native active-only search-help interface metadata; no source or execution fallback. */
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { getCurrentContext } from '../server/context.js';
import { DataResponseBudget } from './data-result-context.js';
import { AdtError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import type { RequestDeadlineOptions } from './http-deadline.js';
import { RequestAttemptBudget } from './request-attempt-budget.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import { isSearchHelpName } from './search-help-name.js';

export const SEARCH_HELP_COLLECTION = '/sap/bc/adt/ddic/elementinfo';
const MIME = 'application/vnd.sap.adt.elementinfo+xml';
const MAX_BYTES = 2 * 1024 * 1024;
const MISSING = [
  'kind',
  'selectionMethod',
  'selectionMethodType',
  'textTable',
  'searchHelpExit',
  'parameterPositionsAndDefaults',
  'collectiveInclusions',
  'parameterAssignments',
  'appendSearchHelps',
  'inactiveVersion',
] as const;
export interface SearchHelpParameter {
  name: string;
  dataElement: string | null;
  dataType: string | null;
  length: string | null;
  import: boolean | null;
  export: boolean | null;
}
export interface SearchHelpMetadata {
  availability: 'available';
  type: 'SHLP';
  name: string;
  nativeType: 'SHLP/DH';
  completeness: 'partial';
  representation: 'ddic_element_info';
  sourceVersion: 'active';
  description: string | null;
  package: string | null;
  language: { requested: string | null; effective: null };
  parameters: SearchHelpParameter[];
  missing: readonly string[];
}
export interface SearchHelpUnavailable {
  availability: 'not_available';
  type: 'SHLP';
  name: string;
  reason: string;
}
export type SearchHelpResult = SearchHelpMetadata | SearchHelpUnavailable;

function canonicalName(value: unknown): string {
  if (!isSearchHelpName(value))
    throw new AdtError('Invalid SHLP name: use a Dictionary name of at most 30 characters.');
  return value.toUpperCase();
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AdtError('Invalid SHLP metadata object.');
  return value as Record<string, unknown>;
}
const array = (value: unknown): unknown[] => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
const optionalText = (value: unknown): string | null => (typeof value === 'string' && value.length ? value : null);
const PARAMETER_PROPERTIES = new Set([
  'ddicDataElement',
  'ddicDataType',
  'ddicLength',
  'ddicSearchHelpInput',
  'ddicSearchHelpOutput',
]);

export function parseSearchHelpMetadata(
  body: string,
  requestedName: string,
  language: string | null,
): SearchHelpResult {
  const name = canonicalName(requestedName);
  if (Buffer.byteLength(body) > MAX_BYTES || /<!DOCTYPE|<!ENTITY/i.test(body) || XMLValidator.validate(body) !== true) {
    throw new AdtError('Invalid or oversized SHLP metadata XML.');
  }
  const document = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false }).parse(body);
  const root = record(document.elementInfo);
  const children = array(root.elementInfo).map(record);
  if (!root['@_name'] && !root['@_type'] && !children.length) {
    return {
      availability: 'not_available',
      type: 'SHLP',
      name,
      reason:
        'SAP returned no named SHLP metadata. Object absence and authorization/visibility cannot be distinguished.',
    };
  }
  if (root['@_type'] !== 'SHLP/DH' || canonicalName(root['@_name']) !== name) {
    throw new AdtError('SHLP metadata identity does not match the requested name and type.');
  }
  const seen = new Set<string>();
  const parameters = children
    .filter((n) => n['@_type'] === 'SHLP/DHF')
    .map((n) => {
      const parameterName = canonicalName(n['@_name']);
      if (seen.has(parameterName)) throw new AdtError('Duplicate SHLP parameter identity.');
      seen.add(parameterName);
      const properties = n.properties === '' || n.properties === undefined ? {} : record(n.properties);
      const values = new Map<string, string>();
      for (const value of array(properties.entry)) {
        const entry = record(value);
        const key = entry['@_key'];
        if (typeof key !== 'string' || !PARAMETER_PROPERTIES.has(key)) continue;
        if (values.has(key)) throw new AdtError('Duplicate SHLP parameter property.');
        if (entry['#text'] !== undefined && typeof entry['#text'] !== 'string')
          throw new AdtError('Invalid SHLP property.');
        values.set(key, (entry['#text'] as string | undefined) ?? '');
      }
      const flag = (key: string): boolean | null => {
        const value = values.get(key);
        if (value === undefined) return null;
        if (value !== 'true' && value !== 'false') throw new AdtError('Invalid SHLP import/export flag.');
        return value === 'true';
      };
      return {
        name: parameterName,
        dataElement: optionalText(values.get('ddicDataElement'))?.toUpperCase() ?? null,
        dataType: optionalText(values.get('ddicDataType'))?.toUpperCase() ?? null,
        length: optionalText(values.get('ddicLength')),
        import: flag('ddicSearchHelpInput'),
        export: flag('ddicSearchHelpOutput'),
      };
    });
  const description = array(root.documentation)
    .map(record)
    .find((d) => d['@_rel'] === 'shorttext');
  return {
    availability: 'available',
    type: 'SHLP',
    name,
    nativeType: 'SHLP/DH',
    completeness: 'partial',
    representation: 'ddic_element_info',
    sourceVersion: 'active',
    description: optionalText(description?.['#text']),
    package: optionalText(children.find((n) => n['@_type'] === 'DEVC/K')?.['@_name']),
    language: { requested: language, effective: null },
    parameters,
    missing: MISSING,
  };
}

export async function readSearchHelpMetadata(
  http: AdtHttpClient,
  safety: SafetyConfig,
  name: string,
  options: RequestDeadlineOptions = {},
): Promise<SearchHelpResult> {
  checkOperation(safety, OperationType.Read, 'ReadSearchHelpMetadata');
  const canonical = canonicalName(name);
  if (http.hasDiscoveryCollection(SEARCH_HELP_COLLECTION) === false) {
    throw new AdtError('SHLP metadata is unavailable: SAP does not advertise the Element Info collection.');
  }
  return parseSearchHelpMetadata(
    (
      await http.get(
        `${SEARCH_HELP_COLLECTION}?path=${encodeURIComponent(canonical)}&type=SHLP`,
        { Accept: MIME },
        {
          signal: options.signal ?? getCurrentContext()?.signal,
          deadline: Math.min(Date.now() + 15_000, options.deadline ?? Infinity),
          responseBudget: new DataResponseBudget(MAX_BYTES, 'search-help-metadata'),
          attemptBudget: new RequestAttemptBudget(4),
          retryTransientErrors: false,
        },
      )
    ).body,
    canonical,
    http.language ?? null,
  );
}
