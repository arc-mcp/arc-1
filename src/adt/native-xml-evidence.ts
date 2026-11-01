/** Bounded native metadata with namespace bindings retained; never collapse identity attributes by local name. */
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { AdtSafetyError } from './errors.js';

const parser = new XMLParser({ ignoreAttributes: false, parseAttributeValue: false, parseTagValue: false });
type Element = Record<string, unknown>;
const localName = (key: string) => key.slice(key.lastIndexOf(':') + 1);

export class NativeXmlElement {
  private readonly bindings: ReadonlyMap<string, string>;
  constructor(
    private readonly node: Element,
    inherited: ReadonlyMap<string, string> = new Map(),
  ) {
    const bindings = new Map(inherited);
    for (const [key, value] of Object.entries(node))
      if (key === '@_xmlns' || key.startsWith('@_xmlns:')) {
        if (typeof value !== 'string') throw new AdtSafetyError('Invalid native XML namespace binding.');
        bindings.set(key === '@_xmlns' ? '' : key.slice(8), value);
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
        const child = new NativeXmlElement(node as Element, this.bindings);
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
}

export function nativeXmlRoot(xml: string, name: string, namespace: string): NativeXmlElement {
  if (Buffer.byteLength(xml, 'utf8') > 1024 * 1024 || /<!DOCTYPE/i.test(xml) || XMLValidator.validate(xml) !== true)
    throw new AdtSafetyError('Cannot verify malformed or oversized native XML metadata.');
  const parsed = parser.parse(xml) as Element;
  if (Object.keys(parsed).filter((k) => k !== '?xml').length !== 1)
    throw new AdtSafetyError('Ambiguous native XML metadata root.');
  const document = new NativeXmlElement(parsed);
  const root = document.child(name, namespace);
  if (!root) throw new AdtSafetyError('The native XML metadata root is missing or has the wrong identity.');
  return root;
}
