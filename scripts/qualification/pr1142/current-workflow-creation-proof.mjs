import { readdir } from 'node:fs/promises';
import { currentFixtureSources, requireEvidence, sha } from './current-workflow-contract.mjs';
import { privateJson } from './safe-io.mjs';

/** A successful, actor-bound PP create receipt proves this fixture's lifecycle; it is not native creator metadata. */
export function qualifyCreatedOwner({ manifest, run, journal, fixture, receipts, verifiedActor }) {
  const actor = manifest.actors.find((a) => a.label === fixture.actor);
  requireEvidence(
    actor?.write === true &&
      verifiedActor?.label === actor.label &&
      verifiedActor.email === actor.email &&
      verifiedActor.sapUser === actor.sapUser &&
      verifiedActor.identityAndScopesVerified === true &&
      journal.runId === run.runId &&
      journal.sourceRevision === run.sourceRevision &&
      journal.harnessSha256 === run.harnessSha256 &&
      journal.manifestSha256 === sha(manifest),
    'CURRENT_CREATE_PROVENANCE_BINDING',
  );
  const creates = journal.operations.filter(
    (o) => o.tool === 'SAPWrite' && o.args?.action === 'create' && o.args.name === fixture.name,
  );
  requireEvidence(creates.length === 1, 'CURRENT_UNIQUE_CREATE_REQUIRED');
  const create = creates[0],
    expected = currentFixtureSources(fixture, manifest.marker, manifest.fixtures).initial;
  requireEvidence(
    create.phase === `create-${fixture.name}` &&
      create.args.type === fixture.type &&
      create.args.package === fixture.package &&
      create.args.source === expected &&
      create.outcome === 'response-received' &&
      create.isError === false &&
      create.result?.cleanupFailed !== true &&
      create.result?.target === manifest.target &&
      create.result?.state === 'saved-inactive' &&
      create.result.name === fixture.name &&
      create.result.type === fixture.type &&
      (actor.label === 'writerA'
        ? create.args.transport === manifest.bindings.recording.task &&
          create.result.transport === manifest.bindings.recording.request
        : create.args.transport === undefined),
    'CURRENT_CREATE_PROVENANCE_MISMATCH',
  );
  const matching = receipts.filter((r) => {
    if (
      r.runId !== run.runId ||
      r.actor !== actor.label ||
      r.phase !== create.phase ||
      r.method !== 'tools/call' ||
      r.status !== 200 ||
      !Number.isFinite(Date.parse(r.at)) ||
      Date.parse(r.at) < Date.parse(create.startedAt) ||
      Date.parse(r.at) > Date.parse(create.receivedAt)
    )
      return false;
    const result = r.response?.result;
    if (!result || result.isError === true || r.response.error) return false;
    try {
      return sha(JSON.parse(result.content.find((c) => c.type === 'text').text)) === sha(create.result);
    } catch {
      return false;
    }
  });
  requireEvidence(
    matching.length === 1 &&
      Number.isFinite(Date.parse(create.startedAt)) &&
      Number.isFinite(Date.parse(create.receivedAt)),
    'CURRENT_CREATE_RESPONSE_REQUIRED',
  );
  return {
    kind: 'verified-pp-create',
    runId: run.runId,
    sourceRevision: run.sourceRevision,
    actor: actor.label,
    name: fixture.name,
    type: fixture.type,
    createReceiptHash: sha(matching[0]),
    initialSourceHash: sha(expected),
  };
}

export async function readCurrentCreationProof({
  root,
  run,
  manifest,
  fixture,
  read = privateJson,
  list = (path) => readdir(path),
}) {
  const journal = await read(`${root}/current-workflow-result.json`);
  const names = (await list(root)).filter((n) => /^current-rpc-[a-f0-9-]{36}\.json$/.test(n));
  requireEvidence(names.length <= 128, 'CURRENT_RECEIPT_BOUND');
  const receipts = [];
  for (const name of names) receipts.push(await read(`${root}/${name}`));
  return qualifyCreatedOwner({
    manifest,
    run,
    journal,
    fixture,
    receipts,
    verifiedActor: journal.verifiedActors?.find((a) => a.label === fixture.actor),
  });
}
