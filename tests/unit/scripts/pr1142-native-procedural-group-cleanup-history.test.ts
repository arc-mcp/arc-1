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
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  GROUP_CLEANUP_INTENT,
  GROUP_CLEANUP_RESULT,
  groupCleanupHistoryReports,
  groupCleanupHistoryRoots,
} from '../../../scripts/qualification/pr1142/native-procedural-group-cleanup-fixed.js';
import { verifyProceduralGroupCleanupHistory } from '../../../scripts/qualification/pr1142/native-procedural-group-cleanup-history.js';

const sha = (v: string) => createHash('sha256').update(v).digest('hex');
let state: string, ledger: string, first: string, digest: string;
const old = vi.fn();
beforeEach(() => {
  old.mockReset();
  state = mkdtempSync(join(tmpdir(), 'procedural-tail-history-'));
  const record = (path: string, body: string, mode = 0o600) => {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, body, { mode });
    chmodSync(path, mode);
    return { sha256: sha(body), bytes: Buffer.byteLength(body), mode, uid: process.getuid!(), gid: process.getgid!() };
  };
  const roots: Record<string, Record<string, ReturnType<typeof record>>> = {};
  for (const [root, count] of Object.entries(groupCleanupHistoryRoots)) {
    roots[root] = {};
    for (let i = 0; i < count; i++) roots[root][`${i}.json`] = record(join(state, root, `${i}.json`), `synthetic ${i}`);
  }
  first = join(state, Object.keys(groupCleanupHistoryRoots)[0], '0.json');
  const reports = Object.fromEntries(
    groupCleanupHistoryReports.map((path) => [path, record(join(state, path), 'synthetic audit', 0o644)]),
  );
  ledger = join(state, 'arc1-review/pr1142-procedural-group-cleanup-author1/historical.json');
  digest = record(
    ledger,
    JSON.stringify({ intent: GROUP_CLEANUP_INTENT, result: GROUP_CLEANUP_RESULT, roots, reports }),
  ).sha256;
});
afterEach(() => rmSync(state, { recursive: true, force: true }));
it('binds the prior chained history verifier and all1294 latest receipts plus audits without mutation', () => {
  expect(() => verifyProceduralGroupCleanupHistory(state, digest, old)).not.toThrow();
  expect(old).toHaveBeenCalledOnce();
});
it.each(['byte', 'missing', 'extra', 'symlink', 'mode', 'ledger', 'identity', 'gid', 'old-history'])(
  'refuses %s',
  (fault) => {
    if (fault === 'byte') writeFileSync(first, 'changed');
    if (fault === 'missing') unlinkSync(first);
    if (fault === 'extra') writeFileSync(join(dirname(first), 'extra.json'), 'extra', { mode: 0o600 });
    if (fault === 'symlink') {
      unlinkSync(first);
      symlinkSync(join(state, groupCleanupHistoryReports[0]), first);
    }
    if (fault === 'mode') chmodSync(first, 0o644);
    if (fault === 'ledger') writeFileSync(ledger, 'changed');
    if (fault === 'old-history')
      old.mockImplementation(() => {
        throw Error('original changed');
      });
    if (fault === 'identity' || fault === 'gid') {
      const v = JSON.parse(readFileSync(ledger, 'utf8'));
      if (fault === 'identity') v.result = '0'.repeat(64);
      else v.roots[Object.keys(groupCleanupHistoryRoots)[0]]['0.json'].gid += 1;
      const text = JSON.stringify(v);
      writeFileSync(ledger, text);
      digest = sha(text);
    }
    expect(() => verifyProceduralGroupCleanupHistory(state, digest, old)).toThrow();
  },
);
