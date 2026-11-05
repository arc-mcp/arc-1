/** Whole-source update profiles beneath the shared action's preparation and quality checks. */
import type { AdtHttpClient } from '../../adt/http.js';
import { textResult } from '../shared.js';
import type { SapWriteContext } from './context.js';
import { withSourceEdit } from './source-edit.js';

export async function replaceOwnerSource(
  ctx: SapWriteContext,
  source: string | ((current: string, session: AdtHttpClient) => Promise<string>),
  warnings: () => string | undefined,
): Promise<void> {
  await withSourceEdit(
    ctx,
    async (edit) => {
      let replacement: string;
      if (
        ctx.mutationContext.mode === 'pinned-pp' ||
        ctx.args.expectedSourceHash !== undefined ||
        typeof source === 'function'
      ) {
        const current = await edit.read(ctx.srcUrl);
        replacement = typeof source === 'function' ? await source(current, edit.http) : source;
      } else replacement = source;
      await edit.save(ctx.srcUrl, replacement, ctx.mutationContext.mode === 'pinned-pp' ? warnings() : undefined);
      return textResult('');
    },
    'none',
  );
}
