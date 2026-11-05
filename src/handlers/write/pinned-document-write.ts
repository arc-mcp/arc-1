/** Private ENHO/SKTD CRUD profiles over the shared native create, lock/save and delete cores. */
import type { AdtClient } from '../../adt/client.js';
import { createObject, updateObject, withLockedMutation } from '../../adt/crud.js';
import {
  formatKtdWriteReport,
  type KtdShortText,
  type KtdWriteReport,
  normalizeAdtLanguage,
} from '../../adt/ddic-xml.js';
import { badiContainerXml, buildBadiImplementationXml } from '../../adt/enhancement-impl.js';
import { AdtApiError, AdtRequestNotSentError, AdtSafetyError } from '../../adt/errors.js';
import { throwIfRequestCancelled } from '../../adt/http-deadline.js';
import { mutationClient } from '../../adt/mutation-client.js';
import type { PinnedMutationContext } from '../../adt/mutation-context.js';
import { deletePinnedOwner } from '../../adt/pinned-delete.js';
import {
  documentStableValue,
  parsePinnedDocument,
  readDocumentParent,
  readPinnedDocument,
} from '../../adt/pinned-document-owner.js';
import {
  enhoSavedMatches,
  patchPinnedEnhoDocument,
  resolvePinnedBadiDefinition,
} from '../../adt/pinned-enho-document.js';
import { rewritePinnedKtdDocument } from '../../adt/pinned-ktd-document.js';
import { isPinnedNativeAbsence } from '../../adt/pinned-managed-resources.js';
import { pinnedRecording, validatePinnedLock } from '../../adt/pinned-write-policy.js';
import { checkOperation, checkPackage, OperationType } from '../../adt/safety.js';
import type { ServerConfig } from '../../server/types.js';
import { pinnedOperationResult } from '../pinned-operation.js';
import type { ToolResult } from '../shared.js';
import { buildKtdCreateXml } from './ktd-create.js';
import { documentInput } from './pinned-document-input.js';
import { pinnedFailure } from './pinned-result.js';

export async function handlePrivatePinnedDocumentWrite(
  client: AdtClient,
  input: Record<string, unknown>,
  config: ServerConfig,
  grant: PinnedMutationContext,
): Promise<ToolResult> {
  let phase = 'validation',
    state = 'unchanged';
  let created = false;
  try {
    const selection = documentInput(client, config, input, grant);
    const { selected, action, context, transport } = selection;
    client = mutationClient(client, context);
    const read = (current: AdtClient) => readPinnedDocument(current, selected);
    if (action === 'delete') {
      const result = await deletePinnedOwner(
        client,
        context,
        { type: selected.type, name: selected.name, transport },
        { owner: selected.objectUrl, packageFor: async (current) => (await read(current)).packageName },
      );
      return pinnedOperationResult(result, config, { action, type: selected.type, name: selected.name });
    }
    phase = 'package-preflight';
    let before = action === 'update' ? await read(client) : undefined;
    const pkg = before?.packageName ?? selection.pkg!;
    await checkPackage(client.safety, pkg, client.getPackageHierarchyResolver());
    if (before && before.hash !== input.expectedMetadataHash)
      throw new AdtSafetyError('The native document changed since it was read. No mutation was sent.');
    phase = 'recording-preflight';
    const recording = await pinnedRecording(
      client.http,
      client.safety,
      selected.objectUrl,
      pkg,
      action === 'create' ? 'I' : '',
      transport,
      context.requestPolicy,
    );
    if (action === 'create') {
      phase = 'absence-preflight';
      try {
        await read(client);
        throw new AdtSafetyError('The native document already exists.');
      } catch (error) {
        if (!isPinnedNativeAbsence(error)) throw error;
      }
      let body: string;
      if (selected.type === 'SKTD') {
        phase = 'parent-preflight';
        await readDocumentParent(client, selection.parent!.type, selected.name);
        body = buildKtdCreateXml(
          selected.name,
          pkg,
          selection.parent!.type,
          selected.name,
          String(input.refObjectDescription ?? ''),
          config.language,
        );
      } else {
        phase = 'spot-preflight';
        const definition = await resolvePinnedBadiDefinition(client, selection.definition!, selected.name);
        body = badiContainerXml(
          buildBadiImplementationXml({
            name: selected.name,
            package: pkg,
            description: String(input.description ?? selected.name),
            masterLanguage: normalizeAdtLanguage(config.language),
            responsibleAttr: '',
            definition,
          }),
        );
      }
      throwIfRequestCancelled(context.requestPolicy);
      phase = 'create';
      state = 'creation-unconfirmed';
      await createObject(
        client.http,
        client.safety,
        selected.collection,
        body,
        selected.contentType,
        recording.request,
      );
      created = true;
      state = 'created-document-unconfirmed';
      phase = 'created-document-read';
      before = await read(client);
      if (
        before.packageName !== pkg ||
        (selected.type === 'SKTD' && before.refType !== selection.parent!.type) ||
        (selected.type === 'ENHO' && before.refName !== selection.definition!.enhancementSpot) ||
        !['inactive', 'new'].includes(before.version)
      )
        throw new AdtSafetyError('The created native document identity, reference or state is unconfirmed.');
      if (
        selected.type === 'SKTD' &&
        input.refObjectDescription !== undefined &&
        before.root.child('refObject', selected.namespace)?.attribute('description', 'http://www.sap.com/adt/core') !==
          input.refObjectDescription
      )
        throw new AdtSafetyError('The created documentation reference description was not confirmed.');
      if (
        selected.type === 'ENHO' &&
        before.root.attribute('description', 'http://www.sap.com/adt/core') !==
          String(input.description ?? selected.name)
      )
        throw new AdtSafetyError('The created BAdI description was not confirmed.');
      if (
        selected.type === 'ENHO' &&
        (before.root
          .child('contentSpecific', selected.namespace)
          ?.child('badiTechnology', selected.namespace)
          ?.child('badiImplementations', selected.namespace)
          ?.children('badiImplementation', selected.namespace).length ?? 0) !== 0
      )
        throw new AdtSafetyError('The newly created BAdI container unexpectedly contains implementations.');
    }
    if (!before) throw new AdtSafetyError('No native document was captured.');
    const baseline = before;
    let summary: string | undefined;
    async function prepare(current: AdtClient, xml: string) {
      if (selected.type === 'ENHO')
        return patchPinnedEnhoDocument(
          current,
          xml,
          selected,
          selection.definition ?? {},
          input.description as string | undefined,
        );
      const report: KtdWriteReport = { proseHeadings: [] };
      const body = rewritePinnedKtdDocument(
        xml,
        input.source as string | undefined,
        input.shortTexts as KtdShortText[] | undefined,
        report,
      );
      summary = formatKtdWriteReport(xml, body, report, input.dryRun === true);
      return body;
    }
    if (input.dryRun === true) {
      phase = 'preview';
      await prepare(client, baseline.xml);
      return pinnedOperationResult(
        {
          ok: true,
          state: 'preview',
          metadataHash: baseline.hash,
          nativeVersion: baseline.version,
          summary,
          retryable: false,
        },
        config,
        { action, type: selected.type, name: selected.name },
      );
    }
    let saved = baseline;
    const needsSave =
      input.source !== undefined || input.shortTexts !== undefined || (!created && input.description !== undefined);
    if (needsSave)
      await withLockedMutation(
        client.http,
        client.safety,
        context,
        selected.objectUrl,
        {
          beforeLock: () => {
            phase = 'lock';
            throwIfRequestCancelled(context.requestPolicy);
          },
          validateLock: async (session, lock) => {
            phase = 'locked-policy';
            const current = await read(mutationClient(client, context, session));
            if (current.packageName !== pkg || current.hash !== baseline.hash)
              throw new AdtSafetyError('The native document changed before its owning lock. No PUT was sent.');
            const fresh = await pinnedRecording(
              session,
              client.safety,
              selected.objectUrl,
              pkg,
              '',
              recording.request,
              context.requestPolicy,
            );
            if (fresh.local !== recording.local || fresh.request !== recording.request)
              throw new AdtSafetyError('Native document recording changed before its save.');
            await validatePinnedLock(session, client.safety, lock, fresh, context.requestPolicy);
          },
        },
        async (session, lock) => {
          const current = mutationClient(client, context, session);
          phase = 'document-read';
          const stored = await read(current);
          if (stored.packageName !== pkg || stored.hash !== baseline.hash)
            throw new AdtSafetyError('The native document changed under the owning lock. No PUT was sent.');
          phase = 'edit-preparation';
          const body = await prepare(current, stored.xml);
          parsePinnedDocument(body, selected);
          if (selected.type === 'ENHO') enhoSavedMatches(stored.xml, body, body, selected);
          if (documentStableValue(body, selected) === stored.stable) {
            saved = stored;
            return;
          }
          checkOperation(client.safety, OperationType.Update, 'PinnedDocumentSave');
          throwIfRequestCancelled(context.requestPolicy);
          phase = 'document-save';
          state = created ? 'created-document-save-unconfirmed' : 'document-save-unconfirmed';
          await updateObject(
            session,
            client.safety,
            selected.objectUrl,
            body,
            lock.lockHandle,
            selected.contentType,
            recording.request,
          );
          phase = 'document-readback';
          saved = await read(current);
          if (
            saved.packageName !== pkg ||
            (selected.type === 'ENHO'
              ? !enhoSavedMatches(stored.xml, body, saved.xml, selected)
              : saved.stable !== documentStableValue(body, selected)) ||
            !['inactive', 'new'].includes(saved.version)
          )
            throw new AdtSafetyError('The saved document content or inactive state could not be confirmed.');
          state = created ? 'created' : 'saved-inactive';
        },
      );
    if (context.cleanup.unlockFailed || context.cleanup.sessionClosed === false) {
      phase = 'cleanup';
      throw new AdtSafetyError('The owning native document session cleanup is unconfirmed.');
    }
    if (state === 'created-document-unconfirmed') state = 'created';
    return pinnedOperationResult(
      {
        ok: true,
        state,
        metadataHash: saved.hash,
        nativeVersion: saved.version,
        summary,
        transport: recording.request,
        retryable: false,
        next: 'Review the native document in ADT. Public write admission and native/PP qualification for this private profile remain pending.',
      },
      config,
      { action, type: selected.type, name: selected.name },
    );
  } catch (error) {
    if (error instanceof AdtRequestNotSentError && ['create', 'document-save'].includes(phase))
      state = created ? 'created-document-unconfirmed' : 'unchanged';
    else if (
      error instanceof AdtApiError &&
      ['create', 'document-save'].includes(phase) &&
      [400, 401, 403, 404, 409, 412, 415, 422, 423].includes(error.statusCode) &&
      error.creationOutcome !== 'unknown'
    )
      state = created
        ? 'created-document-rejected'
        : phase === 'create'
          ? 'creation-rejected'
          : 'document-save-rejected';
    return pinnedFailure(error, state, phase, grant.cleanup.unlockFailed, {
      minimalErrors: config.minimalErrors,
      sessionClosed: grant.cleanup.sessionClosed,
      unlockFailures: grant.cleanup.unlockFailures,
      unknownLocks: grant.cleanup.unknownLocks,
    });
  }
}
