/**
 * Ties `./cluster.ts` (reads and joins the raw fragments), `./datacluster/`
 * (decodes them) and `./cluster-layout.ts` (names the fields) into what
 * SAPRead `type=CLUSTER_READ` answers.
 *
 * Ported from vibing-steampunk's `internal/mcp/handlers_cluster.go` (same
 * MIT license, same original author).
 */

import { type AppLogMessage, appLogMessagesFromCluster, appLogTexts } from './applog-messages.js';
import type { AdtClient } from './client.js';
import { type ClusterKeyValue, clusterRecordKeyString, readClusterRecords } from './cluster.js';
import {
  LAYOUT_APPLOG,
  LAYOUT_STXL,
  LayoutResolver,
  layoutSpecEmpty,
  layoutSpecFor,
  layoutSpecMode,
  parseLayoutSpec,
} from './cluster-layout.js';
import { type Field, objectRecords, parseCluster, sapScriptText, type TextLine } from './datacluster/index.js';

const NOTE_CLUSTER_NO_NAMES =
  "Field names are not in a cluster: the kernel writes types, not DDIC. Fields are numbered in order; lay the exporting program's structure over them.";
const NOTE_CLUSTER_CUT =
  'The row limit was reached; the last cluster was dropped rather than shown incomplete. Narrow where, or raise maxRows.';

export interface ClusterReadOptions {
  table: string;
  where?: Array<{ field: string; op: string; value?: string }>;
  /** "applog", "stxl", a DDIC structure name, or "OBJ=STRUCT,OBJ2=STRUCT2"; defaults to "stxl" for table STXL. */
  layout?: string;
  maxRows?: number;
  schemaOnly?: boolean;
  /** Language for APPLOG message texts (ISO code or SAP key); defaults to English. */
  lang?: string;
}

export interface ClusterReadObject {
  name: string;
  kind: string;
  layout?: string;
  rowLength: number;
  rowCount: number;
  fields: Field[];
  rows?: unknown[][];
  records?: Record<string, unknown>[];
}

export interface ClusterReadRecord {
  key: ClusterKeyValue[];
  fragments: number;
  bytes: number;
  compressed?: boolean;
  algorithm?: string;
  codepage?: string;
  objects?: ClusterReadObject[];
  messages?: AppLogMessage[];
  lines?: TextLine[];
  text?: string;
  notes?: string[];
  error?: string;
}

export interface ClusterReadResult {
  table: string;
  keyColumns: string[];
  records: ClusterReadRecord[];
  count: number;
  fragments: number;
  notes?: string[];
}

function appendUnique(notes: string[], note: string): string[] {
  return notes.includes(note) ? notes : [...notes, note];
}

export async function performClusterRead(client: AdtClient, opts: ClusterReadOptions): Promise<ClusterReadResult> {
  const table = opts.table.trim().toUpperCase();
  const spec = parseLayoutSpec((opts.layout ?? '').trim());
  if (layoutSpecEmpty(spec) && table === 'STXL') spec.default = LAYOUT_STXL;
  const mode = layoutSpecMode(spec);
  const resolver = new LayoutResolver(client);
  const maxRows = opts.maxRows && opts.maxRows > 0 ? opts.maxRows : 200;

  const res = await readClusterRecords(client, table, opts.where, maxRows);
  const out: ClusterReadResult = {
    table: res.table.name,
    keyColumns: res.table.keys,
    records: [],
    count: 0,
    fragments: res.fragments,
  };
  let notes: string[] = [];
  if (res.truncated) notes = appendUnique(notes, NOTE_CLUSTER_CUT);
  if (layoutSpecEmpty(spec) && !opts.schemaOnly) notes = appendUnique(notes, NOTE_CLUSTER_NO_NAMES);
  if (notes.length > 0) out.notes = notes;

  for (const rec of res.records) {
    const r: ClusterReadRecord = { key: rec.key, fragments: rec.parts, bytes: rec.blob.length };
    let cluster: ReturnType<typeof parseCluster>;
    try {
      cluster = parseCluster(rec.blob);
    } catch (err) {
      r.error = err instanceof Error ? err.message : String(err);
      out.records.push(r);
      continue;
    }
    r.compressed = cluster.compressed;
    r.algorithm = cluster.algorithm;
    r.codepage = cluster.codepage;

    if (mode === LAYOUT_APPLOG) {
      try {
        r.messages = appLogMessagesFromCluster(cluster);
        if (r.messages.length > 0) {
          try {
            await appLogTexts(client, opts.lang ?? 'EN', r.messages);
          } catch (err) {
            r.notes = appendUnique(
              r.notes ?? [],
              `Message texts could not be read from T100: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      } catch (err) {
        r.error = err instanceof Error ? err.message : String(err);
      }
    } else if (mode === LAYOUT_STXL) {
      try {
        const { lines, text } = sapScriptText(cluster);
        r.lines = lines;
        r.text = text;
      } catch (err) {
        r.error = err instanceof Error ? err.message : String(err);
      }
    } else {
      r.notes = await resolver.apply(cluster, spec);
      if (r.notes.length === 0) r.notes = undefined;
      r.objects = cluster.objects.map((obj) => {
        const o: ClusterReadObject = {
          name: obj.name,
          kind: obj.kind,
          rowLength: obj.rowLength,
          rowCount: obj.rows.length,
          fields: obj.fields,
        };
        if (obj.fields.length > 0 && obj.fields[0]!.name) {
          o.layout = layoutSpecFor(spec, obj.name);
          if (!opts.schemaOnly) o.records = objectRecords(obj);
        } else if (!opts.schemaOnly) {
          o.rows = obj.rows;
        }
        return o;
      });
    }
    out.records.push(r);
  }
  out.count = out.records.length;
  return out;
}

export { clusterRecordKeyString };
