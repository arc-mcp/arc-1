/** Preserve the failed v1 claim and the independently audited successful one-owner cleanup. */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { STRUCTURE_SUFFIX, structureCleanupFixtures } from './native-ddic-structure-cleanup-fixed.js';
import {
  privateHistoryPath,
  verifyPrivateHistoryLedger,
  verifyStructureCleanupHistory,
} from './native-ddic-structure-cleanup-history.js';
import { privateEvidence } from './native-declarative-prerequisites.js';

export const COLLECTIONS_V2_HISTORY = {
  audit: '84c9d16df4d3f5e30c9e2196817867be0ec302f0e1e3eabe7747fd1de950fea0',
  ledger: '6147d373599beeafa3e4b1e94932b529475e56d12f7421e830c1f299fd3dfd0e',
  intent: '5cae262684f2bc00ee3cada75394d52bbf0ff01a821379d3f06f5b144eeb3766',
  result: '5f326a724afcf6b6438aee94c4be6604603a952ced9ec9b1a727b2e135a82ef7',
} as const;
/** State, digest and predecessor seams are offline-only; the fixed CLI supplies none. */
export function verifyCollectionsV2History(
  state = join(homedir(), '.local/state'),
  expected: { audit: string; ledger: string; intent: string; result: string } = COLLECTIONS_V2_HISTORY,
  verifyOriginal = () => verifyStructureCleanupHistory(state),
) {
  try {
    verifyOriginal();
    const root = 'arc1-review/pr1142-ddic-structure-cleanup-execution-audit1';
    const path = privateHistoryPath(state, `${root}/audit.json`);
    if (privateEvidence(privateHistoryPath(state, `${root}/audit.md`), 512 * 1024).sha256 !== expected.audit)
      throw new Error();
    const saved = privateEvidence(path, 512 * 1024);
    if (saved.sha256 !== expected.ledger) throw new Error();
    const audit = JSON.parse(saved.body.toString('utf8'));
    const owner = structureCleanupFixtures(STRUCTURE_SUFFIX)[0].owner;
    if (
      audit.sourceRevision !== '798936069fd314a63e06fcce9978456ac37b2432' ||
      audit.intentSha256 !== expected.intent ||
      audit.resultSha256 !== expected.result ||
      audit.auditReportSha256 !== expected.audit ||
      audit.sourceCleanAndEntryLockMatched !== true ||
      audit.protocolFilesUnchanged !== 155 ||
      audit.operatorFilesUnchanged !== 12 ||
      audit.originalEvidenceFilesUnchanged !== 96 ||
      JSON.stringify(audit.result) !==
        JSON.stringify({
          failure: false,
          stopped: false,
          mutationAttempted: true,
          mutationDispatched: true,
          completed: ['delete-TABL/DS'],
          created: [],
          confirmedDeleted: [owner],
          remaining: [],
          inspectionRequired: [],
          cleanupUnconfirmed: false,
          finalAbsenceConfirmed: true,
        })
    )
      throw new Error();
    for (const [kind, relative, count] of [
      ['protocol', 'arc1-qualification/pr1142-native-ddic-structure-cleanup-v1', 155],
      ['operator', 'arc1-review/pr1142-ddic-structure-cleanup-execution-20261103', 12],
    ] as const) {
      const history = privateHistoryPath(state, relative),
        entry = audit.files[kind];
      if (entry.root !== history) throw new Error();
      verifyPrivateHistoryLedger(history, entry.files, count);
    }
    const files = audit.files.protocol.files;
    if (files['intent.json']?.sha256 !== expected.intent || files['attempt/result.json']?.sha256 !== expected.result)
      throw new Error();
    if (privateEvidence(path, 512 * 1024).sha256 !== expected.ledger) throw new Error();
  } catch {
    throw new Error('Original collections failure or completed structure cleanup evidence changed.');
  }
}
