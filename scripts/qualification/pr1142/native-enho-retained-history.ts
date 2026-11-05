/** Fixed consumed history remains failed and immutable; no state or directory is repaired here. */
import { lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { privateHistoryPath, verifyPrivateHistoryLedger } from './native-ddic-structure-cleanup-history.js';
import { privateEvidence } from './native-declarative-prerequisites.js';
import { ENHO_STAGES } from './native-enho-fixtures.js';
import { ENHO_RETAINED_SUFFIX, retainedEnhoFixtures } from './native-enho-retained-fixed.js';

export const ENHO_RETAINED_HISTORY = {
  operator: '73bc2319a014e226ff82025afb3bf67ec61a405ab9d820bc60330c09de8222ad',
  ledger: '5bee4ad45ef0c1eacf4320ad98abd88f44b723bcc0d764137316388cacfc09b1',
  audit: '88433f63a2091d234a2c1597a23cc925caeaf1a8329d47d7b5d8b4f52ebefaa1',
  proof: 'ebe1ae591590c204fe2ba1450080a3598a491dbca40d3a175a26c5c08cda6fa6',
  intent: 'bb2de1c45a22a386616ea846d93bea99c12a2279dd79ef63f713114726c1d900',
  result: 'f81991f5fed4eeeccf35f768c98150cc5fede42a4a4df5518a6c854771295064',
};
const roots = {
  'arc1-qualification/pr1142-native-enhancement-owned-stub-v1': 691,
  'arc1-review/pr1142-enho-owned-execution-20261104': 11,
  'arc1-review/pr1142-enho-owned-post-stop-reads-20261104': 15,
  'arc1-review/pr1142-enho-native-stop-assessment1': 9,
} as const;
type FileReceipt = { path: string; bytes: number; sha256: string; mode?: number; uid?: number; gid?: number };
/** Alternate state/digests exist for offline synthetic tests only; no CLI override. */
export function verifyRetainedEnhoHistory(state = join(homedir(), '.local/state'), expected = ENHO_RETAINED_HISTORY) {
  try {
    const op = 'arc1-review/pr1142-enho-owned-stop-operator-audit1',
      review = 'arc1-review/pr1142-enho-owned-stop-independent-audit1';
    const read = (path: string, hash: string) => {
      const saved = privateEvidence(privateHistoryPath(state, path), 1024 * 1024);
      if (saved.sha256 !== hash) throw new Error();
      return saved.body.toString('utf8');
    };
    read(`${op}/result.md`, expected.operator);
    read(`${review}/result.md`, expected.audit);
    const ledger = JSON.parse(read(`${op}/ledger.json`, expected.ledger)),
      proof = JSON.parse(read(`${review}/result.json`, expected.proof)),
      owners = retainedEnhoFixtures(ENHO_RETAINED_SUFFIX).map((v) => v.owner);
    if (
      ledger.revision !== 'd3d2f2f4b7113a864dfc3b811fe5593d23719c43' ||
      ledger.protocol !== 'pr1142-native-enhancement-owned-stub-v1' ||
      ledger.intentHash !== expected.intent ||
      ledger.journalRows !== 652 ||
      proof.revision !== ledger.revision ||
      proof.facts.filesUnchanged !== 726 ||
      JSON.stringify(proof.facts.completed) !== JSON.stringify(ENHO_STAGES.slice(0, 5)) ||
      JSON.stringify(proof.facts.remaining) !== JSON.stringify(owners) ||
      !Array.isArray(ledger.files) ||
      ledger.files.length !== 726 ||
      !Array.isArray(proof.originalFilesUnchanged) ||
      proof.originalFilesUnchanged.length !== 726
    )
      throw new Error();
    const records = new Map<string, FileReceipt>((ledger.files as FileReceipt[]).map((v) => [v.path, v]));
    if (records.size !== 726) throw new Error();
    const reviewed = new Set<string>();
    for (const file of proof.originalFilesUnchanged as FileReceipt[]) {
      const original = records.get(file.path);
      if (!original || reviewed.has(file.path) || original.sha256 !== file.sha256 || original.bytes !== file.bytes)
        throw new Error();
      reviewed.add(file.path);
      const stat = lstatSync(file.path);
      if ((stat.mode & 0o777) !== file.mode || stat.uid !== file.uid || stat.gid !== file.gid) throw new Error();
    }
    let counted = 0;
    for (const [relative, count] of Object.entries(roots)) {
      const root = privateHistoryPath(state, relative);
      const files = Object.fromEntries(
        [...records]
          .filter(([path]) => path.startsWith(`${root}/`))
          .map(([path, v]) => [path.slice(root.length + 1), v]),
      );
      verifyPrivateHistoryLedger(root, files, count);
      counted += Object.keys(files).length;
    }
    if (counted !== 726) throw new Error();
    const original = 'arc1-qualification/pr1142-native-enhancement-owned-stub-v1';
    const intent = JSON.parse(read(`${original}/intent.json`, expected.intent)),
      result = JSON.parse(read(`${original}/attempt/result.json`, expected.result));
    if (
      intent.suffix !== ENHO_RETAINED_SUFFIX ||
      intent.identity !== 'MARIAN' ||
      intent.target !== 'A4H/001' ||
      JSON.stringify(intent.fixtures) !== JSON.stringify(retainedEnhoFixtures(ENHO_RETAINED_SUFFIX)) ||
      result.failure !== true ||
      result.stoppedAt !== 'update-ENHO' ||
      result.cleanupUnconfirmed !== false ||
      result.finalAbsenceConfirmed !== false ||
      JSON.stringify(result.completed) !== JSON.stringify(ENHO_STAGES.slice(0, 5)) ||
      JSON.stringify(result.created) !== JSON.stringify(owners) ||
      JSON.stringify(result.remaining) !== JSON.stringify(owners) ||
      JSON.stringify(result.confirmedDeleted) !== '[]'
    )
      throw new Error();
    read(`${op}/ledger.json`, expected.ledger);
    read(`${review}/result.json`, expected.proof);
  } catch {
    throw new Error('Consumed enhancement history or independent physical-save proof changed.');
  }
}
