/** Both failed claims and the separately observed physical MOVE remain immutable. */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { privateEvidence } from './native-declarative-prerequisites.js';
import { PACKAGE_API_MOVED_HISTORY } from './native-package-api-moved-fixed.js';
import { PACKAGE_API_RETAINED_HISTORY } from './native-package-api-retained-fixed.js';
import { verifyPackageApiRetainedHistory } from './native-package-api-retained-history.js';
import { privatePackageHistoryPath, verifyPackageHistoryLedger } from './native-package-recovery-history.js';

export function verifyPackageApiMovedHistory(
  state = join(homedir(), '.local/state'),
  expected = PACKAGE_API_MOVED_HISTORY,
  original = PACKAGE_API_RETAINED_HISTORY,
) {
  verifyPackageApiRetainedHistory(state, original);
  const audit = 'arc1-review/pr1142-package-api-retained-stop-operator-audit1',
    addendum = 'arc1-review/pr1142-package-api-retained-api-read-addendum1',
    originalRoot = 'arc1-qualification/pr1142-native-package-api-retained-v1';
  const read = (p: string) => privateEvidence(privatePackageHistoryPath(state, p), 1024 * 1024);
  try {
    if (
      read(`${audit}/result.md`).sha256 !== expected.report ||
      read(`${addendum}/result.md`).sha256 !== expected.apiReport
    )
      throw new Error();
    const receipt = read(`${audit}/ledger.json`),
      apiReceipt = read(`${addendum}/ledger.json`);
    if (receipt.sha256 !== expected.ledger || apiReceipt.sha256 !== expected.apiLedger) throw new Error();
    const ledger = JSON.parse(receipt.body.toString('utf8')),
      apiLedger = JSON.parse(apiReceipt.body.toString('utf8'));
    if (
      ledger.revision !== '0264f0f52d1c75236102fa835160389ebdc96666' ||
      ledger.intentHash !== expected.intent ||
      ledger.rows !== 751 ||
      ledger.files.length !== 907 ||
      apiLedger.boundOperatorLedger !== expected.ledger ||
      apiLedger.files.length !== 4
    )
      throw new Error();
    const verify = (files: { path: string; bytes: number; sha256: string }[], roots: Record<string, number>) => {
      let count = 0;
      for (const [root, n] of Object.entries(roots)) {
        const prefix = `${join(state, root)}/`;
        const values = Object.fromEntries(
          files
            .filter((v) => v.path.startsWith(prefix))
            .map((v) => {
              count++;
              return [v.path.slice(prefix.length), { bytes: v.bytes, sha256: v.sha256 }];
            }),
        );
        verifyPackageHistoryLedger(privatePackageHistoryPath(state, root), values, n, true);
      }
      if (count !== files.length) throw new Error();
    };
    verify(ledger.files, {
      [originalRoot]: 872,
      'arc1-review/pr1142-package-api-retained-execution-20261104': 11,
      'arc1-review/pr1142-package-api-retained-post-stop-reads-20261104': 20,
      'arc1-review/pr1142-package-api-new-task-read-20261104': 4,
    });
    verify(apiLedger.files, { 'arc1-review/pr1142-package-api-moved-api-read-20261104': 4 });
    const resultFile = read(`${originalRoot}/attempt/result.json`);
    if (read(`${originalRoot}/intent.json`).sha256 !== expected.intent || resultFile.sha256 !== expected.result)
      throw new Error();
    const result = JSON.parse(resultFile.body.toString('utf8')),
      ops = result.retainedBookkeeping.operations;
    if (
      result.failure !== true ||
      result.stoppedAt !== 'move-class' ||
      result.confirmedDeleted.length ||
      result.created.length ||
      JSON.stringify(result.completed) !== JSON.stringify(['refuse-root-child', 'refuse-child-class']) ||
      ops.length !== 1 ||
      ops[0].stage !== 'move-class' ||
      ops[0].result.ok !== true ||
      ops[0].result.state !== 'moved' ||
      ops[0].result.resource.package !== 'ZARC1_DEMO' ||
      ops[0].result.recording.local !== false ||
      ops[0].result.recording.request !== 'A4HK906609'
    )
      throw new Error();
    if (
      read(`${audit}/ledger.json`).sha256 !== expected.ledger ||
      read(`${addendum}/ledger.json`).sha256 !== expected.apiLedger
    )
      throw new Error();
  } catch {
    throw new Error('Consumed package move/API history or fixed native observations changed.');
  }
}
