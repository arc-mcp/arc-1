/** Native creation phases beneath the shared create handler, with explicit mutation profiles. */

import { createObject, safeUpdateSource } from '../../adt/crud.js';
import { AdtSafetyError } from '../../adt/errors.js';
import { throwIfRequestCancelled } from '../../adt/http-deadline.js';
import { assertMutationContext } from '../../adt/mutation-context.js';
import { pinnedFunctionSelection, readPinnedFunctionOwner } from '../../adt/pinned-function-owner.js';
import { pinnedRecording } from '../../adt/pinned-write-policy.js';
import { getCachedFeatures } from '../feature-cache.js';
import { textResult } from '../shared.js';
import { runPreWriteSyntaxCheck } from '../write-helpers.js';
import type { SapWriteContext } from './context.js';
import { resolveCreateTransport } from './create-transport.js';
import { verifyCreatedFunctionIncludeMembership } from './function-create-membership.js';
import { pinnedSourceState } from './pinned-source-context.js';
import { withSourceEdit } from './source-edit.js';

/** Do not let a later creation phase overwrite an earlier failed session's cleanup evidence. */
export function assertCreationStepCleanup(ctx: SapWriteContext): void {
  if (ctx.mutationContext.mode === 'single-target') return;
  const state = pinnedSourceState(ctx),
    cleanup = state.context.cleanup;
  if (cleanup.unlockFailed || cleanup.sessionClosed === false) {
    state.phase = cleanup.unlockFailed ? 'unlock' : 'session-close';
    throw new AdtSafetyError(
      'A native creation step completed, but its owning-session cleanup was not confirmed. Subsequent creation steps were not sent; inspect before continuing.',
    );
  }
}

/** A metadata-only create verifies the generated editable source without claiming an inactive save. */
export async function verifyCreatedSource(ctx: SapWriteContext): Promise<void> {
  if (ctx.mutationContext.mode === 'single-target') return;
  const state = pinnedSourceState(ctx);
  if (ctx.args.action !== 'create' || !state.createdOwner || state.writeAttempted)
    throw new AdtSafetyError('Generated-source verification requires its confirmed metadata-only creation.');
  assertCreationStepCleanup(ctx);
  await withSourceEdit(
    ctx,
    async (edit) => {
      await edit.read(ctx.srcUrl);
      await verifyCreatedFunctionIncludeMembership(ctx, edit.http);
      state.sourceHash = state.readHash;
      state.state = 'created';
      state.phase = 'source-verification';
      return textResult('');
    },
    'warn',
  );
  assertCreationStepCleanup(ctx);
}

export async function prepareCreationRecording(ctx: SapWriteContext, pkg: string) {
  assertMutationContext(ctx.client.safety, ctx.mutationContext);
  if (ctx.mutationContext.mode === 'single-target')
    return ctx.transport
      ? { transport: ctx.transport }
      : resolveCreateTransport(ctx.client, ctx.objectUrl, pkg, ctx.config.minimalErrors);
  const state = pinnedSourceState(ctx);
  if (ctx.args.action !== 'create' || state.state !== 'unchanged' || state.createdOwner)
    throw new AdtSafetyError('Creation recording requires a fresh creation context.');
  state.pkg = pkg;
  state.phase = 'recording-preflight';
  state.recording = await pinnedRecording(
    ctx.client.http,
    ctx.client.safety,
    ctx.objectUrl,
    pkg,
    'I',
    ctx.transport,
    state.context.requestPolicy,
  );
  return { transport: state.recording.request };
}

export async function createRepositoryObject(
  ctx: SapWriteContext,
  input: {
    url: string;
    body: string;
    contentType: string;
    transport?: string;
    packageName?: string;
    systemType?: string;
  },
): Promise<string> {
  assertMutationContext(ctx.client.safety, ctx.mutationContext);
  const state = ctx.mutationContext.mode === 'pinned-pp' ? pinnedSourceState(ctx) : undefined;
  if (state) {
    if (
      ctx.args.action !== 'create' ||
      !state.pkg ||
      !state.recording ||
      state.createdOwner ||
      state.state !== 'unchanged' ||
      input.url !== ctx.objectUrl.replace(/\/[^/]+$/, '') ||
      input.transport !== state.recording.request
    )
      throw new AdtSafetyError('Creation requires the verified package, recording and selected owner collection.');
    if (ctx.type === 'FUNC' || (ctx.type === 'INCL' && ctx.args.group !== undefined)) {
      state.phase = 'parent-revalidation';
      const selected = pinnedFunctionSelection(ctx.type, ctx.name, ctx.args.group);
      const parent = await readPinnedFunctionOwner(ctx.client, selected.groupUrl);
      if (parent?.packageName !== state.pkg)
        throw new AdtSafetyError('The native group package changed before child creation. No create request was sent.');
      const fresh = await pinnedRecording(
        ctx.client.http,
        ctx.client.safety,
        ctx.objectUrl,
        state.pkg,
        'I',
        state.recording.request,
        state.context.requestPolicy,
      );
      if (fresh.local !== state.recording.local || fresh.request !== state.recording.request)
        throw new AdtSafetyError('Recording context changed before function-child creation.');
    }
    throwIfRequestCancelled(state.context.requestPolicy);
    state.phase = 'create';
    state.state = 'creation-unknown';
  }
  const result = await createObject(
    ctx.client.http,
    ctx.client.safety,
    input.url,
    input.body,
    input.contentType,
    input.transport,
    input.packageName,
    getCachedFeatures()?.abapRelease,
    input.systemType,
    ctx.name,
  );
  if (state) {
    state.createdOwner = true;
    state.state = 'created-source-not-confirmed';
  }
  return result;
}

export async function saveCreatedSource(
  ctx: SapWriteContext,
  source: string,
  transport: string | undefined,
  warnings: string | undefined,
): Promise<void> {
  assertMutationContext(ctx.client.safety, ctx.mutationContext);
  assertCreationStepCleanup(ctx);
  if (ctx.mutationContext.mode === 'single-target') {
    await safeUpdateSource(
      ctx.client.http,
      ctx.client.safety,
      ctx.objectUrl,
      ctx.srcUrl,
      source,
      transport,
      getCachedFeatures()?.abapRelease,
    );
    return;
  }
  await withSourceEdit(
    ctx,
    async (edit) => {
      await edit.read(ctx.srcUrl);
      await verifyCreatedFunctionIncludeMembership(ctx, edit.http);
      const notes = await runPreWriteSyntaxCheck(
        { http: edit.http, safety: ctx.client.safety },
        ctx.type,
        source,
        ctx.objectUrl,
        ctx.config,
      );
      await edit.save(ctx.srcUrl, source, [warnings, notes].filter(Boolean).join('\n\n'));
      return textResult('');
    },
    'warn',
  );
}
