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

export const PINNED_PUBLICATION_BATCH_LIMIT = 10;

const qualificationGap =
  'The current-principal native on-premise branch and client category are not established. No publication job was sent.';

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

/** Not a hidden opt-in: even internal callers cannot claim recording with a boolean or caller-built proof. */
export async function preparePinnedPublication(
  client: AdtClient,
  context: PinnedMutationContext,
  input: Record<string, unknown>,
  action: 'publish_srvb' | 'unpublish_srvb',
) {
  assertMutationContext(client.safety, context);
  if (context.mode !== 'pinned-pp') throw new AdtSafetyError('A pinned mutation context is required.');
  checkOperation(client.safety, OperationType.Activate, 'PinnedPublication');
  const selection = selectPinnedPublication(input, action);
  const scoped = mutationClient(client, context);
  throwIfRequestCancelled(context.requestPolicy);
  const resource = await preflightPinnedPublication(scoped, selection);
  return {
    ok: false as const,
    state: 'unchanged',
    action,
    retryable: false as const,
    resource,
    qualification: 'not-established' as const,
    message: qualificationGap,
    warnings: [
      'Publication changes service availability for other consumers; client-isolated effects have not been established.',
    ],
  };
}

/** Candidate cap only, not a throughput promise. Every selector is validated before any native request. */
export async function preparePinnedPublicationBatch(
  client: AdtClient,
  context: PinnedMutationContext,
  input: Record<string, unknown>,
) {
  assertMutationContext(client.safety, context);
  if (context.mode !== 'pinned-pp') throw new AdtSafetyError('A pinned mutation context is required.');
  checkOperation(client.safety, OperationType.Activate, 'PinnedPublicationBatch');
  assertManagedProfileInput('binding-publication-batch', input);
  const action = input.action;
  if (action !== 'publish_srvb' && action !== 'unpublish_srvb')
    throw new AdtSafetyError('Select one publication action for the batch.');
  if (
    !Array.isArray(input.bindings) ||
    input.bindings.length < 1 ||
    input.bindings.length > PINNED_PUBLICATION_BATCH_LIMIT
  )
    throw new AdtSafetyError('A private publication batch contains 1–10 exact binding selections.');
  const selections = input.bindings.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new AdtSafetyError('Each binding selection must be an object.');
    return selectPinnedPublication(value as Record<string, unknown>, action);
  });
  if (new Set(selections.map((s) => s.selected.name)).size !== selections.length)
    throw new AdtSafetyError('Duplicate binding selections are not allowed.');
  const scoped = mutationClient(client, context);
  const resources = [];
  for (const selection of selections) {
    throwIfRequestCancelled(context.requestPolicy);
    resources.push(await preflightPinnedPublication(scoped, selection));
  }
  return {
    ok: false as const,
    state: 'unchanged',
    retryable: false as const,
    resources,
    qualification: 'not-established' as const,
    message: qualificationGap,
    submitted: 0,
  };
}

/** Supplied by trusted internal native evidence collection for this exact request/client, never tool arguments.
 * The reader must establish both native branch inputs and T000 category for the current SAP principal.
 * System labels, release guesses, source capture alone and an LLM assertion do not implement this interface. */
export interface PublicationConfiguration {
  contract: 'sap-basis-758-onprem-v4-local';
  target: string;
  client: string;
  principal: string;
  systemCloud: boolean;
  userCloud: boolean;
  clientCategory: string;
  observedAt: number;
}

export type PublicationConfigurationReader = (
  client: AdtClient,
  context: PinnedMutationContext,
) => Promise<PublicationConfiguration>;

type Action = 'publish_srvb' | 'unpublish_srvb';

type Resource = Awaited<ReturnType<typeof preflightPinnedPublication>>;

interface Item {
  name: string;
  state:
    | 'not-submitted'
    | 'submitted-unconfirmed'
    | 'native-failed'
    | 'acknowledged-unverified'
    | 'confirmed'
    | 'native-state-observed';
  submitted: boolean;
  resource?: Resource;
  nativeStatus?: PublishResult;
  observed?: { published?: boolean; bindingCreated?: boolean; metadataHash: string };
  message?: string;
  statusCode?: number;
}

async function configuration(
  client: AdtClient,
  context: PinnedMutationContext,
  reader: PublicationConfigurationReader,
) {
  throwIfRequestCancelled(context.requestPolicy);
  const value = await reader(client, context);
  throwIfRequestCancelled(context.requestPolicy);
  if (
    value?.contract !== 'sap-basis-758-onprem-v4-local' ||
    value.target !== context.recordingPolicy.target ||
    value.client !== client.sapClient ||
    !/^[A-Z0-9_]{1,12}$/.test(value.principal) ||
    value.systemCloud !== false ||
    value.userCloud !== false ||
    !/^[A-Z]$/.test(value.clientCategory) ||
    value.clientCategory === 'C' ||
    !Number.isFinite(value.observedAt) ||
    value.observedAt > Date.now() ||
    Date.now() - value.observedAt > 30_000
  )
    throw new AdtSafetyError(
      'The current-principal native V4 branch/client-category evidence is missing, stale or unsupported.',
    );
  return Object.freeze({ ...value });
}

/** Internal batch only: one reference per POST; the requested version selects a binding, never narrows its effects. */
export async function executePinnedPublicationBatch(
  original: AdtClient,
  context: PinnedMutationContext,
  raw: Record<string, unknown>,
  qualification?: PublicationConfigurationReader | PublicationRecordingProfile,
) {
  const items: Item[] = [];
  let action: Action | undefined;
  let recording = 'not-established';
  const reader = typeof qualification === 'function' ? qualification : undefined;
  const governed = qualification && typeof qualification === 'object' ? qualification : undefined;
  const assertRecording = () => {
    if (governed) assertPublicationRecording(original.safety, context, governed);
  };
  const result = (ok: boolean, message?: string) => ({
    ok,
    action,
    state: ok ? 'complete' : items.some((item) => item.submitted) ? 'incomplete' : 'unchanged',
    retryable: false,
    atomic: false,
    recording,
    ...(governed
      ? {
          recordingNote:
            'Native SAP selection/authority governs recording. No CTS receipt or non-recording guarantee; failures may have CTS effects. No automatic CTS compensation.',
        }
      : {}),
    scope: governed
      ? 'Entire active binding native publication workflow, including branch-dependent registration/access effects; no client or selector-version isolation promise.'
      : 'Entire active binding/group, all aliases and consumers; no client or version isolation promise.',
    observations: governed
      ? 'Native status and metadata are sequential observations. The published getter may reflect test-catalog assignment or a caught-error false value; it does not verify frontend availability, all-alias removal or generated-state absence.'
      : 'Native status and subsequent metadata are observed sequentially, not an atomic snapshot or exhaustive generated-state absence proof.',
    submitted: items.filter((item) => item.submitted).length,
    items,
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
    assertManagedProfileInput('binding-publication-batch', raw);
    if (raw.action !== 'publish_srvb' && raw.action !== 'unpublish_srvb')
      throw new AdtSafetyError('Select one publication action.');
    action = raw.action;
    if (!Array.isArray(raw.bindings) || !raw.bindings.length || raw.bindings.length > PINNED_PUBLICATION_BATCH_LIMIT)
      throw new AdtSafetyError('Select 1–10 exact service bindings.');
    const selections = raw.bindings.map((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new AdtSafetyError('Each selection must be an object.');
      const selected = selectPinnedPublication(value as Record<string, unknown>, action!);
      if (selected.serviceType !== 'odatav4')
        throw new AdtSafetyError('Only the qualified on-premise V4 profile is implemented.');
      return selected;
    });
    if (new Set(selections.map((selection) => selection.selected.name)).size !== selections.length)
      throw new AdtSafetyError('A binding may appear only once, including across versions.');
    if (!reader && !governed)
      throw new AdtSafetyError('No trusted current-principal native configuration reader is installed.');
    const client = mutationClient(original, context);
    assertRecording();
    const initial = reader ? await configuration(client, context, reader) : undefined;
    recording = governed ? 'native-governed-unverified' : 'native-onprem-local-no-recording';
    items.push(
      ...selections.map((selection) => ({
        name: selection.selected.name,
        state: 'not-submitted' as const,
        submitted: false,
      })),
    );
    // All owners/packages/memberships must pass before the first mutation.
    for (const [index, selection] of selections.entries()) {
      items[index]!.resource = await preflightPinnedPublication(client, selection);
    }
    for (const [index, selection] of selections.entries()) {
      const item = items[index]!,
        desired = action === 'publish_srvb';
      const revalidate = async () => {
        assertRecording();
        // Start before native membership reads; never renew this lease after any asynchronous wait.
        const membershipObservedAt = Date.now();
        const fresh = reader ? await configuration(client, context, reader) : undefined;
        if (fresh && (fresh.principal !== initial!.principal || fresh.clientCategory !== initial!.clientCategory))
          throw new AdtSafetyError('The publication principal/configuration changed.');
        const freshResource = await preflightPinnedPublication(client, selection);
        if (JSON.stringify(freshResource) !== JSON.stringify(item.resource))
          throw new AdtSafetyError('The complete binding scope changed before submission.');
        const expiresAt = (fresh?.observedAt ?? membershipObservedAt) + 30_000;
        if (Date.now() >= expiresAt)
          throw new AdtSafetyError(
            fresh
              ? 'Native configuration evidence expired during binding revalidation.'
              : 'Native binding membership evidence expired during revalidation.',
          );
        assertRecording();
        throwIfRequestCancelled(context.requestPolicy);
        return expiresAt;
      };
      // A matching getter can be a caught-error fallback or test-catalog state. It cannot
      // replace an explicit native job, even under the distinct non-recording profile.
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
        item.state = governed ? 'native-state-observed' : 'confirmed';
      } catch (error) {
        item.message =
          error instanceof AdtSafetyError
            ? error.message
            : 'Publication evidence or request failed; no replay was attempted.';
        if (error instanceof AdtApiError) item.statusCode = error.statusCode;
        return result(false);
      }
    }
    return result(true);
  } catch (error) {
    return result(
      false,
      error instanceof AdtSafetyError ? error.message : 'Publication preflight could not be verified.',
    );
  }
}
