/**
 * Filter conditions of filter-dependent BAdI implementations (ENHO/XHB).
 *
 * SAP stores a filter as `<enho:filterTree>` per implementation: `enho:Filter` leaves combined by
 * `enho:Or`/`enho:And` groups (xsi:type), followed by one `<enho:filterProperty>` per filter used, whose
 * type and check object come from the BAdI definition in the enhancement spot. SAPRead renders the tree as
 * text, e.g. `LGNUM = '1000' OR LGNUM = '2000'`; SAPWrite parses that text back into a tree.
 * Evidence (SAP_BASIS 816): docs/research/2026-10-07-enho-xhb-write-contract.md.
 */
import type { EnhancementImplementationInfo } from './types.js';
import { escapeXmlAttr, getNestedArray, parseXml, toRecordArray } from './xml-parser.js';

export type FilterNode =
  | { kind: 'Filter'; name: string; comparator: string; value: string }
  | { kind: 'And' | 'Or'; children: FilterNode[] };

/** Comparators SAP offers for BAdI filter values. */
export const FILTER_COMPARATORS = ['=', '<>', '<=', '>=', '<', '>', 'CP', 'NP'] as const;

/** A filter declared by a BAdI definition: its type and SAP's `<enhs:filterCheck>` (DDIC check), if any. */
export interface FilterDeclaration {
  type: string;
  /** The definition's check element, already renamed to `enho:filterCheck`; '' when the filter has none. */
  checkXml: string;
}

type XmlNode = Record<string, unknown>;

/** Same-kind groups are flattened so `A OR (B OR C)` and `A OR B OR C` compare equal. */
function group(kind: 'And' | 'Or', children: FilterNode[]): FilterNode {
  const flat = children.flatMap((child) => (child.kind === kind ? child.children : [child]));
  return flat.length === 1 ? flat[0] : { kind, children: flat };
}

function fromTokens(token: unknown): FilterNode | undefined {
  const parts = toRecordArray(token).flatMap((node): FilterNode[] => {
    const kind = String(node['@_type'] ?? '').replace(/^.*:/, '');
    if (kind === 'Filter') {
      return [
        {
          kind: 'Filter',
          name: String(node['@_filterName'] ?? ''),
          comparator: String(node['@_comparator'] ?? ''),
          value: String(node['@_value'] ?? ''),
        },
      ];
    }
    const children = toRecordArray(node.filterToken)
      .map(fromTokens)
      .filter((child): child is FilterNode => !!child);
    if (!children.length) return [];
    return [group(kind === 'And' ? 'And' : 'Or', children)];
  });
  if (!parts.length) return undefined;
  // Sibling tokens at the top level combine with AND.
  return parts.length === 1 ? parts[0] : group('And', parts);
}

/** Canonical text form: `NAME OP 'VALUE'`, AND binds tighter than OR, nested groups in parentheses. */
export function renderFilter(node: FilterNode, nested = false): string {
  if (node.kind === 'Filter') return `${node.name} ${node.comparator} '${node.value.replace(/'/g, "''")}'`;
  const text = node.children.map((child) => renderFilter(child, true)).join(` ${node.kind.toUpperCase()} `);
  return nested ? `(${text})` : text;
}

function invalid(message: string): Error {
  return new Error(`Invalid ENHO filter: ${message}`);
}

/**
 * Parse a filter condition such as `COUNTRY = 'BE' OR (COUNTRY = 'NL' AND MODEL <> 'BP')`.
 * Values are quoted (`''` escapes a quote) or bare words; names are upper-cased, values kept as given.
 */
export function parseFilterCondition(text: string): FilterNode {
  const tokens: string[] = [];
  const re = /^(\(|\)|'(?:[^']|'')*'|<>|<=|>=|=|<|>|[^\s()'<>=]+)/;
  let rest = text.trim();
  while (rest) {
    const match = re.exec(rest);
    if (!match) throw invalid(`cannot read "${rest.slice(0, 20)}" (unterminated quote?).`);
    tokens.push(match[1]);
    rest = rest.slice(match[0].length).trimStart();
  }
  let pos = 0;
  const isKeyword = (word: string | undefined, keyword: string) => word?.toUpperCase() === keyword;

  const parseFactor = (): FilterNode => {
    const token = tokens[pos++];
    if (token === undefined) throw invalid('the condition ends early.');
    if (token === '(') {
      const inner = parseExpr();
      if (tokens[pos++] !== ')') throw invalid('a closing parenthesis is missing.');
      return inner;
    }
    const name = token.toUpperCase();
    if (!/^(?:\/[A-Z0-9_]+\/)?[A-Z0-9_]+$/.test(name)) throw invalid(`"${token}" is not a filter name.`);
    const comparator = (tokens[pos++] ?? '').toUpperCase();
    if (!(FILTER_COMPARATORS as readonly string[]).includes(comparator)) {
      throw invalid(`after ${name} expected one of ${FILTER_COMPARATORS.join(' ')}, got "${comparator}".`);
    }
    const raw = tokens[pos++];
    if (raw === undefined || raw === '(' || raw === ')') throw invalid(`${name} ${comparator} needs a value.`);
    const value = raw.startsWith("'") ? raw.slice(1, -1).replace(/''/g, "'") : raw;
    return { kind: 'Filter', name, comparator, value };
  };
  const parseTerm = (): FilterNode => {
    const children = [parseFactor()];
    while (isKeyword(tokens[pos], 'AND')) {
      pos++;
      children.push(parseFactor());
    }
    return group('And', children);
  };
  function parseExpr(): FilterNode {
    const children = [parseTerm()];
    while (isKeyword(tokens[pos], 'OR')) {
      pos++;
      children.push(parseTerm());
    }
    return group('Or', children);
  }

  if (!tokens.length) throw invalid('the condition is empty.');
  const tree = parseExpr();
  if (pos < tokens.length) throw invalid(`unexpected "${tokens[pos]}"; combine conditions with AND or OR.`);
  return tree;
}

/** Canonical form of a condition text, for comparing user input with the stored filter. */
export function normalizeFilterCondition(text: string): string {
  return renderFilter(parseFilterCondition(text));
}

function filterNames(node: FilterNode, into: string[] = []): string[] {
  if (node.kind === 'Filter') {
    if (!into.includes(node.name)) into.push(node.name);
  } else for (const child of node.children) filterNames(child, into);
  return into;
}

/**
 * Build `<enho:filterTree>` in the shape SAP returns: one root token, then one filterProperty per
 * filter used, copied from the BAdI definition's declaration.
 */
export function buildFilterTreeXml(
  node: FilterNode,
  implName: string,
  declarations: Map<string, FilterDeclaration>,
  badiName: string,
): string {
  const names = filterNames(node);
  const unknown = names.filter((name) => !declarations.has(name));
  if (unknown.length) {
    const declared = [...declarations.keys()].join(', ') || 'none';
    throw invalid(`BAdI ${badiName} declares no filter ${unknown.join(', ')} (declared: ${declared}).`);
  }
  const xsi = ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';
  const token = (current: FilterNode, root: boolean): string => {
    const ns = root ? xsi : '';
    if (current.kind === 'Filter') {
      const ref = `#//badi/contentSpecific///${implName}/filterTree/filterProperty.${current.name}`;
      return `<enho:filterToken xsi:type="enho:Filter" enho:filterName="${escapeXmlAttr(current.name)}" enho:comparator="${escapeXmlAttr(current.comparator)}" enho:value="${escapeXmlAttr(current.value)}" enho:filterProperty="${escapeXmlAttr(ref)}"${ns}/>`;
    }
    const children = current.children.map((child) => token(child, false)).join('');
    return `<enho:filterToken xsi:type="enho:${current.kind}"${ns}>${children}</enho:filterToken>`;
  };
  const properties = names
    .map((name) => {
      const declaration = declarations.get(name) as FilterDeclaration;
      const head = `<enho:filterProperty enho:filterName="${escapeXmlAttr(name)}" enho:filterType="${escapeXmlAttr(declaration.type)}"`;
      return declaration.checkXml ? `${head}>${declaration.checkXml}</enho:filterProperty>` : `${head}/>`;
    })
    .join('');
  return `<enho:filterTree>${token(node, true)}${properties}</enho:filterTree>`;
}

/** Add `filter` to each BAdI implementation of `info` that has a filter tree in `xml`. */
export function withFilterConditions(xml: string, info: EnhancementImplementationInfo): EnhancementImplementationInfo {
  const root = parseXml(xml).objectData as XmlNode | undefined;
  const specific = (root?.contentSpecific ?? {}) as XmlNode;
  const tech = (typeof specific.badiTechnology === 'object' ? specific.badiTechnology : {}) as XmlNode;
  const implementations = [
    ...getNestedArray(tech, 'badiImplementations', 'badiImplementation'),
    ...getNestedArray(specific, 'badiImplementations', 'badiImplementation'),
  ];
  const filters = new Map<string, string>();
  for (const node of implementations) {
    const tree = toRecordArray(node.filterTree)[0];
    const parsed = tree ? fromTokens(tree.filterToken) : undefined;
    if (parsed) filters.set(String(node['@_name'] ?? '').toUpperCase(), renderFilter(parsed));
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
