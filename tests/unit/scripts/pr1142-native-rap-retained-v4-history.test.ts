import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const prior = vi.hoisted(() => vi.fn());
vi.mock('../../../scripts/qualification/pr1142/native-rap-retained-v3-history.js', () => ({
  verifyRapRetainedV3History: prior,
}));

import { verifyRapRetainedV4History } from '../../../scripts/qualification/pr1142/native-rap-retained-v4-history.js';

const hash = (body: string) => createHash('sha256').update(body).digest('hex');
const temporary: string[] = [];
afterEach(() => {
  temporary.splice(0).forEach((path) => {
    rmSync(path, { recursive: true, force: true });
  });
  prior.mockReset();
});
function packet(fault?: string) {
  const state = mkdtempSync(join(tmpdir(), 'rap-retained-v4-history-'));
  temporary.push(state);
  const root = 'arc1-qualification/pr1142-native-rap-documents-retained-v3';
  const audit = 'arc1-review/pr1142-rap-retained-v3-stop-operator-audit2';
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
    stoppedAt: 'activate-binding',
    confirmedDeleted: fault === 'deleted' ? ['other'] : [],
    created: ['service', 'binding'],
    remaining: Array(8).fill('owner'),
    publicationOperations: [],
    mutationDispatched: true,
    completed:
      fault === 'completed'
        ? ['activate-binding']
        : ['activate-document-updated', 'create-service', 'activate-service', 'create-binding'],
  });
  write(`${root}/intent.json`, intent);
  write(`${root}/attempt/result.json`, result);
  write(
    `${root}/attempt/run/00620.json`,
    JSON.stringify({
      value: { status: 200, sha256: 'c133bb966fcddec726a0314273490d805f43b1feaf39701442184025aff815d9' },
    }),
  );
  write(
    `${root}/attempt/run/00623.json`,
    JSON.stringify({
      value: { status: 200, sha256: '581b50b79cb750455cd68ffe9bf978140396bf4d6f90fef96098544fb1d66dff' },
    }),
  );
  for (const [path, count] of [
    [root, 915],
    ['arc1-review/pr1142-rap-retained-v3-binding-execution-20261104', 11],
    ['arc1-review/pr1142-rap-retained-v3-post-stop-reads-20261104', 44],
    ['arc1-review/pr1142-rap-retained-v3-binding-reads-20261104', 11],
  ] as const)
    for (let i = 0; i < count; i++) write(`${path}/${i}.json`, '{}');
  const report = 'bound synthetic report';
  write(`${audit}/result.md`, report, false);
  const ledger = JSON.stringify({
    revision: '37dd23fce3264a735f8e92ad9d3cd2e5076a78b6',
    intentHash: hash(intent),
    resultSha256: hash(result),
    rows: 625,
    files,
  });
  write(`${audit}/ledger.json`, ledger, false);
  const independent = Object.fromEntries(
    ['result.md', 'ledger.json'].map((file) => {
      write(`arc1-review/pr1142-rap-retained-v3-stop-independent-audit1/${file}`, 'audit', false);
      return [file, hash('audit')];
    }),
  ) as { 'result.md': string; 'ledger.json': string };
  return {
    state,
    root,
    write,
    file: files[2].path,
    expected: { report: hash(report), ledger: hash(ledger), intent: hash(intent), result: hash(result), independent },
  };
}
it('verifies all985 current inputs and calls the original consumed-history verifier', () => {
  const p = packet();
  expect(() => verifyRapRetainedV4History(p.state, p.expected)).not.toThrow();
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
  expect(() => verifyRapRetainedV4History(p.state, p.expected)).toThrow();
});
