import { describe, expect, it, vi } from 'vitest';
import {
  currentFixtureSources,
  makeCurrentManifest,
  sha,
} from '../../../scripts/qualification/pr1142/current-workflow-contract.mjs';
import {
  qualifyCreatedOwner,
  readCurrentCreationProof,
} from '../../../scripts/qualification/pr1142/current-workflow-creation-proof.mjs';

function setup(index = 2) {
  const actor = { label: 'writerA', email: 'primary@example.invalid', sapUser: 'PRIMARY', write: true };
  const manifest = makeCurrentManifest(
    '0123456789ABCDEF0123456789ABCDEF',
    { recording: { package: 'ZARC1_DEMO', request: 'A4HK900001', task: 'A4HK900002', owner: 'PRIMARY' } },
    { target: 'PR1142/001', actors: [actor] },
  );
  const fixture = manifest.fixtures[index];
  const run = {
    runId: '11111111-1111-4111-8111-111111111111',
    sourceRevision: 'a'.repeat(40),
    harnessSha256: 'b'.repeat(64),
  };
  const create: any = {
    phase: `create-${fixture.name}`,
    tool: 'SAPWrite',
    args: {
      type: fixture.type,
      name: fixture.name,
      package: fixture.package,
      action: 'create',
      source: currentFixtureSources(fixture, manifest.marker, manifest.fixtures).initial,
      transport: 'A4HK900002',
    },
    startedAt: '2026-11-03T14:00:00.000Z',
    receivedAt: '2026-11-03T14:00:01.000Z',
    outcome: 'response-received',
    isError: false,
    result: {
      state: 'saved-inactive',
      target: manifest.target,
      name: fixture.name,
      type: fixture.type,
      transport: 'A4HK900001',
    },
  };
  const verifiedActor = { ...actor, identityAndScopesVerified: true };
  const journal = { ...run, manifestSha256: sha(manifest), operations: [create], verifiedActors: [verifiedActor] };
  const receipt: any = {
    runId: run.runId,
    actor: actor.label,
    phase: create.phase,
    method: 'tools/call',
    status: 200,
    at: '2026-11-03T14:00:00.999Z',
    response: { result: { content: [{ type: 'text', text: JSON.stringify(create.result) }] } },
  };
  return { manifest, fixture, run, journal, create, verifiedActor, receipts: [receipt], receipt };
}
describe.each([2, 3])('actor-bound actual PP creation proof for owner %i', (index) => {
  it('binds the actual successful response, planned source, actor and target', () => {
    const f = setup(index);
    expect(qualifyCreatedOwner(f)).toMatchObject({
      kind: 'verified-pp-create',
      name: f.fixture.name,
      actor: 'writerA',
      createReceiptHash: sha(f.receipt),
      initialSourceHash: sha(f.create.args.source),
    });
  });
  it.each([
    'wrong actor',
    'wrong principal',
    'unverified actor',
    'wrong run',
    'wrong manifest',
    'duplicate create',
    'wrong source',
    'wrong target',
    'wrong request',
    'wrong task',
    'failed create',
    'unanswered create',
    'receipt actor',
    'receipt body',
    'receipt time',
    'invalid receipt time',
    'uncertain cleanup',
    'missing receipt',
    'duplicate receipt',
  ])('refuses %s without native calls', (fault) => {
    const f = setup(index);
    if (fault === 'wrong actor') f.verifiedActor.label = 'writerB';
    if (fault === 'wrong principal') f.verifiedActor.sapUser = 'FOREIGN';
    if (fault === 'unverified actor') f.verifiedActor.identityAndScopesVerified = false;
    if (fault === 'wrong run') f.journal.runId = 'different';
    if (fault === 'wrong manifest') f.journal.manifestSha256 = 'c'.repeat(64);
    if (fault === 'duplicate create') f.journal.operations.push(f.create);
    if (fault === 'wrong source') f.create.args.source += 'foreign';
    if (fault === 'wrong target') f.create.result.target = 'OTHER/001';
    if (fault === 'wrong request') f.create.result.transport = 'A4HK999999';
    if (fault === 'wrong task') f.create.args.transport = 'A4HK999999';
    if (fault === 'failed create') f.create.isError = true;
    if (fault === 'unanswered create') f.create.outcome = 'unconfirmed';
    if (fault === 'receipt actor') f.receipt.actor = 'readerA';
    if (fault === 'receipt body') f.receipt.response.result.content[0].text = '{}';
    if (fault === 'invalid receipt time') f.receipt.at = 'invalid';
    if (fault === 'uncertain cleanup') f.create.result.cleanupFailed = true;
    if (fault === 'receipt time') f.receipt.at = '2026-11-03T14:00:02.000Z';
    if (fault === 'missing receipt') f.receipts = [];
    if (fault === 'duplicate receipt') f.receipts.push(f.receipt);
    expect(() => qualifyCreatedOwner(f)).toThrow();
  });
  it('reads only saved journal and bounded RPC receipts, never credential or environment inputs', async () => {
    const f = setup(index),
      name = 'current-rpc-22222222-2222-4222-8222-222222222222.json';
    const read = vi.fn(async (path: string) => (path.endsWith('current-workflow-result.json') ? f.journal : f.receipt));
    const list = vi.fn(async () => [name, 'credentials.json', '.env', 'commands.fifo']);
    expect(await readCurrentCreationProof({ ...f, root: '/private/fixed', read, list })).toEqual(
      qualifyCreatedOwner(f),
    );
    expect(read.mock.calls.map(([p]) => p)).toEqual([
      '/private/fixed/current-workflow-result.json',
      `/private/fixed/${name}`,
    ]);
  });
});
