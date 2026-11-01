/** Fail-closed local/CTS recording policy for the reviewed pinned PP write surface. */

import { checkPinnedRequest } from './allowlist-policy.js';
import type { LockResult } from './crud.js';
import { AdtSafetyError } from './errors.js';
import type { AdtHttpClient, AdtRequestOptions } from './http.js';
import { throwIfRequestCancelled } from './http-deadline.js';
import { getMutationContext } from './mutation-http.js';
import type { SafetyConfig } from './safety.js';

export { checkPinnedRequest } from './allowlist-policy.js';

import { CTS_CONTENT_TYPE_ORGANIZER, getTransportInfo, parseTransportList } from './transport.js';
import type { TransportRequest } from './types.js';
import { parseXml } from './xml-parser.js';

function requireRequestPolicy(
  http: AdtHttpClient,
  safety: SafetyConfig,
  options?: AdtRequestOptions,
): AdtRequestOptions {
  const policy = options ?? getMutationContext(http, safety)?.requestPolicy;
  if (
    !safety.multiTargetWrite?.enabled ||
    !policy ||
    !Number.isFinite(policy.deadline) ||
    policy.noReplay !== true ||
    policy.retryTransientErrors !== false
  )
    throw new AdtSafetyError(
      'Pinned recording requires an enabled policy and bounded, non-replayable request options.',
    );
  throwIfRequestCancelled(policy);
  return policy;
}

export function assertPinnedOwner(type: unknown, name: unknown): asserts type is 'CLAS' | 'INTF' {
  if (
    (type !== 'CLAS' && type !== 'INTF') ||
    typeof name !== 'string' ||
    !/^(?:\/[A-Z0-9_]+\/)?[A-Z][A-Z0-9_]{0,29}$/.test(name) ||
    name.length > 30
  ) {
    throw new AdtSafetyError('Pinned writes require one uppercase CLAS or INTF owner (maximum 30 characters).');
  }
}

/** Existing program/include identifiers use the native PROGNAME storage envelope (CHAR 40). */
export function assertPinnedSourceOwner(
  type: unknown,
  name: unknown,
): asserts type is 'CLAS' | 'INTF' | 'PROG' | 'INCL' {
  if (type === 'CLAS' || type === 'INTF') return assertPinnedOwner(type, name);
  if (
    (type !== 'PROG' && type !== 'INCL') ||
    typeof name !== 'string' ||
    !/^(?:\/[A-Z0-9_]+\/)?[A-Z][A-Z0-9_]*$/.test(name) ||
    name.length > 40
  )
    throw new AdtSafetyError('Select one uppercase PROG or INCL source owner (maximum 40 characters).');
}

/** Caller-selected tasks must be modifiable; lock evidence only proves parent membership. */
export async function resolvePinnedRequest(
  http: AdtHttpClient,
  safety: SafetyConfig,
  id: string,
  options?: AdtRequestOptions,
): Promise<string> {
  return (await inspectPinnedRequest(http, safety, id, requireRequestPolicy(http, safety, options), true)).id;
}

async function inspectPinnedRequest(
  http: AdtHttpClient,
  safety: SafetyConfig,
  id: string,
  options: AdtRequestOptions,
  requireModifiableTask: boolean,
): Promise<TransportRequest> {
  if (!/^[A-Z0-9]{1,20}$/.test(id)) throw new AdtSafetyError('Invalid CTS request/task ID.');
  const path = `/sap/bc/adt/cts/transportrequests/${id}`;
  const response = await http.get(path, { Accept: CTS_CONTENT_TYPE_ORGANIZER }, options);
  if (response.body.length > 1024 * 1024)
    throw new AdtSafetyError('CTS request evidence exceeds the bounded qualification size.');
  let matches = parseTransportList(response.body, path).filter(
    (request) => request.id === id || request.tasks.some((task) => task.id === id),
  );
  if (matches.length === 0) {
    // A task detail document places its parent request and task as siblings. Use only
    // the exact task's parent attribute, then independently verify the parent's tree.
    const root = parseXml(response.body).root as Record<string, unknown> | undefined;
    const tasks = root?.task;
    const selected = (Array.isArray(tasks) ? tasks : tasks ? [tasks] : []).filter(
      (task) => task && typeof task === 'object' && task['@_number'] === id,
    );
    const parent = selected.length === 1 ? selected[0]['@_parent'] : undefined;
    if (
      typeof parent !== 'string' ||
      !/^[A-Z0-9]{1,20}$/.test(parent) ||
      parent === id ||
      (requireModifiableTask && selected[0]['@_status'] !== 'D')
    )
      throw new AdtSafetyError('CTS task parent could not be established.');
    const parentPath = `/sap/bc/adt/cts/transportrequests/${parent}`;
    const parentResponse = await http.get(parentPath, { Accept: CTS_CONTENT_TYPE_ORGANIZER }, options);
    if (parentResponse.body.length > 1024 * 1024)
      throw new AdtSafetyError('CTS request evidence exceeds the bounded qualification size.');
    matches = parseTransportList(parentResponse.body, parentPath).filter(
      (request) => request.id === parent && request.tasks.some((task) => task.id === id),
    );
  }
  if (matches.length !== 1) throw new AdtSafetyError('CTS request/task membership could not be established.');
  const request = matches[0];
  if (
    !/^[A-Z0-9]{1,20}$/.test(request.id) ||
    request.type !== 'K' ||
    request.status !== 'D' ||
    request.tasks.length > 256
  )
    throw new AdtSafetyError('A modifiable Workbench request is required.');
  if (
    request.id !== id &&
    request.tasks.filter((task) => task.id === id && (!requireModifiableTask || task.status === 'D')).length !== 1
  )
    throw new AdtSafetyError('The selected task must be modifiable.');
  checkPinnedRequest(safety, request.id);
  return request;
}

export interface PinnedRecording {
  local: boolean;
  request?: string;
}

export async function pinnedRecording(
  http: AdtHttpClient,
  safety: SafetyConfig,
  owner: string,
  pkg: string,
  operation: 'I' | '',
  requested?: string,
  options?: AdtRequestOptions,
): Promise<PinnedRecording> {
  options = requireRequestPolicy(http, safety, options);
  const info = await getTransportInfo(http, safety, owner, pkg, operation, options);
  if (info.lockedTransportAmbiguous || (info.lockedTasks.length && !info.lockedTransport))
    throw new AdtSafetyError('Ambiguous CTS lock holders.');
  if (info.result !== 'S' || info.devclass !== pkg || info.operation !== operation)
    throw new AdtSafetyError('SAP did not affirm the requested package/recording context.');
  if (
    info.isLocal &&
    info.deliveryUnit === 'LOCAL' &&
    !info.recording &&
    !info.lockedTransport &&
    info.lockedTasks.length === 0
  ) {
    if (requested) throw new AdtSafetyError('A local object must not specify a CTS request/task.');
    return { local: true };
  }
  if (info.isLocal || !info.deliveryUnit || info.deliveryUnit === 'LOCAL')
    throw new AdtSafetyError('Ambiguous local/CTS recording evidence.');
  const selected = requested ?? info.lockedTransport;
  if (!selected)
    throw new AdtSafetyError(
      'This package requires an explicit allowed CTS request. Create/manage requests outside this multi-target write connection.',
    );
  const request = await inspectPinnedRequest(http, safety, selected, options, true);
  if (info.lockedTransport && info.lockedTransport !== request.id)
    throw new AdtSafetyError('The object is recorded in a different CTS request.');
  // Reuse the authoritative parent tree. A released task is valid historical lock evidence,
  // but it is never accepted as the caller-selected task for a new save.
  for (const task of info.lockedTasks)
    if (request.tasks.filter((entry) => entry.id === task).length !== 1)
      throw new AdtSafetyError('A locked task does not belong unambiguously to the selected CTS request.');
  return { local: false, request: request.id };
}

export async function validatePinnedLock(
  http: AdtHttpClient,
  safety: SafetyConfig,
  lock: LockResult,
  recording: PinnedRecording,
  options?: AdtRequestOptions,
): Promise<void> {
  options = requireRequestPolicy(http, safety, options);
  if (!lock.lockHandle || lock.localityKnown !== true || lock.isLocal !== recording.local)
    throw new AdtSafetyError('SAP lock does not affirm the preflight recording context.');
  if (recording.local) {
    if (lock.corrNr) throw new AdtSafetyError('Local lock unexpectedly carries a CTS request.');
  } else {
    if (!recording.request) throw new AdtSafetyError('Missing CTS request.');
    checkPinnedRequest(safety, recording.request);
    if (lock.corrNr && (await inspectPinnedRequest(http, safety, lock.corrNr, options, false)).id !== recording.request)
      throw new AdtSafetyError('Lock and requested CTS recording disagree.');
  }
}
