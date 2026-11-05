/** Private-adapter driver. No credential loading or CLI; all mutation scope belongs to fixed fixture data. */
import type { AdtClient } from '../../../src/adt/client.js';
import type { AdtRequestOptions } from '../../../src/adt/http.js';
import { pinnedMutationContext } from '../../../src/adt/mutation-context.js';
import { createPinnedDeclarativeContext } from '../../../src/handlers/write/pinned-declarative-context.js';
import { executePinnedSourceWrite } from '../../../src/handlers/write/pinned-source-write.js';
import { handlePrivatePinnedDeclarativeActivation } from '../../../src/handlers/write/pinned-activation.js';
import { requestContext } from '../../../src/server/context.js';
import type { ServerConfig } from '../../../src/server/types.js';
import { declarativeAbsence, declarativeOwnerAbsent, declarativeSnapshot } from './native-declarative-evidence.js';
import type { DeclarativeFixture } from './native-declarative-fixtures.js';
import { checkDeclarativeRequest, isDeclarativeOwnerUnlock } from './native-declarative-transport.js';
import {
  boundSourceCheck,
  DeclarativeFailure,
  type DeclarativeDriver,
  type DeclarativeReason,
  type DeclarativeReceipt,
  runNativeDeclarativeWorkflow,
} from './native-declarative-workflow.js';
import type { DeclarativeReadOnlyReference } from './native-declarative-v5-references.js';
import { observeNativeHttp } from './native-observed-http.js';

/** Refusal text reaches receipts through the shared observer, so every guard speaks in fixed reasons. */
function fixedReason<T>(fallback: DeclarativeReason, guard: () => T): T {
  try {
    return guard();
  } catch (error) {
    throw error instanceof DeclarativeFailure ? error : new DeclarativeFailure(fallback);
  }
}

function resultPayload(result: { content: { text: string }[] }): { [key: string]: unknown } {
  try {
    return JSON.parse(result.content[0].text);
  } catch {
    return {};
  }
}

export async function runNativeDeclarativeContract(input: {
  base: AdtClient; config: ServerConfig; fixtures: readonly DeclarativeFixture[];
  readOnlyReferences?: readonly DeclarativeReadOnlyReference[];
  record: (value: unknown) => void; verifySource: () => void; shouldStop: () => boolean;
}) {
  const { base, config, fixtures, record, shouldStop, readOnlyReferences = [] } = input;
  const verifySource = boundSourceCheck(input.verifySource);
  const finishBy = Date.now() + 12 * 60_000;
  const forwardBy = finishBy - 4 * 60_000;
  let selected: DeclarativeFixture | undefined;
  let cleanup = false;
  let deletionReceipt: DeclarativeReceipt | undefined;
  let mutationAttempted = false;
  const createsSent = new Set<string>();
  const sources = new Map<string, string>();
  const policy = () => ({ deadline: Math.min(Date.now() + 60_000, cleanup ? finishBy : forwardBy) });
  async function verifyReceipt(fixture: DeclarativeFixture, receipt: DeclarativeReceipt, options: AdtRequestOptions = policy()) {
    const expected = sources.get(fixture.owner);
    if (!expected) throw new DeclarativeFailure('receipt-missing');
    const current = await declarativeSnapshot(base.http, fixture, expected, receipt.activeVerified, record, options);
    if (current.sourceHash !== receipt.sourceHash || current.metadataHash !== receipt.metadataHash || current.activeMetadataHash !== receipt.activeMetadataHash) throw new DeclarativeFailure('receipt-drift');
  }
  // The observer journals immediately before sending, so an attempt counts even if the send then fails.
  const observe = (value: unknown) => {
    const row = value as { stage?: string; method?: string; path?: string };
    if (row.stage === 'request' && row.method !== 'GET' && row.method !== 'HEAD' && !row.path?.startsWith('/sap/bc/adt/cts/transportchecks')) {
      mutationAttempted = true;
      if (selected && row.method === 'POST' && row.path?.split('?')[0] === selected.owner.replace(/\/[^/]+$/, '')) createsSent.add(selected.owner);
    }
    record(value);
  };
  const http = observeNativeHttp(base.http, (method, path, body) => fixedReason('request-out-of-scope', () => {
    checkDeclarativeRequest(selected, method, path, body);
    // A validated own UNLOCK survives a stop or binding failure, so release never depends on session close alone.
    if (isDeclarativeOwnerUnlock(selected, method, path)) return;
    verifySource();
    if (shouldStop() && method !== 'GET' && method !== 'HEAD') throw new DeclarativeFailure('stopped');
  }), observe, async (_session, path, options) => {
    try {
      verifySource();
      if (shouldStop()) throw new DeclarativeFailure('stopped');
      if (!cleanup || !selected || path !== selected.owner || !deletionReceipt) throw new DeclarativeFailure('deletion-receipt-missing');
      // Extra receipt reads stay stateless; the production deletion retains its own lock/session.
      await verifyReceipt(selected, deletionReceipt, options);
      for (const child of fixtures.filter(fixture => fixture.dependencies.includes(selected!.owner))) await declarativeOwnerAbsent(base.http, child, record, options);
      for (const reference of readOnlyReferences.filter(r => r.referencedBy === selected!.owner)) await declarativeOwnerAbsent(base.http, reference, record, options);
      // A stop can arrive during the guard reads; DELETE must not follow it.
      if (shouldStop()) throw new DeclarativeFailure('stopped');
    } catch (error) {
      throw error instanceof DeclarativeFailure ? error : new DeclarativeFailure('delete-guard-unconfirmed');
    }
  });
  const client = Object.assign(Object.create(Object.getPrototypeOf(base)), base, { http }) as AdtClient;
  async function verifyReferences(fixture: DeclarativeFixture) {
    for (const reference of readOnlyReferences.filter(r => r.referencedBy === fixture.owner)) {
      verifySource();
      await declarativeOwnerAbsent(base.http, reference, record, policy());
      verifySource();
    }
  }
  async function write(fixture: DeclarativeFixture, action: 'create' | 'update' | 'delete', prior?: DeclarativeReceipt) {
    selected = fixture;
    cleanup = action === 'delete';
    deletionReceipt = cleanup ? prior : undefined;
    if (prior) await verifyReceipt(fixture, prior);
    const expected = action === 'update' ? fixture.updatedSource : fixture.source;
    const context = pinnedMutationContext(client.safety, policy(), { unlockFailed: false });
    const args = {
      type: fixture.type, name: fixture.name, action,
      ...(action === 'delete' ? {} : { source: expected }),
      ...(action === 'create' ? { package: '$TMP', description: fixture.description } : {}),
      ...(action === 'update' ? { expectedSourceHash: prior?.sourceHash } : {}),
    };
    const result = await executePinnedSourceWrite(fixedReason('adapter-refused', () => createPinnedDeclarativeContext(client, args, config, context)));
    record({ operation: action, owner: fixture.owner, result, cleanup: context.cleanup });
    const payload = resultPayload(result);
    const cleanupConfirmed = !context.cleanup.unlockFailed && !context.cleanup.unknownLocks?.length && context.cleanup.sessionClosed === true;
    if (action === 'delete') {
      if (payload.state !== 'deleted') throw new DeclarativeFailure(payload.state === 'unchanged' ? 'delete-not-sent' : 'delete-unconfirmed');
      // The adapter's typed readback needs independent agreement; only then is this owner reported as deleted.
      await declarativeOwnerAbsent(base.http, fixture, record, policy());
      sources.delete(fixture.owner);
      if (result.isError || !cleanupConfirmed) throw new DeclarativeFailure('deleted-cleanup-unconfirmed', { ownerDeleted: true });
      return;
    }
    if (result.isError || !cleanupConfirmed) {
      // Both independent signals are required before an owner is excluded from uncertainty.
      if (action === 'create' && payload.state === 'unchanged' && !createsSent.has(fixture.owner)) throw new DeclarativeFailure('create-not-sent', { createNeverSent: true });
      throw new DeclarativeFailure('write-unconfirmed');
    }
    await verifyReferences(fixture);
    const receipt = await declarativeSnapshot(base.http, fixture, expected, false, record, policy());
    if (payload.state !== 'saved-inactive' || payload.sourceHash !== receipt.sourceHash) throw new DeclarativeFailure('save-disagrees');
    sources.set(fixture.owner, expected);
    return receipt;
  }
  const driver: DeclarativeDriver = {
    record, verifySource, shouldStop,
    mutationAttempted: () => mutationAttempted,
    preflight: async rows => { cleanup = false; await declarativeAbsence(base.http, rows, record, policy(), readOnlyReferences); },
    create: async fixture => (await write(fixture, 'create'))!,
    update: async (fixture, receipt) => (await write(fixture, 'update', receipt))!,
    async activate(fixture, receipt) {
      selected = fixture; cleanup = false; deletionReceipt = undefined;
      await verifyReceipt(fixture, receipt);
      const timeout = policy().deadline - Date.now();
      if (shouldStop()) throw new DeclarativeFailure('stopped');
      if (timeout <= 0) throw new DeclarativeFailure('activation-budget');
      let result: Awaited<ReturnType<typeof handlePrivatePinnedDeclarativeActivation>>;
      try {
        result = await requestContext.run({ requestId: `native-declarative-${fixture.type}`, signal: AbortSignal.timeout(timeout) }, () => handlePrivatePinnedDeclarativeActivation(client, { type: fixture.type, name: fixture.name }));
      } catch {
        throw new DeclarativeFailure('activation-unconfirmed');
      }
      record({ operation: 'activate', owner: fixture.owner, result });
      const payload = resultPayload(result);
      if (result.isError || !payload.success || payload.activeSourceVerified !== true || payload.nativeStateVerified !== true) throw new DeclarativeFailure('activation-unconfirmed');
      await verifyReferences(fixture);
      const current = await declarativeSnapshot(base.http, fixture, sources.get(fixture.owner)!, true, record, policy());
      if (current.sourceHash !== receipt.sourceHash) throw new DeclarativeFailure('activation-source-changed');
      return current;
    },
    remove: async (fixture, receipt) => { await write(fixture, 'delete', receipt); },
    finalAbsence: async rows => { cleanup = true; await declarativeAbsence(base.http, rows, record, policy(), readOnlyReferences); },
  };
  return runNativeDeclarativeWorkflow(fixtures, driver);
}
