import type { AdtClient } from './client.js';
import { AdtApiError, AdtSafetyError } from './errors.js';
import { throwIfRequestCancelled } from './http-deadline.js';
import { mutationClient } from './mutation-client.js';
import { assertMutationContext, type PinnedMutationContext } from './mutation-context.js';
import { assertManagedProfileInput } from './pinned-managed-resources.js';
import { pinnedBindingSelection, readPinnedBinding } from './pinned-service-binding-owner.js';
import { checkOperation, OperationType } from './safety.js';
import {
  assertPublicationRecording,
  type PublicationRecordingProfile,
  type PublishResult,
  publicationProfile,
  publishServiceBinding,
  unpublishServiceBinding,
} from './service-publication.js';

export function selectPinnedPublication(input: Record<string, unknown>, action: 'publish_srvb' | 'unpublish_srvb') {
  assertManagedProfileInput(action === 'publish_srvb' ? 'binding-publish' : 'binding-unpublish', input);
  const selected = pinnedBindingSelection(input.name);
  if (typeof input.version !== 'string' || !/^\d{4}$/.test(input.version) || input.version === '0000')
    throw new AdtSafetyError('Publication requires an exact four-digit nonzero service version.');
  if (input.serviceType !== 'odatav2' && input.serviceType !== 'odatav4')
    throw new AdtSafetyError('Publication requires an explicit odatav2 or odatav4 protocol.');
  if (typeof input.expectedMetadataHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.expectedMetadataHash))
    throw new AdtSafetyError('Read the native service-binding metadata and supply expectedMetadataHash.');
  return { selected, version: input.version, serviceType: input.serviceType, hash: input.expectedMetadataHash };
}

export async function preflightPinnedPublication(
  client: AdtClient,
  selection: ReturnType<typeof selectPinnedPublication>,
) {
  const current = await readPinnedBinding(client, selection.selected);
  if (current.metadataHash !== selection.hash || current.nativeVersion !== 'active')
    throw new AdtSafetyError('The selected service-binding metadata changed or is not explicitly active.');
  const active = await readPinnedBinding(client, selection.selected, 'active');
  if (
    active.nativeVersion !== 'active' ||
    active.inactiveAlternative ||
    current.inactiveAlternative ||
    active.metadataHash !== current.metadataHash
  )
    throw new AdtSafetyError('The active and editable service-binding metadata do not agree.');
  if (current.bindingType !== 'ODATA' || current.odataVersion !== (selection.serviceType === 'odatav2' ? 'V2' : 'V4'))
    throw new AdtSafetyError('The selected protocol differs from the native service binding.');
  if (current.published === undefined || current.bindingCreated === undefined)
    throw new AdtSafetyError('The native publication state is not explicit.');
  if (!current.services.some((service) => service.version === selection.version))
    throw new AdtSafetyError('The requested selector version is not present in the active binding.');
  if (
    current.services.length > 100 ||
    current.services.some(
      (item) =>
        !item.name ||
        !/^(?:\/[A-Z0-9_]+\/)?[A-Z][A-Z0-9_]*$/.test(item.name) ||
        item.name.length > 40 ||
        !item.version ||
        !/^\d{4}$/.test(item.version) ||
        item.version === '0000' ||
        !item.serviceDefinition,
    ) ||
    new Set(current.services.map((item) => `${item.name}:${item.version}`)).size !== current.services.length
  )
    throw new AdtSafetyError('Publication requires complete, bounded and unambiguous native binding membership.');
  return {
    name: current.name,
    version: selection.version,
    nativeServiceNames: current.services
      .filter((service) => service.version === selection.version)
      .map((service) => service.name!),
    package: current.packageName,
    serviceType: selection.serviceType,
    published: current.published,
    bindingCreated: current.bindingCreated,
    services: current.services,
    publicationHash: current.publicationHash,
  };
}

type Action = 'publish_srvb' | 'unpublish_srvb';

type Resource = Awaited<ReturnType<typeof preflightPinnedPublication>>;

interface Item {
  name: string;
  state:
    | 'not-submitted'
    | 'submitted-unconfirmed'
    | 'native-failed'
    | 'acknowledged-unverified'
    | 'native-state-observed';
  submitted: boolean;
  resource?: Resource;
  nativeStatus?: PublishResult;
  observed?: { published?: boolean; bindingCreated?: boolean; metadataHash: string };
  message?: string;
  statusCode?: number;
}

/** One native-governed binding job. The version selects a binding and never narrows its effects. */
export async function executePinnedPublication(
  original: AdtClient,
  context: PinnedMutationContext,
  raw: Record<string, unknown>,
  recordingProfile: PublicationRecordingProfile,
) {
  let selectedItem: Item | undefined;
  let action: Action | undefined;
  let recording = 'not-established';
  const assertRecording = () => assertPublicationRecording(original.safety, context, recordingProfile);
  const result = (ok: boolean, message?: string) => ({
    ok,
    action,
    state: ok ? 'complete' : selectedItem?.submitted ? 'incomplete' : 'unchanged',
    retryable: false,
    atomic: false,
    recording,
    recordingNote:
      'Native SAP selection/authority governs recording. No CTS receipt or non-recording guarantee; failures may have CTS effects. No automatic CTS compensation.',
    scope:
      'Entire active binding native publication workflow, including branch-dependent registration/access effects; no client or selector-version isolation promise.',
    observations:
      'Native status and metadata are sequential observations. The published getter may reflect test-catalog assignment or a caught-error false value; it does not verify frontend availability, all-alias removal or generated-state absence.',
    submitted: selectedItem?.submitted ? 1 : 0,
    items: selectedItem ? [selectedItem] : [],
    ...(message ? { message } : {}),
  });
  try {
    assertMutationContext(original.safety, context);
    checkOperation(original.safety, OperationType.Activate, 'PinnedPublication');
    if (
      !context.requestPolicy.responseBudget?.countAllResponses ||
      context.requestPolicy.responseBudget.limitBytes > 4 * 1024 * 1024 ||
      context.requestPolicy.deadline > Date.now() + 300_000
    )
      throw new AdtSafetyError(
        'Publication requires a cumulative all-response budget of at most 4 MiB and at most five minutes.',
      );
    const { action: selectedAction, ...input } = raw;
    if (selectedAction !== 'publish_srvb' && selectedAction !== 'unpublish_srvb')
      throw new AdtSafetyError('Select one publication action.');
    action = selectedAction;
    const selection = selectPinnedPublication(input, action);
    if (selection.serviceType !== 'odatav4')
      throw new AdtSafetyError('Only the qualified on-premise V4 profile is implemented.');
    const client = mutationClient(original, context);
    assertRecording();
    recording = 'native-governed-unverified';
    const item: Item = { name: selection.selected.name, state: 'not-submitted', submitted: false };
    selectedItem = item;
    item.resource = await preflightPinnedPublication(client, selection);
    const desired = action === 'publish_srvb';
    const revalidate = async () => {
      assertRecording();
      // Start before native membership reads; never renew this lease after any asynchronous wait.
      const membershipObservedAt = Date.now();
      const freshResource = await preflightPinnedPublication(client, selection);
      if (JSON.stringify(freshResource) !== JSON.stringify(item.resource))
        throw new AdtSafetyError('The complete binding scope changed before submission.');
      const expiresAt = membershipObservedAt + 30_000;
      if (Date.now() >= expiresAt)
        throw new AdtSafetyError('Native binding membership evidence expired during revalidation.');
      assertRecording();
      throwIfRequestCancelled(context.requestPolicy);
      return expiresAt;
    };
    // A matching getter can be a caught-error fallback or test-catalog state. It cannot
    // replace an explicit native job.
    const profile = publicationProfile({
      http: client.http,
      safety: client.safety,
      context,
      job: desired ? 'publishjob' : 'unpublishjob',
      name: selection.selected.name,
      version: selection.version,
      beforeSubmit: revalidate,
      onSubmit: () => {
        item.submitted = true;
        item.state = 'submitted-unconfirmed';
      },
    });
    try {
      item.nativeStatus = await (desired ? publishServiceBinding : unpublishServiceBinding)(
        client.http,
        client.safety,
        selection.selected.name,
        selection.version,
        'odatav4',
        profile,
      );
      if (item.nativeStatus.severity !== 'OK') {
        item.state = 'native-failed';
        return result(false);
      }
      item.state = 'acknowledged-unverified';
      const observed = await readPinnedBinding(client, selection.selected, 'active');
      item.observed = {
        published: observed.published,
        bindingCreated: observed.bindingCreated,
        metadataHash: observed.metadataHash,
      };
      if (
        observed.nativeVersion !== 'active' ||
        observed.inactiveAlternative ||
        observed.publicationHash !== item.resource!.publicationHash ||
        observed.published !== desired ||
        observed.bindingCreated === undefined ||
        (desired && observed.bindingCreated !== true)
      )
        return result(false, 'The acknowledged operation did not have matching active binding/state readback.');
      item.state = 'native-state-observed';
    } catch (error) {
      item.message =
        error instanceof AdtSafetyError
          ? error.message
          : 'Publication evidence or request failed; no replay was attempted.';
      if (error instanceof AdtApiError) item.statusCode = error.statusCode;
      return result(false);
    }
    return result(true);
  } catch (error) {
    return result(
      false,
      error instanceof AdtSafetyError ? error.message : 'Publication preflight could not be verified.',
    );
  }
}
