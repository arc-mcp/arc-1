/**
 * A cluster names its objects but not their fields: the descriptor says
 * "CHAR of 40 bytes", never "MSGID". A Layout is the DDIC side of that — the
 * components of the structure the exporting program used — and `applyLayout`
 * lays it over an object's descriptor, walking both trees together and
 * refusing to guess when they disagree.
 *
 * Ported from vibing-steampunk's `pkg/datacluster/layout.go` (same MIT
 * license, same original author).
 */

import type { Cluster, ClusterObject, Field, Node } from './types.js';
import { ObjectKind, TYPE_CHAR, TYPE_DATE, TYPE_NUMC, TYPE_PACKED, TYPE_TIME, typeName } from './types.js';

/** What a DDIC component is. */
export enum ComponentKind {
  /** A field with a type, length and decimals. */
  Elementary = 'elementary',
  /** A component whose type is itself a structure; the cluster writes it as a nested descriptor. */
  Substructure = 'substructure',
  /** A structure included into this one; the cluster may write it as a nested descriptor or splice its fields in place. */
  Include = 'include',
  /** A component whose type is an internal table type. */
  Table = 'table',
}

/** One DDIC field of a structure. */
export interface Component {
  name: string;
  kind?: ComponentKind;
  /** The DDIC data type (CHAR, DEC, INT4, STRG, ...) for elementary components and the structure name for the others. */
  type?: string;
  /** The DDIC length: characters for character types, digits for packed numbers, bytes for raw. */
  chars?: number;
  decimals?: number;
  /** The layout of a substructure or include. */
  sub?: Layout;
}

/** One structure's component list. */
export interface Layout {
  name: string;
  components: Component[];
}

function unicode(o: ClusterObject): boolean {
  return o.charBytes === 2;
}

function valueNodes(n: Node): Node[] {
  return (n.children ?? []).filter((ch) => !ch.filler);
}

/**
 * Names the object's fields after the layout. Throws, and names nothing, when the layout does
 * not fit the descriptor: a different number of components, a nested structure where the layout
 * has a field, a length or type that disagrees.
 */
export function applyLayout(o: ClusterObject, l: Layout): void {
  if (o.kind === ObjectKind.Elementary) {
    const firstKind = l.components[0]?.kind ?? ComponentKind.Elementary;
    if (l.components.length !== 1 || firstKind !== ComponentKind.Elementary) {
      throw new Error(`${o.name} is an elementary object; ${l.name} has ${l.components.length} components`);
    }
    checkLeaf(o.type, l.components[0]!, unicode(o));
    o.fields[0]!.name = l.components[0]!.name;
    return;
  }
  const names = new Map<string, string>();
  const nodes = valueNodes(o.type);
  const iRef = { i: 0 };
  try {
    walkLayout(nodes, iRef, l.components, '', names, unicode(o));
  } catch (err) {
    throw new Error(`${l.name} does not fit ${o.name}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (iRef.i !== nodes.length) {
    throw new Error(
      `${l.name} does not fit ${o.name}: the cluster has ${nodes.length - iRef.i} more field(s) than the layout`,
    );
  }
  nameFields(o.fields, names);
}

function nameFields(fields: Field[], names: Map<string, string>): void {
  for (const f of fields) {
    f.name = names.get(f.path);
    if (f.fields) nameFields(f.fields, names);
  }
}

function walkLayout(
  nodes: Node[],
  iRef: { i: number },
  comps: Component[],
  prefix: string,
  names: Map<string, string>,
  unicodeFlag: boolean,
): void {
  for (const c of comps) {
    switch (c.kind) {
      case ComponentKind.Table: {
        if (iRef.i >= nodes.length)
          throw new Error(`layout has ${prefix}${c.name} but the cluster has no field left for it`);
        const n = nodes[iRef.i]!;
        if (!n.table)
          throw new Error(`layout has table ${prefix}${c.name} where the cluster has a ${typeName(n.typeCode)} field`);
        names.set(n.path, prefix + c.name);
        iRef.i++;
        if (!c.sub) continue; // the line type stays numbered
        const lineNodes = valueNodes(n);
        const j = { i: 0 };
        walkLayout(lineNodes, j, c.sub.components, `${prefix}${c.name}[].`, names, unicodeFlag);
        if (j.i !== lineNodes.length) {
          throw new Error(
            `table ${prefix}${c.name}: the line has ${lineNodes.length - j.i} more field(s) than ${c.sub.name}`,
          );
        }
        break;
      }
      case ComponentKind.Substructure: {
        if (iRef.i >= nodes.length)
          throw new Error(`layout has ${prefix}${c.name} but the cluster has no field left for it`);
        const n = nodes[iRef.i]!;
        if (!n.children || n.children.length === 0) {
          throw new Error(
            `layout has structure ${prefix}${c.name} where the cluster has a ${typeName(n.typeCode)} field`,
          );
        }
        if (!c.sub) throw new Error(`structure ${prefix}${c.name} has no component list`);
        iRef.i++;
        const sub = valueNodes(n);
        const j = { i: 0 };
        walkLayout(sub, j, c.sub.components, `${prefix}${c.name}.`, names, unicodeFlag);
        if (j.i !== sub.length) {
          throw new Error(
            `structure ${prefix}${c.name}: the cluster has ${sub.length - j.i} more field(s) than ${c.sub.name}`,
          );
        }
        break;
      }
      case ComponentKind.Include: {
        if (!c.sub) throw new Error(`include ${prefix}${c.name} has no component list`);
        // The kernel writes an include either as a nested descriptor of its own or spliced into
        // the parent; both occur.
        if (iRef.i < nodes.length && nodes[iRef.i]!.include) {
          const n = nodes[iRef.i]!;
          iRef.i++;
          const sub = valueNodes(n);
          const j = { i: 0 };
          walkLayout(sub, j, c.sub.components, prefix, names, unicodeFlag);
          if (j.i !== sub.length) {
            throw new Error(`include ${c.sub.name}: the cluster has ${sub.length - j.i} more field(s) than it`);
          }
          continue;
        }
        walkLayout(nodes, iRef, c.sub.components, prefix, names, unicodeFlag);
        break;
      }
      default: {
        if (iRef.i >= nodes.length)
          throw new Error(`layout has ${prefix}${c.name} but the cluster has no field left for it`);
        const n = nodes[iRef.i]!;
        if (n.children && n.children.length > 0) {
          throw new Error(
            `layout has field ${prefix}${c.name} where the cluster has a structure of ${valueNodes(n).length} fields`,
          );
        }
        try {
          checkLeaf(n, c, unicodeFlag);
        } catch (err) {
          throw new Error(`${prefix}${c.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
        names.set(n.path, prefix + c.name);
        iRef.i++;
      }
    }
  }
}

/** Compares one DDIC field with one cluster field by type family and byte length. */
function checkLeaf(n: Node, c: Component, unicodeFlag: boolean): void {
  const mapped = ddicToCluster(c, unicodeFlag);
  if (!mapped) throw new Error(`DDIC type ${c.type} is not one this reader knows`);
  const { code, bytes } = mapped;
  if (!sameFamily(code, n.typeCode)) {
    throw new Error(`DDIC says ${c.type}, the cluster holds ${typeName(n.typeCode)}`);
  }
  if (bytes !== n.length) {
    throw new Error(`DDIC ${c.type}(${c.chars ?? 0}) is ${bytes} bytes, the cluster field is ${n.length}`);
  }
  if (n.typeCode === TYPE_PACKED && (c.decimals ?? 0) !== n.decimals) {
    throw new Error(`DDIC has ${c.decimals ?? 0} decimals, the cluster ${n.decimals}`);
  }
}

function sameFamily(a: number, b: number): boolean {
  if (a === b) return true;
  const charLike = (t: number): boolean => t === TYPE_CHAR || t === TYPE_NUMC || t === TYPE_DATE || t === TYPE_TIME;
  return charLike(a) && charLike(b) && (a === TYPE_CHAR || b === TYPE_CHAR);
}

/** Maps a DDIC data type and length to the cluster's type code and byte length. */
function ddicToCluster(c: Component, unicodeFlag: boolean): { code: number; bytes: number } | undefined {
  const charBytes = unicodeFlag ? 2 : 1;
  const chars = c.chars ?? 0;
  switch ((c.type ?? '').toUpperCase()) {
    case 'CHAR':
    case 'CUKY':
    case 'UNIT':
    case 'LANG':
    case 'CLNT':
    case 'ACCP':
    case 'LCHR':
      return { code: TYPE_CHAR, bytes: chars * charBytes };
    case 'NUMC':
    case 'PREC':
      return { code: TYPE_NUMC, bytes: chars * charBytes };
    case 'DATS':
      return { code: TYPE_DATE, bytes: 8 * charBytes };
    case 'TIMS':
      return { code: TYPE_TIME, bytes: 6 * charBytes };
    case 'DEC':
    case 'QUAN':
    case 'CURR':
      return { code: TYPE_PACKED, bytes: Math.floor(chars / 2) + 1 };
    case 'INT1':
      return { code: 0x0a, bytes: 1 };
    case 'INT2':
      return { code: 0x09, bytes: 2 };
    case 'INT4':
      return { code: 0x08, bytes: 4 };
    case 'INT8':
      return { code: 0x1b, bytes: 8 };
    case 'FLTP':
      return { code: 0x07, bytes: 8 };
    case 'RAW':
    case 'LRAW':
    case 'GEOM_EWKB':
      return { code: 0x04, bytes: chars };
    case 'STRG':
    case 'SSTR':
      return { code: 0x13, bytes: 8 };
    case 'RSTR':
      return { code: 0x14, bytes: 8 };
    case 'D16D':
    case 'D16R':
    case 'D16S':
    case 'DF16_DEC':
    case 'DF16_RAW':
      return { code: 0x17, bytes: 8 };
    case 'D34D':
    case 'D34R':
    case 'D34S':
    case 'DF34_DEC':
    case 'DF34_RAW':
    case 'UTCL':
      return { code: 0x18, bytes: 16 };
    default:
      return undefined;
  }
}

/**
 * Renders the rows as objects once the fields are named; unnamed fields keep their path as the
 * key. A table component's rows become objects too when its line is named, and stay arrays
 * otherwise.
 */
export function objectRecords(o: ClusterObject): Record<string, unknown>[] {
  return recordsOf(o.fields, o.rows);
}

function recordsOf(fields: Field[], rows: unknown[][]): Record<string, unknown>[] {
  return rows.map((row) => {
    const m: Record<string, unknown> = {};
    row.forEach((v, i) => {
      const f = fields[i]!;
      let key = f.path;
      if (f.name) {
        // Inside a table's rows the name is local to the line: the enclosing path is the object
        // they sit in.
        key = f.name;
        const at = key.lastIndexOf('[].');
        if (at >= 0) key = key.slice(at + 3);
      }
      if (Array.isArray(v) && f.fields && f.fields.length > 0 && f.fields[0]!.name) {
        m[key] = recordsOf(f.fields, v as unknown[][]);
      } else {
        m[key] = v;
      }
    });
    return m;
  });
}

/** SAPscript's text line: the format column and the line. STXL stores every text as a table of these under the object name TLINE. */
export const TLINE_LAYOUT: Layout = {
  name: 'TLINE',
  components: [
    { name: 'TDFORMAT', type: 'CHAR', chars: 2 },
    { name: 'TDLINE', type: 'CHAR', chars: 132 },
  ],
};

/** One SAPscript line with its format. */
export interface TextLine {
  format: string;
  line: string;
}

function str(v: unknown): string {
  if (typeof v === 'string') return v;
  return v === undefined || v === null ? '' : String(v);
}

/**
 * Reads an STXL cluster's TLINE table into lines and joins them into one text the way the editor
 * shows it: a paragraph format starts a new line, "=" continues the previous one, "/" is a line
 * break within a paragraph, "/:" and "/*" are command and comment lines.
 */
export function sapScriptText(c: Cluster): { lines: TextLine[]; text: string } {
  const obj = c.objects.find((o) => o.name === 'TLINE');
  if (!obj) {
    throw new Error(`no TLINE object in the cluster (objects: ${c.objects.map((o) => o.name).join(', ')})`);
  }
  applyLayout(obj, TLINE_LAYOUT);
  const lines: TextLine[] = [];
  let text = '';
  for (const row of obj.rows) {
    const l: TextLine = { format: str(row[0]), line: str(row[1]) };
    lines.push(l);
    if (l.format.trim() === '=') {
      text += l.line;
    } else {
      if (text.length > 0) text += '\n';
      text += l.line;
    }
  }
  return { lines, text };
}

/**
 * Names fields from a map the caller wrote, for clusters whose types are not in DDIC — a
 * program's local structure, a class's type. The key is the object name for its own fields
 * ("HDR"), or the object name and a path for what sits under it ("HDR.10", "SNAP.1"): a table's
 * line, or a flat structure component. The value is the names in field order, the way DD03L
 * lists a structure with its includes expanded. What does not fit is said, not guessed: a count
 * that differs names the shorter run.
 */
export function applyNames(objects: ClusterObject[], names: Record<string, string[]>): string[] {
  const notes: string[] = [];
  for (const key of Object.keys(names).sort()) {
    const list = names[key]!;
    const cut = key.indexOf('.');
    const objName = cut >= 0 ? key.slice(0, cut) : key;
    const path = cut >= 0 ? key.slice(cut + 1) : '';
    let fields: Field[] = [];
    let found = false;
    for (const o of objects) {
      if (o.name.toLowerCase() !== objName.toLowerCase()) continue;
      found = true;
      fields = fieldsUnder(o.fields, path);
    }
    if (!found) {
      notes.push(`names for ${key}: no such object`);
      continue;
    }
    if (fields.length === 0) {
      notes.push(`names for ${key}: no fields at that path`);
      continue;
    }
    if (fields.length !== list.length) {
      notes.push(
        `names for ${key}: ${list.length} names for ${fields.length} fields; the first ${Math.min(list.length, fields.length)} named`,
      );
    }
    for (let i = 0; i < fields.length && i < list.length; i++) {
      const name = (list[i] ?? '').trim().toLowerCase();
      if (name) fields[i]!.name = name;
    }
  }
  return notes;
}

/**
 * Lists the fields under a path in order: the object's own list for "", a table's line for the
 * table's path, a flat structure component's fields for its prefix — through a table's line when
 * the path leads into one.
 */
function fieldsUnder(fields: Field[], path: string): Field[] {
  const out: Field[] = [];
  for (const f of fields) {
    if (path === '') {
      out.push(f);
    } else if (f.path === path) {
      for (const sub of f.fields ?? []) out.push(sub);
      return out;
    } else if (f.path.startsWith(`${path}.`)) {
      out.push(f);
    } else if (path.startsWith(`${f.path}.`) && f.fields && f.fields.length > 0) {
      const under = fieldsUnder(f.fields, path);
      if (under.length > 0) return under;
    }
  }
  return out;
}
