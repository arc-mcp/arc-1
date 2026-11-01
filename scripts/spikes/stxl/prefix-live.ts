/** Read-only syntax qualification for literal-prefix SQL on supported SAP releases. */
import assert from 'node:assert/strict';
import { liveContext } from './live-client.js';

if (process.env.STXL_ALLOW_HELPERS === 'true' || process.env.STXL_ALLOW_FREE_SQL === 'true')
  throw new Error('Prefix qualification requires helper writes and free SQL disabled');
const context = liveContext();
assert.ok(['758', '816'].includes(context.label), 'Unqualified target');
const runId = `prefix-${Date.now()}`;
const cases = [
  { label: 'internal-spaces', prefix: 'ZARC1  PREFIX' },
  { label: 'leading-spaces', prefix: '  ZARC1_PREFIX' },
  { label: 'trailing-spaces', prefix: 'ZARC1  ' },
  { label: 'spaces-and-metacharacters', prefix: "  ZARC1  _%#'" },
  { label: 'many-gaps', prefix: '  A  B  C  D  E  F  G  H  I  J  K  L  M  N  O  P  Q  R  S  T  U  V' },
  { label: 'spaces-only', prefix: '  ' },
];
const stages: Array<{ label: string; status: string; matches: number }> = [];
try {
  for (const item of cases) {
    const result = await context.call('SAPQuery', {
      action: 'long_text',
      longText: { mode: 'discover', object: 'TEXT', namePrefix: item.prefix, limit: 2 },
    });
    await context.save(`${runId}-${item.label}.json`, result);
    const payload = JSON.parse(result.content[0]!.text) as {
      mode: string;
      candidates: Array<{ key: { name: string } }>;
    };
    assert.equal(payload.mode, 'discover');
    assert.ok(payload.candidates.every(({ key }) => key.name.startsWith(item.prefix)));
    stages.push({ label: item.label, status: 'pass', matches: payload.candidates.length });
  }
  const summary = {
    system: context.label,
    status: 'pass',
    readonly: true,
    freeSql: false,
    helperWrites: false,
    qualification: 'SQL acceptance and returned-prefix validation; empty results do not prove positive matching',
    stages,
  };
  await context.save('prefix-latest-summary.json', summary);
  process.stderr.write(`${JSON.stringify(summary)}\n`);
} catch (error) {
  await context.save(`${runId}-failure.json`, { message: String(error), stages });
  throw new Error('Prefix qualification failed; inspect private artifacts');
}
