/** Keep a class surgery's source, structure and write within one SAP lock. */
import { lockObject, unlockObject, updateSource } from '../../adt/crud.js';
import { AdtSafetyError } from '../../adt/errors.js';
import type { AdtHttpClient } from '../../adt/http.js';
import { checkOperation, OperationType } from '../../adt/safety.js';
import { assertResultHash, assertSourceHash } from '../../adt/source-precondition.js';
import type { ClassStructure } from '../../adt/types.js';
import { parseClassStructure } from '../../adt/xml-parser.js';
import { logger } from '../../server/logger.js';
import { getCachedFeatures } from '../feature-cache.js';
import type { ToolResult } from '../shared.js';
import type { SapWriteContext } from './context.js';
import { isDryRun, readEditableForPreview, sourcePreviewResult } from './dry-run.js';

interface ClassEdit {
  http: AdtHttpClient;
  read(url: string): Promise<string>;
  readMainAndStructure(): Promise<{ main: string; structure: ClassStructure }>;
  /** `notes` carries the pre-write check output a dry run reports with the diff. */
  save(url: string, source: string, notes?: string): Promise<void>;
}

export async function withClassEdit(
  ctx: SapWriteContext,
  edit: (locked: ClassEdit) => Promise<ToolResult>,
): Promise<ToolResult> {
  const { client, objectUrl, srcUrl, name, transport, invalidateWrittenObject } = ctx;
  if (isDryRun(ctx.args)) return previewClassEdit(ctx, edit);
  checkOperation(client.safety, OperationType.Update, 'EditClass');
  return client.http.withStatefulSession(async (session) => {
    const lock = await lockObject(session, client.safety, objectUrl, 'MODIFY', getCachedFeatures()?.abapRelease);
    let writeAttempted = false;
    let mainSource: string | undefined;
    const read = async (url: string, checkSource = true) => {
      checkOperation(client.safety, OperationType.Read, 'GetSource');
      // SAP returns the editable draft (active when none exists). Both endpoints must use
      // this same selection under the lock; caches and inactive worklists can be stale.
      const source = (await session.get(url, { 'Cache-Control': 'no-cache' })).body;
      if (checkSource) assertSourceHash(source, ctx.args.expectedSourceHash as string | undefined, url);
      return source;
    };
    try {
      const result = await edit({
        http: session,
        read,
        async readMainAndStructure() {
          const main = await read(srcUrl);
          mainSource = main;
          const structure = parseClassStructure(await read(`${objectUrl}/objectstructure`, false), name);
          return { main, structure };
        },
        async save(url, source) {
          // A dry run's resultHash also covers inputs outside the source (objectstructure ranges).
          assertResultHash(source, ctx.args.expectedResultHash as string | undefined, url);
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
      // A no-op answer is success only when the unchanged source is the result the dry run approved.
      if (!result.isError && !writeAttempted && mainSource !== undefined) {
        assertResultHash(mainSource, ctx.args.expectedResultHash as string | undefined, srcUrl);
      }
      return result;
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

/** Same reads and surgery without a lock; the single planned save becomes a diff. */
async function previewClassEdit(
  ctx: SapWriteContext,
  edit: (locked: ClassEdit) => Promise<ToolResult>,
): Promise<ToolResult> {
  const { client, objectUrl, srcUrl, name, type, args } = ctx;
  const expected = args.expectedSourceHash as string | undefined;
  const reads = new Map<string, string>();
  let planned: { url: string; source: string; notes?: string } | undefined;
  const read = async (url: string) => {
    const source = await readEditableForPreview(client, type, url, expected);
    reads.set(url, source);
    return source;
  };
  const result = await edit({
    http: client.http,
    read,
    async readMainAndStructure() {
      const main = await read(srcUrl);
      checkOperation(client.safety, OperationType.Read, 'GetSource');
      const structureXml = (await client.http.get(`${objectUrl}/objectstructure`, { 'Cache-Control': 'no-cache' }))
        .body;
      // Without a lock, source and structure must come from the same revision.
      if ((await readEditableForPreview(client, type, srcUrl, undefined)) !== main) {
        throw new AdtSafetyError(
          `${type} ${name} changed during the dry run. No write was made; run the dry run again.`,
        );
      }
      return { main, structure: parseClassStructure(structureXml, name) };
    },
    async save(url, source, notes) {
      planned = { url, source, notes };
    },
  });
  // Refusals and lint blocks are returned exactly as the write would return them.
  if (result.isError) return result;
  const expectedResultHash = args.expectedResultHash as string | undefined;
  if (!planned) {
    // A no-op answer (e.g. visibility already in place) keeps the preview format with changed=false.
    const current = reads.get(srcUrl);
    if (current === undefined) return result;
    const notes = result.content[0]?.text;
    return sourcePreviewResult({ type, name, current, proposed: current, notes, expectedResultHash });
  }
  const include = planned.url === srcUrl ? undefined : planned.url.split('/').pop();
  return sourcePreviewResult({
    type,
    name,
    include,
    current: reads.get(planned.url) as string,
    proposed: planned.source,
    notes: planned.notes,
    expectedResultHash,
  });
}
