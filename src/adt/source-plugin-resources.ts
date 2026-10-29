/** Source-unit ownership and metadata relations shared by program and class plug-in discovery. */
import { XMLValidator } from 'fast-xml-parser';
import { AdtError } from './errors.js';
import { canonicalHostRelativeAdtPath } from './path-safety.js';
import { parseXml } from './xml-parser.js';

export interface SourcePluginUnit {
  type: 'PROG' | 'INCL' | 'FUNC' | 'FUGR' | 'CLAS';
  name: string;
  group?: string;
  section?: 'main' | 'definitions' | 'implementations' | 'macros' | 'testclasses';
}
type Row = Record<string, unknown>;
const rows = (v: unknown): Row[] => (Array.isArray(v) ? v : v ? [v] : []) as Row[];
const attr = (r: Row, k: string) => String(r[`@_${k}`] ?? '');
function invalid(): never {
  throw new AdtError('Invalid source enhancement metadata relation.');
}

/** Construct only known object routes; names remain encoded as a single segment, including namespaces. */
export function sourcePluginObjectUri(unit: SourcePluginUnit): string {
  const segment = (n: string) => {
    if (!/^(?:\/[a-z0-9_]+\/)?[a-z0-9_=$<>%-]+$/i.test(n) || n.length > 120 || n.includes('%')) invalid();
    return encodeURIComponent(n.toLowerCase());
  };
  const name = segment(unit.name);
  switch (unit.type) {
    case 'PROG':
      return `/sap/bc/adt/programs/programs/${name}`;
    case 'INCL':
      return `/sap/bc/adt/programs/includes/${name}`;
    case 'CLAS':
      return `/sap/bc/adt/oo/classes/${name}`;
    case 'FUGR':
      return `/sap/bc/adt/functions/groups/${name}`;
    case 'FUNC':
      return `/sap/bc/adt/functions/groups/${segment(unit.group ?? '')}/fmodules/${name}`;
  }
}

export interface SourcePluginResources {
  objectUri: string;
  sourceUri: string;
  elements?: { uri: string; accept: string };
  identities?: { uri: string; accept: string };
}

/** Select only the requested source section, and reject a linked route belonging to another object. */
export function sourcePluginResources(xml: string, unit: SourcePluginUnit): SourcePluginResources {
  if (Buffer.byteLength(xml) > 256 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true)
    invalid();
  const parsed = parseXml(xml);
  const root = Object.entries(parsed).find(([key]) => !key.startsWith('?'))?.[1];
  if (!root || typeof root !== 'object' || Array.isArray(root)) invalid();
  const meta = root as Row;
  const objectUri = sourcePluginObjectUri(unit);
  if (attr(meta, 'name').toUpperCase() !== unit.name.toUpperCase()) invalid();
  const expected = { PROG: 'PROG/P', INCL: 'PROG/I', FUGR: 'FUGR/F', FUNC: 'FUGR/FF', CLAS: 'CLAS/OC' }[unit.type];
  if (attr(meta, 'type') !== expected) invalid();
  if (attr(meta, 'version') && attr(meta, 'version') !== 'active') invalid();
  const section = unit.section ?? 'main';
  const sourceUri = `${objectUri}/${unit.type === 'CLAS' && section !== 'main' ? `includes/${section}` : 'source/main'}`;
  let selected = meta;
  if (unit.type === 'CLAS') {
    const includes = rows((meta.includes as Row | undefined)?.include);
    selected = includes.find((i) => attr(i, 'includeType') === section) ?? {};
  }
  const find = (container: Row, relation: string, expectedPaths: string[]) => {
    const links = rows(container.link).filter((l) => attr(l, 'rel') === `http://www.sap.com/adt/relations/${relation}`);
    if (links.length > 1) invalid();
    if (!links[0]) return undefined;
    const href = attr(links[0], 'href');
    // Resolve simple relative resource names only; never normalize away traversal, authority or queries.
    const path = href.startsWith('/') ? href : `${objectUri}/${href}`;
    if (
      !canonicalHostRelativeAdtPath(path, '/sap/bc/adt/', { allowRawEncodedSlash: true }) ||
      !expectedPaths.some((p) => p.toUpperCase() === path.toUpperCase())
    )
      invalid();
    return path;
  };
  const elements = find(selected, 'enhancements', [`${sourceUri}/enhancements`, `${sourceUri}/enhancements/elements`]);
  // Selected FUNC/INCL/CLAS sections must never borrow an owning group's/class's broader identity list.
  const identities =
    unit.type === 'PROG' || unit.type === 'FUGR' || (unit.type === 'CLAS' && section === 'main')
      ? find(meta, 'enhancementImplementations', [`${objectUri}/enhancements/implementations`])
      : undefined;
  return {
    objectUri,
    sourceUri,
    ...(elements
      ? {
          elements: {
            uri: elements,
            accept: elements.endsWith('/elements')
              ? 'application/vnd.sap.adt.enhancements.v3+xml'
              : 'application/vnd.sap.adt.enhancements+xml',
          },
        }
      : {}),
    ...(identities
      ? { identities: { uri: identities, accept: 'application/vnd.sap.adt.enhancementimplementations.v1+xml' } }
      : {}),
  };
}
