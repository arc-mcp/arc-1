/** Native ownership policy around the shared text-part replacement and activation protocol. */
import type { AdtClient } from '../../adt/client.js';
import { AdtSafetyError } from '../../adt/errors.js';
import type { PinnedMutationContext } from '../../adt/mutation-context.js';
import { TEXT_ELEMENT_PARTS, type TextElementPart, writeTextElementPartWithPolicy } from '../../adt/text-elements.js';
import type { ServerConfig } from '../../server/types.js';
import { textResult, toolJson } from '../shared.js';
import type { SapWriteContext } from './context.js';
import { pinnedSourceLockPolicy, revalidatePinnedOwnerRecording } from './pinned-lock.js';
import { createPinnedSourceContext, pinnedSourceState } from './pinned-source-context.js';

export function createPinnedTextPoolContext(
  client: AdtClient,
  args: Record<string, unknown>,
  config: ServerConfig,
  context: PinnedMutationContext,
) {
  const part = args.textPart ?? 'symbols';
  if (
    args.action !== 'edit_text_symbols' ||
    (args.type !== 'CLAS' && args.type !== 'PROG') ||
    typeof args.source !== 'string' ||
    !TEXT_ELEMENT_PARTS.includes(part as TextElementPart) ||
    (args.type === 'CLAS' && part !== 'symbols') ||
    args.include !== undefined ||
    args.expectedSourceHash !== undefined
  )
    throw new AdtSafetyError('Select one admitted CLAS symbols or PROG text-part replacement with explicit source.');
  if (Buffer.byteLength(args.source, 'utf8') > 1024 * 1024)
    throw new AdtSafetyError('Text-element source exceeds the 1 MiB verification bound.');
  const ctx = createPinnedSourceContext(client, args, config, context, { wholeIncludeReplacement: false });
  pinnedSourceState(ctx).textPool = { part: part as TextElementPart };
  return ctx;
}

export async function writePinnedTextPool(ctx: SapWriteContext, part: TextElementPart) {
  const state = pinnedSourceState(ctx);
  if (
    !state.pkg ||
    !state.recording ||
    !state.textPool ||
    state.textPool.part !== part ||
    state.writeAttempted ||
    (ctx.type !== 'CLAS' && ctx.type !== 'PROG')
  )
    throw new AdtSafetyError('Text-pool editing requires its registered owner, package and recording context.');
  const { context, pkg, recording } = state;
  const result = await writeTextElementPartWithPolicy(
    ctx.client.http,
    ctx.client.safety,
    ctx.type,
    ctx.name,
    part,
    ctx.source,
    recording.request,
    {
      mode: 'pinned-pp',
      ownerType: ctx.type,
      ownerName: ctx.name,
      ownerPackage: pkg,
      context,
      lockPolicy: pinnedSourceLockPolicy(ctx.client, context, ctx.objectUrl, pkg, recording, (phase) => {
        state.phase = phase;
      }),
      validateActivationOwner: async (http) => {
        await revalidatePinnedOwnerRecording(ctx.client, http, context, ctx.objectUrl, pkg, recording);
      },
      onPhase: (phase, next) => {
        state.phase = phase;
        if (next !== undefined) state.state = next;
        if (phase === 'text-save') state.writeAttempted = true;
      },
    },
  );
  state.textPool.result = result;
  state.unchangedConfirmed = result.unchanged;
  return result;
}

export function pinnedTextPoolResult(ctx: SapWriteContext) {
  const state = pinnedSourceState(ctx),
    pool = state.textPool;
  if (pool?.result?.state !== 'active' || (state.state !== 'text-saved-active' && !state.unchangedConfirmed))
    throw new AdtSafetyError('The active text-pool replacement was not verified.');
  return textResult(
    toolJson({
      target: ctx.config.targetId,
      type: ctx.type,
      name: ctx.name,
      action: ctx.args.action,
      textPart: pool.part,
      state: state.state,
      activePartVerified: true,
      ...(state.recording?.request && !pool.result.unchanged ? { transport: state.recording.request } : {}),
      ...(pool.result.changes ? { changes: pool.result.changes } : {}),
      next: pool.result.unchanged
        ? 'The selected symbols were already empty and active; no text was saved.'
        : 'The saved part matches its active version. Text-pool activation also activates pending changes to its other text parts; the repository owner source was not activated.',
    }),
  );
}
