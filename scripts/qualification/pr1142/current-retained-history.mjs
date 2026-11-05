import { lstatSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { requireEvidence, sha } from './current-workflow-contract.mjs';
import { qualifyCreatedOwner } from './current-workflow-creation-proof.mjs';

// A single consumed run, never an operator-selected resume path or owner list.
export const retainedPlan = 'current-pp-retained-workflows-v1';
export const retainedRoot = '/Users/marianzeis/.local/state/arc1-qualification/pr1142-current-pp-retained-v1';
export const retainedOriginalRoot =
  '/Users/marianzeis/.local/state/arc1-qualification/pr1142-current-pp-recording-workflows-20261103-142629';
export const retainedMarker = 'C0F4DEE08D0AF9BCA7AA736B2700A1C0';
export const retainedDescriptor = Object.freeze({
  plan: retainedPlan,
  originalRunId: '01e3783c-ddbd-4353-b71b-af213f4417a7',
  originalSourceRevision: '9e947c0bbfbfd2d03d572787589d8f2c693ceb3a',
  failedResultSha256: 'f1a4085d1c34565e4fc8c2a0c295ed4a531906fc869d7c0d9a50f39a298be964',
  auditSha256: 'bf1bddd3590402186e853bb998c7e1c71085ede2955bb875f1661395c4b030f6',
});
const auditPath =
  '/Users/marianzeis/.local/state/arc1-review/pr1142-current-pp-recording-stop-audit1/execution-evidence.json';
const includeRoot =
  '/Users/marianzeis/.local/state/arc1-qualification/pr1142-recording-only-pp-20261103-141344/retained-include-readonly';
const includeFiles = Object.freeze({
  'metadata-before.json': '1a627eeeb5dd19383cf7b31caf36b1567a9b663a954536779a74010c44b99618',
  'metadata-after.json': 'e40e0a0e0224b4d3acb4e925cf7a54a6e37536cd4eda3959d6f3e69816702d75',
  'source-default.json': 'aaa99a211f3a2e29e0de8fe89ffb967b3d199ccf75bf44a5757652f36bd8f38c',
  'source-active.json': '14d6e163e55f9ee9a2372ca4787b4d9da29a48ce0caec05829873364c396dd5c',
  'source-inactive.json': 'ceafedd0d1bd75e76bdfb7b6b7a5be9d8e7efa7c48589b7fdc79861043866be4',
  'summary.json': '066e79c355f169f54e76628898d29cbfc0e760d423028a54895fe3530a07eefc',
});

export function boundBytes(path, expected, read, stat) {
  const info = stat(path);
  requireEvidence(
    info.isFile() && !info.isSymbolicLink() && info.uid === process.getuid() && info.size <= 2 * 1024 * 1024,
    'RETAINED_HISTORY_FILE_INVALID',
  );
  const bytes = read(path);
  requireEvidence(
    sha(bytes) === expected.sha256 &&
      (expected.bytes === undefined || bytes.length === expected.bytes) &&
      (expected.mode === undefined || `0o${(info.mode & 0o777).toString(8)}` === expected.mode) &&
      (expected.uid === undefined || info.uid === expected.uid) &&
      (expected.gid === undefined || info.gid === expected.gid),
    'RETAINED_HISTORY_CHANGED',
  );
  return bytes;
}

// Pure packet semantics are separately testable; the live loader below fixes every path/hash.
export function validateRetainedPacket({ run, manifest, journal, receipts, include, audit }) {
  requireEvidence(
    run.runId === retainedDescriptor.originalRunId &&
      run.sourceRevision === retainedDescriptor.originalSourceRevision &&
      audit.runId === run.runId &&
      audit.sourceRevision === run.sourceRevision &&
      audit.beforeAfterUnchanged === true &&
      journal.runId === run.runId &&
      journal.sourceRevision === run.sourceRevision &&
      journal.failure === true &&
      journal.failedPhase === 'activate-ZARC1_PP_I_C0F4DEE08D0A' &&
      journal.error?.code === 'INDEPENDENT_NATIVE_CHECK_FAILED' &&
      manifest.marker === retainedMarker &&
      manifest.target === 'PR1142/001' &&
      manifest.nativeUrl === 'https://a4h.marianzeis.de' &&
      manifest.client === '001',
    'RETAINED_ORIGINAL_FAILURE_MISMATCH',
  );
  requireEvidence(
    manifest.fixtures.length === 4 &&
      journal.fixtures.length === 4 &&
      journal.operations.length === 14 &&
      journal.operations.every((o) => o.outcome === 'response-received' && o.args.action !== 'delete') &&
      journal.fixtures
        .slice(0, 3)
        .every((f) => f.attempted === true && f.deleted === false && !f.deletionAcknowledged) &&
      journal.fixtures[3].type === 'PROG' &&
      journal.fixtures[3].attempted === false &&
      journal.remaining.length === 3,
    'RETAINED_ORIGINAL_OWNER_STATE_MISMATCH',
  );
  /** @type {Record<string, any>} */
  const expected = {};
  /** @type {Record<string, any>} */
  const proofs = {};
  for (const fixture of manifest.fixtures.slice(0, 3)) {
    const actor = manifest.actors.find((a) => a.label === fixture.actor);
    const classEvidence = journal.fixtures.find((f) => f.actor === fixture.actor && f.type === 'CLAS')?.nativeIdentity;
    requireEvidence(
      actor?.write === true &&
        classEvidence?.identity?.createdBy === actor.sapUser &&
        classEvidence.identity.version === 'active',
      'RETAINED_ACTOR_PROOF_MISSING',
    );
    // This original run predates verifiedActors journaling. Its immutable source/run audit plus the
    // same actor's native class creator binds the old PP identity, never INCL responsible metadata.
    proofs[fixture.name] = qualifyCreatedOwner({
      run,
      manifest,
      journal,
      fixture,
      receipts,
      verifiedActor: {
        label: actor.label,
        email: actor.email,
        sapUser: actor.sapUser,
        identityAndScopesVerified: true,
      },
    });
    if (fixture.type === 'CLAS')
      expected[fixture.name] = journal.fixtures.find((f) => f.name === fixture.name).nativeIdentity;
    else
      expected[fixture.name] = {
        name: fixture.name,
        type: fixture.type,
        sourceHash: '75ad788eaa766d38ee29ba94b33f018e8dddf4fcf02ff58d18947d982b879b3a',
        metadataHash: '233c1574592fa69c594061d3b476d1ff773e24303e6738937a746c30487950d8',
      };
  }
  requireEvidence(
    include['summary.json'].mutationAttempted === false &&
      include['summary.json'].sourceRevision === run.sourceRevision &&
      include['metadata-before.json'].sha256 === expected[manifest.fixtures[2].name].metadataHash &&
      include['metadata-after.json'].sha256 === expected[manifest.fixtures[2].name].metadataHash &&
      ['source-default.json', 'source-active.json', 'source-inactive.json'].every(
        (key) =>
          include[key].status === 200 && sha(include[key].body) === expected[manifest.fixtures[2].name].sourceHash,
      ),
    'RETAINED_INCLUDE_READBACK_MISMATCH',
  );
  return { run, manifest, journal, proofs, expected };
}

export function readFixedRetainedHistory() {
  const read = readFileSync,
    stat = lstatSync;
  for (const path of [retainedOriginalRoot, includeRoot]) {
    const info = stat(path);
    requireEvidence(
      info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid(),
      'RETAINED_HISTORY_DIRECTORY_CHANGED',
    );
  }
  const audit = JSON.parse(boundBytes(auditPath, { sha256: retainedDescriptor.auditSha256 }, read, stat));
  const entries = Object.entries(audit.inputs ?? {}),
    files = {};
  requireEvidence(entries.length === 84, 'RETAINED_HISTORY_LEDGER_MISMATCH');
  for (const [path, expected] of entries) {
    const name = basename(path);
    requireEvidence(
      path === `${retainedOriginalRoot}/${name}` && !/credentials|\.env|fifo/i.test(name),
      'RETAINED_HISTORY_PATH_REFUSED',
    );
    files[name] = boundBytes(path, expected, read, stat);
  }
  requireEvidence(
    sha(files['current-workflow-result.json']) === retainedDescriptor.failedResultSha256,
    'RETAINED_RESULT_CHANGED',
  );
  const json = (name) => JSON.parse(files[name]);
  const include = {};
  for (const [name, hash] of Object.entries(includeFiles))
    include[name] = JSON.parse(boundBytes(`${includeRoot}/${name}`, { sha256: hash }, read, stat));
  return validateRetainedPacket({
    run: json('run-manifest.json'),
    manifest: json('fixture-manifest.json'),
    journal: json('current-workflow-result.json'),
    receipts: Object.keys(files)
      .filter((name) => /^current-rpc-[a-f0-9-]+\.json$/.test(name))
      .map(json),
    include,
    audit,
  });
}

export function assertRetainedContext(history, run, manifest, config) {
  requireEvidence(
    config.root === retainedRoot &&
      run.retained &&
      sha(run.retained) === sha(retainedDescriptor) &&
      manifest.marker === retainedMarker &&
      sha(manifest.fixtures) === sha(history.manifest.fixtures) &&
      sha(manifest.actors) === sha(history.manifest.actors) &&
      sha(manifest.bindings.recording) === sha(history.manifest.bindings.recording) &&
      manifest.target === history.manifest.target &&
      manifest.nativeUrl === history.manifest.nativeUrl &&
      manifest.client === history.manifest.client,
    'RETAINED_FIXED_CONTEXT_MISMATCH',
  );
}

export function assertRetainedObservation(history, fixture, observed) {
  const expected = history.expected[fixture.name],
    value = observed.fixtures?.[0];
  requireEvidence(
    expected &&
      observed.fixtures?.length === 1 &&
      value?.name === fixture.name &&
      value.type === fixture.type &&
      value.sourceHash === expected?.sourceHash &&
      value.metadataHash === expected.metadataHash &&
      (fixture.type !== 'CLAS' ||
        (sha(value.identity) === sha(expected.identity) && value.testSourceHash === expected.testSourceHash)) &&
      (!['INCL', 'PROG'].includes(fixture.type) ||
        (value.identity?.createdBy === null &&
          value.nativeCreatorEvidence === 'unavailable' &&
          value.ownedCreate &&
          sha(value.ownedCreate) === sha(history.proofs[fixture.name]))),
    'RETAINED_FRESH_OWNER_CHANGED',
  );
  return value;
}
