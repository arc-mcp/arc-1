import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeStxl } from './decoder.js';
import { liveContext, oracleJson } from './live-client.js';

const context = liveContext();
const source = await readFile(new URL('./legacy-corpus.abap', import.meta.url), 'utf8');
const output = oracleJson(await context.oracle(source));
await context.save('legacy-corpus-oracle.json', output);
const fixture = JSON.parse(output) as {
  CASES: Array<{
    NAME: string;
    STATUS: number;
    CHUNKS: number;
    COMPRESSED: string;
    EXPECTED: Array<{ TDFORMAT: string; TDLINE: string }>;
  }>;
};
const results = [];
for (const item of fixture.CASES) {
  if (item.STATUS !== 0) {
    results.push({ name: item.NAME, status: 'excluded', oracleStatus: item.STATUS });
    continue;
  }
  try {
    const decoded = await decodeStxl(Buffer.from(item.COMPRESSED, 'base64'));
    assert.deepEqual(
      decoded.lines,
      item.EXPECTED.map((line) => ({
        format: line.TDFORMAT.replace(/ +$/u, ''),
        text: line.TDLINE.replace(/ +$/u, ''),
      })),
    );
    results.push({
      name: item.NAME,
      status: 'pass',
      version: decoded.version,
      codePage: decoded.codePage,
      lines: decoded.lines.length,
      chunks: item.CHUNKS,
    });
  } catch (error) {
    results.push({
      name: item.NAME,
      status: 'fail',
      error: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
    });
    process.exitCode = 1;
  }
}
await context.save('legacy-corpus-checks.json', results);
process.stderr.write(`${JSON.stringify(results)}\n`);
