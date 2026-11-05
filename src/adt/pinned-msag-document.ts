/** Lossless private MSAG row edits. Native identity and message numbers, never array positions, own a row. */
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import { AdtSafetyError } from './errors.js';
import { type NativeXmlElement, nativeXmlCharacterRoot } from './native-xml-evidence.js';
import { assertOnlyRequestedChanges, assertSavedFields, metadataFields } from './pinned-metadata-projection.js';
import { escapeXmlAttr } from './xml-parser.js';

const mc = 'http://www.sap.com/adt/MessageClass',
  core = 'http://www.sap.com/adt/core',
  atom = 'http://www.w3.org/2005/Atom';
const options = {
  preserveOrder: true,
  // Keep unselected XML references verbatim; only selected attribute values are escaped below.
  processEntities: false,
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  commentPropName: '#comment',
  cdataPropName: '#cdata',
};
const parser = new XMLParser(options),
  builder = new XMLBuilder(options);
type Node = Record<string, unknown>;
type Row = { native: NativeXmlElement; node: Node };
const local = (name: string) => name.slice(name.lastIndexOf(':') + 1);
const rowPath = /^\/mc:messages(?:\[\d+\])?(?:[/@#]|$)/;
function refuse(reason: string): never {
  throw new AdtSafetyError(`Message class preservation refused: ${reason}.`);
}
function attributes(node: Node): Record<string, string> {
  return (node[':@'] ?? {}) as Record<string, string>;
}
function setAttribute(node: Node, name: string, value: string): void {
  // NativeXmlElement has already rejected absent, ambiguous or foreign same-local-name attributes.
  const attrs = attributes(node),
    keys = Object.keys(attrs).filter((k) => local(k) === name);
  if (keys.length !== 1) refuse('the selected native attribute is absent or ambiguous');
  attrs[keys[0]] = escapeXmlAttr(value);
}
function outsideRows(root: NativeXmlElement) {
  return new Map([...metadataFields(root, mc)].filter(([key]) => !rowPath.test(key)));
}
function document(xml: string) {
  const root = nativeXmlCharacterRoot(xml, 'messageClass', mc);
  root.canonicalValue({});
  const name = root.attribute('name', core);
  if (!name || name !== name.trim()) refuse('the native owner is missing');
  const language = root.attribute('language', core),
    masterLanguage = root.attribute('masterLanguage', core);
  if (!language || language !== language.trim() || language !== masterLanguage)
    refuse('native language identity is not exact');
  const nativeRows = root.children('messages', mc);
  if (nativeRows.length > 1_000) refuse('the message row bound was exceeded');
  const nodes = parser.parse(xml) as Node[];
  root.canonicalValue({
    omitChild: (name, ns) => {
      if (name === 'deletedmessages' && ns === mc) refuse('stored/requested deletion instructions are unsupported');
      return false;
    },
  });
  const element = nodes.find((n) =>
    Object.keys(n).some((k) => !k.startsWith('?') && k !== ':@' && local(k) === 'messageClass'),
  );
  if (!element) refuse('the native root is missing');
  const key = Object.keys(element).find((k) => k !== ':@')!;
  const children = element[key] as Node[];
  const lexicalRows = children.filter((n) => Object.keys(n).some((k) => k !== ':@' && local(k) === 'messages'));
  if (lexicalRows.length !== nativeRows.length) refuse('the native row structure is ambiguous');
  const rows = new Map<string, Row>();
  nativeRows.forEach((native, i) => {
    const number = native.attribute('msgno', mc);
    if (!number || !/^\d{3}$/.test(number) || rows.has(number))
      refuse('message numbers must be unique three-digit identities');
    if (native.attribute('msgtext', mc) === undefined) refuse('a native message text is missing');
    validateRow(native, name, number);
    rows.set(number, { native, node: lexicalRows[i] });
  });
  return { root, name, nodes, element, key, children, rows };
}
function validateRow(row: NativeXmlElement, owner: string, number: string): void {
  const expanded = new Map(row.canonicalValue({}) as Array<[string, unknown]>);
  for (const name of ['corrno', 'lockhandle']) {
    const value = expanded.get(JSON.stringify(['attribute', mc, name]));
    if (value !== undefined && value !== '') refuse('stored operational row instructions are unsupported');
  }
  if (row.attribute('name', core) || row.attribute('uri', core) !== undefined)
    refuse('a row contains an unsupported native object identity');
  row.canonicalValue({
    omitChild: (name, ns, _child, depth) => {
      if (ns === atom && name === 'link' && depth !== 1)
        refuse('a native row link has an unsupported structural owner');
      return false;
    },
  });
  const date = row.attribute('lastmodified', mc),
    user = row.attribute('lastchangedby', mc);
  if (
    date !== undefined &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date)
  )
    refuse('native row modification date is malformed');
  if (
    user !== undefined &&
    (!user ||
      user !== user.trim() ||
      user.length > 128 ||
      [...user].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127))
  )
    refuse('native row modifier is malformed');
  const rels = new Set<string>();
  if (
    expanded.get(JSON.stringify(['attribute', mc, 'selfexplainatory'])) === 'true' &&
    expanded.get(JSON.stringify(['attribute', mc, 'documented'])) === 'true'
  )
    refuse('stored flags would instruct native long-text deletion');
  for (const link of row.children('link', atom)) {
    const rel = link.attribute('rel', ''),
      href = link.attribute('href', '');
    const expected =
      rel === 'http://www.sap.com/adt/relations/longtext'
        ? `/sap/bc/adt/vit/docu/object_type/NA/object_name/${owner}${number}`
        : rel === 'http://www.sap.com/adt/relations/messageclasses/messages'
          ? `/sap/bc/adt/messageclass/${owner.toLowerCase()}/messages/${number}`
          : undefined;
    if (!expected || href !== expected || rels.has(rel!))
      refuse('a native row link is foreign, unsupported or ambiguous');
    rels.add(rel!);
  }
}
function rowValue(row: NativeXmlElement, added: boolean): string {
  return JSON.stringify(
    row.canonicalValue({
      // T100 row bookkeeping may be assigned/updated by SAP; it is still preserved in the submitted XML.
      omitAttribute: (name, ns, depth) =>
        depth === 0 &&
        ((ns === mc && ['lastchangedby', 'lastmodified'].includes(name)) ||
          (added && ns === core && name === 'name' && row.attribute('name', core) === '')),
      omitChild: (name, ns, child, depth) => {
        if (!(added && depth === 1 && ns === atom && name === 'link')) return false;
        // Added rows may acquire only the captured two-attribute native links, already checked above.
        const exact = JSON.stringify(child.canonicalValue({}));
        const expected = JSON.stringify([
          [JSON.stringify(['attribute', '', 'href']), child.attribute('href', '')],
          [JSON.stringify(['attribute', '', 'rel']), child.attribute('rel', '')],
        ]);
        if (exact !== expected) refuse('an added row acquired unknown native link state');
        return true;
      },
    }),
  );
}

export function preparePinnedMessageClassUpdate(
  storedXml: string,
  builtXml: string,
  selection: { messages: boolean; description: boolean },
): { body: string; persistedBody: string; changedFields: string[] } {
  const stored = document(storedXml),
    requested = document(builtXml);
  if (stored.name !== requested.name) refuse('the requested native owner differs');
  const changedFields: string[] = [],
    removedNumbers: string[] = [];
  if (selection.description) {
    const description = requested.root.attribute('description', core);
    if (description === undefined) refuse('the requested description is missing');
    setAttribute(stored.element, 'description', description);
  }
  if (selection.messages) {
    for (const number of stored.rows.keys())
      if (!requested.rows.has(number)) {
        removedNumbers.push(number);
        changedFields.push(`/mc:messages[number=${number}]#removed`);
      }
    const replacements: Node[] = [];
    for (const [number, row] of requested.rows) {
      const previous = stored.rows.get(number);
      if (previous) {
        const text = row.native.attribute('msgtext', mc)!;
        if (previous.native.attribute('msgtext', mc) !== text)
          changedFields.push(`/mc:messages[number=${number}]@mc:msgtext`);
        setAttribute(previous.node, 'msgtext', text);
        replacements.push(previous.node);
      } else {
        // The ordinary builder supplies the valid native payload/default flags. Bind its prefix locally.
        attributes(row.node)['@_xmlns:mc'] = mc;
        const originalKey = Object.keys(row.node).find((key) => key !== ':@')!;
        const exemplar = stored.rows.values().next().value as Row | undefined;
        const nativeKey = exemplar ? Object.keys(exemplar.node).find((key) => key !== ':@')! : originalKey;
        if (nativeKey !== originalKey) {
          row.node[nativeKey] = row.node[originalKey];
          delete row.node[originalKey];
        }
        replacements.push(row.node);
        changedFields.push(`/mc:messages[number=${number}]#added`);
      }
    }
    let inserted = false;
    const oldNodes = new Set([...stored.rows.values()].map((row) => row.node));
    stored.element[stored.key] = stored.children.flatMap((node) => {
      if (!oldNodes.has(node)) return [node];
      if (inserted) return [];
      inserted = true;
      return replacements;
    });
    if (!inserted) (stored.element[stored.key] as Node[]).push(...replacements);
  }
  const body = builder.build(stored.nodes) as string,
    target = document(body);
  changedFields.push(
    ...assertOnlyRequestedChanges(
      outsideRows(stored.root),
      outsideRows(target.root),
      selection.description ? ['@adtcore:description'] : [],
    ),
  );
  // Compare whole row state by its native identity. A selected text can change; opaque state cannot.
  for (const [number, row] of target.rows) {
    const before = stored.rows.get(number);
    if (!before) continue;
    const text = row.native.attribute('msgtext', mc)!;
    const canonical = (r: NativeXmlElement) =>
      JSON.stringify(
        r.canonicalValue({
          omitAttribute: (name, ns, depth) => selection.messages && depth === 0 && ns === mc && name === 'msgtext',
        }),
      );
    if (
      canonical(before.native) !== canonical(row.native) ||
      (!selection.messages && text !== before.native.attribute('msgtext', mc))
    )
      refuse('the rewrite changed unselected native row state');
  }
  // Native PUT upserts ordinary rows; omission alone never removes a message. Deletion markers
  // are generated solely from this locked, validated stored/requested row difference.
  if (!removedNumbers.length) return { body, persistedBody: body, changedFields };
  const children = stored.element[stored.key] as Node[];
  for (const number of removedNumbers)
    children.push({ 'mc:deletedmessages': [], ':@': { '@_xmlns:mc': mc, '@_mc:msgno': number } });
  const wire = builder.build(stored.nodes) as string;
  const markers = new Map(
    nativeXmlCharacterRoot(wire, 'messageClass', mc).canonicalValue({}) as Array<[string, unknown]>,
  ).get(JSON.stringify(['element', mc, 'deletedmessages'])) as unknown[];
  if (markers?.length !== removedNumbers.length) refuse('deletion instruction cardinality changed');
  for (const [i, marker] of markers.entries()) {
    const number = removedNumbers[i];
    if (!/^\d{3}$/.test(number) || target.rows.has(number)) refuse('deletion instruction identity changed');
    const expected = nativeXmlCharacterRoot(
      `<mc:deletedmessages xmlns:mc="${mc}" mc:msgno="${number}"/>`,
      'deletedmessages',
      mc,
    );
    if (JSON.stringify(marker) !== JSON.stringify(expected.canonicalValue({})))
      refuse('deletion instruction contains unqualified fields');
  }
  return { body: wire, persistedBody: body, changedFields };
}

/** Full read-back proof, with only validated native bookkeeping/new-row link additions derived. */
export function assertSavedMessageClass(targetXml: string, savedXml: string, addedNumbers: ReadonlySet<string>): void {
  const target = document(targetXml),
    saved = document(savedXml);
  if (target.name !== saved.name || target.rows.size !== saved.rows.size)
    refuse('save read-back changed the owner or exact row membership');
  assertSavedFields(outsideRows(target.root), outsideRows(saved.root), []);
  for (const [number, row] of target.rows) {
    const actual = saved.rows.get(number);
    if (!actual || rowValue(row.native, addedNumbers.has(number)) !== rowValue(actual.native, addedNumbers.has(number)))
      refuse(`save read-back differs for message ${number}`);
  }
}
export function addedMessageNumbers(beforeXml: string, afterXml: string): ReadonlySet<string> {
  const before = document(beforeXml),
    after = document(afterXml);
  return new Set([...after.rows.keys()].filter((number) => !before.rows.has(number)));
}
