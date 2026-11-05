/** Immutable original claim/result plus all separate native/operator observations. */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { privateEvidence } from './native-declarative-prerequisites.js';
import { PACKAGE_API_RETAINED_COMPLETED, PACKAGE_API_RETAINED_HISTORY } from './native-package-api-retained-fixed.js';
import { privatePackageHistoryPath, verifyPackageHistoryLedger } from './native-package-recovery-history.js';
export function verifyPackageApiRetainedHistory(
  state = join(homedir(), '.local/state'),
  expected = PACKAGE_API_RETAINED_HISTORY,
) {
  const root = 'arc1-review/pr1142-package-api-stop-operator-audit1';
  const read = (p: string, limit = 1024 * 1024) => privateEvidence(privatePackageHistoryPath(state, p), limit);
  try {
    if (read(`${root}/result.md`).sha256 !== expected.report) throw new Error();
    const receipt = read(`${root}/ledger.json`);
    if (receipt.sha256 !== expected.ledger) throw new Error();
    const ledger = JSON.parse(receipt.body.toString('utf8'));
    if (
      ledger.revision !== 'aec9ecceceaef0c406e7502d3e2202e9e82bae3b' ||
      ledger.intentHash !== expected.intent ||
      ledger.resultSha256 !== expected.result ||
      ledger.journalRows !== 458 ||
      ledger.files.length !== 525
    )
      throw new Error();
    const roots = {
      'arc1-qualification/pr1142-native-package-api-v1': 495,
      'arc1-review/pr1142-package-api-execution-20261104': 10,
      'arc1-review/pr1142-package-api-post-stop-reads-20261104': 20,
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
      verifyPackageHistoryLedger(privatePackageHistoryPath(state, root), files, n, true);
    }
    if (count !== 525) throw new Error();
    const original = 'arc1-qualification/pr1142-native-package-api-v1';
    if (
      read(`${original}/intent.json`).sha256 !== expected.intent ||
      read(`${original}/attempt/result.json`).sha256 !== expected.result
    )
      throw new Error();
    const result = JSON.parse(read(`${original}/attempt/result.json`).body.toString('utf8'));
    if (
      result.failure !== true ||
      result.stoppedAt !== 'refuse-root-child' ||
      result.confirmedDeleted.length !== 0 ||
      JSON.stringify(result.completed) !== JSON.stringify(PACKAGE_API_RETAINED_COMPLETED)
    )
      throw new Error();
    if (read(`${root}/ledger.json`).sha256 !== expected.ledger) throw new Error();
  } catch {
    throw new Error('Consumed package/API history or separate native evidence changed.');
  }
}
