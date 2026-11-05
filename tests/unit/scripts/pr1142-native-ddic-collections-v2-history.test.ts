import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { verifyCollectionsV2History } from '../../../scripts/qualification/pr1142/native-ddic-collections-v2-history.js';

const sha = (v: string) => createHash('sha256').update(v).digest('hex');
let state: string,
  protocol: string,
  operator: string,
  auditRoot: string,
  expected: { audit: string; ledger: string; intent: string; result: string };
const original = vi.fn();
const write = (p: string, v: string) => {
  mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
  writeFileSync(p, v, { mode: 0o600 });
  return { bytes: Buffer.byteLength(v), sha256: sha(v) };
};
beforeEach(() => {
  original.mockReset();
  state = mkdtempSync(join(tmpdir(), 'arc1-collections-v2-history-'));
  protocol = join(state, 'arc1-qualification/pr1142-native-ddic-structure-cleanup-v1');
  operator = join(state, 'arc1-review/pr1142-ddic-structure-cleanup-execution-20261103');
  auditRoot = join(state, 'arc1-review/pr1142-ddic-structure-cleanup-execution-audit1');
  const protocolFiles: Record<string, { bytes: number; sha256: string }> = {},
    operatorFiles: typeof protocolFiles = {};
  protocolFiles['intent.json'] = write(join(protocol, 'intent.json'), 'synthetic intent');
  protocolFiles['attempt/result.json'] = write(
    join(protocol, 'attempt/result.json'),
    'synthetic successful cleanup result',
  );
  for (let i = 0; i < 153; i++)
    protocolFiles[`attempt/run/${i}.json`] = write(join(protocol, 'attempt/run', `${i}.json`), `row ${i}`);
  for (let i = 0; i < 12; i++) operatorFiles[`${i}.json`] = write(join(operator, `${i}.json`), `operator ${i}`);
  expected = {
    audit: write(join(auditRoot, 'audit.md'), 'Synthetic audited cleanup').sha256,
    ledger: '',
    intent: protocolFiles['intent.json'].sha256,
    result: protocolFiles['attempt/result.json'].sha256,
  };
  const audit = {
    sourceRevision: '798936069fd314a63e06fcce9978456ac37b2432',
    intentSha256: expected.intent,
    resultSha256: expected.result,
    auditReportSha256: expected.audit,
    sourceCleanAndEntryLockMatched: true,
    protocolFilesUnchanged: 155,
    operatorFilesUnchanged: 12,
    originalEvidenceFilesUnchanged: 96,
    result: {
      failure: false,
      stopped: false,
      mutationAttempted: true,
      mutationDispatched: true,
      completed: ['delete-TABL/DS'],
      created: [],
      confirmedDeleted: ['/sap/bc/adt/ddic/structures/ZSCC0B9644EAD7A6'],
      remaining: [],
      inspectionRequired: [],
      cleanupUnconfirmed: false,
      finalAbsenceConfirmed: true,
    },
    files: { protocol: { root: protocol, files: protocolFiles }, operator: { root: operator, files: operatorFiles } },
  };
  expected.ledger = write(join(auditRoot, 'audit.json'), JSON.stringify(audit)).sha256;
});
afterEach(() => rmSync(state, { recursive: true, force: true }));
const verify = () => verifyCollectionsV2History(state, expected, original);
it('rechecks the original failure and all 167 cleanup/operator files without rewriting them', () => {
  const before = readFileSync(join(auditRoot, 'audit.json'));
  expect(verify).not.toThrow();
  expect(original).toHaveBeenCalledOnce();
  expect(readFileSync(join(auditRoot, 'audit.json'))).toEqual(before);
});
it.each([
  'original',
  'intent',
  'result',
  'row',
  'operator',
  'audit',
  'ledger',
  'extra',
  'missing',
  'symlink',
  'mode',
  'audit-directory-mode',
  'audit-directory-symlink',
] as const)('refuses changed %s evidence', (fault) => {
  const row = join(protocol, 'attempt/run/0.json');
  if (fault === 'original')
    original.mockImplementation(() => {
      throw new Error();
    });
  if (fault === 'intent') writeFileSync(join(protocol, 'intent.json'), 'changed');
  if (fault === 'result') writeFileSync(join(protocol, 'attempt/result.json'), 'changed');
  if (fault === 'row') writeFileSync(row, 'changed');
  if (fault === 'operator') writeFileSync(join(operator, '0.json'), 'changed');
  if (fault === 'audit') writeFileSync(join(auditRoot, 'audit.md'), 'changed');
  if (fault === 'ledger') writeFileSync(join(auditRoot, 'audit.json'), '{}');
  if (fault === 'extra') write(join(operator, 'extra.json'), 'extra');
  if (fault === 'missing') unlinkSync(row);
  if (fault === 'symlink') {
    unlinkSync(row);
    symlinkSync(join(operator, '0.json'), row);
  }
  if (fault === 'mode') chmodSync(row, 0o644);
  if (fault === 'audit-directory-mode') chmodSync(auditRoot, 0o755);
  if (fault === 'audit-directory-symlink') {
    renameSync(auditRoot, auditRoot + '-original');
    symlinkSync(auditRoot + '-original', auditRoot);
  }
  expect(verify).toThrow('evidence changed');
});
it.each([
  'failed',
  'absent',
  'remaining',
  'inspection',
  'cleanup',
  'owner',
  'source',
  'root',
  'traversal',
  'count',
] as const)('refuses false %s audit assertions even at the synthetic digest seam', (fault) => {
  const path = join(auditRoot, 'audit.json'),
    a = JSON.parse(readFileSync(path, 'utf8'));
  if (fault === 'failed') a.result.failure = true;
  if (fault === 'absent') a.result.finalAbsenceConfirmed = false;
  if (fault === 'remaining') a.result.remaining = ['foreign'];
  if (fault === 'inspection') a.result.inspectionRequired = ['foreign'];
  if (fault === 'cleanup') a.result.cleanupUnconfirmed = true;
  if (fault === 'owner') a.result.confirmedDeleted = ['/foreign'];
  if (fault === 'source') a.sourceRevision = 'b'.repeat(40);
  if (fault === 'root') a.files.protocol.root = operator;
  if (fault === 'traversal') {
    a.files.protocol.files['../outside'] = a.files.protocol.files['attempt/run/0.json'];
    delete a.files.protocol.files['attempt/run/0.json'];
  }
  if (fault === 'count') delete a.files.operator.files['0.json'];
  expected.ledger = write(path, JSON.stringify(a)).sha256;
  expect(verify).toThrow('evidence changed');
});
