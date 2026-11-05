/** Immutable failed v3 and prior evidence; no claim reuse, repair, or native imports. */
import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { CTS_RETAINED_V4_ORIGIN } from './native-cts-fixtures.js';
import { retainedCtsV3History } from './native-cts-retained-v3-history.js';
import { privateHistoryPath } from './native-ddic-structure-cleanup-history.js';
import { privateEvidence } from './native-declarative-prerequisites.js';
import { privateDirectory } from './native-lock-binding.js';
const auditRoot = 'arc1-review/pr1142-cts-retained-v3-independent-audit1';
const native = 'arc1-qualification/pr1142-native-cts-retained-v3';
const roots = {
  [native]: 675,
  'arc1-review/pr1142-cts-retained-v3-execution-20261105': 14,
  'arc1-review/pr1142-cts-retained-v3-stop-inactive-inventory-20261105': 4,
};
type Receipt = { sha256: string; bytes: number; mode: number; uid: number; gid: number };
type Rows = Record<string, Receipt>;
/** State/hash seams are for offline tests only; the fixed executable supplies none. */
export function retainedCtsV4History(
  state = join(homedir(), '.local/state'),
  expected: {
    protocol: string;
    revision: string;
    intentHash: string;
    resultHash: string;
    reportHash: string;
    auditHash: string;
    filesHash: string;
    historyHash: string;
    verificationHash: string;
    completed: readonly string[];
    confirmedDeleted: readonly string[];
    inactiveBodyHash: string;
  } = CTS_RETAINED_V4_ORIGIN.consumedRetainedV3,
  older: (state: string) => { verify: () => void } = retainedCtsV3History,
) {
  const old = older(state),
    path = (relative: string) => privateHistoryPath(state, relative);
  const read = (relative: string, hash: string) => {
    const saved = privateEvidence(path(relative), 8 * 1024 * 1024);
    if (saved.sha256 !== hash) throw new Error('Immutable failed CTS v3 evidence changed.');
    return JSON.parse(saved.body.toString());
  };
  const checkRows = (rows: Rows, count: number) => {
    if (Object.keys(rows).length !== count) throw new Error('CTS history count changed.');
    let bytes = 0;
    for (const [name, receipt] of Object.entries(rows)) {
      if (!name.startsWith(state + '/')) throw new Error('History outside fixed state parent.');
      const file = path(name.slice(state.length + 1)),
        st = lstatSync(file);
      const saved = privateEvidence(file, 8 * 1024 * 1024, true);
      bytes += saved.body.length;
      if (
        bytes > 64 * 1024 * 1024 ||
        saved.sha256 !== receipt.sha256 ||
        saved.body.length !== receipt.bytes ||
        (st.mode & 0o777) !== receipt.mode ||
        st.uid !== receipt.uid ||
        st.gid !== receipt.gid
      )
        throw new Error('CTS history bytes, mode or owner changed.');
    }
  };
  const verify = () => {
    old.verify();
    const audit = read(`${auditRoot}/result.json`, expected.auditHash),
      files = read(`${auditRoot}/inputs-final.json`, expected.filesHash) as Record<string, Rows>,
      history = read(`${auditRoot}/history-inputs.json`, expected.historyHash) as Record<string, Rows>,
      verified = read(`${auditRoot}/verification.json`, expected.verificationHash);
    if (
      privateEvidence(path(`${auditRoot}/result.md`), 512 * 1024).sha256 !== expected.reportHash ||
      audit.sourceRevision !== expected.revision ||
      audit.intentHash !== expected.intentHash ||
      audit.resultHash !== expected.resultHash ||
      audit.status !== 'FAILED_ATTEMPT_AUDITED_NO_RELEASE_SUBMISSION' ||
      audit.releaseSubmissionCount !== 0 ||
      audit.nativeQualificationCompleted !== false ||
      audit.newFiles !== 693 ||
      !audit.allEvidenceUnchanged ||
      JSON.stringify(audit.completed) !== JSON.stringify(expected.completed) ||
      JSON.stringify(audit.confirmedDeleted) !== JSON.stringify(expected.confirmedDeleted) ||
      audit.confirmedReleased?.length !== 0 ||
      !verified.originalProtocolAndFirstOperatorInputsUnchanged ||
      !verified.oldHistoriesUnchanged ||
      !verified.freshInactiveBodyMatchesRefusalDigest ||
      verified.freshInactiveOwnerMentions !== 0
    )
      throw new Error('Exact failed release-precheck history required.');
    // Every audit artifact is byte-bound by the sealed ledger, including its scripts and retained failures.
    for (const [name, receipt] of Object.entries(audit.files) as [
      string,
      { sha256: string; bytes: number; mode: number },
    ][]) {
      const file = path(`${auditRoot}/${name}`),
        saved = privateEvidence(file, 8 * 1024 * 1024);
      if (
        saved.sha256 !== receipt.sha256 ||
        saved.body.length !== receipt.bytes ||
        (lstatSync(file).mode & 0o777) !== receipt.mode
      )
        throw new Error('CTS audit artifact changed.');
    }
    if (Object.keys(files).length !== Object.keys(roots).length) throw new Error('CTS packet roots changed.');
    for (const [relative, count] of Object.entries(roots)) {
      const root = path(relative),
        rows = files[root];
      if (!rows || Object.keys(rows).some((name) => !name.startsWith(root + '/')))
        throw new Error('CTS packet root changed.');
      const directories = new Set([root]);
      for (const name of Object.keys(rows))
        for (let d = dirname(name); d.startsWith(root); d = dirname(d)) directories.add(d);
      if (relative === native) for (const d of ['B', 'B/preflight', 'C', 'C/preflight']) directories.add(join(root, d));
      const names: string[] = [],
        visited = new Set<string>();
      const walk = (dir: string, depth = 0) => {
        if (depth > 6 || !directories.has(dir)) throw new Error('CTS packet directory changed.');
        privateDirectory(dir);
        visited.add(dir);
        for (const child of readdirSync(dir, { withFileTypes: true })) {
          const file = join(dir, child.name);
          if (child.isSymbolicLink()) throw new Error('CTS history symlink refused.');
          if (child.isDirectory()) walk(file, depth + 1);
          else if (child.isFile()) names.push(file);
          else throw new Error('CTS history member type changed.');
        }
      };
      walk(root);
      if (
        visited.size !== directories.size ||
        JSON.stringify(names.sort()) !== JSON.stringify(Object.keys(rows).sort())
      )
        throw new Error('CTS packet membership changed.');
      checkRows(rows, count);
    }
    if (Object.keys(history).sort().join(',') !== 'CTS,PP') throw new Error('CTS prior history groups changed.');
    checkRows(history.CTS, 535);
    checkRows(history.PP, 275);
    const result = read(`${native}/A/attempt/result.json`, expected.resultHash),
      intent = read(`${native}/intent.json`, expected.intentHash);
    if (
      intent.protocol !== expected.protocol ||
      result.failure !== true ||
      result.cleanupUnconfirmed !== false ||
      JSON.stringify(result.completed) !== JSON.stringify(expected.completed) ||
      JSON.stringify(result.confirmedDeleted) !== JSON.stringify(expected.confirmedDeleted) ||
      result.confirmedReleased?.length !== 0 ||
      existsSync(path(`${native}/B/attempt`)) ||
      existsSync(path(`${native}/C/attempt`)) ||
      existsSync(path(`${native}/running`))
    )
      throw new Error('Old CTS claims must remain consumed and failed.');
    const inventory = JSON.parse(
      privateEvidence(
        path('arc1-review/pr1142-cts-retained-v3-stop-inactive-inventory-20261105/001.json'),
      ).body.toString(),
    );
    if (inventory.sha256 !== expected.inactiveBodyHash || inventory.status !== 200)
      throw new Error('Historical rich inventory binding changed.');
  };
  verify();
  return { verify };
}
