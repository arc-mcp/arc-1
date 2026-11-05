/** The consumed, pre-mutation v1 attempt remains immutable history for the separate v2 root. */
import { lstatSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { privateEvidence } from './native-declarative-prerequisites.js';
import { privateDirectory } from './native-lock-binding.js';
import { verifyRetainedHistory } from './native-v5-retained-history.js';

export const stoppedRetainedLedgerHash = '95d0704ab910f4e8a2f8a7499b4512eeb44590a5446f382b269e63d1bbee3f8e';
const ledger = 'arc1-review/pr1142-native-v5-retained-entry-assessment/stopped-inputs.json';
const auditRoot = 'arc1-review/pr1142-native-v5-retained-failure-audit1';
const roots = {
  'arc1-qualification/pr1142-native-declarative-v5-retained-v1': 217,
  'arc1-review/pr1142-native-v5-retained-execution-20261103': 7,
};
/** Explicit parameters are offline test seams; the executable entry supplies none. */
export function verifyRetainedRetryHistory(
  state = join(homedir(), '.local/state'),
  digest = stoppedRetainedLedgerHash,
  older = verifyRetainedHistory,
) {
  older();
  const path = (relative: string) => {
    const parts = relative.split('/');
    if (parts.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part) || part === '.' || part === '..'))
      throw new Error('Invalid stopped-attempt evidence path.');
    for (let i = 1; i < parts.length; i++) {
      const parent = join(state, ...parts.slice(0, i));
      // The independent, nonsecret report directory was created readable; never change historical modes.
      if (parent === join(state, auditRoot)) {
        const stat = lstatSync(parent);
        if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || stat.mode & 0o022)
          throw new Error('Unsafe stopped-attempt audit directory.');
      } else privateDirectory(parent);
    }
    return join(state, ...parts);
  };
  const file = privateEvidence(path(ledger), 128 * 1024);
  if (file.sha256 !== digest) throw new Error('Stopped-attempt ledger changed.');
  const data = JSON.parse(file.body.toString('utf8')) as {
    revision: string;
    mutationAttempted: boolean;
    roots: Record<string, Record<string, { bytes: number; sha256: string }>>;
    audit: Record<string, string>;
  };
  if (data.revision !== '3a1743da101b453fa74f8226a44a616dfbc1bf81' || data.mutationAttempted !== false)
    throw new Error('Wrong stopped attempt.');
  for (const [root, count] of Object.entries(roots)) {
    const expected = data.roots[root];
    if (!expected || Object.keys(expected).length !== count) throw new Error('Stopped evidence count changed.');
    const actual: string[] = [];
    const walk = (relative = '', depth = 0) => {
      if (depth > 6) throw new Error('Stopped evidence depth changed.');
      const directory = path(root + (relative ? `/${relative}` : ''));
      privateDirectory(directory);
      for (const child of readdirSync(directory, { withFileTypes: true })) {
        if (child.isSymbolicLink()) throw new Error('Stopped evidence link refused.');
        const name = relative ? `${relative}/${child.name}` : child.name;
        if (child.isDirectory()) walk(name, depth + 1);
        else {
          if (!child.isFile() || actual.length >= count) throw new Error('Stopped evidence count changed.');
          const prior = expected[name];
          if (!prior || !/^[a-f0-9]{64}$/.test(prior.sha256)) throw new Error('Unexpected stopped evidence.');
          const readableOperatorReport =
            root === 'arc1-review/pr1142-native-v5-retained-execution-20261103' &&
            ['ci-window-deferral.json', 'operator-preflight.json'].includes(name);
          const saved = privateEvidence(path(`${root}/${name}`), 8 * 1024 * 1024, readableOperatorReport);
          if (saved.sha256 !== prior.sha256 || saved.body.length !== prior.bytes)
            throw new Error('Stopped evidence bytes changed.');
          actual.push(name);
        }
      }
    };
    walk();
    if (actual.length !== count) throw new Error('Stopped evidence is incomplete.');
  }
  for (const name of ['audit.md', 'evidence.json']) {
    const relative = `${auditRoot}/${name}`;
    if (privateEvidence(path(relative), 512 * 1024, true).sha256 !== data.audit[relative])
      throw new Error('Stopped-attempt audit changed.');
  }
}
