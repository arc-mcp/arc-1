/** Explicit SQL-enabled research route for 816's SQL-line CONDENSE behavior. Never a fallback. */
import type { AdtClient } from '../../../src/adt/client.js';
import { quoteTableQueryValue } from '../../../src/adt/table-query.js';
import { readStoredText, type TextKey } from './reader.js';

/** SQL CONCAT trims operand padding; CONCAT_WITH_SPACE restores the exact requested gap. */
export function spacePreservingLiteral(value: string): string {
  return quoteTableQueryValue(value, true);
}

export async function readStoredTextSql(client: Pick<AdtClient, 'runQuery'>, key: TextKey, sapClient: string) {
  // Reuse the bounded identity/sequence/decoder pipeline, changing only the explicit query route.
  return readStoredText(
    {
      async runTableQuery(table, opts = {}) {
        if (table !== 'STXL') throw new Error('STXL: unexpected SQL source');
        const allowed = new Set(['RELID', 'TDOBJECT', 'TDNAME', 'TDID', 'TDSPRAS', 'SRTF2']);
        const clauses = (opts.where ?? []).map(({ field, op, value = '' }) => {
          if (!allowed.has(field) || !['=', '>=', '<'].includes(op)) throw new Error('STXL: unexpected SQL predicate');
          return `${field} ${op} ${spacePreservingLiteral(value)}`;
        });
        return client.runQuery(
          `SELECT MANDT, RELID, TDOBJECT, TDNAME, TDID, TDSPRAS, SRTF2, CLUSTR, CLUSTD FROM STXL WHERE ${clauses.join(' AND ')}`,
          opts.maxRows,
        );
      },
    },
    key,
    sapClient,
  );
}
