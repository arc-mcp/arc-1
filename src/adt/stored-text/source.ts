/** Guarded ADT adapter for classic stored text; deliberately has no free-SQL route. */
import { createHash } from 'node:crypto';
import { generateRequestId, getCurrentContext, requestContext } from '../../server/context.js';
import type { AdtClient } from '../client.js';
import { AdtError, AdtNetworkError } from '../errors.js';
import { assembleChunks, keyFilters } from './chunks.js';
import { TextReadError } from './errors.js';
import { normalizeTextKey as canonicalKey } from './key.js';
import type { StoredTextHeader, StoredTextSource, TextDiscovery, TextKey } from './types.js';

type Row = Record<string, string>;
type QueryOptions = NonNullable<Parameters<AdtClient['runTableQuery']>[1]>;
const KEY_FIELDS = ['TDOBJECT', 'TDNAME', 'TDID', 'TDSPRAS'] as const;
const HEADER_COLUMNS = [
  'MANDT',
  ...KEY_FIELDS,
  'TDTITLE',
  'TDTEXTTYPE',
  'TDTXTLINES',
  'TDVERSION',
  'TDLDATE',
  'TDLTIME',
  'TDREF',
  'TDREFOBJ',
  'TDREFNAME',
  'TDREFID',
];
const CLUSTER_COLUMNS = ['MANDT', 'RELID', ...KEY_FIELDS, 'SRTF2', 'CLUSTR', 'CLUSTD'];
const MAX_REQUESTS = 120;
const WINDOW_SIZE = 32;
const COUNTER_COUNT = 256;
const SESSION_TIMEOUT_MS = 60_000;
const unpad = (value: string) => value.replace(/ +$/u, '');

function invalidKey(): never {
  throw new TextReadError('INVALID_KEY', 'invalid text key or discovery query');
}
function sameKey(left: TextKey, right: TextKey): boolean {
  return KEY_FIELDS.every((field) => left[field] === right[field]);
}
function corrupt(message: string): never {
  throw new TextReadError('CORRUPT_CLUSTER', message);
}
function cell(row: Row, field: string): string {
  if (typeof row[field] !== 'string') corrupt('missing or malformed stored metadata');
  return row[field];
}
function integer(row: Row, field: string): number {
  const value = cell(row, field);
  if (!/^\d+ *$/u.test(value) || !Number.isSafeInteger(Number(value))) corrupt('invalid stored metadata integer');
  return Number(value);
}
function rowKey(row: Row): TextKey {
  try {
    return canonicalKey(Object.fromEntries(KEY_FIELDS.map((field) => [field, cell(row, field)])) as unknown as TextKey);
  } catch {
    return corrupt('invalid stored text identity');
  }
}
function parseHeader(row: Row, sapClient: string, expected?: TextKey): StoredTextHeader {
  // Require all selected fields, including empty reference fields and the blank ITF text type.
  for (const field of HEADER_COLUMNS) cell(row, field);
  const key = rowKey(row);
  if (unpad(row.MANDT) !== sapClient || (expected && !sameKey(key, expected))) corrupt('header identity mismatch');
  const modifiedDate = unpad(row.TDLDATE);
  const modifiedTime = unpad(row.TDLTIME);
  if (!/^\d{8}$/u.test(modifiedDate) || !/^\d{6}$/u.test(modifiedTime)) corrupt('invalid stored modification metadata');
  const referenceFlag = unpad(row.TDREF);
  if (referenceFlag !== '' && referenceFlag !== 'X') corrupt('invalid stored reference flag');
  let reference: TextKey | undefined;
  const referenceParts = ['TDREFOBJ', 'TDREFNAME', 'TDREFID'].map((field) => unpad(row[field]));
  if (referenceFlag === 'X' && referenceParts.every(Boolean)) {
    try {
      reference = canonicalKey({
        TDOBJECT: referenceParts[0],
        TDNAME: referenceParts[1],
        TDID: referenceParts[2],
        TDSPRAS: key.TDSPRAS,
      });
    } catch {
      throw new TextReadError('REFERENCE_ERROR', 'invalid stored reference target');
    }
  }
  return {
    key,
    title: row.TDTITLE,
    textType: row.TDTEXTTYPE,
    storedLineCount: integer(row, 'TDTXTLINES'),
    version: integer(row, 'TDVERSION'),
    modifiedDate,
    modifiedTime,
    reference,
    legacyReference: referenceFlag === 'X' && !reference,
    revision: createHash('sha256')
      .update(JSON.stringify(HEADER_COLUMNS.map((field) => row[field])))
      .digest('hex'),
  };
}

/** One request-local budget/admission scope, identity, timeout, and configuration cache. */
export async function withStoredTextSession<T>(
  client: AdtClient,
  sapClient: string,
  fn: (source: StoredTextSource) => Promise<T>,
): Promise<T> {
  if (!/^\d{3}$/u.test(sapClient)) invalidKey();
  const inherited = getCurrentContext();
  const scope = inherited?.dataResultScope ?? client.createDataResultScope();
  const timeout = AbortSignal.timeout(SESSION_TIMEOUT_MS);
  const signal = inherited?.signal ? AbortSignal.any([inherited.signal, timeout]) : timeout;
  const context = {
    ...inherited,
    requestId: inherited?.requestId ?? generateRequestId(),
    signal,
    dataResultScope: scope,
  };
  let requests = 0;
  let closed = false;
  const config = new Map<string, Promise<Row>>();
  const checkSession = () => {
    if (closed || signal.aborted)
      throw new TextReadError('LIMIT_EXCEEDED', 'stored-text session ended or was cancelled');
  };
  async function query(table: string, opts: QueryOptions): Promise<Row[]> {
    checkSession();
    if (requests >= MAX_REQUESTS) throw new TextReadError('LIMIT_EXCEEDED', 'stored-text query request limit exceeded');
    requests++;
    try {
      const result = await client.runTableQuery(table, { ...opts, preserveLiteralSpaces: true });
      checkSession();
      if (!Array.isArray(result.rows) || result.rows.length > (opts.maxRows ?? 100)) corrupt('invalid query row count');
      if (
        result.rows.some(
          (row) =>
            !row ||
            typeof row !== 'object' ||
            Array.isArray(row) ||
            Object.values(row).some((value) => typeof value !== 'string'),
        )
      )
        corrupt('malformed stored query row');
      return result.rows;
    } catch (error) {
      checkSession();
      if (error instanceof TextReadError) throw error;
      if (error instanceof AdtError) throw error;
      throw new AdtNetworkError('stored-text query failed');
    }
  }
  async function configuration(table: string, columns: string[], where: QueryOptions['where']): Promise<Row> {
    const cacheKey = JSON.stringify([table, where]);
    let pending = config.get(cacheKey);
    if (!pending) {
      pending = query(table, { columns, where, maxRows: 2 }).then((rows) => {
        if (rows.length === 0) throw new TextReadError('INVALID_KEY', 'text object, ID, or language is not configured');
        if (rows.length !== 1)
          throw new TextReadError('UNSUPPORTED_PERSISTENCE', 'required text configuration is absent or ambiguous');
        for (const field of columns) {
          if (typeof rows[0][field] !== 'string')
            throw new TextReadError('UNSUPPORTED_PERSISTENCE', 'required text configuration metadata is unavailable');
        }
        return rows[0];
      });
      config.set(cacheKey, pending);
    }
    return pending;
  }
  const source: StoredTextSource = {
    async assertSupportedKey(requested) {
      checkSession();
      const key = canonicalKey(requested);
      const object = await configuration(
        'TTXOB',
        ['TDOBJECT', 'HANDLER_CLASS'],
        [{ field: 'TDOBJECT', op: '=', value: key.TDOBJECT }],
      );
      const id = await configuration(
        'TTXID',
        ['TDOBJECT', 'TDID', 'HANDLER_CLASS'],
        [
          { field: 'TDOBJECT', op: '=', value: key.TDOBJECT },
          { field: 'TDID', op: '=', value: key.TDID },
        ],
      );
      const language = await configuration('T002', ['SPRAS'], [{ field: 'SPRAS', op: '=', value: key.TDSPRAS }]);
      if (
        unpad(object.TDOBJECT) !== key.TDOBJECT ||
        unpad(id.TDOBJECT) !== key.TDOBJECT ||
        unpad(id.TDID) !== key.TDID ||
        unpad(language.SPRAS) !== key.TDSPRAS
      )
        throw new TextReadError('UNSUPPORTED_PERSISTENCE', 'text configuration identity mismatch');
      const handler = unpad(id.HANDLER_CLASS) || unpad(object.HANDLER_CLASS) || 'CL_RSTXT_DEFAULT_PERSISTENCE';
      if (handler !== 'CL_RSTXT_DEFAULT_PERSISTENCE')
        throw new TextReadError('UNSUPPORTED_PERSISTENCE', 'text uses an unsupported persistence handler');
    },
    async readHeader(requested) {
      const key = canonicalKey(requested);
      const rows = await query('STXH', { columns: HEADER_COLUMNS, where: keyFilters(key), maxRows: 2 });
      if (rows.length > 1) corrupt('duplicate stored text headers');
      return rows.length ? parseHeader(rows[0], sapClient, key) : undefined;
    },
    async readCluster(requested) {
      const key = canonicalKey(requested);
      const chunks: Row[] = [];
      for (let start = 0; start < COUNTER_COUNT; start += WINDOW_SIZE) {
        const rows = await query('STXL', {
          columns: CLUSTER_COLUMNS,
          where: [
            { field: 'RELID', op: '=', value: 'TX' },
            ...keyFilters(key),
            { field: 'SRTF2', op: '>=', value: String(start) },
            { field: 'SRTF2', op: '<', value: String(start + WINDOW_SIZE) },
          ],
          maxRows: WINDOW_SIZE + 1,
        });
        if (start === 0 && rows.length === 0) return undefined;
        if (
          rows.length > WINDOW_SIZE ||
          rows.some((row) => {
            const index = integer(row, 'SRTF2');
            return index < start || index >= start + WINDOW_SIZE;
          })
        )
          corrupt('invalid chunk window');
        chunks.push(
          ...rows.map((row) =>
            Object.fromEntries(
              Object.entries(row).map(([field, value]) => [
                field,
                ['MANDT', 'RELID', ...KEY_FIELDS].includes(field) ? unpad(cell(row, field)) : value,
              ]),
            ),
          ),
        );
        if (rows.length < WINDOW_SIZE || start + WINDOW_SIZE === COUNTER_COUNT) {
          try {
            return assembleChunks(chunks, key, sapClient);
          } catch {
            return corrupt('invalid stored chunk identity, length, or sequence');
          }
        }
      }
      throw new TextReadError('LIMIT_EXCEEDED', 'stored-text chunk request limit exceeded');
    },
    async discover(input: TextDiscovery) {
      // A prefix is not a fixed-width identity: even a nonempty spaces-only prefix is meaningful.
      if (
        !input ||
        typeof input.namePrefix !== 'string' ||
        input.namePrefix.length < 1 ||
        input.namePrefix.length > 70 ||
        /\p{Surrogate}/u.test(input.namePrefix) ||
        Array.from(input.namePrefix).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
      )
        invalidKey();
      const probe = canonicalKey({
        TDOBJECT: input.object,
        TDNAME: 'DISCOVERY',
        TDID: input.id === undefined ? 'ST' : input.id,
        TDSPRAS: input.language === undefined ? 'E' : input.language,
      });
      const limit = input.limit === undefined ? 20 : input.limit;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) invalidKey();
      // Prefix whitespace is meaningful even though fixed-width exact identities ignore padding.
      probe.TDNAME = input.namePrefix;
      const where = [
        { field: 'TDOBJECT', op: '=', value: probe.TDOBJECT },
        { field: 'TDNAME', op: 'STARTS_WITH', value: probe.TDNAME },
        ...(input.id === undefined ? [] : [{ field: 'TDID', op: '=', value: probe.TDID }]),
        ...(input.language === undefined ? [] : [{ field: 'TDSPRAS', op: '=', value: probe.TDSPRAS }]),
      ];
      const rows = await query('STXH', { columns: HEADER_COLUMNS, where, maxRows: limit + 1 });
      const headers = rows.map((row) => parseHeader(row, sapClient));
      if (
        new Set(headers.map(({ key }) => JSON.stringify(KEY_FIELDS.map((field) => key[field])))).size !== headers.length
      )
        corrupt('duplicate discovered text identity');
      if (
        headers.some(
          ({ key }) =>
            key.TDOBJECT !== probe.TDOBJECT ||
            !key.TDNAME.startsWith(probe.TDNAME) ||
            (input.id !== undefined && key.TDID !== probe.TDID) ||
            (input.language !== undefined && key.TDSPRAS !== probe.TDSPRAS),
        )
      )
        corrupt('discovery identity mismatch');
      headers.sort((a, b) => {
        const left = JSON.stringify(KEY_FIELDS.map((field) => a.key[field]));
        const right = JSON.stringify(KEY_FIELDS.map((field) => b.key[field]));
        return left < right ? -1 : left > right ? 1 : 0;
      });
      return { headers: headers.slice(0, limit), more: rows.length > limit };
    },
  };
  try {
    const result = await requestContext.run(context, () => fn(source));
    checkSession();
    return result;
  } finally {
    closed = true;
    if (!inherited?.dataResultScope) scope.release();
  }
}
