/** Revalidate all consumed evidence without rewriting files or weakening their historical modes. */
import { lstatSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { privateEvidence } from './native-declarative-prerequisites.js';
import { privateDirectory } from './native-lock-binding.js';
import { ORIGINAL_INTENT, ORIGINAL_RESULT } from './native-procedural-retained-fixed.js';
import { retainedHistoryDigest, retainedHistoryRoots } from './native-procedural-retained-history-fixed.js';

const reportRoot = 'arc1-review/pr1142-native-procedural-execution-audit1';
type Receipt = { sha256: string; bytes: number; mode: number };
/** Explicit state/digest are offline test seams. The fixed executable supplies neither. */
export function verifyProceduralRetainedHistory(
  state = join(homedir(), '.local/state'),
  digest = retainedHistoryDigest,
) {
  const path = (relative: string) => {
    const parts = relative.split('/');
    if (parts.some((p) => !/^[A-Za-z0-9_.-]+$/.test(p) || p === '.' || p === '..'))
      throw new Error('Invalid historical path');
    for (let i = 1; i < parts.length; i++) {
      const name = parts.slice(0, i).join('/'),
        dir = join(state, name);
      if (name === reportRoot) {
        const s = lstatSync(dir);
        if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== process.getuid?.() || s.mode & 0o022)
          throw new Error('Unsafe historical report directory');
      } else privateDirectory(dir);
    }
    return join(state, relative);
  };
  const ledgerPath = path('arc1-review/pr1142-native-procedural-retained-author1/retained-history.json'),
    saved = privateEvidence(ledgerPath, 512 * 1024);
  if (saved.sha256 !== digest) throw new Error('Historical ledger changed');
  const ledger = JSON.parse(saved.body.toString('utf8')) as {
    originalIntent: string;
    originalResult: string;
    roots: Record<string, Record<string, Receipt>>;
    reports: Record<string, Receipt>;
  };
  if (
    ledger.originalIntent !== ORIGINAL_INTENT ||
    ledger.originalResult !== ORIGINAL_RESULT ||
    JSON.stringify(Object.keys(ledger.roots)) !== JSON.stringify(Object.keys(retainedHistoryRoots))
  )
    throw new Error('Wrong original procedural history');
  const check = (name: string, r: Receipt, report = false) => {
    const file = path(name),
      value = privateEvidence(file, name.endsWith('.jpg') ? 8 * 1024 * 1024 : 512 * 1024, report);
    if (value.sha256 !== r.sha256 || value.body.length !== r.bytes || (lstatSync(file).mode & 0o7777) !== r.mode)
      throw new Error('Historical file changed');
  };
  for (const [root, count] of Object.entries(retainedHistoryRoots)) {
    const expected = ledger.roots[root];
    if (Object.keys(expected).length !== count) throw new Error('Wrong original count');
    const names: string[] = [];
    const walk = (relative = '', depth = 0) => {
      if (depth > 6) throw new Error('Historical depth changed');
      const dir = path(root + (relative ? `/${relative}` : ''));
      privateDirectory(dir);
      for (const child of readdirSync(dir, { withFileTypes: true })) {
        const name = relative ? `${relative}/${child.name}` : child.name;
        if (child.isSymbolicLink()) throw new Error('Historical link refused');
        if (child.isDirectory()) walk(name, depth + 1);
        else {
          if (!child.isFile() || !expected[name] || names.length >= count)
            throw new Error('Historical membership changed');
          check(`${root}/${name}`, expected[name]);
          names.push(name);
        }
      }
    };
    walk();
    if (names.length !== count) throw new Error('Missing original evidence');
  }
  const reports = ['audit.md', 'audit.json', 'input-ledger-final.json', 'final-addendum.md', 'final-addendum.json'].map(
    (n) => `${reportRoot}/${n}`,
  );
  if (JSON.stringify(Object.keys(ledger.reports).sort()) !== JSON.stringify([...reports].sort()))
    throw new Error('Wrong historical reports');
  for (const name of reports) check(name, ledger.reports[name], true);
  if (privateEvidence(ledgerPath, 512 * 1024).sha256 !== digest) throw new Error('Historical ledger changed');
}
