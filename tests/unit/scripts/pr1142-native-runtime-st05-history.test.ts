import { createHash } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { runtimeClassOwner as owner } from '../../../scripts/qualification/pr1142/native-runtime-slice-fixed.js';
import { runtimeSt05History as proof } from '../../../scripts/qualification/pr1142/native-runtime-st05-fixed.js';
import { verifyRuntimeSt05History } from '../../../scripts/qualification/pr1142/native-runtime-st05-history.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const prefix = '/Users/marianzeis/.local/state/';
const roots = {
  'arc1-qualification/pr1142-native-runtime-flp-retained-v2': 330,
  'arc1-review/pr1142-runtime-retained-v2-execution-20261104': 18,
  'arc1-review/pr1142-enho-content-and-st05-post-reads-20261104': 6,
};
const audit = 'arc1-review/pr1142-runtime-retained-v2-independent-audit1',
  operator = 'arc1-review/pr1142-runtime-retained-v2-operator-audit1';
function fixture() {
  const state = mkdtempSync(join(tmpdir(), 'arc1-st05-history-')),
    names = Object.keys(roots),
    root = names[0],
    expected: any = { ...proof, results: { ...proof.results } },
    files: Record<string, any> = {};
  const save = (name: string, body: string) => {
    const file = join(state, name);
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, body, { mode: 0o600 });
    return sha(body);
  };
  const add = (name: string, body: string) => {
    const hash = save(name, body),
      stat = lstatSync(join(state, name));
    files[prefix + name] = { sha256: hash, bytes: Buffer.byteLength(body), mode: '0600', uid: stat.uid, gid: stat.gid };
    return hash;
  };
  expected.originalIntentHash = add(root + '/intent.json', 'synthetic intent');
  const results: Record<string, any> = {};
  let previous = proof.priorHistory.failedQuickfixResultHash;
  for (const stage of ['quickfix', 'profiler', 'populated-flp', 'st05']) {
    const result = {
      protocol: proof.originalProtocol,
      revision: proof.originalRevision,
      intentHash: expected.originalIntentHash,
      previousResultHash: previous,
      stage,
      remaining: [],
      ppQualified: false,
      publicAdmission: false,
      failure: stage === 'st05',
      mutationDispatched: stage !== 'st05',
      ...(stage === 'quickfix'
        ? {
            finalAbsent: true,
            sourceUnchanged: true,
            createReplayed: false,
            cleanup: { unlockFailed: false, sessionClosed: true },
            confirmedDeleted: [owner],
          }
        : {}),
      ...(stage === 'profiler' ? { cancelled: true, parametersCleanup: 'native-retention-unverified' } : {}),
      ...(stage === 'populated-flp'
        ? {
            nativeDeleteCompleted: ['own-page', 'own-catalog'],
            readAbsenceConfirmed: false,
            recording: 'native-governed-unverified',
          }
        : {}),
      ...(stage === 'st05'
        ? { reason: 'st05-restoration-prerequisite', stoppedAt: 'baseline', restored: false, clientIsolated: false }
        : {}),
    };
    results[stage] = result;
    expected.results[stage] = add(`${root}/${stage}/attempt/result.json`, JSON.stringify(result));
    previous = expected.results[stage];
  }
  add(
    root + '/st05/attempt/run/00003.json',
    JSON.stringify({
      value: {
        stage: 'response',
        method: 'GET',
        path: '/sap/bc/adt/st05/trace/state',
        status: 200,
        sha256: proof.baselineHash,
      },
    }),
  );
  mkdirSync(join(state, root, 'final/prerequisites'), { recursive: true, mode: 0o700 });
  for (const [name, count] of Object.entries(roots))
    for (let i = 0; i < count - (name === root ? 6 : 0); i++) add(name + `/file-${i}.json`, '{}');
  const independent: any = {
    source: proof.originalRevision,
    status: 'actual-execution-audit-complete-with-explicit-limitations',
    st05MutationDispatched: false,
    fullRuntimeComplete: false,
    evidence: { currentFiles: 354, priorFiles: 165, allBoundFiles: 562, unchanged: true },
    postSm12: { zero: true },
  };
  const operated: any = {
    revision: proof.originalRevision,
    status: 'three-completed-st05-baseline-refused',
    st05NoMutation: true,
    st05PostRawBytesEqual: true,
    fileCount: 354,
    resultHashes: expected.results,
    files: [],
  };
  expected.independentReportHash = save(audit + '/result.md', 'synthetic audit');
  expected.operatorReportHash = save(operator + '/result.md', 'synthetic operator');
  const bindReports = () => {
    const manifest: any = { ...files };
    for (let i = 0; i < 208; i++) manifest[`other-prior-and-source-${i}`] = {};
    expected.independentManifestHash = save(audit + '/all-evidence-after.json', JSON.stringify(manifest));
    independent.evidence.manifestSha256 = expected.independentManifestHash;
    operated.files = Object.entries(files).map(([path, row]) => ({ path, ...row }));
    expected.independentAuditHash = save(audit + '/result.json', JSON.stringify(independent));
    expected.operatorAuditHash = save(operator + '/result.json', JSON.stringify(operated));
  };
  bindReports();
  const prior = vi.fn();
  return {
    state,
    root: join(state, root),
    relative: root,
    expected,
    files,
    independent,
    operated,
    results,
    prior,
    save,
    add,
    bindReports,
    check: () => verifyRuntimeSt05History(state, expected, prior),
  };
}
it('binds all 354 current files and three successful results after prior 165-file verification', () => {
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
  'report',
  'report-mode',
  'empty-claim',
  'prior',
])('rejects %s historical drift', (kind) => {
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
    if (kind === 'report') writeFileSync(join(f.state, audit, 'result.md'), 'changed');
    if (kind === 'report-mode') chmodSync(join(f.state, audit, 'result.md'), 0o644);
    if (kind === 'empty-claim') mkdirSync(join(f.root, 'final/attempt'), { mode: 0o700 });
    if (kind === 'prior')
      f.prior.mockImplementation(() => {
        throw new Error('old history changed');
      });
    expect(f.check).toThrow();
  } finally {
    rmSync(f.state, { recursive: true, force: true });
  }
});
it.each(['write', 'class-cleanup', 'profiler-retention', 'flp-absence', 'prior-result', 'residual'])(
  'rejects rehashed counterfactual %s result semantics',
  (kind) => {
    const f = fixture();
    try {
      let stage = 'st05';
      if (kind === 'write') f.results.st05.mutationDispatched = true;
      if (kind === 'class-cleanup') {
        stage = 'quickfix';
        f.results.quickfix.cleanup.sessionClosed = false;
      }
      if (kind === 'profiler-retention') {
        stage = 'profiler';
        f.results.profiler.parametersCleanup = 'confirmed';
      }
      if (kind === 'flp-absence') {
        stage = 'populated-flp';
        f.results['populated-flp'].readAbsenceConfirmed = true;
      }
      if (kind === 'prior-result') f.results.st05.previousResultHash = proof.results.quickfix;
      if (kind === 'residual') f.results.st05.remaining = ['unknown trace'];
      f.expected.results[stage] = f.add(`${f.relative}/${stage}/attempt/result.json`, JSON.stringify(f.results[stage]));
      f.bindReports();
      expect(f.check).toThrow();
    } finally {
      rmSync(f.state, { recursive: true, force: true });
    }
  },
);
it.each(['foreign', 'traversal', 'duplicate', 'audit-status', 'operator-write', 'uid'])(
  'rejects rehashed %s evidence membership or authority',
  (kind) => {
    const f = fixture();
    try {
      if (kind === 'audit-status') f.independent.status = 'complete';
      if (kind === 'operator-write') f.operated.st05NoMutation = false;
      if (kind === 'uid') f.files[prefix + f.relative + '/file-0.json'].uid = -1;
      f.bindReports();
      if (['foreign', 'traversal', 'duplicate'].includes(kind)) {
        f.operated.files[0].path =
          kind === 'foreign'
            ? prefix + 'arc1-review/foreign/file.json'
            : kind === 'traversal'
              ? prefix + f.relative + '/../.env'
              : f.operated.files[1].path;
        f.expected.operatorAuditHash = f.save(operator + '/result.json', JSON.stringify(f.operated));
      }
      expect(f.check).toThrow();
    } finally {
      rmSync(f.state, { recursive: true, force: true });
    }
  },
);
