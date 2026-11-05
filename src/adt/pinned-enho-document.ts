import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import type { AdtClient } from './client.js';
import {
  type BadiImplementationDefinition,
  buildBadiImplementationXml,
  mergeBadiImplementationDefinition,
  parseStoredBadiImplementation,
  resolveBadiFilters,
} from './enhancement-impl.js';
import { AdtSafetyError } from './errors.js';
import { nativeXmlRoot } from './native-xml-evidence.js';
import {
  canonicalDocumentUri,
  DOCUMENT_CORE,
  documentStableValue,
  ENHS_NS,
  ENHO_NS as enho,
  type PinnedDocumentSelection,
  parsePinnedDocument,
} from './pinned-document-owner.js';
import { escapeXmlAttr } from './xml-parser.js';

const options = {
  preserveOrder: true,
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  processEntities: false,
  commentPropName: '#comment',
};

type Node = Record<string, unknown>;

function one(nodes: Node[], key: string) {
  const found = nodes.filter((node) => Object.hasOwn(node, key));
  if (found.length !== 1 || !Array.isArray(found[0]![key]))
    throw new AdtSafetyError(
      `The native BAdI document lacks one ${key} node. Alternate lexical contracts remain unsupported.`,
    );
  return found[0]!;
}

const children = (node: Node, key: string) => node[key] as Node[];

const attrs = (node: Node) => (node[':@'] ??= {}) as Record<string, string>;

function implementationList(nodes: Node[]): Node[] {
  return children(
    one(
      children(
        one(children(one(nodes, 'enho:objectData'), 'enho:objectData'), 'enho:contentSpecific'),
        'enho:contentSpecific',
      ),
      'enho:badiTechnology',
    ),
    'enho:badiTechnology',
  );
}

function entryList(nodes: Node[], createMissing = false) {
  const technology = implementationList(nodes);
  // The namespace/structure reader already verified this exact, present technology slot.
  if (createMissing && !technology.some((node) => Object.hasOwn(node, 'enho:badiImplementations')))
    technology.push({ 'enho:badiImplementations': [] });
  return children(one(technology, 'enho:badiImplementations'), 'enho:badiImplementations');
}

function copyReference(target: Node, source: Node, key: string) {
  const fresh = one(children(source, 'enho:badiImplementation'), key);
  const old = one(children(target, 'enho:badiImplementation'), key);
  for (const name of ['name', 'type', 'uri']) {
    const value = attrs(fresh)[`@_adtcore:${name}`];
    if (value !== undefined) attrs(old)[`@_adtcore:${name}`] = value;
  }
}

export function validatePinnedSpot(xml: string, spot: string, creating = false): void {
  const root = nativeXmlRoot(xml, 'objectData', ENHS_NS, true);
  if (root.attribute('name', DOCUMENT_CORE) !== spot || root.attribute('type', DOCUMENT_CORE) !== 'ENHS/XSB')
    throw new AdtSafetyError('The native enhancement spot identity is unverified.');
  const internal = root.child('contentCommon', ENHS_NS)?.attribute('internal', ENHS_NS);
  if (creating && internal === 'true')
    throw new AdtSafetyError('SAP-internal enhancement spots cannot be implemented by this private create profile.');
  if (internal !== 'false' && internal !== 'true')
    throw new AdtSafetyError('The native enhancement spot internal flag is unknown.');
  // Canonical traversal validates namespaces and rejects collisions even in data the legacy parser does not model.
  root.canonicalValue({});
  const list = root
    .child('contentSpecific', ENHS_NS)
    ?.child('badiTechnology', ENHS_NS)
    ?.child('badiDefinitions', ENHS_NS);
  if (!list) throw new AdtSafetyError('The native spot lacks BAdI definitions.');
  const names = new Set<string>();
  const nativeFilters: string[] = [];
  for (const badi of list.children('badiDefinition', ENHS_NS)) {
    const name = badi.attribute('name', ENHS_NS);
    if (!name || names.has(name)) throw new AdtSafetyError('Ambiguous native BAdI definitions.');
    names.add(name);
    const filters = new Set<string>();
    for (const filter of badi.child('filters', ENHS_NS)?.children('filter', ENHS_NS) ?? []) {
      const name = filter.attribute('filterName', ENHS_NS);
      if (!name || filters.has(name) || !filter.attribute('filterType', ENHS_NS))
        throw new AdtSafetyError('Ambiguous native BAdI filter declaration.');
      filter.child('filterCheck', ENHS_NS);
      filters.add(name);
      nativeFilters.push(`${name}:${filter.attribute('filterType', ENHS_NS)}`);
    }
  }
  const lexicalNames = [...xml.matchAll(/<enhs:badiDefinition\s((?:[^>"]|"[^"]*")*)(?:\/>|>)/g)].map(
    (match) => /(?:^|\s)enhs:name="([^"]*)"/.exec(match[1]!)?.[1],
  );
  const lexicalFilters = [...xml.matchAll(/<enhs:filter\s((?:[^>"]|"[^"]*")*)(?:\/>|>)/g)].map(
    (match) =>
      `${/(?:^|\s)enhs:filterName="([^"]*)"/.exec(match[1]!)?.[1]}:${/(?:^|\s)enhs:filterType="([^"]*)"/.exec(match[1]!)?.[1]}`,
  );
  if (
    JSON.stringify(lexicalNames) !== JSON.stringify([...names]) ||
    JSON.stringify(lexicalFilters) !== JSON.stringify(nativeFilters)
  )
    throw new AdtSafetyError('The native spot lexical declarations differ from the namespace-verified definitions.');
  // The shared legacy resolver intentionally expects this native lexical serialization.
  if (!xml.includes('<enhs:objectData') || !xml.includes(`xmlns:enhs="${ENHS_NS}"`))
    throw new AdtSafetyError('This enhancement spot lexical contract is not qualified.');
}

export async function resolvePinnedBadiDefinition(
  client: AdtClient,
  definition: BadiImplementationDefinition,
  createName?: string,
) {
  if (!definition.enhancementSpot)
    throw new AdtSafetyError('The BAdI definition must identify its native enhancement spot.');
  return resolveBadiFilters(client.http, client.safety, definition, createName, (xml) =>
    validatePinnedSpot(xml, definition.enhancementSpot!, createName !== undefined),
  );
}

export async function patchPinnedEnhoDocument(
  client: AdtClient,
  xml: string,
  selected: PinnedDocumentSelection,
  definition: BadiImplementationDefinition,
  description?: string,
): Promise<string> {
  const evidence = parsePinnedDocument(xml, selected);
  const nativeEntries =
    evidence.root
      .child('contentSpecific', selected.namespace)
      ?.child('badiTechnology', selected.namespace)
      ?.child('badiImplementations', selected.namespace)
      ?.children('badiImplementation', selected.namespace) ?? [];
  for (const requested of definition.badiImplementations ?? []) {
    const existing = nativeEntries.find((entry) => entry.attribute('name', selected.namespace) === requested.name);
    if (
      existing?.child('filterTree', selected.namespace) &&
      existing.child('badiDefinition', selected.namespace)?.attribute('name', DOCUMENT_CORE) !==
        requested.badiDefinition &&
      requested.filter === undefined
    )
      throw new AdtSafetyError('Changing a BAdI with stored filters requires an explicit replacement or empty filter.');
  }
  const merged = await resolvePinnedBadiDefinition(
    client,
    mergeBadiImplementationDefinition(parseStoredBadiImplementation(xml), definition),
  );
  const masterLanguage = evidence.root.attribute('masterLanguage', DOCUMENT_CORE);
  if (!masterLanguage?.trim()) throw new AdtSafetyError('The stored BAdI master language is unknown.');
  const built = buildBadiImplementationXml({
    name: selected.name,
    package: evidence.packageName,
    description: description ?? evidence.root.attribute('description', DOCUMENT_CORE) ?? '',
    masterLanguage,
    responsibleAttr: '',
    definition: merged,
  });
  const stored = new XMLParser(options).parse(xml) as Node[];
  const fresh = new XMLParser(options).parse(built) as Node[];
  const root = one(stored, 'enho:objectData');
  const bindings = attrs(one(fresh, 'enho:objectData'));
  for (const [key, value] of Object.entries(bindings))
    if (key.startsWith('@_xmlns:')) {
      if (attrs(root)[key] !== undefined && attrs(root)[key] !== value)
        throw new AdtSafetyError('Native BAdI namespace binding conflicts with its shared builder.');
      attrs(root)[key] = value;
    }
  if (description !== undefined) attrs(root)['@_adtcore:description'] = escapeXmlAttr(description);
  if (definition.badiImplementations !== undefined) {
    const old = entryList(stored, true),
      generated = entryList(fresh);
    const selectedEntries = new Map(merged.badiImplementations!.map((entry) => [entry.name, entry]));
    const next = generated
      .filter((node) => Object.hasOwn(node, 'enho:badiImplementation'))
      .map((entry) => {
        const name = attrs(entry)['@_enho:name']!;
        const existing = old.find(
          (node) => Object.hasOwn(node, 'enho:badiImplementation') && attrs(node)['@_enho:name'] === name,
        );
        if (!existing) return entry;
        for (const field of ['shortText', 'active', 'default']) {
          const value = attrs(entry)[`@_enho:${field}`];
          if (value !== undefined) attrs(existing)[`@_enho:${field}`] = value;
        }
        copyReference(existing, entry, 'enho:badiDefinition');
        copyReference(existing, entry, 'enho:implementingClass');
        const requested = definition.badiImplementations!.find((candidate) => candidate.name === name)!;
        if (requested.filter !== undefined && !selectedEntries.get(name)?.keepStoredFilter) {
          const parts = children(existing, 'enho:badiImplementation');
          existing['enho:badiImplementation'] = parts.filter((part) => !Object.hasOwn(part, 'enho:filterTree'));
          const tree = children(entry, 'enho:badiImplementation').filter((part) =>
            Object.hasOwn(part, 'enho:filterTree'),
          );
          (existing['enho:badiImplementation'] as Node[]).push(...tree);
        }
        return existing;
      });
    // Preserve opaque siblings of the list. Only the caller's explicit replacement list removes entries.
    const container = one(implementationList(stored), 'enho:badiImplementations');
    let slot = 0;
    container['enho:badiImplementations'] = old.flatMap((node) =>
      Object.hasOwn(node, 'enho:badiImplementation') ? (slot < next.length ? [next[slot++]!] : []) : [node],
    );
    (container['enho:badiImplementations'] as Node[]).push(...next.slice(slot));
  }
  const body = new XMLBuilder(options).build(stored) as string;
  const after = parsePinnedDocument(body, selected);
  if (after.packageName !== evidence.packageName || after.refName !== evidence.refName)
    throw new AdtSafetyError('The BAdI patch changed native ownership.');
  return body;
}

type Fields = Array<[string, unknown]>;

const enhcore = 'http://www.sap.com/abapsource/enhancementscore';

const key = (kind: string, ns: string, name: string) => JSON.stringify([kind, ns, name]);

const element = (name: string, ns = enho) => key('element', ns, name);

const attribute = (name: string, ns: string) => key('attribute', ns, name);

const implementation = [
  element('contentSpecific'),
  element('badiTechnology'),
  element('badiImplementations'),
  element('badiImplementation'),
];

const usages = [element('contentCommon'), element('usages')];

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

const field = (fields: Fields, name: string, ns: string) => fields.find(([k]) => k === attribute(name, ns))?.[1];

function usageRemainder(entries: Fields[]): unknown[] {
  const seen = new Set<string>(),
    out: unknown[] = [];
  for (const fields of entries) {
    const ref = (name: string) => ((fields.find(([k]) => k === element(name, enhcore))?.[1] as Fields[]) ?? [])[0];
    const object = ref('objectReference');
    if (!object) throw new AdtSafetyError('Missing native BAdI usage reference.');
    const type = field(object, 'type', DOCUMENT_CORE),
      name = field(object, 'name', DOCUMENT_CORE),
      identity = JSON.stringify([type, name]);
    if (seen.has(identity)) throw new AdtSafetyError('Duplicate native BAdI usage.');
    seen.add(identity);
    if (
      field(fields, 'program_id', enhcore) !== 'R3TR' ||
      field(fields, 'element_usage', enhcore) !== (type === 'ENHS/XSB' ? 'EXTO' : 'USEO')
    )
      throw new AdtSafetyError('Unqualified native BAdI usage classification.');
    for (const flag of ['upgrade', 'automatic_transport']) {
      const v = field(fields, flag, enhcore);
      if (v !== undefined && v !== 'true' && v !== 'false')
        throw new AdtSafetyError('Unqualified native BAdI usage flag.');
    }
    const remainder: Fields = [];
    for (const [k, v] of fields) {
      if (['program_id', 'element_usage', 'upgrade', 'automatic_transport'].some((n) => k === attribute(n, enhcore)))
        continue;
      if (['objectReference', 'mainObjectReference'].some((n) => k === element(n, enhcore))) {
        const rest = (v as Fields[]).map((child) =>
          child.filter(([a]) => !['name', 'type', 'uri'].some((n) => a === attribute(n, DOCUMENT_CORE))),
        );
        if (rest.some((child) => child.length)) remainder.push([k, rest]);
      } else remainder.push([k, v]);
    }
    // Only fully recognized derived slots disappear. Extensions remain attached to their exact reference.
    if (remainder.length) out.push([identity, remainder]);
  }
  return out.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function project(fields: Fields, deriveUsages: boolean, path: string[] = []): Fields {
  const result: Fields = [];
  for (const [k, v] of fields) {
    if (k === 'text') {
      result.push([k, v]);
      continue;
    }
    const [kind, ns, name] = JSON.parse(k) as string[];
    if (kind === 'attribute') {
      if (
        same(path, implementation) &&
        ns === enho &&
        (name === 'runtimeBehaviorShorttext' || (name === 'customizingLock' && v === ''))
      )
        continue;
      if (
        path.length === implementation.length + 1 &&
        same(path.slice(0, -1), implementation) &&
        ns === DOCUMENT_CORE &&
        name === 'uri'
      ) {
        if (path.at(-1) === element('badiDefinition')) {
          result.push([k, 'validated-BAdI-reference']);
          continue;
        }
        if (['enhancementSpot', 'implementingClass'].some((n) => path.at(-1) === element(n))) {
          result.push([k, canonicalDocumentUri(v as string)]);
          continue;
        }
      }
      result.push([k, v]);
      continue;
    }
    if (deriveUsages && same(path, usages) && k === element('referencedObject', enhcore)) {
      const rest = usageRemainder(v as Fields[]);
      if (rest.length) result.push([k, rest]);
      continue;
    }
    const children = (v as Fields[]).map((child) => project(child, deriveUsages, [...path, k]));
    // Only a completely empty list has the ST's omitted representation; opaque content is never removed.
    if (
      same(path, implementation.slice(0, 2)) &&
      k === element('badiImplementations') &&
      children.length === 1 &&
      children[0].every(([key, value]) => key === 'text' && typeof value === 'string' && !value.trim())
    )
      continue;
    result.push([k, children]);
  }
  return result;
}

function dependencies(xml: string, selected: PinnedDocumentSelection): string {
  const e = parsePinnedDocument(xml, selected);
  const list = e.root.child('contentSpecific', enho)!.child('badiTechnology', enho)!.child('badiImplementations', enho);
  const refs = new Set(
    (list?.children('badiImplementation', enho) ?? []).map((entry) =>
      JSON.stringify([
        entry.child('badiDefinition', enho)!.attribute('name', DOCUMENT_CORE),
        entry.child('implementingClass', enho)!.attribute('name', DOCUMENT_CORE),
      ]),
    ),
  );
  return JSON.stringify([...refs].sort());
}

/** Only changed implementation dependencies permit recomputed usages; an ordinary edit keeps the receipt exact. */
export function enhoSavedMatches(
  baseline: string,
  intended: string,
  saved: string,
  selected: PinnedDocumentSelection,
): boolean {
  if (selected.type !== 'ENHO') throw new AdtSafetyError('The native XHB comparison requires ENHO.');
  const original = parsePinnedDocument(baseline, selected),
    before = parsePinnedDocument(intended, selected),
    after = parsePinnedDocument(saved, selected);
  if (before.refName !== original.refName || before.refName !== after.refName || before.refType !== after.refType)
    return false;
  const deriveUsages = dependencies(baseline, selected) !== dependencies(intended, selected);
  return (
    JSON.stringify(project(JSON.parse(documentStableValue(intended, selected)) as Fields, deriveUsages)) ===
    JSON.stringify(project(JSON.parse(documentStableValue(saved, selected)) as Fields, deriveUsages))
  );
}
