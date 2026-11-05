/** Immutable original claim/result plus all separate native/operator observations. */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { privateHistoryPath, verifyPrivateHistoryLedger } from './native-ddic-structure-cleanup-history.js';
import { privateEvidence } from './native-declarative-prerequisites.js';
import { RAP_RETAINED_COMPLETED, RAP_RETAINED_HISTORY } from './native-rap-retained-fixed.js';
export function verifyRapRetainedHistory(state = join(homedir(), '.local/state'), expected = RAP_RETAINED_HISTORY) {
  const root = 'arc1-review/pr1142-rap-documents-stop-operator-audit1';
  const read = (p: string, limit = 1024 * 1024) => privateEvidence(privateHistoryPath(state, p), limit);
  try {
    if (read(`${root}/result.md`).sha256 !== expected.report) throw new Error();
    const receipt = read(`${root}/ledger.json`);
    if (receipt.sha256 !== expected.ledger) throw new Error();
    const ledger = JSON.parse(receipt.body.toString('utf8'));
    if (
      ledger.revision !== 'c9b3da1b3d1bc0fd5b4f4cbeeda31f36250786b5' ||
      ledger.intentHash !== expected.intent ||
      ledger.resultSha256 !== expected.result ||
      ledger.journalRows !== 1122 ||
      JSON.stringify(ledger.completed) !== JSON.stringify(RAP_RETAINED_COMPLETED) ||
      ledger.files.length !== 1230
    )
      throw new Error();
    const roots = {
      'arc1-qualification/pr1142-native-rap-documents-v1': 1178,
      'arc1-review/pr1142-rap-documents-execution-20261104': 11,
      'arc1-review/pr1142-rap-documents-post-stop-reads-20261104': 41,
    };
    let count = 0;
    for (const [root, n] of Object.entries(roots)) {
      const prefix = `${join(state, root)}/`;
      const files = Object.fromEntries(
        ledger.files
          .filter((v: { path: string }) => v.path.startsWith(prefix))
          .map((v: { path: string; bytes: number; sha256: string; mode: string; uid: number }) => {
            if (v.mode !== '600' || v.uid !== process.getuid?.()) throw new Error();
            count++;
            return [v.path.slice(prefix.length), { bytes: v.bytes, sha256: v.sha256 }];
          }),
      );
      verifyPrivateHistoryLedger(privateHistoryPath(state, root), files, n);
    }
    if (count !== 1230) throw new Error();
    const original = 'arc1-qualification/pr1142-native-rap-documents-v1';
    if (
      read(`${original}/intent.json`).sha256 !== expected.intent ||
      read(`${original}/attempt/result.json`).sha256 !== expected.result
    )
      throw new Error();
    const result = JSON.parse(read(`${original}/attempt/result.json`).body.toString('utf8'));
    if (
      result.failure !== true ||
      result.stoppedAt !== 'create-document' ||
      result.confirmedDeleted.length !== 0 ||
      JSON.stringify(result.completed) !== JSON.stringify(RAP_RETAINED_COMPLETED)
    )
      throw new Error();
    if (read(`${root}/ledger.json`).sha256 !== expected.ledger) throw new Error();
  } catch {
    throw new Error('Consumed RAP/document history or separate native evidence changed.');
  }
}
