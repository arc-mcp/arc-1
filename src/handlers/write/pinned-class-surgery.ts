/** Admission and result boundary for shared class actions with pinned native policy. */
import type { AdtClient } from '../../adt/client.js';
import { AdtSafetyError } from '../../adt/errors.js';
import type { MutationCleanupState } from '../../adt/mutation-context.js';
import { checkOperation, OperationType } from '../../adt/safety.js';
import type { ServerConfig } from '../../server/types.js';
import { pinnedOperationContext } from '../pinned-operation.js';
import { type ToolResult, textResult, toolJson } from '../shared.js';
import { dispatchClassSurgery } from './class-surgery-dispatch.js';
import type { SapWriteContext } from './context.js';
import {
  createPinnedClassContext,
  forgetPinnedClassContext,
  type PinnedClassState,
  pinnedClassState,
} from './pinned-class-context.js';
import { isPinnedWriteRejection, pinnedFailure, rejectedPinnedSourceState } from './pinned-result.js';
import { writeActionUpdate } from './update-delete.js';

export async function handlePinnedClassSurgery(
  client: AdtClient,
  args: Record<string, unknown>,
  config: ServerConfig,
): Promise<ToolResult> {
  const cleanup: MutationCleanupState = { unlockFailed: false };
  let ctx: SapWriteContext | undefined;
  let state: PinnedClassState | undefined;
  try {
    checkOperation(client.safety, OperationType.Update, 'PinnedWrite');
    const context = pinnedOperationContext(client, config, { tool: 'SAPWrite', args, timeoutMs: 300_000, cleanup });
    ctx = createPinnedClassContext(client, args, config, context);
    state = pinnedClassState(ctx);
    const result = await (args.action === 'update' ? writeActionUpdate(ctx) : dispatchClassSurgery(ctx));
    if (result.isError) throw new AdtSafetyError(result.content.map((part) => part.text).join('\n'));
    if (cleanup.unlockFailed || cleanup.sessionClosed === false) {
      state.phase = cleanup.unlockFailed ? 'unlock' : 'session-close';
      throw new Error('Owning-session cleanup was not confirmed.');
    }
    if ((state.state !== 'saved-inactive' && !state.unchangedConfirmed) || !state.sourceHash)
      throw new AdtSafetyError('The class edit did not confirm a source save.');
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
          : 'Review the inactive source. SAPActivate activates this complete owner, including all existing inactive drafts/includes.',
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
    if (ctx) forgetPinnedClassContext(ctx);
  }
}
