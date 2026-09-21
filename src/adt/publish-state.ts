/** Conservative publication evidence; the general SRVB parser defaults absent flags to false. */
import { XMLParser, XMLValidator } from 'fast-xml-parser';

const SRVB = 'http://www.sap.com/adt/ddic/ServiceBindings';
const CORE = 'http://www.sap.com/adt/core';
const parser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
});
export type PublishState = 'published' | 'unpublished' | 'unknown';

/** Only report a known state for the live-verified, single-version active V4 UI shape. */
export function readPublishState(xml: string, name: string, version: string): PublishState {
  if (Buffer.byteLength(xml) > 256 * 1024 || /<!DOCTYPE/i.test(xml) || XMLValidator.validate(xml) !== true)
    return 'unknown';
  try {
    const doc = parser.parse(xml);
    const roots = Object.keys(doc).filter((key) => key !== '#text');
    if (roots.length !== 1) return 'unknown';
    const root = doc[roots[0]!];
    if (!root || typeof root !== 'object' || Array.isArray(root)) return 'unknown';
    const qname = (key: string, uri: string, local: string) => {
      const [prefix, suffix] = key.split(':');
      return suffix === local && root[`@_xmlns:${prefix}`] === uri;
    };
    if (!qname(roots[0]!, SRVB, 'serviceBinding')) return 'unknown';
    const value = (node: unknown, uri: string, local: string, attribute = false): unknown => {
      if (!node || typeof node !== 'object' || Array.isArray(node)) return undefined;
      const keys = Object.keys(node).filter((key) =>
        attribute ? key.startsWith('@_') && qname(key.slice(2), uri, local) : qname(key, uri, local),
      );
      return keys.length === 1 ? (node as Record<string, unknown>)[keys[0]!] : undefined;
    };
    // Unrelated local Atom declarations are normal; rebinding an interpreted prefix is ambiguous.
    const rebound = (node: unknown, top = false): boolean =>
      !!node &&
      typeof node === 'object' &&
      Object.entries(node).some(
        ([key, val]) =>
          (!top && key.startsWith('@_xmlns:') && [SRVB, CORE].includes(root[key]) && val !== root[key]) || rebound(val),
      );
    if (rebound(root, true)) return 'unknown';
    if (
      value(root, CORE, 'name', true) !== name ||
      value(root, CORE, 'type', true) !== 'SRVB/SVB' ||
      value(root, CORE, 'version', true) !== 'active'
    )
      return 'unknown';
    const binding = value(root, SRVB, 'binding');
    const services = value(root, SRVB, 'services');
    if (
      value(binding, SRVB, 'type', true) !== 'ODATA' ||
      value(binding, SRVB, 'version', true) !== 'V4' ||
      value(binding, SRVB, 'category', true) !== '0' ||
      value(services, SRVB, 'name', true) !== name ||
      value(value(services, SRVB, 'content'), SRVB, 'version', true) !== version
    )
      return 'unknown';
    const published = value(root, SRVB, 'published', true);
    return published === 'true' ? 'published' : published === 'false' ? 'unpublished' : 'unknown';
  } catch {
    return 'unknown';
  }
}
