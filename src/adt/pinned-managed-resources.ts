/** Private package, API-release and service-binding profiles. Nothing here admits a public tool call. */
import { AdtApiError, AdtSafetyError, classifySapDomainError, extractExceptionType } from './errors.js';
import type { MutationCleanupState, PinnedMutationContext } from './mutation-context.js';
import type { NativeXmlElement } from './native-xml-evidence.js';

export type PinnedManagedProfileId =
  | 'package-create'
  | 'package-delete'
  | 'package-move'
  | 'api-release-state'
  | 'binding-create'
  | 'binding-update'
  | 'binding-delete'
  | 'binding-activate'
  | 'binding-publish'
  | 'binding-unpublish'
  | 'binding-publication-batch';

export interface PinnedManagedProfile {
  readonly id: PinnedManagedProfileId;
  /** The corresponding built-in action. Public admission is owned by the explicit server capability matrix. */
  readonly tool: 'SAPManage' | 'SAPWrite' | 'SAPActivate';
  readonly action: string;
  readonly resource: 'package' | 'repository-object' | 'api-release' | 'service-binding';
  readonly fields: readonly string[];
  /** Offline tests are the only evidence for these profiles. */
  readonly nativeEvidence: 'none';
}

const row = (
  id: PinnedManagedProfileId,
  tool: PinnedManagedProfile['tool'],
  action: string,
  resource: PinnedManagedProfile['resource'],
  fields: readonly string[],
): PinnedManagedProfile =>
  Object.freeze({
    id,
    tool,
    action,
    resource,
    fields: Object.freeze([...fields]),
    nativeEvidence: 'none',
  });

export const PINNED_MANAGED_PROFILES: readonly PinnedManagedProfile[] = Object.freeze([
  row('package-create', 'SAPManage', 'create_package', 'package', [
    'name',
    'description',
    'superPackage',
    'responsible',
    'softwareComponent',
    'transportLayer',
    'packageType',
    'recordChanges',
    'transport',
  ]),
  row('package-delete', 'SAPManage', 'delete_package', 'package', ['name', 'transport']),
  row('package-move', 'SAPManage', 'change_package', 'repository-object', [
    'objectName',
    'objectType',
    'oldPackage',
    'newPackage',
    'transport',
  ]),
  row('api-release-state', 'SAPManage', 'set_api_state', 'api-release', [
    'type',
    'name',
    'group',
    'contract',
    'apiState',
    'expectedCurrentState',
    'apiVisibility',
    'transport',
  ]),
  row('binding-create', 'SAPWrite', 'create', 'service-binding', [
    'name',
    'package',
    'description',
    'serviceDefinition',
    'odataVersion',
    'category',
    'version',
    'transport',
  ]),
  row('binding-update', 'SAPWrite', 'update', 'service-binding', [
    'name',
    'description',
    'serviceDefinition',
    'expectedMetadataHash',
    'odataVersion',
    'category',
    'version',
    'transport',
  ]),
  row('binding-delete', 'SAPWrite', 'delete', 'service-binding', ['name', 'transport']),
  row('binding-activate', 'SAPActivate', 'activate', 'service-binding', ['type', 'name', 'action', 'preaudit']),
  row('binding-publish', 'SAPActivate', 'publish_srvb', 'service-binding', [
    'name',
    'version',
    'serviceType',
    'expectedMetadataHash',
  ]),
  row('binding-unpublish', 'SAPActivate', 'unpublish_srvb', 'service-binding', [
    'name',
    'version',
    'serviceType',
    'expectedMetadataHash',
  ]),
  // No single-target batch action exists: a later public shape needs its own schema review.
  row('binding-publication-batch', 'SAPActivate', 'publish_srvb', 'service-binding', ['action', 'bindings']),
]);

/** A private profile rejects every unlisted field instead of silently dropping it. */
export function assertManagedProfileInput(id: PinnedManagedProfileId, input: object): void {
  const profile = PINNED_MANAGED_PROFILES.find((entry) => entry.id === id);
  if (!profile) throw new AdtSafetyError('Unknown private pinned profile.');
  const unsupported = Object.entries(input)
    .filter(([key, value]) => value !== undefined && !profile.fields.includes(key))
    .map(([key]) => key);
  if (unsupported.length)
    throw new AdtSafetyError(`Unsupported field(s) for this private profile: ${unsupported.join(', ')}.`);
}

const NATIVE_NAME = /^(?:\/[A-Z0-9_]{1,10}\/)?[A-Z][A-Z0-9_]*$/;

/** One uppercase repository name; namespace separators are structural, never URI path segments. */
export function assertPinnedNativeName(value: unknown, label: string, maxLength = 30): asserts value is string {
  if (typeof value !== 'string' || value.length > maxLength || !NATIVE_NAME.test(value))
    throw new AdtSafetyError(`${label} must be one uppercase native name, maximum ${maxLength} characters.`);
}

/** The `/NS/` prefix of a native name, or an empty string for the customer namespace. */
export function pinnedNativeNamespace(name: string): string {
  return /^\/[^/]+\//.exec(name)?.[0] ?? '';
}

export function assertPinnedSameNamespace(left: string, right: string, relation: string): void {
  if (pinnedNativeNamespace(left) !== pinnedNativeNamespace(right))
    throw new AdtSafetyError(`${relation} must stay in one native namespace.`);
}

export function normalizePinnedRequest(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim())
    throw new AdtSafetyError('An explicitly provided CTS request must not be empty.');
  return value.trim().toUpperCase();
}

export function pinnedDescription(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > 60 ||
    [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    throw new AdtSafetyError(`${label} requires a non-empty description of at most 60 characters.`);
  return value.trim();
}

/** Only SAP's typed not-found proves absence; a bare 404 can come from a gateway or a missing service. */
export function isPinnedNativeAbsence(error: unknown): boolean {
  return (
    error instanceof AdtApiError &&
    error.isNotFound &&
    extractExceptionType(error.responseBody ?? '') === 'ExceptionResourceNotFound' &&
    !classifySapDomainError(error.statusCode, error.responseBody, error.path)
  );
}

/** Native statuses that identify a refused phase. Network errors, 429 and 5xx never do. */
export function isPinnedPhaseRejection(error: unknown): error is AdtApiError {
  return error instanceof AdtApiError && [400, 401, 403, 404, 409, 412, 415, 422, 423].includes(error.statusCode);
}

export interface PinnedManagedResource {
  kind: PinnedManagedProfile['resource'];
  uri: string;
  name: string;
  nativeType: string;
  package?: string;
}

export interface PinnedManagedResult {
  ok: boolean;
  state: string;
  phase: string;
  retryable: false;
  resource?: PinnedManagedResource;
  statusCode?: number;
  message?: string;
  recording?: { local: boolean; request?: string } | 'native-governed-unverified';
  recordingNote?: string;
  warnings?: string[];
  cleanupFailed?: boolean;
  cleanup?: string;
  sessionClosed?: boolean;
  unlockFailures?: MutationCleanupState['unlockFailures'];
  lockOutcome?: 'unknown';
  unknownLocks?: MutationCleanupState['unknownLocks'];
}

/** Only ARC-1 policy text is echoed: native bodies and URLs can carry lock handles or source. */
export function pinnedManagedMessage(error: unknown, fallback: string): string {
  return error instanceof AdtSafetyError ? error.message : fallback;
}

/** Same reporting contract as pinned deletion; these fields never replace the primary outcome. */
export function pinnedManagedCleanup(context: PinnedMutationContext): Partial<PinnedManagedResult> {
  if (context?.mode !== 'pinned-pp' || !context.cleanup) return {};
  const { cleanup } = context;
  return {
    ...(cleanup.unknownLocks?.length
      ? { lockOutcome: 'unknown' as const, unknownLocks: cleanup.unknownLocks, sessionClosed: cleanup.sessionClosed }
      : {}),
    ...(cleanup.unlockFailed || cleanup.sessionClosed === false
      ? {
          cleanupFailed: true,
          sessionClosed: cleanup.sessionClosed,
          unlockFailures: cleanup.unlockFailures,
          cleanup: 'Lock or session cleanup was not confirmed. Verify the SAP lock before continuing.',
        }
      : {}),
  };
}

/** Read one namespace-qualified text-only child; missing and structured values are not empty text. */
export function pinnedNativeText(element: NativeXmlElement, name: string, namespace: string): string {
  const fields = element.canonicalValue({}) as [string, unknown][];
  const child = fields.find(([key]) => key === JSON.stringify(['element', namespace, name]))?.[1];
  if (Array.isArray(child) && child.length === 1 && Array.isArray(child[0])) {
    const text = child[0];
    if (text.length === 0) return '';
    if (text.length === 1 && Array.isArray(text[0]) && text[0][0] === 'text' && typeof text[0][1] === 'string')
      return text[0][1];
  }
  throw new AdtSafetyError(`The native ${name} field is missing or is not one text value.`);
}
