/** Admission and result boundary for shared source actions with pinned native policy. */
import type { AdtClient } from '../../adt/client.js';
import { AdtRequestNotSentError, AdtSafetyError } from '../../adt/errors.js';
import type { MutationCleanupState } from '../../adt/mutation-context.js';
import { isPinnedDdicType, pinnedDdicSelection } from '../../adt/pinned-ddic-owner.js';
import { isPinnedDeclarativeType } from '../../adt/pinned-repository-owner.js';
import { checkOperation, OperationType } from '../../adt/safety.js';
import type { ServerConfig } from '../../server/types.js';
import { pinnedOperationContext } from '../pinned-operation.js';
import { type ToolResult, textResult, toolJson } from '../shared.js';
import { dispatchClassSurgery } from './class-surgery-dispatch.js';
import type { SapWriteContext } from './context.js';
import { writeActionCreate } from './create.js';
import { createPinnedClassContext } from './pinned-class-context.js';
import { createPinnedDdicContext } from './pinned-ddic-context.js';
import { createPinnedDeclarativeContext } from './pinned-declarative-context.js';
import { createPinnedFunctionContext } from './pinned-function-context.js';
import { pinnedMetadataResult } from './pinned-metadata-write.js';
import { isPinnedWriteRejection, pinnedFailure, rejectedPinnedSourceState } from './pinned-result.js';
import { writePinnedServerDriven } from './pinned-server-driven.js';
import { forgetPinnedSourceContext, pinnedSourceState } from './pinned-source-context.js';
import { createPinnedTextSourceContext } from './pinned-source-input.js';
import { writePinnedTableSettings } from './pinned-table-settings.js';
import { createPinnedTextPoolContext, pinnedTextPoolResult } from './pinned-text-pool.js';
import { writeActionUnit } from './unit-surgery.js';
import { writeActionDelete, writeActionEditTextSymbols, writeActionUpdate } from './update-delete.js';

export async function handlePinnedSourceWrite(
  client: AdtClient,
  args: Record<string, unknown>,
  config: ServerConfig,
): Promise<ToolResult> {
  const cleanup: MutationCleanupState = { unlockFailed: false };
  let ctx: SapWriteContext | undefined;
  try {
    checkOperation(
      client.safety,
      args.action === 'delete' ? OperationType.Delete : OperationType.Update,
      'PinnedWrite',
    );
    const context = pinnedOperationContext(client, config, { tool: 'SAPWrite', args, timeoutMs: 300_000, cleanup });
    ctx =
      args.action === 'edit_text_symbols'
        ? createPinnedTextPoolContext(client, args, config, context)
        : args.type === 'FUNC' || args.type === 'FUGR' || (args.type === 'INCL' && args.group !== undefined)
          ? await createPinnedFunctionContext(client, args, config, context)
          : isPinnedDeclarativeType(args.type)
            ? createPinnedDeclarativeContext(client, args, config, context)
            : isPinnedDdicType(args.type) || args.type === 'TABL'
              ? await createPinnedDdicContext(client, args, config, context)
              : args.action === 'delete' ||
                  args.action === 'create' ||
                  (args.action === 'update' && args.include === undefined) ||
                  args.action === 'edit_unit' ||
                  args.action === 'add_unit'
                ? createPinnedTextSourceContext(client, args, config, context)
                : createPinnedClassContext(client, args, config, context);
    return await executePinnedSourceWrite(ctx);
  } catch (error) {
    return pinnedFailure(error, 'unchanged', 'validation', cleanup.unlockFailed, {
      minimalErrors: config.minimalErrors,
    });
  }
}

/** Internal completion boundary shared by admitted routes and private native-adapter qualification. */
export async function executePinnedSourceWrite(ctx: SapWriteContext): Promise<ToolResult> {
  const state = pinnedSourceState(ctx);
  const { args, config } = ctx;
  const { cleanup } = state.context;
  try {
    if (args.action === 'delete') return await writeActionDelete(ctx);
    const ddicKind = isPinnedDdicType(ctx.type) ? pinnedDdicSelection(ctx.type, ctx.name).kind : undefined;
    const result = await (args.action === 'edit_text_symbols'
      ? writeActionEditTextSymbols(ctx)
      : ddicKind === 'server-driven'
        ? writePinnedServerDriven(ctx)
        : ddicKind === 'table-settings'
          ? writePinnedTableSettings(ctx)
          : args.action === 'create'
            ? writeActionCreate(ctx)
            : args.action === 'update'
              ? writeActionUpdate(ctx)
              : args.action === 'edit_unit' || args.action === 'add_unit'
                ? writeActionUnit(ctx)
                : dispatchClassSurgery(ctx));
    if (result.isError) throw new AdtSafetyError(result.content.map((part) => part.text).join('\n'));
    if (cleanup.unlockFailed || cleanup.sessionClosed === false) {
      state.phase = cleanup.unlockFailed ? 'unlock' : 'session-close';
      throw new Error('Owning-session cleanup was not confirmed.');
    }
    if (state.textPool) return pinnedTextPoolResult(ctx);
    if (state.metadata) return pinnedMetadataResult(ctx);
    if (state.state === 'created' && (!state.createdOwner || !state.readVerified || state.writeAttempted))
      throw new AdtSafetyError('Metadata-only creation requires verified native source without a source save.');
    if (
      (!['saved-inactive', 'saved-active', 'created'].includes(state.state) && !state.unchangedConfirmed) ||
      !state.sourceHash
    )
      throw new AdtSafetyError('The source edit did not confirm a source save.');
    return textResult(
      toolJson({
        target: config.targetId,
        type: args.type,
        name: args.name,
        action: args.action,
        state: state.state,
        sourceHash: state.sourceHash,
        ...(state.functionGroup ? { functionGroup: state.functionGroup } : {}),
        ...(state.include ? { include: state.include } : {}),
        ...(state.includeInitialized !== undefined ? { initialized: state.includeInitialized } : {}),
        ...(state.state !== 'unchanged' && state.recording?.request ? { transport: state.recording.request } : {}),
        ...(state.warnings ? { warnings: state.warnings } : {}),
        ...(state.serverDriven?.validation ? { validation: state.serverDriven.validation } : {}),
        ...(state.serverDriven?.immediateActive ? { immediateActivation: true } : {}),
        next:
          state.state === 'created'
            ? 'The native resource exists and its generated source was read back without a source PUT. Review its source and inactive state in ADT.'
            : state.state === 'saved-active'
              ? 'SAP saves this type active immediately; there is no separate review-before-activation step. Inspect the result in ADT.'
              : ctx.type === 'FUNC' || ctx.type === 'FUGR' || (ctx.type === 'INCL' && args.group !== undefined)
                ? 'Review this function resource and its group’s inactive members in ADT before activation.'
                : isPinnedDeclarativeType(ctx.type) || isPinnedDdicType(ctx.type)
                  ? 'The native source was saved. Inspect its inactive state and dependencies before invoking supported whole-owner SAPActivate; unqualified native variants remain refused.'
                  : state.unchangedConfirmed
                    ? 'The method already has the requested visibility; no source was saved.'
                    : ctx.type === 'PROG'
                      ? 'Review the inactive program source. SAPActivate selects this program and may include its own text pool when SAP preaudit requires it. Other programs and standalone includes require separate selection; inspect the returned pool state.'
                      : ctx.type === 'INCL'
                        ? 'Review the inactive include source and its consumers. SAPActivate selects this standalone include only.'
                        : 'Review the inactive source. SAPActivate activates this complete owner, including existing inactive class includes. Other owners require separate selection.',
      }),
    );
  } catch (error) {
    if (error instanceof AdtRequestNotSentError) {
      if (state.phase === 'create' && error.method === 'POST') state.state = 'unchanged';
      if (
        (state.phase === 'source-save' && error.method === 'PUT') ||
        (state.phase === 'metadata-save' && error.method === 'PUT') ||
        (state.phase === 'include-initialization' && error.method === 'POST')
      ) {
        state.writeAttempted = false;
        state.state = state.createdOwner
          ? state.phase === 'metadata-save'
            ? 'created-metadata-not-confirmed'
            : 'created-source-not-confirmed'
          : state.includeInitialized
            ? 'created-include-source-not-saved'
            : 'unchanged';
      }
    }
    if (state && isPinnedWriteRejection(error))
      state.state = rejectedPinnedSourceState(state.state, state.phase, state.includeInitialized);
    return pinnedFailure(error, state?.state ?? 'unchanged', state?.phase ?? 'validation', cleanup.unlockFailed, {
      sourceHash: state?.sourceHash,
      functionGroup: state?.functionGroup,
      sessionClosed: cleanup.sessionClosed,
      unlockFailures: cleanup.unlockFailures,
      unknownLocks: cleanup.unknownLocks,
      warnings: state?.warnings,
      transport: state?.recording?.request,
      include: state?.include,
      initialized: state?.includeInitialized,
      textPart: state?.textPool?.part,
      activePartVerified: state?.textPool?.result?.activePartVerified,
      nativeActivation: state?.textPool?.result?.nativeActivation,
      minimalErrors: config.minimalErrors,
      verificationFailures: state?.textPool?.result?.verificationFailures,
      textPoolState: state?.textPool?.result?.state,
      next: state?.textPool
        ? 'Read the selected text part with SAPRead and inspect the pool state in ADT before another write or activation.'
        : undefined,
    });
  } finally {
    if (ctx) forgetPinnedSourceContext(ctx);
  }
}
