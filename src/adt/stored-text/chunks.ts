/** Assemble bounded STXL storage rows; decoding and SAP access live in separate modules. */
import { DEFAULT_LIMITS } from './decoder.js';
import { TextReadError } from './errors.js';
import type { TextKey } from './types.js';

const keyLengths = { TDOBJECT: 10, TDNAME: 70, TDID: 4, TDSPRAS: 1 } as const;
export function keyFilters(key: TextKey) {
  return Object.entries(keyLengths).map(([name, length]) => {
    const value = key[name as keyof TextKey];
    if (
      typeof value !== 'string' ||
      !value.length ||
      value.length > length ||
      Array.from(value).some((char) => char.charCodeAt(0) < 32)
    ) {
      throw new TextReadError('INVALID_KEY', `invalid ${name}`);
    }
    return { field: name, op: '=', value };
  });
}

export function assembleChunks(rows: Record<string, string>[], key: TextKey, client: string): Buffer {
  keyFilters(key);
  if (!/^\d{3}$/.test(client)) throw new TextReadError('INVALID_KEY', 'invalid client');
  if (!rows.length || rows.length > 256) throw new TextReadError('CORRUPT_CLUSTER', 'missing or excessive chunks');
  const chunks = rows
    .map((row) => {
      if (
        row.MANDT !== client ||
        row.RELID !== 'TX' ||
        Object.keys(keyLengths).some((name) => row[name] !== key[name as keyof TextKey])
      )
        throw new TextReadError('CORRUPT_CLUSTER', 'chunk identity mismatch');
      if (!/^\d+ *$/.test(row.SRTF2) || !/^\d+ *$/.test(row.CLUSTR))
        throw new TextReadError('CORRUPT_CLUSTER', 'invalid chunk integer');
      const index = Number(row.SRTF2);
      const length = Number(row.CLUSTR);
      if (
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index > 255 ||
        length < 1 ||
        length > 7902 ||
        !/^[\da-f]{15804}$/iu.test(row.CLUSTD)
      )
        throw new TextReadError('CORRUPT_CLUSTER', 'invalid or truncated binary chunk');
      return { index, data: Buffer.from(row.CLUSTD.slice(0, length * 2), 'hex') };
    })
    .sort((a, b) => a.index - b.index);
  let total = 0;
  for (const [index, chunk] of chunks.entries()) {
    if (chunk.index !== index) throw new TextReadError('CORRUPT_CLUSTER', 'missing or duplicate chunk sequence');
    if (index < chunks.length - 1 && chunk.data.length !== 7902)
      throw new TextReadError('CORRUPT_CLUSTER', 'short intermediate chunk');
    total += chunk.data.length;
    if (total > DEFAULT_LIMITS.maxInputBytes)
      throw new TextReadError('LIMIT_EXCEEDED', 'compressed input limit exceeded');
  }
  return Buffer.concat(
    chunks.map((chunk) => chunk.data),
    total,
  );
}
