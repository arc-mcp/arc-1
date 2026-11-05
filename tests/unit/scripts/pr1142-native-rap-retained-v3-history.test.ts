import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const prior = vi.hoisted(() => vi.fn());
vi.mock('../../../scripts/qualification/pr1142/native-rap-retained-v2-history.js', () => ({
  verifyRapRetainedV2History: prior,
}));

import { verifyRapRetainedV3History } from '../../../scripts/qualification/pr1142/native-rap-retained-v3-history.js';

const hash = (body: string) => createHash('sha256').update(body).digest('hex');
const temporary: string[] = [];
afterEach(() => {
  temporary.splice(0).forEach((path) => {
    rmSync(path, { recursive: true, force: true });
  });
  prior.mockReset();
});
function packet(fault?: string) {
  const state = mkdtempSync(join(tmpdir(), 'rap-retained-v3-history-'));
  temporary.push(state);
  const root = 'arc1-qualification/pr1142-native-rap-documents-retained-v2';
  const audit = 'arc1-review/pr1142-rap-retained-v2-stop-operator-audit1';
  const files: { path: string; bytes: number; sha256: string }[] = [];
  const write = (path: string, body: string, tracked = true) => {
    const full = join(state, path);
    mkdirSync(join(full, '..'), { recursive: true, mode: 0o700 });
    writeFileSync(full, body, { mode: 0o600 });
    if (tracked) files.push({ path: full, bytes: Buffer.byteLength(body), sha256: hash(body) });
    return full;
  };
  const intent = '{}';
  const result = JSON.stringify({
    failure: fault !== 'success',
    stoppedAt: 'update-document-update',
    confirmedDeleted: fault === 'deleted' ? ['other'] : [],
    created: [],
    mutationDispatched: true,
    completed: fault === 'completed' ? ['update-document-update'] : [],
  });
  write(`${root}/intent.json`, intent);
  write(`${root}/attempt/result.json`, result);
  for (const [path, count] of [
    [root, 637],
    ['arc1-review/pr1142-rap-retained-v2-execution-20261104', 10],
    ['arc1-review/pr1142-rap-retained-v2-post-stop-reads-20261104', 41],
    ['arc1-review/pr1142-rap-retained-v2-stop-assessment1', 5],
  ] as const)
    for (let i = 0; i < count; i++) write(`${path}/${i}.json`, '{}');
  const report = 'bound synthetic report';
  write(`${audit}/result.md`, report, false);
  const ledger = JSON.stringify({
    revision: 'c733b1583a79d6db3b469807f24d1a70e90fdbdf',
    intentHash: hash(intent),
    resultSha256: hash(result),
    rows: 345,
    files,
  });
  write(`${audit}/ledger.json`, ledger, false);
  const independent = Object.fromEntries(
    ['result.md', 'result.json', 'ledger.json'].map((file) => {
      write(`arc1-review/pr1142-rap-retained-v2-stop-independent-audit1/${file}`, 'audit', false);
      return [file, hash('audit')];
    }),
  ) as { 'result.md': string; 'result.json': string; 'ledger.json': string };
  return {
    state,
    root,
    write,
    file: files[2].path,
    expected: { report: hash(report), ledger: hash(ledger), intent: hash(intent), result: hash(result), independent },
  };
}
it('verifies all695 current inputs and calls the original consumed-history verifier', () => {
  const p = packet();
  expect(() => verifyRapRetainedV3History(p.state, p.expected)).not.toThrow();
  expect(prior).toHaveBeenCalledTimes(1);
  expect(prior.mock.calls[0][0]).toBe(p.state);
});
it.each([
  'changed',
  'missing',
  'extra',
  'symlink',
  'mode',
  'ledger',
  'independent',
  'prior',
  'success',
  'deleted',
  'completed',
])('refuses %s history without changing any claim', (fault) => {
  const p = packet(fault);
  if (fault === 'changed') writeFileSync(p.file, 'changed');
  if (fault === 'missing') unlinkSync(p.file);
  if (fault === 'extra') p.write(`${p.root}/extra.json`, '{}', false);
  if (fault === 'mode') chmodSync(p.file, 0o644);
  if (fault === 'ledger') p.expected.ledger = '0'.repeat(64);
  if (fault === 'independent') p.expected.independent['result.md'] = '0'.repeat(64);
  if (fault === 'prior')
    prior.mockImplementation(() => {
      throw new Error('old history changed');
    });
  if (fault === 'symlink') {
    unlinkSync(p.file);
    symlinkSync('intent.json', p.file);
  }
  expect(() => verifyRapRetainedV3History(p.state, p.expected)).toThrow();
});
