/** Fail-closed local/CTS recording policy for the reviewed pinned PP write surface. */

import type { LockResult } from './crud.js';
import { AdtSafetyError } from './errors.js';
import type { AdtHttpClient, AdtRequestOptions } from './http.js';
import type { SafetyConfig } from './safety.js';
import { CTS_CONTENT_TYPE_ORGANIZER, getTransportInfo, parseTransportList } from './transport.js';

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

function matches(patterns: readonly string[], value: string): boolean {
  return patterns.some(
    (pattern) =>
      pattern.toUpperCase() === value ||
      (pattern.endsWith('*') && value.startsWith(pattern.slice(0, -1).toUpperCase())),
  );
}

export function checkPinnedRequest(safety: SafetyConfig, request: string): void {
  if (
    !safety.multiTargetWrite?.enabled ||
    !matches(safety.multiTargetWrite.allowedTransports, request) ||
    (safety.allowedTransports.length > 0 && !matches(safety.allowedTransports, request))
  ) {
    throw new AdtSafetyError('CTS request is not allowed by both server and destination transport policies.');
  }
}

/** A request allowance explicitly includes SAP-managed tasks within that request. */
export async function resolvePinnedRequest(
  http: AdtHttpClient,
  safety: SafetyConfig,
  id: string,
  options?: AdtRequestOptions,
): Promise<string> {
  if (!/^[A-Z0-9]{1,20}$/.test(id)) throw new AdtSafetyError('Invalid CTS request/task ID.');
  const path = `/sap/bc/adt/cts/transportrequests/${id}`;
  const response = await http.get(path, { Accept: CTS_CONTENT_TYPE_ORGANIZER }, options);
  if (response.body.length > 1024 * 1024)
    throw new AdtSafetyError('CTS request evidence exceeds the bounded qualification size.');
  const matches = parseTransportList(response.body, path).filter(
    (request) => request.id === id || request.tasks.some((task) => task.id === id),
  );
  if (matches.length !== 1) throw new AdtSafetyError('CTS request/task membership could not be established.');
  const request = matches[0];
  if (
    !/^[A-Z0-9]{1,20}$/.test(request.id) ||
    request.type !== 'K' ||
    request.status !== 'D' ||
    request.tasks.length > 256
  )
    throw new AdtSafetyError('A modifiable Workbench request is required.');
  if (request.id !== id && request.tasks.filter((task) => task.id === id && task.status === 'D').length !== 1)
    throw new AdtSafetyError('The selected task must be modifiable.');
  checkPinnedRequest(safety, request.id);
  return request.id;
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
  const info = await getTransportInfo(http, safety, owner, pkg, operation, options);
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
  const request = await resolvePinnedRequest(http, safety, selected, options);
  if (info.lockedTransport && (await resolvePinnedRequest(http, safety, info.lockedTransport, options)) !== request)
    throw new AdtSafetyError('The object is recorded in a different CTS request.');
  return { local: false, request };
}

export async function validatePinnedLock(
  http: AdtHttpClient,
  safety: SafetyConfig,
  lock: LockResult,
  recording: PinnedRecording,
  options?: AdtRequestOptions,
): Promise<void> {
  if (!lock.lockHandle || lock.localityKnown !== true || lock.isLocal !== recording.local)
    throw new AdtSafetyError('SAP lock does not affirm the preflight recording context.');
  if (recording.local) {
    if (lock.corrNr) throw new AdtSafetyError('Local lock unexpectedly carries a CTS request.');
  } else {
    if (!recording.request) throw new AdtSafetyError('Missing CTS request.');
    checkPinnedRequest(safety, recording.request);
    if (lock.corrNr && (await resolvePinnedRequest(http, safety, lock.corrNr, options)) !== recording.request)
      throw new AdtSafetyError('Lock and requested CTS recording disagree.');
  }
}
