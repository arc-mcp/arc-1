/** Private package create/delete over shared request, recording and owning-session boundaries. */
import type { AdtClient } from './client.js';
import { createObject } from './crud.js';
import { DataResponseBudget } from './data-result-context.js';
import { buildPackageXml } from './ddic-xml.js';
import { AdtApiError, AdtSafetyError } from './errors.js';
import { throwIfRequestCancelled } from './http-deadline.js';
import { mutationClient } from './mutation-client.js';
import { assertMutationContext, type PinnedMutationContext } from './mutation-context.js';
import { nativeXmlRoot, readNativeMetadata } from './native-xml-evidence.js';
import { PackageTreeNoEvidenceError } from './package-browser.js';
import type { PackageHierarchyResolver } from './package-hierarchy.js';
import { deletePinnedOwner, type PinnedDeleteResult } from './pinned-delete.js';
import {
  assertManagedProfileInput,
  assertPinnedSameNamespace,
  isPinnedNativeAbsence,
  isPinnedPhaseRejection,
  normalizePinnedRequest,
  type PinnedManagedResource,
  type PinnedManagedResult,
  pinnedDescription,
  pinnedManagedMessage,
} from './pinned-managed-resources.js';
import { assertPinnedLocalRootProfile, type PinnedLocalRootProfile } from './pinned-package-root-profile.js';
import { type PinnedRecording, pinnedRecording } from './pinned-write-policy.js';
import { checkOperation, checkPackage, OperationType } from './safety.js';

const core = 'http://www.sap.com/adt/core';
const PACKAGES = 'http://www.sap.com/adt/packages';
const PACKAGE_COLLECTION = '/sap/bc/adt/packages';
const PACKAGE_NAME = /^(?:\/[A-Z0-9_]{1,10}\/[A-Z0-9_]+|\$[A-Z0-9_]+|[A-Z][A-Z0-9_]*)$/;
const NATIVE_COMPONENT = /^(?:\/[A-Z0-9_]{1,10}\/)?[A-Z0-9_$]{1,30}$/;
// $TMP is a protected display anchor, not evidence of ancestry for another local package.
const RESERVED_PACKAGES = new Set(['$TMP']);

export interface PinnedPackageSelection {
  name: string;
  objectUrl: string;
}

export function pinnedPackageSelection(name: unknown, label = 'Package'): PinnedPackageSelection {
  if (typeof name !== 'string' || name.length > 30 || !PACKAGE_NAME.test(name))
    throw new AdtSafetyError(`${label} must be one uppercase native package name, maximum 30 characters.`);
  return { name, objectUrl: `${PACKAGE_COLLECTION}/${encodeURIComponent(name)}` };
}

export interface PinnedPackageEvidence extends PinnedPackageSelection {
  description?: string;
  responsible?: string;
  superPackage?: string;
  softwareComponent?: string;
  transportLayer?: string;
  packageType?: string;
  recordChanges?: string;
}

/** Fresh native package identity; both package policies apply to the package named by SAP. */
export async function readPinnedPackage(
  client: AdtClient,
  selected: PinnedPackageSelection,
): Promise<PinnedPackageEvidence> {
  checkOperation(client.safety, OperationType.Read, 'PinnedPackageEvidence');
  const response = await readNativeMetadata(
    client.http,
    selected.objectUrl,
    'package-metadata',
    undefined,
    'application/*',
  );
  const root = nativeXmlRoot(response.body, 'package', PACKAGES, true);
  const self = root.child('packageRef', core);
  if (
    root.attribute('name', core) !== selected.name ||
    root.attribute('type', core) !== 'DEVC/K' ||
    (self && self.attribute('name', core) !== selected.name)
  )
    throw new AdtSafetyError('The native package identity could not be verified.');
  await checkPackage(client.safety, selected.name, client.getPackageHierarchyResolver());
  const attributes = root.child('attributes', PACKAGES);
  const transport = root.child('transport', PACKAGES);
  const parent = root.child('superPackage', PACKAGES);
  let superPackage = parent?.attribute('name', core);
  if (parent && superPackage === undefined) {
    // SAP serializes an initial parent reference as an empty element, not necessarily name="".
    // Only this exact present-empty shape qualifies; missing or other nameless content stays unknown.
    const content = parent.canonicalValue({});
    if (!Array.isArray(content) || content.length !== 0)
      throw new AdtSafetyError('The native package parent reference is not explicitly empty.');
    superPackage = '';
  }
  return {
    ...selected,
    description: root.attribute('description', core),
    responsible: root.attribute('responsible', core),
    superPackage,
    softwareComponent: transport?.child('softwareComponent', PACKAGES)?.attribute('name', PACKAGES) || undefined,
    transportLayer: transport?.child('transportLayer', PACKAGES)?.attribute('name', PACKAGES),
    packageType: attributes?.attribute('packageType', PACKAGES),
    recordChanges: attributes?.attribute('recordChanges', PACKAGES),
  };
}

/** A not-yet-existing child is inside a subtree rule only through its verified parent. */
function futureChildResolver(name: string, parent: string, actual: PackageHierarchyResolver): PackageHierarchyResolver {
  return {
    isDescendantOrSelf: (root, pkg) => actual.isDescendantOrSelf(root, pkg.toUpperCase() === name ? parent : pkg),
    invalidate: (root) => actual.invalidate(root),
  };
}

function isLocalPackageName(name: string): boolean {
  return name.startsWith('$');
}

export interface PinnedPackageCreateInput {
  name: unknown;
  description: unknown;
  superPackage?: unknown;
  responsible: unknown;
  softwareComponent?: unknown;
  transportLayer?: unknown;
  packageType?: unknown;
  recordChanges?: unknown;
  transport?: unknown;
}

function validateCreate(input: PinnedPackageCreateInput, cloud: boolean) {
  assertManagedProfileInput('package-create', input);
  const selected = pinnedPackageSelection(input.name);
  if (RESERVED_PACKAGES.has(selected.name))
    throw new AdtSafetyError('This private profile does not create the reserved $TMP package.');
  const parent =
    input.superPackage === undefined ? undefined : pinnedPackageSelection(input.superPackage, 'superPackage');
  if (parent) {
    if (parent.name === '$TMP')
      throw new AdtSafetyError('The private profile does not use the $TMP display anchor as package ancestry.');
    if (parent.name === selected.name) throw new AdtSafetyError('A package cannot be its own superPackage.');
    if (isLocalPackageName(selected.name) !== isLocalPackageName(parent.name))
      throw new AdtSafetyError('Local $ packages and transportable packages cannot be nested in each other.');
    assertPinnedSameNamespace(selected.name, parent.name, 'A package and its superPackage');
  } else if (cloud || !isLocalPackageName(selected.name))
    throw new AdtSafetyError('Only a private on-premise LOCAL development root may omit its superPackage.');
  const description = pinnedDescription(input.description, 'Package creation');
  // Explicit on every platform: SAP validates that this user exists, not that it is the acting identity.
  if (typeof input.responsible !== 'string' || !/^[A-Z0-9_]{1,12}$/.test(input.responsible))
    throw new AdtSafetyError(
      'Package creation requires an explicit native SAP user as person-responsible; a mapped IdP identity is never derived.',
    );
  const text = (value: unknown, label: string) => {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !NATIVE_COMPONENT.test(value))
      throw new AdtSafetyError(`${label} must be one uppercase native name.`);
    return value;
  };
  const softwareComponent = text(input.softwareComponent, 'softwareComponent');
  const transportLayer = text(input.transportLayer, 'transportLayer');
  if (input.recordChanges !== undefined && typeof input.recordChanges !== 'boolean')
    throw new AdtSafetyError('recordChanges must be a boolean when provided.');
  if (
    input.packageType !== undefined &&
    input.packageType !== 'development' &&
    input.packageType !== 'structure' &&
    input.packageType !== 'main'
  )
    throw new AdtSafetyError('packageType must be development, structure or main.');
  const requested = normalizePinnedRequest(input.transport);
  if (isLocalPackageName(selected.name)) {
    if ((softwareComponent && softwareComponent !== 'LOCAL') || transportLayer || input.recordChanges === true)
      throw new AdtSafetyError('A local $ package cannot select a transport layer, recording or another component.');
    if (requested) throw new AdtSafetyError('A local $ package must not specify a CTS request/task.');
    if (input.packageType !== undefined && input.packageType !== 'development')
      throw new AdtSafetyError('The private local package profile supports development packages only.');
  } else if (!cloud && !softwareComponent)
    throw new AdtSafetyError('A transportable on-premise package requires an explicit softwareComponent.');
  return {
    selected,
    parent,
    description,
    responsible: input.responsible,
    softwareComponent: isLocalPackageName(selected.name) ? 'LOCAL' : softwareComponent,
    transportLayer: isLocalPackageName(selected.name) ? '' : transportLayer,
    packageType: (isLocalPackageName(selected.name) ? 'development' : input.packageType) as
      | 'development'
      | 'structure'
      | 'main'
      | undefined,
    recordChanges: isLocalPackageName(selected.name) ? false : (input.recordChanges as boolean | undefined),
    requested,
  };
}

export async function createPinnedPackage(
  client: AdtClient,
  context: PinnedMutationContext,
  input: PinnedPackageCreateInput,
  environment: { cloud: boolean; abapRelease?: string },
  rootProfile?: PinnedLocalRootProfile,
): Promise<PinnedManagedResult> {
  let phase = 'validation';
  let state = 'unchanged';
  let statusCode: number | undefined;
  let resource: PinnedManagedResource | undefined;
  let recording: PinnedManagedResult['recording'];
  let recordingNote: string | undefined;
  let message: string | undefined;
  try {
    assertMutationContext(client.safety, context);
    if (context.mode !== 'pinned-pp') throw new AdtSafetyError('A pinned mutation context is required.');
    checkOperation(client.safety, OperationType.Create, 'PinnedCreatePackage');
    const valid = validateCreate(input, environment.cloud);
    const { selected, parent } = valid;
    if (!parent) {
      if (environment.cloud || environment.abapRelease !== '758')
        throw new AdtSafetyError('Private LOCAL root coverage is on-premise 758 only.');
      assertPinnedLocalRootProfile(client, context, selected.name, rootProfile);
      recording = 'native-governed-unverified';
      recordingNote =
        'SAP governs optional recording. No request/task or no-recording receipt is verified; submitted failures may include CTS/directory effects. No automatic retry or compensation.';
    } else if (rootProfile) throw new AdtSafetyError('A LOCAL root profile cannot select a child package.');
    resource = { kind: 'package', uri: selected.objectUrl, name: selected.name, nativeType: 'DEVC/K' };
    const scoped = mutationClient(client, context);
    const options = context.requestPolicy;

    phase = 'target-absence';
    throwIfRequestCancelled(options);
    let absent = false;
    try {
      await scoped.http.get(
        selected.objectUrl,
        { Accept: 'application/*', 'Cache-Control': 'no-cache' },
        { responseBudget: new DataResponseBudget(1024 * 1024, 'package-absence', true) },
      );
    } catch (error) {
      if (!isPinnedNativeAbsence(error)) throw error;
      absent = true;
    }
    if (!absent) throw new AdtSafetyError('The selected package already exists; no POST was sent.');

    let verifiedRecording: PinnedRecording | undefined;
    if (parent) {
      phase = 'parent-policy';
      const parentEvidence = await readPinnedPackage(scoped, parent);
      if (
        isLocalPackageName(selected.name) &&
        (parentEvidence.softwareComponent !== 'LOCAL' ||
          parentEvidence.recordChanges !== 'false' ||
          parentEvidence.transportLayer !== '' ||
          parentEvidence.packageType !== 'development')
      )
        throw new AdtSafetyError(
          'The actual local parent must be a non-recording LOCAL development package with no transport layer.',
        );
      await checkPackage(
        client.safety,
        selected.name,
        futureChildResolver(selected.name, parentEvidence.name, scoped.getPackageHierarchyResolver()),
      );
      phase = 'recording-preflight';
      verifiedRecording = await pinnedRecording(
        scoped.http,
        client.safety,
        selected.objectUrl,
        parentEvidence.name,
        'I',
        valid.requested,
        options,
      );
      if (isLocalPackageName(selected.name) && !verifiedRecording.local)
        throw new AdtSafetyError('SAP reports recording for a local $ package parent.');
      recording = verifiedRecording;
    } else assertPinnedLocalRootProfile(client, context, selected.name, rootProfile);

    phase = 'create';
    throwIfRequestCancelled(options);
    state = 'creation-unconfirmed';
    await createObject(
      scoped.http,
      client.safety,
      PACKAGE_COLLECTION,
      buildPackageXml({
        name: selected.name,
        description: valid.description,
        superPackage: parent?.name,
        softwareComponent: valid.softwareComponent,
        transportLayer: valid.transportLayer,
        recordChanges: valid.recordChanges,
        packageType: valid.packageType,
        responsible: valid.responsible,
        cloud: environment.cloud,
      }),
      'application/*',
      verifiedRecording?.request,
      undefined,
      environment.abapRelease,
    );

    state = 'created-unverified';
    phase = 'readback';
    const created = await readPinnedPackage(scoped, selected);
    if (!parent) assertPinnedLocalRootProfile(client, context, selected.name, rootProfile);
    if (created.superPackage !== (parent?.name ?? ''))
      throw new AdtSafetyError('SAP did not assign the created package to the requested superPackage.');
    for (const [actual, expected] of [
      [created.description, valid.description],
      [created.responsible, valid.responsible],
      [created.softwareComponent, valid.softwareComponent],
      [created.transportLayer, valid.transportLayer],
      [created.packageType, valid.packageType],
      [created.recordChanges, valid.recordChanges === undefined ? undefined : String(valid.recordChanges)],
    ])
      if (expected !== undefined && actual !== expected)
        throw new AdtSafetyError('The created package does not match the requested attributes.');
    state = 'created';
    resource.package = selected.name;
    return {
      ok: true,
      state,
      phase,
      retryable: false,
      resource,
      recording,
      ...(recordingNote ? { recordingNote } : {}),
      warnings: [
        'The person-responsible is a native attribute, not the acting identity. Package creation is a cross-client repository change.',
      ],
    };
  } catch (error) {
    if (error instanceof AdtApiError) statusCode = error.statusCode;
    if (!rootProfile && phase === 'create' && isPinnedPhaseRejection(error) && error.creationOutcome !== 'unknown')
      state = 'creation-rejected';
    message = pinnedManagedMessage(
      error,
      state === 'unchanged'
        ? 'No package POST was sent. Review the reported phase before continuing.'
        : state === 'creation-rejected'
          ? 'SAP rejected the package creation.'
          : 'SAP did not confirm the complete package creation. A created package may remain; inspect it and do not automatically retry.',
    );
  }
  return {
    ok: false,
    state,
    phase,
    retryable: false,
    ...(resource ? { resource } : {}),
    ...(recording ? { recording } : {}),
    ...(recordingNote ? { recordingNote } : {}),
    ...(statusCode === undefined ? {} : { statusCode }),
    message,
  };
}

/** The current browser can prove content, but cannot prove completeness/emptiness for deletion. */
async function refuseKnownPackageContents(client: AdtClient, name: string): Promise<void> {
  try {
    const { objects } = await client.getDirectPackageContents(name, 1);
    if (objects.length)
      throw new AdtSafetyError('The native package tree still lists content; no package DELETE was sent.');
  } catch (error) {
    if (!(error instanceof PackageTreeNoEvidenceError)) throw error;
  }
  // No result is an emptiness proof. The source-backed native DELETE checks contents,
  // subpackages and interfaces without recursively deleting them at the executing operation.
}

export interface PinnedPackageDeleteResult extends PinnedDeleteResult {
  resource?: PinnedManagedResource;
  /** Selected eligibility contract, not a claim that a refused request reached its content check. */
  contentEvidence?: 'native-delete-contract';
  recording?: PinnedRecording;
}

export async function deletePinnedPackage(
  client: AdtClient,
  context: PinnedMutationContext,
  input: { name: unknown; transport?: unknown },
  environment: { cloud: boolean; abapRelease?: string },
): Promise<PinnedPackageDeleteResult> {
  let selected: PinnedPackageSelection;
  let recording: PinnedRecording | undefined;
  try {
    assertMutationContext(client.safety, context);
    if (
      !context.requestPolicy.responseBudget?.countAllResponses ||
      context.requestPolicy.responseBudget.limitBytes > 8 * 1024 * 1024
    )
      throw new AdtSafetyError('Private package DELETE requires a shared all-response budget of at most 8 MiB.');
    // Internal candidate coverage selector, not a feature probe or native qualification grant.
    if (environment?.cloud !== false || environment.abapRelease !== '758')
      throw new AdtSafetyError('The private local package DELETE candidate is limited to on-premise ABAP 758.');
    assertManagedProfileInput('package-delete', input);
    selected = pinnedPackageSelection(input.name);
    if (RESERVED_PACKAGES.has(selected.name))
      throw new AdtSafetyError('The reserved local package root cannot be deleted.');
    if (input.transport !== undefined)
      throw new AdtSafetyError('The private local package DELETE profile must not select a CTS request/task.');
  } catch (error) {
    return {
      ok: false,
      state: 'unchanged',
      phase: 'validation',
      retryable: false,
      message: pinnedManagedMessage(error, 'The package deletion input was refused.'),
    };
  }
  const result = await deletePinnedOwner(
    client,
    context,
    { type: 'DEVC', name: selected.name },
    {
      owner: selected.objectUrl,
      packageFor: async (active) => {
        const evidence = await readPinnedPackage(active, selected);
        if (
          evidence.packageType !== 'development' ||
          evidence.softwareComponent !== 'LOCAL' ||
          evidence.recordChanges !== 'false' ||
          evidence.transportLayer
        )
          throw new AdtSafetyError(
            'Package DELETE requires native LOCAL, recording-disabled development-package metadata without a transport layer.',
          );
        return evidence.name;
      },
      precondition: (active) => refuseKnownPackageContents(active, selected.name),
      validateRecording: (fresh) => {
        if (!fresh.local || fresh.request !== undefined)
          throw new AdtSafetyError(
            'Package DELETE requires fresh native local recording evidence; recorded deletion is not qualified.',
          );
        recording = fresh;
      },
    },
  );
  return {
    ...result,
    resource: { kind: 'package', uri: selected.objectUrl, name: selected.name, nativeType: 'DEVC/K' },
    ...(result.state !== 'unchanged' ? { contentEvidence: 'native-delete-contract' as const, recording } : {}),
    warnings:
      'Native DELETE checks contents and does not cascade. Package, TADIR and CTS bookkeeping effects are not independently verified; a native refusal does not prove all side effects were rolled back. Native lifecycle and PP qualification remain pending.',
  };
}
