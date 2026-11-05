/**
 * Comparable projection of full-document DDIC metadata. Builders replace the whole document, so a
 * pinned update must prove which stored values would change before sending it.
 */
import { createHash } from 'node:crypto';
import { AdtSafetyError } from './errors.js';
import type { NativeXmlElement } from './native-xml-evidence.js';
import { escapeXmlAttr } from './xml-parser.js';

export type MetadataFields = ReadonlyMap<string, string>;
export interface MetadataMatcher {
  test(path: string): boolean;
}
export type FieldMatcher = string | MetadataMatcher;

/** Select an exact native path segment, its repeated entries and descendants; never a prefix sibling. */
export function metadataSubtree(path: string): MetadataMatcher {
  return {
    test(candidate: string): boolean {
      if (!candidate.startsWith(path)) return false;
      const suffix = candidate.slice(path.length).replace(/^\[\d+\]/, '');
      return suffix === '' || '/@#'.includes(suffix[0]);
    },
  };
}

const core = 'http://www.sap.com/adt/core';
const atom = 'http://www.w3.org/2005/Atom';
const tableType = 'http://www.sap.com/dictionary/tabletype';
const lockObject = 'http://www.sap.com/adt/ddic/enqu';
// Stable aliases are namespace identities, not prefixes from SAP's document. Unknown namespaces
// remain expanded names; neither a prefix rename nor a same-local-name extension can collide.
const namespaces: Readonly<Record<string, string>> = {
  [core]: 'adtcore',
  'http://www.sap.com/dictionary/domain': 'doma',
  'http://www.sap.com/adt/dictionary/dataelements': 'dtel',
  [tableType]: 'ttyp',
  [lockObject]: 'enqu',
  'http://www.sap.com/adt/MessageClass': 'mc',
};
const expandedName = (namespace: string, local: string) =>
  Object.hasOwn(namespaces, namespace) ? `${namespaces[namespace]}:${local}` : JSON.stringify([namespace, local]);
// Server-assigned bookkeeping and generated read-only lists; everything else is stored state.
const volatileRoot = new Set([
  'changedAt',
  'changedBy',
  'createdAt',
  'createdBy',
  'version',
  'language',
  'descriptionTextLimit',
  'type',
]);
function collect(node: unknown, path: string, out: Map<string, string>): void {
  for (const [key, value] of node as [string, unknown][]) {
    if (key === 'text') {
      if (typeof value === 'string' && value !== '') out.set(path, value);
      continue;
    }
    const [kind, namespace, local] = JSON.parse(key) as [string, string, string];
    const name = expandedName(namespace, local);
    if (kind === 'attribute') {
      if (typeof value === 'string' && (value !== '' || !Object.hasOwn(namespaces, namespace)))
        out.set(`${path}@${name}`, value);
      continue;
    }
    (value as unknown[]).forEach((child, index) => {
      const childPath = `${path}/${name}${index ? `[${index}]` : ''}`;
      if (!Object.hasOwn(namespaces, namespace)) out.set(`${childPath}#present`, 'true');
      collect(child, childPath, out);
    });
  }
}

/** Known native empty scalar values are equivalent to absence; unknown namespace presence is retained. */
export function metadataFields(root: NativeXmlElement, rootNamespace: string): MetadataFields {
  const canonical = root.canonicalValue({
    omitAttribute: (name, namespace, depth) => namespace === core && depth === 0 && volatileRoot.has(name),
  });
  const out = new Map<string, string>();
  collect(canonical, '', out);
  const derivedSubtrees = [`/${expandedName(atom, 'link')}`];
  if (rootNamespace === tableType) derivedSubtrees.push('/ttyp:valueHelps');
  if (rootNamespace === lockObject) derivedSubtrees.push('/enqu:content/enqu:lockModules');
  const derivedMatchers = derivedSubtrees.map(metadataSubtree);
  for (const key of [...out.keys()]) {
    if (
      derivedMatchers.some((matcher) => matcher.test(key)) ||
      [
        '/adtcore:packageRef@adtcore:type',
        '/adtcore:packageRef@adtcore:description',
        '/adtcore:packageRef@adtcore:uri',
        '/adtcore:containerRef@adtcore:uri',
        '/doma:content/doma:valueInformation/doma:valueTableRef@adtcore:uri',
      ].includes(key)
    )
      out.delete(key);
  }
  return out;
}

export function metadataFieldsHash(fields: MetadataFields): string {
  const entries = [...fields].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}

// Only native dimensions/counts are numbers. Labels, descriptions, codes and fixed values stay text.
const numericFields = new Set([
  '/doma:content/doma:typeInformation/doma:length',
  '/doma:content/doma:typeInformation/doma:decimals',
  '/doma:content/doma:outputInformation/doma:length',
  '/dtel:dataElement/dtel:dataTypeLength',
  '/dtel:dataElement/dtel:dataTypeDecimals',
  ...['short', 'medium', 'long', 'heading'].flatMap((kind) => [
    `/dtel:dataElement/dtel:${kind}FieldLength`,
    `/dtel:dataElement/dtel:${kind}FieldMaxLength`,
  ]),
  '/ttyp:rowType/ttyp:builtInType/ttyp:length',
  '/ttyp:rowType/ttyp:builtInType/ttyp:decimals',
  '/ttyp:initialRowCount',
]);
function sameValue(path: string, left: string | undefined, right: string | undefined): boolean {
  if (left === right) return true;
  return (
    numericFields.has(path) &&
    !!left &&
    !!right &&
    /^\d+$/.test(left) &&
    /^\d+$/.test(right) &&
    left.replace(/^0+(?=\d)/, '') === right.replace(/^0+(?=\d)/, '')
  );
}

function matches(path: string, matcher: FieldMatcher): boolean {
  // A subtree selection admits its native fields and core references, never extension namespaces.
  // Their values still participate in hashes/comparison, even when a selected list is rebuilt.
  if (path.includes('["')) return false;
  const family = /^\/([a-z]+):/.exec(path)?.[1];
  if (family && [...path.matchAll(/[/@]([a-z]+):/g)].some((match) => match[1] !== family && match[1] !== 'adtcore'))
    return false;
  return typeof matcher === 'string' ? path === matcher : matcher.test(path);
}

/** Derivations depend on the captured definition mode, for both save and activation verification. */
export function derivedMetadataFields(type: string, definition: MetadataFields): FieldMatcher[] {
  const mode = (path: string, expected: string) => definition.get(path) === expected && !definition.has(`${path}[1]`);
  if (
    type === 'DTEL' &&
    mode('/dtel:dataElement/dtel:typeKind', 'domain') &&
    definition.get('/dtel:dataElement/dtel:typeName')?.trim()
  )
    return ['dataType', 'dataTypeLength', 'dataTypeDecimals'].map((field) => `/dtel:dataElement/dtel:${field}`);
  if (
    type === 'TTYP' &&
    mode('/ttyp:rowType/ttyp:typeKind', 'dictionaryType') &&
    definition.get('/ttyp:rowType/ttyp:typeName')?.trim()
  )
    return [/^\/ttyp:rowType\/ttyp:builtInType(?:\/|@|$)/];
  const lockParameters = metadataSubtree('/enqu:content/enqu:lockParameters');
  if (type === 'ENQU' && ![...definition.keys()].some((key) => lockParameters.test(key))) return [lockParameters];
  return [];
}

export function differingFields(stored: MetadataFields, target: MetadataFields): string[] {
  return [...new Set([...stored.keys(), ...target.keys()])]
    .filter((key) => !sameValue(key, stored.get(key), target.get(key)))
    .sort();
}

/** Refuse a rebuild that would reset a value the caller did not select, including unknown native fields. */
export function assertOnlyRequestedChanges(
  stored: MetadataFields,
  target: MetadataFields,
  requested: readonly FieldMatcher[],
): string[] {
  const changed = differingFields(stored, target);
  const unrequested = changed.filter((path) => !requested.some((matcher) => matches(path, matcher)));
  if (unrequested.length)
    throw new AdtSafetyError(
      `The stored metadata cannot be preserved: this update would also change ${unrequested.slice(0, 10).join(', ')}. No write was sent. Change this object in ADT or SE11.`,
    );
  return changed;
}

/**
 * Fields SAP derives during a save (for example domain-derived dimensions) are not read-back evidence.
 * Creation and activation may add native defaults; only an update can prove a removed stored value is gone.
 */
export function assertSavedFields(
  target: MetadataFields,
  saved: MetadataFields,
  derived: readonly FieldMatcher[],
  targetOnly = false,
): void {
  const mismatch = differingFields(target, saved)
    .filter((path) => !targetOnly || target.has(path))
    .filter((path) => !derived.some((matcher) => matches(path, matcher)));
  if (mismatch.length)
    throw new AdtSafetyError(
      `Save returned, but metadata read-back differs at ${mismatch.slice(0, 10).join(', ')}. Inspect before continuing.`,
    );
}

const preservedRootAttributes = ['masterLanguage', 'masterSystem', 'responsible', 'abapLanguageVersion'];

/** Builders emit create-time defaults; a replacement must carry the stored values, or none where SAP stores none. */
export function withStoredRootAttributes(body: string, stored: NativeXmlElement): string {
  const start = body.indexOf('<', body.startsWith('<?xml') ? body.indexOf('?>') : 0);
  const end = body.indexOf('>', start);
  if (start < 0 || end < 0) throw new AdtSafetyError('The generated metadata document is malformed.');
  const selfClosing = body[end - 1] === '/';
  let open = body.slice(start, selfClosing ? end - 1 : end);
  for (const name of preservedRootAttributes) {
    open = open.replace(new RegExp(`\\s+adtcore:${name}="[^"]*"`), '');
    const value = stored.attribute(name, core);
    if (value !== undefined) open += ` adtcore:${name}="${escapeXmlAttr(value)}"`;
  }
  return `${body.slice(0, start)}${open}${selfClosing ? '/' : ''}${body.slice(end)}`;
}
