/** Full XML replacements must merge the current metadata under the SAP lock. */

import type { AdtClient } from '../../adt/client.js';
import { updateObject, withLockedMutation } from '../../adt/crud.js';
import {
  formatKtdWriteReport,
  type KtdShortText,
  type KtdWriteReport,
  rewriteKtdDocument,
} from '../../adt/ddic-xml.js';
import { mutationClient, mutationResponsible } from '../../adt/mutation-client.js';
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
import { pinnedMetadataUpdateProfile } from './pinned-metadata-write.js';

export async function writeMetadataUpdate(ctx: SapWriteContext, existingPackage?: string): Promise<ToolResult> {
  const { client, args, config, type, name, objectUrl, transport, invalidateWrittenObject } = ctx;
  const pinned = ctx.mutationContext.mode === 'pinned-pp' ? pinnedMetadataUpdateProfile(ctx) : undefined;
  const dryRun = !pinned && type === 'SKTD' && args.dryRun === true;
  const prepareLegacy = async (current: AdtClient) => {
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
      await mutationResponsible(current, config.username),
      resolveWriteSystemType(config, current) === 'btp',
    );
    return { body, result: textResult(`Successfully updated ${type} ${name}.`) };
  };
  const prepare = pinned?.prepare ?? prepareLegacy;

  // A preview validates the same transformation without reserving a snapshot.
  if (dryRun) return (await prepareLegacy(client)).result;
  if (!pinned) checkOperation(client.safety, OperationType.Update, 'MetadataUpdate');
  let writeAttempted = false;
  const policy = pinned?.lock ?? {
    beforeLock: () => {},
    validateLock: async () => {},
    afterUnlockAttempt: () => {
      if (writeAttempted)
        try {
          invalidateWrittenObject(type, name);
        } catch {
          logger.warn('Metadata cache invalidation failed after a write attempt.');
        }
    },
  };
  return withLockedMutation(
    client.http,
    client.safety,
    ctx.mutationContext,
    objectUrl,
    policy,
    async (session, lock) => {
      const prepared = await prepare(mutationClient(client, ctx.mutationContext, session));
      if (!prepared) return textResult('');
      pinned?.beforeSave();
      writeAttempted = true;
      await updateObject(
        session,
        client.safety,
        objectUrl,
        prepared.body,
        lock.lockHandle,
        vendorContentTypeForType(type),
        pinned ? pinned.transport : (transport ?? (lock.corrNr || undefined)),
      );
      await pinned?.complete(session);
      return prepared.result;
    },
    pinned ? undefined : getCachedFeatures()?.abapRelease,
  );
}
