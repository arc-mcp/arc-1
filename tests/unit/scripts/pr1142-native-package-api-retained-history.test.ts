import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  PACKAGE_API_RETAINED_COMPLETED,
  type PACKAGE_API_RETAINED_HISTORY,
} from '../../../scripts/qualification/pr1142/native-package-api-retained-fixed.js';
import { verifyPackageApiRetainedHistory } from '../../../scripts/qualification/pr1142/native-package-api-retained-history.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
let state: string,
  expected: typeof PACKAGE_API_RETAINED_HISTORY,
  files: { path: string; bytes: number; sha256: string; mode: string; uid: number }[];
const original = 'arc1-qualification/pr1142-native-package-api-v1',
  audit = 'arc1-review/pr1142-package-api-stop-operator-audit1',
  operator = 'arc1-review/pr1142-package-api-execution-20261104',
  post = 'arc1-review/pr1142-package-api-post-stop-reads-20261104';
function put(path: string, body: string) {
  const p = join(state, path);
  mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
  writeFileSync(p, body, { mode: 0o600 });
  return { path: p, bytes: Buffer.byteLength(body), sha256: sha(body), mode: '600', uid: process.getuid!() };
}
beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), 'arc1-package-retained-history-'));
  files = [];
  const intent = 'synthetic-intent',
    result = JSON.stringify({
      failure: true,
      stoppedAt: 'refuse-root-child',
      confirmedDeleted: [],
      completed: PACKAGE_API_RETAINED_COMPLETED,
    });
  files.push(put(`${original}/intent.json`, intent), put(`${original}/attempt/result.json`, result));
  for (const [root, n] of [
    [original, 493],
    [operator, 10],
    [post, 20],
  ] as const)
    for (let i = 0; i < n; i++) files.push(put(`${root}/${i}.json`, `synthetic-${i}`));
  const ledger = JSON.stringify({
    revision: 'aec9ecceceaef0c406e7502d3e2202e9e82bae3b',
    intentHash: sha(intent),
    resultSha256: sha(result),
    journalRows: 458,
    files,
  });
  put(`${audit}/result.md`, 'synthetic audit');
  put(`${audit}/ledger.json`, ledger);
  expected = {
    report: sha('synthetic audit'),
    ledger: sha(ledger),
    intent: sha(intent),
    result: sha(result),
  } as typeof PACKAGE_API_RETAINED_HISTORY;
});
afterEach(() => rmSync(state, { recursive: true, force: true }));
it('verifies exactly525 original/operator/post-read files without changing them', () =>
  expect(() => verifyPackageApiRetainedHistory(state, expected)).not.toThrow());
it.each(['original', 'post', 'operator', 'result', 'ledger', 'extra', 'symlink', 'mode', 'directory'] as const)(
  'refuses %s history drift',
  (fault) => {
    if (fault === 'original') writeFileSync(join(state, original, '0.json'), 'changed');
    if (fault === 'post') writeFileSync(join(state, post, '0.json'), 'changed');
    if (fault === 'operator') writeFileSync(join(state, operator, '0.json'), 'changed');
    if (fault === 'result') writeFileSync(join(state, original, 'attempt/result.json'), '{}');
    if (fault === 'ledger') writeFileSync(join(state, audit, 'ledger.json'), '{}');
    if (fault === 'extra') put(`${original}/extra.json`, 'extra');
    if (fault === 'symlink') {
      rmSync(join(state, post, '0.json'));
      symlinkSync(join(state, post, '1.json'), join(state, post, '0.json'));
    }
    if (fault === 'mode') chmodSync(join(state, post, '0.json'), 0o644);
    if (fault === 'directory') chmodSync(join(state, post), 0o755);
    expect(() => verifyPackageApiRetainedHistory(state, expected)).toThrow('Consumed package/API');
  },
);
