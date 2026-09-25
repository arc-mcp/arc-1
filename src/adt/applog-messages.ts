/**
 * The messages of an application log (SLG1) live in BALDAT as one data
 * cluster per log handle. Inside, the BAL layer keeps them in buckets named
 * `T_abcd`: the first digit is the width class of the four message
 * variables (1 = 20 characters, 2 = 50), the second says whether a context
 * structure travels with the message, the third and fourth whether
 * parameters and a callback do. `T_MHDR` is the directory (message number to
 * bucket). Field names are not in the cluster; the layout below is
 * BAL_S_MSG's.
 *
 * Ported from vibing-steampunk's `pkg/adt/applog_messages.go` (same MIT
 * license, same original author); `AppLogMessages`/`ApplicationLog`
 * (BALHDR listing across many logs) are not ported — this module only
 * decodes messages already read out of one BALDAT cluster, which is what
 * SAPRead CLUSTER_READ's `layout="applog"` needs.
 */

import type { AdtClient } from './client.js';
import { type Cluster, parseCluster } from './datacluster/index.js';

/** One message of an application log. */
export interface AppLogMessage {
  /** The message's position in the log, from 000001. */
  number: string;
  /** A, E, W, I, S or X. */
  type: string;
  /** Message class. */
  id: string;
  /** Message number in the class. */
  no: string;
  /** Rendered from T100 with the variables substituted; empty when the class/number was not found or texts were not requested. */
  text?: string;
  v1?: string;
  v2?: string;
  v3?: string;
  v4?: string;
  /** 1-9, the nesting the log viewer draws as a tree. */
  detailLevel?: string;
  /** 1 (very important) to 4 (additional information). */
  problemClass?: string;
  sort?: string;
  /** UTC time stamp with microseconds, as written. */
  timestamp?: string;
  count?: number;
  context?: { table: string; value: string };
  params?: { name: string; value: string }[];
}

function str(v: unknown): string {
  if (v === undefined || v === null) return '';
  return typeof v === 'string' ? v : String(v);
}

/** Reads the messages out of one BALDAT cluster (already fetched and joined). */
export function decodeAppLogMessages(blob: Buffer): AppLogMessage[] {
  return appLogMessagesFromCluster(parseCluster(blob));
}

/** Same as `decodeAppLogMessages`, for a cluster the caller already parsed. */
export function appLogMessagesFromCluster(c: Cluster): AppLogMessage[] {
  const msgs: AppLogMessage[] = [];
  const params = new Map<string, { name: string; value: string }[]>();
  for (const obj of c.objects) {
    if (obj.name.startsWith('T_PAR')) {
      for (const row of obj.rows) {
        if (row.length < 4) continue;
        const n = str(row[0]);
        const list = params.get(n) ?? [];
        list.push({ name: str(row[2]), value: str(row[3]) });
        params.set(n, list);
      }
    } else if (obj.name.length === 6 && obj.name.startsWith('T_') && obj.name[2]! >= '0' && obj.name[2]! <= '9') {
      for (const row of obj.rows) {
        msgs.push(appLogMessageFromRow(obj.name, row));
      }
    }
  }
  for (const m of msgs) m.params = params.get(m.number);
  msgs.sort((a, b) => a.number.localeCompare(b.number));
  return msgs;
}

/** Lays BAL_S_MSG over a bucket row: the head is the message number and four variables; the tail is the eight fixed fields from type to count. */
function appLogMessageFromRow(bucket: string, row: unknown[]): AppLogMessage {
  const HEAD = 5;
  const TAIL = 8;
  if (row.length < HEAD + TAIL) {
    throw new Error(`${bucket}: message row has ${row.length} fields, BAL_S_MSG needs at least ${HEAD + TAIL}`);
  }
  const t = row.slice(row.length - TAIL);
  const m: AppLogMessage = {
    number: str(row[0]),
    v1: str(row[1]),
    v2: str(row[2]),
    v3: str(row[3]),
    v4: str(row[4]),
    type: str(t[0]),
    id: str(t[1]),
    no: str(t[2]),
    detailLevel: str(t[3]),
    problemClass: str(t[4]),
    sort: str(t[5]),
    timestamp: str(t[6]),
  };
  if (typeof t[7] === 'bigint') m.count = Number(t[7]);
  else if (typeof t[7] === 'number') m.count = t[7];
  const extra = row.slice(HEAD, row.length - TAIL);
  if (bucket[3] === '1' && extra.length >= 2) {
    m.context = { table: str(extra[0]), value: str(extra[1]) };
  }
  return m;
}

/** Maps an ISO 639-1 code to SAP's one-character language key (T100 is keyed by it). A one-character input is taken as already converted; an unknown code falls back to English. */
function spras(langIn: string): string {
  const lang = langIn.trim().toUpperCase();
  if (lang.length === 1) return lang;
  const table: Record<string, string> = {
    EN: 'E',
    DE: 'D',
    FR: 'F',
    ES: 'S',
    IT: 'I',
    PT: 'P',
    NL: 'N',
    RU: 'R',
    JA: 'J',
    ZH: '1',
    ZF: 'M',
    KO: '3',
    PL: 'L',
    CS: 'C',
    SK: 'Q',
    TR: 'T',
    SV: 'V',
    DA: 'K',
    FI: 'U',
    NO: 'O',
    HU: 'H',
    EL: 'G',
    UK: '8',
    AR: 'A',
    HE: 'B',
    TH: '2',
    RO: '4',
    HR: '6',
    SL: '5',
    BG: 'W',
    LT: 'X',
    LV: 'Y',
    ET: '9',
    SR: '0',
    CA: 'c',
    ID: 'i',
    MS: '7',
    VI: 'v',
    KK: 'k',
    AF: 'a',
  };
  return table[lang] ?? 'E';
}

/** Substitutes &1..&4 and bare & placeholders the way MESSAGE ... INTO does; && is an escaped literal &. */
function renderMessage(text: string, vars: string[]): string {
  let out = '';
  let next = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch !== '&') {
      out += ch;
      continue;
    }
    if (text[i + 1] === '&') {
      out += '&';
      i++;
      continue;
    }
    const digit = text[i + 1];
    if (digit && digit >= '1' && digit <= '4') {
      out += vars[Number(digit) - 1] ?? '';
      i++;
      continue;
    }
    if (next < vars.length) {
      out += vars[next] ?? '';
      next++;
    }
  }
  return out.replace(/ +$/, '');
}

/**
 * Fills `text` on every message from T100 in the given language (ISO code or SAP key),
 * substituting the variables. Missing texts are left empty; a lookup failure is thrown but the
 * caller may still use the messages without it.
 */
export async function appLogTexts(client: AdtClient, langIn: string, msgs: AppLogMessage[]): Promise<void> {
  const lang = spras(langIn);
  const byClass = new Map<string, Set<string>>();
  for (const m of msgs) {
    if (!m.id) continue;
    const set = byClass.get(m.id) ?? new Set<string>();
    set.add(m.no);
    byClass.set(m.id, set);
  }
  const texts = new Map<string, string>();
  for (const [cls, nos] of byClass) {
    const { rows } = await client.runTableQuery('T100', {
      columns: ['MSGNR', 'TEXT'],
      where: [
        { field: 'SPRSL', op: '=', value: lang },
        { field: 'ARBGB', op: '=', value: cls },
        { field: 'MSGNR', op: 'IN', value: [...nos].join(',') },
      ],
      maxRows: nos.size,
    });
    for (const row of rows) {
      texts.set(`${cls}\u0000${(row.MSGNR ?? '').trim()}`, row.TEXT ?? '');
    }
  }
  for (const m of msgs) {
    const t = texts.get(`${m.id}\u0000${m.no}`);
    if (t !== undefined) m.text = renderMessage(t, [m.v1 ?? '', m.v2 ?? '', m.v3 ?? '', m.v4 ?? '']);
  }
}
