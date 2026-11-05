/** Read-only binding of the consumed attempt and separately observed retained owners. */
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { privateEvidence } from './native-declarative-prerequisites.js';
import { privateDirectory } from './native-lock-binding.js';
import {
  packageOriginalResultHash,
  packageRecoveryExternalProofs,
  packageRecoveryHistory,
} from './native-package-recovery-fixed.js';

type Ledger = Record<string, { bytes: number; sha256: string }>;
export function privatePackageHistoryPath(root: string, name: string) {
  const parts = name.split('/');
  if (parts.some((p) => !/^[A-Za-z0-9_.-]+$/.test(p) || p === '.' || p === '..')) throw new Error();
  for (let i = 1; i < parts.length; i++) privateDirectory(join(root, ...parts.slice(0, i)));
  return join(root, ...parts);
}
export function verifyPackageHistoryLedger(root: string, files: Ledger, count: number, exact: boolean) {
  privateDirectory(root);
  if (Object.keys(files).length !== count) throw new Error();
  if (exact) {
    const names: string[] = [];
    const walk = (relative = '', depth = 0) => {
      if (depth > 6) throw new Error();
      const directory = join(root, relative);
      privateDirectory(directory);
      for (const child of readdirSync(directory, { withFileTypes: true })) {
        const name = relative ? `${relative}/${child.name}` : child.name;
        if (child.isSymbolicLink()) throw new Error();
        if (child.isDirectory()) walk(name, depth + 1);
        else {
          if (!child.isFile() || names.length >= count) throw new Error();
          names.push(name);
        }
      }
    };
    walk();
    if (JSON.stringify(names.sort()) !== JSON.stringify(Object.keys(files).sort())) throw new Error();
  }
  for (const [name, receipt] of Object.entries(files)) {
    const file = privateEvidence(
      privatePackageHistoryPath(root, name),
      name.endsWith('.jpg') ? 8 * 1024 * 1024 : 512 * 1024,
    );
    if (file.sha256 !== receipt.sha256 || file.body.byteLength !== receipt.bytes) throw new Error();
  }
}

/** Optional roots/hashes are offline test seams. The fixed entry passes neither. */
export function verifyPackageRecoveryHistory(
  state = join(homedir(), '.local/state'),
  expected: Readonly<Record<string, string>> = packageRecoveryHistory,
) {
  const resolve = privatePackageHistoryPath,
    verifyLedger = verifyPackageHistoryLedger;
  try {
    for (const [path, hash] of Object.entries(expected))
      if (privateEvidence(resolve(state, path), 512 * 1024).sha256 !== hash) throw new Error();
    const audit = JSON.parse(
      privateEvidence(
        resolve(state, 'arc1-qualification/pr1142-native-local-package-audit.json'),
        512 * 1024,
      ).body.toString('utf8'),
    );
    if (
      audit.revision !== 'fc14a7465cf10eed29b5e0291f33b3310e8a5ac0' ||
      audit.resultSha256 !== packageOriginalResultHash
    )
      throw new Error();
    if (Object.keys(audit.externalBindings).length !== packageRecoveryExternalProofs.length) throw new Error();
    for (const name of packageRecoveryExternalProofs) {
      const receipt = audit.externalBindings[join(state, name)];
      // Existing non-secret review reports are 0644 inside verified 0700 directories.
      // Preserve their permissions and bytes; raw protocol/inspection evidence still uses privateEvidence.
      const fd = openSync(resolve(state, name), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.size > 512 * 1024 || stat.uid !== process.getuid?.()) throw new Error();
        const body = readFileSync(fd);
        if (
          !receipt ||
          body.byteLength !== receipt.bytes ||
          createHash('sha256').update(body).digest('hex') !== receipt.sha256
        )
          throw new Error();
      } finally {
        closeSync(fd);
      }
    }
    verifyLedger(resolve(state, 'arc1-qualification/pr1142-native-local-package-v1'), audit.originalFiles, 256, true);
    const operator = resolve(state, 'arc1-review/pr1142-native-package-execution-20261103');
    verifyLedger(operator, audit.operatorFiles, 9, false);
    verifyLedger(join(operator, 'retained-inspection'), audit.retainedInspectionFiles, 15, true);
  } catch {
    throw new Error('Original package attempt or retained-owner evidence changed.');
  }
}
