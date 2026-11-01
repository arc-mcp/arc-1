/** Classic persisted ITF semantics. No SQL, credentials, RFC, text-memory or rendering. */
import { createHash } from 'node:crypto';
import { type DecodedText, decodeStxl, type TextLine } from './decoder.js';
import { TextReadError, type TextReadErrorCode } from './errors.js';
import { normalizeTextKey } from './key.js';
import type { StoredTextHeader, StoredTextSource, TextKey } from './types.js';

export { normalizeTextKey } from './key.js';

const MAX_REFERENCE_HOPS = 8;
const MAX_BATCH_KEYS = 25;
const MAX_BATCH_LINES = 10_000;
const MAX_BATCH_JSON_BYTES = 2 * 1024 * 1024;

const keyId = (key: TextKey) => JSON.stringify([key.TDOBJECT, key.TDNAME, key.TDID, key.TDSPRAS]);
const fingerprint = (bytes: Buffer | undefined) =>
  bytes === undefined ? 'absent' : createHash('sha256').update(bytes).digest('hex');

export interface ClassicTextResult {
  requestedKey: TextKey;
  resolvedKey: TextKey;
  header: StoredTextHeader;
  referenceChain: TextKey[];
  lines: TextLine[];
  lineCount: number;
  storage: {
    kind: 'classic-stxh-stxl';
    clusterPresent: boolean;
    consistency: 'reread-matched';
    /** A matching reread is change detection, not a transactional snapshot. */
    snapshotGuaranteed: false;
    codec?: Omit<DecodedText, 'lines'>;
  };
  warnings: Array<'STORED_LINE_COUNT_DIFFERS' | 'LONE_SURROGATE' | 'ITF_COMMANDS_PRESENT'>;
}

/** Resolve exact, same-language stored references, then verify headers and bytes by rereading. */
export async function readClassicText(source: StoredTextSource, input: unknown): Promise<ClassicTextResult> {
  const requestedKey = normalizeTextKey(input);
  let key = requestedKey;
  const headers: StoredTextHeader[] = [];
  const visited = new Set<string>();
  for (;;) {
    if (visited.has(keyId(key))) throw new TextReadError('REFERENCE_CYCLE', 'stored reference cycle');
    visited.add(keyId(key));
    try {
      await source.assertSupportedKey(key);
    } catch (error) {
      if (headers.length && error instanceof TextReadError && error.code === 'INVALID_KEY')
        throw new TextReadError('REFERENCE_ERROR', 'reference target has an invalid configured key');
      throw error;
    }
    const header = await source.readHeader(key);
    if (!header)
      throw new TextReadError(
        headers.length ? 'REFERENCE_ERROR' : 'NOT_FOUND',
        headers.length ? 'reference target has no classic stored header' : 'no header in classic storage',
      );
    if (header.textType.replace(/ +$/u, ''))
      throw new TextReadError('NON_ITF_TEXT', 'non-ITF text requires a different storage reader');
    if (header.legacyReference)
      throw new TextReadError('UNSUPPORTED_PROFILE', 'legacy or incomplete reference metadata requires ITCRF support');
    headers.push(header);
    if (!header.reference) break;
    if (headers.length > MAX_REFERENCE_HOPS)
      throw new TextReadError('REFERENCE_LIMIT', 'stored reference hop limit exceeded');
    key = normalizeTextKey(header.reference);
    if (key.TDSPRAS !== requestedKey.TDSPRAS)
      throw new TextReadError('REFERENCE_ERROR', 'stored references must retain the requested language');
  }

  const bytes = await source.readCluster(key);
  const decoded = bytes === undefined ? undefined : await decodeStxl(bytes);
  // A count alone is insufficient: references and valid header-only texts can have stale counts.
  for (const original of headers) {
    const current = await source.readHeader(original.key);
    if (!current || current.revision !== original.revision)
      throw new TextReadError('INCONSISTENT_READ', 'stored header changed during the read; retry the exact key');
  }
  if (fingerprint(await source.readCluster(key)) !== fingerprint(bytes))
    throw new TextReadError('INCONSISTENT_READ', 'stored chunks changed during the read; retry the exact key');

  const lines = decoded?.lines ?? [];
  const warnings: ClassicTextResult['warnings'] = [];
  if (headers[headers.length - 1].storedLineCount !== lines.length) warnings.push('STORED_LINE_COUNT_DIFFERS');
  if (decoded && !decoded.wellFormedUnicode) warnings.push('LONE_SURROGATE');
  if (lines.some((line) => line.format === '/:')) warnings.push('ITF_COMMANDS_PRESENT');
  const codec = decoded ? (({ lines: _lines, ...details }) => details)(decoded) : undefined;
  return {
    requestedKey,
    resolvedKey: key,
    header: headers[0],
    referenceChain: headers.map((header) => header.key),
    lines,
    lineCount: lines.length,
    storage: {
      kind: 'classic-stxh-stxl',
      clusterPresent: bytes !== undefined,
      consistency: 'reread-matched',
      snapshotGuaranteed: false,
      codec,
    },
    warnings,
  };
}

export type ClassicTextBatchItem =
  | { index: number; status: 'ok'; text: ClassicTextResult }
  | { index: number; status: 'error'; key?: TextKey; error: { code: TextReadErrorCode; message: string } };

/** Preserve input order/duplicates; isolate semantic failures, but abort on infrastructure or budget errors. */
export async function readClassicTextBatch(
  source: StoredTextSource,
  inputs: unknown[],
): Promise<ClassicTextBatchItem[]> {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > MAX_BATCH_KEYS)
    throw new TextReadError('LIMIT_EXCEEDED', `batch must contain 1–${MAX_BATCH_KEYS} exact keys`);
  const completed = new Map<string, ClassicTextBatchItem>();
  const results: ClassicTextBatchItem[] = [];
  let totalLines = 0;
  let totalBytes = 2; // JSON array brackets.
  for (const [index, input] of inputs.entries()) {
    let key: TextKey | undefined;
    let item: ClassicTextBatchItem;
    try {
      key = normalizeTextKey(input);
      const previous = completed.get(keyId(key));
      item = previous ? { ...previous, index } : { index, status: 'ok', text: await readClassicText(source, key) };
    } catch (error) {
      if (!(error instanceof TextReadError) || error.code === 'LIMIT_EXCEEDED') throw error;
      item = { index, status: 'error', key, error: { code: error.code, message: error.message } };
    }
    if (key) completed.set(keyId(key), item);
    totalLines += item.status === 'ok' ? item.text.lineCount : 0;
    totalBytes += Buffer.byteLength(JSON.stringify(item)) + (index > 0 ? 1 : 0);
    if (totalLines > MAX_BATCH_LINES || totalBytes > MAX_BATCH_JSON_BYTES)
      throw new TextReadError('LIMIT_EXCEEDED', 'batch decoded result budget exceeded; request fewer texts');
    results.push(item);
  }
  return results;
}

/** Literal search of an already bounded batch; includes ITF command lines, no rendering or global scan. */
export function findTextMatches(items: ClassicTextBatchItem[], phrase: string) {
  if (!Array.isArray(items) || items.length > MAX_BATCH_KEYS)
    throw new TextReadError('LIMIT_EXCEEDED', 'search must use a bounded text batch');
  if (typeof phrase !== 'string' || !phrase.length || phrase.length > 200)
    throw new TextReadError('INVALID_KEY', 'search phrase must contain 1–200 characters');
  const matches: Array<{ index: number; key: TextKey; lineNumber: number; format: string; text: string }> = [];
  let truncated = false;
  let scanned = 0;
  for (const item of items) {
    if (item.status !== 'ok') continue;
    for (const [lineIndex, line] of item.text.lines.entries()) {
      if (++scanned > MAX_BATCH_LINES) throw new TextReadError('LIMIT_EXCEEDED', 'search line budget exceeded');
      if (!line.text.includes(phrase)) continue;
      if (matches.length === 50) {
        truncated = true;
        break;
      }
      matches.push({ index: item.index, key: item.text.requestedKey, lineNumber: lineIndex + 1, ...line });
    }
    if (truncated) break;
  }
  return { matches, truncated, caseSensitive: true, scope: 'supplied-batch-only' as const };
}
