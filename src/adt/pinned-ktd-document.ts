import { XMLParser } from 'fast-xml-parser';
import {
  type KtdShortText,
  type KtdWriteReport,
  type NativeKtdRewriteProfile,
  rewriteKtdDocument,
} from './ddic-xml.js';
import { AdtSafetyError } from './errors.js';
import { nativeXmlRoot } from './native-xml-evidence.js';
import { DOCUMENT_CORE, SKTD_NS } from './pinned-document-owner.js';
import { decodeXmlEntities } from './xml-entities.js';

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  processEntities: false,
  commentPropName: '#comment',
  cdataPropName: '#cdata',
});

type Node = Record<string, unknown>;

const slots = new Set(['docu', 'element', 'id', 'text', 'shortText', 'refObject']);

const paths = new Set([
  'docu',
  'docu/element',
  'docu/refObject',
  'docu/element/id',
  'docu/element/text',
  'docu/element/shortText',
]);

function preservedDocument(xml: string, bodies: boolean, shortTexts: boolean) {
  // This also establishes the XML, depth, traversal and namespace limits before the ordered parser.
  const root = nativeXmlRoot(xml, 'docu', SKTD_NS, true);
  root.canonicalValue({});
  const objectName = root.attribute('name', DOCUMENT_CORE);
  if (!objectName?.trim() || objectName !== objectName.trim()) throw new AdtSafetyError('Missing native KTD owner.');
  const longTextWritable: boolean[] = [];
  const shortTextObligations: (string | undefined)[] = [];
  const nativeShortTextNodes = new WeakMap<Node, string | undefined>();
  function walk(nodes: Node[], inherited: ReadonlyMap<string, string>, path: string[]): Node[] {
    const counts = new Map<string, number>();
    return nodes.map((node) => {
      const key = Object.keys(node).find((key) => key !== ':@');
      if (!key) throw new AdtSafetyError('Unknown KTD lexical node.');
      if (key.startsWith('#') || key.startsWith('?')) {
        if (key !== '#text' && /sktd:(?:docu|element|id|text|shortText|refObject)\b/.test(JSON.stringify(node)))
          throw new AdtSafetyError('Opaque KTD markup can imitate a native write slot.');
        return node;
      }
      const attrs = { ...(node[':@'] ?? {}) } as Record<string, string>;
      const bindings = new Map(inherited);
      for (const [key, value] of Object.entries(attrs)) {
        if (key === '@_xmlns') bindings.set('', value);
        else if (key.startsWith('@_xmlns:')) bindings.set(key.slice(8), value);
      }
      const colon = key.indexOf(':'),
        prefix = colon < 0 ? '' : key.slice(0, colon),
        local = colon < 0 ? key : key.slice(colon + 1);
      const namespace = bindings.get(prefix) ?? '';
      const next = [...path, namespace === SKTD_NS ? local : `{${namespace}}${local}`];
      const selected = slots.has(local) && (prefix === 'sktd' || namespace === SKTD_NS);
      if (selected) {
        if (namespace !== SKTD_NS || key !== `sktd:${local}` || !paths.has(next.join('/')))
          throw new AdtSafetyError(
            'KTD write slots require their exact native namespace, lexical prefix and structural owner.',
          );
        const count = (counts.get(local) ?? 0) + 1;
        counts.set(local, count);
        if (local !== 'element' && count > 1) throw new AdtSafetyError('KTD write slots are ambiguous.');
      }
      if (!Array.isArray(node[key])) throw new AdtSafetyError('Unknown KTD lexical children.');
      let children = walk(node[key] as Node[], bindings, next);
      // Read only this verified node's native attributes, never quoted text inside foreign values.
      const attribute = (name: string) => {
        const entry = Object.entries(attrs).find(([key]) => {
          const qname = key.slice(2),
            at = qname.indexOf(':');
          return at > 0 && qname.slice(at + 1) === name && bindings.get(qname.slice(0, at)) === SKTD_NS;
        });
        return entry ? decodeXmlEntities(entry[1]).toLowerCase() : undefined;
      };
      if (selected && local === 'shortText') nativeShortTextNodes.set(node, attribute('obligation'));
      if (selected && local === 'element') {
        const shortText = (node[key] as Node[]).find((child) => nativeShortTextNodes.has(child));
        shortTextObligations.push(shortText ? nativeShortTextNodes.get(shortText) : undefined);
        const obligation = attribute('longTextObligation'),
          canHave = attribute('canHaveDocumentation');
        longTextWritable.push(
          obligation !== undefined
            ? obligation === 'optional' || obligation === 'mandatory'
            : canHave !== undefined
              ? canHave === 'true'
              : children.some((child) => Object.hasOwn(child, 'sktd:text')),
        );
      }
      if (selected && (local === 'text' || local === 'id')) {
        if (children.some((child) => Object.keys(child).some((key) => key !== '#text')))
          throw new AdtSafetyError('KTD text and route identifiers must be native plain-text leaves.');
        if (local === 'text' && bodies) children = [{ '#text': '<selected-native-body>' }];
      }
      if (selected && local === 'shortText' && shortTexts && Object.hasOwn(attrs, '@_sktd:text'))
        attrs['@_sktd:text'] = '<selected-native-short-text>';
      return { [key]: children, ...(node[':@'] ? { ':@': attrs } : {}) };
    });
  }
  const preserved = walk(parser.parse(xml) as Node[], new Map(), []);
  if (!longTextWritable.length) throw new AdtSafetyError('KTD writes require native document-owned element slots.');
  const profile: NativeKtdRewriteProfile = { kind: 'native', objectName, longTextWritable, shortTextObligations };
  return { value: JSON.stringify(preserved), profile };
}

export function rewritePinnedKtdDocument(
  xml: string,
  source: string | undefined,
  shortTexts: KtdShortText[] | undefined,
  report?: KtdWriteReport,
): string {
  const before = preservedDocument(xml, source !== undefined, !!shortTexts?.length);
  const result = rewriteKtdDocument(xml, source, shortTexts, report, before.profile);
  if (preservedDocument(result, source !== undefined, !!shortTexts?.length).value !== before.value)
    throw new AdtSafetyError('KTD rewrite changed state outside its verified native text slots.');
  return result;
}

/** Narrow native getter projection: direct owned BDEF operation reference labels are reconstructed. */
const core = 'http://www.sap.com/adt/core';

const sktd = 'http://www.sap.com/wbobj/texts/sktd';

type Fields = Array<[string, unknown]>;

const key = (kind: 'attribute' | 'element', namespace: string, name: string) => JSON.stringify([kind, namespace, name]);

const attribute = (fields: Fields, namespace: string, name: string) =>
  fields.find(([k]) => k === key('attribute', namespace, name))?.[1];

const children = (fields: Fields, namespace: string, name: string): Fields[] => {
  const value = fields.find(([k]) => k === key('element', namespace, name))?.[1];
  return Array.isArray(value) ? (value as Fields[]) : [];
};

const only = (fields: Fields, namespace: string, name: string) => {
  const nodes = children(fields, namespace, name);
  return nodes.length === 1 ? nodes[0] : undefined;
};

const text = (node: Fields | undefined) =>
  node?.length === 1 && node[0]?.[0] === 'text' && typeof node[0][1] === 'string' ? node[0][1] : undefined;

/** Input is the bounded, expanded-name canonical XML value. This never changes wire bytes or full hashes. */
export function ktdDerivedReferenceValue(value: unknown, owner: string): unknown {
  const root = value as Fields;
  const parent = only(root, sktd, 'refObject');
  const ownerUri = `/sap/bc/adt/bo/behaviordefinitions/${encodeURIComponent(owner.toLowerCase())}`;
  if (
    !parent ||
    attribute(root, core, 'name') !== owner ||
    attribute(root, core, 'type') !== 'SKTD/TYP' ||
    attribute(parent, core, 'name') !== owner ||
    attribute(parent, core, 'type') !== 'BDEF/BDO' ||
    attribute(parent, core, 'uri') !== ownerUri
  )
    return value;
  const nodes = children(root, sktd, 'element');
  const ids = nodes.map((node) => text(only(node, sktd, 'id')));
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) return value;
  const refKey = key('element', core, 'objectReference');
  const descriptionKey = key('attribute', core, 'description');
  function qualified(node: Fields) {
    const ref = only(node, core, 'objectReference');
    if (!ref) return false;
    const type = attribute(ref, core, 'type'),
      name = attribute(ref, core, 'name');
    if (
      typeof name !== 'string' ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ||
      (type !== 'BDEF/BSO' && type !== 'BDEF/BAC') ||
      (type === 'BDEF/BSO' && !['create', 'update', 'delete'].includes(name))
    )
      return false;
    const uri = `${ownerUri}/source/main#type=${type};name=${owner}.${name}`;
    return (
      attribute(ref, core, 'uri') === uri &&
      text(only(node, sktd, 'id')) === uri &&
      text(only(node, sktd, 'parent')) === `${ownerUri}/source/main#type=BDEF/BAE;name=${owner}`
    );
  }
  return root.map(([k, field]) =>
    k !== key('element', sktd, 'element')
      ? [k, field]
      : [
          k,
          nodes.map((node) =>
            !qualified(node)
              ? node
              : node.map(([k, field]) =>
                  k !== refKey
                    ? [k, field]
                    : [k, (field as Fields[]).map((ref) => ref.filter(([k]) => k !== descriptionKey))],
                ),
          ),
        ],
  );
}
