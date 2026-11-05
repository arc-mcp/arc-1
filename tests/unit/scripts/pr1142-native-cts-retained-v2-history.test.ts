import { createHash } from 'node:crypto';
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
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CTS_RETAINED_V2_ORIGIN } from '../../../scripts/qualification/pr1142/native-cts-fixtures.js';
import { retainedCtsV2History } from '../../../scripts/qualification/pr1142/native-cts-retained-v2-history.js';

const roots = [
  'arc1-qualification/pr1142-native-cts-retained-v1',
  'arc1-review/pr1142-native-cts-retained-execution-20261103',
];
const operator = 'arc1-review/pr1142-native-cts-retained-stop-operator-audit1';
const assessment = 'arc1-review/pr1142-native-cts-retained-stop-independent-audit1';
const sha = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
let state: string, expected: { -readonly [K in keyof typeof CTS_RETAINED_V2_ORIGIN.consumedRetained]: string };
let oldValid: boolean;
const oldCheck = vi.fn(() => {
  if (!oldValid) throw Error('Old CREATE history changed');
});
const older = () => ({ verify: oldCheck });
function write(relative: string, body = '{}') {
  const full = join(state, relative);
  mkdirSync(dirname(full), { recursive: true, mode: 0o700 });
  writeFileSync(full, body, { mode: 0o600 });
  const st = lstatSync(full);
  return { sha256: sha(body), bytes: Buffer.byteLength(body), mode: st.mode & 0o777, uid: st.uid, gid: st.gid };
}
beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), 'cts-v2-history-'));
  oldValid = true;
  oldCheck.mockClear();
  expected = { ...CTS_RETAINED_V2_ORIGIN.consumedRetained };
  const bound: Record<string, Record<string, ReturnType<typeof write>>> = {};
  for (const [i, root] of roots.entries()) {
    bound[root] = {};
    for (let n = 0; n < (i === 0 ? 123 : 11); n++) bound[root][`${n}.json`] = write(`${root}/${n}.json`);
  }
  for (const d of ['B/preflight', 'C/preflight']) mkdirSync(join(state, roots[0], d), { recursive: true, mode: 0o700 });
  expected.operatorReportHash = write(`${operator}/result.md`, 'Preserved operator limitations').sha256;
  expected.assessmentHash = write(`${assessment}/verification.json`, '{}').sha256;
  expected.assessmentReportHash = write(`${assessment}/result.md`, 'Independent stop assessment').sha256;
  expected.operatorLedgerHash = write(
    `${operator}/result.json`,
    JSON.stringify({
      revision: expected.revision,
      intentHash: expected.intentHash,
      resultSha256: expected.resultHash,
      roots: bound,
    }),
  ).sha256;
});
afterEach(() => rmSync(state, { recursive: true, force: true }));
it('binds134 files plus both audit pairs and revalidates original history', () => {
  const proof = retainedCtsV2History(state, expected, older);
  proof.verify();
  expect(oldCheck).toHaveBeenCalledTimes(2);
});
it.each([
  'old',
  'native',
  'operator',
  'report',
  'ledger',
  'assessment',
  'assessment-report',
  'extra-file',
  'extra-directory',
  'old-B-claim',
  'missing',
  'symlink',
  'readable',
  'unsafe-directory',
  'directory-link',
  'mode',
  'uid',
  'gid',
  'count',
  'traversal',
  'wrong-result',
  'wrong-intent',
] as const)('refuses %s history drift', (fault) => {
  const proof = retainedCtsV2History(state, expected, older);
  if (fault === 'old') oldValid = false;
  if (fault === 'native') write(`${roots[0]}/0.json`, 'changed');
  if (fault === 'operator') write(`${roots[1]}/0.json`, 'changed');
  if (fault === 'report') write(`${operator}/result.md`, 'changed');
  if (fault === 'ledger') write(`${operator}/result.json`, '{}');
  if (fault === 'assessment') write(`${assessment}/verification.json`, 'changed');
  if (fault === 'assessment-report') write(`${assessment}/result.md`, 'changed');
  if (fault === 'extra-file') write(`${roots[0]}/extra.json`);
  if (fault === 'extra-directory') mkdirSync(join(state, roots[1], 'extra'), { mode: 0o700 });
  if (fault === 'old-B-claim') mkdirSync(join(state, roots[0], 'B/attempt'), { mode: 0o700 });
  if (fault === 'missing') rmSync(join(state, roots[0], '0.json'));
  if (fault === 'symlink') {
    rmSync(join(state, roots[0], '0.json'));
    symlinkSync('1.json', join(state, roots[0], '0.json'));
  }
  if (fault === 'readable') chmodSync(join(state, roots[0], '0.json'), 0o644);
  if (fault === 'unsafe-directory') chmodSync(join(state, roots[1]), 0o777);
  if (fault === 'directory-link') {
    rmSync(join(state, roots[0], 'B/preflight'), { recursive: true });
    symlinkSync('../C/preflight', join(state, roots[0], 'B/preflight'));
  }
  if (['mode', 'uid', 'gid', 'count', 'traversal', 'wrong-result', 'wrong-intent'].includes(fault)) {
    const data = JSON.parse(readFileSync(join(state, operator, 'result.json'), 'utf8'));
    if (['mode', 'uid', 'gid'].includes(fault)) data.roots[roots[0]]['0.json'][fault]++;
    if (fault === 'count') delete data.roots[roots[0]]['0.json'];
    if (fault === 'traversal') {
      data.roots[roots[0]]['../0.json'] = data.roots[roots[0]]['0.json'];
      delete data.roots[roots[0]]['0.json'];
    }
    if (fault === 'wrong-result') data.resultSha256 = 'f'.repeat(64);
    if (fault === 'wrong-intent') data.intentHash = 'f'.repeat(64);
    expected.operatorLedgerHash = write(`${operator}/result.json`, JSON.stringify(data)).sha256;
    expect(() => retainedCtsV2History(state, expected, older)).toThrow();
    return;
  }
  expect(() => proof.verify()).toThrow();
});
