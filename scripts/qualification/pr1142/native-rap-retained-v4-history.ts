/** All four consumed claims stay failed; physically executed binding activation must not replay. */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { privateHistoryPath, verifyPrivateHistoryLedger } from './native-ddic-structure-cleanup-history.js';
import { privateEvidence } from './native-declarative-prerequisites.js';
import { RAP_RETAINED_V3_HISTORY } from './native-rap-retained-v3-fixed.js';
import { verifyRapRetainedV3History } from './native-rap-retained-v3-history.js';
import { RAP_RETAINED_V4_HISTORY } from './native-rap-retained-v4-fixed.js';
export function verifyRapRetainedV4History(
  state = join(homedir(), '.local/state'),
  expected = RAP_RETAINED_V4_HISTORY,
  original = RAP_RETAINED_V3_HISTORY,
) {
  verifyRapRetainedV3History(state, original);
  const audit = 'arc1-review/pr1142-rap-retained-v3-stop-operator-audit2';
  const read = (path: string) => privateEvidence(privateHistoryPath(state, path), 2 * 1024 * 1024);
  try {
    if (read(`${audit}/result.md`).sha256 !== expected.report) throw new Error();
    const receipt = read(`${audit}/ledger.json`);
    if (receipt.sha256 !== expected.ledger) throw new Error();
    const ledger = JSON.parse(receipt.body.toString('utf8'));
    if (
      ledger.revision !== '37dd23fce3264a735f8e92ad9d3cd2e5076a78b6' ||
      ledger.intentHash !== expected.intent ||
      ledger.rows !== 625 ||
      ledger.files.length !== 985
    )
      throw new Error();
    const roots = {
      'arc1-qualification/pr1142-native-rap-documents-retained-v3': 919,
      'arc1-review/pr1142-rap-retained-v3-binding-execution-20261104': 11,
      'arc1-review/pr1142-rap-retained-v3-post-stop-reads-20261104': 44,
      'arc1-review/pr1142-rap-retained-v3-binding-reads-20261104': 11,
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
    if (count !== 985) throw new Error();
    const root = 'arc1-qualification/pr1142-native-rap-documents-retained-v3';
    if (
      read(`${root}/intent.json`).sha256 !== expected.intent ||
      read(`${root}/attempt/result.json`).sha256 !== expected.result
    )
      throw new Error();
    const result = JSON.parse(read(`${root}/attempt/result.json`).body.toString('utf8'));
    if (
      result.failure !== true ||
      result.stoppedAt !== 'activate-binding' ||
      result.confirmedDeleted.length !== 0 ||
      result.created.length !== 2 ||
      result.mutationDispatched !== true ||
      JSON.stringify(result.completed) !==
        JSON.stringify(['activate-document-updated', 'create-service', 'activate-service', 'create-binding']) ||
      result.remaining.length !== 8 ||
      result.publicationOperations.length !== 0
    )
      throw new Error();
    const activation = JSON.parse(read(`${root}/attempt/run/00620.json`).body.toString('utf8')).value;
    const binding = JSON.parse(read(`${root}/attempt/run/00623.json`).body.toString('utf8')).value;
    if (
      activation.status !== 200 ||
      activation.sha256 !== 'c133bb966fcddec726a0314273490d805f43b1feaf39701442184025aff815d9' ||
      binding.status !== 200 ||
      binding.sha256 !== '581b50b79cb750455cd68ffe9bf978140396bf4d6f90fef96098544fb1d66dff'
    )
      throw new Error();
    for (const [file, hash] of Object.entries(expected.independent))
      if (read(`arc1-review/pr1142-rap-retained-v3-stop-independent-audit1/${file}`).sha256 !== hash) throw new Error();
    if (read(`${audit}/ledger.json`).sha256 !== expected.ledger) throw new Error();
  } catch {
    throw new Error('Consumed retained RAP claim or its separately observed active binding evidence changed.');
  }
}
