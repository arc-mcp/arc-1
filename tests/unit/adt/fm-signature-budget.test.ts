import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('bounds malformed and valid parameter lines with long internal whitespace', () => {
  const url = new URL('../../../src/adt/fm-signature.ts', import.meta.url).href;
  const source = `
    import { parseFmSignature } from ${JSON.stringify(url)};
    const gap = ' '.repeat(200000);
    const rows = ['IV' + gap + 'INVALID I', 'VALUE(IV' + gap + ') TYPE I',
      'IV TYPE STRING' + gap + 'OPTIONAL', "IV TYPE STRING" + gap + "DEFAULT 'x'",
      ...['x\\ry', 'x\\u2028y', 'x\\u2029y'].map(tail => 'IV TYPE' + gap + tail)];
    const parsed = rows.map(row => parseFmSignature('FUNCTION Z_FM\\n IMPORTING\\n ' + row + '.\\nENDFUNCTION.').params);
    console.log(JSON.stringify(parsed));
  `;
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], {
    encoding: 'utf8',
    timeout: 8000,
    maxBuffer: 16384,
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  const parsed = JSON.parse(result.stdout);
  expect(parsed.map((row: unknown[]) => row.length)).toEqual([0, 1, 1, 1, 0, 0, 0]);
  expect(parsed[2][0].optional).toBe(true);
  expect(parsed[3][0].default).toBe("'x'");
}, 10000);
