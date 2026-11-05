import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { assertRetainedObservation, boundBytes, retainedMarker } from './current-retained-history.mjs';
import { readFixedTextTailHistory, textTailDescriptor, textTailRoot } from './current-text-tail-history.mjs';
import { proveOwnedIncludeRelationship } from './current-text-tail-v2-context.mjs';
import { requireEvidence, sha } from './current-workflow-contract.mjs';

export const textTailV2Plan = 'current-pp-text-tail-v2';
export const textTailV2Root =
  '/Users/marianzeis/.local/state/arc1-qualification/pr1142-current-pp-text-tail-v2';
export const textTailV2Descriptor = Object.freeze({
  plan: textTailV2Plan,
  originalRunId: '26595017-7021-4d77-81ba-8f1dd1920859',
  originalSourceRevision: '3adea700e80e6a31930e106c72fc058d16d5d0f5',
  auditSha256: 'e02c4e65412f0ba24e11ce2c97dc1743408beb02a5d4e6894cddafaf41928049',
  prior: textTailDescriptor,
});
const auditRoot =
  '/Users/marianzeis/.local/state/arc1-review/pr1142-current-pp-text-tail-stop-independent-audit1';
const priorMetadata =
  '/Users/marianzeis/.local/state/arc1-qualification/pr1142-recording-only-pp-20261103-141344/retained-include-readonly/metadata-before.json';

export function validateTextTailV2Packet(prior, packet, before) {
  const run = packet['run-manifest.json'],
    manifest = packet['fixture-manifest.json'],
    journal = packet['current-workflow-result.json'],
    claim = packet['current-workflow-claim.json'];
  requireEvidence(
    run?.runId === textTailV2Descriptor.originalRunId &&
      run.sourceRevision === textTailV2Descriptor.originalSourceRevision &&
      sha(run.retained) === sha(textTailDescriptor) &&
      journal?.runId === run.runId &&
      journal.sourceRevision === run.sourceRevision &&
      journal.manifestSha256 === sha(manifest) &&
      journal.harnessSha256 === run.harnessSha256 &&
      journal.failure === true &&
      journal.failedPhase === 'retained-fresh-native-prerequisites' &&
      journal.error?.code === 'INDEPENDENT_NATIVE_CHECK_FAILED' &&
      journal.firstMutationMayHaveBeenSubmitted === false &&
      journal.operations?.length === 0 &&
      claim?.runId === run.runId &&
      claim.manifestSha256 === sha(manifest) &&
      journal.fixtures?.length === 4 &&
      journal.remaining?.length === 4 &&
      journal.fixtures.every((f) => f.attempted === true && f.deleted === false && !f.deletionAcknowledged) &&
      !journal.fixtures[2].nativeIdentity &&
      !journal.fixtures[3].nativeIdentity &&
      ['fixtures', 'actors', 'target', 'nativeUrl', 'client', 'marker'].every(
        (k) => sha(manifest[k]) === sha(prior.manifest[k]),
      ) &&
      sha(manifest.bindings.recording) === sha(prior.manifest.bindings.recording),
    'TEXT_V2_FAILED_ATTEMPT_BINDING',
  );
  const include = manifest.fixtures[2],
    program = manifest.fixtures[3];
  requireEvidence(
    journal.verifiedActors?.length === manifest.actors.length &&
      manifest.actors.every((actor) =>
        journal.verifiedActors.some(
          (value) =>
            value.label === actor.label &&
            value.email === actor.email &&
            value.sapUser === actor.sapUser &&
            value.identityAndScopesVerified === true,
        ),
      ),
    'TEXT_V2_ACTOR_BINDING',
  );
  for (const fixture of manifest.fixtures.slice(0, 2))
    assertRetainedObservation(prior, fixture, {
      fixtures: [journal.fixtures.find((f) => f.name === fixture.name).nativeIdentity],
    });
  const bodies = Object.entries(packet)
    .filter(([name]) => /^current-native-body-[a-f0-9-]+\.json$/.test(name))
    .map(([, d]) => d);
  requireEvidence(
    bodies.length === 17 && bodies.every((d) => d.status === 200 && sha(d.body) === d.sha256),
    'TEXT_V2_BODY_BINDING',
  );
  const path = `/sap/bc/adt/programs/includes/${include.name.toLowerCase()}`,
    metadata = bodies.filter((d) => d.path === path),
    sources = bodies.filter((d) =>
      [path + '/source/main', path + '/source/main?version=active'].includes(d.path),
    );
  requireEvidence(
    metadata.length === 2 &&
      metadata[0].body === metadata[1].body &&
      sources.length === 2 &&
      sources.every((d) => d.sha256 === prior.expected[include.name].sourceHash) &&
      sha(before.body) === prior.expected[include.name].metadataHash &&
      prior.journal.operations[1].args.source.includes(`INCLUDE ${include.name.toLowerCase()}.`) &&
      prior.journal.operations[3].tool === 'SAPActivate' &&
      prior.journal.operations[3].result.state === 'activated',
    'TEXT_V2_INCLUDE_OR_PROGRAM_BINDING',
  );
  const includeRelationship = proveOwnedIncludeRelationship(before.body, metadata[0].body, include, program);
  requireEvidence(
    includeRelationship.withoutProgramHash ===
      '233c1574592fa69c594061d3b476d1ff773e24303e6738937a746c30487950d8' &&
      includeRelationship.withProgramHash ===
        '0a4bc66a9c369da20680fa8c8ee710ec0bf99d4a8a97b4aec28d92e014b12a8a',
    'TEXT_V2_FIXED_INCLUDE_HASH',
  );
  return {
    ...prior,
    previous: prior,
    includeRelationship,
    expected: {
      ...prior.expected,
      [include.name]: { ...prior.expected[include.name], metadataHash: includeRelationship.withProgramHash },
    },
  };
}

export function readFixedTextTailV2History() {
  const prior = readFixedTextTailHistory();
  const read = (path, sha256) =>
    JSON.parse(boundBytes(path, { sha256, mode: '0o600' }, readFileSync, lstatSync));
  const audit = read(`${auditRoot}/result.json`, textTailV2Descriptor.auditSha256),
    entries = read(
      `${auditRoot}/initial-files.json`,
      'a89d450d06ced6eb49edd34fa2fd19618a13be921646ec804093872f9de06e6f',
    );
  // Preserve both the original audit and its delayed-post-control/restoration addendum.
  boundBytes(
    `${auditRoot}/result.md`,
    { sha256: audit.reportSha256, mode: '0o600' },
    readFileSync,
    lstatSync,
  );
  const post = read(
    `${auditRoot}/post-stop-addendum.json`,
    '03f7d2cc1e907cea40889721f89c4be064aacbb2b82ac749a6817757eea51f42',
  );
  boundBytes(
    `${auditRoot}/post-stop-addendum.md`,
    { sha256: post.reportSha256, mode: '0o600' },
    readFileSync,
    lstatSync,
  );
  for (const [path, value] of Object.entries(post.extraFiles))
    boundBytes(path, { ...value, mode: '0o600' }, readFileSync, lstatSync);
  const dir = lstatSync(textTailRoot);
  requireEvidence(
    dir.isDirectory() && !dir.isSymbolicLink() && dir.uid === process.getuid() && (dir.mode & 0o077) === 0,
    'TEXT_V2_HISTORY_DIRECTORY',
  );
  requireEvidence(
    entries.length === 30 &&
      sha(entries.map((e) => e.path.slice(textTailRoot.length + 1)).sort()) ===
        sha(readdirSync(textTailRoot).sort()),
    'TEXT_V2_HISTORY_MEMBERSHIP',
  );
  const packet = {};
  for (const entry of entries) {
    const name = entry.path.slice(textTailRoot.length + 1);
    requireEvidence(
      entry.path === `${textTailRoot}/${name}` &&
        !name.includes('/') &&
        !name.includes('\\') &&
        !name.startsWith('.env') &&
        !name.includes('credential'),
      'TEXT_V2_HISTORY_PATH',
    );
    const bytes = boundBytes(entry.path, entry, readFileSync, lstatSync);
    if (name.endsWith('.json')) packet[name] = JSON.parse(bytes);
  }
  requireEvidence(
    sha(readFileSync(`${textTailRoot}/current-workflow-result.json`)) === audit.resultSha256,
    'TEXT_V2_RESULT_CHANGED',
  );
  const before = read(priorMetadata, '1a627eeeb5dd19383cf7b31caf36b1567a9b663a954536779a74010c44b99618');
  return validateTextTailV2Packet(prior, packet, before);
}

export function assertTextTailV2Context(history, run, manifest, config) {
  requireEvidence(
    config.root === textTailV2Root &&
      sha(run.retained) === sha(textTailV2Descriptor) &&
      manifest.marker === retainedMarker &&
      ['fixtures', 'actors', 'target', 'nativeUrl', 'client'].every(
        (k) => sha(manifest[k]) === sha(history.manifest[k]),
      ) &&
      sha(manifest.bindings.recording) === sha(history.manifest.bindings.recording),
    'TEXT_V2_CONTEXT_MISMATCH',
  );
}
