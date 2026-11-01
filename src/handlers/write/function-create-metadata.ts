/** Shared FUNC processing-kind round trip; pinned creates read and rewrite metadata under the native child lock. */
import type { AdtClient } from '../../adt/client.js';
import { safeUpdateObject, updateObject, withLockedMutation } from '../../adt/crud.js';
import { AdtSafetyError } from '../../adt/errors.js';
import { mutationClient } from '../../adt/mutation-client.js';
import { nativeXmlRoot } from '../../adt/native-xml-evidence.js';
import { pinnedFunctionSelection } from '../../adt/pinned-function-owner.js';
import { escapeXmlAttr, parseFunctionModuleProperties } from '../../adt/xml-parser.js';
import { getCachedFeatures } from '../feature-cache.js';
import type { FunctionProcessingType, FunctionUpdateTaskKind } from '../function-processing.js';
import { vendorContentTypeForType } from '../write-helpers.js';
import type { SapWriteContext } from './context.js';
import { pinnedSourceLockPolicy } from './pinned-lock.js';
import { pinnedSourceState } from './pinned-source-context.js';

const mediaType = /^application\/vnd\.sap\.adt\.functions\.fmodules(?:\.v\d+)?\+xml\b/i;
const ns = 'http://www.sap.com/adt/functions/fmodules',
  core = 'http://www.sap.com/adt/core';

function rewrite(xml: string, processingType: FunctionProcessingType, updateTaskKind?: FunctionUpdateTaskKind): string {
  const root = /<fmodule:abapFunctionModule\b[^>]*>/i.exec(xml);
  if (!root || root.index === undefined)
    throw new Error('FUNC processing metadata update failed: SAP did not return an abapFunctionModule envelope.');
  const clean = root[0]
    .replace(/\s+fmodule:processingType\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
    .replace(/\s+fmodule:updateTaskKind\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
  const attributes = ` fmodule:processingType="${escapeXmlAttr(processingType)}"${updateTaskKind === undefined ? '' : ` fmodule:updateTaskKind="${escapeXmlAttr(updateTaskKind)}"`}`;
  return (
    xml.slice(0, root.index) +
    clean.replace(/<fmodule:abapFunctionModule/i, (tag) => `${tag}${attributes}`) +
    xml.slice(root.index + root[0].length)
  );
}

export async function persistFunctionModuleProcessingMetadata(
  ctx: SapWriteContext,
  objectUrl: string,
  processingType: FunctionProcessingType,
  updateTaskKind: FunctionUpdateTaskKind | undefined,
  transport: string | undefined,
): Promise<void> {
  const state = ctx.mutationContext.mode === 'pinned-pp' ? pinnedSourceState(ctx) : undefined;
  function nativeProperties(xml: string) {
    const root = nativeXmlRoot(xml, 'abapFunctionModule', ns);
    const selected = pinnedFunctionSelection('FUNC', ctx.name, ctx.args.group);
    const container = root.child('containerRef', core);
    if (
      root.attribute('name', core) !== selected.name ||
      root.attribute('type', core) !== 'FUGR/FF' ||
      container?.attribute('name', core) !== selected.group ||
      container.attribute('type', core) !== 'FUGR/F' ||
      container.attribute('uri', core)?.replace(/%2f/gi, '%2F') !== selected.groupUrl ||
      container.attribute('packageName', core) !== state?.pkg
    )
      throw new AdtSafetyError('Fresh FUNC processing metadata does not match the selected owner and package.');
    return {
      processingType: root.attribute('processingType', ns),
      updateTaskKind: root.attribute('updateTaskKind', ns),
    };
  }
  async function roundTrip(active: AdtClient, save: (body: string, contentType: string) => Promise<void>) {
    const inactiveUrl = `${objectUrl}?version=inactive`;
    const current = await active.getObjectMetadata(inactiveUrl);
    if (state) nativeProperties(current.body);
    const body = rewrite(current.body, processingType, updateTaskKind);
    const responseType = Object.entries(current.headers).find(([name]) => name.toLowerCase() === 'content-type')?.[1];
    // Native metadata PUT requires the negotiated bare media type (v3 on 758, v2 on 750).
    const contentType =
      [responseType, active.http.discoveryAcceptFor(objectUrl)]
        .find((type): type is string => type !== undefined && mediaType.test(type))
        ?.split(';')[0]
        ?.trim() ?? vendorContentTypeForType('FUNC');
    await save(body, contentType);
    const persisted = await active.getObjectMetadata(inactiveUrl);
    const actual = state ? nativeProperties(persisted.body) : parseFunctionModuleProperties(persisted.body);
    if (actual.processingType !== processingType || actual.updateTaskKind !== updateTaskKind)
      throw new Error(
        `SAP retained processingType="${actual.processingType ?? 'unknown'}"${actual.updateTaskKind === undefined ? '' : ` and updateTaskKind="${actual.updateTaskKind}"`}.`,
      );
  }
  if (!state)
    return roundTrip(ctx.client, (body, contentType) =>
      safeUpdateObject(
        ctx.client.http,
        ctx.client.safety,
        objectUrl,
        body,
        contentType,
        transport,
        getCachedFeatures()?.abapRelease,
      ),
    );
  if (
    ctx.type !== 'FUNC' ||
    ctx.args.action !== 'create' ||
    ctx.objectUrl !== objectUrl ||
    !state.createdOwner ||
    !state.pkg ||
    !state.recording ||
    transport !== state.recording.request
  )
    throw new AdtSafetyError(
      'FUNC processing metadata requires its confirmed creation and verified recording context.',
    );
  await withLockedMutation(
    ctx.client.http,
    ctx.client.safety,
    state.context,
    objectUrl,
    pinnedSourceLockPolicy(ctx.client, state.context, objectUrl, state.pkg, state.recording, (phase) => {
      state.phase = phase;
    }),
    async (session, lock) => {
      state.phase = 'processing-metadata-read';
      await roundTrip(mutationClient(ctx.client, state.context, session), async (body, contentType) => {
        state.phase = 'processing-metadata-save';
        state.state = 'created-processing-unknown';
        await updateObject(session, ctx.client.safety, objectUrl, body, lock.lockHandle, contentType, transport);
        state.phase = 'processing-metadata-readback';
      });
      state.state = 'created-source-not-confirmed';
    },
  );
}
