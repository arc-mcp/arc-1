/** Private DDIC metadata profile: fresh under-lock merge, lossless preflight and read-back evidence. */
import type { AdtClient } from '../../adt/client.js';
import { updateObject, withLockedMutation } from '../../adt/crud.js';
import { AdtError, AdtSafetyError } from '../../adt/errors.js';
import type { AdtHttpClient } from '../../adt/http.js';
import { throwIfRequestCancelled } from '../../adt/http-deadline.js';
import { mutationClient } from '../../adt/mutation-client.js';
import { nativeXmlRoot } from '../../adt/native-xml-evidence.js';
import {
  ENQU_SOURCE_PATHS,
  type PinnedDdicEvidence,
  pinnedDdicSelection,
  REQUESTED_PATHS,
  readPinnedDdicEvidence,
} from '../../adt/pinned-ddic-owner.js';
import {
  assertOnlyRequestedChanges,
  assertSavedFields,
  derivedMetadataFields,
  type FieldMatcher,
  metadataFields,
  withStoredRootAttributes,
} from '../../adt/pinned-metadata-projection.js';
import {
  addedMessageNumbers,
  assertSavedMessageClass,
  preparePinnedMessageClassUpdate,
} from '../../adt/pinned-msag-document.js';

export { PINNED_METADATA_INPUTS } from '../../adt/pinned-ddic-owner.js';

import { checkOperation, OperationType } from '../../adt/safety.js';
import { type ToolResult, textResult, toolJson } from '../shared.js';
import {
  buildCreateXml,
  getMetadataWriteProperties,
  mergeMetadataWriteProperties,
  resolveWriteSystemType,
  vendorContentTypeForType,
} from '../write-helpers.js';
import type { SapWriteContext } from './context.js';
import { assertCreationStepCleanup } from './creation.js';
import { pinnedSourceLockPolicy } from './pinned-lock.js';
import { pinnedSourceState } from './pinned-source-context.js';

function requestedPaths(ctx: SapWriteContext): FieldMatcher[] {
  const { args, type } = ctx;
  const paths: FieldMatcher[] = args.description === undefined ? [] : ['@adtcore:description'];
  if (type === 'ENQU') {
    if (args.source === undefined) return paths;
    for (const key of Object.keys(JSON.parse(String(args.source)) as Record<string, unknown>))
      if (ENQU_SOURCE_PATHS[key]) paths.push(ENQU_SOURCE_PATHS[key]);
    return paths;
  }
  for (const [field, matchers] of Object.entries(REQUESTED_PATHS[type] ?? {}))
    if (args[field] !== undefined) paths.push(...matchers);
  return paths;
}

// Local input/merge diagnostics carry no SAP content and name the actual refusal reason.
function localRefusal(error: unknown): unknown {
  if (error instanceof AdtError && error.constructor !== AdtError) return error;
  return new AdtSafetyError(error instanceof Error ? error.message : 'The metadata update could not be prepared.');
}

function savedState(version: string): string {
  return version === 'active' ? 'saved-active' : 'saved-inactive';
}

async function verifySave(
  ctx: SapWriteContext,
  session: Parameters<typeof mutationClient>[2],
  body: string,
  derived: readonly FieldMatcher[],
  created = false,
  addedMessages?: ReadonlySet<string>,
): Promise<PinnedDdicEvidence> {
  const state = pinnedSourceState(ctx);
  state.phase = 'metadata-readback';
  const selected = pinnedDdicSelection(ctx.type, ctx.name);
  const saved = await readPinnedDdicEvidence(mutationClient(ctx.client, state.context, session), selected, 'inactive');
  if (saved.packageName !== state.pkg) throw new AdtSafetyError('The owner package changed during the metadata save.');
  if (ctx.type === 'MSAG' && !created && addedMessages) assertSavedMessageClass(body, saved.xml, addedMessages);
  else {
    const target = metadataFields(nativeXmlRoot(body, selected.root, selected.namespace, true), selected.namespace);
    assertSavedFields(target, saved.fields, [...derived, ...derivedMetadataFields(ctx.type, target)], created);
  }
  return saved;
}

/** Shared SAPWrite update action selects this profile on pinned routes. Never reuses the caller's package. */
export function pinnedMetadataUpdateProfile(ctx: SapWriteContext) {
  const state = pinnedSourceState(ctx);
  const { client, args, config, type, name, objectUrl } = ctx;
  if (!state.pkg || !state.recording)
    throw new AdtSafetyError('Metadata updates require verified package and recording preflight.');
  const { context, recording, pkg } = state;
  const selected = pinnedDdicSelection(type, name);
  const policy = pinnedSourceLockPolicy(client, context, objectUrl, pkg, recording, (phase) => {
    state.phase = phase;
  });
  let persistedBody: string, changed: string[], addedMessages: ReadonlySet<string> | undefined;
  return {
    lock: policy,
    transport: recording.request,
    async prepare(current: AdtClient) {
      state.phase = 'metadata-read';
      // Explicit inactive view: an unversioned read can hide another user's pending draft.
      const stored = await readPinnedDdicEvidence(current, selected, 'inactive');
      if (stored.packageName !== pkg) throw new AdtSafetyError('The owner package changed since preflight.');
      if (args.expectedMetadataHash !== undefined && args.expectedMetadataHash !== stored.hash)
        throw new AdtSafetyError('The stored metadata changed since it was read. No write was sent. Re-read it first.');
      state.phase = 'edit-preparation';
      let body: string;
      try {
        const provided = getMetadataWriteProperties(args);
        if (type === 'DTEL') provided.typeName = provided.typeName ?? provided.domainName;
        const merged = await mergeMetadataWriteProperties(current, type, name, provided, stored.xml);
        if (type === 'MSAG') {
          const language = stored.root.attribute('language', 'http://www.sap.com/adt/core');
          if (
            !language?.trim() ||
            language !== language.trim() ||
            !stored.masterLanguage?.trim() ||
            language !== stored.masterLanguage
          )
            throw new AdtSafetyError(
              'Message texts require verified language and master language; connect in the master language to edit them.',
            );
        }
        body = buildCreateXml(
          type,
          name,
          pkg,
          String(args.description ?? merged._description ?? name),
          merged,
          stored.masterLanguage,
          stored.responsible,
          resolveWriteSystemType(config, current) === 'btp',
        );
        body = withStoredRootAttributes(body, stored.root);
      } catch (error) {
        throw localRefusal(error);
      }
      persistedBody = body;
      if (type === 'MSAG') {
        const prepared = preparePinnedMessageClassUpdate(stored.xml, body, {
          messages: args.messages !== undefined,
          description: args.description !== undefined,
        });
        body = prepared.body;
        persistedBody = prepared.persistedBody;
        changed = prepared.changedFields;
        addedMessages = addedMessageNumbers(stored.xml, persistedBody);
      } else {
        const target = metadataFields(nativeXmlRoot(body, selected.root, selected.namespace, true), selected.namespace);
        changed = assertOnlyRequestedChanges(stored.fields, target, requestedPaths(ctx));
      }
      if (!changed.length) {
        state.unchangedConfirmed = true;
        state.metadata = { hash: stored.hash, nativeVersion: stored.version };
        return;
      }

      return { body, result: textResult('') };
    },
    beforeSave() {
      checkOperation(client.safety, OperationType.Update, 'PinnedMetadataSave');
      throwIfRequestCancelled(context.requestPolicy);
      state.phase = 'metadata-save';
      state.state = 'metadata-save-unknown';
      state.writeAttempted = true;
    },
    async complete(session: AdtHttpClient) {
      const saved = await verifySave(ctx, session, persistedBody, [], false, addedMessages);
      state.metadata = { hash: saved.hash, nativeVersion: saved.version, changedFields: changed };
      state.state = savedState(saved.version);
    },
  };
}

/** SAP's POST stores only a shell for these; the requested definition needs a separate locked save. */
function createNeedsSave(type: string, properties: Record<string, unknown>): boolean {
  return (
    type === 'DTEL' ||
    type === 'TTYP' ||
    (type === 'MSAG' && Array.isArray(properties.messages) && properties.messages.length > 0)
  );
}

// SAP assigns these itself on create; requested-definition evidence excludes them.
const createAssigned: readonly FieldMatcher[] = [
  /^@adtcore:(masterSystem|masterLanguage|responsible|abapLanguageVersion)$/,
];

export async function completePinnedMetadataCreate(
  ctx: SapWriteContext,
  body: string,
  properties: Record<string, unknown>,
): Promise<void> {
  const state = pinnedSourceState(ctx);
  const { client, type, objectUrl } = ctx;
  const { context, recording, pkg } = state;
  if (!pkg || !recording || !state.createdOwner)
    throw new AdtSafetyError('Metadata follow-up requires its confirmed creation and recording context.');
  state.state = 'created-metadata-not-confirmed';
  assertCreationStepCleanup(ctx);
  const selected = pinnedDdicSelection(type, ctx.name);
  if (!createNeedsSave(type, properties)) {
    state.phase = 'metadata-readback';
    const saved = await verifySave(ctx, client.http, body, createAssigned, true);
    state.metadata = { hash: saved.hash, nativeVersion: saved.version };
    state.state = 'created';
    return;
  }
  const policy = pinnedSourceLockPolicy(client, context, objectUrl, pkg, recording, (phase) => {
    state.phase = phase;
  });
  await withLockedMutation(client.http, client.safety, context, objectUrl, policy, async (session, lock) => {
    state.phase = 'metadata-read';
    const shell = await readPinnedDdicEvidence(mutationClient(client, context, session), selected, 'inactive');
    const replacement = withStoredRootAttributes(body, shell.root);
    checkOperation(client.safety, OperationType.Update, 'PinnedMetadataSave');
    throwIfRequestCancelled(context.requestPolicy);
    state.phase = 'metadata-save';
    state.state = 'created-metadata-unknown';
    state.writeAttempted = true;
    await updateObject(
      session,
      client.safety,
      objectUrl,
      replacement,
      lock.lockHandle,
      vendorContentTypeForType(type),
      recording.request,
    );
    const saved = await verifySave(ctx, session, replacement, [], true);
    state.metadata = { hash: saved.hash, nativeVersion: saved.version };
    state.state = saved.version === 'active' ? 'created-active' : 'created';
  });
  assertCreationStepCleanup(ctx);
}

export function pinnedMetadataResult(ctx: SapWriteContext): ToolResult {
  const state = pinnedSourceState(ctx);
  if (!state.metadata) throw new AdtSafetyError('The metadata profile did not confirm a native result.');
  const { args, config } = ctx;
  const needsParentActivation = ctx.type === 'TABL/DTT' && state.metadata.nativeVersion === 'new';
  return textResult(
    toolJson({
      target: config.targetId,
      type: args.type,
      name: args.name,
      action: args.action,
      state: state.unchangedConfirmed ? 'unchanged' : state.state,
      metadataHash: state.metadata.hash,
      nativeVersion: state.metadata.nativeVersion,
      ...(state.metadata.changedFields ? { changedFields: state.metadata.changedFields } : {}),
      ...(!state.unchangedConfirmed && state.recording?.request ? { transport: state.recording.request } : {}),
      next: state.unchangedConfirmed
        ? 'The stored metadata already has the requested values; nothing was saved.'
        : ctx.type === 'MSAG' && state.metadata.nativeVersion === 'active'
          ? 'Review the saved active message class and its dependents in ADT.'
          : needsParentActivation
            ? 'New technical settings activate with their parent table: activate TABL, not TABL/DTT. Review its inactive state in ADT first.'
            : 'Review the saved inactive metadata and its dependents in ADT. Activation can adjust dependent objects outside this package. Pinned activation for this private profile is not yet admitted.',
    }),
  );
}
