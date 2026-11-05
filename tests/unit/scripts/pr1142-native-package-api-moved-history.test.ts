import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PACKAGE_API_MOVED_HISTORY } from '../../../scripts/qualification/pr1142/native-package-api-moved-fixed.js';

const oldHistory = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock('../../../scripts/qualification/pr1142/native-package-api-retained-history.js', () => ({
  verifyPackageApiRetainedHistory: oldHistory.verify,
}));

import { verifyPackageApiMovedHistory } from '../../../scripts/qualification/pr1142/native-package-api-moved-history.js';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const original = 'arc1-qualification/pr1142-native-package-api-retained-v1',
  audit = 'arc1-review/pr1142-package-api-retained-stop-operator-audit1',
  addendum = 'arc1-review/pr1142-package-api-retained-api-read-addendum1',
  api = 'arc1-review/pr1142-package-api-moved-api-read-20261104',
  post = 'arc1-review/pr1142-package-api-retained-post-stop-reads-20261104';
let state: string,
  expected: typeof PACKAGE_API_MOVED_HISTORY,
  files: { path: string; bytes: number; sha256: string }[],
  ledger: Record<string, unknown>;
function put(path: string, body: string) {
  const p = join(state, path);
  mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
  writeFileSync(p, body, { mode: 0o600 });
  return { path: p, bytes: Buffer.byteLength(body), sha256: hash(body) };
}
let result: Record<string, unknown>;
function seal() {
  const r = put(`${original}/attempt/result.json`, JSON.stringify(result));
  files[1] = r;
  const l = put(`${audit}/ledger.json`, JSON.stringify(ledger)),
    a = put(
      `${addendum}/ledger.json`,
      JSON.stringify({
        boundOperatorLedger: l.sha256,
        files: Array.from({ length: 4 }, (_, i) => put(`${api}/${i}.json`, `api-${i}`)),
      }),
    );
  expected = {
    report: hash('operator'),
    ledger: l.sha256,
    intent: hash('intent'),
    result: r.sha256,
    apiReport: hash('api'),
    apiLedger: a.sha256,
  } as typeof PACKAGE_API_MOVED_HISTORY;
}
beforeEach(() => {
  oldHistory.verify.mockReset();
  state = mkdtempSync(join(tmpdir(), 'arc1-moved-history-'));
  files = [put(`${original}/intent.json`, 'intent'), put(`${original}/attempt/result.json`, '')];
  for (const [root, n] of [
    [original, 870],
    ['arc1-review/pr1142-package-api-retained-execution-20261104', 11],
    [post, 20],
    ['arc1-review/pr1142-package-api-new-task-read-20261104', 4],
  ] as const)
    for (let i = 0; i < n; i++) files.push(put(`${root}/${i}.json`, `synthetic-${i}`));
  result = {
    failure: true,
    stoppedAt: 'move-class',
    confirmedDeleted: [],
    created: [],
    completed: ['refuse-root-child', 'refuse-child-class'],
    retainedBookkeeping: {
      operations: [
        {
          stage: 'move-class',
          result: {
            ok: true,
            state: 'moved',
            resource: { package: 'ZARC1_DEMO' },
            recording: { local: false, request: 'A4HK906609' },
          },
        },
      ],
    },
  };
  ledger = { revision: '0264f0f52d1c75236102fa835160389ebdc96666', intentHash: hash('intent'), rows: 751, files };
  put(`${audit}/result.md`, 'operator');
  put(`${addendum}/result.md`, 'api');
  seal();
});
afterEach(() => {
  rmSync(state, { recursive: true, force: true });
});
it('verifies the complete907+4-file continuation and always invokes the original525 verifier', () => {
  expect(() => verifyPackageApiMovedHistory(state, expected)).not.toThrow();
  expect(oldHistory.verify).toHaveBeenCalledTimes(1);
});
it.each(['original', 'post', 'api', 'ledger', 'extra', 'symlink', 'mode', 'directory', 'older-history'] as const)(
  'refuses %s drift',
  (fault) => {
    if (fault === 'original') writeFileSync(join(state, original, '0.json'), 'changed');
    if (fault === 'post') writeFileSync(join(state, post, '0.json'), 'changed');
    if (fault === 'api') writeFileSync(join(state, api, '0.json'), 'changed');
    if (fault === 'ledger') writeFileSync(join(state, audit, 'ledger.json'), '{}');
    if (fault === 'extra') put(`${post}/extra.json`, 'extra');
    if (fault === 'symlink') {
      rmSync(join(state, post, '0.json'));
      symlinkSync(join(state, post, '1.json'), join(state, post, '0.json'));
    }
    if (fault === 'mode') chmodSync(join(state, post, '0.json'), 0o644);
    if (fault === 'directory') chmodSync(join(state, post), 0o755);
    if (fault === 'older-history')
      oldHistory.verify.mockImplementation(() => {
        throw new Error('Old claim changed');
      });
    expect(() => verifyPackageApiMovedHistory(state, expected)).toThrow();
  },
);
it.each(['success', 'replayed-stage', 'deleted', 'move-not-confirmed'] as const)(
  'rejects %s historical relabeling even with rebound synthetic hashes',
  (fault) => {
    if (fault === 'success') result.failure = false;
    if (fault === 'replayed-stage') result.completed = ['refuse-root-child', 'refuse-child-class', 'move-class'];
    if (fault === 'deleted') result.confirmedDeleted = ['owner'];
    if (fault === 'move-not-confirmed') result.retainedBookkeeping = { operations: [] };
    seal();
    expect(() => verifyPackageApiMovedHistory(state, expected)).toThrow();
  },
);
