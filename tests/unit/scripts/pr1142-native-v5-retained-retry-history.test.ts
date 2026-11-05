import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { retainedHash } from '../../../scripts/qualification/pr1142/native-v5-retained-fixed.js';
import { verifyRetainedRetryHistory } from '../../../scripts/qualification/pr1142/native-v5-retained-retry-history.js';

const first = 'arc1-qualification/pr1142-native-declarative-v5-retained-v1';
const operator = 'arc1-review/pr1142-native-v5-retained-execution-20261103';
const audit = 'arc1-review/pr1142-native-v5-retained-failure-audit1';
const ledger = 'arc1-review/pr1142-native-v5-retained-entry-assessment/stopped-inputs.json';
let temporary: string, digest: string;
const older = vi.fn();
function write(name: string, body = '{}') {
  const path = join(temporary, name);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, body, { mode: 0o600 });
  return { bytes: Buffer.byteLength(body), sha256: retainedHash(body) };
}
beforeEach(() => {
  older.mockReset();
  temporary = mkdtempSync(join(tmpdir(), 'retained-retry-history-'));
  const roots: Record<string, Record<string, { bytes: number; sha256: string }>> = {};
  for (const [root, count] of [
    [first, 217],
    [operator, 7],
  ] as const) {
    roots[root] = {};
    for (let i = 0; i < count; i++) {
      const name =
        root === operator && i < 2 ? ['ci-window-deferral.json', 'operator-preflight.json'][i]! : `${i}.json`;
      roots[root][name] = write(`${root}/${name}`);
      if (root === operator && i < 2) chmodSync(join(temporary, root, name), 0o644);
    }
  }
  const audits = Object.fromEntries(
    ['audit.md', 'evidence.json'].map((name) => [`${audit}/${name}`, write(`${audit}/${name}`).sha256]),
  );
  chmodSync(join(temporary, audit), 0o755);
  for (const name of ['audit.md', 'evidence.json']) chmodSync(join(temporary, audit, name), 0o644);
  digest = write(
    ledger,
    JSON.stringify({
      revision: '3a1743da101b453fa74f8226a44a616dfbc1bf81',
      mutationAttempted: false,
      roots,
      audit: audits,
    }),
  ).sha256;
});
afterEach(() => rmSync(temporary, { recursive: true, force: true }));
it('binds all consumed-attempt/operator files and both independent audit documents', () => {
  const before = readFileSync(join(temporary, ledger));
  verifyRetainedRetryHistory(temporary, digest, older);
  expect(older).toHaveBeenCalledOnce();
  expect(readFileSync(join(temporary, ledger))).toEqual(before);
});
it.each([
  'attempt',
  'operator',
  'audit',
  'ledger',
  'missing',
  'extra',
  'symlink',
  'older',
  'readable-raw',
  'readable-other-report',
  'writable-audit',
])('refuses changed %s history', (fault) => {
  if (fault === 'attempt') write(`${first}/0.json`, 'changed');
  if (fault === 'operator') write(`${operator}/operator-preflight.json`, 'changed');
  if (fault === 'readable-raw') chmodSync(join(temporary, first, '0.json'), 0o644);
  if (fault === 'readable-other-report') chmodSync(join(temporary, operator, '2.json'), 0o644);
  if (fault === 'writable-audit') chmodSync(join(temporary, audit), 0o777);
  if (fault === 'audit') write(`${audit}/audit.md`, 'changed');
  if (fault === 'ledger') write(ledger, '{}');
  if (fault === 'missing') rmSync(join(temporary, first, '0.json'));
  if (fault === 'extra') write(`${first}/extra.json`);
  if (fault === 'symlink') {
    rmSync(join(temporary, first, '0.json'));
    symlinkSync('1.json', join(temporary, first, '0.json'));
  }
  if (fault === 'older')
    older.mockImplementation(() => {
      throw new Error('Older history changed.');
    });
  expect(() => verifyRetainedRetryHistory(temporary, digest, older)).toThrow();
});
