/** Exact consumed run, operator/inspection packets and prior263-file history; never reset or repair evidence. */
import { lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { COLLECTIONS_STAGES } from './native-ddic-collections-fixtures.js';
import {
  COLLECTIONS_RETAINED_HISTORY,
  COLLECTIONS_RETAINED_SUFFIX,
  collectionsRetainedFixtures,
} from './native-ddic-collections-retained-fixed.js';
import { verifyCollectionsV2History } from './native-ddic-collections-v2-history.js';
import { privateHistoryPath, verifyPrivateHistoryLedger } from './native-ddic-structure-cleanup-history.js';
import { privateEvidence } from './native-declarative-prerequisites.js';

/** Explicit test seams only. The fixed CLI always binds the actual immutable receipts. */
export function verifyCollectionsRetainedHistory(
  state = join(homedir(), '.local/state'),
  expected = COLLECTIONS_RETAINED_HISTORY,
  verifyPrior = () => verifyCollectionsV2History(state),
) {
  try {
    verifyPrior();
    const root = 'arc1-review/pr1142-ddic-collections-v2-execution-audit1';
    const readReport = (name: string, hash: string) => {
      const value = privateEvidence(privateHistoryPath(state, `${root}/${name}`), 512 * 1024, true);
      if (value.sha256 !== hash) throw new Error();
      return value.body.toString('utf8');
    };
    readReport('audit.md', expected.audit);
    const report = JSON.parse(readReport('audit.json', expected.report));
    const ledger = JSON.parse(readReport('evidence-after.json', expected.ledger)) as Record<
      string,
      { sha256: string; bytes: number; mode: string; uid: number; gid: number }
    >;
    const owners = collectionsRetainedFixtures(COLLECTIONS_RETAINED_SUFFIX).map((f) => f.owner);
    if (
      report.source !== 'be9cb1041c4b7d508c842fea2340cc1c40e532ad' ||
      report.intentSha256 !== expected.intent ||
      report.resultSha256 !== expected.result ||
      report.journalRows !== 656 ||
      JSON.stringify(report.remaining) !== JSON.stringify(owners) ||
      Object.keys(ledger).length !== 710
    )
      throw new Error();
    for (const [prefix, relative, count] of [
      ['run', 'arc1-qualification/pr1142-native-ddic-collections-v2', 684],
      ['operator', 'arc1-review/pr1142-native-ddic-collections-v2-execution-20261103', 11],
      ['inspection', 'arc1-review/pr1142-ddic-collections-v2-post-save-reads-20261103', 15],
    ] as const) {
      const directory = privateHistoryPath(state, relative);
      const files = Object.fromEntries(
        Object.entries(ledger)
          .filter(([key]) => key.startsWith(prefix + '/'))
          .map(([key, v]) => [key.slice(prefix.length + 1), v]),
      );
      verifyPrivateHistoryLedger(directory, files, count);
      for (const [name, receipt] of Object.entries(files)) {
        const s = lstatSync(privateHistoryPath(directory, name));
        if (
          !s.isFile() ||
          `0o${(s.mode & 0o777).toString(8)}` !== receipt.mode ||
          s.uid !== receipt.uid ||
          s.gid !== receipt.gid
        )
          throw new Error();
      }
    }
    if (
      ledger['run/intent.json']?.sha256 !== expected.intent ||
      ledger['run/attempt/result.json']?.sha256 !== expected.result
    )
      throw new Error();
    const result = JSON.parse(
      privateEvidence(
        privateHistoryPath(state, 'arc1-qualification/pr1142-native-ddic-collections-v2/attempt/result.json'),
      ).body.toString('utf8'),
    );
    if (
      result.failure !== true ||
      result.stoppedAt !== 'create-MSAG' ||
      JSON.stringify(result.completed) !== JSON.stringify(COLLECTIONS_STAGES.slice(0, 10)) ||
      result.confirmedDeleted.length !== 0 ||
      result.cleanupUnconfirmed !== false ||
      JSON.stringify(result.remaining) !== JSON.stringify(owners)
    )
      throw new Error();
    readReport('audit.md', expected.audit);
    readReport('audit.json', expected.report);
    readReport('evidence-after.json', expected.ledger);
  } catch {
    throw new Error('Consumed collections v2 history or current retained evidence changed.');
  }
}
