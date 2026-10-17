/** Research-only SQL oracle for prefix predicates; never used by the runtime reader. */
import assert from 'node:assert/strict';
import { buildTableQuerySql, quoteTableQueryValue } from '../../../src/adt/table-query.js';
import { liveContext } from './live-client.js';

assert.equal(process.env.STXL_ALLOW_FREE_SQL, 'true', 'Explicit research SQL opt-in required');
assert.notEqual(process.env.STXL_ALLOW_HELPERS, 'true');
const context = liveContext();
const inputs = [
  ['A  BC', 'A  B', true],
  ['A BC', 'A  B', false],
  ['  ABC', '  A', true],
  [' ABC', '  A', false],
  ['A  B', 'A  ', true],
  ['A', 'A  ', false],
  ["  A  _%#'B", "  A  _%#'", true],
  ['  A  _%#B', "  A  _%#'", false],
] as const;
const results: Array<{ index: number; expected: boolean; actual?: boolean; error?: string }> = [];
for (const [index, [name, prefix, expected]] of inputs.entries()) {
  // A short constant needs TDNAME's field width to exercise the blank-padding guard. Other
  // constants already cover the requested slice; avoid expanding a cast at every occurrence.
  const literal = quoteTableQueryValue(name, true);
  const field = name.length < prefix.length ? `cast( ${literal} as char( 70 ) )` : literal;
  const predicate = buildTableQuerySql('T000', ['MANDT'], [{ field: 'TDNAME', op: 'STARTS_WITH', value: prefix }], true)
    .split(' WHERE ')[1]!
    .replaceAll('TDNAME', field);
  try {
    const result = await context.client.runQuery(`SELECT mandt FROM t000 WHERE ${predicate}`, 1);
    results.push({ index, expected, actual: result.rows.length === 1 });
  } catch (error) {
    results.push({ index, expected, error: String(error) });
  }
}
await context.save('prefix-expressions-latest.json', results);
process.stderr.write(`${JSON.stringify({ system: context.label, results })}\n`);
assert.ok(
  results.every((result) => result.actual === result.expected),
  'Synthetic prefix comparison failed',
);
