/** Both consumed attempts and exact per-view inspected state remain immutable prerequisites. */
import { lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { privateEvidence } from './native-declarative-prerequisites.js';
import { privateHistoryPath, verifyPrivateHistoryLedger } from './native-ddic-structure-cleanup-history.js';
import { verifyRetainedTableHistory } from './native-ddic-table-retained-history.js';
import { settingsTailFixtures, settingsTailOwners, TABLE_SETTINGS_SUFFIX } from './native-ddic-table-settings-fixed.js';
export const TABLE_SETTINGS_HISTORY = {
  operatorReport: '2b76dce5247081b906b5abcdc67e954212cf854c38f338d0772f1e3a634a2556',
  operatorLedger: 'caa2167c0e69f6ce182b5867f0af8f91a9fe84987fceb158dd6236beed59696d',
  auditReport: '789ed23f0d3186283e7cebc8ede74ced96167d5774a5feb963e958b030c5ba90',
  audit: 'c0c35c0fd410dc6e026801f6b392dd0a96474e67ac7b6f8f4bd49022a61a8fe5',
  intent: 'c61c1a6755e3ced6573a328af8e65c17dee06305b30414feb61ee926ba96efb8',
  result: 'bcaf7963f2104ccec2f1f4885b739c722fd47072af1546671a349f04b758fa52',
} as const;
/** Offline seams only; the fixed CLI never accepts roots, digests or history callbacks. */
export function verifySettingsTailHistory(
  state = join(homedir(), '.local/state'),
  expected: Record<keyof typeof TABLE_SETTINGS_HISTORY, string> = TABLE_SETTINGS_HISTORY,
  prior = verifyRetainedTableHistory,
) {
  try {
    prior(state);
    const bound = (path: string, hash: string) => {
      const value = privateEvidence(privateHistoryPath(state, path), 1024 * 1024);
      if (value.sha256 !== hash) throw new Error();
      return value.body;
    };
    bound('arc1-review/pr1142-table-retained-stop-operator-audit1/result.md', expected.operatorReport);
    const ledger = JSON.parse(
      bound(
        'arc1-review/pr1142-table-retained-stop-operator-audit1/evidence-ledger.json',
        expected.operatorLedger,
      ).toString('utf8'),
    ) as { path: string; bytes: number; sha256: string }[];
    bound('arc1-review/pr1142-table-retained-independent-audit1/result.md', expected.auditReport);
    const auditPath = 'arc1-review/pr1142-table-retained-independent-audit1/result.json',
      audit = JSON.parse(bound(auditPath, expected.audit).toString('utf8'));
    if (
      audit.status !== 'audited-failed-retained' ||
      audit.sourceRevision !== 'a58d37c12d010edaef66094d27326ca9e5e69b8c' ||
      audit.finalEvidenceUnchanged !== true ||
      audit.resultMarkdownSha256 !== expected.auditReport ||
      ledger.length !== 505 ||
      Object.keys(audit.originalEvidence).length !== 630
    )
      throw new Error();
    let count = 0;
    for (const [relative, total] of [
      ['arc1-qualification/pr1142-native-ddic-table-retained-v1', 477],
      ['arc1-review/pr1142-table-retained-execution-20261104', 10],
      ['arc1-review/pr1142-table-retained-post-save-reads-20261104', 18],
    ] as const) {
      const root = privateHistoryPath(state, relative),
        files: Record<string, { bytes: number; sha256: string }> = {};
      for (const value of ledger.filter((v) => v.path.startsWith(root + '/'))) {
        const evidence = audit.originalEvidence[value.path],
          stat = lstatSync(value.path);
        if (
          !evidence ||
          evidence.sha256 !== value.sha256 ||
          evidence.bytes !== value.bytes ||
          evidence.mode !== (stat.mode & 0o777) ||
          evidence.uid !== stat.uid ||
          evidence.gid !== stat.gid
        )
          throw new Error();
        files[value.path.slice(root.length + 1)] = value;
        count++;
      }
      verifyPrivateHistoryLedger(root, files, total);
    }
    if (count !== 505) throw new Error();
    const root = 'arc1-qualification/pr1142-native-ddic-table-retained-v1',
      intent = JSON.parse(bound(root + '/intent.json', expected.intent).toString('utf8')),
      result = JSON.parse(bound(root + '/attempt/result.json', expected.result).toString('utf8'));
    if (
      intent.suffix !== TABLE_SETTINGS_SUFFIX ||
      JSON.stringify(intent.fixtures) !== JSON.stringify(settingsTailFixtures(TABLE_SETTINGS_SUFFIX)) ||
      intent.binding.revision !== audit.sourceRevision ||
      result.failure !== true ||
      result.stoppedAt !== 'activate-TABL/DTT' ||
      !result.mutationDispatched ||
      JSON.stringify(result.completed) !==
        JSON.stringify(['activate-TABL/DT', 'adopt-TABL/DTT', 'stale-TABL/DTT', 'update-TABL/DTT']) ||
      result.created.length ||
      result.confirmedDeleted.length ||
      result.cleanupUnconfirmed ||
      JSON.stringify(result.remaining) !== JSON.stringify(settingsTailOwners())
    )
      throw new Error();
    bound(auditPath, expected.audit);
  } catch {
    throw new Error('Consumed table/settings attempts or inspected coupling evidence changed.');
  }
}
