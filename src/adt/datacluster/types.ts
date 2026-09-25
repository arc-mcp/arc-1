/**
 * Shared types for the ABAP data-cluster decoder.
 *
 * A data cluster is the byte stream `EXPORT ... TO DATABASE` writes into
 * INDX-like tables (BALDAT, INDX, STXL, and any Z table built the same way):
 * a small header, a body that is usually LZH/LZC-compressed (see
 * `./sapcompress.ts`), and inside it one object per name the EXPORT
 * statement gave. Each object carries a type descriptor — kind, length and
 * decimals for every field, nested for structures — followed by its data.
 * What the kernel does NOT write is field names: it writes types, not DDIC,
 * so fields are numbered here (`Field.path`) and `./layout.ts` lays a DDIC
 * structure's component names over them when one is known.
 *
 * This is a straight port of vibing-steampunk's `pkg/datacluster` (same
 * license, same original author) — the format is undocumented by SAP and
 * was reverse-engineered there against genuine cluster fixtures; those
 * fixtures are reused verbatim under `tests/fixtures/datacluster/`.
 */

/** What the EXPORT statement handed over under one name. */
export enum ObjectKind {
  /** A single field: a variable of an elementary type. */
  Elementary = 'elementary',
  /** A flat or nested structure. */
  Structure = 'structure',
  /** An internal table. */
  Table = 'table',
}

/** ABAP type codes as the kernel writes them into a descriptor. */
export const TYPE_CHAR = 0x00;
export const TYPE_DATE = 0x01;
export const TYPE_PACKED = 0x02;
export const TYPE_TIME = 0x03;
export const TYPE_RAW = 0x04;
export const TYPE_NUMC = 0x06;
export const TYPE_FLOAT = 0x07;
export const TYPE_INT = 0x08;
export const TYPE_INT2 = 0x09;
export const TYPE_INT1 = 0x0a;
export const TYPE_STRUCTURE = 0x0e; // flat
export const TYPE_DEEP = 0x0f; // structure containing strings or nested structures
export const TYPE_STRING = 0x13;
export const TYPE_XSTRING = 0x14;
export const TYPE_DECFLOAT16 = 0x17;
export const TYPE_DECFLOAT34 = 0x18;
export const TYPE_INT8 = 0x1b;

const TYPE_NAMES: Record<number, string> = {
  [TYPE_CHAR]: 'CHAR',
  [TYPE_DATE]: 'DATS',
  [TYPE_PACKED]: 'DEC',
  [TYPE_TIME]: 'TIMS',
  [TYPE_RAW]: 'RAW',
  [TYPE_NUMC]: 'NUMC',
  [TYPE_FLOAT]: 'FLTP',
  [TYPE_INT]: 'INT4',
  [TYPE_INT2]: 'INT2',
  [TYPE_INT1]: 'INT1',
  [TYPE_STRUCTURE]: 'STRUCT',
  [TYPE_DEEP]: 'STRUCT',
  [TYPE_STRING]: 'STRING',
  [TYPE_XSTRING]: 'XSTRING',
  [TYPE_DECFLOAT16]: 'DF16',
  [TYPE_DECFLOAT34]: 'DF34',
  [TYPE_INT8]: 'INT8',
};

/** Renders a type code the way DDIC would. */
export function typeName(code: number): string {
  return TYPE_NAMES[code] ?? `TYPE${code.toString(16).toUpperCase().padStart(2, '0')}`;
}

export function isStringType(code: number): boolean {
  return code === TYPE_STRING || code === TYPE_XSTRING;
}

/** One entry of an object's type descriptor. */
export interface Node {
  /** Names the node by position: "3" is the third field of the object, "3.2" the second field inside it. */
  path: string;
  typeCode: number;
  length: number;
  decimals: number;
  /** Alignment padding the kernel inserted between fields; it carries no value. */
  filler?: boolean;
  /** A structure written as an include rather than a substructure — the kernel's distinction, not this decoder's. */
  include?: boolean;
  /**
   * A table-typed component: `children` describe its line type and `length` is the line length,
   * while the component itself takes eight bytes in the enclosing row (a reference) and its rows
   * follow in the data stream as a nested table block.
   */
  table?: boolean;
  children?: Node[];
}

/** The bytes a node takes in its enclosing row: strings and tables are eight-byte references there. */
export function nodeSlot(n: Node): number {
  if (n.table || isStringType(n.typeCode)) return 8;
  return n.length;
}

/** One leaf of the type descriptor: something that has a value. */
export interface Field {
  path: string;
  /** The DDIC field name once a Layout has been applied. */
  name?: string;
  type: string;
  typeCode: number;
  length: number;
  decimals?: number;
  /** The line of a table-typed component; its value in a row is then a slice of rows over these. */
  fields?: Field[];
}

/** One named export: an elementary field, a structure, or a table. */
export interface ClusterObject {
  name: string;
  kind: ObjectKind;
  /** The ABAP type code of the object as a whole — the element type for elementary, the structure/line type code for structures and tables. */
  typeCode: number;
  /** The byte length of one row (or of the structure), including alignment fillers and 8-byte string/table references. */
  rowLength: number;
  /** The object's total length in the plain body; the kernel writes this for uncompressed clusters and leaves it zero for compressed ones. */
  size: number;
  /** The full descriptor tree. */
  type: Node;
  /** The leaves of `type` in order, alignment fillers left out; every row has one value per field. */
  fields: Field[];
  /** The decoded values: one row for elementary/structure objects, one per line for tables. */
  rows: unknown[][];
  /** Bytes per character in this cluster's code page (1 or 2) — needed by `layout.ts` to translate DDIC lengths. */
  charBytes: 1 | 2;
}

/** One parsed data cluster. */
export interface Cluster {
  /** 6 from Unicode kernels, 5 from the ones before (still on disk after a Unicode conversion until rewritten). */
  version: number;
  /** The SAP code page the character data is in: "4103" is UTF-16LE, "4102" UTF-16BE, anything else single-byte. */
  codepage: string;
  /** Whether the body was LZH/LZC-compressed on the database. */
  compressed: boolean;
  /** The compression algorithm name, when there was one. */
  algorithm?: string;
  /** The exported values, in the order the EXPORT statement named them. */
  objects: ClusterObject[];
}

/** Returns the export with that name, or undefined. */
export function findObject(c: Cluster, name: string): ClusterObject | undefined {
  return c.objects.find((o) => o.name === name);
}
