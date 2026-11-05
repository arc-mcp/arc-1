/** Fixed historical bytes only: V4 failed, its pair recovery succeeded, and neither claim may reopen. */
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { privateEvidence } from './native-declarative-prerequisites.js';
import { DECLARATIVE_V4_HISTORY, verifyDeclarativeV4History } from './native-declarative-v4-history.js';
import { verifyOriginalV4Failure } from './native-declarative-v4-recovery-history.js';
import { DeclarativeFailure } from './native-declarative-workflow.js';
import { privateDirectory } from './native-lock-binding.js';

export const DECLARATIVE_V5_HISTORY = Object.freeze({
  previous: DECLARATIVE_V4_HISTORY,
  v4: Object.freeze({ outcome: 'failed-bdef-preaudit-with-control-required', claim: 'permanently-consumed',
    resultHash: '3cb95d1620f6dfad4402d61eba1171d955e02f375c7f7cb434c392f161afb940' }),
  recovery: Object.freeze({ outcome: 'confirmed-two-owner-delete', claim: 'permanently-consumed',
    revision: '04826cc7e0d942fb43eaa86de14520bd05efc4f9',
    resultHash: 'c444fded9da12a04f5f81c65d91900b251813c746a595568a76ddaed114e7ce4',
    auditHash: 'eb143421fd5e275987cbe1000bb47b558bbb059a2e1d308d842de29795d15a65',
    ledgerHash: '9079245f351c10cfbf1a219361b7ec403b43b8bc1f040fc4f38c9b6974b13cc0',
    limits: 'Basic-native only; session closure is the cleanupConfirmed predicate, not a retained close response; lock/inventory bodies are hash-only; inventory is fixture-specific.' }),
});
type Receipt = { bytes: number; sha256: string };
const recoveryName = 'pr1142-native-declarative-v4-recovery-v1';
const postName = 'pr1142-native-declarative-v4-recovery-post-20261103T061332';

/** Explicit state/hash values are offline test seams; the fixed entry supplies none. */
export function verifyDeclarativeV5History(
  state = join(homedir(), '.local/state'),
  expected: { revision: string; resultHash: string; auditHash: string; ledgerHash: string } = DECLARATIVE_V5_HISTORY.recovery,
) {
  try {
    verifyDeclarativeV4History(join(state, 'arc1-qualification'));
    verifyOriginalV4Failure(state);
    const resolve = (root: string, name: string) => {
      const parts = name.split('/');
      if (parts.some(p => !/^[A-Za-z0-9_.-]+$/.test(p) || p === '.' || p === '..')) throw new Error();
      if (root !== state) privateDirectory(root);
      for (let i = 1; i < parts.length; i++) privateDirectory(join(root, ...parts.slice(0, i)));
      return join(root, ...parts);
    };
    const qualification = join(state, 'arc1-qualification');
    const auditPath = resolve(qualification, 'pr1142-native-declarative-v4-recovery-audit.json');
    const ledger = privateEvidence(auditPath, 512 * 1024);
    if (ledger.sha256 !== expected.ledgerHash || privateEvidence(resolve(qualification,
      'pr1142-native-declarative-v4-recovery-audit.md'), 512 * 1024).sha256 !== expected.auditHash) throw new Error();
    const audit = JSON.parse(ledger.body.toString('utf8')) as {
      revision: string; resultHash: string; recoveryFileCount: number;
      recoveryFiles: Record<string, Receipt>; postControlFiles: Record<string, Receipt>;
      externalBindings: Record<string, Receipt>;
    };
    if (audit.revision !== expected.revision || audit.resultHash !== expected.resultHash ||
      audit.recoveryFileCount !== 172 || Object.keys(audit.recoveryFiles).length !== 172 ||
      audit.recoveryFiles['attempt/result.json']?.sha256 !== expected.resultHash ||
      Object.keys(audit.postControlFiles).length !== 3) throw new Error();
    const recovery = resolve(qualification, recoveryName);
    const actual: string[] = [];
    const walk = (name = '', depth = 0) => {
      if (depth > 6) throw new Error();
      const directory = join(recovery, name); privateDirectory(directory);
      for (const child of readdirSync(directory, { withFileTypes: true })) {
        if (child.isSymbolicLink()) throw new Error();
        const next = name ? `${name}/${child.name}` : child.name;
        if (child.isDirectory()) walk(next, depth + 1);
        else { if (!child.isFile() || actual.length >= 172) throw new Error(); actual.push(next); }
      }
    };
    walk();
    if (JSON.stringify(actual.sort()) !== JSON.stringify(Object.keys(audit.recoveryFiles).sort())) throw new Error();
    const verify = (root: string, name: string, receipt: Receipt, readableReport = false) => {
      const saved = privateEvidence(resolve(root, name), name.endsWith('.jpg') ? 8 * 1024 * 1024 : 512 * 1024, readableReport);
      if (saved.sha256 !== receipt.sha256 || saved.body.byteLength !== receipt.bytes) throw new Error();
    };
    for (const [name, receipt] of Object.entries(audit.recoveryFiles)) verify(recovery, name, receipt);
    for (const [name, receipt] of Object.entries(audit.postControlFiles)) verify(resolve(qualification, postName), name, receipt);
    for (const [path, receipt] of Object.entries(audit.externalBindings)) verify(state, relative(state, path), receipt, path.endsWith('.md'));
    // Recheck the controlling ledger after the dependent synchronous file reads.
    if (privateEvidence(auditPath, 512 * 1024).sha256 !== expected.ledgerHash) throw new Error();
  } catch { throw new DeclarativeFailure('v5-history'); }
}
