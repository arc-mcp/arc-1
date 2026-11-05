import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  packageOriginalResultHash,
  packageRecoveryExternalProofs,
} from '../../../scripts/qualification/pr1142/native-package-recovery-fixed.js';
import { verifyPackageRecoveryHistory } from '../../../scripts/qualification/pr1142/native-package-recovery-history.js';

let state: string, expected: Record<string, string>, protocol: string, operator: string;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), 'arc1-package-history-'));
  protocol = join(state, 'arc1-qualification/pr1142-native-local-package-v1');
  operator = join(state, 'arc1-review/pr1142-native-package-execution-20261103');
  const make = (dir: string, count: number) => {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const files: Record<string, { bytes: number; sha256: string }> = {};
    for (let i = 0; i < count; i++) {
      const name = `${i}.json`,
        body = `synthetic ${i}`;
      writeFileSync(join(dir, name), body, { mode: 0o600 });
      files[name] = { bytes: Buffer.byteLength(body), sha256: sha(body) };
    }
    return files;
  };
  const externalBindings: Record<string, { sha256: string; bytes: number }> = {};
  for (const name of packageRecoveryExternalProofs) {
    const path = join(state, name),
      body = 'synthetic proof';
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, body, { mode: 0o600 });
    externalBindings[path] = { sha256: sha(body), bytes: Buffer.byteLength(body) };
  }
  const audit = {
    externalBindings,
    revision: 'fc14a7465cf10eed29b5e0291f33b3310e8a5ac0',
    resultSha256: packageOriginalResultHash,
    originalFiles: make(protocol, 256),
    operatorFiles: make(operator, 9),
    retainedInspectionFiles: make(join(operator, 'retained-inspection'), 15),
  };
  expected = {};
  for (const [extension, body] of [
    ['json', JSON.stringify(audit)],
    ['md', 'synthetic audit'],
  ]) {
    const path = `arc1-qualification/pr1142-native-local-package-audit.${extension}`;
    writeFileSync(join(state, path), body, { mode: 0o600 });
    expected[path] = sha(body);
  }
});
afterEach(() => rmSync(state, { recursive: true, force: true }));
it('verifies all original, operator and fresh retained-inspection files against the bound audit', () => {
  expect(() => verifyPackageRecoveryHistory(state, expected)).not.toThrow();
});
it.each(['original', 'inspection', 'external', 'audit', 'extra', 'symlink', 'permissions', 'directory'] as const)(
  'rejects %s drift without changing any evidence',
  (fault) => {
    if (fault === 'external') writeFileSync(join(state, packageRecoveryExternalProofs[0]), 'changed');
    if (fault === 'original') writeFileSync(join(protocol, '1.json'), 'changed');
    if (fault === 'inspection') writeFileSync(join(operator, 'retained-inspection/1.json'), 'changed');
    if (fault === 'audit') writeFileSync(join(state, Object.keys(expected)[0]), 'changed');
    if (fault === 'extra') writeFileSync(join(protocol, 'extra'), 'x', { mode: 0o600 });
    if (fault === 'symlink') {
      rmSync(join(protocol, '1.json'));
      symlinkSync(join(protocol, '2.json'), join(protocol, '1.json'));
    }
    if (fault === 'permissions') chmodSync(join(operator, '1.json'), 0o644);
    if (fault === 'directory') chmodSync(operator, 0o755);
    expect(() => verifyPackageRecoveryHistory(state, expected)).toThrow('evidence changed');
  },
);

it('retains existing non-secret review reports protected by a private parent without changing their mode', () => {
  chmodSync(join(state, packageRecoveryExternalProofs[0]), 0o644);
  expect(() => verifyPackageRecoveryHistory(state, expected)).not.toThrow();
});
