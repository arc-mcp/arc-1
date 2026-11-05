/** Whole-source update profiles beneath the shared action's preparation and quality checks. */
import { safeUpdateSource } from '../../adt/crud.js';
import type { AdtHttpClient } from '../../adt/http.js';
import { getCachedFeatures } from '../feature-cache.js';
import { textResult } from '../shared.js';
import type { SapWriteContext } from './context.js';
import { withSourceEdit } from './source-edit.js';

export async function replaceOwnerSource(
  ctx: SapWriteContext,
  source: string | ((current: string, session: AdtHttpClient) => Promise<string>),
  warnings: () => string | undefined,
): Promise<void> {
  if (ctx.mutationContext.mode === 'single-target') {
    await safeUpdateSource(
      ctx.client.http,
      ctx.client.safety,
      ctx.objectUrl,
      ctx.srcUrl,
      source,
      ctx.transport,
      getCachedFeatures()?.abapRelease,
      ctx.args.expectedSourceHash as string | undefined,
    );
    return;
  }
  await withSourceEdit(
    ctx,
    async (edit) => {
      const current = await edit.read(ctx.srcUrl);
      const replacement = typeof source === 'function' ? await source(current, edit.http) : source;
      await edit.save(ctx.srcUrl, replacement, warnings());
      return textResult('');
    },
    'warn',
  );
}
