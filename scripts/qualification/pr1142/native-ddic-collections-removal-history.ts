/** Bind both consumed roots and the complete237-file omission-only stop; never repair or replay history. */
import { lstatSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  COLLECTIONS_REMOVAL_AUDIT_COPY,
  COLLECTIONS_REMOVAL_HISTORY,
  COLLECTIONS_REMOVAL_SUFFIX,
  collectionsRemovalFixtures,
} from './native-ddic-collections-removal-fixed.js';
import { verifyCollectionsRetainedHistory } from './native-ddic-collections-retained-history.js';
import { privateHistoryPath, verifyPrivateHistoryLedger } from './native-ddic-structure-cleanup-history.js';
import { privateEvidence } from './native-declarative-prerequisites.js';
export function verifyCollectionsRemovalHistory(
  state = join(homedir(), '.local/state'),
  expected = COLLECTIONS_REMOVAL_HISTORY,
  verifyPrior = () => verifyCollectionsRetainedHistory(state),
) {
  try {
    verifyPrior();
    const root = COLLECTIONS_REMOVAL_AUDIT_COPY;
    const reportDirectory = dirname(privateHistoryPath(state, `${root}/result.md`));
    const names = readdirSync(reportDirectory, { withFileTypes: true });
    if (
      names.some((n) => !n.isFile()) ||
      JSON.stringify(names.map((n) => n.name).sort()) !==
        JSON.stringify(['evidence-after.json', 'result.json', 'result.md'])
    )
      throw new Error();
    const readReport = (name: string, hash: string) => {
      const file = privateEvidence(privateHistoryPath(state, `${root}/${name}`), 512 * 1024);
      if (file.sha256 !== hash) throw new Error();
      return file.body.toString('utf8');
    };
    readReport('result.md', expected.audit);
    const report = JSON.parse(readReport('result.json', expected.report));
    const ledger = JSON.parse(readReport('evidence-after.json', expected.ledger)) as Record<
      string,
      { path: string; sha256: string; bytes: number; mode: number; uid: number; gid: number }
    >;
    const fixtures = collectionsRemovalFixtures(COLLECTIONS_REMOVAL_SUFFIX),
      owners = fixtures.map((f) => f.owner);
    const messages = fixtures.find((f) => f.type === 'MSAG')?.create.messages;
    if (!messages) throw new Error();
    if (
      report.source?.revision !== 'fc00ebcc4cea89adc8ad9f3476daf63c1e258055' ||
      report.intentHash !== expected.intent ||
      report.resultHash !== expected.result ||
      report.journalRows !== 150 ||
      report.immutableFiles !== 237 ||
      report.stoppedAt !== 'update-MSAG' ||
      report.onePutAcknowledged200 !== true ||
      report.removed003 !== false ||
      report.allThreeOwnersRetained !== true ||
      report.ownSessionCleanupConfirmed !== true ||
      JSON.stringify(report.completed) !== JSON.stringify(['stale-MSAG']) ||
      JSON.stringify(report.savedRows) !==
        JSON.stringify(
          Object.fromEntries(messages.map((m: { number: string; shortText: string }) => [m.number, m.shortText])),
        ) ||
      JSON.stringify(report.dispatchCounts) !== JSON.stringify({ GET: 31, POST: 8, PUT: 1 }) ||
      Object.keys(ledger).length !== 237
    )
      throw new Error();
    let verified = 0;
    const captured = '/Users/marianzeis/.local/state/';
    const original = 'arc1-qualification/pr1142-native-ddic-collections-retained-v1';
    for (const [relative, count] of [
      [original, 211],
      ['arc1-review/pr1142-ddic-retained-execution-20261104', 11],
      ['arc1-review/pr1142-ddic-retained-post-save-reads-20261104', 15],
    ] as const) {
      const prefix = `${captured}${relative}/`,
        directory = privateHistoryPath(state, relative);
      const entries = Object.entries(ledger).filter(([key]) => key.startsWith(prefix));
      const files = Object.fromEntries(
        entries.map(([key, v]) => {
          if (v.path !== key || v.mode !== 0o600) throw new Error();
          return [key.slice(prefix.length), { ...v, mode: '0o600' }];
        }),
      );
      verifyPrivateHistoryLedger(directory, files, count);
      for (const [key, v] of entries) {
        const s = lstatSync(privateHistoryPath(directory, key.slice(prefix.length)));
        if (!s.isFile() || (s.mode & 0o777) !== v.mode || s.uid !== v.uid || s.gid !== v.gid) throw new Error();
      }
      verified += entries.length;
    }
    if (
      verified !== 237 ||
      ledger[`${captured}${original}/intent.json`]?.sha256 !== expected.intent ||
      ledger[`${captured}${original}/attempt/result.json`]?.sha256 !== expected.result
    )
      throw new Error();
    const result = JSON.parse(
      privateEvidence(privateHistoryPath(state, `${original}/attempt/result.json`)).body.toString('utf8'),
    );
    if (
      result.failure !== true ||
      result.stoppedAt !== 'update-MSAG' ||
      result.cleanupUnconfirmed !== false ||
      result.confirmedDeleted.length !== 0 ||
      JSON.stringify(result.remaining) !== JSON.stringify(owners) ||
      JSON.stringify(result.completed) !== JSON.stringify(['stale-MSAG'])
    )
      throw new Error();
    readReport('result.md', expected.audit);
    readReport('result.json', expected.report);
    readReport('evidence-after.json', expected.ledger);
  } catch {
    throw new Error('Consumed message-update history or fixed current evidence changed.');
  }
}
