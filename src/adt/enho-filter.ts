/**
 * Read-only filter conditions of filter-dependent BAdI implementations (ENHO/XHB).
 *
 * SAP stores a filter as `<enho:filterTree>` per implementation: `enho:Filter` leaves combined by
 * `enho:Or`/`enho:And` groups (xsi:type). SAPRead renders it as text, e.g. `LGNUM = '1000' OR LGNUM = '2000'`;
 * SAPWrite keeps the stored tree but cannot change it. Evidence: docs/research/2026-10-07-enho-xhb-write-contract.md.
 */
import type { EnhancementImplementationInfo } from './types.js';
import { parseXml } from './xml-parser.js';

type XmlNode = Record<string, unknown>;

function nodes(value: unknown): XmlNode[] {
  const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return list.filter((item): item is XmlNode => typeof item === 'object' && item !== null);
}

function condition(token: unknown, nested = false): string {
  const parts = nodes(token).map((node) => {
    const kind = String(node['@_type'] ?? '').replace(/^.*:/, '');
    if (kind === 'Filter') {
      return `${String(node['@_filterName'] ?? '')} ${String(node['@_comparator'] ?? '')} '${String(node['@_value'] ?? '')}'`;
    }
    const children = nodes(node.filterToken).map((child) => condition(child, true));
    const joined = children.join(` ${kind.toUpperCase()} `);
    return children.length > 1 && nested ? `(${joined})` : joined;
  });
  // Sibling tokens at the top level combine with AND.
  return parts.length > 1
    ? parts.map((part) => (part.includes(' OR ') ? `(${part})` : part)).join(' AND ')
    : (parts[0] ?? '');
}

/** Add `filter` to each BAdI implementation of `info` that has a filter tree in `xml`. */
export function withFilterConditions(xml: string, info: EnhancementImplementationInfo): EnhancementImplementationInfo {
  const root = parseXml(xml).objectData as XmlNode | undefined;
  const specific = (root?.contentSpecific ?? {}) as XmlNode;
  const tech = (typeof specific.badiTechnology === 'object' ? specific.badiTechnology : {}) as XmlNode;
  const container = (tech.badiImplementations ?? specific.badiImplementations ?? {}) as XmlNode;
  const filters = new Map<string, string>();
  for (const node of nodes(container.badiImplementation)) {
    const tree = nodes(node.filterTree)[0];
    const text = tree ? condition(tree.filterToken) : '';
    if (text) filters.set(String(node['@_name'] ?? '').toUpperCase(), text);
  }
  if (filters.size === 0) return info;
  return {
    ...info,
    badiImplementations: info.badiImplementations.map((impl) => {
      const filter = filters.get(impl.name.toUpperCase());
      return filter ? { ...impl, filter } : impl;
    }),
  };
}
