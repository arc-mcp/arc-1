/** Keep a class surgery's source, structure and write within one SAP lock. */
import { lockObject, unlockObject, updateSource } from '../../adt/crud.js';
import type { AdtHttpClient } from '../../adt/http.js';
import { checkOperation, OperationType } from '../../adt/safety.js';
import type { ClassStructure } from '../../adt/types.js';
import { parseClassStructure } from '../../adt/xml-parser.js';
import { logger } from '../../server/logger.js';
import { getCachedFeatures } from '../feature-cache.js';
import type { ToolResult } from '../shared.js';
import type { SapWriteContext } from './context.js';

interface ClassEdit {
  http: AdtHttpClient;
  read(url: string): Promise<string>;
  readMainAndStructure(): Promise<{ main: string; structure: ClassStructure }>;
  save(url: string, source: string): Promise<void>;
}

export async function withClassEdit(
  ctx: SapWriteContext,
  edit: (locked: ClassEdit) => Promise<ToolResult>,
): Promise<ToolResult> {
  const { client, objectUrl, srcUrl, name, transport, invalidateWrittenObject } = ctx;
  checkOperation(client.safety, OperationType.Update, 'EditClass');
  return client.http.withStatefulSession(async (session) => {
    const lock = await lockObject(session, client.safety, objectUrl, 'MODIFY', getCachedFeatures()?.abapRelease);
    let writeAttempted = false;
    const read = async (url: string) => {
      checkOperation(client.safety, OperationType.Read, 'GetSource');
      // SAP returns the editable draft (active when none exists). Both endpoints must use
      // this same selection under the lock; caches and inactive worklists can be stale.
      return (await session.get(url, { 'Cache-Control': 'no-cache' })).body;
    };
    try {
      return await edit({
        http: session,
        read,
        async readMainAndStructure() {
          const main = await read(srcUrl);
          const structure = parseClassStructure(await read(`${objectUrl}/objectstructure`), name);
          return { main, structure };
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
          try {
            invalidateWrittenObject('CLAS', name);
          } catch {
            logger.warn('Class surgery cache invalidation failed after a write attempt.');
          }
        }
      }
    }
  });
}
