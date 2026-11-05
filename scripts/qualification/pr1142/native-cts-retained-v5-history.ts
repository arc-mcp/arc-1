/** Fixed consumed v4 evidence; never reclassify its failed claim or invoke a native client. */
import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { CTS_RETAINED_V5_ORIGIN } from './native-cts-fixtures.js';
import { retainedCtsV4History } from './native-cts-retained-v4-history.js';
import { privateHistoryPath } from './native-ddic-structure-cleanup-history.js';
import { privateEvidence } from './native-declarative-prerequisites.js';
import { privateDirectory } from './native-lock-binding.js';

const auditRoot = 'arc1-review/pr1142-cts-retained-v4-A-independent-audit1';
const native = 'arc1-qualification/pr1142-native-cts-retained-v4';
const roots = {
  [native]: 183,
  'arc1-review/pr1142-cts-retained-v4-execution-20261105': 15,
  'arc1-review/pr1142-cts-retained-v4-current-inspection-20261105': 6,
};
type Receipt = { sha256: string; bytes: number; mode: number | string; uid?: number; gid?: number };
type Rows = Record<string, Receipt>;
/** Explicit test seams; the fixed CLI supplies none. */
export function retainedCtsV5History(
  state = join(homedir(), '.local/state'),
  expected: {
    reportHash: string;
    auditHash: string;
    ledgerHash: string;
    revision: string;
    intentHash: string;
    resultHash: string;
  } = CTS_RETAINED_V5_ORIGIN.consumedRetainedV4,
  older: (state: string) => { verify: () => void } = retainedCtsV4History,
) {
  const old = older(state),
    path = (s: string) => privateHistoryPath(state, s);
  const read = (relative: string, sha?: string) => {
    const f = privateEvidence(path(relative), 8 * 1024 * 1024);
    if (sha && f.sha256 !== sha) throw Error('Consumed v4 evidence changed.');
    return JSON.parse(f.body.toString());
  };
  const check = (name: string, r: Receipt) => {
    const f = privateEvidence(path(name), 8 * 1024 * 1024, true),
      st = lstatSync(path(name));
    if (
      f.sha256 !== r.sha256 ||
      f.body.length !== r.bytes ||
      (st.mode & 0o777) !== Number(r.mode) ||
      (r.uid !== undefined && st.uid !== r.uid) ||
      (r.gid !== undefined && st.gid !== r.gid)
    )
      throw Error('Consumed bytes/mode/owner changed.');
  };
  const rows = (values: Rows, count: number) => {
    if (Object.keys(values).length !== count) throw Error('Consumed history count changed.');
    for (const [name, r] of Object.entries(values)) {
      if (!name.startsWith(state + '/')) throw Error('History path outside state.');
      check(name.slice(state.length + 1), r);
    }
  };
  const verify = () => {
    old.verify();
    if (privateEvidence(path(auditRoot + '/result.md'), 512 * 1024).sha256 !== expected.reportHash)
      throw Error('Audit report changed.');
    const audit = read(auditRoot + '/result.json', expected.auditHash),
      ledger = read(auditRoot + '/ledger.json', expected.ledgerHash);
    if (
      audit.sourceRevision !== expected.revision ||
      audit.intentHash !== expected.intentHash ||
      audit.failedResultHash !== expected.resultHash ||
      audit.currentFilesUnchanged !== 204 ||
      audit.historicalFilesUnchanged !== 1503 ||
      audit.noParentRelease !== true ||
      audit.noBCPreflightOrAttempt !== true ||
      audit.originalConfirmedReleased.length ||
      audit.originalCompleted.length ||
      audit.physicalReleased?.[0] !== 'A4HK906608' ||
      audit.physicalReleased.length !== 1 ||
      ledger.currentInputs !== 204 ||
      ledger.historicalInputs !== 1503
    )
      throw Error('Exact failed v4 audit required.');
    if (Object.keys(ledger.files).length !== 28) throw Error('Audit packet membership changed.');
    for (const [name, r] of Object.entries(ledger.files) as [string, Receipt][]) {
      if (!/^[\w.-]+$/.test(name)) throw Error('Audit member path refused.');
      check(auditRoot + '/' + name, r);
    }
    const files = read(auditRoot + '/inputs-after.json') as Record<string, Rows>,
      history = read(auditRoot + '/history-inputs.json') as Rows;
    if (Object.keys(files).length !== 3) throw Error('History roots changed.');
    for (const [relative, count] of Object.entries(roots)) {
      const root = path(relative),
        members = files[root];
      if (!members || Object.keys(members).some((x) => !x.startsWith(root + '/')))
        throw Error('Fixed root membership required.');
      const directories = new Set([root]);
      for (const name of Object.keys(members))
        for (let d = dirname(name); d.startsWith(root); d = dirname(d)) directories.add(d);
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
        JSON.stringify(found.sort()) !== JSON.stringify(Object.keys(members).sort())
      )
        throw Error('Consumed directory members changed.');
      rows(members, count);
    }
    rows(history, 1503);
    const result = read(native + '/A/attempt/result.json', expected.resultHash),
      intent = read(native + '/intent.json', expected.intentHash);
    if (
      intent.protocol !== 'pr1142-native-cts-retained-v4' ||
      result.failure !== true ||
      result.completed.length ||
      result.confirmedReleased.length ||
      result.dispatchedMutations !== 1 ||
      result.current.A4HK906607 !== 'unknown' ||
      result.current.A4HK906608 !== 'unknown' ||
      ['B/attempt', 'C/attempt', 'running'].some((x) => existsSync(path(native + '/' + x)))
    )
      throw Error('Consumed failed claim/current facts changed.');
  };
  verify();
  return { verify };
}
