/**
 * Parses an ABAP data cluster: a sixteen-byte header, a body that is usually
 * LZH/LZC-compressed (see `./sapcompress.ts`), and inside it one object per
 * name the EXPORT statement gave, terminated by an end marker.
 *
 * The format is not documented by SAP. What is here was read off genuine
 * clusters on a live 7.58 system — an INDX record with every elementary
 * type, both compressed and not, and BALDAT application-log records — by
 * vibing-steampunk's `pkg/datacluster`, whose Go implementation this is a
 * straight port of (same MIT license, same original author). Every
 * assumption is checked against the same fixtures under
 * `tests/fixtures/datacluster/`.
 */

import * as sapcompress from './sapcompress.js';
import {
  type Cluster,
  type ClusterObject,
  type Field,
  isStringType,
  type Node,
  nodeSlot,
  ObjectKind,
  typeName,
} from './types.js';
import { type Decoder, newDecoder } from './values.js';

// Stream markers. The descriptor markers come in begin/end pairs; the data markers frame a
// table, a row, a run of fixed-length bytes, and one string value stored out of line.
const MARK_OBJ_STRUCT_BEGIN = 0xab; // structure object descriptor
const MARK_OBJ_STRUCT_END = 0xac;
const MARK_OBJ_TABLE_BEGIN = 0xad; // table line-type descriptor
const MARK_OBJ_TABLE_END = 0xae;
const MARK_STRUCT_BEGIN = 0xa0; // nested substructure
const MARK_STRUCT_END = 0xa1;
const MARK_INCLUDE_BEGIN = MARK_OBJ_STRUCT_BEGIN; // include inside a line type — same byte as an object structure
const MARK_INCLUDE_END = MARK_OBJ_STRUCT_END;
const MARK_LEAF = 0xaa;
const MARK_FILLER = 0xaf;
const MARK_ROW = 0xbc; // fixed-length bytes of a row
const MARK_ROW_END = 0xbd;
const MARK_TABLE = 0xbe; // row length + row count
const MARK_TABLE_END = 0xbf;
const MARK_STRING = 0xca; // out-of-line string / xstring value
const MARK_STRING_END = 0xcb;
const MARK_END = 0x04;
const DESCRIPTOR_ENTRY_SIZE = 7;

const LEGACY_HEADER_SIZE = 15;
const LEGACY_DESCRIPTOR_SIZE = 4;
const LEGACY_ROW = 0xbb;

const HEADER_SIZE = 16;

function objectKindFromRawByte(raw: number): ObjectKind {
  switch (raw) {
    case 1:
    case 7:
      return ObjectKind.Elementary;
    case 2:
    case 5:
      return ObjectKind.Structure;
    case 3:
    case 6:
      return ObjectKind.Table;
    default:
      throw new Error(`unknown object kind 0x${raw.toString(16).padStart(2, '0')}`);
  }
}

function countValues(n: { children?: Node[] }): number {
  return (n.children ?? []).filter((c) => !c.filler).length;
}

/** Flattens a descriptor into the leaves a row supplies values for: elementary fields, fillers,
 *  and table components (which are leaves of the enclosing row even though they have a line type
 *  of their own). */
function collect(n: Node, out: Node[]): void {
  if (!n.children || n.children.length === 0 || n.table) {
    out.push(n);
    return;
  }
  for (const ch of n.children) collect(ch, out);
}

function sumLeaves(leaves: Node[]): number {
  return leaves.reduce((s, n) => s + nodeSlot(n), 0);
}

/** Flattens a table component's line type. */
function lineLeaves(n: Node): Node[] {
  const out: Node[] = [];
  for (const ch of n.children ?? []) collect(ch, out);
  return out;
}

function fieldOf(n: Node): Field {
  const f: Field = { path: n.path, type: typeName(n.typeCode), typeCode: n.typeCode, length: n.length };
  if (n.decimals) f.decimals = n.decimals;
  if (n.table) {
    f.type = 'TABLE';
    f.fields = lineLeaves(n)
      .filter((l) => !l.filler)
      .map(fieldOf);
  }
  return f;
}

class ClusterParser {
  pos = 0;
  constructor(
    readonly data: Buffer,
    readonly dec: Decoder,
  ) {}

  private need(n: number): void {
    if (this.pos + n > this.data.length) {
      throw new Error(`truncated: need ${n} bytes at offset ${this.pos}, have ${this.data.length - this.pos}`);
    }
  }

  private u32(): number {
    this.need(4);
    const v = this.data.readUInt32BE(this.pos);
    this.pos += 4;
    return v;
  }

  // ─── Version 6 (Unicode) ────────────────────────────────────────────

  /**
   * Reads one export: its header, its descriptor, its data.
   *
   * Header layout, 32 bytes plus the name:
   *   0     object kind: 01 elementary, 07 elementary string, 02 flat / 05 deep structure,
   *         03 flat / 06 deep table
   *   1     type code of the element or of the (line) structure
   *   2     decimals of an elementary packed number, else 0
   *   3-6   row length, big-endian
   *   7-10  object length in the plain body, big-endian; 0 when compressed
   *   11    name length in characters
   *   12-31 0
   *   32-   name, UTF-16LE
   */
  object(): ClusterObject {
    this.need(32);
    const h = this.data.subarray(this.pos, this.pos + 32);
    const kind = objectKindFromRawByte(h[0]!);
    const typeCode = h[1]!;
    const decimalsByte = h[2]!;
    const rowLength = h.readUInt32BE(3);
    const size = h.readUInt32BE(7);
    const nameLen = h[11]!;
    this.pos += 32;
    this.need(nameLen * 2);
    const name = this.data.subarray(this.pos, this.pos + nameLen * 2).toString('utf16le');
    this.pos += nameLen * 2;

    let root: Node;
    if (kind === ObjectKind.Elementary) {
      root = { path: '1', typeCode, length: rowLength, decimals: decimalsByte };
    } else {
      root = this.descriptor(kind);
      if (root.length !== rowLength) {
        throw new Error(`descriptor length ${root.length} does not match row length ${rowLength}`);
      }
    }

    const leaves: Node[] = [];
    collect(root, leaves);
    if (sumLeaves(leaves) !== rowLength) {
      throw new Error(`fields sum to ${sumLeaves(leaves)} bytes, row is ${rowLength}`);
    }
    const fields = leaves.filter((n) => !n.filler).map(fieldOf);

    if (kind === ObjectKind.Table) {
      this.need(1);
      if (this.data[this.pos] !== MARK_TABLE) {
        throw new Error(
          `expected table data marker at offset ${this.pos}, found 0x${this.data[this.pos]!.toString(16)}`,
        );
      }
      this.pos++;
      const rows = this.tableRows({
        path: '',
        typeCode: 0,
        length: rowLength,
        decimals: 0,
        table: true,
        children: root.children,
      });
      return { name, kind, typeCode, rowLength, size, type: root, fields, rows, charBytes: this.dec.utf16 ? 2 : 1 };
    }
    const row = this.row(leaves);
    return {
      name,
      kind,
      typeCode,
      rowLength,
      size,
      type: root,
      fields,
      rows: [row],
      charBytes: this.dec.utf16 ? 2 : 1,
    };
  }

  /** Reads the type tree of a structure or table object. Entries are seven bytes: marker, type code, decimals, big-endian length. */
  private descriptor(kind: ObjectKind): Node {
    this.need(DESCRIPTOR_ENTRY_SIZE);
    const open = kind === ObjectKind.Table ? MARK_OBJ_TABLE_BEGIN : MARK_OBJ_STRUCT_BEGIN;
    const close = kind === ObjectKind.Table ? MARK_OBJ_TABLE_END : MARK_OBJ_STRUCT_END;
    if (this.data[this.pos] !== open) {
      throw new Error(
        `expected descriptor marker 0x${open.toString(16)} at offset ${this.pos}, found 0x${this.data[this.pos]!.toString(16)}`,
      );
    }
    const root: Node = {
      path: '',
      typeCode: this.data[this.pos + 1]!,
      decimals: this.data[this.pos + 2]!,
      length: this.data.readUInt32BE(this.pos + 3),
      children: [],
    };
    this.pos += DESCRIPTOR_ENTRY_SIZE;
    this.children(root, close, '');
    return root;
  }

  private children(parent: Node, close: number, prefix: string): void {
    parent.children ??= [];
    for (;;) {
      this.need(DESCRIPTOR_ENTRY_SIZE);
      const e = this.data.subarray(this.pos, this.pos + DESCRIPTOR_ENTRY_SIZE);
      const marker = e[0]!;
      const code = e[1]!;
      const dec = e[2]!;
      const length = e.readUInt32BE(3);
      this.pos += DESCRIPTOR_ENTRY_SIZE;
      if (marker === close) {
        if (length !== parent.length) {
          throw new Error(`descriptor closes with length ${length}, opened with ${parent.length}`);
        }
        return;
      }
      const path = `${prefix}${countValues(parent) + 1}`;
      switch (marker) {
        case MARK_LEAF:
          parent.children!.push({ path, typeCode: code, decimals: dec, length });
          break;
        case MARK_FILLER:
          parent.children!.push({ path: '', typeCode: code, length, decimals: 0, filler: true });
          break;
        case MARK_STRUCT_BEGIN:
        case MARK_INCLUDE_BEGIN: {
          const isInclude = marker === MARK_INCLUDE_BEGIN;
          const child: Node = { path, typeCode: code, decimals: dec, length, include: isInclude, children: [] };
          this.children(child, isInclude ? MARK_INCLUDE_END : MARK_STRUCT_END, `${path}.`);
          parent.children!.push(child);
          break;
        }
        case MARK_OBJ_TABLE_BEGIN: {
          // A table-typed component: the nested descriptor is its line type, and the length
          // here is the line's, not the slot's.
          const child: Node = { path, typeCode: code, decimals: dec, length, table: true, children: [] };
          this.children(child, MARK_OBJ_TABLE_END, `${path}.`);
          parent.children!.push(child);
          break;
        }
        default:
          throw new Error(
            `unknown descriptor marker 0x${marker.toString(16)} at offset ${this.pos - DESCRIPTOR_ENTRY_SIZE}`,
          );
      }
    }
  }

  /**
   * Reads one row's data. Fixed-length fields come in runs framed by BC..BD, one run up to each
   * string field; a string's value sits between those runs framed by CA..CB, and its eight-byte
   * reference in the row is not written at all. The row is complete when every field has a value
   * — there is no end-of-row marker, the last BC run simply closes.
   */
  private row(leaves: Node[]): unknown[] {
    const values: unknown[] = [];
    let i = 0;
    while (i < leaves.length) {
      this.need(1);
      const marker = this.data[this.pos]!;
      this.pos++;
      switch (marker) {
        case MARK_ROW: {
          const n = this.u32();
          this.need(n + 1);
          let run = this.data.subarray(this.pos, this.pos + n);
          this.pos += n;
          if (this.data[this.pos] !== MARK_ROW_END) {
            throw new Error(
              `fixed run not closed at offset ${this.pos} (found 0x${this.data[this.pos]!.toString(16)})`,
            );
          }
          this.pos++;
          while (run.length > 0) {
            if (i >= leaves.length) throw new Error(`${run.length} bytes of row data left after the last field`);
            const leaf = leaves[i]!;
            if (isStringType(leaf.typeCode) || leaf.table) {
              throw new Error(
                `field ${leaf.path} is a ${typeName(leaf.typeCode)} but the row supplies fixed bytes for it`,
              );
            }
            if (run.length < leaf.length)
              throw new Error(`field ${leaf.path} needs ${leaf.length} bytes, run has ${run.length}`);
            if (!leaf.filler) values.push(this.dec.value(leaf, run.subarray(0, leaf.length)));
            run = run.subarray(leaf.length);
            i++;
          }
          break;
        }
        case MARK_STRING: {
          const n = this.u32();
          this.need(n + 1);
          const raw = this.data.subarray(this.pos, this.pos + n);
          this.pos += n;
          if (this.data[this.pos] !== MARK_STRING_END) throw new Error(`string value not closed at offset ${this.pos}`);
          this.pos++;
          while (i < leaves.length && leaves[i]!.filler) i++;
          if (i >= leaves.length || !isStringType(leaves[i]!.typeCode)) {
            throw new Error(`string value at offset ${this.pos} has no string field to land in`);
          }
          values.push(this.dec.stringValue(leaves[i]!, raw));
          i++;
          break;
        }
        case MARK_TABLE: {
          while (i < leaves.length && leaves[i]!.filler) i++;
          if (i >= leaves.length || !leaves[i]!.table)
            throw new Error(`table data at offset ${this.pos - 1} has no table field to land in`);
          try {
            values.push(this.tableRows(leaves[i]!));
          } catch (err) {
            throw new Error(`field ${leaves[i]!.path}: ${err instanceof Error ? err.message : String(err)}`);
          }
          i++;
          break;
        }
        default:
          throw new Error(`unexpected marker 0x${marker.toString(16)} in row data at offset ${this.pos - 1}`);
      }
    }
    return values;
  }

  /** Reads a nested table block, the BE marker already consumed: line length, row count, the rows, and the closing BF. */
  private tableRows(table: Node): unknown[][] {
    this.need(8);
    const lineLen = this.u32();
    const count = this.u32();
    if (lineLen !== table.length)
      throw new Error(`nested table data has line length ${lineLen}, its descriptor ${table.length}`);
    const leaves = lineLeaves(table);
    const rows: unknown[][] = [];
    for (let r = 0; r < count; r++) {
      try {
        rows.push(this.row(leaves));
      } catch (err) {
        throw new Error(`row ${r + 1}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    this.need(1);
    if (this.data[this.pos] !== MARK_TABLE_END) {
      throw new Error(`nested table not closed at offset ${this.pos} (found 0x${this.data[this.pos]!.toString(16)})`);
    }
    this.pos++;
    return rows;
  }

  // ─── Version 5 (legacy, pre-Unicode) ────────────────────────────────

  /**
   * Version 5 is what pre-Unicode kernels wrote, and what stays on disk after a Unicode
   * conversion until something rewrites the row. The shape is the same idea with smaller
   * numbers: a two-byte row length, four-byte descriptor entries without a decimals byte,
   * single-byte names, and rows each introduced by a BB marker with no count and no framing
   * around fixed and string parts — there were no strings to frame.
   *
   * Object header, 15 bytes plus the name:
   *   0     object kind, as in version 6
   *   1     type code
   *   2-3   row length, big-endian
   *   4-5   object length in the body, big-endian
   *   6     name length in characters
   *   7-14  eight bytes that differ per object and are not needed to read it
   *   15-   name, one byte per character
   */
  legacyObject(): ClusterObject {
    this.need(LEGACY_HEADER_SIZE);
    const h = this.data.subarray(this.pos, this.pos + LEGACY_HEADER_SIZE);
    const kind = objectKindFromRawByte(h[0]!);
    const typeCode = h[1]!;
    const rowLength = h.readUInt16BE(2);
    const size = h.readUInt16BE(4);
    const nameLen = h[6]!;
    this.pos += LEGACY_HEADER_SIZE;
    this.need(nameLen);
    const name = this.dec.text(this.data.subarray(this.pos, this.pos + nameLen));
    this.pos += nameLen;

    let root: Node;
    if (kind === ObjectKind.Elementary) {
      root = { path: '1', typeCode, length: rowLength, decimals: 0 };
    } else {
      root = this.legacyDescriptor(kind);
      if (root.length !== rowLength) {
        throw new Error(`descriptor length ${root.length} does not match row length ${rowLength}`);
      }
    }

    const leaves: Node[] = [];
    collect(root, leaves);
    if (sumLeaves(leaves) !== rowLength) {
      throw new Error(`fields sum to ${sumLeaves(leaves)} bytes, row is ${rowLength}`);
    }
    const fields: Field[] = [];
    for (const n of leaves) {
      if (isStringType(n.typeCode) || n.table) {
        throw new Error(
          `field ${n.path} is a ${typeName(n.typeCode)}, which a version 5 cluster was not expected to hold`,
        );
      }
      if (!n.filler) fields.push(fieldOf(n));
    }

    // Rows: BB and the row's bytes, repeated; a table with no rows has none.
    const rows: unknown[][] = [];
    for (;;) {
      if (this.pos >= this.data.length || this.data[this.pos] !== LEGACY_ROW) break;
      this.pos++;
      this.need(rowLength);
      let run = this.data.subarray(this.pos, this.pos + rowLength);
      this.pos += rowLength;
      const row: unknown[] = [];
      for (const leaf of leaves) {
        if (!leaf.filler) row.push(this.dec.value(leaf, run.subarray(0, leaf.length)));
        run = run.subarray(leaf.length);
      }
      rows.push(row);
      if (kind !== ObjectKind.Table) break;
    }
    if (kind !== ObjectKind.Table && rows.length === 0) {
      throw new Error(`${kind} object has no data row`);
    }
    return { name, kind, typeCode, rowLength, size, type: root, fields, rows, charBytes: this.dec.utf16 ? 2 : 1 };
  }

  /** Reads the four-byte entries: marker, type code, length. */
  private legacyDescriptor(kind: ObjectKind): Node {
    this.need(LEGACY_DESCRIPTOR_SIZE);
    const open = kind === ObjectKind.Table ? MARK_OBJ_TABLE_BEGIN : MARK_OBJ_STRUCT_BEGIN;
    const close = kind === ObjectKind.Table ? MARK_OBJ_TABLE_END : MARK_OBJ_STRUCT_END;
    if (this.data[this.pos] !== open) {
      throw new Error(
        `expected descriptor marker 0x${open.toString(16)} at offset ${this.pos}, found 0x${this.data[this.pos]!.toString(16)}`,
      );
    }
    const root: Node = {
      path: '',
      typeCode: this.data[this.pos + 1]!,
      decimals: 0,
      length: this.data.readUInt16BE(this.pos + 2),
      children: [],
    };
    this.pos += LEGACY_DESCRIPTOR_SIZE;
    this.legacyChildren(root, close, '');
    return root;
  }

  private legacyChildren(parent: Node, close: number, prefix: string): void {
    parent.children ??= [];
    for (;;) {
      this.need(LEGACY_DESCRIPTOR_SIZE);
      const e = this.data.subarray(this.pos, this.pos + LEGACY_DESCRIPTOR_SIZE);
      const marker = e[0]!;
      const code = e[1]!;
      const length = e.readUInt16BE(2);
      this.pos += LEGACY_DESCRIPTOR_SIZE;
      if (marker === close) {
        if (length !== parent.length)
          throw new Error(`descriptor closes with length ${length}, opened with ${parent.length}`);
        return;
      }
      const path = `${prefix}${countValues(parent) + 1}`;
      switch (marker) {
        case MARK_LEAF:
          parent.children!.push({ path, typeCode: code, decimals: 0, length });
          break;
        case MARK_FILLER:
          parent.children!.push({ path: '', typeCode: code, length, decimals: 0, filler: true });
          break;
        case MARK_STRUCT_BEGIN:
        case MARK_INCLUDE_BEGIN: {
          const isInclude = marker === MARK_INCLUDE_BEGIN;
          const child: Node = { path, typeCode: code, decimals: 0, length, include: isInclude, children: [] };
          this.legacyChildren(child, isInclude ? MARK_INCLUDE_END : MARK_STRUCT_END, `${path}.`);
          parent.children!.push(child);
          break;
        }
        default:
          throw new Error(
            `unknown descriptor marker 0x${marker.toString(16)} at offset ${this.pos - LEGACY_DESCRIPTOR_SIZE}`,
          );
      }
    }
  }
}

/** Decodes a whole cluster, decompressing the body when it is compressed. */
export function parseCluster(blob: Buffer): Cluster {
  if (blob.length < HEADER_SIZE) {
    throw new Error(`datacluster: ${blob.length} bytes is shorter than the ${HEADER_SIZE}-byte header`);
  }
  if (blob[0] !== 0xff) {
    throw new Error(
      `datacluster: no cluster marker (first byte 0x${blob[0]!.toString(16).padStart(2, '0')}, want 0xff)`,
    );
  }
  const version = blob[1]!;
  const codepage = blob.subarray(8, 12).toString('latin1');
  let body = blob.subarray(HEADER_SIZE);
  let compressed = false;
  let algorithm: string | undefined;
  const format = blob[4]!;
  if (format === 2) {
    let header: sapcompress.SapCompressHeader;
    try {
      header = sapcompress.parseHeader(body);
    } catch (err) {
      throw new Error(`datacluster: header says compressed but ${err instanceof Error ? err.message : String(err)}`);
    }
    compressed = true;
    algorithm = sapcompress.algorithmName(header.algorithm);
    try {
      body = sapcompress.decompress(body);
    } catch (err) {
      throw new Error(`datacluster: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (format !== 1) {
    throw new Error(`datacluster: unknown body format 0x${format.toString(16).padStart(2, '0')}`);
  }

  const dec = newDecoder(codepage);
  const p = new ClusterParser(body, dec);
  const objects: ClusterObject[] = [];
  for (;;) {
    if (p.pos >= p.data.length) throw new Error('datacluster: stream ends without the end marker');
    if (p.data[p.pos] === MARK_END) break;
    try {
      if (version === 5) {
        objects.push(p.legacyObject());
      } else if (version === 6) {
        objects.push(p.object());
      } else {
        throw new Error(`cluster format version ${version} is not one this reader knows (5 and 6 are)`);
      }
    } catch (err) {
      throw new Error(
        `datacluster: object ${objects.length + 1} at offset ${p.pos}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return { version, codepage, compressed, algorithm, objects };
}
