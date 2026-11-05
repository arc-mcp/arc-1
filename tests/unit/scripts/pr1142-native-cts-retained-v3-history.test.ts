import { createHash } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CTS_RETAINED_V3_ORIGIN } from '../../../scripts/qualification/pr1142/native-cts-fixtures.js';
import { retainedCtsV3History } from '../../../scripts/qualification/pr1142/native-cts-retained-v3-history.js';

const audit = 'arc1-review/pr1142-cts-retained-v2-stop-independent-audit1',
  native = 'arc1-qualification/pr1142-native-cts-retained-v2',
  operator = 'arc1-review/pr1142-cts-retained-v2-execution-20261104',
  copy = 'arc1-review/pr1142-cts-retained-v2-operator-private-copy1',
  reads = 'arc1-review/pr1142-cts-retained-v2-stop-reads-20261104',
  inventory = 'arc1-review/pr1142-cts-retained-inactive-inventory-20261104';
const sha = (b: string) => createHash('sha256').update(b).digest('hex');
let root: string, expected: Parameters<typeof retainedCtsV3History>[1], oldValid: boolean;
const old = vi.fn(() => {
  if (!oldValid) throw Error('old claim changed');
});
function write(path: string, body = '{}', mode = 0o600) {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true, mode: 0o700 });
  writeFileSync(full, body, { mode });
  const st = lstatSync(full);
  return { sha256: sha(body), bytes: Buffer.byteLength(body), mode: st.mode & 0o777, uid: st.uid, gid: st.gid };
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cts-v3-history-'));
  oldValid = true;
  old.mockClear();
  expected = { ...CTS_RETAINED_V3_ORIGIN.consumedRetainedV2 };
  const roots: Record<string, Record<string, ReturnType<typeof write>>> = {};
  for (const [r, count] of [
    [native, 240],
    [operator, 16],
    [reads, 14],
  ] as const) {
    roots[r] = {};
    for (let n = 0; n < count; n++) roots[r][`${n}.json`] = write(`${r}/${n}.json`);
  }
  for (const name of ['0.json', '1.json']) {
    rmSync(join(root, native, name));
    delete roots[native][name];
  }
  roots[native]['intent.json'] = write(`${native}/intent.json`);
  expected.intentHash = roots[native]['intent.json'].sha256;
  roots[native]['A/attempt/result.json'] = write(
    `${native}/A/attempt/result.json`,
    JSON.stringify({ failure: true, completed: expected.completed, confirmedDeleted: [], confirmedReleased: [] }),
  );
  expected.resultHash = roots[native]['A/attempt/result.json'].sha256;
  for (const name of ['B/preflight', 'C/preflight'])
    mkdirSync(join(root, native, name), { recursive: true, mode: 0o700 });
  chmodSync(join(root, operator, '0.json'), 0o644);
  roots[operator]['0.json'].mode = 0o644;
  const copied = Object.entries(roots[operator]).map(([name, r]) => {
    write(`${copy}/${name}`);
    return {
      name,
      sha256: r.sha256,
      bytes: r.bytes,
      sourceMode: r.mode,
      sourceUid: r.uid,
      sourceGid: r.gid,
      copyMode: 0o600,
      copyUid: r.uid,
      copyGid: r.gid,
    };
  });
  expected.operatorCopyHash = write(
    `${audit}/operator-copy-provenance.json`,
    JSON.stringify({ source: join(root, operator), copy: join(root, copy), files: copied }),
  ).sha256;
  expected.reportHash = write(`${audit}/result.md`, 'Failed original remains failed.').sha256;
  expected.auditHash = write(
    `${audit}/verification.json`,
    JSON.stringify({
      revision: expected.revision,
      intentHash: expected.intentHash,
      resultHash: expected.resultHash,
      completed: expected.completed,
      dispatchedMutations: 3,
      originalsUnchanged: true,
      roots,
    }),
  ).sha256;
  const files: Record<string, ReturnType<typeof write>> = {};
  for (let n = 0; n < 5; n++) files[`${n}.json`] = write(`${inventory}/${n}.json`);
  expected.inventoryAuditHash = write(
    `${audit}/inventory-addendum.json`,
    JSON.stringify({
      root: inventory,
      source: expected.revision,
      rawBodyHash: 'c117c4b1733d7947ceaa5395384155902a7a010c9044e9f0376b5e18e3320968',
      totalEntries: 64,
      ownedEntries: 8,
      suffixOccurrences: 30,
      files,
    }),
  ).sha256;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
it('binds old claims,270 current files,5 inventory files and16 private copies without changing original modes', () => {
  const before = readFileSync(join(root, operator, '0.json'));
  const proof = retainedCtsV3History(root, expected, () => ({ verify: old }));
  proof.verify();
  expect(old).toHaveBeenCalledTimes(2);
  expect(lstatSync(join(root, operator, '0.json')).mode & 0o777).toBe(0o644);
  expect(readFileSync(join(root, operator, '0.json'))).toEqual(before);
});
it.each([
  'old',
  'native',
  'operator',
  'copy',
  'copy-mode',
  'source-mode',
  'reads',
  'inventory',
  'audit',
  'report',
  'copy-ledger',
  'inventory-ledger',
  'B-claim',
  'C-claim',
  'extra-file',
  'extra-directory',
] as const)('refuses %s drift without repair', (fault) => {
  const proof = retainedCtsV3History(root, expected, () => ({ verify: old }));
  if (fault === 'old') oldValid = false;
  if (fault === 'native') write(`${native}/2.json`, 'changed');
  if (fault === 'operator') write(`${operator}/0.json`, 'changed');
  if (fault === 'copy') write(`${copy}/0.json`, 'changed');
  if (fault === 'copy-mode') chmodSync(join(root, copy, '0.json'), 0o644);
  if (fault === 'source-mode') chmodSync(join(root, operator, '0.json'), 0o600);
  if (fault === 'reads') write(`${reads}/0.json`, 'changed');
  if (fault === 'inventory') write(`${inventory}/0.json`, 'changed');
  if (fault === 'audit') write(`${audit}/verification.json`, 'changed');
  if (fault === 'report') write(`${audit}/result.md`, 'changed');
  if (fault === 'copy-ledger') write(`${audit}/operator-copy-provenance.json`, 'changed');
  if (fault === 'inventory-ledger') write(`${audit}/inventory-addendum.json`, 'changed');
  if (fault === 'B-claim' || fault === 'C-claim') mkdirSync(join(root, native, fault[0], 'attempt'), { mode: 0o700 });
  if (fault === 'extra-file') write(`${native}/extra.json`);
  if (fault === 'extra-directory') mkdirSync(join(root, operator, 'extra'), { mode: 0o700 });
  expect(() => proof.verify()).toThrow();
});
