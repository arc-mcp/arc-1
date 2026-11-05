import { createHash } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { CTS_RETAINED_ORIGIN } from '../../../scripts/qualification/pr1142/native-cts-fixtures.js';
import { retainedCtsHistory } from '../../../scripts/qualification/pr1142/native-cts-retained-history.js';

const roots = {
    original: 'arc1-qualification/pr1142-native-cts-workflows-v1',
    operator: 'arc1-review/pr1142-native-cts-execution-20261103',
    inspection: 'arc1-review/pr1142-cts-created-request-readonly-20261103',
  },
  audit = 'arc1-review/pr1142-native-cts-stop-independent-audit1';
let root: string, digest: string, report: string;
const sha = (body: string | Buffer) => createHash('sha256').update(body).digest('hex');
function write(path: string, body = '{}') {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true, mode: 0o700 });
  writeFileSync(full, body, { mode: 0o600 });
  const s = lstatSync(full);
  return { sha256: sha(body), bytes: Buffer.byteLength(body), uid: s.uid, gid: s.gid, mode: '0o600' };
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cts-held-history-'));
  const files: Record<string, ReturnType<typeof write>> = {};
  for (const [prefix, count] of [
    ['original', 86],
    ['operator', 11],
    ['inspection', 3],
  ] as const)
    for (let i = 0; i < count; i++) files[`${prefix}/${i}.json`] = write(`${roots[prefix]}/${i}.json`);
  for (const n of ['B/preflight', 'C/preflight'])
    mkdirSync(join(root, roots.original, n), { recursive: true, mode: 0o700 });
  report = write(`${audit}/audit.md`, 'Independent saved audit').sha256;
  digest = write(
    `${audit}/audit.json`,
    JSON.stringify({
      sourceRevision: CTS_RETAINED_ORIGIN.revision,
      failedResultSha256: CTS_RETAINED_ORIGIN.resultHash,
      files,
    }),
  ).sha256;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
it('binds100 files and both audit documents without changing them', () => {
  const saved = readFileSync(join(root, audit, 'audit.json'));
  const proof = retainedCtsHistory(root, digest, report);
  proof.verify();
  expect(readFileSync(join(root, audit, 'audit.json'))).toEqual(saved);
});
it.each([
  'original',
  'operator',
  'inspection',
  'report',
  'ledger',
  'extra-file',
  'extra-directory',
  'old-B-claim',
  'missing',
  'symlink',
  'readable',
  'writable-directory',
  'directory-link',
] as const)('refuses %s drift at every later check', (fault) => {
  const proof = retainedCtsHistory(root, digest, report);
  if (['original', 'operator', 'inspection'].includes(fault))
    write(`${roots[fault as keyof typeof roots]}/0.json`, 'changed');
  if (fault === 'report') write(`${audit}/audit.md`, 'changed');
  if (fault === 'ledger') write(`${audit}/audit.json`, '{}');
  if (fault === 'extra-file') write(`${roots.original}/extra.json`);
  if (fault === 'extra-directory') mkdirSync(join(root, roots.operator, 'extra'), { mode: 0o700 });
  if (fault === 'old-B-claim') mkdirSync(join(root, roots.original, 'B/attempt'), { mode: 0o700 });
  if (fault === 'missing') rmSync(join(root, roots.inspection, '0.json'));
  if (fault === 'symlink') {
    rmSync(join(root, roots.operator, '0.json'));
    symlinkSync('1.json', join(root, roots.operator, '0.json'));
  }
  if (fault === 'readable') chmodSync(join(root, roots.original, '0.json'), 0o644);
  if (fault === 'writable-directory') chmodSync(join(root, roots.inspection), 0o777);
  if (fault === 'directory-link') {
    const target = join(root, 'replacement');
    mkdirSync(target, { mode: 0o700 });
    rmSync(join(root, roots.original, 'B/preflight'), { recursive: true });
    symlinkSync(target, join(root, roots.original, 'B/preflight'));
  }
  expect(() => proof.verify()).toThrow();
});
it('rejects an absolute/traversing ledger member without an unbounded directory walk', () => {
  const p = join(root, audit, 'audit.json'),
    x = JSON.parse(readFileSync(p, 'utf8'));
  x.files['original//absolute'] = x.files['original/0.json'];
  delete x.files['original/0.json'];
  const body = JSON.stringify(x);
  write(`${audit}/audit.json`, body);
  expect(() => retainedCtsHistory(root, sha(body), report)).toThrow();
});
