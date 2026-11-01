/** Native creation phases beneath the shared create handler, with explicit mutation profiles. */

import { createObject, safeUpdateSource } from '../../adt/crud.js';
import { AdtSafetyError } from '../../adt/errors.js';
import { throwIfRequestCancelled } from '../../adt/http-deadline.js';
import { assertMutationContext } from '../../adt/mutation-context.js';
import { pinnedRecording } from '../../adt/pinned-write-policy.js';
import { getCachedFeatures } from '../feature-cache.js';
import { textResult } from '../shared.js';
import { runPreWriteSyntaxCheck } from '../write-helpers.js';
import type { SapWriteContext } from './context.js';
import { resolveCreateTransport } from './create-transport.js';
import { pinnedSourceState } from './pinned-source-context.js';
import { withSourceEdit } from './source-edit.js';

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
