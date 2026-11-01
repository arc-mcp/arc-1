/** One include replacement adapter for update and edit_class_definition. */
import { safeUpdateClassInclude } from '../../adt/crud.js';
import { AdtSafetyError } from '../../adt/errors.js';
import { throwIfRequestCancelled } from '../../adt/http-deadline.js';
import { assertMutationContext } from '../../adt/mutation-context.js';
import { getCachedFeatures } from '../feature-cache.js';
import { classIncludeUrl } from '../object-types.js';
import type { SapWriteContext } from './context.js';
import { pinnedSourceLockPolicy } from './pinned-lock.js';
import { pinnedSourceState } from './pinned-source-context.js';

export async function replaceClassInclude(ctx: SapWriteContext, source: string) {
  const { client, objectUrl, include, transport, args } = ctx;
  assertMutationContext(client.safety, ctx.mutationContext);
  if (!include || ctx.type !== 'CLAS') throw new AdtSafetyError('A class include must be selected.');
  if (ctx.mutationContext.mode === 'single-target')
    return safeUpdateClassInclude(
      client.http,
      client.safety,
      objectUrl,
      classIncludeUrl(ctx.name, include),
      source,
      transport,
      getCachedFeatures()?.abapRelease,
      args.expectedSourceHash as string | undefined,
    );
  const state = pinnedSourceState(ctx);
  if (!state.wholeIncludeReplacement || !state.pkg || !state.recording || state.writeAttempted)
    throw new AdtSafetyError('Include replacement requires its verified class/package/recording context.');
  const lockPolicy = pinnedSourceLockPolicy(client, state.context, objectUrl, state.pkg, state.recording, (phase) => {
    state.phase = phase;
  });
  const result = await safeUpdateClassInclude(
    client.http,
    client.safety,
    objectUrl,
    state.sourceUrl,
    source,
    state.recording.request,
    getCachedFeatures()?.abapRelease,
    args.expectedSourceHash as string | undefined,
    {
      context: state.context,
      lockPolicy,
      onPhase: (phase) => {
        const previousPhase = state.phase;
        state.phase = phase;
        if (phase === 'include-initialization') {
          throwIfRequestCancelled(state.context.requestPolicy);
          state.state = 'include-initialization-unknown';
          state.writeAttempted = true;
        }
        if (phase === 'source-save') {
          state.includeInitialized = previousPhase === 'include-initialization';
          if (state.includeInitialized) state.state = 'created-include-source-not-saved';
          throwIfRequestCancelled(state.context.requestPolicy);
          state.state = state.includeInitialized ? 'created-include-source-unknown' : 'source-save-unknown';
          state.writeAttempted = true;
        }
      },
    },
  );
  if (result.source === undefined || result.sourceHash === undefined)
    throw new AdtSafetyError('Pinned include read-back was not confirmed.');
  state.includeInitialized = result.initialized;
  state.sourceHash = result.sourceHash;
  state.state = 'saved-inactive';
  return result;
}
