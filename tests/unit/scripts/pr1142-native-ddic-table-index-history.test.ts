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
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, type Mock, vi } from 'vitest';
import { TABLE_STAGES } from '../../../scripts/qualification/pr1142/native-ddic-table-fixtures.js';
import {
  indexTailFixtures,
  indexTailOwners,
  TABLE_INDEX_RECEIPTS,
  TABLE_INDEX_SUFFIX,
} from '../../../scripts/qualification/pr1142/native-ddic-table-index-fixed.js';
import {
  TABLE_INDEX_HISTORY,
  verifyIndexTailHistory,
} from '../../../scripts/qualification/pr1142/native-ddic-table-index-history.js';

const sha = (v: string | Buffer) => createHash('sha256').update(v).digest('hex'),
  origin = '/Users/marianzeis/.local/state/',
  protocol = 'arc1-qualification/pr1142-native-ddic-table-settings-tail-v1',
  auditDir = 'arc1-review/pr1142-table-settings-stop-independent-audit1',
  operatorDir = 'arc1-review/pr1142-table-settings-stop-operator-audit1';
let state: string,
  expected: Record<keyof typeof TABLE_INDEX_HISTORY, string>,
  prior: Mock<(state?: string) => void>,
  audit: any,
  operator: any;
const write = (p: string, v: unknown) => {
  const path = join(state, p);
  mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(v), { mode: 0o600 });
  return sha(readFileSync(path));
};
const seal = () => {
  expected.audit = write(auditDir + '/result.json', audit);
  expected.operatorLedger = write(operatorDir + '/result.json', operator);
};
beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), 'arc1-index-tail-history-'));
  prior = vi.fn<(state?: string) => void>();
  expected = { ...TABLE_INDEX_HISTORY };
  const owners = indexTailOwners(),
    revision = 'bc4903a871e80d81af9776b79a4edcc3258afed8',
    prefix = TABLE_STAGES.slice(5, 14);
  expected.intent = write(protocol + '/intent.json', {
    protocol: 'pr1142-native-ddic-table-settings-tail-v1',
    suffix: TABLE_INDEX_SUFFIX,
    fixtures: indexTailFixtures(TABLE_INDEX_SUFFIX),
    binding: { revision },
  });
  expected.result = write(protocol + '/attempt/result.json', {
    failure: true,
    stoppedAt: 'update-TABL/DTI',
    mutationDispatched: true,
    completed: prefix,
    created: owners.slice(2),
    retainedOwners: owners.slice(0, 2),
    confirmedDeleted: [],
    cleanupUnconfirmed: false,
    finalAbsenceConfirmed: false,
    remaining: owners,
    inspectionRequired: owners,
  });
  const files: any[] = [];
  for (const [root, total] of [
    [protocol, 1056],
    ['arc1-review/pr1142-table-settings-tail-execution-20261104', 11],
    ['arc1-review/pr1142-table-settings-post-index-reads-20261104', 22],
    ['arc1-review/pr1142-index-and-dependency-source-reads-20261104', 9],
  ] as const) {
    const names = root === protocol ? ['intent.json', 'attempt/result.json'] : [];
    for (let n = names.length; n < total; n++) names.push('file' + n + '.json');
    for (const name of names) {
      const p = root + '/' + name;
      if (!['intent.json', 'attempt/result.json'].includes(name)) write(p, {});
      const b = readFileSync(join(state, p)),
        s = lstatSync(join(state, p));
      files.push({ path: origin + p, bytes: b.length, sha256: sha(b), mode: '0600', uid: s.uid, gid: s.gid });
    }
  }
  operator = {
    sourceRevision: revision,
    resultSha256: expected.result,
    parentRawMetadataUnchanged: true,
    parentRawSourceUnchanged: true,
    fileCount: 1098,
    files,
  };
  audit = {
    status: 'audited-failed-retained',
    sourceRevision: revision,
    resultSha256: expected.result,
    finalEvidenceUnchanged: true,
    parentRawMetadataUnchanged: true,
    parentRawSourceUnchanged: true,
    journalRows: 984,
    dispatch: { GET: 230, POST: 35, PUT: 3 },
    remaining: owners,
    completed: prefix,
    indexAdapter: {
      result: { state: 'saved-inactive', sourceHash: TABLE_INDEX_RECEIPTS.indexSource },
      cleanup: { sessionClosed: true, unlockFailed: false },
    },
    originalEvidence: Object.fromEntries(files.map(({ path, ...value }) => [path, value])),
  };
  expected.auditReport = write(auditDir + '/result.md', 'synthetic independent report');
  expected.operatorReport = write(operatorDir + '/result.md', 'synthetic operator report');
  seal();
});
afterEach(() => rmSync(state, { recursive: true, force: true }));
it('verifies exact fixed membership without changing files', () => {
  const before = readFileSync(join(state, protocol + '/attempt/result.json'));
  expect(() => verifyIndexTailHistory(state, expected, prior)).not.toThrow();
  expect(prior).toHaveBeenCalledWith(state);
  expect(readFileSync(join(state, protocol + '/attempt/result.json'))).toEqual(before);
});
it.each([
  'missing',
  'extra',
  'bytes',
  'mode',
  'link',
  'report',
  'duplicate',
  'foreign-root',
  'owner',
  'dispatch',
  'cleanup',
  'source',
  'prefix',
  'result',
])('refuses %s drift even when relevant test audit hashes are rebound', (fault) => {
  const file = join(state, protocol + '/file2.json');
  if (fault === 'missing') rmSync(file);
  if (fault === 'extra') write(protocol + '/extra.json', {});
  if (fault === 'bytes') write(protocol + '/file2.json', { changed: true });
  if (fault === 'mode') chmodSync(file, 0o644);
  if (fault === 'link') {
    rmSync(file);
    symlinkSync(join(state, protocol + '/file3.json'), file);
  }
  if (fault === 'report') write(auditDir + '/result.md', 'changed');
  if (fault === 'duplicate') {
    operator.files[1] = operator.files[0];
    seal();
  }
  if (fault === 'foreign-root') {
    operator.files[0].path = origin + 'foreign/file.json';
    seal();
  }
  if (fault === 'owner') {
    audit.remaining[0] = '/foreign';
    seal();
  }
  if (fault === 'dispatch') {
    audit.dispatch.PUT = 4;
    seal();
  }
  if (fault === 'cleanup') {
    audit.indexAdapter.cleanup.unlockFailed = true;
    seal();
  }
  if (fault === 'source') {
    audit.indexAdapter.result.sourceHash = '0'.repeat(64);
    seal();
  }
  if (fault === 'prefix') {
    audit.completed.push('reactivate-TABL/DTI');
    seal();
  }
  if (fault === 'result') write(protocol + '/attempt/result.json', { failure: false });
  expect(() => verifyIndexTailHistory(state, expected, prior)).toThrow('Consumed table/settings/index history');
});
it('prior consumed proof failure propagates before new evidence is trusted', () => {
  prior.mockImplementation(() => {
    throw new Error('old claim changed');
  });
  expect(() => verifyIndexTailHistory(state, expected, prior)).toThrow();
});
