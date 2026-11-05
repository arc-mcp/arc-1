import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as evidence from '../../../scripts/qualification/pr1142/native-declarative-prerequisites.js';
import { verifyDeclarativeV4History } from '../../../scripts/qualification/pr1142/native-declarative-v4-history.js';
import { verifyOriginalV4Failure } from '../../../scripts/qualification/pr1142/native-declarative-v4-recovery-history.js';
import {
  DECLARATIVE_V5_HISTORY,
  verifyDeclarativeV5History,
} from '../../../scripts/qualification/pr1142/native-declarative-v5-history.js';

vi.mock('../../../scripts/qualification/pr1142/native-declarative-v4-history.js', async (original) => ({
  ...(await original<typeof import('../../../scripts/qualification/pr1142/native-declarative-v4-history.js')>()),
  verifyDeclarativeV4History: vi.fn(),
}));
vi.mock('../../../scripts/qualification/pr1142/native-declarative-v4-recovery-history.js', () => ({
  verifyOriginalV4Failure: vi.fn(),
}));
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
let state: string, root: string, auditPath: string, post: string;
let audit: any, expected: { revision: string; resultHash: string; auditHash: string; ledgerHash: string };
function save(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, text, { mode: 0o600 });
  return { bytes: Buffer.byteLength(text), sha256: sha(text) };
}
function bindAudit() {
  expected.ledgerHash = save(auditPath, JSON.stringify(audit)).sha256;
}
beforeEach(() => {
  vi.clearAllMocks();
  state = mkdtempSync(join(tmpdir(), 'arc1-v5-history-'));
  root = join(state, 'arc1-qualification/pr1142-native-declarative-v4-recovery-v1');
  post = join(state, 'arc1-qualification/pr1142-native-declarative-v4-recovery-post-20261103T061332');
  auditPath = join(state, 'arc1-qualification/pr1142-native-declarative-v4-recovery-audit.json');
  const result = save(join(root, 'attempt/result.json'), 'confirmed recovery fixture');
  const recoveryFiles: Record<string, { bytes: number; sha256: string }> = { 'attempt/result.json': result };
  for (let i = 0; i < 171; i++) recoveryFiles[`run/${i}.json`] = save(join(root, `run/${i}.json`), `receipt ${i}`);
  audit = {
    revision: 'a'.repeat(40),
    resultHash: result.sha256,
    recoveryFileCount: 172,
    recoveryFiles,
    postControlFiles: Object.fromEntries(
      ['sm12-post.json', 'sm12-user.jpg', 'sm12-suffix.jpg'].map((n) => [n, save(join(post, n), n)]),
    ),
    externalBindings: { [join(state, 'arc1-review/audit.md')]: save(join(state, 'arc1-review/audit.md'), 'review') },
  };
  expected = {
    revision: audit.revision,
    resultHash: result.sha256,
    auditHash: save(auditPath.replace('.json', '.md'), 'independent audit').sha256,
    ledgerHash: '',
  };
  bindAudit();
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(state, { recursive: true, force: true });
});
it('binds the complete recovery ledger and post controls while retaining both predecessor verifiers', () => {
  verifyDeclarativeV5History(state, expected);
  expect(verifyDeclarativeV4History).toHaveBeenCalledWith(join(state, 'arc1-qualification'));
  expect(verifyOriginalV4Failure).toHaveBeenCalledWith(state);
  expect(DECLARATIVE_V5_HISTORY.recovery.resultHash).toBe(
    'c444fded9da12a04f5f81c65d91900b251813c746a595568a76ddaed114e7ce4',
  );
  expect(DECLARATIVE_V5_HISTORY.v4.claim).toBe('permanently-consumed');
});
it.each(['result', 'journal', 'post', 'external', 'audit', 'ledger', 'extra', 'missing', 'symlink', 'permissions'])(
  'refuses %s evidence changes',
  (issue) => {
    const path = join(root, 'run/0.json');
    if (issue === 'result') save(join(root, 'attempt/result.json'), 'changed');
    if (issue === 'journal') save(path, 'changed');
    if (issue === 'post') save(join(post, 'sm12-user.jpg'), 'changed');
    if (issue === 'external') save(join(state, 'arc1-review/audit.md'), 'changed');
    if (issue === 'audit') save(auditPath.replace('.json', '.md'), 'changed');
    if (issue === 'ledger') save(auditPath, '{}');
    if (issue === 'extra') save(join(root, 'extra.json'), 'extra');
    if (issue === 'missing') rmSync(path);
    if (issue === 'symlink') {
      rmSync(path);
      symlinkSync(join(root, 'run/1.json'), path);
    }
    if (issue === 'permissions') chmodSync(path, 0o644);
    expect(() => verifyDeclarativeV5History(state, expected)).toThrow(/v5-history/);
  },
);
it('refuses a ledger path escaping the state directory even with an explicitly rebound test hash', () => {
  audit.externalBindings = { [join(state, '../outside.json')]: { bytes: 0, sha256: sha('') } };
  bindAudit();
  expect(() => verifyDeclarativeV5History(state, expected)).toThrow(/v5-history/);
});
it('rechecks the controlling ledger after dependent evidence reads', () => {
  const original = evidence.privateEvidence;
  vi.spyOn(evidence, 'privateEvidence').mockImplementation((path, limit) => {
    const result = original(path, limit);
    if (path === join(state, 'arc1-review/audit.md')) save(auditPath, '{}');
    return result;
  });
  expect(() => verifyDeclarativeV5History(state, expected)).toThrow(/v5-history/);
});
it('does not hide an older consumed-proof failure', () => {
  vi.mocked(verifyOriginalV4Failure).mockImplementationOnce(() => {
    throw new Error('old proof drift');
  });
  expect(() => verifyDeclarativeV5History(state, expected)).toThrow(/v5-history/);
});

it('allows an owner-written historical report to be readable, but never writable by other users', () => {
  const report = join(state, 'arc1-review/audit.md');
  chmodSync(report, 0o644);
  expect(() => verifyDeclarativeV5History(state, expected)).not.toThrow();
  chmodSync(report, 0o666);
  expect(() => verifyDeclarativeV5History(state, expected)).toThrow(/v5-history/);
});
