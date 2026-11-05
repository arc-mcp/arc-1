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
  ORIGINAL_INTENT,
  ORIGINAL_RESULT,
} from '../../../scripts/qualification/pr1142/native-procedural-retained-fixed.js';
import { verifyProceduralRetainedHistory } from '../../../scripts/qualification/pr1142/native-procedural-retained-history.js';
import { retainedHistoryRoots } from '../../../scripts/qualification/pr1142/native-procedural-retained-history-fixed.js';

const sha = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
let state: string, digest: string, ledger: string, first: string, report: string;
beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), 'procedural-history-'));
  const record = (path: string, text: string, mode = 0o600) => {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, text, { mode });
    chmodSync(path, mode);
    return { sha256: sha(text), bytes: Buffer.byteLength(text), mode };
  };
  const roots: Record<string, Record<string, { sha256: string; bytes: number; mode: number }>> = {};
  for (const [root, count] of Object.entries(retainedHistoryRoots)) {
    roots[root] = {};
    for (let i = 0; i < count; i++) {
      const p = join(state, root, `${i}.json`);
      roots[root][`${i}.json`] = record(p, `synthetic ${i}`);
      first ??= p;
    }
  }
  first = join(state, Object.keys(retainedHistoryRoots)[0], '0.json');
  const reports: Record<string, ReturnType<typeof record>> = {};
  for (const name of [
    'audit.md',
    'audit.json',
    'input-ledger-final.json',
    'final-addendum.md',
    'final-addendum.json',
  ]) {
    const relative = `arc1-review/pr1142-native-procedural-execution-audit1/${name}`;
    report = join(state, relative);
    reports[relative] = record(report, 'historical ' + name, 0o644);
  }
  ledger = join(state, 'arc1-review/pr1142-native-procedural-retained-author1/retained-history.json');
  digest = record(
    ledger,
    JSON.stringify({ originalIntent: ORIGINAL_INTENT, originalResult: ORIGINAL_RESULT, roots, reports }),
  ).sha256;
});
afterEach(() => rmSync(state, { recursive: true, force: true }));
it('accepts only exact owned native files and original readable immutable reports', () => {
  expect(() => verifyProceduralRetainedHistory(state, digest)).not.toThrow();
});
it.each(['byte', 'missing', 'extra', 'symlink', 'native-mode', 'report-mode', 'ledger', 'wrong-original'])(
  'refuses %s and leaves all original history in place',
  (fault) => {
    if (fault === 'byte') writeFileSync(first, 'changed');
    if (fault === 'missing') unlinkSync(first);
    if (fault === 'extra') writeFileSync(join(dirname(first), 'extra.json'), 'extra', { mode: 0o600 });
    if (fault === 'symlink') {
      unlinkSync(first);
      symlinkSync(report, first);
    }
    if (fault === 'native-mode') chmodSync(first, 0o644);
    if (fault === 'report-mode') chmodSync(report, 0o666);
    if (fault === 'ledger') writeFileSync(ledger, 'changed');
    if (fault === 'wrong-original') {
      const value = JSON.parse(readFileSync(ledger, 'utf8'));
      value.originalResult = '0'.repeat(64);
      const text = JSON.stringify(value);
      writeFileSync(ledger, text);
      digest = sha(text);
    }
    expect(() => verifyProceduralRetainedHistory(state, digest)).toThrow();
  },
);
