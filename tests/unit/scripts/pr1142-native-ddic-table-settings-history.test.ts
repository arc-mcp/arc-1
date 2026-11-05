import { createHash } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  settingsTailFixtures,
  settingsTailOwners,
  TABLE_SETTINGS_SUFFIX,
} from '../../../scripts/qualification/pr1142/native-ddic-table-settings-fixed.js';
import { verifySettingsTailHistory } from '../../../scripts/qualification/pr1142/native-ddic-table-settings-history.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
function history(invalid = false) {
  const state = mkdtempSync(join(tmpdir(), 'arc1-table-history-'));
  roots.push(state);
  const entries: { path: string; bytes: number; sha256: string }[] = [];
  const originalEvidence: Record<string, unknown> = {};
  const write = (p: string, value: unknown) => {
    const path = join(state, p),
      body = typeof value === 'string' ? value : JSON.stringify(value);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, body, { mode: 0o600 });
    return { path, bytes: Buffer.byteLength(body), sha256: hash(body) };
  };
  const intent = {
    suffix: TABLE_SETTINGS_SUFFIX,
    fixtures: settingsTailFixtures(TABLE_SETTINGS_SUFFIX),
    binding: { revision: 'a58d37c12d010edaef66094d27326ca9e5e69b8c' },
  };
  const result = {
    failure: !invalid,
    stoppedAt: 'activate-TABL/DTT',
    mutationDispatched: true,
    completed: ['activate-TABL/DT', 'adopt-TABL/DTT', 'stale-TABL/DTT', 'update-TABL/DTT'],
    created: [],
    confirmedDeleted: [],
    cleanupUnconfirmed: false,
    remaining: settingsTailOwners(),
  };
  for (const [root, total] of [
    ['arc1-qualification/pr1142-native-ddic-table-retained-v1', 477],
    ['arc1-review/pr1142-table-retained-execution-20261104', 10],
    ['arc1-review/pr1142-table-retained-post-save-reads-20261104', 18],
  ] as const) {
    for (let i = 0; i < total; i++) {
      const p =
          root +
          '/' +
          (root.startsWith('arc1-qualification') && i < 2 ? (i ? 'attempt/result.json' : 'intent.json') : `${i}.json`),
        row = write(p, root.startsWith('arc1-qualification') && i < 2 ? (i ? result : intent) : { i });
      entries.push(row);
      const stat = lstatSync(row.path);
      originalEvidence[row.path] = { ...row, mode: stat.mode & 0o777, uid: stat.uid, gid: stat.gid };
    }
  }
  const operatorReport = write('arc1-review/pr1142-table-retained-stop-operator-audit1/result.md', 'operator');
  const operatorLedger = write('arc1-review/pr1142-table-retained-stop-operator-audit1/evidence-ledger.json', entries);
  const auditReport = write('arc1-review/pr1142-table-retained-independent-audit1/result.md', 'independent');
  const audit = write('arc1-review/pr1142-table-retained-independent-audit1/result.json', {
    status: 'audited-failed-retained',
    sourceRevision: intent.binding.revision,
    finalEvidenceUnchanged: true,
    resultMarkdownSha256: auditReport.sha256,
    originalEvidence: {
      ...originalEvidence,
      ...Object.fromEntries(Array.from({ length: 125 }, (_, i) => ['prior-' + i, {}])),
    },
  });
  return {
    state,
    entries,
    expected: {
      operatorReport: operatorReport.sha256,
      operatorLedger: operatorLedger.sha256,
      auditReport: auditReport.sha256,
      audit: audit.sha256,
      intent: entries[0].sha256,
      result: entries[1].sha256,
    },
    verify: () =>
      verifySettingsTailHistory(
        state,
        {
          operatorReport: operatorReport.sha256,
          operatorLedger: operatorLedger.sha256,
          auditReport: auditReport.sha256,
          audit: audit.sha256,
          intent: entries[0].sha256,
          result: entries[1].sha256,
        },
        () => {},
      ),
  };
}
it('rehashes all505 fixed members, reports and original failed prefix', () => {
  expect(() => history().verify()).not.toThrow();
});
it.each(['bytes', 'mode', 'extra', 'missing', 'symlink', 'report', 'semantic'])(
  'refuses changed %s history',
  (fault) => {
    const h = history(fault === 'semantic'),
      p = h.entries[2].path;
    if (fault === 'bytes') writeFileSync(p, 'changed');
    if (fault === 'mode') chmodSync(p, 0o644);
    if (fault === 'extra') writeFileSync(join(dirname(p), 'extra.json'), 'new', { mode: 0o600 });
    if (fault === 'missing') rmSync(p);
    if (fault === 'symlink') {
      rmSync(p);
      symlinkSync(h.entries[3].path, p);
    }
    if (fault === 'report')
      writeFileSync(join(h.state, 'arc1-review/pr1142-table-retained-independent-audit1/result.md'), 'changed');
    expect(h.verify).toThrow(/evidence changed/);
  },
);
