/**
 * Cluster tables — BALDAT, INDX, STXL and every table built like them — hold
 * data that ABAP wrote with `EXPORT ... TO DATABASE` and that only IMPORT
 * reads back. The table itself is ordinary: a key, a sequence number SRTF2,
 * a byte count CLUSTR and a RAW column CLUSTD, and ADT's data preview reads
 * all of them. What ADT will not do is decode CLUSTD, which is why this file
 * exists: it reads the fragments through `AdtClient.runTableQuery` (the same
 * server-built-SELECT path SAPRead TABLE_QUERY uses), joins them per key,
 * and hands the stream to `./datacluster/`.
 *
 * Ported from vibing-steampunk's `pkg/adt/cluster.go` (same MIT license,
 * same original author); adapted to ARC-1's structured-query client (`data`
 * scope, no free SQL) instead of a raw `WHERE` string.
 */

import type { AdtClient } from './client.js';
import { decodeHex, type Fragment, joinFragments } from './datacluster/index.js';

/** How a cluster table is keyed. */
export interface ClusterTableInfo {
  name: string;
  /** The client column, when the table has one. */
  client?: string;
  /** The columns that identify one cluster: the key without the client and without SRTF2, in table order. RELID is usually the first of them. */
  keys: string[];
}

/** One key column of a cluster record. */
export interface ClusterKeyValue {
  column: string;
  value: string;
}

/** One cluster key with its fragments joined: what one IMPORT would read. */
export interface ClusterRecord {
  key: ClusterKeyValue[];
  blob: Buffer;
  parts: number;
}

export interface ClusterRecordsResult {
  table: ClusterTableInfo;
  records: ClusterRecord[];
  /** How many database rows were read. */
  fragments: number;
  /** Set when the row limit was reached: the last record is then dropped rather than returned incomplete. */
  truncated: boolean;
}

export function clusterRecordKeyString(key: ClusterKeyValue[]): string {
  return key.map((kv) => `${kv.column}=${kv.value}`).join(', ');
}

function str(row: Record<string, string>, col: string): string {
  return (row[col] ?? '').trim();
}

/**
 * Reads a table's field list from DD03L and checks that it is a cluster table: keyed with SRTF2,
 * carrying CLUSTR and CLUSTD. DD03L rather than the DDL source, because a key that lives in an
 * include — LTDX keeps its whole key in one — is a line `include ltdxkey;` in the DDL and a row
 * per field in DD03L.
 */
export async function clusterTable(client: AdtClient, table: string): Promise<ClusterTableInfo> {
  const name = table.trim().toUpperCase();
  const { rows } = await client.runTableQuery('DD03L', {
    columns: ['FIELDNAME', 'KEYFLAG', 'ROLLNAME', 'DATATYPE'],
    where: [
      { field: 'TABNAME', op: '=', value: name },
      { field: 'AS4LOCAL', op: '=', value: 'A' },
    ],
    maxRows: 1000,
  });
  if (rows.length === 0) throw new Error(`${name} is not an active table in DDIC`);

  const info: ClusterTableInfo = { name, keys: [] };
  let hasSeq = false;
  let hasLen = false;
  let hasData = false;
  for (const row of rows) {
    const field = str(row, 'FIELDNAME');
    if (field.startsWith('.')) continue; // .INCLUDE / .APPEND markers; their fields follow
    if (field === 'SRTF2') {
      hasSeq = true;
      continue;
    }
    if (field === 'CLUSTR') {
      hasLen = true;
      continue;
    }
    if (field === 'CLUSTD') {
      hasData = true;
      continue;
    }
    if (str(row, 'KEYFLAG') !== 'X') continue;
    if (str(row, 'DATATYPE') === 'CLNT' || field === 'MANDT' || field === 'MANDANT' || field === 'CLIENT') {
      info.client = field;
      continue;
    }
    info.keys.push(field);
  }
  if (!hasSeq || !hasLen || !hasData) {
    throw new Error(`${name} is not a cluster table: it needs SRTF2, CLUSTR and CLUSTD columns`);
  }
  if (info.keys.length === 0) {
    throw new Error(`${name} has no key column besides the client and SRTF2`);
  }
  return info;
}

/**
 * Reads the fragments matching `where` (which may be empty) and joins them per key, in whatever
 * order the database returns them; fragments within a key are sorted by SRTF2 regardless of
 * retrieval order. `maxRows` caps the database rows read, not the clusters returned.
 *
 * `runTableQuery` never sends `ORDER BY` (the freestyle endpoint rejects it on NW 7.50/7.51), so
 * on a column-store backend a wide, unfiltered scan of a busy table can return a fragment's rows
 * out of key order — a HANA table scan is not guaranteed to preserve primary-key order the way a
 * row-store B-tree read does. When that happens, a key's fragments can land on opposite sides of
 * `maxRows`, and only the *last* group is dropped as possibly-truncated; a group cut elsewhere in
 * the scan instead surfaces as a per-record decode `error` (never silently wrong data — a joined
 * blob missing a fragment fails LZH decompression or the descriptor's length check). Live-verified
 * against BALDAT on an S/4HANA system: reading it unfiltered returned dozens of single-fragment
 * groups that each needed 2-3 fragments to decode, all erroring. Filtering `where` down to one key
 * (e.g. one `LOG_HANDLE`) reads that key's fragments in full regardless of scan order and decodes
 * cleanly; so does raising `maxRows` well past the table's total fragment count so nothing is cut.
 */
export async function readClusterRecords(
  client: AdtClient,
  table: string,
  where: Array<{ field: string; op: string; value?: string }> | undefined,
  maxRows: number,
): Promise<ClusterRecordsResult> {
  const info = await clusterTable(client, table);
  const limit = maxRows > 0 ? maxRows : 500;
  const columns = [...info.keys, 'SRTF2', 'CLUSTR', 'CLUSTD'];
  const { rows } = await client.runTableQuery(info.name, { columns, where, maxRows: limit });

  const truncated = rows.length >= limit;
  interface Group {
    key: ClusterKeyValue[];
    frags: Fragment[];
  }
  const byKey = new Map<string, Group>();
  const order: string[] = [];
  for (const row of rows) {
    const kv: ClusterKeyValue[] = info.keys.map((k) => ({ column: k, value: str(row, k) }));
    const key = kv.map((k) => k.value).join('\u0000');
    let g = byKey.get(key);
    if (!g) {
      g = { key: kv, frags: [] };
      byKey.set(key, g);
      order.push(key);
    }
    const seq = Number.parseInt(str(row, 'SRTF2'), 10) || 0;
    const length = Number.parseInt(str(row, 'CLUSTR'), 10) || 0;
    let data: Buffer;
    try {
      data = decodeHex(str(row, 'CLUSTD'));
    } catch (err) {
      throw new Error(
        `${info.name} ${clusterRecordKeyString(kv)} fragment ${seq}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    g.frags.push({ seq, length, data });
  }
  let keys = order;
  if (truncated && keys.length > 0) keys = keys.slice(0, -1);

  const records: ClusterRecord[] = [];
  for (const key of keys) {
    const g = byKey.get(key)!;
    let blob: Buffer;
    try {
      blob = joinFragments(g.frags);
    } catch (err) {
      throw new Error(
        `${info.name} ${clusterRecordKeyString(g.key)}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    records.push({ key: g.key, blob, parts: g.frags.length });
  }
  return { table: info, records, fragments: rows.length, truncated };
}
