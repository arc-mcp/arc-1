import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ddicHash } from '../../../scripts/qualification/pr1142/native-ddic-evidence.js';
import { ENHO_STAGES } from '../../../scripts/qualification/pr1142/native-enho-fixtures.js';
import {
  ENHO_RETAINED_SUFFIX,
  retainedEnhoFixtures,
} from '../../../scripts/qualification/pr1142/native-enho-retained-fixed.js';
import { verifyRetainedEnhoHistory } from '../../../scripts/qualification/pr1142/native-enho-retained-history.js';

let state: string;
const original = 'arc1-qualification/pr1142-native-enhancement-owned-stub-v1',
  op = 'arc1-review/pr1142-enho-owned-stop-operator-audit1',
  independent = 'arc1-review/pr1142-enho-owned-stop-independent-audit1';
const roots = {
  [original]: 691,
  'arc1-review/pr1142-enho-owned-execution-20261104': 11,
  'arc1-review/pr1142-enho-owned-post-stop-reads-20261104': 15,
  'arc1-review/pr1142-enho-native-stop-assessment1': 9,
};
const f = retainedEnhoFixtures(ENHO_RETAINED_SUFFIX),
  owners = f.map((v) => v.owner);
let expected: Parameters<typeof verifyRetainedEnhoHistory>[1];
const put = (path: string, value: unknown) => {
  const target = join(state, path);
  mkdirSync(join(target, '..'), { recursive: true, mode: 0o700 });
  writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value), { mode: 0o600 });
  chmodSync(target, 0o600);
  return ddicHash(readFileSync(target, 'utf8'));
};
beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), 'arc1-enho-history-'));
  chmodSync(state, 0o700);
  const intent = put(`${original}/intent.json`, {
    suffix: ENHO_RETAINED_SUFFIX,
    fixtures: f,
    identity: 'MARIAN',
    target: 'A4H/001',
  });
  const result = put(`${original}/attempt/result.json`, {
    failure: true,
    stoppedAt: 'update-ENHO',
    cleanupUnconfirmed: false,
    finalAbsenceConfirmed: false,
    completed: ENHO_STAGES.slice(0, 5),
    created: owners,
    remaining: owners,
    confirmedDeleted: [],
  });
  const rows: { path: string; bytes: number; sha256: string; mode: number; uid: number; gid: number }[] = [];
  for (const [root, count] of Object.entries(roots)) {
    const names = root === original ? ['intent.json', 'attempt/result.json'] : [];
    for (let i = names.length; i < count; i++) {
      names.push(`proof-${i}.json`);
      put(`${root}/proof-${i}.json`, { synthetic: i });
    }
    for (const name of names) {
      const path = join(state, root, name),
        s = lstatSync(path),
        text = readFileSync(path, 'utf8');
      rows.push({
        path,
        bytes: Buffer.byteLength(text),
        sha256: ddicHash(text),
        mode: s.mode & 0o777,
        uid: s.uid,
        gid: s.gid,
      });
    }
  }
  const operator = put(`${op}/result.md`, 'Synthetic operator report');
  const ledger = put(`${op}/ledger.json`, {
    revision: 'd3d2f2f4b7113a864dfc3b811fe5593d23719c43',
    protocol: 'pr1142-native-enhancement-owned-stub-v1',
    intentHash: intent,
    journalRows: 652,
    files: rows.map(({ mode, uid, gid, ...v }) => v),
  });
  const audit = put(`${independent}/result.md`, 'Synthetic independent report');
  const proof = put(`${independent}/result.json`, {
    revision: 'd3d2f2f4b7113a864dfc3b811fe5593d23719c43',
    facts: { filesUnchanged: 726, completed: ENHO_STAGES.slice(0, 5), remaining: owners },
    originalFilesUnchanged: rows,
  });
  expected = { operator, ledger, audit, proof, intent, result };
});
afterEach(() => rmSync(state, { recursive: true, force: true }));
it('verifies exactly726 private original receipts plus both fixed audit pairs', () =>
  expect(() => verifyRetainedEnhoHistory(state, expected)).not.toThrow());
it.each(['body', 'file-mode', 'directory-mode', 'missing', 'extra', 'symlink', 'audit', 'intent', 'result'])(
  'fails closed on %s without rewriting a consumed file',
  (fault) => {
    const path = join(state, original, 'proof-2.json');
    if (fault === 'body') writeFileSync(path, 'changed');
    if (fault === 'file-mode') chmodSync(path, 0o644);
    if (fault === 'directory-mode') chmodSync(join(state, original), 0o755);
    if (fault === 'missing') rmSync(path);
    if (fault === 'extra') put(`${original}/unexpected.json`, {});
    if (fault === 'symlink') {
      rmSync(path);
      symlinkSync(join(state, original, 'proof-3.json'), path);
    }
    if (fault === 'audit') put(`${independent}/result.md`, 'changed');
    if (fault === 'intent') put(`${original}/intent.json`, { suffix: 'OTHER' });
    if (fault === 'result') put(`${original}/attempt/result.json`, { failure: false });
    expect(() => verifyRetainedEnhoHistory(state, expected)).toThrow();
  },
);
