/** Private single-object package move over the existing two-step refactoring wire contract. */
import type { AdtClient } from './client.js';
import { DataResponseBudget } from './data-result-context.js';
import { AdtApiError, AdtSafetyError } from './errors.js';
import { throwIfRequestCancelled } from './http-deadline.js';
import { mutationClient } from './mutation-client.js';
import { assertMutationContext, type PinnedMutationContext } from './mutation-context.js';
import { type NativeXmlElement, nativeXmlRoot } from './native-xml-evidence.js';
import {
  assertManagedProfileInput,
  assertPinnedSameNamespace,
  isPinnedPhaseRejection,
  normalizePinnedRequest,
  type PinnedManagedResource,
  type PinnedManagedResult,
  pinnedManagedMessage,
  pinnedNativeText,
} from './pinned-managed-resources.js';
import { pinnedPackageSelection, readPinnedPackage } from './pinned-package.js';
import {
  type PinnedRepositoryOwner,
  pinnedRepositoryOwnerByNativeType,
  readPinnedRepositoryOwner,
} from './pinned-repository-owner.js';
import { type PinnedRecording, pinnedRecording, resolvePinnedRequest } from './pinned-write-policy.js';
import { changePackage } from './refactoring.js';
import { checkOperation, OperationType } from './safety.js';

const core = 'http://www.sap.com/adt/core';
const GENERIC = 'http://www.sap.com/adt/refactoring/genericrefactoring';
const CHANGE_PACKAGE = 'http://www.sap.com/adt/refactoring/changepackagerefactoring';

function previewRoot(xml: string): NativeXmlElement {
  // ADT documents both roots for this resource; anything else fails closed.
  if (/<(?:[\w.-]+:)?changePackageRefactoring[\s>]/.test(xml)) {
    const inner = nativeXmlRoot(xml, 'changePackageRefactoring', CHANGE_PACKAGE).child('genericRefactoring', GENERIC);
    if (!inner) throw new AdtSafetyError('The native move preview has no refactoring document.');
    return inner;
  }
  return nativeXmlRoot(xml, 'genericRefactoring', GENERIC);
}

/** SAP's preview must describe exactly the selected object; any expansion stops before execute. */
function assertPreviewScope(xml: string, owner: PinnedRepositoryOwner, from: string, to: string): string {
  const root = previewRoot(xml);
  const affected = root.child('affectedObjects', GENERIC)?.children('affectedObject', GENERIC) ?? [];
  const object = affected[0];
  if (
    affected.length !== 1 ||
    object?.attribute('name', core) !== owner.name ||
    object.attribute('type', core) !== owner.native ||
    object.attribute('uri', core)?.toLowerCase() !== owner.objectUrl.toLowerCase() ||
    object.attribute('packageName', core) !== from
  )
    throw new AdtSafetyError('The native move preview is not limited to the selected object; execute was not sent.');
  const delta = object.child('changePackageDelta', GENERIC);
  if (!delta || pinnedNativeText(delta, 'newPackage', GENERIC) !== to)
    throw new AdtSafetyError('The native move preview names another target package; execute was not sent.');
  if (pinnedNativeText(root, 'adtObjectUri', GENERIC).toLowerCase() !== owner.objectUrl.toLowerCase())
    throw new AdtSafetyError('The native move preview identifies another primary object; execute was not sent.');
  return pinnedNativeText(root, 'transport', GENERIC).trim();
}

export interface PinnedPackageMoveInput {
  objectName: unknown;
  objectType: unknown;
  oldPackage: unknown;
  newPackage: unknown;
  transport?: unknown;
}

export async function movePinnedObjectPackage(
  client: AdtClient,
  context: PinnedMutationContext,
  input: PinnedPackageMoveInput,
): Promise<PinnedManagedResult> {
  let phase = 'validation';
  let state = 'unchanged';
  let statusCode: number | undefined;
  let previewSubmitted = false;
  let resource: PinnedManagedResource | undefined;
  let recording: PinnedRecording | undefined;
  let message: string | undefined;
  try {
    assertMutationContext(client.safety, context);
    if (context.mode !== 'pinned-pp') throw new AdtSafetyError('A pinned mutation context is required.');
    checkOperation(client.safety, OperationType.Update, 'PinnedChangePackage');
    assertManagedProfileInput('package-move', input);
    const owner = pinnedRepositoryOwnerByNativeType(input.objectType, input.objectName);
    const from = pinnedPackageSelection(input.oldPackage, 'oldPackage');
    const to = pinnedPackageSelection(input.newPackage, 'newPackage');
    if (from.name === to.name) throw new AdtSafetyError('The move requires a different target package.');
    assertPinnedSameNamespace(owner.name, to.name, 'A moved object and its target package');
    const requested = normalizePinnedRequest(input.transport);
    resource = { kind: 'repository-object', uri: owner.objectUrl, name: owner.name, nativeType: owner.native };
    const scoped = mutationClient(client, context);
    const options = context.requestPolicy;
    const http = scoped.http;

    const recordingFor = async () => {
      const source = await pinnedRecording(
        http,
        client.safety,
        owner.objectUrl,
        from.name,
        '',
        requested,
        options,
        true,
      );
      const target = await pinnedRecording(http, client.safety, owner.objectUrl, to.name, 'I', requested, options);
      if (!source.local && target.local)
        throw new AdtSafetyError(
          'Moving a recorded object to a local package is refused until its native request handling is qualified.',
        );
      if (!source.local && source.request !== target.request)
        throw new AdtSafetyError('The source and target packages require different CTS requests.');
      return target;
    };
    const assertCurrent = async () => {
      const current = await readPinnedRepositoryOwner(scoped, owner);
      // The caller's value is a staleness check only; authorization used the native package above.
      if (current.packageName !== from.name)
        throw new AdtSafetyError('The object is not in the stated oldPackage; re-read it before moving.');
      await readPinnedPackage(scoped, to);
      return current;
    };

    phase = 'owner-policy';
    throwIfRequestCancelled(options);
    const current = await assertCurrent();
    resource.package = current.packageName;

    phase = 'recording-preflight';
    recording = await recordingFor();
    const expected = recording;

    phase = 'preview';
    throwIfRequestCancelled(options);
    previewSubmitted = true;
    await changePackage(
      http,
      client.safety,
      {
        objectUri: owner.objectUrl,
        objectType: owner.native,
        objectName: owner.name,
        oldPackage: from.name,
        newPackage: to.name,
        description: current.description,
        transport: expected.request,
      },
      async (preview) => {
        phase = 'preview-validation';
        const nativeTransport = assertPreviewScope(preview.body, owner, from.name, to.name);
        if (nativeTransport) {
          if (expected.local)
            throw new AdtSafetyError('SAP selected a CTS request for a local move; execute was not sent.');
          if ((await resolvePinnedRequest(http, client.safety, nativeTransport, options)) !== expected.request)
            throw new AdtSafetyError('SAP selected another CTS request for this move; execute was not sent.');
        }
        phase = 'pre-execute-policy';
        await assertCurrent();
        const fresh = await recordingFor();
        if (fresh.local !== expected.local || fresh.request !== expected.request)
          throw new AdtSafetyError('The recording context changed after the move preview; execute was not sent.');
        phase = 'execute';
        throwIfRequestCancelled(options);
        state = 'move-unconfirmed';
      },
      { responseBudget: new DataResponseBudget(1024 * 1024, 'package-move', true) },
    );

    state = 'move-unverified';
    phase = 'readback';
    const moved = await readPinnedRepositoryOwner(scoped, owner);
    if (moved.packageName !== to.name)
      throw new AdtSafetyError('The object readback does not show the target package.');
    state = 'moved';
    resource.package = moved.packageName;
    return {
      ok: true,
      state,
      phase,
      retryable: false,
      resource,
      recording,
      warnings: [
        'No SAP lock is held across the two refactoring requests: revalidation narrows, but does not close, the window before execute.',
      ],
    };
  } catch (error) {
    if (error instanceof AdtApiError) statusCode = error.statusCode;
    if (phase === 'execute' && isPinnedPhaseRejection(error)) state = 'move-rejected';
    message = pinnedManagedMessage(
      error,
      state === 'unchanged'
        ? 'The move execute step was not sent. Review the reported phase before continuing.'
        : state === 'move-rejected'
          ? 'SAP rejected the move execute step.'
          : 'SAP did not confirm the move. Inspect the object package and do not automatically retry.',
    );
  }
  return {
    ok: false,
    state,
    phase,
    retryable: false,
    ...(resource ? { resource } : {}),
    ...(recording ? { recording } : {}),
    ...(statusCode === undefined ? {} : { statusCode }),
    message,
    // Whether SAP's preview has side effects is unqualified, so a sent preview is reported, not hidden.
    ...(previewSubmitted && state === 'unchanged'
      ? { warnings: ['A move preview request was sent; its native side effects are not yet qualified.'] }
      : {}),
  };
}
