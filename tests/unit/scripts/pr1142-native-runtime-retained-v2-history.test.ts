import { createHash } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { runtimeRetainedClassReceipt } from '../../../scripts/qualification/pr1142/native-runtime-retained-fixed.js';
import { runtimeRetainedV2History as proof } from '../../../scripts/qualification/pr1142/native-runtime-retained-v2-fixed.js';
import { verifyRuntimeRetainedV2History } from '../../../scripts/qualification/pr1142/native-runtime-retained-v2-history.js';
import { runtimeClassOwner as owner } from '../../../scripts/qualification/pr1142/native-runtime-slice-fixed.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const prefix = '/Users/marianzeis/.local/state/';
const roots = {
  'arc1-qualification/pr1142-native-runtime-flp-retained-v1': 31,
  'arc1-review/pr1142-runtime-retained-execution-20261104': 9,
  'arc1-review/pr1142-runtime-quickfix-post-computation-reads-20261104': 5,
};
const audit = 'arc1-review/pr1142-runtime-retained-stop-independent-audit1',
  operator = 'arc1-review/pr1142-runtime-retained-stop-operator-audit1';
function fixture() {
  const state = mkdtempSync(join(tmpdir(), 'arc1-runtime-v2-history-')),
    names = Object.keys(roots),
    expected: any = { ...proof },
    files: Record<string, any> = {};
  const save = (name: string, body: string) => {
    const file = join(state, name);
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, body, { mode: 0o600 });
    return sha(body);
  };
  const add = (name: string, body: string) => {
    const digest = save(name, body),
      s = lstatSync(join(state, name));
    files[prefix + name] = { bytes: Buffer.byteLength(body), sha256: digest, mode: 0o600, uid: s.uid, gid: s.gid };
    return digest;
  };
  expected.originalIntentHash = add(names[0] + '/intent.json', 'synthetic intent');
  const failed = {
    protocol: proof.originalProtocol,
    revision: proof.originalRevision,
    intentHash: expected.originalIntentHash,
    previousResultHash: proof.priorHistory.failedQuickfixResultHash,
    failure: true,
    stage: 'quickfix',
    stoppedAt: 'quickfix',
    created: false,
    createReplayed: false,
    finalAbsent: false,
    sourceUnchanged: false,
    mutationDispatched: true,
    adopted: [owner],
    remaining: [owner],
    confirmedDeleted: [],
  };
  expected.failedQuickfixResultHash = add(names[0] + '/quickfix/attempt/result.json', JSON.stringify(failed));
  for (const [root, count] of Object.entries(roots))
    for (let i = 0; i < count - (root === names[0] ? 2 : 0); i++) add(root + `/file-${i}.json`, '{}');
  const independent: any = {
    revision: proof.originalRevision,
    resultSha256: expected.failedQuickfixResultHash,
    status: 'audited-failed-retained',
    journalRows: 25,
    dispatchCounts: { GET: 5, POST: 3 },
    allObservedResponses200: true,
    metadataSha256: runtimeRetainedClassReceipt.metadataHash,
    sourceSha256: runtimeRetainedClassReceipt.sourceHash,
    proposalSha256: proof.proposalResultHash,
    followupBytesEqual: true,
    originalEvidenceUnchanged: true,
    postLocksVisuallyZero: true,
    remaining: [owner],
    rootCounts: roots,
    originalEvidence: files,
  };
  const operated: any = {
    revision: proof.originalRevision,
    resultSha256: expected.failedQuickfixResultHash,
    createPutDeleteActivationDispatched: false,
    storedSourceAndMetadataUnchangedAfterStop: true,
    remaining: [owner],
    fileCount: 45,
    files: Object.entries(files).map(([path, row]) => ({ path, bytes: row.bytes, mode: '0600', sha256: row.sha256 })),
  };
  expected.independentReportHash = save(audit + '/result.md', 'synthetic independent audit');
  expected.operatorReportHash = save(operator + '/result.md', 'synthetic operator audit');
  const bindReports = () => {
    expected.independentAuditHash = save(audit + '/result.json', JSON.stringify(independent));
    expected.operatorAuditHash = save(operator + '/result.json', JSON.stringify(operated));
  };
  bindReports();
  const prior = vi.fn();
  const check = () => verifyRuntimeRetainedV2History(state, expected, prior);
  return {
    state,
    expected,
    files,
    independent,
    operated,
    prior,
    check,
    bindReports,
    root: join(state, names[0]),
    names,
  };
}
it('verifies every fixed source file and both ledgers after the earlier history verifier', () => {
  const f = fixture();
  try {
    expect(f.check).not.toThrow();
    expect(f.prior).toHaveBeenCalledTimes(1);
  } finally {
    rmSync(f.state, { recursive: true, force: true });
  }
});
it.each([
  'bytes',
  'missing',
  'extra',
  'permissions',
  'directory',
  'link',
  'report-bytes',
  'report-mode',
  'new-empty-claim',
  'old-empty-claim',
  'prior',
])('refuses %s drift without changing any history', (kind) => {
  const f = fixture();
  try {
    const file = join(f.root, 'file-0.json');
    if (kind === 'bytes') writeFileSync(file, 'changed');
    if (kind === 'missing') rmSync(file);
    if (kind === 'extra') writeFileSync(join(f.root, 'extra.json'), '{}');
    if (kind === 'permissions') chmodSync(file, 0o644);
    if (kind === 'directory') chmodSync(f.root, 0o755);
    if (kind === 'link') {
      rmSync(file);
      symlinkSync(join(f.root, 'file-1.json'), file);
    }
    if (kind === 'report-bytes') writeFileSync(join(f.state, audit, 'result.md'), 'changed');
    if (kind === 'report-mode') chmodSync(join(f.state, audit, 'result.md'), 0o644);
    if (kind === 'new-empty-claim') mkdirSync(join(f.root, 'profiler/attempt'), { recursive: true, mode: 0o700 });
    if (kind === 'old-empty-claim')
      mkdirSync(join(f.state, 'arc1-qualification/pr1142-native-runtime-flp-v1/st05/attempt'), {
        recursive: true,
        mode: 0o700,
      });
    if (kind === 'prior')
      f.prior.mockImplementation(() => {
        throw new Error('original112 changed');
      });
    expect(f.check).toThrow();
  } finally {
    rmSync(f.state, { recursive: true, force: true });
  }
});
it.each([
  'native-count',
  'metadata',
  'source',
  'proposal',
  'followup',
  'remaining',
  'root-count',
  'operator-duplicate',
  'operator-hash',
  'operator-mode',
  'owner',
  'group',
  'origin',
  'prior-proof',
])('refuses contradictory %s facts even with rebound synthetic report hashes', (kind) => {
  const f = fixture();
  try {
    if (kind === 'native-count') f.independent.dispatchCounts.POST = 4;
    if (kind === 'metadata') f.independent.metadataSha256 = 'f'.repeat(64);
    if (kind === 'source') f.independent.sourceSha256 = 'f'.repeat(64);
    if (kind === 'proposal') f.independent.proposalSha256 = 'f'.repeat(64);
    if (kind === 'followup') f.independent.followupBytesEqual = false;
    if (kind === 'remaining') f.independent.remaining = [];
    if (kind === 'root-count') f.independent.rootCounts = { ...roots, [f.names[0]]: 30 };
    if (kind === 'operator-duplicate') f.operated.files[0] = f.operated.files[1];
    if (kind === 'operator-hash') f.operated.files[0].sha256 = 'f'.repeat(64);
    if (kind === 'operator-mode') f.operated.files[0].mode = '0644';
    if (kind === 'owner') f.files[Object.keys(f.files)[0]].uid += 1;
    if (kind === 'group') f.files[Object.keys(f.files)[0]].gid += 1;
    if (kind === 'origin') {
      const key = Object.keys(f.files)[0];
      f.files['/other/' + key] = f.files[key];
      delete f.files[key];
    }
    if (kind === 'prior-proof') f.expected.priorHistory = { ...proof.priorHistory, originalRevision: 'f'.repeat(40) };
    f.bindReports();
    expect(f.check).toThrow();
  } finally {
    rmSync(f.state, { recursive: true, force: true });
  }
});
