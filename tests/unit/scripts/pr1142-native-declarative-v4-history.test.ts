import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { declarativeV4Fixtures } from '../../../scripts/qualification/pr1142/native-declarative-fixtures.js';
import {
  type DeclarativeHistoryEvidence,
  declarativeV4HistoryEvidence,
  verifyDeclarativeV4History,
} from '../../../scripts/qualification/pr1142/native-declarative-v4-history.js';

let parent: string, expected: DeclarativeHistoryEvidence;
const hash = (body: string | Buffer) => createHash('sha256').update(body).digest('hex');
beforeEach(() => {
  parent = mkdtempSync(join(tmpdir(), 'arc1-v4-history-'));
  mkdirSync(join(parent, 'failed/run'), { recursive: true, mode: 0o700 });
  mkdirSync(join(parent, 'recovery'), { mode: 0o700 });
  const files: Record<string, string> = {};
  for (const [name, body] of [
    ['failed/result.json', '{"failure":true}'],
    ['recovery/result.json', '{"failure":false}'],
  ]) {
    writeFileSync(join(parent, name), body, { mode: 0o600 });
    files[name] = hash(body);
  }
  const rows = Array.from({ length: 3 }, (_, i) => {
    const name = `${String(i + 1).padStart(5, '0')}.json`,
      body = JSON.stringify({ row: i });
    writeFileSync(join(parent, 'failed/run', name), body, { mode: 0o600 });
    return [name, hash(body)];
  });
  expected = {
    files,
    journals: [{ path: 'failed/run', count: 3, sha256: hash(JSON.stringify(rows)) }],
    absent: ['failed/manifest.json'],
  };
});
afterEach(() => rmSync(parent, { recursive: true, force: true }));
it('verifies separate failure/recovery bindings and exact journal order without modifying proof', () => {
  const before = readFileSync(join(parent, 'failed/result.json'));
  expect(() => verifyDeclarativeV4History(parent, expected)).not.toThrow();
  expect(readFileSync(join(parent, 'failed/result.json'))).toEqual(before);
});
it.each([
  'changed-result',
  'missing-result',
  'linked-result',
  'public-result',
  'linked-directory',
  'public-directory',
  'changed-row',
  'missing-row',
  'extra-row',
  'new-manifest',
  'dangling-manifest',
  'invalid-count',
  'traversal',
])('refuses %s, even after an earlier successful check', (change) => {
  verifyDeclarativeV4History(parent, expected);
  const result = join(parent, 'failed/result.json'),
    journal = join(parent, 'failed/run');
  if (change === 'changed-result') writeFileSync(result, 'changed');
  if (change === 'missing-result') rmSync(result);
  if (change === 'linked-result') {
    rmSync(result);
    symlinkSync(join(parent, 'recovery/result.json'), result);
  }
  if (change === 'public-result') chmodSync(result, 0o644);
  if (change === 'linked-directory') {
    rmSync(journal, { recursive: true });
    symlinkSync(join(parent, 'recovery'), journal);
  }
  if (change === 'public-directory') chmodSync(journal, 0o755);
  if (change === 'changed-row') writeFileSync(join(journal, '00003.json'), 'changed');
  if (change === 'missing-row') rmSync(join(journal, '00003.json'));
  if (change === 'extra-row') writeFileSync(join(journal, '00004.json'), '{}', { mode: 0o600 });
  if (change === 'new-manifest') writeFileSync(join(parent, 'failed/manifest.json'), '{}', { mode: 0o600 });
  if (change === 'dangling-manifest') symlinkSync(join(parent, 'missing'), join(parent, 'failed/manifest.json'));
  if (change === 'invalid-count') expected = { ...expected, journals: [{ ...expected.journals[0], count: 101 }] };
  if (change === 'traversal') expected = { ...expected, files: { '../other': hash('anything') } };
  expect(() => verifyDeclarativeV4History(parent, expected)).toThrow('v4-history');
});
it('binds identical recovery result bytes to different original manifests and consumed journals', () => {
  const files = declarativeV4HistoryEvidence.files;
  expect(files['pr1142-native-declarative-recovery-v1/result.json']).toBe(
    files['pr1142-native-declarative-v3-recovery-v1/attempt/result.json'],
  );
  expect(files['pr1142-native-declarative-recovery-v1/manifest.json']).not.toBe(
    files['pr1142-native-declarative-v3-recovery-v1/attempt/manifest.json'],
  );
  expect(declarativeV4HistoryEvidence.journals.map(({ count }) => count)).toEqual([55, 29, 1, 95, 61]);
});
it.each(['61EDD87470C55DB0', '590FEFA202D7EDEC', 'F4C656905A65AA61'])(
  'refuses consumed historical suffix %s',
  (suffix) => {
    expect(() => declarativeV4Fixtures(suffix)).toThrow('historical');
  },
);
