/** Shared owning source-edit execution; resource policies retain their native proofs. */
import { type SourceEdit, withSourceMutation } from '../../adt/crud.js';
import { assertMutationContext } from '../../adt/mutation-context.js';
import { checkOperation, OperationType } from '../../adt/safety.js';
import { logger } from '../../server/logger.js';
import { getCachedFeatures } from '../feature-cache.js';
import type { ToolResult } from '../shared.js';
import type { SapWriteContext } from './context.js';
import { pinnedSourceEditProfile } from './pinned-source-lifecycle.js';

export type { SourceEdit } from '../../adt/crud.js';

export async function withSourceEdit(
  ctx: SapWriteContext,
  edit: (locked: SourceEdit) => Promise<ToolResult>,
  legacyCacheFailure: 'warn' | 'throw' | 'none',
): Promise<ToolResult> {
  const { client, objectUrl, transport, invalidateWrittenObject } = ctx;
  checkOperation(client.safety, OperationType.Update, 'EditSource');
  assertMutationContext(client.safety, ctx.mutationContext);
  let writeAttempted = false;
  return withSourceMutation(
    client.http,
    client.safety,
    ctx.mutationContext,
    objectUrl,
    ctx.mutationContext.mode === 'pinned-pp'
      ? pinnedSourceEditProfile(ctx)
      : {
          mode: 'single-target',
          transport,
          expectedSourceHash: ctx.args.expectedSourceHash as string | undefined,
          onWriteAttempt: () => {
            writeAttempted = true;
          },
          afterUnlockAttempt: () => {
            if (!writeAttempted || legacyCacheFailure === 'none') return;
            if (legacyCacheFailure === 'throw') invalidateWrittenObject(ctx.type, ctx.name);
            else
              try {
                invalidateWrittenObject(ctx.type, ctx.name);
              } catch {
                logger.warn('Source edit cache invalidation failed after a write attempt.');
              }
          },
        },
    edit,
    ctx.mutationContext.mode === 'single-target' ? getCachedFeatures()?.abapRelease : undefined,
  );
}
