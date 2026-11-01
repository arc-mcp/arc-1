/** Bounded owner deletion candidate over the shared native DELETE and lock/session lifecycle. */
import type { AdtClient } from './client.js';
import { deleteObject, withLockedMutation } from './crud.js';
import { AdtApiError, AdtSafetyError } from './errors.js';
import { throwIfRequestCancelled } from './http-deadline.js';
import { mutationClient } from './mutation-client.js';
import { assertMutationContext, type PinnedMutationContext } from './mutation-context.js';
import { assertPinnedOwner, pinnedRecording, validatePinnedLock } from './pinned-write-policy.js';
import { checkOperation, checkPackage, OperationType } from './safety.js';

export interface PinnedDeleteResult {
  ok: boolean;
  state: 'unchanged' | 'delete-rejected' | 'delete-unconfirmed' | 'deleted';
  phase: string;
  retryable: false;
  statusCode?: number;
  message?: string;
  cleanupFailed?: boolean;
  sessionClosed?: boolean;
}

/**
 * Initially limited to the already-qualified CLAS/INTF owner/recording representation.
 * This helper does not admit SAPWrite.delete. Additional object families must preserve their
 * existing native prechecks (notably ENHO technology and PROG/FUGR text-pool locks).
 */
export async function deletePinnedOwner(
  client: AdtClient,
  context: PinnedMutationContext,
  input: { type: string; name: string; transport?: string },
): Promise<PinnedDeleteResult> {
  const outcome: { state: PinnedDeleteResult['state']; message?: string } = { state: 'unchanged' };
  let phase = 'validation';
  let statusCode: number | undefined;
  try {
    assertMutationContext(client.safety, context);
    if (context.mode !== 'pinned-pp') throw new AdtSafetyError('A pinned mutation context is required.');
    checkOperation(client.safety, OperationType.Delete, 'PinnedDelete');
    assertPinnedOwner(input.type, input.name);
    const collection = input.type === 'CLAS' ? 'classes' : 'interfaces';
    const owner = `/sap/bc/adt/oo/${collection}/${encodeURIComponent(input.name.toLowerCase())}`;
    if (input.transport !== undefined && !input.transport.trim())
      throw new AdtSafetyError('An explicitly provided CTS request must not be empty.');
    const requested = input.transport?.trim().toUpperCase();
    const scoped = mutationClient(client, context);
    const options = context.requestPolicy;
    const packageFor = async (activeClient: AdtClient) => {
      throwIfRequestCancelled(options);
      const pkg = await activeClient.resolveObjectPackage(owner, undefined, options);
      if (!pkg) throw new AdtSafetyError('Deletion requires the actual native owner package.');
      await checkPackage(activeClient.safety, pkg, activeClient.getPackageHierarchyResolver(options));
      return pkg;
    };
    phase = 'package-preflight';
    const pkg = await packageFor(scoped);
    phase = 'recording-preflight';
    const recording = await pinnedRecording(scoped.http, scoped.safety, owner, pkg, '', requested, options);
    await withLockedMutation(
      client.http,
      client.safety,
      context,
      owner,
      {
        beforeLock: () => {
          phase = 'lock';
          throwIfRequestCancelled(options);
        },
        validateLock: async (session, lock) => {
          phase = 'locked-policy';
          const current = mutationClient(client, context, session);
          if ((await packageFor(current)) !== pkg)
            throw new AdtSafetyError('The owner package changed since deletion preflight.');
          const fresh = await pinnedRecording(session, client.safety, owner, pkg, '', recording.request, options);
          if (fresh.local !== recording.local || fresh.request !== recording.request)
            throw new AdtSafetyError('Recording context changed since deletion preflight.');
          await validatePinnedLock(session, client.safety, lock, fresh, options);
        },
      },
      async (session, lock) => {
        throwIfRequestCancelled(options);
        phase = 'delete';
        outcome.state = 'delete-unconfirmed';
        // Reuse the same native wire adapter as ordinary SAPWrite deletion.
        await deleteObject(session, client.safety, owner, lock.lockHandle, recording.request);
        phase = 'absence-readback';
        try {
          await session.get(owner, { 'Cache-Control': 'no-cache' }, options);
        } catch (error) {
          if (error instanceof AdtApiError && error.isNotFound) {
            outcome.state = 'deleted';
            return;
          }
          throw error;
        }
        throw new AdtSafetyError('DELETE returned but the native owner still exists. Inspect before continuing.');
      },
    );
  } catch (error) {
    if (error instanceof AdtSafetyError) outcome.message = error.message;
    if (error instanceof AdtApiError) {
      statusCode = error.statusCode;
      if (phase === 'delete' && [400, 401, 403, 404, 409, 412, 415, 422, 423].includes(error.statusCode))
        outcome.state = 'delete-rejected';
    }
  }
  const cleanupFailed = context?.mode === 'pinned-pp' && context.cleanup?.unlockFailed === true;
  return {
    ok: outcome.state === 'deleted' && !cleanupFailed,
    ...outcome,
    phase: cleanupFailed ? 'unlock' : phase,
    retryable: false,
    ...(statusCode === undefined ? {} : { statusCode }),
    ...(cleanupFailed ? { cleanupFailed: true, sessionClosed: context.cleanup.sessionClosed } : {}),
  };
}
