import { createHash } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { COLLECTIONS_STAGES } from '../../../scripts/qualification/pr1142/native-ddic-collections-fixtures.js';
import {
  COLLECTIONS_RETAINED_SUFFIX,
  collectionsRetainedFixtures,
} from '../../../scripts/qualification/pr1142/native-ddic-collections-retained-fixed.js';
import { verifyCollectionsRetainedHistory } from '../../../scripts/qualification/pr1142/native-ddic-collections-retained-history.js';

const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const owners = collectionsRetainedFixtures(COLLECTIONS_RETAINED_SUFFIX).map((f) => f.owner);
let state: string,
  run: string,
  operator: string,
  inspection: string,
  audit: string,
  expected: { audit: string; report: string; ledger: string; intent: string; result: string };
const prior = vi.fn();
const write = (p: string, v: string) => {
  mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
  writeFileSync(p, v, { mode: 0o600 });
  const s = lstatSync(p);
  return {
    sha256: sha(v),
    bytes: Buffer.byteLength(v),
    mode: `0o${(s.mode & 0o777).toString(8)}`,
    uid: s.uid,
    gid: s.gid,
  };
};
beforeEach(() => {
  prior.mockReset();
  state = mkdtempSync(join(tmpdir(), 'arc1-collections-retained-history-'));
  run = join(state, 'arc1-qualification/pr1142-native-ddic-collections-v2');
  operator = join(state, 'arc1-review/pr1142-native-ddic-collections-v2-execution-20261103');
  inspection = join(state, 'arc1-review/pr1142-ddic-collections-v2-post-save-reads-20261103');
  audit = join(state, 'arc1-review/pr1142-ddic-collections-v2-execution-audit1');
  const files: Record<string, ReturnType<typeof write>> = {};
  files['run/intent.json'] = write(join(run, 'intent.json'), 'fixed synthetic intent');
  files['run/attempt/result.json'] = write(
    join(run, 'attempt/result.json'),
    JSON.stringify({
      failure: true,
      stoppedAt: 'create-MSAG',
      completed: COLLECTIONS_STAGES.slice(0, 10),
      confirmedDeleted: [],
      cleanupUnconfirmed: false,
      remaining: owners,
    }),
  );
  for (let i = 0; i < 682; i++)
    files[`run/attempt/run/${i}.json`] = write(join(run, `attempt/run/${i}.json`), `row${i}`);
  for (const [label, root, count] of [
    ['operator', operator, 11],
    ['inspection', inspection, 15],
  ] as const)
    for (let i = 0; i < count; i++) files[`${label}/${i}.json`] = write(join(root, `${i}.json`), `${label}${i}`);
  expected = {
    audit: write(join(audit, 'audit.md'), 'synthetic independent audit').sha256,
    ledger: write(join(audit, 'evidence-after.json'), JSON.stringify(files)).sha256,
    report: '',
    intent: files['run/intent.json'].sha256,
    result: files['run/attempt/result.json'].sha256,
  };
  expected.report = write(
    join(audit, 'audit.json'),
    JSON.stringify({
      source: 'be9cb1041c4b7d508c842fea2340cc1c40e532ad',
      intentSha256: expected.intent,
      resultSha256: expected.result,
      journalRows: 656,
      remaining: owners,
    }),
  ).sha256;
  for (const f of ['audit.md', 'audit.json', 'evidence-after.json']) chmodSync(join(audit, f), 0o644);
});
afterEach(() => rmSync(state, { recursive: true, force: true }));
const verify = () => verifyCollectionsRetainedHistory(state, expected, prior);
it('preserves readable historical reports and all710 private files without rewriting evidence', () => {
  const before = readFileSync(join(audit, 'evidence-after.json'));
  expect(verify).not.toThrow();
  expect(prior).toHaveBeenCalledOnce();
  expect(readFileSync(join(audit, 'evidence-after.json'))).toEqual(before);
  expect(lstatSync(join(audit, 'audit.md')).mode & 0o777).toBe(0o644);
});
it.each([
  'prior',
  'intent',
  'result',
  'journal',
  'operator',
  'inspection',
  'audit',
  'report',
  'ledger',
  'extra',
  'missing',
  'symlink',
  'mode',
  'private-readonly-mode',
  'audit-mode',
  'directory-mode',
  'wrong-owner-graph',
] as const)('refuses %s evidence changes', (fault) => {
  const row = join(run, 'attempt/run/0.json');
  if (fault === 'prior')
    prior.mockImplementation(() => {
      throw new Error();
    });
  const paths = {
    intent: join(run, 'intent.json'),
    result: join(run, 'attempt/result.json'),
    journal: row,
    operator: join(operator, '0.json'),
    inspection: join(inspection, '0.json'),
    audit: join(audit, 'audit.md'),
    report: join(audit, 'audit.json'),
    ledger: join(audit, 'evidence-after.json'),
  };
  if (fault in paths) writeFileSync(paths[fault as keyof typeof paths], 'changed');
  if (fault === 'extra') write(join(inspection, 'extra.json'), 'extra');
  if (fault === 'missing') unlinkSync(row);
  if (fault === 'symlink') {
    unlinkSync(row);
    symlinkSync(join(operator, '0.json'), row);
  }
  if (fault === 'mode') chmodSync(row, 0o644);
  if (fault === 'private-readonly-mode') chmodSync(row, 0o400);
  if (fault === 'audit-mode') chmodSync(join(audit, 'audit.md'), 0o666);
  if (fault === 'directory-mode') chmodSync(inspection, 0o755);
  if (fault === 'wrong-owner-graph') {
    const p = join(audit, 'audit.json'),
      v = JSON.parse(readFileSync(p, 'utf8'));
    v.remaining = ['foreign'];
    expected.report = write(p, JSON.stringify(v)).sha256;
  }
  expect(verify).toThrow('evidence changed');
});
