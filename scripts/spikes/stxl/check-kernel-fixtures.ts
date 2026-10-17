import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { decodeStxl } from './decoder.js';

const path = process.argv[2];
if (!path) throw new Error('Usage: check-kernel-fixtures.ts <kernel-fixtures-output.txt>');
const fixture = JSON.parse(await readFile(path, 'utf8')) as {
  CASES: Array<{
    NAME: string;
    COMPRESSED: string;
    PLAIN: string;
    EXPECTED: Array<{ TDFORMAT: string; TDLINE: string }>;
  }>;
};
const results = [];
for (const item of fixture.CASES) {
  for (const mode of ['COMPRESSED', 'PLAIN'] as const) {
    const started = performance.now();
    try {
      const decoded = await decodeStxl(Buffer.from(item[mode], 'base64'));
      assert.deepEqual(
        decoded.lines,
        item.EXPECTED.map((line) => ({
          format: line.TDFORMAT.replace(/ +$/u, ''),
          text: line.TDLINE.replace(/ +$/u, ''),
        })),
      );
      results.push({
        name: item.NAME,
        mode,
        status: 'pass',
        lines: decoded.lines.length,
        bytes: decoded.outputBytes,
        ms: performance.now() - started,
      });
    } catch (error) {
      results.push({
        name: item.NAME,
        mode,
        status: 'fail',
        error: error instanceof Error ? error.message.slice(0, 400) : 'unknown',
      });
      process.exitCode = 1;
    }
  }
}
await writeFile(path.replace('-output.txt', '-checks.json'), JSON.stringify(results, null, 2), { mode: 0o600 });
process.stderr.write(`${JSON.stringify(results, null, 2)}\n`);
