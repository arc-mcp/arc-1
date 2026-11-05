import { createHash } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CTS_RETAINED_V6_ORIGIN } from '../../../scripts/qualification/pr1142/native-cts-fixtures.js';
import { retainedCtsV6History } from '../../../scripts/qualification/pr1142/native-cts-retained-v6-history.js';

const audit = 'arc1-review/pr1142-cts-retained-v5-A-execution-audit1',
  diagnosis = 'arc1-review/pr1142-cts-v5-stop-diagnosis1',
  native = 'arc1-qualification/pr1142-native-cts-retained-v5',
  operator = 'arc1-review/pr1142-cts-retained-v5-execution-20261105',
  current = 'arc1-review/pr1142-cts-retained-v5-current-inspection-20261105';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
let state: string, expected: NonNullable<Parameters<typeof retainedCtsV6History>[1]>, valid: boolean;
const older = vi.fn(() => {
  if (!valid) throw Error('old drift');
});
function write(relative: string, value: unknown = {}) {
  const path = join(state, relative),
    body = JSON.stringify(value);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, body, { mode: 0o600 });
  const s = lstatSync(path);
  return { path, sha256: hash(body), bytes: Buffer.byteLength(body), mode: '0o600', uid: s.uid, gid: s.gid };
}
beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), 'cts-v6-history-'));
  valid = true;
  older.mockClear();
  expected = { ...CTS_RETAINED_V6_ORIGIN.consumedRetainedV5 };
  const rows: ReturnType<typeof write>[] = [];
  for (const [root, count] of [
    [native, 164],
    [operator, 17],
    [current, 6],
  ] as const)
    for (let i = 0; i < count; i++) rows.push(write(`${root}/${i}.json`));
  for (const n of ['0.json', '1.json']) {
    rmSync(join(state, native, n));
    rows.splice(
      rows.findIndex((x) => x.path === join(state, native, n)),
      1,
    );
  }
  const intent = write(native + '/intent.json', { protocol: 'pr1142-native-cts-retained-v5' });
  rows.push(intent);
  expected.intentHash = intent.sha256;
  const result = write(native + '/A/attempt/result.json', {
    failure: true,
    completed: [],
    adoptedReleased: ['A4HK906608'],
    confirmedReleased: ['A4HK906608'],
    dispatchedMutations: 1,
    current: { A4HK906607: 'unknown', A4HK906608: 'unknown' },
    releaseProofRefusal: { reason: 'Unproven native release comment.' },
  });
  rows.push(result);
  expected.resultHash = result.sha256;
  for (const p of ['B/preflight', 'C/preflight']) mkdirSync(join(state, native, p), { recursive: true, mode: 0o700 });
  const historical = Array.from({ length: 1738 }, (_, i) => write(`arc1-review/old/${i}.json`));
  const source = Array.from({ length: 3469 }, (_, i) => ({
    ...historical[0],
    path: join(state, diagnosis, 'source', `${i}.ts`),
  }));
  const files: Record<string, ReturnType<typeof write>> = {};
  files['current-inputs.json'] = write(audit + '/current-inputs.json', rows);
  files['input-manifest.json'] = write(audit + '/input-manifest.json', { files: [...rows, ...historical, ...source] });
  files['result.md'] = write(audit + '/result.md', 'failed stays failed');
  expected.reportHash = files['result.md'].sha256;
  files['result.json'] = write(audit + '/result.json', {
    sourceRevision: expected.revision,
    originalFailurePreserved: true,
    facts: { currentFiles: 187, historicalFiles: 1738 },
  });
  expected.auditHash = files['result.json'].sha256;
  for (let i = 0; i < 10; i++) files[`${i}.json`] = write(`${audit}/${i}.json`);
  expected.ledgerHash = write(audit + '/ledger.json', { files }).sha256;
  const diag: Record<string, ReturnType<typeof write>> = {};
  diag['result.json'] = write(diagnosis + '/result.json', {
    sourceRevision: expected.revision,
    originalFailurePreserved: true,
    physicalParentReleased: true,
    physicalTaskReleased: true,
  });
  expected.diagnosisHash = diag['result.json'].sha256;
  for (let i = 0; i < 14; i++) diag[`${i}.json`] = write(`${diagnosis}/${i}.json`);
  expected.diagnosisLedgerHash = write(diagnosis + '/ledger.json', { files: diag }).sha256;
  expected.designHash = write(
    'arc1-review/pr1142-native-cts-retained-v6-design1/design.md',
    'approved design only',
  ).sha256;
});
afterEach(() => rmSync(state, { recursive: true, force: true }));
it('binds187 current,1738 prior and exact audit/diagnosis; no new protocol root', () => {
  const p = retainedCtsV6History(state, expected, () => ({ verify: older }));
  p.verify();
  expect(older).toHaveBeenCalledTimes(2);
});
it.each([
  'native',
  'operator',
  'current',
  'older',
  'audit',
  'diagnosis',
  'design',
  'mode',
  'missing',
  'symlink',
  'extra',
  'B',
  'C',
  'running',
  'old-proof',
] as const)('refuses %s history drift', (fault) => {
  const p = retainedCtsV6History(state, expected, () => ({ verify: older }));
  if (fault === 'old-proof') valid = false;
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
                : fault === 'diagnosis'
                  ? diagnosis + '/result.json'
                  : fault === 'design'
                    ? 'arc1-review/pr1142-native-cts-retained-v6-design1/design.md'
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
