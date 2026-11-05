/** Private API-release state change over the existing narrow GET → PUT → GET contract. */
import { createHash } from 'node:crypto';
import { API_RELEASE_VISIBILITIES, type ApiReleaseVisibility, setApiReleaseState } from './api-release.js';
import type { AdtClient } from './client.js';
import { DataResponseBudget } from './data-result-context.js';
import { AdtApiError, AdtSafetyError } from './errors.js';
import { throwIfRequestCancelled } from './http-deadline.js';
import { mutationClient } from './mutation-client.js';
import { assertMutationContext, type PinnedMutationContext } from './mutation-context.js';
import { nativeXmlRoot } from './native-xml-evidence.js';
import {
  assertManagedProfileInput,
  isPinnedPhaseRejection,
  normalizePinnedRequest,
  type PinnedManagedResource,
  type PinnedManagedResult,
  pinnedManagedMessage,
} from './pinned-managed-resources.js';
import {
  pinnedFunctionSelection,
  pinnedRepositoryOwner,
  readPinnedFunctionOwner,
  readPinnedRepositoryOwner,
} from './pinned-repository-owner.js';
import { type PinnedRecording, pinnedRecording } from './pinned-write-policy.js';
import { checkOperation, OperationType } from './safety.js';

const ARS = 'http://www.sap.com/adt/ars';
const core = 'http://www.sap.com/adt/core';
const ACCEPT = 'application/vnd.sap.adt.apirelease.v10+xml';
const API_RELEASE_TYPES = ['CLAS', 'INTF', 'DDLS', 'DCLS', 'BDEF', 'SRVD', 'FUNC'];

export interface PinnedApiReleaseInput {
  type: unknown;
  name: unknown;
  group?: unknown;
  contract: unknown;
  apiState: unknown;
  /** Native state read by the caller: no ETag or lock contract protects this document. */
  expectedCurrentState: unknown;
  apiVisibility?: unknown;
  transport?: unknown;
}

function selectOwner(input: PinnedApiReleaseInput, scoped: AdtClient) {
  if (typeof input.type !== 'string' || !API_RELEASE_TYPES.includes(input.type))
    throw new AdtSafetyError('This repository type has no reviewed private API-release profile.');
  if (input.type === 'FUNC') {
    const selected = pinnedFunctionSelection('FUNC', input.name, input.group);
    return {
      uri: selected.objectUrl,
      name: selected.name,
      native: 'FUGR/FF',
      read: async () => {
        const owner = await readPinnedFunctionOwner(scoped, selected.objectUrl);
        if (!owner) throw new AdtSafetyError('The native function module owner could not be verified.');
        return owner.packageName;
      },
    };
  }
  if (input.group !== undefined) throw new AdtSafetyError('This API-release type cannot select a function group.');
  const owner = pinnedRepositoryOwner(input.type, input.name);
  return {
    uri: owner.objectUrl,
    name: owner.name,
    native: owner.native,
    read: async () => (await readPinnedRepositoryOwner(scoped, owner)).packageName,
  };
}

function selectVisibility(value: unknown, state: string): ApiReleaseVisibility | undefined {
  if (value === undefined) return undefined;
  if (
    state !== 'RELEASED' ||
    !Array.isArray(value) ||
    value.some((entry) => !API_RELEASE_VISIBILITIES.includes(entry)) ||
    new Set(value).size !== value.length
  )
    throw new AdtSafetyError('apiVisibility is a unique, complete selection and requires apiState RELEASED.');
  return value as ApiReleaseVisibility;
}

/** The document must name the selected object, and its APIS record must belong to the owner's package. */
function assertReleaseDocument(
  xml: string,
  owner: { uri: string; name: string; native: string },
  contract: string,
  pkg: string,
  expectedState: string,
): string {
  const root = nativeXmlRoot(xml, 'apiRelease', ARS);
  const releasable = root.child('releasableObject', ARS);
  if (
    releasable?.attribute('name', core) !== owner.name ||
    releasable.attribute('type', core) !== owner.native ||
    releasable.attribute('uri', core)?.toLowerCase() !== owner.uri.toLowerCase()
  )
    throw new AdtSafetyError('The native API-release document does not identify the selected object.');
  const block = root.child(`c${contract.slice(1)}Release`, ARS);
  if (!block) throw new AdtSafetyError('The native API-release document omits the selected contract.');
  {
    const current = block.child('status', ARS)?.attribute('state', ARS);
    if (current !== expectedState)
      throw new AdtSafetyError('The contract state differs from expectedCurrentState; re-read it first.');
    const record = block.child('transportObject', ARS);
    const recordPackage = record?.attribute('packageName', core);
    const name = record?.attribute('name', core);
    const uri = record?.attribute('uri', core);
    const nativeType = owner.native === 'FUGR/FF' ? 'FUNC' : owner.native.split('/')[0];
    if (
      recordPackage !== pkg ||
      record?.attribute('type', core) !== 'APIS' ||
      !name ||
      !name.startsWith(`${owner.name} `) ||
      name.trimEnd().slice(owner.name.length).trim() !== nativeType ||
      uri !== `/sap/bc/adt/apireleases/apis/${encodeURIComponent(name)}`
    )
      throw new AdtSafetyError(
        'The native API-release recording resource is not bound to the verified owner and package.',
      );
    return uri;
  }
}

export interface PinnedApiReleaseResult extends PinnedManagedResult {
  contract?: string;
  apiState?: string;
  changed?: boolean;
  visibilitySelection?: 'explicit-complete' | 'native-defaults' | 'not-applicable';
  visibility?: { cloudDevelopment: boolean; keyUserApps: boolean };
}

export async function setPinnedApiReleaseState(
  client: AdtClient,
  context: PinnedMutationContext,
  input: PinnedApiReleaseInput,
): Promise<PinnedApiReleaseResult> {
  let phase = 'validation';
  let state = 'unchanged';
  let statusCode: number | undefined;
  let resource: PinnedManagedResource | undefined;
  let recording: PinnedRecording | undefined;
  let message: string | undefined;
  let contract: string | undefined;
  let target: string | undefined;
  let changed: boolean | undefined;
  try {
    assertMutationContext(client.safety, context);
    if (context.mode !== 'pinned-pp') throw new AdtSafetyError('A pinned mutation context is required.');
    checkOperation(client.safety, OperationType.Update, 'PinnedSetApiState');
    assertManagedProfileInput('api-release-state', input);
    if (input.apiState !== 'RELEASED' && input.apiState !== 'NOT_RELEASED')
      throw new AdtSafetyError('apiState must be explicitly RELEASED or NOT_RELEASED.');
    target = input.apiState;
    if (typeof input.contract !== 'string' || !/^C[0-4]$/.test(input.contract))
      throw new AdtSafetyError('An explicit release contract C0–C4 is required.');
    contract = input.contract;
    if (typeof input.expectedCurrentState !== 'string' || !/^[A-Z_]{1,40}$/.test(input.expectedCurrentState))
      throw new AdtSafetyError('Read the current contract state and supply expectedCurrentState.');
    const expectedState = input.expectedCurrentState;
    const visibility = selectVisibility(input.apiVisibility, target);
    const requested = normalizePinnedRequest(input.transport);
    const scoped = mutationClient(client, context);
    const options = context.requestPolicy;
    const owner = selectOwner(input, scoped);
    resource = { kind: 'api-release', uri: owner.uri, name: owner.name, nativeType: owner.native };

    phase = 'owner-policy';
    throwIfRequestCancelled(options);
    const pkg = await owner.read();
    resource.package = pkg;

    const selectedContract = contract;
    let recordUri: string | undefined;
    const documentPath = `/sap/bc/adt/apireleases/${encodeURIComponent(owner.uri)}`;
    const digest = (xml: string) => createHash('sha256').update(xml).digest('hex');
    const writeOptions = {
      state: target,
      contract,
      transport: undefined as string | undefined,
      ...(visibility === undefined ? {} : { visibility }),
    };

    phase = 'state-read';
    const result = await setApiReleaseState(scoped.http, owner.uri, writeOptions, {
      requestOptions: { responseBudget: new DataResponseBudget(3 * 1024 * 1024, 'api-release-operation', true) },
      beforeBuild: (xml) => {
        phase = 'contract-selection';
        recordUri = assertReleaseDocument(xml, owner, selectedContract, pkg, expectedState);
        const behaviour = nativeXmlRoot(xml, 'apiRelease', ARS)
          .child('behaviour', ARS)
          ?.child(`c${selectedContract.slice(1)}Release`, ARS);
        if (behaviour?.attribute('create', ARS) !== 'true' && behaviour?.attribute('update', ARS) !== 'true')
          throw new AdtSafetyError('The native contract does not permit creation or update.');
      },
      beforePut: async (xml) => {
        phase = 'pre-submit-policy';
        throwIfRequestCancelled(options);
        if ((await owner.read()) !== pkg)
          throw new AdtSafetyError('The owner package changed since API-release preflight.');
        if (!recordUri) throw new AdtSafetyError('Missing native API-release recording resource.');
        recording = await pinnedRecording(scoped.http, client.safety, recordUri, pkg, '', requested, options);
        // setApiReleaseState reads this property when it constructs the PUT URL, after this callback.
        writeOptions.transport = recording.request;
        const again = await scoped.http.get(
          documentPath,
          { Accept: ACCEPT, 'Cache-Control': 'no-cache' },
          { responseBudget: new DataResponseBudget(1024 * 1024, 'api-release-document', true) },
        );
        if (digest(again.body) !== digest(xml))
          throw new AdtSafetyError('The API-release document changed during preflight; no PUT was sent.');
        phase = 'state-change';
        throwIfRequestCancelled(options);
        state = 'state-change-unconfirmed';
      },
      afterPut: (noted) => {
        changed = noted;
        phase = 'readback';
      },
      validateReadback: (xml) => assertReleaseDocument(xml, owner, selectedContract, pkg, input.apiState as string),
    });
    state = result.changed ? 'state-changed' : 'already-in-state';
    const confirmed = result.contracts.find((entry) => entry.contract.toUpperCase() === contract);
    return {
      ok: true,
      state,
      phase,
      retryable: false,
      resource,
      recording,
      contract,
      apiState: confirmed?.state,
      changed: result.changed,
      visibilitySelection:
        target !== 'RELEASED' ? 'not-applicable' : visibility === undefined ? 'native-defaults' : 'explicit-complete',
      visibility: {
        cloudDevelopment: confirmed?.useInSAPCloudPlatform === true,
        keyUserApps: confirmed?.useInKeyUserApps === true,
      },
      warnings: [
        'SAP service consumers and other clients can observe this contract state. No lock protects the document; state and document checks narrow the window only.',
      ],
    };
  } catch (error) {
    if (error instanceof AdtApiError) statusCode = error.statusCode;
    if (phase === 'state-change' && isPinnedPhaseRejection(error)) state = 'state-change-rejected';
    // The builder's own refusals name only contract options; every other non-policy error text stays internal.
    const refusal =
      phase === 'contract-selection' && !(error instanceof AdtApiError) && error instanceof Error
        ? new AdtSafetyError(error.message)
        : error;
    message = pinnedManagedMessage(
      refusal,
      state === 'unchanged'
        ? 'No API-release PUT was sent. Review the reported phase before continuing.'
        : state === 'state-change-rejected'
          ? 'SAP rejected the API-release state change.'
          : 'SAP did not confirm the API-release result. Read the API state and do not automatically retry.',
    );
  }
  return {
    ok: false,
    state,
    phase,
    retryable: false,
    ...(resource ? { resource } : {}),
    ...(recording ? { recording } : {}),
    ...(contract ? { contract } : {}),
    ...(target ? { apiState: target } : {}),
    ...(changed === undefined ? {} : { changed }),
    ...(statusCode === undefined ? {} : { statusCode }),
    message,
  };
}
