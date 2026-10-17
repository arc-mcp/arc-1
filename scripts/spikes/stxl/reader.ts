/** Experimental stored-TLINE read. This deliberately does not promise READ_TEXT semantics. */
import type { AdtClient } from '../../../src/adt/client.js';
import { assembleChunks, keyFilters } from '../../../src/adt/stored-text/chunks.js';
import type { TextKey } from '../../../src/adt/stored-text/types.js';
import { decodeStxl } from './decoder.js';

export { assembleChunks, keyFilters } from '../../../src/adt/stored-text/chunks.js';
export type { TextKey } from '../../../src/adt/stored-text/types.js';

export async function readStoredText(client: Pick<AdtClient, 'runTableQuery'>, key: TextKey, sapClient: string) {
  const filters = [{ field: 'RELID', op: '=', value: 'TX' }, ...keyFilters(key)];
  const chunks: Record<string, string>[] = [];
  // A bounded SRTF2 window avoids response truncation and dependence on database ordering.
  for (let start = 0; start < 256; start += 32) {
    const data = await client.runTableQuery('STXL', {
      columns: ['MANDT', 'RELID', 'TDOBJECT', 'TDNAME', 'TDID', 'TDSPRAS', 'SRTF2', 'CLUSTR', 'CLUSTD'],
      where: [
        ...filters,
        { field: 'SRTF2', op: '>=', value: String(start) },
        { field: 'SRTF2', op: '<', value: String(start + 32) },
      ],
      maxRows: 33,
    });
    if (data.rows.length > 32 || data.rows.some((row) => Number(row.SRTF2) < start || Number(row.SRTF2) >= start + 32))
      throw new Error('STXL: invalid chunk window');
    chunks.push(...data.rows);
    if (data.rows.length < 32 || start === 224) {
      const bytes = assembleChunks(chunks, key, sapClient);
      return { ...(await decodeStxl(bytes)), chunks: chunks.length, compressedBytes: bytes.length, bytes };
    }
  }
  throw new Error('STXL: chunk request limit exceeded');
}
