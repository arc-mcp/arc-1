/** Three immutable consumed attempts; current exact four-owner evidence is never a resume option. */
import { lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { privateEvidence } from './native-declarative-prerequisites.js';
import { privateHistoryPath, verifyPrivateHistoryLedger } from './native-ddic-structure-cleanup-history.js';
import { verifySettingsTailHistory } from './native-ddic-table-settings-history.js';
import { TABLE_STAGES } from './native-ddic-table-fixtures.js';
import {
  indexTailFixtures,
  indexTailOwners,
  TABLE_INDEX_RECEIPTS,
  TABLE_INDEX_SUFFIX,
} from './native-ddic-table-index-fixed.js';
export const TABLE_INDEX_HISTORY = {
  operatorReport: 'cf8f4bec0526b89f3d8549b2bd67eb4b2f3043122eeccb207a8bc95dc0e48ac8',
  operatorLedger: '1f5f5e7b9d8ca14ff15fa8aef85a511306b9fbe5294a0be933c95599f061e85e',
  auditReport: '58a0a61c81b5b8b70dd44e720cb160f74296ff006d4fe9d35bc2a81e7bba5bef',
  audit: '8bc9be847c5c3d5ed54790efa209fe88f58d0713b319e90dac2250c79773561b',
  intent: '9a120761392fd8d3fa9fd5c77b8f7759bd0c69f54fb0f525448dee2dd4c95a3a',
  result: 'afb42e1f273d8d3e6824891f80f9ed46c09e5a956395ed262e5a22d308bb99ab',
} as const;
/** Alternate state/digests/prior verifier are offline seams, never command-line inputs. */
export function verifyIndexTailHistory(
  state = join(homedir(), '.local/state'),
  expected: Record<keyof typeof TABLE_INDEX_HISTORY, string> = TABLE_INDEX_HISTORY,
  prior = verifySettingsTailHistory,
) {
  try {
    prior(state);
    const bound = (path: string, hash: string) => {
      const value = privateEvidence(privateHistoryPath(state, path), 1024 * 1024);
      if (value.sha256 !== hash) throw new Error();
      return value.body;
    };
    bound('arc1-review/pr1142-table-settings-stop-operator-audit1/result.md', expected.operatorReport);
    const operator = JSON.parse(
      bound('arc1-review/pr1142-table-settings-stop-operator-audit1/result.json', expected.operatorLedger).toString(
        'utf8',
      ),
    );
    bound('arc1-review/pr1142-table-settings-stop-independent-audit1/result.md', expected.auditReport);
    const audit = JSON.parse(
      bound('arc1-review/pr1142-table-settings-stop-independent-audit1/result.json', expected.audit).toString('utf8'),
    );
    const revision = 'bc4903a871e80d81af9776b79a4edcc3258afed8',
      owners = indexTailOwners(),
      prefix = TABLE_STAGES.slice(5, 14);
    if (
      audit.status !== 'audited-failed-retained' ||
      audit.sourceRevision !== revision ||
      operator.sourceRevision !== revision ||
      audit.resultSha256 !== expected.result ||
      operator.resultSha256 !== expected.result ||
      !audit.finalEvidenceUnchanged ||
      !audit.parentRawMetadataUnchanged ||
      !audit.parentRawSourceUnchanged ||
      !operator.parentRawMetadataUnchanged ||
      !operator.parentRawSourceUnchanged ||
      audit.journalRows !== 984 ||
      JSON.stringify(audit.dispatch) !== JSON.stringify({ GET: 230, POST: 35, PUT: 3 }) ||
      JSON.stringify(audit.remaining) !== JSON.stringify(owners) ||
      JSON.stringify(audit.completed) !== JSON.stringify(prefix) ||
      audit.indexAdapter?.result?.state !== 'saved-inactive' ||
      audit.indexAdapter.result.sourceHash !== TABLE_INDEX_RECEIPTS.indexSource ||
      audit.indexAdapter.cleanup?.sessionClosed !== true ||
      audit.indexAdapter.cleanup.unlockFailed !== false ||
      operator.fileCount !== 1098 ||
      operator.files.length !== 1098 ||
      Object.keys(audit.originalEvidence).length !== 1098
    )
      throw new Error();
    let count = 0;
    const declared = new Set<string>();
    for (const [relative, total] of [
      ['arc1-qualification/pr1142-native-ddic-table-settings-tail-v1', 1056],
      ['arc1-review/pr1142-table-settings-tail-execution-20261104', 11],
      ['arc1-review/pr1142-table-settings-post-index-reads-20261104', 22],
      ['arc1-review/pr1142-index-and-dependency-source-reads-20261104', 9],
    ] as const) {
      const root = privateHistoryPath(state, relative),
        files: Record<string, { bytes: number; sha256: string }> = {};
      for (const value of operator.files.filter((v: { path: string }) =>
        v.path.startsWith('/Users/marianzeis/.local/state/' + relative + '/'),
      )) {
        const name = value.path.slice(('/Users/marianzeis/.local/state/' + relative + '/').length),
          path = privateHistoryPath(state, relative + '/' + name),
          e = audit.originalEvidence[value.path],
          stat = lstatSync(path);
        if (
          declared.has(value.path) ||
          !e ||
          e.sha256 !== value.sha256 ||
          e.bytes !== value.bytes ||
          e.mode !== '0600' ||
          value.mode !== '0600' ||
          (stat.mode & 0o7777) !== 0o600 ||
          e.uid !== stat.uid ||
          e.gid !== stat.gid ||
          value.uid !== stat.uid ||
          value.gid !== stat.gid
        )
          throw new Error();
        declared.add(value.path);
        files[name] = value;
        count++;
      }
      verifyPrivateHistoryLedger(root, files, total);
    }
    if (
      count !== 1098 ||
      JSON.stringify([...declared].sort()) !== JSON.stringify(Object.keys(audit.originalEvidence).sort())
    )
      throw new Error();
    const root = 'arc1-qualification/pr1142-native-ddic-table-settings-tail-v1',
      intent = JSON.parse(bound(root + '/intent.json', expected.intent).toString('utf8')),
      result = JSON.parse(bound(root + '/attempt/result.json', expected.result).toString('utf8'));
    if (
      intent.protocol !== 'pr1142-native-ddic-table-settings-tail-v1' ||
      intent.suffix !== TABLE_INDEX_SUFFIX ||
      intent.binding.revision !== revision ||
      JSON.stringify(intent.fixtures) !== JSON.stringify(indexTailFixtures(TABLE_INDEX_SUFFIX)) ||
      result.failure !== true ||
      result.stoppedAt !== 'update-TABL/DTI' ||
      !result.mutationDispatched ||
      JSON.stringify(result.completed) !== JSON.stringify(prefix) ||
      JSON.stringify(result.created) !== JSON.stringify(owners.slice(2)) ||
      JSON.stringify(result.retainedOwners) !== JSON.stringify(owners.slice(0, 2)) ||
      result.confirmedDeleted.length ||
      result.cleanupUnconfirmed ||
      result.finalAbsenceConfirmed ||
      JSON.stringify(result.remaining) !== JSON.stringify(owners) ||
      JSON.stringify(result.inspectionRequired) !== JSON.stringify(owners)
    )
      throw new Error();
  } catch {
    throw new Error('Consumed table/settings/index history or inspected four-owner state changed.');
  }
}
