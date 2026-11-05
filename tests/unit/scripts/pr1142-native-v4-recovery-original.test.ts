import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { verifyOriginalV4Failure } from '../../../scripts/qualification/pr1142/native-declarative-v4-recovery-history.js';

const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
let state: string, expected: Record<string, string>, resultHash: string;
const original = 'arc1-qualification/pr1142-native-declarative-v4';
const audit = 'arc1-qualification/pr1142-native-declarative-v4-failure-audit.json';
const write = (name: string, body: string) => {
  mkdirSync(dirname(join(state, name)), { recursive: true, mode: 0o700 });
  writeFileSync(join(state, name), body, { mode: 0o600 });
};
const tree = (root = state): string =>
  readdirSync(root, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) =>
      entry.isDirectory()
        ? `${entry.name}/${tree(join(root, entry.name))}`
        : `${entry.name}:${hash(readFileSync(join(root, entry.name)))}`,
    )
    .join('|');
beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), 'arc1-v4-recovery-proof-'));
  chmodSync(state, 0o700);
  const ledger: Record<string, { bytes: number; sha256: string }> = {};
  for (let i = 0; i < 622; i++) {
    const name = i < 600 ? `attempt/run/${String(i + 1).padStart(5, '0')}.json` : `prerequisites/receipt-${i}.json`;
    const body = JSON.stringify({ fixture: i });
    write(`${original}/${name}`, body);
    ledger[name] = { bytes: Buffer.byteLength(body), sha256: hash(body) };
  }
  resultHash = hash('fixed failed result');
  write(audit, JSON.stringify({ resultHash, originalFiles: ledger }));
  write('arc1-review/inspection/metadata.xml', '<native-immutable/>');
  write('arc1-review/inspection/collector.mjs', '// captured offline collector');
  expected = Object.fromEntries(
    [audit, 'arc1-review/inspection/metadata.xml', 'arc1-review/inspection/collector.mjs'].map((name) => [
      name,
      hash(readFileSync(join(state, name))),
    ]),
  );
});
afterEach(() => rmSync(state, { recursive: true, force: true }));
it('checks exactly 622 original files and inspection bytes without changing them', () => {
  const before = tree();
  expect(() => verifyOriginalV4Failure(state, expected, resultHash)).not.toThrow();
  expect(tree()).toBe(before);
  expect(() => verifyOriginalV4Failure(state)).toThrow('recovery-original');
});
it.each([
  audit,
  `${original}/attempt/run/00001.json`,
  `${original}/attempt/run/00600.json`,
  `${original}/prerequisites/receipt-621.json`,
  'arc1-review/inspection/metadata.xml',
  'arc1-review/inspection/collector.mjs',
])('refuses changed evidence %s', (name) => {
  write(name, 'changed');
  expect(() => verifyOriginalV4Failure(state, expected, resultHash)).toThrow('recovery-original');
});
it.each([
  'missing',
  'extra',
  'linked-file',
  'linked-dir',
  'public-file',
  'public-dir',
  'result',
  'ledger-size',
  'traversal',
  'oversized',
])('refuses invalid proof %s', (fault) => {
  const name = `${original}/attempt/run/00001.json`,
    path = join(state, name);
  if (fault === 'missing') rmSync(path);
  if (fault === 'extra') write(`${original}/extra.json`, '{}');
  if (fault === 'linked-file') {
    rmSync(path);
    write('target.json', '{}');
    symlinkSync(join(state, 'target.json'), path);
  }
  if (fault === 'linked-dir') {
    rmSync(join(state, original, 'attempt/run'), { recursive: true });
    mkdirSync(join(state, 'elsewhere'), { mode: 0o700 });
    symlinkSync(join(state, 'elsewhere'), join(state, original, 'attempt/run'));
  }
  if (fault === 'public-file') chmodSync(path, 0o644);
  if (fault === 'public-dir') chmodSync(join(state, original, 'attempt/run'), 0o755);
  if (fault === 'result') resultHash = hash('different');
  if (fault === 'oversized') write(audit, 'x'.repeat(512 * 1024 + 1));
  if (fault === 'ledger-size' || fault === 'traversal') {
    const value = JSON.parse(readFileSync(join(state, audit), 'utf8'));
    if (fault === 'ledger-size') delete value.originalFiles['attempt/run/00001.json'];
    else {
      value.originalFiles['../escape.json'] = value.originalFiles['attempt/run/00001.json'];
      delete value.originalFiles['attempt/run/00001.json'];
    }
    write(audit, JSON.stringify(value));
    expected[audit] = hash(readFileSync(join(state, audit)));
  }
  expect(() => verifyOriginalV4Failure(state, expected, resultHash)).toThrow('recovery-original');
});
