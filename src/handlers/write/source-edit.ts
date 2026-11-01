/** Shared source-edit lifecycle; action callbacks own their transformations. */
import { lockObject, unlockObject, updateSource } from '../../adt/crud.js';
import type { AdtHttpClient } from '../../adt/http.js';
import { assertMutationContext } from '../../adt/mutation-context.js';
import { checkOperation, OperationType } from '../../adt/safety.js';
import { assertSourceHash } from '../../adt/source-precondition.js';
import { logger } from '../../server/logger.js';
import { getCachedFeatures } from '../feature-cache.js';
import type { ToolResult } from '../shared.js';
import type { SapWriteContext } from './context.js';
import { withPinnedClassEdit } from './pinned-class-lifecycle.js';

export interface SourceEdit {
  http: AdtHttpClient;
  read(url: string): Promise<string>;
  save(url: string, source: string, warnings?: string): Promise<void>;
  unchanged(): void;
}

export async function withSourceEdit(
  ctx: SapWriteContext,
  edit: (locked: SourceEdit) => Promise<ToolResult>,
  legacyCacheFailure: 'warn' | 'throw',
): Promise<ToolResult> {
  const { client, objectUrl, transport, invalidateWrittenObject } = ctx;
  checkOperation(client.safety, OperationType.Update, 'EditSource');
  assertMutationContext(client.safety, ctx.mutationContext);
  if (ctx.mutationContext.mode === 'pinned-pp') return withPinnedClassEdit(ctx, edit);
  return client.http.withStatefulSession(async (session) => {
    const lock = await lockObject(session, client.safety, objectUrl, 'MODIFY', getCachedFeatures()?.abapRelease);
    let writeAttempted = false;
    try {
      return await edit({
        http: session,
        unchanged() {},
        async read(url) {
          checkOperation(client.safety, OperationType.Read, 'GetSource');
          const source = (await session.get(url, { 'Cache-Control': 'no-cache' })).body;
          assertSourceHash(source, ctx.args.expectedSourceHash as string | undefined, url);
          return source;
        },
        async save(url, source) {
          writeAttempted = true;
          await updateSource(
            session,
            client.safety,
            url,
            source,
            lock.lockHandle,
            transport ?? (lock.corrNr || undefined),
          );
        },
      });
    } finally {
      try {
        await unlockObject(session, objectUrl, lock.lockHandle);
      } finally {
        if (writeAttempted) {
          if (legacyCacheFailure === 'throw') invalidateWrittenObject(ctx.type, ctx.name);
          else
            try {
              invalidateWrittenObject(ctx.type, ctx.name);
            } catch {
              logger.warn('Source edit cache invalidation failed after a write attempt.');
            }
        }
      }
    }
  });
}
