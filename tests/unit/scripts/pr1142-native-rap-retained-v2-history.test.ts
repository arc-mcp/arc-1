import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const prior = vi.hoisted(() => vi.fn());
vi.mock('../../../scripts/qualification/pr1142/native-rap-retained-history.js', () => ({
  verifyRapRetainedHistory: prior,
}));

import { verifyRapRetainedV2History } from '../../../scripts/qualification/pr1142/native-rap-retained-v2-history.js';

const hash = (body: string) => createHash('sha256').update(body).digest('hex');
const temporary: string[] = [];
afterEach(() => {
  temporary.splice(0).forEach((path) => {
    rmSync(path, { recursive: true, force: true });
  });
  prior.mockReset();
});
function packet(fault?: string) {
  const state = mkdtempSync(join(tmpdir(), 'rap-retained-v2-history-'));
  temporary.push(state);
  const root = 'arc1-qualification/pr1142-native-rap-documents-retained-v1';
  const audit = 'arc1-review/pr1142-rap-retained-stop-operator-audit1';
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
    stoppedAt: 'update-document-create',
    confirmedDeleted: fault === 'deleted' ? ['other'] : [],
    created: [],
    mutationDispatched: true,
    completed: fault === 'completed' ? ['update-document-create'] : ['update-document-root', 'activate-document'],
  });
  write(`${root}/intent.json`, intent);
  write(`${root}/attempt/result.json`, result);
  for (const [path, count] of [
    [root, 776],
    ['arc1-review/pr1142-rap-retained-execution-20261104', 10],
    ['arc1-review/pr1142-rap-retained-post-stop-reads-20261104', 41],
    ['arc1-review/pr1142-rap-retained-stop-assessment1', 8],
  ] as const)
    for (let i = 0; i < count; i++) write(`${path}/${i}.json`, '{}');
  const report = 'bound synthetic report';
  write(`${audit}/result.md`, report, false);
  const ledger = JSON.stringify({
    revision: '9748d084f7656064350cfe3735983f22472f3eaf',
    intentHash: hash(intent),
    resultSha256: hash(result),
    journalRows: 485,
    files,
  });
  write(`${audit}/ledger.json`, ledger, false);
  return {
    state,
    root,
    write,
    file: files[2].path,
    expected: { report: hash(report), ledger: hash(ledger), intent: hash(intent), result: hash(result) },
  };
}
it('verifies all837 current inputs and calls the original consumed-history verifier', () => {
  const p = packet();
  expect(() => verifyRapRetainedV2History(p.state, p.expected)).not.toThrow();
  expect(prior).toHaveBeenCalledTimes(1);
  expect(prior.mock.calls[0][0]).toBe(p.state);
});
it.each(['changed', 'missing', 'extra', 'symlink', 'mode', 'ledger', 'prior', 'success', 'deleted', 'completed'])(
  'refuses %s history without changing any claim',
  (fault) => {
    const p = packet(fault);
    if (fault === 'changed') writeFileSync(p.file, 'changed');
    if (fault === 'missing') unlinkSync(p.file);
    if (fault === 'extra') p.write(`${p.root}/extra.json`, '{}', false);
    if (fault === 'mode') chmodSync(p.file, 0o644);
    if (fault === 'ledger') p.expected.ledger = '0'.repeat(64);
    if (fault === 'prior')
      prior.mockImplementation(() => {
        throw new Error('old history changed');
      });
    if (fault === 'symlink') {
      unlinkSync(p.file);
      symlinkSync('intent.json', p.file);
    }
    expect(() => verifyRapRetainedV2History(p.state, p.expected)).toThrow();
  },
);
