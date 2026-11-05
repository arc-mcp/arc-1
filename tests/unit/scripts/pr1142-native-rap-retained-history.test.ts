import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { RAP_RETAINED_COMPLETED } from '../../../scripts/qualification/pr1142/native-rap-retained-fixed.js';
import { verifyRapRetainedHistory } from '../../../scripts/qualification/pr1142/native-rap-retained-history.js';

const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const roots: string[] = [];
afterEach(() =>
  roots.splice(0).forEach((p) => {
    rmSync(p, { recursive: true, force: true });
  }),
);
function packet() {
  const state = mkdtempSync(join(tmpdir(), 'arc1-rap-history-'));
  roots.push(state);
  const original = 'arc1-qualification/pr1142-native-rap-documents-v1',
    audit = 'arc1-review/pr1142-rap-documents-stop-operator-audit1';
  const files: { path: string; bytes: number; sha256: string; mode: string; uid: number | undefined }[] = [];
  const write = (p: string, body: string, tracked = true) => {
    const path = join(state, p);
    mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 });
    writeFileSync(path, body, { mode: 0o600 });
    if (tracked)
      files.push({ path, bytes: Buffer.byteLength(body), sha256: hash(body), mode: '600', uid: process.getuid?.() });
    return path;
  };
  const intent = '{"fixed":"synthetic"}',
    result = JSON.stringify({
      failure: true,
      stoppedAt: 'create-document',
      confirmedDeleted: [],
      completed: RAP_RETAINED_COMPLETED,
    });
  write(`${original}/intent.json`, intent);
  write(`${original}/attempt/result.json`, result);
  for (const [root, n] of [
    [original, 1176],
    ['arc1-review/pr1142-rap-documents-execution-20261104', 11],
    ['arc1-review/pr1142-rap-documents-post-stop-reads-20261104', 41],
  ] as const)
    for (let i = 0; i < n; i++) write(`${root}/e${i}.json`, '{}');
  const report = 'synthetic bound audit';
  write(`${audit}/result.md`, report, false);
  const ledger = JSON.stringify({
    revision: 'c9b3da1b3d1bc0fd5b4f4cbeeda31f36250786b5',
    intentHash: hash(intent),
    resultSha256: hash(result),
    journalRows: 1122,
    completed: RAP_RETAINED_COMPLETED,
    files,
  });
  write(`${audit}/ledger.json`, ledger, false);
  return {
    state,
    expected: { report: hash(report), ledger: hash(ledger), intent: hash(intent), result: hash(result) },
    file: files[2].path,
    write,
    original,
  };
}
it('verifies the complete fixed history graph with independent root membership', () => {
  const p = packet();
  expect(() => verifyRapRetainedHistory(p.state, p.expected)).not.toThrow();
});
it.each(['changed', 'missing', 'extra', 'symlink', 'mode', 'audit', 'ledger'])(
  'refuses %s history without changing the original graph',
  (fault) => {
    const p = packet();
    if (fault === 'changed') writeFileSync(p.file, 'changed');
    if (fault === 'missing') unlinkSync(p.file);
    if (fault === 'extra') p.write(`${p.original}/foreign.json`, '{}', false);
    if (fault === 'symlink') {
      unlinkSync(p.file);
      symlinkSync('intent.json', p.file);
    }
    if (fault === 'mode') chmodSync(p.file, 0o644);
    if (fault === 'audit') p.expected.report = '0'.repeat(64);
    if (fault === 'ledger') p.expected.ledger = '0'.repeat(64);
    expect(() => verifyRapRetainedHistory(p.state, p.expected)).toThrow();
  },
);
