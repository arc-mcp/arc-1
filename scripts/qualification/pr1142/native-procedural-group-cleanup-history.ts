/** Immutable prior attempt plus independent audit; historical readable files retain their exact modes. */
import { lstatSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { privateEvidence } from './native-declarative-prerequisites.js';
import {
  GROUP_CLEANUP_INTENT,
  GROUP_CLEANUP_RESULT,
  groupCleanupHistoryDigest,
  groupCleanupHistoryReports,
  groupCleanupHistoryRoots,
} from './native-procedural-group-cleanup-fixed.js';
import { verifyProceduralTailHistory } from './native-procedural-tail-history.js';

type Receipt = { sha256: string; bytes: number; mode: number; uid: number; gid: number };
/** State/digest/old verifier are offline test seams; the fixed executable supplies none. */
export function verifyProceduralGroupCleanupHistory(
  state = join(homedir(), '.local/state'),
  digest = groupCleanupHistoryDigest,
  verifyOriginal = () => verifyProceduralTailHistory(state),
) {
  verifyOriginal();
  const path = (relative: string) => {
    const parts = relative.split('/');
    if (parts.some((p) => !/^[A-Za-z0-9_.-]+$/.test(p) || p === '.' || p === '..')) throw new Error('Historical path');
    for (let i = 0; i < parts.length; i++) {
      const s = lstatSync(join(state, ...parts.slice(0, i)));
      if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== process.getuid?.() || s.mode & 0o022)
        throw new Error('Historical directory');
    }
    return join(state, relative);
  };
  const ledgerPath = path('arc1-review/pr1142-procedural-group-cleanup-author1/historical.json');
  const saved = privateEvidence(ledgerPath, 512 * 1024);
  if (saved.sha256 !== digest) throw new Error('Historical ledger changed');
  const ledger = JSON.parse(saved.body.toString('utf8')) as {
    intent: string;
    result: string;
    roots: Record<string, Record<string, Receipt>>;
    reports: Record<string, Receipt>;
  };
  if (
    ledger.intent !== GROUP_CLEANUP_INTENT ||
    ledger.result !== GROUP_CLEANUP_RESULT ||
    JSON.stringify(Object.keys(ledger.roots)) !== JSON.stringify(Object.keys(groupCleanupHistoryRoots)) ||
    JSON.stringify(Object.keys(ledger.reports)) !== JSON.stringify(groupCleanupHistoryReports)
  )
    throw new Error('Historical identity changed');
  const check = (relative: string, expected: Receipt) => {
    const file = path(relative),
      stat = lstatSync(file),
      value = privateEvidence(file, 8 * 1024 * 1024, true);
    if (
      value.sha256 !== expected.sha256 ||
      value.body.length !== expected.bytes ||
      (stat.mode & 0o7777) !== expected.mode ||
      stat.uid !== expected.uid ||
      stat.gid !== expected.gid
    )
      throw new Error('Historical file changed');
  };
  for (const [root, count] of Object.entries(groupCleanupHistoryRoots)) {
    const expected = ledger.roots[root];
    if (Object.keys(expected).length !== count) throw new Error('Historical count');
    let seen = 0;
    const walk = (relative = '', depth = 0) => {
      if (depth > 8) throw new Error('Historical depth');
      const directory = join(state, root, relative);
      path(`${root}${relative ? `/${relative}` : ''}/sentinel`);
      for (const child of readdirSync(directory, { withFileTypes: true })) {
        const name = relative ? `${relative}/${child.name}` : child.name;
        if (child.isSymbolicLink()) throw new Error('Historical link');
        if (child.isDirectory()) walk(name, depth + 1);
        else {
          if (!child.isFile() || !Object.hasOwn(expected, name) || ++seen > count)
            throw new Error('Historical membership');
          check(`${root}/${name}`, expected[name]);
        }
      }
    };
    walk();
    if (seen !== count) throw new Error('Historical missing file');
  }
  for (const name of groupCleanupHistoryReports) check(name, ledger.reports[name]);
  if (privateEvidence(ledgerPath, 512 * 1024).sha256 !== digest) throw new Error('Historical ledger changed');
}
