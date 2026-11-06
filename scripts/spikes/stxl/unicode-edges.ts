import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeStxl } from './decoder.js';
import { liveContext, oracleJson } from './live-client.js';

const context = liveContext();
const source = await readFile(new URL('./unicode-edges.abap', import.meta.url), 'utf8');
const output =
  process.env.STXL_REUSE_ORACLE === 'true'
    ? await readFile(join(context.output, `${context.label}-unicode-edges.json`), 'utf8')
    : oracleJson(await context.oracle(source));
await context.save('unicode-edges.json', output);
const fixture = JSON.parse(output) as {
  CASES: Array<{ NAME: string; COMPRESSED: string; PLAIN: string; EXPECTED_RAW: string[] }>;
};
const checks = [];
for (const sample of fixture.CASES) {
  for (const mode of ['COMPRESSED', 'PLAIN'] as const) {
    const decoded = await decodeStxl(Buffer.from(sample[mode], 'base64'));
    assert.equal(decoded.lines.length, sample.EXPECTED_RAW.length);
    for (const [index, line] of decoded.lines.entries()) {
      const raw = Buffer.from(line.format.padEnd(2, ' ') + line.text.padEnd(132, ' '), 'utf16le');
      assert.deepEqual(raw, Buffer.from(sample.EXPECTED_RAW[index], 'base64'));
    }
    assert.equal(decoded.wellFormedUnicode, sample.NAME !== 'unicode-edge-1');
    checks.push({ name: sample.NAME, mode, status: 'pass', wellFormedUnicode: decoded.wellFormedUnicode });
  }
}
await context.save('unicode-edges-checks.json', checks);
process.stderr.write(`${JSON.stringify({ label: context.label, passed: checks.length })}\n`);
