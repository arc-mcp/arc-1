/** Positive public-prefix check using a private existing-text oracle; prints no names or bodies. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { liveContext } from './live-client.js';

assert.notEqual(process.env.STXL_ALLOW_FREE_SQL, 'true');
assert.notEqual(process.env.STXL_ALLOW_HELPERS, 'true');
const context = liveContext();
const oracle = JSON.parse(await readFile(resolve(context.output, `${context.label}-corpus-oracle.json`), 'utf8')) as {
  CASES: Array<{ TDOBJECT: string; TDNAME: string; TDID: string; TDSPRAS: string; STATUS: number }>;
};
const item = oracle.CASES.find((row) => row.STATUS === 0 && /^ {2}\S/u.test(row.TDNAME));
assert.ok(item, 'Private corpus has no successful existing key with two leading spaces');
const key = { object: item.TDOBJECT, name: item.TDNAME.replace(/ +$/u, ''), id: item.TDID, language: item.TDSPRAS };
const result = await context.call('SAPQuery', {
  action: 'long_text',
  longText: {
    mode: 'discover',
    object: key.object,
    namePrefix: key.name.slice(0, 5),
    id: key.id,
    language: key.language,
    limit: 50,
  },
});
await context.save('prefix-existing-result.json', result);
const payload = JSON.parse(result.content[0]!.text) as { candidates: Array<{ key: typeof key }> };
assert.ok(
  payload.candidates.some((row) => JSON.stringify(row.key) === JSON.stringify(key)),
  'Expected key not discovered',
);
const summary = {
  system: context.label,
  status: 'pass',
  positiveFieldMatch: true,
  freeSql: false,
  helperWrites: false,
};
await context.save('prefix-existing-summary.json', summary);
process.stderr.write(`${JSON.stringify(summary)}\n`);
