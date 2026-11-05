/** Consumed parent-release history and current R/R adoption; pure private reads only. */
import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { CTS_RETAINED_V6_ORIGIN } from './native-cts-fixtures.js';
import { retainedCtsV5History } from './native-cts-retained-v5-history.js';
import { privateHistoryPath } from './native-ddic-structure-cleanup-history.js';
import { privateEvidence } from './native-declarative-prerequisites.js';
import { privateDirectory } from './native-lock-binding.js';

const auditRoot = 'arc1-review/pr1142-cts-retained-v5-A-execution-audit1';
const diagnosis = 'arc1-review/pr1142-cts-v5-stop-diagnosis1';
const native = 'arc1-qualification/pr1142-native-cts-retained-v5';
const roots = {
  [native]: 164,
  'arc1-review/pr1142-cts-retained-v5-execution-20261105': 17,
  'arc1-review/pr1142-cts-retained-v5-current-inspection-20261105': 6,
};
type Receipt = { path: string; sha256: string; bytes: number; mode: number | string; uid?: number; gid?: number };
/** Explicit offline test seams; the literal native CLI supplies none. */
export function retainedCtsV6History(
  state = join(homedir(), '.local/state'),
  expected: {
    reportHash: string;
    auditHash: string;
    ledgerHash: string;
    diagnosisHash: string;
    diagnosisLedgerHash: string;
    designHash: string;
    revision: string;
    intentHash: string;
    resultHash: string;
  } = CTS_RETAINED_V6_ORIGIN.consumedRetainedV5,
  older: (state: string) => { verify: () => void } = retainedCtsV5History,
) {
  const old = older(state),
    path = (s: string) => privateHistoryPath(state, s);
  const read = (relative: string, sha?: string) => {
    const f = privateEvidence(path(relative), 8 * 1024 * 1024);
    if (sha && f.sha256 !== sha) throw Error('Consumed v5 evidence changed.');
    return JSON.parse(f.body.toString());
  };
  const check = (name: string, r: Omit<Receipt, 'path'>) => {
    const f = privateEvidence(path(name), 8 * 1024 * 1024, true),
      s = lstatSync(path(name));
    if (
      f.sha256 !== r.sha256 ||
      f.body.length !== r.bytes ||
      (r.mode !== undefined && (s.mode & 0o777) !== Number(r.mode)) ||
      (r.uid !== undefined && s.uid !== r.uid) ||
      (r.gid !== undefined && s.gid !== r.gid)
    )
      throw Error('Consumed bytes/mode/owner changed.');
  };
  const packet = (root: string, sha: string, count: number) => {
    const ledger = read(root + '/ledger.json', sha);
    if (Object.keys(ledger.files).length !== count) throw Error('Audit packet changed.');
    for (const [name, r] of Object.entries(ledger.files) as [string, Receipt][]) {
      if (!/^[\w.-]+$/.test(name)) throw Error('Audit member path refused.');
      check(root + '/' + name, r);
    }
  };
  const verify = () => {
    old.verify();
    if (
      privateEvidence(path(auditRoot + '/result.md'), 512 * 1024).sha256 !== expected.reportHash ||
      privateEvidence(path('arc1-review/pr1142-native-cts-retained-v6-design1/design.md'), 512 * 1024).sha256 !==
        expected.designHash
    )
      throw Error('Audit/design changed.');
    packet(auditRoot, expected.ledgerHash, 14);
    packet(diagnosis, expected.diagnosisLedgerHash, 15);
    const audit = read(auditRoot + '/result.json', expected.auditHash),
      diagnosisResult = read(diagnosis + '/result.json', expected.diagnosisHash);
    if (
      audit.sourceRevision !== expected.revision ||
      audit.originalFailurePreserved !== true ||
      audit.facts.currentFiles !== 187 ||
      audit.facts.historicalFiles !== 1738 ||
      diagnosisResult.originalFailurePreserved !== true ||
      diagnosisResult.sourceRevision !== expected.revision ||
      diagnosisResult.physicalParentReleased !== true ||
      diagnosisResult.physicalTaskReleased !== true
    )
      throw Error('Exact consumed failure and later native adoption required.');
    const current = read(auditRoot + '/current-inputs.json') as Receipt[];
    if (current.length !== 187 || new Set(current.map((r) => r.path)).size !== 187)
      throw Error('Exact current evidence set required.');
    for (const [relative, count] of Object.entries(roots)) {
      const root = path(relative),
        members = current.filter((r) => r.path.startsWith(root + '/'));
      if (members.length !== count) throw Error('Fixed evidence root membership required.');
      const directories = new Set([root]);
      for (const r of members) for (let d = dirname(r.path); d.startsWith(root); d = dirname(d)) directories.add(d);
      if (relative === native) for (const d of ['B', 'B/preflight', 'C', 'C/preflight']) directories.add(join(root, d));
      const found: string[] = [],
        visited = new Set<string>();
      const walk = (d: string, depth = 0) => {
        if (depth > 6 || !directories.has(d)) throw Error('Unexpected history directory.');
        privateDirectory(d);
        visited.add(d);
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const f = join(d, e.name);
          if (e.isSymbolicLink()) throw Error('History symlink.');
          if (e.isDirectory()) walk(f, depth + 1);
          else if (e.isFile()) found.push(f);
          else throw Error('History file type.');
        }
      };
      walk(root);
      if (
        visited.size !== directories.size ||
        JSON.stringify(found.sort()) !== JSON.stringify(members.map((r) => r.path).sort())
      )
        throw Error('Consumed directory members changed.');
      for (const r of members) check(r.path.slice(state.length + 1), r);
    }
    const inputs = read(auditRoot + '/input-manifest.json').files as Receipt[];
    if (inputs.length !== 5394 || new Set(inputs.map((r) => r.path)).size !== 5394)
      throw Error('Bound audit manifest changed.');
    const currentNames = new Set(current.map((r) => r.path)),
      historical = inputs.filter((r) => !currentNames.has(r.path) && !r.path.startsWith(path(diagnosis) + '/source/'));
    if (historical.length !== 1738) throw Error('Exact prior history required.');
    for (const r of historical) {
      if (!r.path.startsWith(state + '/')) throw Error('History outside state.');
      check(r.path.slice(state.length + 1), r);
    }
    const result = read(native + '/A/attempt/result.json', expected.resultHash),
      intent = read(native + '/intent.json', expected.intentHash);
    if (
      intent.protocol !== 'pr1142-native-cts-retained-v5' ||
      result.failure !== true ||
      result.completed.length ||
      JSON.stringify(result.adoptedReleased) !== JSON.stringify(['A4HK906608']) ||
      JSON.stringify(result.confirmedReleased) !== JSON.stringify(['A4HK906608']) ||
      result.dispatchedMutations !== 1 ||
      result.current.A4HK906607 !== 'unknown' ||
      result.current.A4HK906608 !== 'unknown' ||
      result.releaseProofRefusal?.reason !== 'Unproven native release comment.' ||
      ['B/attempt', 'C/attempt', 'running'].some((x) => existsSync(path(native + '/' + x)))
    )
      throw Error('Failed v5 claim or original uncertainty changed.');
  };
  verify();
  return { verify };
}
