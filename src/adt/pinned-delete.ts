/** Bounded owner deletion candidate over the shared native DELETE and lock/session lifecycle. */
import type { AdtClient } from './client.js';
import { deleteObject, withLockedMutation } from './crud.js';
import { AdtApiError, AdtSafetyError, classifySapDomainError, extractExceptionType } from './errors.js';
import { throwIfRequestCancelled } from './http-deadline.js';
import { mutationClient } from './mutation-client.js';
import { assertMutationContext, type MutationCleanupState, type PinnedMutationContext } from './mutation-context.js';
import { pinnedFunctionSelection, readPinnedFunctionOwner } from './pinned-function-owner.js';
import { type PinnedProgramOwnerEvidence, readPinnedProgramOwner } from './pinned-program-owner.js';
import { assertPinnedSourceOwner, pinnedRecording, validatePinnedLock } from './pinned-write-policy.js';
import { checkOperation, checkPackage, OperationType } from './safety.js';
import { withPinnedActiveTextPoolForDelete } from './text-elements.js';

export interface PinnedDeleteResult {
  ok: boolean;
  state: 'unchanged' | 'delete-rejected' | 'delete-unconfirmed' | 'deleted';
  phase: string;
  retryable: false;
  statusCode?: number;
  message?: string;
  cleanupFailed?: boolean;
  cleanupPhase?: 'unlock' | 'session-close';
  cleanup?: string;
  sessionClosed?: boolean;
  includeUsage?: PinnedProgramOwnerEvidence['includeUsage'];
  warnings?: string;
  unlockFailures?: MutationCleanupState['unlockFailures'];
  removedLocksAfterDelete?: MutationCleanupState['removedLocksAfterDelete'];
}

/**
 * Explicit standalone source owners only. Programs preserve the native text-pool draft guard.
 * Other families require their own ownership, recording and technology-specific prechecks.
 */
export async function deletePinnedOwner(
  client: AdtClient,
  context: PinnedMutationContext,
  input: { type: string; name: string; group?: string; transport?: string },
): Promise<PinnedDeleteResult> {
  const outcome: { state: PinnedDeleteResult['state']; message?: string } = { state: 'unchanged' };
  let phase = 'validation';
  let statusCode: number | undefined;
  let failed = false;
  let includeUsage: PinnedProgramOwnerEvidence['includeUsage'];
  try {
    assertMutationContext(client.safety, context);
    if (context.mode !== 'pinned-pp') throw new AdtSafetyError('A pinned mutation context is required.');
    checkOperation(client.safety, OperationType.Delete, 'PinnedDelete');
    const functionOwner =
      input.type === 'FUGR' || input.type === 'FUNC' || (input.type === 'INCL' && input.group !== undefined)
        ? pinnedFunctionSelection(input.type, input.name, input.group)
        : undefined;
    if (!functionOwner) assertPinnedSourceOwner(input.type, input.name);
    const collection = {
      CLAS: 'oo/classes',
      INTF: 'oo/interfaces',
      PROG: 'programs/programs',
      INCL: 'programs/includes',
    }[input.type as 'CLAS' | 'INTF' | 'PROG' | 'INCL'];
    const owner =
      functionOwner?.objectUrl ?? `/sap/bc/adt/${collection}/${encodeURIComponent(input.name.toLowerCase())}`;
    if (input.transport !== undefined && !input.transport.trim())
      throw new AdtSafetyError('An explicitly provided CTS request must not be empty.');
    const requested = input.transport?.trim().toUpperCase();
    const scoped = mutationClient(client, context);
    const options = context.requestPolicy;
    const packageFor = async (activeClient: AdtClient) => {
      throwIfRequestCancelled(options);
      const evidence = await readPinnedProgramOwner(activeClient, owner);
      const nativePackage = (await readPinnedFunctionOwner(activeClient, owner))?.packageName ?? evidence?.packageName;
      includeUsage = evidence?.includeUsage;
      const pkg = nativePackage ?? (await activeClient.resolveObjectPackage(owner, undefined, options));
      if (!pkg) throw new AdtSafetyError('Deletion requires the actual native owner package.');
      if (nativePackage === undefined)
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
        confirmedResourceDeletion: () => outcome.state === 'deleted',
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
        const performDelete = async () => {
          throwIfRequestCancelled(options);
          phase = 'delete';
          outcome.state = 'delete-unconfirmed';
          // Reuse the same native wire adapter as ordinary SAPWrite deletion.
          await deleteObject(session, client.safety, owner, lock.lockHandle, recording.request);
          phase = 'absence-readback';
          try {
            await session.get(owner, { 'Cache-Control': 'no-cache' }, options);
          } catch (error) {
            if (
              error instanceof AdtApiError &&
              error.isNotFound &&
              extractExceptionType(error.responseBody ?? '') === 'ExceptionResourceNotFound' &&
              !classifySapDomainError(error.statusCode, error.responseBody, error.path)
            ) {
              outcome.state = 'deleted';
              return;
            }
            throw error;
          }
          throw new AdtSafetyError('DELETE returned but the native owner still exists. Inspect before continuing.');
        };
        if (input.type !== 'PROG' && input.type !== 'FUGR') return performDelete();
        phase = 'text-pool-preflight';
        return withPinnedActiveTextPoolForDelete(
          session,
          client.safety,
          input.name,
          {
            confirmedResourceDeletion: () => outcome.state === 'deleted',
            beforeLock: () => {
              phase = 'text-pool-lock';
              throwIfRequestCancelled(options);
            },
            validateLock: async (poolSession, poolLock) => {
              phase = 'text-pool-policy';
              const current = mutationClient(client, context, poolSession);
              if ((await packageFor(current)) !== pkg)
                throw new AdtSafetyError('The owner package changed before its text-pool check.');
              const fresh = await pinnedRecording(
                poolSession,
                client.safety,
                owner,
                pkg,
                '',
                recording.request,
                options,
              );
              if (fresh.local !== recording.local || fresh.request !== recording.request)
                throw new AdtSafetyError('Recording changed before the text-pool check.');
              await validatePinnedLock(poolSession, client.safety, poolLock, fresh, options);
              phase = 'text-pool-read';
            },
          },
          performDelete,
          pkg,
          input.type,
        );
      },
    );
  } catch (error) {
    failed = true;
    if (outcome.state === 'deleted') phase = 'cleanup';
    if (error instanceof AdtSafetyError) outcome.message = error.message;
    if (error instanceof AdtApiError) {
      statusCode = error.statusCode;
      if (phase === 'delete' && [400, 401, 403, 404, 409, 412, 415, 422, 423].includes(error.statusCode))
        outcome.state = 'delete-rejected';
    }
    outcome.message ??=
      outcome.state === 'unchanged'
        ? 'No DELETE request was sent. Review the reported phase and native policy evidence before continuing.'
        : outcome.state === 'delete-rejected'
          ? 'SAP rejected the deletion. Inspect the current owner and native status before continuing.'
          : 'SAP did not confirm the complete deletion operation. Inspect the owner and reported phase before deciding the next action; do not automatically retry.';
  }
  const cleanupPhase =
    context?.mode !== 'pinned-pp'
      ? undefined
      : context.cleanup?.unlockFailed
        ? ('unlock' as const)
        : context.cleanup?.sessionClosed === false
          ? ('session-close' as const)
          : undefined;
  const cleanupFailed = cleanupPhase !== undefined;
  if (cleanupFailed && !failed)
    outcome.message =
      'The owner is confirmed absent, but session/lock cleanup failed. Verify SAP cleanup before continuing.';
  return {
    ok: outcome.state === 'deleted' && !cleanupFailed && !failed,
    ...outcome,
    phase: cleanupFailed && !failed ? cleanupPhase : phase,
    retryable: false,
    ...(context?.mode === 'pinned-pp' && context.cleanup.unknownLocks?.length
      ? {
          lockOutcome: 'unknown',
          cleanupUnconfirmed: true,
          unknownLocks: context.cleanup.unknownLocks,
          sessionClosed: context.cleanup.sessionClosed,
          lockRecovery:
            'SAP may hold a lock whose response was lost. Inspect the selected resource in ADT or SM12 before continuing.',
        }
      : {}),
    ...(context?.mode === 'pinned-pp' && context.cleanup?.removedLocksAfterDelete
      ? { removedLocksAfterDelete: context.cleanup.removedLocksAfterDelete }
      : {}),
    ...(includeUsage
      ? {
          includeUsage,
          warnings:
            'Deleting an include may break its consumers. Returned native contexts are not a complete where-used inventory.',
        }
      : {}),
    ...(statusCode === undefined ? {} : { statusCode }),
    ...(cleanupFailed
      ? {
          cleanupFailed: true,
          cleanupPhase,
          sessionClosed: context.cleanup.sessionClosed,
          unlockFailures: context.cleanup.unlockFailures,
          cleanup:
            cleanupPhase === 'session-close'
              ? 'Session closure failed. Verify the SAP session and any remaining locks before continuing.'
              : context.cleanup.sessionClosed === true
                ? 'Unlock failed; the owning session was closed. Verify the SAP lock before continuing.'
                : 'Unlock failed; session closure was not confirmed. Verify the SAP lock before continuing.',
        }
      : {}),
  };
}
