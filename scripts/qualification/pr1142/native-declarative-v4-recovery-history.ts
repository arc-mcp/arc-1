/** Only reads fixed retained evidence; never repairs/removes a historical claim or file. */
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { privateEvidence } from './native-declarative-prerequisites.js';
import { v4OriginalResultHash, v4RecoveryEvidence } from './native-declarative-v4-recovery-fixed.js';
import { DeclarativeFailure } from './native-declarative-workflow.js';
import { privateDirectory } from './native-lock-binding.js';

/** Explicit root/hashes are isolated offline test seams; the fixed entry supplies none. */
export function verifyOriginalV4Failure(
  state = join(homedir(), '.local/state'),
  evidence: Readonly<Record<string, string>> = v4RecoveryEvidence,
  resultHash = v4OriginalResultHash,
) {
  try {
    const resolve = (root: string, name: string) => {
      const parts = name.split('/');
      if (parts.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part) || part === '.' || part === '..')) throw new Error();
      for (let i = 1; i < parts.length; i++) privateDirectory(join(root, ...parts.slice(0, i)));
      return join(root, ...parts);
    };
    for (const [name, expected] of Object.entries(evidence))
      if (privateEvidence(resolve(state, name), 512 * 1024).sha256 !== expected) throw new Error();
    const audit = JSON.parse(
      privateEvidence(
        resolve(state, 'arc1-qualification/pr1142-native-declarative-v4-failure-audit.json'),
        512 * 1024,
      ).body.toString('utf8'),
    ) as {
      resultHash: string;
      originalFiles: Record<string, { bytes: number; sha256: string }>;
    };
    if (audit.resultHash !== resultHash || Object.keys(audit.originalFiles).length !== 622) throw new Error();
    const original = resolve(state, 'arc1-qualification/pr1142-native-declarative-v4');
    const actual: string[] = [];
    const walk = (relative = '', depth = 0) => {
      if (depth > 6) throw new Error();
      const directory = join(original, relative);
      privateDirectory(directory);
      for (const child of readdirSync(directory, { withFileTypes: true })) {
        if (child.isSymbolicLink()) throw new Error();
        const name = relative ? `${relative}/${child.name}` : child.name;
        if (child.isDirectory()) walk(name, depth + 1);
        else {
          if (!child.isFile() || actual.length >= 622) throw new Error();
          actual.push(name);
        }
      }
    };
    walk();
    if (JSON.stringify(actual.sort()) !== JSON.stringify(Object.keys(audit.originalFiles).sort())) throw new Error();
    for (const [name, receipt] of Object.entries(audit.originalFiles)) {
      const saved = privateEvidence(resolve(original, name), name.endsWith('.jpg') ? 8 * 1024 * 1024 : 512 * 1024);
      if (saved.sha256 !== receipt.sha256 || saved.body.byteLength !== receipt.bytes) throw new Error();
    }
  } catch {
    throw new DeclarativeFailure('recovery-original');
  }
}
