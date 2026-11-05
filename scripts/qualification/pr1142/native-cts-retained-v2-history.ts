/** Fixed consumed reassignment refusal plus the older CREATE history; no native imports. */
import { lstatSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { CTS_RETAINED_V2_ORIGIN } from './native-cts-fixtures.js';
import { retainedCtsHistory } from './native-cts-retained-history.js';
import { privateEvidence } from './native-declarative-prerequisites.js';
import { privateDirectory } from './native-lock-binding.js';

const operator = 'arc1-review/pr1142-native-cts-retained-stop-operator-audit1';
const assessment = 'arc1-review/pr1142-native-cts-retained-stop-independent-audit1';
const roots = {
  'arc1-qualification/pr1142-native-cts-retained-v1': 123,
  'arc1-review/pr1142-native-cts-retained-execution-20261103': 11,
} as const;
type Receipt = { sha256: string; bytes: number; mode: number; uid: number; gid: number };
/** Explicit parameters are offline test seams; the executable supplies none. */
export function retainedCtsV2History(
  state = join(homedir(), '.local/state'),
  expected: {
    [K in keyof typeof CTS_RETAINED_V2_ORIGIN.consumedRetained]: string;
  } = CTS_RETAINED_V2_ORIGIN.consumedRetained,
  older: (state: string) => { verify: () => void } = retainedCtsHistory,
) {
  const original = older(state);
  const path = (relative: string) => {
    const parts = relative.split('/');
    if (parts.some((p) => !/^[A-Za-z0-9_.-]+$/.test(p) || p === '.' || p === '..'))
      throw new Error('Invalid consumed CTS history path.');
    for (let i = 1; i < parts.length; i++) privateDirectory(join(state, ...parts.slice(0, i)));
    return join(state, ...parts);
  };
  const ledger = privateEvidence(path(`${operator}/result.json`), 1024 * 1024);
  if (ledger.sha256 !== expected.operatorLedgerHash) throw new Error('Consumed CTS ledger changed.');
  const data = JSON.parse(ledger.body.toString()) as {
    revision: string;
    intentHash: string;
    resultSha256: string;
    roots: Record<string, Record<string, Receipt>>;
  };
  if (
    data.revision !== expected.revision ||
    data.intentHash !== expected.intentHash ||
    data.resultSha256 !== expected.resultHash ||
    !data.roots ||
    JSON.stringify(Object.keys(data.roots).sort()) !== JSON.stringify(Object.keys(roots).sort())
  )
    throw new Error('Exact consumed reassignment attempt required.');
  const verify = () => {
    original.verify();
    for (const [name, hash] of [
      [`${operator}/result.json`, expected.operatorLedgerHash],
      [`${operator}/result.md`, expected.operatorReportHash],
      [`${assessment}/verification.json`, expected.assessmentHash],
      [`${assessment}/result.md`, expected.assessmentReportHash],
    ])
      if (privateEvidence(path(name), 1024 * 1024).sha256 !== hash) throw new Error('Consumed CTS audit changed.');
    let bytes = 0;
    for (const [root, count] of Object.entries(roots)) {
      const entries = data.roots[root];
      if (!entries || Object.keys(entries).length !== count) throw new Error('Consumed CTS count changed.');
      const directories = new Set(['']);
      for (const name of Object.keys(entries)) {
        if (name.split('/').some((p) => !/^[A-Za-z0-9_.-]+$/.test(p) || p === '.' || p === '..'))
          throw new Error('Invalid consumed CTS member.');
        let dir = dirname(name);
        while (dir !== '.') {
          directories.add(dir);
          dir = dirname(dir);
        }
      }
      if (root.startsWith('arc1-qualification/'))
        for (const name of ['B', 'B/preflight', 'C', 'C/preflight']) directories.add(name);
      const actualDirectories = new Set<string>(),
        actual: string[] = [];
      const walk = (relative = '', depth = 0) => {
        if (depth > 6 || !directories.has(relative)) throw new Error('Consumed CTS directory changed.');
        const directory = path(root + (relative ? `/${relative}` : ''));
        privateDirectory(directory);
        actualDirectories.add(relative);
        for (const item of readdirSync(directory, { withFileTypes: true })) {
          if (item.isSymbolicLink()) throw new Error('Consumed CTS links refused.');
          const name = relative ? `${relative}/${item.name}` : item.name;
          if (item.isDirectory()) walk(name, depth + 1);
          else {
            if (!item.isFile() || actual.length >= count) throw new Error('Consumed CTS membership changed.');
            const receipt = entries[name];
            if (!receipt || !/^[a-f0-9]{64}$/.test(receipt.sha256)) throw new Error('Unbound consumed CTS file.');
            const full = path(`${root}/${name}`),
              file = privateEvidence(full, 8 * 1024 * 1024),
              stat = lstatSync(full);
            bytes += file.body.length;
            if (
              bytes > 16 * 1024 * 1024 ||
              file.sha256 !== receipt.sha256 ||
              file.body.length !== receipt.bytes ||
              (stat.mode & 0o777) !== receipt.mode ||
              stat.uid !== receipt.uid ||
              stat.gid !== receipt.gid
            )
              throw new Error('Consumed CTS bytes or ownership changed.');
            actual.push(name);
          }
        }
      };
      walk();
      if (
        JSON.stringify(actual.sort()) !== JSON.stringify(Object.keys(entries).sort()) ||
        actualDirectories.size !== directories.size
      )
        throw new Error('Consumed CTS history incomplete.');
    }
  };
  verify();
  return { verify };
}
