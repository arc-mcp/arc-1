/** Admission and result boundary for shared source actions with pinned native policy. */
import type { AdtClient } from '../../adt/client.js';
import { AdtSafetyError } from '../../adt/errors.js';
import type { MutationCleanupState } from '../../adt/mutation-context.js';
import { checkOperation, OperationType } from '../../adt/safety.js';
import type { ServerConfig } from '../../server/types.js';
import { pinnedOperationContext } from '../pinned-operation.js';
import { type ToolResult, textResult, toolJson } from '../shared.js';
import { dispatchClassSurgery } from './class-surgery-dispatch.js';
import type { SapWriteContext } from './context.js';
import { writeActionCreate } from './create.js';
import { createPinnedClassContext } from './pinned-class-context.js';
import { isPinnedWriteRejection, pinnedFailure, rejectedPinnedSourceState } from './pinned-result.js';
import { forgetPinnedSourceContext, type PinnedSourceState, pinnedSourceState } from './pinned-source-context.js';
import { createPinnedTextSourceContext } from './pinned-source-input.js';
import { writeActionUnit } from './unit-surgery.js';
import { writeActionDelete, writeActionUpdate } from './update-delete.js';

export async function handlePinnedSourceWrite(
  client: AdtClient,
  args: Record<string, unknown>,
  config: ServerConfig,
): Promise<ToolResult> {
  const cleanup: MutationCleanupState = { unlockFailed: false };
  let ctx: SapWriteContext | undefined;
  let state: PinnedSourceState | undefined;
  try {
    checkOperation(
      client.safety,
      args.action === 'delete' ? OperationType.Delete : OperationType.Update,
      'PinnedWrite',
    );
    const context = pinnedOperationContext(client, config, { tool: 'SAPWrite', args, timeoutMs: 300_000, cleanup });
    ctx =
      args.action === 'delete' ||
      args.action === 'create' ||
      (args.action === 'update' && args.include === undefined) ||
      args.action === 'edit_unit' ||
      args.action === 'add_unit'
        ? createPinnedTextSourceContext(client, args, config, context)
        : createPinnedClassContext(client, args, config, context);
    state = pinnedSourceState(ctx);
    if (args.action === 'delete') return await writeActionDelete(ctx);
    const result = await (args.action === 'create'
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
    if ((state.state !== 'saved-inactive' && !state.unchangedConfirmed) || !state.sourceHash)
      throw new AdtSafetyError('The source edit did not confirm a source save.');
    return textResult(
      toolJson({
        target: config.targetId,
        type: args.type,
        name: args.name,
        action: args.action,
        state: state.state,
        sourceHash: state.sourceHash,
        ...(state.include ? { include: state.include } : {}),
        ...(state.includeInitialized !== undefined ? { initialized: state.includeInitialized } : {}),
        ...(state.state !== 'unchanged' && state.recording?.request ? { transport: state.recording.request } : {}),
        ...(state.warnings ? { warnings: state.warnings } : {}),
        next: state.unchangedConfirmed
          ? 'The method already has the requested visibility; no source was saved.'
          : 'Review the inactive source. SAPActivate activates this complete owner, including its existing inactive drafts and owned includes/texts; other owners require separate selection.',
      }),
    );
  } catch (error) {
    if (state && isPinnedWriteRejection(error))
      state.state = rejectedPinnedSourceState(state.state, state.phase, state.includeInitialized);
    return pinnedFailure(error, state?.state ?? 'unchanged', state?.phase ?? 'validation', cleanup.unlockFailed, {
      sourceHash: state?.sourceHash,
      sessionClosed: cleanup.sessionClosed,
      warnings: state?.warnings,
      transport: state?.recording?.request,
      include: state?.include,
      initialized: state?.includeInitialized,
    });
  } finally {
    if (ctx) forgetPinnedSourceContext(ctx);
  }
}
