/**
 * A cluster carries types, not names. DD03L carries both, for every DDIC
 * structure, in one row per component, in order, with a DEPTH column that
 * nests the components of a structured field. Includes are the one thing it
 * does not nest: the included structure's rows follow the `.INCLUDE` row at
 * the same depth, and how many of them there are is only known from the
 * include's own DD03L rows. `structureLayout` reads it all through
 * `AdtClient.runTableQuery` (the same server-built-SELECT path SAPRead
 * TABLE_QUERY uses — `data` scope, no free SQL) and turns it into the
 * `Layout` `./datacluster/layout.ts` lays over a cluster object.
 *
 * Ported from vibing-steampunk's `pkg/adt/ddic_layout.go` (same MIT license,
 * same original author); adapted to ARC-1's structured-query client instead
 * of raw SQL strings.
 */

import type { AdtClient } from './client.js';
import { type Component, ComponentKind, type Layout, TLINE_LAYOUT } from './datacluster/index.js';

interface Dd03lRow {
  position: number;
  depth: number;
  field: string;
  precfield: string;
  comptype: string;
  rollname: string;
  datatype: string;
  leng: number;
  decimals: number;
}

/** What DD40L says a table type's line is: a structure by name, or an elementary type. */
interface LineType {
  structure?: string;
  element?: { datatype: string; leng: number; decimals: number };
}

function str(row: Record<string, string>, col: string): string {
  return (row[col] ?? '').trim();
}

function num(row: Record<string, string>, col: string): number {
  const n = Number.parseInt(str(row, col), 10);
  return Number.isFinite(n) ? n : 0;
}

async function dd03lRows(client: AdtClient, name: string): Promise<Dd03lRow[]> {
  const { rows } = await client.runTableQuery('DD03L', {
    columns: ['POSITION', 'DEPTH', 'FIELDNAME', 'PRECFIELD', 'COMPTYPE', 'ROLLNAME', 'DATATYPE', 'LENG', 'DECIMALS'],
    where: [
      { field: 'TABNAME', op: '=', value: name },
      { field: 'AS4LOCAL', op: '=', value: 'A' },
    ],
    maxRows: 5000,
  });
  return rows
    .map((r) => ({
      position: num(r, 'POSITION'),
      depth: num(r, 'DEPTH'),
      field: str(r, 'FIELDNAME'),
      precfield: str(r, 'PRECFIELD'),
      comptype: str(r, 'COMPTYPE'),
      rollname: str(r, 'ROLLNAME'),
      datatype: str(r, 'DATATYPE'),
      leng: num(r, 'LENG'),
      decimals: num(r, 'DECIMALS'),
    }))
    .sort((a, b) => a.position - b.position);
}

/** Reads a table type's line from DD40L: a structure (ROWKIND S), a data element (E with ROWTYPE), or a built-in type given right there. */
async function dd40lLine(client: AdtClient, tableType: string): Promise<LineType> {
  const { rows } = await client.runTableQuery('DD40L', {
    columns: ['ROWKIND', 'ROWTYPE', 'DATATYPE', 'LENG', 'DECIMALS'],
    where: [
      { field: 'TYPENAME', op: '=', value: tableType },
      { field: 'AS4LOCAL', op: '=', value: 'A' },
    ],
    maxRows: 1,
  });
  const row = rows[0];
  if (!row) throw new Error(`DDIC has no active table type ${tableType}`);
  const kind = str(row, 'ROWKIND');
  const rowType = str(row, 'ROWTYPE');
  if (kind === 'S') return { structure: rowType };
  if (kind === 'E') {
    let datatype = str(row, 'DATATYPE');
    let leng = num(row, 'LENG');
    let decimals = num(row, 'DECIMALS');
    if (rowType) {
      const dd04l = await client.runTableQuery('DD04L', {
        columns: ['DATATYPE', 'LENG', 'DECIMALS'],
        where: [
          { field: 'ROLLNAME', op: '=', value: rowType },
          { field: 'AS4LOCAL', op: '=', value: 'A' },
        ],
        maxRows: 1,
      });
      const el = dd04l.rows[0];
      if (el) {
        datatype = str(el, 'DATATYPE');
        leng = num(el, 'LENG');
        decimals = num(el, 'DECIMALS');
      }
    }
    return { element: { datatype, leng, decimals } };
  }
  throw new Error(`table type ${tableType} has a line of kind "${kind}", which this reader does not lay out`);
}

function isIncludeRow(r: Dd03lRow): boolean {
  return r.field.startsWith('.INCLU') || r.field.startsWith('.APPEND');
}

/** A cursor over a DD03L row list, so recursive parses share one advancing index. */
interface Cursor {
  rows: Dd03lRow[];
  i: number;
}

/** Reads a DDIC structure's components from DD03L, includes resolved and table-typed components followed into their line types. */
export async function structureLayout(client: AdtClient, name: string): Promise<Layout> {
  const upper = name.trim().toUpperCase();
  if (upper === 'TLINE') return TLINE_LAYOUT;
  const cache = new Map<string, Dd03lRow[]>();
  const rowsOf = async (n: string): Promise<Dd03lRow[]> => {
    const key = n.trim().toUpperCase();
    const cached = cache.get(key);
    if (cached) return cached;
    const rows = await dd03lRows(client, key);
    if (rows.length === 0) throw new Error(`DDIC has no active structure ${key}`);
    cache.set(key, rows);
    return rows;
  };
  const rows = await rowsOf(upper);
  return buildLayout(upper, rows, client, rowsOf, 0);
}

/** Turns DD03L rows into a Layout; nesting deeper than twenty is taken as a cycle. */
async function buildLayout(
  name: string,
  rows: Dd03lRow[],
  client: AdtClient,
  rowsOf: (n: string) => Promise<Dd03lRow[]>,
  nesting: number,
): Promise<Layout> {
  if (nesting > 20) {
    throw new Error(`structure ${name} nests deeper than twenty levels; probably an include cycle`);
  }
  const cursor: Cursor = { rows, i: 0 };
  const components = await parseComponents(name, cursor, 0, client, rowsOf, nesting);
  if (cursor.i !== rows.length) {
    throw new Error(
      `structure ${name}: DD03L row ${cursor.i + 1} (${rows[cursor.i]?.field}) is at a depth that has no parent`,
    );
  }
  return { name, components };
}

async function parseComponents(
  name: string,
  cursor: Cursor,
  depth: number,
  client: AdtClient,
  rowsOf: (n: string) => Promise<Dd03lRow[]>,
  nesting: number,
): Promise<Component[]> {
  const comps: Component[] = [];
  while (cursor.i < cursor.rows.length) {
    const r = cursor.rows[cursor.i]!;
    if (r.depth < depth) return comps;
    if (r.depth > depth) {
      throw new Error(`structure ${name}: row ${r.field} is at depth ${r.depth} under a field that is not a structure`);
    }
    if (isIncludeRow(r)) {
      const incRows = await rowsOf(r.precfield);
      const sub = await buildLayout(r.precfield.toUpperCase(), incRows, client, rowsOf, nesting + 1);
      // The include's rows follow this one at the same depth, one per row the include has itself
      // (its own nested rows included).
      cursor.i += 1 + incRows.length;
      comps.push({ name: r.field, kind: ComponentKind.Include, type: r.precfield.toUpperCase(), sub });
    } else if (r.comptype === 'S') {
      cursor.i++;
      const subComps = await parseComponents(`${name}-${r.field}`, cursor, depth + 1, client, rowsOf, nesting);
      comps.push({
        name: r.field,
        kind: ComponentKind.Substructure,
        type: r.rollname,
        sub: { name: r.rollname, components: subComps },
      });
    } else if (r.comptype === 'L') {
      cursor.i++;
      const comp: Component = { name: r.field, kind: ComponentKind.Table, type: r.rollname };
      const line = await dd40lLine(client, r.rollname);
      if (line.structure) {
        const lineRows = await rowsOf(line.structure);
        comp.sub = await buildLayout(line.structure.toUpperCase(), lineRows, client, rowsOf, nesting + 1);
      } else if (line.element) {
        comp.sub = {
          name: r.rollname,
          components: [
            {
              name: 'LINE',
              kind: ComponentKind.Elementary,
              type: line.element.datatype,
              chars: line.element.leng,
              decimals: line.element.decimals,
            },
          ],
        };
      }
      comps.push(comp);
    } else if (r.comptype === 'R') {
      throw new Error(`structure ${name}: component ${r.field} is a reference, which a cluster does not carry`);
    } else {
      cursor.i++;
      comps.push({
        name: r.field,
        kind: ComponentKind.Elementary,
        type: r.datatype,
        chars: r.leng,
        decimals: r.decimals,
      });
    }
  }
  return comps;
}
