/** Pinned policy around the shared source-edit callback. */
import { updateSource, withLockedMutation } from '../../adt/crud.js';
import { AdtSafetyError } from '../../adt/errors.js';
import { throwIfRequestCancelled } from '../../adt/http-deadline.js';
import { checkOperation, OperationType } from '../../adt/safety.js';
import { assertSourceHash, editableSourceEquals, sourceHash } from '../../adt/source-precondition.js';
import type { ToolResult } from '../shared.js';
import type { SapWriteContext } from './context.js';
import { pinnedSourceLockPolicy } from './pinned-lock.js';
import { pinnedSourceState } from './pinned-source-context.js';
import type { SourceEdit } from './source-edit.js';

export async function withPinnedSourceEdit(
  ctx: SapWriteContext,
  edit: (locked: SourceEdit) => Promise<ToolResult>,
): Promise<ToolResult> {
  const state = pinnedSourceState(ctx);
  if (!state.pkg || !state.recording)
    throw new AdtSafetyError('Source editing requires verified package and recording preflight.');
  const { context, recording } = state;
  const policy = pinnedSourceLockPolicy(ctx.client, context, ctx.objectUrl, state.pkg, recording, (phase) => {
    state.phase = phase;
  });
  return withLockedMutation(ctx.client.http, ctx.client.safety, context, ctx.objectUrl, policy, async (http, lock) =>
    edit({
      http,
      async read(url) {
        if (url !== state.sourceUrl || state.writeAttempted || state.unchangedConfirmed)
          throw new AdtSafetyError('The editable read must select the admitted source resource before its save.');
        state.phase = 'source-read';
        checkOperation(ctx.client.safety, OperationType.Read, 'GetSource');
        const current = await http.get(url, { 'Cache-Control': 'no-cache', Accept: 'text/plain' });
        assertSourceHash(current.body, ctx.args.expectedSourceHash as string, url);
        state.readVerified = true;
        state.readHash = sourceHash(current.body);
        state.phase = 'edit-preparation';
        return current.body;
      },
      unchanged() {
        if (
          !state.readVerified ||
          !state.readHash ||
          state.writeAttempted ||
          state.unchangedConfirmed ||
          state.state !== 'unchanged'
        )
          throw new AdtSafetyError('An unchanged result requires a verified editable source without a save.');
        state.unchangedConfirmed = true;
        state.sourceHash = state.readHash;
      },
      async save(url, source, warnings) {
        if (url !== state.sourceUrl || !state.readVerified || state.writeAttempted || state.unchangedConfirmed)
          throw new AdtSafetyError('One save of the freshly verified source resource is required.');
        checkOperation(ctx.client.safety, OperationType.Update, 'PinnedSave');
        throwIfRequestCancelled(context.requestPolicy);
        state.phase = 'source-save';
        state.state = 'source-save-unknown';
        state.writeAttempted = true;
        await updateSource(http, ctx.client.safety, url, source, lock.lockHandle, recording.request);
        state.phase = 'source-readback';
        const saved = await http.get(url, { 'Cache-Control': 'no-cache', Accept: 'text/plain' });
        if (!editableSourceEquals(saved.body, source))
          throw new AdtSafetyError(
            'Save returned but exact editable source read-back did not match. Inspect before continuing.',
          );
        state.sourceHash = sourceHash(saved.body);
        state.warnings = warnings || undefined;
        state.state = 'saved-inactive';
      },
    }),
  );
}
