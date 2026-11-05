import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import {
  assertRetainedObservation,
  boundBytes,
  readFixedRetainedHistory,
  retainedDescriptor,
  retainedMarker,
  retainedRoot,
} from './current-retained-history.mjs';
import { currentFixtureSources, requireEvidence, sha } from './current-workflow-contract.mjs';
import { qualifyCreatedOwner } from './current-workflow-creation-proof.mjs';

export const textTailPlan = 'current-pp-text-tail-v1';
export const textTailRoot = '/Users/marianzeis/.local/state/arc1-qualification/pr1142-current-pp-text-tail-v1';
export const textTailDescriptor = Object.freeze({
  plan: textTailPlan,
  originalRunId: 'adc9869a-07d3-4923-af84-7bd18f42d206',
  originalSourceRevision: '4d2724fc5849375a5e7a6b391eb1484cf5437600',
  failedResultSha256: 'c5967814cf86158ded9154f1c1a3d062242532b67baa395f76058d27790b273c',
  auditSha256: '2cd92da57b517010dfef601da52d86249899bf817b3b5f8f189cbf7f03e2c369',
  prior: retainedDescriptor,
});
const auditPath =
  '/Users/marianzeis/.local/state/arc1-review/pr1142-current-pp-retained-stop-independent-audit1/result.json';
const rootPaths = [
  retainedRoot,
  '/Users/marianzeis/.local/state/arc1-review/pr1142-pp-text-save-diagnostics-20261104',
  '/Users/marianzeis/.local/state/arc1-review/pr1142-retained-pp-operator-binding-correction1',
];
const count = [114, 20, 7],
  empty = sha('');

/** Fixed packet semantics; production loader binds every noncredential byte before this parser. */
export function validateTextTailPacket(prior, { run, manifest, journal, receipts, diagnostics }) {
  requireEvidence(
    manifest?.fixtures?.length === 4 &&
      Array.isArray(journal?.operations) &&
      journal.fixtures?.length === 4 &&
      Array.isArray(receipts) &&
      Array.isArray(diagnostics),
    'TEXT_TAIL_PACKET_INVALID',
  );
  const program = manifest.fixtures[3],
    operations = journal.operations;
  requireEvidence(
    run.runId === textTailDescriptor.originalRunId &&
      run.sourceRevision === textTailDescriptor.originalSourceRevision &&
      sha(run.retained) === sha(retainedDescriptor) &&
      journal.runId === run.runId &&
      journal.sourceRevision === run.sourceRevision &&
      journal.failure === true &&
      journal.failedPhase === `text-${program.name}` &&
      journal.error?.code === 'CURRENT_TOOL_REFUSED' &&
      journal.firstMutationMayHaveBeenSubmitted === true &&
      sha(manifest.fixtures) === sha(prior.manifest.fixtures) &&
      sha(manifest.actors) === sha(prior.manifest.actors) &&
      sha(manifest.bindings.recording) === sha(prior.manifest.bindings.recording) &&
      manifest.marker === retainedMarker &&
      manifest.target === prior.manifest.target &&
      manifest.nativeUrl === prior.manifest.nativeUrl &&
      manifest.client === '001',
    'TEXT_TAIL_FAILURE_BINDING',
  );
  requireEvidence(
    operations.length === 5 &&
      operations.every((o) => o.args?.name === program.name && o.outcome === 'response-received') &&
      operations[0].args.action === 'create' &&
      operations[1].args.action === 'update' &&
      operations[1].isError === false &&
      operations[1].result.state === 'saved-inactive' &&
      operations[1].args.source === currentFixtureSources(program, manifest.marker, manifest.fixtures).updated &&
      operations[2].args.action === 'update' &&
      operations[2].isError === true &&
      operations[2].result.state === 'unchanged' &&
      operations[2].args.expectedSourceHash === operations[0].result.sourceHash &&
      operations[3].tool === 'SAPActivate' &&
      operations[3].isError === false &&
      operations[3].result.state === 'activated' &&
      operations[3].result.textPoolState === 'active' &&
      operations[4].args.action === 'edit_text_symbols' &&
      operations[4].args.source === `001=${manifest.marker.slice(0, 16)} PP fixture\n` &&
      operations[4].isError === true &&
      operations[4].result.state === 'text-save-unknown' &&
      operations[4].result.statusCode === 406 &&
      operations[4].result.sessionClosed === true &&
      journal.fixtures.length === 4 &&
      journal.fixtures.every((f) => f.attempted === true && f.deleted === false && !f.deletionAcknowledged) &&
      journal.remaining.length === 4,
    'TEXT_TAIL_COMPLETED_PREFIX_MISMATCH',
  );
  for (const fixture of manifest.fixtures.slice(0, 3))
    assertRetainedObservation(prior, fixture, {
      fixtures: [journal.fixtures.find((f) => f.name === fixture.name).nativeIdentity],
    });
  const proof = qualifyCreatedOwner({
    manifest,
    run,
    journal,
    receipts,
    fixture: program,
    verifiedActor: journal.verifiedActors?.find((a) => a.label === program.actor),
  });
  requireEvidence(
    diagnostics.length === 16 &&
      diagnostics.every(
        (d) =>
          d.sourceRevision === run.sourceRevision && d.method === 'GET' && d.status === 200 && sha(d.body) === d.sha256,
      ),
    'TEXT_TAIL_DIAGNOSTIC_BINDING',
  );
  const sourceHash = '228b716d93df8b5a129db782a27594528a1e25e41877f0343c98660ca5764643',
    metadataHash = '4dad1e7932a21f427f30d54c11eb35ac6a1e5632e1842e5f07828ce0452fb571';
  requireEvidence(
    operations[1].result.sourceHash === sourceHash &&
      [1, 4, 7].every((i) => diagnostics[i].sha256 === sourceHash) &&
      [0, 3, 6].every((i) => diagnostics[i].sha256 === metadataHash) &&
      [9, 10, 11, 12, 15].every((i) => diagnostics[i].sha256 === empty) &&
      diagnostics[13].sha256 === diagnostics[14].sha256,
    'TEXT_TAIL_RETAINED_READBACK_MISMATCH',
  );
  const textPool = {
    metadataHash: '77994c1d962af4812a0cb3a11285a935756bb45eb098a4926124cf4cdf1e75b5',
    parts: {
      symbols: empty,
      selections: empty,
      headings: 'a3cf2161fa9820c374e78862af37a9f4b54b7ff7a810773dc6de8009a1492fd1',
    },
  };
  requireEvidence(
    [2, 5, 8].every((i) => diagnostics[i].sha256 === textPool.metadataHash) &&
      diagnostics[13].sha256 === textPool.parts.headings,
    'TEXT_TAIL_POOL_MISMATCH',
  );
  return {
    ...prior,
    previous: prior,
    run,
    manifest,
    journal,
    proofs: { ...prior.proofs, [program.name]: proof },
    expected: {
      ...prior.expected,
      [program.name]: { name: program.name, type: 'PROG', sourceHash, metadataHash, textPool },
    },
    origins: Object.fromEntries(
      manifest.fixtures.map((f) => [f.name, f.type === 'PROG' ? run.runId : retainedDescriptor.originalRunId]),
    ),
  };
}

export function readFixedTextTailHistory() {
  const prior = readFixedRetainedHistory(),
    read = readFileSync,
    stat = lstatSync;
  const audit = JSON.parse(boundBytes(auditPath, { sha256: textTailDescriptor.auditSha256 }, read, stat));
  requireEvidence(
    audit.originalUnchanged === true &&
      audit.entriesVerified === 141 &&
      audit.runResultSha256 === textTailDescriptor.failedResultSha256,
    'TEXT_TAIL_AUDIT_MISMATCH',
  );
  const packets = [];
  for (const [i, root] of rootPaths.entries()) {
    const dir = stat(root);
    requireEvidence(
      dir.isDirectory() && !dir.isSymbolicLink() && dir.uid === process.getuid() && (dir.mode & 0o077) === 0,
      'TEXT_TAIL_DIRECTORY_INVALID',
    );
    const key = root.replace('/Users/marianzeis/.local/state/', ''),
      entries = audit.roots?.[key];
    requireEvidence(
      entries &&
        Object.keys(entries).length === count[i] &&
        sha(Object.keys(entries).sort()) === sha(readdirSync(root).sort()),
      'TEXT_TAIL_MEMBERSHIP_CHANGED',
    );
    const packet = {};
    for (const [name, value] of Object.entries(entries)) {
      requireEvidence(
        !name.includes('/') && !name.includes('\\') && !name.startsWith('.env'),
        'TEXT_TAIL_PATH_REFUSED',
      );
      // Secret and control pipe are not lifecycle evidence. Never open, copy or consume either.
      if (name === 'xsuaa-credentials.json' || name === 'commands.fifo') continue;
      const bytes = boundBytes(`${root}/${name}`, { ...value, mode: `0o${value.mode.toString(8)}` }, read, stat);
      if (name.endsWith('.json')) packet[name] = JSON.parse(bytes);
    }
    packets.push(packet);
  }
  const [run, diagnostics] = packets;
  requireEvidence(
    audit.roots[rootPaths[0].replace('/Users/marianzeis/.local/state/', '')]['current-workflow-result.json'].sha256 ===
      textTailDescriptor.failedResultSha256,
    'TEXT_TAIL_RESULT_CHANGED',
  );
  return validateTextTailPacket(prior, {
    run: run['run-manifest.json'],
    manifest: run['fixture-manifest.json'],
    journal: run['current-workflow-result.json'],
    receipts: Object.keys(run)
      .filter((n) => /^current-rpc-[a-f0-9-]+\.json$/.test(n))
      .map((n) => run[n]),
    diagnostics: Array.from({ length: 16 }, (_, i) => diagnostics[`${String(i + 1).padStart(3, '0')}.json`]),
  });
}
export function assertTextTailContext(history, run, manifest, config) {
  requireEvidence(
    config.root === textTailRoot &&
      run.retained &&
      sha(run.retained) === sha(textTailDescriptor) &&
      manifest.marker === retainedMarker &&
      ['fixtures', 'actors', 'target', 'nativeUrl', 'client'].every(
        (k) => sha(manifest[k]) === sha(history.manifest[k]),
      ) &&
      sha(manifest.bindings.recording) === sha(history.manifest.bindings.recording),
    'TEXT_TAIL_CONTEXT_MISMATCH',
  );
}
export function assertTextTailObservation(history, fixture, observed) {
  const value = assertRetainedObservation(history, fixture, observed);
  if (fixture.type === 'PROG')
    requireEvidence(sha(value.textPool) === sha(history.expected[fixture.name].textPool), 'TEXT_TAIL_POOL_CHANGED');
  return value;
}
