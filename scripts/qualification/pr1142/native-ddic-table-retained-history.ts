/** Fixed failed table history plus the independently audited current two-owner state. */
import { lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { privateHistoryPath, verifyPrivateHistoryLedger } from './native-ddic-structure-cleanup-history.js';
import {
  retainedTableFixtures,
  retainedTableOwners,
  TABLE_RETAINED_SUFFIX,
} from './native-ddic-table-retained-fixed.js';
import { privateEvidence } from './native-declarative-prerequisites.js';
export const TABLE_RETAINED_HISTORY = {
  operatorReport: '38fa3838ebc4e2231159046921a4e0a1d9f8a4291c2ac48aa629a861f988a22e',
  operatorLedger: '745005684ec5943b0aecbeaa6bd7ade816e301cb72ba36c773a18452b49b179a',
  auditReport: '6415e95cfde726d440360c54c7027968074cf0fb658121d5033b200dfa7274c3',
  audit: '7e1c1d88794ff41f76179aaf2026f6a0f8c3f2bd55e6357ecc1c5e2e5d71ebf2',
  intent: 'c8edda194ee9ee30b0f9d518ac14ade05b5198160c7e5f5ce213b2ec84c1f77b',
  result: '4dc0d60a23fe5e605d84a356d972fbfadb89615455ee4d44d04b54c1a1582e1a',
} as const;
/** Explicit state/digests are offline test seams, never CLI parameters. */
export function verifyRetainedTableHistory(
  state = join(homedir(), '.local/state'),
  expected: Record<keyof typeof TABLE_RETAINED_HISTORY, string> = TABLE_RETAINED_HISTORY,
) {
  try {
    const bound = (path: string, hash: string) => {
      const value = privateEvidence(privateHistoryPath(state, path), 1024 * 1024);
      if (value.sha256 !== hash) throw new Error();
      return value.body;
    };
    bound('arc1-review/pr1142-table-stop-operator-audit1/result.md', expected.operatorReport);
    const ledger = JSON.parse(
      bound('arc1-review/pr1142-table-stop-operator-audit1/evidence-ledger.json', expected.operatorLedger).toString(
        'utf8',
      ),
    ) as { path: string; bytes: number; sha256: string }[];
    bound('arc1-review/pr1142-table-stop-independent-audit1/result.md', expected.auditReport);
    const auditPath = 'arc1-review/pr1142-table-stop-independent-audit1/result.json',
      audit = JSON.parse(bound(auditPath, expected.audit).toString('utf8'));
    if (
      audit.status !== 'audited-failed-retained' ||
      audit.sourceRevision !== 'bf4b7590a60f666ea961a3a2ecad955ce3668183' ||
      audit.beforeSha256 !== audit.afterSha256 ||
      audit.resultMarkdownSha256 !== expected.auditReport ||
      ledger.length !== 125 ||
      Object.keys(audit.originalEvidence).length !== 125
    )
      throw new Error();
    let count = 0;
    for (const [relative, total] of [
      ['arc1-qualification/pr1142-native-ddic-table-graph-v1', 94],
      ['arc1-review/pr1142-native-table-execution-20261104', 13],
      ['arc1-review/pr1142-table-post-save-reads-20261104', 18],
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
    if (count !== 125) throw new Error();
    const root = 'arc1-qualification/pr1142-native-ddic-table-graph-v1',
      intent = JSON.parse(bound(root + '/intent.json', expected.intent).toString('utf8')),
      result = JSON.parse(bound(root + '/attempt/result.json', expected.result).toString('utf8'));
    if (
      intent.suffix !== TABLE_RETAINED_SUFFIX ||
      JSON.stringify(intent.fixtures) !== JSON.stringify(retainedTableFixtures(TABLE_RETAINED_SUFFIX)) ||
      intent.binding.revision !== audit.sourceRevision ||
      result.failure !== true ||
      result.stoppedAt !== 'create-TABL/DT' ||
      !result.mutationDispatched ||
      result.completed.length ||
      result.created.length ||
      result.confirmedDeleted.length ||
      result.cleanupUnconfirmed ||
      JSON.stringify(result.remaining) !== JSON.stringify(retainedTableOwners())
    )
      throw new Error();
    bound(auditPath, expected.audit);
  } catch {
    throw new Error('Original table failure or retained table/settings evidence changed.');
  }
}
