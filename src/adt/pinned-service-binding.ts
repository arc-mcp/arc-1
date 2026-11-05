/** Private SRVB CRUD. Publication is a separate resource policy and is never implicit. */
import type { AdtClient } from './client.js';
import { createObject, updateObject, withLockedMutation } from './crud.js';
import { buildServiceBindingXml } from './ddic-xml.js';
import { AdtApiError, AdtSafetyError } from './errors.js';
import { throwIfRequestCancelled } from './http-deadline.js';
import { mutationClient } from './mutation-client.js';
import { assertMutationContext, type PinnedMutationContext } from './mutation-context.js';
import { readNativeMetadata } from './native-xml-evidence.js';
import { deletePinnedOwner } from './pinned-delete.js';
import {
  assertManagedProfileInput,
  assertPinnedNativeName,
  isPinnedNativeAbsence,
  isPinnedPhaseRejection,
  normalizePinnedRequest,
  type PinnedManagedResult,
  pinnedDescription,
  pinnedManagedCleanup,
  pinnedManagedMessage,
} from './pinned-managed-resources.js';
import { pinnedPackageSelection, readPinnedPackage } from './pinned-package.js';
import { pinnedRepositoryOwner, readPinnedRepositoryOwner } from './pinned-repository-owner.js';
import {
  BINDING_XML_TYPE,
  bindingStableDocument,
  type PinnedBindingEvidence,
  type PinnedBindingPatch,
  type PinnedBindingSelection,
  parsePinnedBinding,
  patchPinnedBindingDocument,
  pinnedBindingSelection,
  readPinnedBinding,
  SERVICE_BINDING_COLLECTION,
} from './pinned-service-binding-owner.js';
import { type PinnedRecording, pinnedRecording, validatePinnedLock } from './pinned-write-policy.js';
import { checkOperation, OperationType } from './safety.js';

function bindingResource(selected: PinnedBindingSelection, pkg?: string) {
  return {
    kind: 'service-binding' as const,
    uri: selected.objectUrl,
    name: selected.name,
    nativeType: 'SRVB/SVB',
    package: pkg,
  };
}
function assertUnpublished(evidence: PinnedBindingEvidence) {
  if (evidence.published !== false || evidence.bindingCreated !== false)
    throw new AdtSafetyError('The binding must explicitly be unpublished and have no generated binding before CRUD.');
}
function patchInput(input: Record<string, unknown>, creating: boolean): PinnedBindingPatch {
  const patch: PinnedBindingPatch = {};
  if (input.description !== undefined || creating)
    patch.description = pinnedDescription(input.description, 'Service binding');
  if (input.serviceDefinition !== undefined || creating) {
    assertPinnedNativeName(input.serviceDefinition, 'Service definition');
    patch.serviceDefinition = input.serviceDefinition;
  }
  if (input.odataVersion !== undefined || creating) {
    if (input.odataVersion !== 'V2' && input.odataVersion !== 'V4')
      throw new AdtSafetyError('Select explicit OData V2 or V4.');
    patch.odataVersion = input.odataVersion;
  }
  if (input.category !== undefined || creating) {
    if (input.category !== '0' && input.category !== '1')
      throw new AdtSafetyError('Select native category 0 (UI) or 1 (Web API).');
    patch.category = input.category;
  }
  if (input.version !== undefined || creating) {
    if (typeof input.version !== 'string' || !/^\d{4}$/.test(input.version) || input.version === '0000')
      throw new AdtSafetyError('Select one nonzero four-digit service version.');
    patch.version = input.version;
  }
  if (Object.keys(patch).length === 0)
    throw new AdtSafetyError('Select at least one binding metadata field to update.');
  return patch;
}
async function rawBinding(client: AdtClient, selected: PinnedBindingSelection) {
  checkOperation(client.safety, OperationType.Read, 'PinnedBindingDocument');
  const response = await readNativeMetadata(
    client.http,
    selected.objectUrl,
    'binding-document',
    undefined,
    BINDING_XML_TYPE,
  );
  return { xml: response.body, evidence: parsePinnedBinding(response.body, selected) };
}
async function checkDefinition(client: AdtClient, name: string) {
  return readPinnedRepositoryOwner(client, pinnedRepositoryOwner('SRVD', name));
}

/** Deterministic shared input preparation; no native request or public admission. */
export function preparePinnedBindingCreate(input: Record<string, unknown>) {
  assertManagedProfileInput('binding-create', input);
  return {
    selected: pinnedBindingSelection(input.name),
    pkg: pinnedPackageSelection(input.package),
    patch: patchInput(input, true),
    requested: normalizePinnedRequest(input.transport),
  };
}

export async function createPinnedBinding(
  client: AdtClient,
  context: PinnedMutationContext,
  input: Record<string, unknown>,
  language = 'EN',
): Promise<PinnedManagedResult> {
  let phase = 'validation',
    state = 'unchanged';
  let resource: ReturnType<typeof bindingResource> | undefined, recording: PinnedRecording | undefined;
  try {
    assertMutationContext(client.safety, context);
    if (context.mode !== 'pinned-pp') throw new AdtSafetyError('A pinned mutation context is required.');
    checkOperation(client.safety, OperationType.Create, 'PinnedCreateBinding');
    const { selected, pkg, patch, requested } = preparePinnedBindingCreate(input);
    const scoped = mutationClient(client, context);
    resource = bindingResource(selected, pkg.name);
    phase = 'owner-preflight';
    await readPinnedPackage(scoped, pkg);
    await checkDefinition(scoped, patch.serviceDefinition!);
    let absent = false;
    try {
      await rawBinding(scoped, selected);
    } catch (error) {
      if (!isPinnedNativeAbsence(error)) throw error;
      absent = true;
    }
    if (!absent) throw new AdtSafetyError('The service binding already exists; creation was not sent.');
    phase = 'recording-preflight';
    recording = await pinnedRecording(
      scoped.http,
      client.safety,
      selected.objectUrl,
      pkg.name,
      'I',
      requested,
      context.requestPolicy,
    );
    const body = buildServiceBindingXml({
      name: selected.name,
      package: pkg.name,
      description: patch.description!,
      serviceDefinition: patch.serviceDefinition!,
      bindingType: 'ODATA',
      category: patch.category,
      odataVersion: patch.odataVersion,
      version: patch.version,
      language,
    });
    throwIfRequestCancelled(context.requestPolicy);
    phase = 'create';
    state = 'creation-unconfirmed';
    await createObject(
      scoped.http,
      client.safety,
      SERVICE_BINDING_COLLECTION,
      body,
      'application/*',
      recording.request,
    );
    phase = 'readback';
    state = 'created-unverified';
    const created = await readPinnedBinding(scoped, selected);
    if (
      created.packageName !== pkg.name ||
      created.description !== patch.description ||
      created.bindingType !== 'ODATA' ||
      created.category !== patch.category ||
      created.odataVersion !== patch.odataVersion ||
      created.services.length !== 1 ||
      created.services[0]?.version !== patch.version ||
      created.services[0]?.serviceDefinition !== patch.serviceDefinition ||
      created.nativeVersion !== 'inactive'
    )
      throw new AdtSafetyError('Native metadata did not confirm the requested inactive service binding.');
    assertUnpublished(created);
    return {
      ok: true,
      state: 'created-inactive',
      phase,
      retryable: false,
      resource,
      recording,
      warnings: ['Activation and publication are separate operations; neither was requested.'],
    };
  } catch (error) {
    if (phase === 'create' && isPinnedPhaseRejection(error) && error.creationOutcome !== 'unknown')
      state = 'creation-rejected';
    return {
      ok: false,
      state,
      phase,
      retryable: false,
      resource,
      recording,
      ...(error instanceof AdtApiError ? { statusCode: error.statusCode } : {}),
      message: pinnedManagedMessage(
        error,
        state === 'unchanged'
          ? 'No binding create was sent.'
          : 'Binding creation was not confirmed; inspect it before retrying.',
      ),
    };
  }
}

export async function updatePinnedBinding(
  client: AdtClient,
  context: PinnedMutationContext,
  input: Record<string, unknown>,
): Promise<PinnedManagedResult> {
  let phase = 'validation',
    state = 'unchanged';
  let resource: ReturnType<typeof bindingResource> | undefined, recording: PinnedRecording | undefined;
  let failure: unknown;
  try {
    assertMutationContext(client.safety, context);
    if (context.mode !== 'pinned-pp') throw new AdtSafetyError('A pinned mutation context is required.');
    checkOperation(client.safety, OperationType.Update, 'PinnedUpdateBinding');
    assertManagedProfileInput('binding-update', input);
    const selected = pinnedBindingSelection(input.name),
      patch = patchInput(input, false);
    const requested = normalizePinnedRequest(input.transport);
    if (typeof input.expectedMetadataHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.expectedMetadataHash))
      throw new AdtSafetyError('Read the private native binding document and supply its expectedMetadataHash.');
    const scoped = mutationClient(client, context);
    phase = 'owner-preflight';
    const before = await readPinnedBinding(scoped, selected);
    assertUnpublished(before);
    resource = bindingResource(selected, before.packageName);
    recording = await pinnedRecording(
      scoped.http,
      client.safety,
      selected.objectUrl,
      before.packageName,
      '',
      requested,
      context.requestPolicy,
    );
    const expected = recording;
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
          const active = mutationClient(client, context, session);
          const current = await readPinnedBinding(active, selected);
          if (current.packageName !== before.packageName)
            throw new AdtSafetyError('The binding package changed before its lock.');
          assertUnpublished(current);
          const fresh = await pinnedRecording(
            session,
            client.safety,
            selected.objectUrl,
            current.packageName,
            '',
            expected.request,
            context.requestPolicy,
          );
          if (fresh.local !== expected.local || fresh.request !== expected.request)
            throw new AdtSafetyError('Binding recording changed before its lock.');
          await validatePinnedLock(session, client.safety, lock, fresh, context.requestPolicy);
        },
      },
      async (session, lock) => {
        const active = mutationClient(client, context, session);
        phase = 'locked-document';
        const current = await rawBinding(active, selected);
        if (
          current.evidence.metadataHash !== input.expectedMetadataHash ||
          current.evidence.packageName !== before.packageName
        )
          throw new AdtSafetyError('The binding document changed since the supplied metadata hash; no PUT was sent.');
        assertUnpublished(current.evidence);
        const definition = patch.serviceDefinition ?? current.evidence.services[0]?.serviceDefinition;
        if (!definition) throw new AdtSafetyError('The binding lacks one native service definition.');
        await checkDefinition(active, definition);
        const body = patchPinnedBindingDocument(current.xml, selected, patch);
        throwIfRequestCancelled(context.requestPolicy);
        phase = 'save';
        state = 'save-unconfirmed';
        await updateObject(
          session,
          client.safety,
          selected.objectUrl,
          body,
          lock.lockHandle,
          BINDING_XML_TYPE,
          expected.request,
        );
        phase = 'readback';
        state = 'saved-unverified';
        const saved = await rawBinding(active, selected);
        assertUnpublished(saved.evidence);
        if (
          saved.evidence.nativeVersion !== 'inactive' ||
          bindingStableDocument(saved.xml) !== bindingStableDocument(body)
        )
          throw new AdtSafetyError('The inactive binding readback does not preserve the saved native document.');
        state = 'saved-inactive';
      },
    );
  } catch (error) {
    failure = error;
    if (phase === 'save' && isPinnedPhaseRejection(error)) state = 'save-rejected';
  }
  const cleanup = pinnedManagedCleanup(context);
  return {
    ok: state === 'saved-inactive' && !failure && !cleanup.cleanupFailed && !cleanup.lockOutcome,
    state,
    phase,
    retryable: false,
    resource,
    recording,
    ...cleanup,
    ...(failure instanceof AdtApiError ? { statusCode: failure.statusCode } : {}),
    ...(failure
      ? {
          message: pinnedManagedMessage(
            failure,
            state === 'unchanged'
              ? 'No binding PUT was sent.'
              : 'Binding save was not confirmed; do not automatically retry.',
          ),
        }
      : {}),
  };
}

export async function deletePinnedBinding(
  client: AdtClient,
  context: PinnedMutationContext,
  input: Record<string, unknown>,
) {
  assertManagedProfileInput('binding-delete', input);
  const selected = pinnedBindingSelection(input.name),
    transport = normalizePinnedRequest(input.transport);
  return deletePinnedOwner(
    client,
    context,
    { type: 'SRVB', name: selected.name, transport },
    {
      owner: selected.objectUrl,
      packageFor: async (active) => {
        const binding = await readPinnedBinding(active, selected);
        assertUnpublished(binding);
        return binding.packageName;
      },
    },
  );
}
