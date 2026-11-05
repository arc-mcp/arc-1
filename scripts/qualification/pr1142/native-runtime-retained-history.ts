/** Read-only complete failed-run proof. The fixed entry never supplies alternate paths/digests. */
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { privateEvidence } from './native-declarative-prerequisites.js';
import { privateDirectory } from './native-lock-binding.js';
import { runtimeRetainedHistory as proof } from './native-runtime-retained-fixed.js';
import { runtimeClassOwner } from './native-runtime-slice-fixed.js';

const audit = 'arc1-review/pr1142-runtime-quickfix-independent-audit1';
const operator = 'arc1-review/pr1142-runtime-quickfix-stop-operator-audit1';
const roots = [
  'arc1-qualification/pr1142-native-runtime-flp-v1',
  'arc1-review/pr1142-native-runtime-execution-20261104',
];
const savedPrefix = '/Users/marianzeis/.local/state/';
/** Alternate digest/state are isolated offline test seams, absent from every CLI phase. */
export function verifyRuntimeRetainedHistory(state = join(homedir(), '.local/state'), expected = proof) {
  const path = (relative: string) => {
    const parts = relative.split('/');
    if (parts.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part) || part === '.' || part === '..'))
      throw new Error('Historical path.');
    for (let i = 1; i < parts.length; i++) privateDirectory(join(state, ...parts.slice(0, i)));
    return join(state, ...parts);
  };
  const read = (name: string, hash: string, report = false) => {
    const file = privateEvidence(path(name), name.endsWith('.jpg') ? 8 * 1024 * 1024 : 512 * 1024, report);
    if (!/^[a-f0-9]{64}$/.test(hash) || file.sha256 !== hash) throw new Error('Historical bytes changed.');
    return file;
  };
  const saved = read(`${audit}/result.json`, expected.independentAuditHash, true);
  read(`${audit}/result.md`, expected.independentReportHash, true);
  read(`${operator}/result.json`, expected.operatorAuditHash, true);
  read(`${operator}/result.md`, expected.operatorReportHash, true);
  const data = JSON.parse(saved.body.toString('utf8'));
  if (
    data.revision !== expected.originalRevision ||
    data.formatterResult !== expected.formatterResultHash ||
    data.quickfixResult !== expected.failedQuickfixResultHash ||
    data.proposalApplied !== false ||
    data.deleteAttempted !== false ||
    JSON.stringify(data.remaining) !== JSON.stringify([runtimeClassOwner]) ||
    Object.keys(data.originalFiles).length !== 112
  )
    throw new Error('Historical facts.');
  const declared = Object.keys(data.originalFiles).map((absolute) => {
    if (!absolute.startsWith(savedPrefix)) throw new Error('Historical origin.');
    const relative = absolute.slice(savedPrefix.length);
    if (!roots.some((root) => relative.startsWith(`${root}/`))) throw new Error('Historical root.');
    return relative;
  });
  const actual: string[] = [];
  const walk = (relative: string, depth = 0) => {
    if (depth > 6) throw new Error('Historical depth.');
    privateDirectory(path(relative));
    for (const child of readdirSync(path(relative), { withFileTypes: true })) {
      if (child.isSymbolicLink()) throw new Error('Historical link.');
      const name = `${relative}/${child.name}`;
      if (child.isDirectory()) walk(name, depth + 1);
      else {
        if (!child.isFile() || actual.length >= 112) throw new Error('Historical count.');
        actual.push(name);
      }
    }
  };
  for (const root of roots) walk(root);
  if (
    JSON.stringify(actual.sort()) !== JSON.stringify(declared.sort()) ||
    declared.filter((name) => name.startsWith(`${roots[0]}/`)).length !== 95
  )
    throw new Error('Historical files changed.');
  for (const relative of declared) {
    const entry = data.originalFiles[savedPrefix + relative];
    const file = read(relative, entry.sha256);
    if (file.body.length !== entry.bytes || entry.mode !== 0o600 || entry.uid !== process.getuid?.())
      throw new Error('Historical file metadata.');
  }
  const formatter = JSON.parse(
    read(`${roots[0]}/formatter/attempt/result.json`, expected.formatterResultHash).body.toString('utf8'),
  );
  const failed = JSON.parse(
    read(`${roots[0]}/quickfix/attempt/result.json`, expected.failedQuickfixResultHash).body.toString('utf8'),
  );
  if (
    formatter.failure !== false ||
    formatter.restored !== true ||
    failed.failure !== true ||
    failed.created !== true ||
    formatter.protocol !== expected.originalProtocol ||
    failed.protocol !== expected.originalProtocol ||
    formatter.revision !== expected.originalRevision ||
    failed.revision !== expected.originalRevision ||
    JSON.stringify(failed.remaining) !== JSON.stringify([runtimeClassOwner])
  )
    throw new Error('Historical outcomes.');
}
