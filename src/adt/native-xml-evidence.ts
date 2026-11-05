/** Bounded native metadata with namespace bindings retained; never collapse identity attributes by local name. */
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { DataResponseBudget } from './data-result-context.js';
import { AdtSafetyError } from './errors.js';
import type { AdtHttpClient, AdtRequestOptions } from './http.js';
import { decodeXmlEntities } from './xml-entities.js';

const parser = new XMLParser({ ignoreAttributes: false, parseAttributeValue: false, parseTagValue: false });
const exactParser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
});
// Explicit XML 1.0 character-reference semantics for native MSAG preservation. The default
// profiles retain their existing behavior; numeric references and literal '&amp;#65;' differ.
const characterParser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  entityDecoder: {
    decode: (value) =>
      value.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);|&/g, (reference) => {
        const decoded = decodeXmlEntities(reference);
        if (decoded === reference) throw new AdtSafetyError('Invalid or unsupported native XML character reference.');
        return decoded;
      }),
    reset: () => {},
    setXmlVersion: () => {},
    setExternalEntities: rejectEntities,
    addInputEntities: rejectEntities,
  },
});
function rejectEntities(entities: Record<string, string>): void {
  if (Object.keys(entities).length) throw new AdtSafetyError('Native XML entity declarations are unsupported.');
}
type Element = Record<string, unknown>;
const localName = (key: string) => key.slice(key.lastIndexOf(':') + 1);

/** Fresh bounded metadata GET; callers retain their native identity, package and operation checks. */
export function readNativeMetadata(
  http: AdtHttpClient,
  path: string,
  family: string,
  request?: AdtRequestOptions,
  accept?: string,
) {
  return http.get(
    path,
    { ...(accept ? { Accept: accept } : {}), 'Cache-Control': 'no-cache' },
    {
      ...request,
      responseBudget: request?.responseBudget ?? new DataResponseBudget(1024 * 1024, family, true),
    },
  );
}

export interface NativeXmlProjection {
  omitAttribute?: (name: string, namespace: string, depth: number, element: NativeXmlElement) => boolean;
  omitChild?: (name: string, namespace: string, child: NativeXmlElement, depth: number) => boolean;
}

export class NativeXmlElement {
  private readonly bindings: ReadonlyMap<string, string>;
  constructor(
    private readonly node: Element,
    inherited: ReadonlyMap<string, string> = new Map(),
    private readonly traversal = { remaining: 16_384 },
  ) {
    if (--traversal.remaining < 0) throw new AdtSafetyError('Native XML traversal exceeds its element budget.');
    const declarations = Object.entries(node).filter(([key]) => key === '@_xmlns' || key.startsWith('@_xmlns:'));
    if (inherited.size > 64 || declarations.length > 64)
      throw new AdtSafetyError('Native XML namespace declarations exceed their budget.');
    if (declarations.length === 0) {
      this.bindings = inherited;
      return;
    }
    const bindings = new Map(inherited);
    for (const [key, value] of declarations) {
      if (typeof value !== 'string') throw new AdtSafetyError('Invalid native XML namespace binding.');
      bindings.set(key === '@_xmlns' ? '' : key.slice(8), value);
      if (bindings.size > 64) throw new AdtSafetyError('Native XML namespace bindings exceed their budget.');
    }
    this.bindings = bindings;
  }
  matches(key: string, namespace: string, attribute = false): boolean {
    const prefix = key.includes(':') ? key.slice(0, key.indexOf(':')) : '';
    return (attribute && !prefix ? '' : (this.bindings.get(prefix) ?? '')) === namespace;
  }
  attribute(name: string, namespace: string): string | undefined {
    const keys = Object.keys(this.node).filter((k) => k.startsWith('@_') && localName(k.slice(2)) === name);
    if (!keys.length) return undefined;
    const key = keys[0]!;
    if (keys.length !== 1 || !this.matches(key.slice(2), namespace, true) || typeof this.node[key] !== 'string')
      throw new AdtSafetyError('Ambiguous or incorrectly bound native XML identity attribute.');
    return this.node[key] as string;
  }
  hasChild(name: string): boolean {
    return Object.keys(this.node).some((k) => !k.startsWith('@_') && localName(k) === name);
  }
  children(name: string, namespace: string): NativeXmlElement[] {
    const result: NativeXmlElement[] = [];
    for (const [key, value] of Object.entries(this.node)) {
      if (key.startsWith('@_') || localName(key) !== name) continue;
      for (const item of Array.isArray(value) ? value : [value]) {
        const node = item === '' ? {} : item;
        if (!node || typeof node !== 'object' || Array.isArray(node))
          throw new AdtSafetyError('Invalid native XML metadata element.');
        const child = new NativeXmlElement(node as Element, this.bindings, this.traversal);
        if (!child.matches(key, namespace)) throw new AdtSafetyError('Incorrectly bound native XML metadata element.');
        result.push(child);
      }
    }
    return result;
  }
  child(name: string, namespace: string): NativeXmlElement | undefined {
    const found = this.children(name, namespace);
    if (found.length > 1) throw new AdtSafetyError('Duplicate native XML metadata element.');
    return found[0];
  }

  /** Stable expanded names; preserve values and repeated-child order, never namespace spellings. */
  canonicalValue(policy: NativeXmlProjection, depth = 0): unknown {
    if (depth > 64) throw new AdtSafetyError('Native metadata nesting exceeds the comparison budget.');
    const fields: Array<[string, unknown]> = [];
    const seen = new Set<string>();
    const namespace = (key: string, attribute: boolean, bindings = this.bindings) => {
      const prefix = key.includes(':') ? key.slice(0, key.indexOf(':')) : '';
      if (prefix && !bindings.has(prefix)) throw new AdtSafetyError('Unbound native metadata prefix.');
      return attribute && !prefix ? '' : (bindings.get(prefix) ?? '');
    };
    for (const [key, value] of Object.entries(this.node)) {
      if (key === '@_xmlns' || key.startsWith('@_xmlns:')) continue;
      if (key === '#text') {
        if (typeof value !== 'string') throw new AdtSafetyError('Invalid native metadata text.');
        const hasElements = Object.keys(this.node).some((k) => !k.startsWith('@_') && k !== '#text');
        if (value.trim() || !hasElements) fields.push(['text', value]);
        continue;
      }
      const attribute = key.startsWith('@_');
      const qname = attribute ? key.slice(2) : key;
      const name = localName(qname);
      if (attribute) {
        const ns = namespace(qname, true),
          expanded = JSON.stringify(['attribute', ns, name]);
        if (seen.has(expanded)) throw new AdtSafetyError('Ambiguous expanded native metadata name.');
        seen.add(expanded);
        if (typeof value !== 'string') throw new AdtSafetyError('Invalid native metadata value.');
        if (!policy.omitAttribute?.(name, ns, depth, this)) fields.push([expanded, value]);
        continue;
      }
      const children: unknown[] = [];
      let expanded: string | undefined;
      for (const item of Array.isArray(value) ? value : [value]) {
        const node = typeof item === 'string' ? (item ? { '#text': item } : {}) : item;
        if (!node || typeof node !== 'object' || Array.isArray(node))
          throw new AdtSafetyError('Invalid native metadata child.');
        const child = new NativeXmlElement(node as Element, this.bindings, this.traversal);
        const ns = namespace(qname, false, child.bindings);
        const childName = JSON.stringify(['element', ns, name]);
        if (expanded !== undefined && expanded !== childName)
          throw new AdtSafetyError('Inconsistent repeated native metadata binding.');
        expanded = childName;
        if (!policy.omitChild?.(name, ns, child, depth + 1)) children.push(child.canonicalValue(policy, depth + 1));
      }
      if (expanded !== undefined) {
        if (seen.has(expanded)) throw new AdtSafetyError('Ambiguous expanded native metadata name.');
        seen.add(expanded);
        if (children.length) fields.push([expanded, children]);
      }
    }
    return fields.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  }
}

export function nativeXmlRoot(xml: string, name: string, namespace: string, preserveValues = false): NativeXmlElement {
  return readNativeRoot(xml, name, namespace, preserveValues ? exactParser : parser);
}

/** Exact namespace/value evidence with one-pass XML character decoding; CDATA remains literal. */
export function nativeXmlCharacterRoot(xml: string, name: string, namespace: string): NativeXmlElement {
  return readNativeRoot(xml, name, namespace, characterParser);
}
function readNativeRoot(xml: string, name: string, namespace: string, selectedParser: XMLParser): NativeXmlElement {
  if (Buffer.byteLength(xml, 'utf8') > 1024 * 1024 || /<!DOCTYPE/i.test(xml) || XMLValidator.validate(xml) !== true)
    throw new AdtSafetyError('Cannot verify malformed or oversized native XML metadata.');
  const parsed = selectedParser.parse(xml) as Element;
  if (Object.keys(parsed).filter((k) => k !== '?xml').length !== 1)
    throw new AdtSafetyError('Ambiguous native XML metadata root.');
  const document = new NativeXmlElement(parsed);
  const root = document.child(name, namespace);
  if (!root) throw new AdtSafetyError('The native XML metadata root is missing or has the wrong identity.');
  return root;
}

/** Exact standalone owner identity and own package; inherited/container packages need their native adapter. */
export function nativeOwnerPackage(root: NativeXmlElement, name: string, type: string): string | undefined {
  const core = 'http://www.sap.com/adt/core';
  const pkg = root.child('packageRef', core);
  const packageName = pkg?.attribute('name', core);
  return root.attribute('name', core) === name &&
    root.attribute('type', core) === type &&
    !root.hasChild('containerRef') &&
    pkg?.attribute('type', core) === 'DEVC/K' &&
    packageName
    ? packageName
    : undefined;
}
