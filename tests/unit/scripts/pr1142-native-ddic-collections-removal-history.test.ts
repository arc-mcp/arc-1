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
import {
  COLLECTIONS_REMOVAL_SUFFIX,
  collectionsRemovalFixtures,
} from '../../../scripts/qualification/pr1142/native-ddic-collections-removal-fixed.js';
import { verifyCollectionsRemovalHistory } from '../../../scripts/qualification/pr1142/native-ddic-collections-removal-history.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const fixtures = collectionsRemovalFixtures(COLLECTIONS_REMOVAL_SUFFIX),
  owners = fixtures.map((f) => f.owner);
const captured = '/Users/marianzeis/.local/state/';
let state: string,
  run: string,
  audit: string,
  inspection: string,
  operator: string,
  expected: { audit: string; report: string; ledger: string; intent: string; result: string };
const prior = vi.fn();
const write = (p: string, s: string) => {
  mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
  writeFileSync(p, s, { mode: 0o600 });
  chmodSync(p, 0o600);
  const st = lstatSync(p);
  return {
    path: captured + p.slice(state.length + 1),
    bytes: Buffer.byteLength(s),
    sha256: sha(s),
    mode: 0o600,
    uid: st.uid,
    gid: st.gid,
  };
};
beforeEach(() => {
  prior.mockReset();
  state = mkdtempSync(join(tmpdir(), 'arc1-removal-history-'));
  run = join(state, 'arc1-qualification/pr1142-native-ddic-collections-retained-v1');
  audit = join(state, 'arc1-review/pr1142-ddic-removal-history1');
  operator = join(state, 'arc1-review/pr1142-ddic-retained-execution-20261104');
  inspection = join(state, 'arc1-review/pr1142-ddic-retained-post-save-reads-20261104');
  const files: Record<string, ReturnType<typeof write>> = {};
  const add = (p: string, s: string) => {
    const v = write(p, s);
    files[v.path] = v;
    return v;
  };
  const intent = add(join(run, 'intent.json'), 'immutable old intent');
  const result = add(
    join(run, 'attempt/result.json'),
    JSON.stringify({
      failure: true,
      stoppedAt: 'update-MSAG',
      completed: ['stale-MSAG'],
      confirmedDeleted: [],
      remaining: owners,
      cleanupUnconfirmed: false,
    }),
  );
  for (let i = 0; i < 209; i++) add(join(run, `attempt/run/${i}.json`), `row${i}`);
  for (const [dir, count] of [
    [operator, 11],
    [inspection, 15],
  ] as const)
    for (let i = 0; i < count; i++) add(join(dir, `${i}.json`), `evidence${i}`);
  expected = {
    audit: write(join(audit, 'result.md'), 'fixed audit').sha256,
    report: '',
    ledger: write(join(audit, 'evidence-after.json'), JSON.stringify(files)).sha256,
    intent: intent.sha256,
    result: result.sha256,
  };
  expected.report = write(
    join(audit, 'result.json'),
    JSON.stringify({
      source: { revision: 'fc00ebcc4cea89adc8ad9f3476daf63c1e258055' },
      intentHash: expected.intent,
      resultHash: expected.result,
      journalRows: 150,
      immutableFiles: 237,
      stoppedAt: 'update-MSAG',
      completed: ['stale-MSAG'],
      onePutAcknowledged200: true,
      removed003: false,
      allThreeOwnersRetained: true,
      ownSessionCleanupConfirmed: true,
      savedRows: Object.fromEntries(
        fixtures[2].create.messages!.map((m: { number: string; shortText: string }) => [m.number, m.shortText]),
      ),
      dispatchCounts: { GET: 31, POST: 8, PUT: 1 },
    }),
  ).sha256;
});
afterEach(() => rmSync(state, { recursive: true, force: true }));
const verify = () => verifyCollectionsRemovalHistory(state, expected, prior);
it('binds both consumed histories and all237 additional files without changing private copy modes', () => {
  const before = readFileSync(join(audit, 'evidence-after.json'));
  expect(verify).not.toThrow();
  expect(prior).toHaveBeenCalledOnce();
  expect(readFileSync(join(audit, 'evidence-after.json'))).toEqual(before);
  expect(lstatSync(join(audit, 'result.md')).mode & 0o777).toBe(0o600);
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
  'owner-graph',
  'wrong-stage',
  'ledger-path',
  'copy-extra',
  'copy-symlink',
  'copy-mode',
] as const)('refuses %s drift', (fault) => {
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
    audit: join(audit, 'result.md'),
    report: join(audit, 'result.json'),
    ledger: join(audit, 'evidence-after.json'),
  };
  if (fault in paths) writeFileSync(paths[fault as keyof typeof paths], 'changed');
  if (fault === 'extra') write(join(inspection, 'extra.json'), 'extra');
  if (fault === 'missing') unlinkSync(row);
  if (fault === 'symlink') {
    unlinkSync(row);
    symlinkSync(join(operator, '0.json'), row);
  }
  if (fault === 'copy-extra') write(join(audit, 'extra.json'), 'extra');
  if (fault === 'copy-symlink') {
    unlinkSync(join(audit, 'result.md'));
    symlinkSync(join(operator, '0.json'), join(audit, 'result.md'));
  }
  if (fault === 'copy-mode') chmodSync(join(audit, 'result.md'), 0o644);
  if (fault === 'mode') chmodSync(row, 0o644);
  if (fault === 'private-readonly-mode') chmodSync(row, 0o400);
  if (fault === 'audit-mode') chmodSync(join(audit, 'result.md'), 0o666);
  if (fault === 'directory-mode') chmodSync(inspection, 0o755);
  if (fault === 'owner-graph' || fault === 'wrong-stage') {
    const p = join(run, 'attempt/result.json'),
      value = JSON.parse(readFileSync(p, 'utf8'));
    if (fault === 'owner-graph') value.remaining = ['foreign'];
    else value.completed = ['update-MSAG'];
    const updated = write(p, JSON.stringify(value));
    expected.result = updated.sha256;
    const ledgerPath = join(audit, 'evidence-after.json'),
      reportPath = join(audit, 'result.json');
    const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    ledger[updated.path] = updated;
    expected.ledger = write(ledgerPath, JSON.stringify(ledger)).sha256;
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    report.resultHash = expected.result;
    expected.report = write(reportPath, JSON.stringify(report)).sha256;
  }
  if (fault === 'ledger-path') {
    const p = join(audit, 'evidence-after.json'),
      value = JSON.parse(readFileSync(p, 'utf8'));
    (Object.values(value)[0] as { path: string }).path = '/foreign';
    expected.ledger = write(p, JSON.stringify(value)).sha256;
  }
  expect(verify).toThrow('evidence changed');
});
