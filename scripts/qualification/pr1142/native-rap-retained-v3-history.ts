/** All three consumed claims stay failed; the latest acknowledged document update must not replay. */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { privateHistoryPath, verifyPrivateHistoryLedger } from './native-ddic-structure-cleanup-history.js';
import { privateEvidence } from './native-declarative-prerequisites.js';
import { RAP_RETAINED_V2_HISTORY } from './native-rap-retained-v2-fixed.js';
import { verifyRapRetainedV2History } from './native-rap-retained-v2-history.js';
import { RAP_RETAINED_V3_HISTORY } from './native-rap-retained-v3-fixed.js';
export function verifyRapRetainedV3History(
  state = join(homedir(), '.local/state'),
  expected = RAP_RETAINED_V3_HISTORY,
  original = RAP_RETAINED_V2_HISTORY,
) {
  verifyRapRetainedV2History(state, original);
  const audit = 'arc1-review/pr1142-rap-retained-v2-stop-operator-audit1';
  const read = (path: string) => privateEvidence(privateHistoryPath(state, path), 1024 * 1024);
  try {
    if (read(`${audit}/result.md`).sha256 !== expected.report) throw new Error();
    const receipt = read(`${audit}/ledger.json`);
    if (receipt.sha256 !== expected.ledger) throw new Error();
    const ledger = JSON.parse(receipt.body.toString('utf8'));
    if (
      ledger.revision !== 'c733b1583a79d6db3b469807f24d1a70e90fdbdf' ||
      ledger.intentHash !== expected.intent ||
      ledger.rows !== 345 ||
      ledger.files.length !== 695
    )
      throw new Error();
    const roots = {
      'arc1-qualification/pr1142-native-rap-documents-retained-v2': 639,
      'arc1-review/pr1142-rap-retained-v2-execution-20261104': 10,
      'arc1-review/pr1142-rap-retained-v2-post-stop-reads-20261104': 41,
      'arc1-review/pr1142-rap-retained-v2-stop-assessment1': 5,
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
    if (count !== 695) throw new Error();
    const root = 'arc1-qualification/pr1142-native-rap-documents-retained-v2';
    if (
      read(`${root}/intent.json`).sha256 !== expected.intent ||
      read(`${root}/attempt/result.json`).sha256 !== expected.result
    )
      throw new Error();
    const result = JSON.parse(read(`${root}/attempt/result.json`).body.toString('utf8'));
    if (
      result.failure !== true ||
      result.stoppedAt !== 'update-document-update' ||
      result.confirmedDeleted.length !== 0 ||
      result.created.length !== 0 ||
      result.mutationDispatched !== true ||
      result.completed.length !== 0
    )
      throw new Error();
    for (const [file, hash] of Object.entries(expected.independent))
      if (read(`arc1-review/pr1142-rap-retained-v2-stop-independent-audit1/${file}`).sha256 !== hash) throw new Error();
    if (read(`${audit}/ledger.json`).sha256 !== expected.ledger) throw new Error();
  } catch {
    throw new Error('Consumed retained RAP claim or its separately observed document evidence changed.');
  }
}
