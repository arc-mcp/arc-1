/** Full XML replacements must merge the current metadata under the SAP lock. */
import type { AdtClient } from '../../adt/client.js';
import { lockObject, unlockObject, updateObject } from '../../adt/crud.js';
import {
  formatKtdWriteReport,
  type KtdShortText,
  type KtdWriteReport,
  rewriteKtdDocument,
} from '../../adt/ddic-xml.js';
import { checkOperation, OperationType } from '../../adt/safety.js';
import { logger } from '../../server/logger.js';
import { getCachedFeatures } from '../feature-cache.js';
import { type ToolResult, textResult } from '../shared.js';
import {
  buildCreateXml,
  getMetadataWriteProperties,
  mergeMetadataWriteProperties,
  resolveWriteSystemType,
  vendorContentTypeForType,
} from '../write-helpers.js';
import type { SapWriteContext } from './context.js';

export async function writeMetadataUpdate(ctx: SapWriteContext, existingPackage?: string): Promise<ToolResult> {
  const { client, args, config, type, name, objectUrl, transport, invalidateWrittenObject } = ctx;
  const dryRun = type === 'SKTD' && args.dryRun === true;
  const prepare = async (current: AdtClient) => {
    if (type === 'SKTD') {
      // Omit version: the editable envelope includes pending node changes. An
      // explicit active read would revert them on the next update (2026-09-02).
      const { source: envelope } = await current.getKtd(name);
      const report: KtdWriteReport = { proseHeadings: [] };
      const body = rewriteKtdDocument(
        envelope,
        ctx.hasSource ? ctx.source : undefined,
        args.shortTexts as KtdShortText[] | undefined,
        report,
      );
      const summary = formatKtdWriteReport(envelope, body, report, dryRun);
      return {
        body,
        result: textResult(
          `${dryRun ? `Dry run for ${type} ${name} — nothing was written.` : `Successfully updated ${type} ${name}.`}\n${summary}`,
        ),
      };
    }
    const merged = await mergeMetadataWriteProperties(current, type, name, getMetadataWriteProperties(args));
    const body = buildCreateXml(
      type,
      name,
      String(args.package ?? existingPackage ?? merged._package ?? '$TMP'),
      String(args.description ?? merged._description ?? name),
      merged,
      config.language,
      config.username || (await current.getEffectiveUser()),
      resolveWriteSystemType(config, current) === 'btp',
    );
    return { body, result: textResult(`Successfully updated ${type} ${name}.`) };
  };

  // A preview validates the same transformation without reserving a snapshot.
  if (dryRun) return (await prepare(client)).result;
  checkOperation(client.safety, OperationType.Update, 'MetadataUpdate');
  return client.withStatefulSession(async (current) => {
    const lock = await lockObject(current.http, current.safety, objectUrl, 'MODIFY', getCachedFeatures()?.abapRelease);
    let writeAttempted = false;
    try {
      const { body, result } = await prepare(current);
      writeAttempted = true;
      await updateObject(
        current.http,
        current.safety,
        objectUrl,
        body,
        lock.lockHandle,
        vendorContentTypeForType(type),
        transport ?? (lock.corrNr || undefined),
      );
      return result;
    } finally {
      try {
        await unlockObject(current.http, objectUrl, lock.lockHandle);
      } finally {
        if (writeAttempted) {
          try {
            invalidateWrittenObject(type, name);
          } catch {
            logger.warn('Metadata cache invalidation failed after a write attempt.');
          }
        }
      }
    }
  });
}
