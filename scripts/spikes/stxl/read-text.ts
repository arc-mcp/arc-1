/** Manual exact-key stored-text read. No helper creation, execution, or RFC calls. */
import { liveContext } from './live-client.js';
import { readStoredText, type TextKey } from './reader.js';
import { readStoredTextSql } from './sql-reader.js';

const context = liveContext();
const key = JSON.parse(process.env.STXL_TEXT_KEY ?? 'null') as TextKey | null;
if (!key || typeof key !== 'object' || Array.isArray(key)) {
  throw new Error('Set STXL_TEXT_KEY to JSON containing TDOBJECT, TDNAME, TDID, TDSPRAS');
}
const route = process.env.STXL_QUERY_ROUTE ?? 'table';
if (!['table', 'sql'].includes(route)) throw new Error('STXL_QUERY_ROUTE must be table or sql');
const read = route === 'sql' ? readStoredTextSql : readStoredText;
const { bytes: _bytes, ...result } = await read(context.client, key, process.env.TEST_SAP_CLIENT!);
await context.save('read-text.json', result);
process.stderr.write(
  `${JSON.stringify({ label: context.label, route, lines: result.lines.length, chunks: result.chunks })}\n`,
);
