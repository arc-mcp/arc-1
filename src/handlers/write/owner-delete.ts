/** Strict pinned deletion profile selected by the shared delete action. */
import { AdtSafetyError } from '../../adt/errors.js';
import { deletePinnedOwner } from '../../adt/pinned-delete.js';
import { pinnedOperationResult } from '../pinned-operation.js';
import type { SapWriteContext } from './context.js';
import { pinnedSourceState } from './pinned-source-context.js';

export async function deletePinnedRepositoryOwner(ctx: SapWriteContext) {
  if (ctx.mutationContext.mode !== 'pinned-pp') throw new AdtSafetyError('A pinned owner context is required.');
  pinnedSourceState(ctx); // Require the registered owner adapter, not a structural lookalike.
  const result = await deletePinnedOwner(ctx.client, ctx.mutationContext, {
    type: ctx.type,
    name: ctx.name,
    transport: ctx.transport,
  });
  return pinnedOperationResult(result, ctx.config, { action: 'delete', type: ctx.type, name: ctx.name });
}
