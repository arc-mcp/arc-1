import { createHash } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CTS_RETAINED_V4_ORIGIN } from '../../../scripts/qualification/pr1142/native-cts-fixtures.js';
import { retainedCtsV4History } from '../../../scripts/qualification/pr1142/native-cts-retained-v4-history.js';

const audit = 'arc1-review/pr1142-cts-retained-v3-independent-audit1',
  native = 'arc1-qualification/pr1142-native-cts-retained-v3',
  operator = 'arc1-review/pr1142-cts-retained-v3-execution-20261105',
  inventory = 'arc1-review/pr1142-cts-retained-v3-stop-inactive-inventory-20261105';
const sha = (body: string) => createHash('sha256').update(body).digest('hex');
let state: string, expected: NonNullable<Parameters<typeof retainedCtsV4History>[1]>, oldValid: boolean;
const old = vi.fn(() => {
  if (!oldValid) throw Error('older history changed');
});
function write(path: string, value: unknown = {}) {
  const full = join(state, path),
    body = JSON.stringify(value);
  mkdirSync(dirname(full), { recursive: true, mode: 0o700 });
  writeFileSync(full, body, { mode: 0o600 });
  const st = lstatSync(full);
  return { sha256: sha(body), bytes: Buffer.byteLength(body), mode: st.mode & 0o777, uid: st.uid, gid: st.gid };
}
beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), 'cts-v4-history-'));
  oldValid = true;
  old.mockClear();
  expected = { ...CTS_RETAINED_V4_ORIGIN.consumedRetainedV3 };
  const current: Record<string, Record<string, ReturnType<typeof write>>> = {};
  for (const [root, count] of [
    [native, 675],
    [operator, 14],
    [inventory, 4],
  ] as const) {
    const rows: Record<string, ReturnType<typeof write>> = {};
    for (let i = 0; i < count; i++) rows[join(state, root, `${i}.json`)] = write(`${root}/${i}.json`);
    current[join(state, root)] = rows;
  }
  const rows = current[join(state, native)];
  for (const name of ['0.json', '1.json']) {
    rmSync(join(state, native, name));
    delete rows[join(state, native, name)];
  }
  rows[join(state, native, 'intent.json')] = write(`${native}/intent.json`, { protocol: expected.protocol });
  expected.intentHash = rows[join(state, native, 'intent.json')].sha256;
  rows[join(state, native, 'A/attempt/result.json')] = write(`${native}/A/attempt/result.json`, {
    failure: true,
    cleanupUnconfirmed: false,
    completed: expected.completed,
    confirmedDeleted: expected.confirmedDeleted,
    confirmedReleased: [],
  });
  expected.resultHash = rows[join(state, native, 'A/attempt/result.json')].sha256;
  for (const path of ['B/preflight', 'C/preflight'])
    mkdirSync(join(state, native, path), { recursive: true, mode: 0o700 });
  const inv = current[join(state, inventory)];
  rmSync(join(state, inventory, '0.json'));
  delete inv[join(state, inventory, '0.json')];
  inv[join(state, inventory, '001.json')] = write(`${inventory}/001.json`, {
    sha256: expected.inactiveBodyHash,
    status: 200,
  });
  const history: Record<string, Record<string, ReturnType<typeof write>>> = { CTS: {}, PP: {} };
  for (const [name, count] of [
    ['CTS', 535],
    ['PP', 275],
  ] as const)
    for (let i = 0; i < count; i++) {
      const path = `arc1-review/old-${name}/${i}.json`;
      history[name][join(state, path)] = write(path);
    }
  expected.filesHash = write(`${audit}/inputs-final.json`, current).sha256;
  expected.historyHash = write(`${audit}/history-inputs.json`, history).sha256;
  expected.verificationHash = write(`${audit}/verification.json`, {
    originalProtocolAndFirstOperatorInputsUnchanged: true,
    oldHistoriesUnchanged: true,
    freshInactiveBodyMatchesRefusalDigest: true,
    freshInactiveOwnerMentions: 0,
  }).sha256;
  expected.reportHash = write(`${audit}/result.md`, 'failed remains failed').sha256;
  expected.auditHash = write(`${audit}/result.json`, {
    sourceRevision: expected.revision,
    intentHash: expected.intentHash,
    resultHash: expected.resultHash,
    status: 'FAILED_ATTEMPT_AUDITED_NO_RELEASE_SUBMISSION',
    releaseSubmissionCount: 0,
    nativeQualificationCompleted: false,
    newFiles: 693,
    allEvidenceUnchanged: true,
    completed: expected.completed,
    confirmedDeleted: expected.confirmedDeleted,
    confirmedReleased: [],
    files: {},
  }).sha256;
});
afterEach(() => rmSync(state, { recursive: true, force: true }));
it('binds693 current plus535 CTS and275 PP historical files without consuming any new claim', () => {
  const proof = retainedCtsV4History(state, expected, () => ({ verify: old }));
  proof.verify();
  expect(old).toHaveBeenCalledTimes(2);
});
it.each([
  'old',
  'native',
  'operator',
  'inventory',
  'old-CTS',
  'old-PP',
  'report',
  'audit',
  'files',
  'history',
  'verification',
  'mode',
  'B-claim',
  'C-claim',
  'running',
  'extra-file',
  'extra-directory',
] as const)('refuses %s drift without repairing history', (fault) => {
  const proof = retainedCtsV4History(state, expected, () => ({ verify: old }));
  if (fault === 'old') oldValid = false;
  if (fault === 'native') write(`${native}/2.json`, 'changed');
  if (fault === 'operator') write(`${operator}/0.json`, 'changed');
  if (fault === 'inventory') write(`${inventory}/001.json`, 'changed');
  if (fault === 'old-CTS' || fault === 'old-PP') write(`arc1-review/${fault}/0.json`, 'changed');
  const file = {
    report: 'result.md',
    audit: 'result.json',
    files: 'inputs-final.json',
    history: 'history-inputs.json',
    verification: 'verification.json',
  }[fault as string];
  if (file) write(`${audit}/${file}`, 'changed');
  if (fault === 'mode') chmodSync(join(state, native, '2.json'), 0o644);
  if (fault === 'B-claim' || fault === 'C-claim') mkdirSync(join(state, native, fault[0], 'attempt'), { mode: 0o700 });
  if (fault === 'running' || fault === 'extra-directory') mkdirSync(join(state, native, fault), { mode: 0o700 });
  if (fault === 'extra-file') write(`${native}/extra.json`);
  expect(() => proof.verify()).toThrow();
});
