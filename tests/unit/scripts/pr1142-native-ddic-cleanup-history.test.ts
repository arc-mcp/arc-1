import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  STRUCTURE_RECEIPT,
  STRUCTURE_SUFFIX,
  structureCleanupFixtures,
} from '../../../scripts/qualification/pr1142/native-ddic-structure-cleanup-fixed.js';
import { verifyStructureCleanupHistory } from '../../../scripts/qualification/pr1142/native-ddic-structure-cleanup-history.js';

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
let root: string,
  protocol: string,
  operator: string,
  auditRoot: string,
  expected: { audit: string; ledger: string; intent: string; result: string };
const write = (path: string, value: string) => {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, value, { mode: 0o600 });
  return { sha256: sha(value), bytes: Buffer.byteLength(value) };
};
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'arc1-ddic-cleanup-history-'));
  protocol = join(root, 'arc1-qualification/pr1142-native-ddic-collections-v1');
  operator = join(root, 'arc1-review/pr1142-native-ddic-collections-execution-20261103');
  auditRoot = join(root, 'arc1-review/pr1142-native-ddic-collections-execution-audit1');
  const protocolFiles: Record<string, { sha256: string; bytes: number }> = {},
    operatorFiles: typeof protocolFiles = {};
  protocolFiles['intent.json'] = write(join(protocol, 'intent.json'), 'synthetic original intent');
  protocolFiles['attempt/result.json'] = write(join(protocol, 'attempt/result.json'), 'synthetic failed result');
  for (let i = 0; i < 76; i++)
    protocolFiles[`attempt/run/${i}.json`] = write(join(protocol, 'attempt/run', `${i}.json`), `synthetic row ${i}`);
  for (let i = 0; i < 18; i++)
    operatorFiles[`${i}.json`] = write(join(operator, `${i}.json`), `synthetic independent read ${i}`);
  const audit = {
    revision: '757a7cef0e3a4bec73f08fb59ab29c964572bc05',
    resultSha256: protocolFiles['attempt/result.json'].sha256,
    nativeVersion: 'new',
    retainedSourceSha256: STRUCTURE_RECEIPT.sourceHash,
    remaining: [structureCleanupFixtures(STRUCTURE_SUFFIX)[0].owner],
    protocolFiles,
    operatorFiles,
  };
  expected = {
    audit: write(join(auditRoot, 'audit.md'), 'Synthetic audited failure').sha256,
    ledger: write(join(auditRoot, 'audit.json'), JSON.stringify(audit)).sha256,
    intent: protocolFiles['intent.json'].sha256,
    result: protocolFiles['attempt/result.json'].sha256,
  };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
it('binds every original and operator file without rewriting their bytes', () => {
  const before = readFileSync(join(auditRoot, 'audit.json'));
  expect(() => verifyStructureCleanupHistory(root, expected)).not.toThrow();
  expect(readFileSync(join(auditRoot, 'audit.json'))).toEqual(before);
});
it.each([
  'old-intent',
  'old-result',
  'old-row',
  'operator-row',
  'ledger',
  'audit',
  'extra',
  'missing',
  'symlink',
  'world-readable',
])('refuses altered %s history', (fault) => {
  const target = join(protocol, 'attempt/run/0.json');
  if (fault === 'old-intent') writeFileSync(join(protocol, 'intent.json'), 'changed');
  else if (fault === 'old-result') writeFileSync(join(protocol, 'attempt/result.json'), 'changed');
  else if (fault === 'old-row') writeFileSync(target, 'changed');
  else if (fault === 'operator-row') writeFileSync(join(operator, '0.json'), 'changed');
  else if (fault === 'ledger') writeFileSync(join(auditRoot, 'audit.json'), '{}');
  else if (fault === 'audit') writeFileSync(join(auditRoot, 'audit.md'), 'changed');
  else if (fault === 'extra') write(join(protocol, 'extra.json'), 'extra');
  else if (fault === 'missing') unlinkSync(target);
  else if (fault === 'symlink') {
    unlinkSync(target);
    symlinkSync(join(operator, '0.json'), target);
  } else chmodSync(target, 0o644);
  expect(() => verifyStructureCleanupHistory(root, expected)).toThrow('evidence changed');
});
it('does not infer absence from an empty created array or accept changed retained-state evidence', () => {
  const path = join(auditRoot, 'audit.json'),
    audit = JSON.parse(readFileSync(path, 'utf8'));
  audit.remaining = [];
  audit.created = [];
  expected.ledger = write(path, JSON.stringify(audit)).sha256;
  expect(() => verifyStructureCleanupHistory(root, expected)).toThrow('evidence changed');
});
