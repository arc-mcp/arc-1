import { createHash } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CTS_RETAINED_V5_ORIGIN } from '../../../scripts/qualification/pr1142/native-cts-fixtures.js';
import { retainedCtsV5History } from '../../../scripts/qualification/pr1142/native-cts-retained-v5-history.js';

const audit = 'arc1-review/pr1142-cts-retained-v4-A-independent-audit1',
  native = 'arc1-qualification/pr1142-native-cts-retained-v4',
  operator = 'arc1-review/pr1142-cts-retained-v4-execution-20261105',
  current = 'arc1-review/pr1142-cts-retained-v4-current-inspection-20261105';
const hash = (b: string) => createHash('sha256').update(b).digest('hex');
let state: string, expected: NonNullable<Parameters<typeof retainedCtsV5History>[1]>, valid: boolean;
const older = vi.fn(() => {
  if (!valid) throw Error('old history changed');
});
function write(p: string, value: unknown = {}) {
  const f = join(state, p),
    body = JSON.stringify(value);
  mkdirSync(dirname(f), { recursive: true, mode: 0o700 });
  writeFileSync(f, body, { mode: 0o600 });
  const s = lstatSync(f);
  return { sha256: hash(body), bytes: Buffer.byteLength(body), mode: '0o600', uid: s.uid, gid: s.gid };
}
beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), 'cts-v5-history-'));
  valid = true;
  older.mockClear();
  expected = { ...CTS_RETAINED_V5_ORIGIN.consumedRetainedV4 };
  const groups: Record<string, Record<string, ReturnType<typeof write>>> = {};
  for (const [root, count] of [
    [native, 183],
    [operator, 15],
    [current, 6],
  ] as const) {
    const rows: Record<string, ReturnType<typeof write>> = {};
    for (let i = 0; i < count; i++) rows[join(state, root, `${i}.json`)] = write(`${root}/${i}.json`);
    groups[join(state, root)] = rows;
  }
  const rows = groups[join(state, native)];
  for (const n of ['0.json', '1.json']) {
    rmSync(join(state, native, n));
    delete rows[join(state, native, n)];
  }
  rows[join(state, native, 'intent.json')] = write(native + '/intent.json', {
    protocol: 'pr1142-native-cts-retained-v4',
  });
  expected.intentHash = rows[join(state, native, 'intent.json')].sha256;
  rows[join(state, native, 'A/attempt/result.json')] = write(native + '/A/attempt/result.json', {
    failure: true,
    completed: [],
    confirmedReleased: [],
    dispatchedMutations: 1,
    current: { A4HK906607: 'unknown', A4HK906608: 'unknown' },
  });
  expected.resultHash = rows[join(state, native, 'A/attempt/result.json')].sha256;
  for (const p of ['B/preflight', 'C/preflight']) mkdirSync(join(state, native, p), { recursive: true, mode: 0o700 });
  const history: Record<string, ReturnType<typeof write>> = {};
  for (let i = 0; i < 1503; i++) history[join(state, `arc1-review/old/${i}.json`)] = write(`arc1-review/old/${i}.json`);
  const files: Record<string, ReturnType<typeof write>> = {};
  files['inputs-after.json'] = write(audit + '/inputs-after.json', groups);
  files['history-inputs.json'] = write(audit + '/history-inputs.json', history);
  files['result.md'] = write(audit + '/result.md', 'failed means failed');
  expected.reportHash = files['result.md'].sha256;
  files['result.json'] = write(audit + '/result.json', {
    sourceRevision: expected.revision,
    intentHash: expected.intentHash,
    failedResultHash: expected.resultHash,
    currentFilesUnchanged: 204,
    historicalFilesUnchanged: 1503,
    noParentRelease: true,
    noBCPreflightOrAttempt: true,
    originalConfirmedReleased: [],
    originalCompleted: [],
    physicalReleased: ['A4HK906608'],
  });
  expected.auditHash = files['result.json'].sha256;
  for (let i = 0; i < 24; i++) files[`${i}.json`] = write(`${audit}/${i}.json`);
  expected.ledgerHash = write(audit + '/ledger.json', { currentInputs: 204, historicalInputs: 1503, files }).sha256;
});
afterEach(() => rmSync(state, { recursive: true, force: true }));
it('binds204 current and1503 prior records and verifies again without new claim', () => {
  const p = retainedCtsV5History(state, expected, () => ({ verify: older }));
  p.verify();
  expect(older).toHaveBeenCalledTimes(2);
});
it.each([
  'native',
  'operator',
  'current',
  'older',
  'audit',
  'ledger',
  'report',
  'mode',
  'extra',
  'missing',
  'symlink',
  'B',
  'C',
  'running',
  'old-seam',
] as const)('refuses %s drift after binding', (fault) => {
  const p = retainedCtsV5History(state, expected, () => ({ verify: older }));
  if (fault === 'old-seam') valid = false;
  else if (['B', 'C'].includes(fault)) mkdirSync(join(state, native, fault, 'attempt'));
  else if (fault === 'running') mkdirSync(join(state, native, 'running'));
  else {
    const f = join(
      state,
      fault === 'native'
        ? native + '/A/attempt/result.json'
        : fault === 'operator'
          ? operator + '/0.json'
          : fault === 'current'
            ? current + '/0.json'
            : fault === 'older'
              ? 'arc1-review/old/0.json'
              : fault === 'audit'
                ? audit + '/result.json'
                : fault === 'ledger'
                  ? audit + '/ledger.json'
                  : fault === 'report'
                    ? audit + '/result.md'
                    : native + '/2.json',
    );
    if (fault === 'mode') chmodSync(f, 0o644);
    else if (fault === 'missing') rmSync(f);
    else if (fault === 'symlink') {
      rmSync(f);
      symlinkSync(join(state, native, '3.json'), f);
    } else if (fault === 'extra') write(native + '/extra.json');
    else writeFileSync(f, 'changed');
  }
  expect(() => p.verify()).toThrow();
});
