/** Both consumed claims stay failed. Current native observations bind the unfinished tail. */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { privateHistoryPath, verifyPrivateHistoryLedger } from './native-ddic-structure-cleanup-history.js';
import { privateEvidence } from './native-declarative-prerequisites.js';
import { RAP_RETAINED_HISTORY } from './native-rap-retained-fixed.js';
import { verifyRapRetainedHistory } from './native-rap-retained-history.js';
import { RAP_RETAINED_V2_HISTORY } from './native-rap-retained-v2-fixed.js';
export function verifyRapRetainedV2History(
  state = join(homedir(), '.local/state'),
  expected = RAP_RETAINED_V2_HISTORY,
  original = RAP_RETAINED_HISTORY,
) {
  verifyRapRetainedHistory(state, original);
  const audit = 'arc1-review/pr1142-rap-retained-stop-operator-audit1';
  const read = (path: string) => privateEvidence(privateHistoryPath(state, path), 1024 * 1024);
  try {
    if (read(`${audit}/result.md`).sha256 !== expected.report) throw new Error();
    const receipt = read(`${audit}/ledger.json`);
    if (receipt.sha256 !== expected.ledger) throw new Error();
    const ledger = JSON.parse(receipt.body.toString('utf8'));
    if (
      ledger.revision !== '9748d084f7656064350cfe3735983f22472f3eaf' ||
      ledger.intentHash !== expected.intent ||
      ledger.resultSha256 !== expected.result ||
      ledger.journalRows !== 485 ||
      ledger.files.length !== 837
    )
      throw new Error();
    const roots = {
      'arc1-qualification/pr1142-native-rap-documents-retained-v1': 778,
      'arc1-review/pr1142-rap-retained-execution-20261104': 10,
      'arc1-review/pr1142-rap-retained-post-stop-reads-20261104': 41,
      'arc1-review/pr1142-rap-retained-stop-assessment1': 8,
    };
    let count = 0;
    for (const [root, n] of Object.entries(roots)) {
      const prefix = `${join(state, root)}/`;
      const files = Object.fromEntries(
        ledger.files
          .filter((row: { path: string }) => row.path.startsWith(prefix))
          .map((row: { path: string; bytes: number; sha256: string }) => {
            count++;
            return [row.path.slice(prefix.length), { bytes: row.bytes, sha256: row.sha256 }];
          }),
      );
      verifyPrivateHistoryLedger(privateHistoryPath(state, root), files, n);
    }
    if (count !== 837) throw new Error();
    const root = 'arc1-qualification/pr1142-native-rap-documents-retained-v1';
    if (
      read(`${root}/intent.json`).sha256 !== expected.intent ||
      read(`${root}/attempt/result.json`).sha256 !== expected.result
    )
      throw new Error();
    const result = JSON.parse(read(`${root}/attempt/result.json`).body.toString('utf8'));
    if (
      result.failure !== true ||
      result.stoppedAt !== 'update-document-create' ||
      result.confirmedDeleted.length !== 0 ||
      result.created.length !== 0 ||
      result.mutationDispatched !== true ||
      JSON.stringify(result.completed) !== JSON.stringify(['update-document-root', 'activate-document'])
    )
      throw new Error();
    if (read(`${audit}/ledger.json`).sha256 !== expected.ledger) throw new Error();
  } catch {
    throw new Error('Consumed retained RAP claim or its separately observed document evidence changed.');
  }
}
