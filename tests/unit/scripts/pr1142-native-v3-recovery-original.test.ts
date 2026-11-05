import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { verifyOriginalV3Failure } from '../../../scripts/qualification/pr1142/native-declarative-v3-recovery-prerequisites.js';

const sha = (body: string | Buffer) => createHash('sha256').update(body).digest('hex');
let root: string;
let hashes: Parameters<typeof verifyOriginalV3Failure>[1];
const sample = '0123456789ABCDEF';
const write = (path: string, body: string) => writeFileSync(join(root, path), body, { mode: 0o600 });
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'arc1-v3-original-'));
  chmodSync(root, 0o700);
  for (const directory of ['attempt', 'attempt/run', 'preflight', `preflight/${sample}`])
    mkdirSync(join(root, directory), { mode: 0o700 });
  write('intent.json', '{"fixture":"immutable intent"}');
  write('attempt/result.json', '{"failure":true}');
  const names = ['result.json', 'sm12-baseline.json', 'sm12-suffix.jpg', 'sm12-user.jpg'];
  for (const name of names) write(`preflight/${sample}/${name}`, `retained ${name}`);
  const manifest = JSON.stringify({
    preflightId: sample,
    prerequisites: names.map((name) => ({ name, sha256: sha(`retained ${name}`) })),
  });
  write('attempt/manifest.json', manifest);
  const rows = Array.from({ length: 95 }, (_, index) => {
    const name = `${String(index + 1).padStart(5, '0')}.json`,
      body = JSON.stringify({ value: index });
    write(`attempt/run/${name}`, body);
    return [name, sha(body)];
  });
  hashes = {
    intent: sha(readFileSync(join(root, 'intent.json'))),
    result: sha(readFileSync(join(root, 'attempt/result.json'))),
    manifest: sha(manifest),
    journal: sha(JSON.stringify(rows)),
  };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
it('validates every retained journal row and bound prerequisite without mutating the originals', () => {
  const before = readFileSync(join(root, 'attempt/manifest.json'));
  expect(() => verifyOriginalV3Failure(root, hashes)).not.toThrow();
  expect(readFileSync(join(root, 'attempt/manifest.json'))).toEqual(before);
  expect(() => verifyOriginalV3Failure(root)).toThrow(); // Fixture bytes cannot stand in for the exact real v3 failure.
});
it.each([
  'intent.json',
  'attempt/result.json',
  'attempt/manifest.json',
  'attempt/run/00001.json',
  'attempt/run/00095.json',
  `preflight/${sample}/result.json`,
  `preflight/${sample}/sm12-baseline.json`,
  `preflight/${sample}/sm12-user.jpg`,
])('refuses altered original %s', (path) => {
  write(path, 'changed');
  expect(() => verifyOriginalV3Failure(root, hashes)).toThrowError('recovery-original');
});
it.each(['missing-row', 'extra-row', 'linked-row', 'public-row', 'linked-directory'])(
  'refuses unsafe original layout %s',
  (fault) => {
    const path = join(root, 'attempt/run/00001.json');
    if (fault === 'missing-row') rmSync(path);
    if (fault === 'extra-row') write('attempt/run/00096.json', '{}');
    if (fault === 'linked-row') {
      const body = readFileSync(path);
      rmSync(path);
      write('target.json', body.toString());
      symlinkSync(join(root, 'target.json'), path);
    }
    if (fault === 'public-row') chmodSync(path, 0o644);
    if (fault === 'linked-directory') {
      rmSync(join(root, 'attempt/run'), { recursive: true });
      mkdirSync(join(root, 'elsewhere'), { mode: 0o700 });
      symlinkSync(join(root, 'elsewhere'), join(root, 'attempt/run'));
    }
    expect(() => verifyOriginalV3Failure(root, hashes)).toThrowError('recovery-original');
  },
);
