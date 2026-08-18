/**
 * CTS Transport management for SAP ADT.
 *
 * Transport mutations require explicit opt-in via allowWrites + allowTransportWrites.
 * Safety checks are applied at every entry point.
 */

import { AdtApiError, AdtNetworkError, AdtSafetyError } from './errors.js';
import type { AdtHttpClient, AdtRequestOptions } from './http.js';
import { checkOperation, checkTransport, OperationType, type SafetyConfig } from './safety.js';
import type {
  InactiveObject,
  TransportLayer,
  TransportObject,
  TransportReleaseMessage,
  TransportReleaseReport,
  TransportRequest,
  TransportTarget,
  TransportTask,
} from './types.js';
import { decodeXmlEntities, escapeXmlAttr, findDeepNodes, parseNamedItems, parseXml } from './xml-parser.js';

/**
 * Filter inactive objects (from `getInactiveObjects()`) down to those that belong to transport
 * `transportId` — i.e. those that would block its release. SAP activates objects before exporting a
 * transport, so an inactive one makes the release pipeline hang ("operation timed out", no detail).
 *
 * Matches whether `transportId` is the request or a task: an inactive object's `transport` is its
 * **task** id and `parentTransport` is the parent **request** URI, so we match on either
 * `transport === id` or `parentTransport` ending in `/<id>`. `$TMP`/unassigned objects carry neither
 * field and never match. Pure; case-insensitive.
 */
export function inactiveObjectsForTransport(objects: InactiveObject[], transportId: string): InactiveObject[] {
  const id = transportId.trim().toUpperCase();
  if (!id) return [];
  return objects.filter(
    (o) => (o.transport ?? '').toUpperCase() === id || (o.parentTransport ?? '').toUpperCase().endsWith(`/${id}`),
  );
}

// ─── CTS Media Types & Namespaces ──────────────────────────────────

/** Accept header for tree-structured responses (list/get transport) */
export const CTS_ACCEPT_TREE = 'application/vnd.sap.adt.transportorganizertree.v1+xml';

/** Content-Type / Accept for organizer write operations (create transport) */
export const CTS_CONTENT_TYPE_ORGANIZER = 'application/vnd.sap.adt.transportorganizer.v1+xml';

/** XML namespace for CTS ADT transport manager payloads */
export const CTS_NAMESPACE_TM = 'http://www.sap.com/cts/adt/tm';

export const DEFAULT_RELEASE_TIMEOUT_MS = 300_000;
const DEFAULT_RELEASE_INITIAL_DELAY_MS = 250;
const DEFAULT_RELEASE_MAX_DELAY_MS = 2_000;
const MODIFIABLE_RELEASE_STATUSES = new Set(['D', 'L']);
const IN_FLIGHT_RELEASE_STATUSES = new Set(['O', 'P']);
const TERMINAL_RELEASE_STATUSES = new Set(['R', 'N']);

function isKnownReleaseStatus(status: string): boolean {
  return (
    MODIFIABLE_RELEASE_STATUSES.has(status) ||
    IN_FLIGHT_RELEASE_STATUSES.has(status) ||
    TERMINAL_RELEASE_STATUSES.has(status)
  );
}

export type TransportReleaseOutcome = 'released' | 'blocked' | 'timeout' | 'unknown';

/** One request/task whose terminal CTS state is part of a release postcondition. */
export interface TransportReleaseNodeState {
  id: string;
  kind: 'request' | 'task';
  parentId?: string;
  initialStatus: string;
  lastStatus: string;
  confirmedReleased: boolean;
  /** How release was confirmed when SAP no longer returns a released task in the organizer tree. */
  confirmation?: 'observed_terminal' | 'accepted_submission_absence' | 'parent_terminal';
}

/** Raw SAP release report(s) retained per submitted request/task. */
export interface TransportReleaseSubmission {
  id: string;
  reports: TransportReleaseReport[];
  /** A submission can have committed remotely even when its HTTP response failed; retain that uncertainty. */
  error?: string;
}

/**
 * Terminal verification result for a CTS release.
 *
 * `verified=true` means every frozen request/task reached terminal CTS evidence: requests are
 * `R`/`N`, while released tasks may disappear after acceptance or a terminal parent.
 */
export interface TransportReleaseResult {
  requestedId: string;
  recursive: boolean;
  outcome: TransportReleaseOutcome;
  verified: boolean;
  /** Frozen ids with terminal CTS evidence (tasks first in recursive mode for compatibility). */
  released: string[];
  intended: TransportReleaseNodeState[];
  submissions: TransportReleaseSubmission[];
  /** Backward-compatible view: raw report(s) for the requested id (the parent in recursive mode). */
  reports: TransportReleaseReport[];
  /** Number of post-submission CTS state reads. The initial discovery read is not counted. */
  polls: number;
  elapsedMs: number;
  lastReadError?: string;
  /** Submitted ids whose report said failure even though CTS ultimately confirmed released status. */
  reportConflicts?: string[];
  /** Child tasks that appeared after the recursive release snapshot and invalidated exact-set verification. */
  unexpectedChildren?: string[];
}

/** Internal convergence controls; injectable clock/sleep keep unit tests deterministic. */
export interface TransportReleaseWaitOptions {
  /** Relative verification budget. Defaults to 5 minutes. */
  timeoutMs?: number;
  /** Absolute deadline in the same clock domain as `now` (epoch milliseconds by default). */
  deadline?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  /** Stops sleeps and is forwarded through every CTS state/read release request. */
  signal?: AbortSignal;
}

/** List transport requests for a user, optionally filtered by status (client-side) */
export async function listTransports(
  http: AdtHttpClient,
  safety: SafetyConfig,
  user?: string,
  status?: string,
): Promise<TransportRequest[]> {
  checkTransport(safety, '', 'ListTransports', false);

  // Build query params following sapcli's pattern:
  //   user={user}&target=true&requestType=KWT&requestStatus=DR
  // requestType=KWT covers Workbench, Customizing, Transport of Copies.
  // requestStatus is sent server-side; we also filter client-side as a fallback.
  const params = new URLSearchParams();
  if (user && user !== '*') {
    params.set('user', user);
  }
  params.set('target', 'true');
  params.set('requestType', 'KWT');
  // Server-side: request both D and R, then filter client-side for reliability
  params.set('requestStatus', status && status !== '*' ? status : 'DR');

  const url = `/sap/bc/adt/cts/transportrequests?${params.toString()}`;

  const resp = await http.get(url, { Accept: CTS_ACCEPT_TREE });
  let transports = parseTransportList(resp.body);

  // Client-side status filter as fallback (some systems ignore requestStatus)
  if (status && status !== '*') {
    transports = transports.filter((t) => t.status === status);
  }

  return transports;
}

/** Get details of a specific transport request */
export async function getTransport(
  http: AdtHttpClient,
  safety: SafetyConfig,
  transportId: string,
): Promise<TransportRequest | null> {
  checkTransport(safety, transportId, 'GetTransport', false);

  const resp = await http.get(`/sap/bc/adt/cts/transportrequests/${encodeURIComponent(transportId)}`, {
    Accept: CTS_CONTENT_TYPE_ORGANIZER,
  });

  const transports = parseTransportList(resp.body);
  // NW 7.50 returns HTTP 200 with the caller's full transport list when the
  // requested ID doesn't exist, instead of 404. Verify the parsed id matches.
  const match = transports.find((t) => t.id === transportId);
  return match ?? null;
}

/**
 * Create a new transport request via the ADT CreateCorrectionRequest endpoint.
 *
 * POSTs to `/sap/bc/adt/cts/transports` with the `asx:abap` `CreateCorrectionRequest`
 * schema — the same endpoint Eclipse ADT and `marcellourbani/abap-adt-api` use. The
 * legacy POST `/cts/transportrequests` path with a `<tm:root>` body is rejected by
 * NW 7.5x with HTTP 400 "user action  is not supported" (verified live on
 * `npl.marianzeis.de`, NW 7.50 SP02; `CL_ADT_TM_RESOURCE` on that release ignores
 * `tm:useraction` regardless of placement). Verified working on both
 * `npl.marianzeis.de` (NW 7.50 SP02) and `a4h.marianzeis.de` (S/4HANA 2023).
 *
 * `targetPackage` is optional — when omitted, defaults to `$TMP`. The SAP backend
 * requires DEVCLASS in the body (HTTP 500 "Specify a package" if empty), but
 * `$TMP` works on every release tested and produces a normal type-K Workbench
 * transport with empty target — functionally equivalent to a SE10 "no-package"
 * request. Pass an explicit package to influence the transport route/target. The
 * endpoint still creates a Workbench (K) request; it does not select W/T from the
 * package.
 *
 * `transportLayer` is optional. The endpoint does NOT accept a target in the body —
 * the only way to influence the target on this `CreateCorrectionRequest` schema is
 * the `?transportLayer=<layer>` query parameter (the same mechanism Eclipse ADT and
 * `marcellourbani/abap-adt-api` use). The resulting target is still resolved by SAP
 * from that layer's STMS consolidation route: a layer with no route — or a system
 * with no transport routes configured at all (e.g. a standalone dev system) — yields
 * an empty target ("Local Change Requests"), regardless of the value passed. Verified
 * live on a4h (S/4HANA 2023): the param is accepted but a route-less system always
 * resolves to an empty target. So this is a hint, not a guarantee; the request's real
 * target should be read back from the created request (see `handleSAPTransport`).
 *
 * @param targetPackage optional — DEVCLASS used by SAP for transport-route lookup; defaults to `$TMP`
 * @param objectUrl optional — ADT object URL hint for transport-route lookup; the object is NOT locked or attached to the transport
 * @param transportLayer optional — transport layer used to resolve the consolidation target; sent as the `?transportLayer=` query param
 */
export async function createTransport(
  http: AdtHttpClient,
  safety: SafetyConfig,
  description: string,
  targetPackage?: string,
  objectUrl?: string,
  transportLayer?: string,
): Promise<string> {
  checkTransport(safety, '', 'CreateTransport', true);

  const devclass = targetPackage?.trim() ? targetPackage : '$TMP';
  const refXml = objectUrl ? `<REF>${escapeXmlAttr(objectUrl)}</REF>` : '<REF/>';
  const body = `<?xml version="1.0" encoding="UTF-8"?><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
    <DATA>
      <DEVCLASS>${escapeXmlAttr(devclass)}</DEVCLASS>
      <REQUEST_TEXT>${escapeXmlAttr(description)}</REQUEST_TEXT>
      ${refXml}
      <OPERATION>I</OPERATION>
    </DATA>
  </asx:values>
</asx:abap>`;

  const layer = transportLayer?.trim();
  const url = layer
    ? `/sap/bc/adt/cts/transports?transportLayer=${encodeURIComponent(layer)}`
    : '/sap/bc/adt/cts/transports';

  const resp = await http.post(
    url,
    body,
    'application/vnd.sap.as+xml; charset=UTF-8; dataname=com.sap.adt.CreateCorrectionRequest',
    { Accept: 'text/plain' },
  );

  // Response body is a path like "/com.sap.cts/object_record/NPLK900026" —
  // the transport ID is the last path segment.
  return (
    String(resp.body ?? '')
      .trim()
      .split('/')
      .pop() ?? ''
  );
}

/**
 * Create a transport request with an explicit transport target (Transportziel /
 * `TR_TARGET` / SAP GUI field `KO013-TARSYSTEM`) — a target system (`C11`),
 * system.client (`C11.021`), or target group (`/TRG/`).
 *
 * Unlike `createTransport` (the `CreateCorrectionRequest` endpoint, which can only let
 * SAP infer a target from the package route and silently ignores any target field),
 * this uses the `tm:root`/`newrequest` endpoint (`POST /sap/bc/adt/cts/transportrequests`)
 * — the only ADT path that sets `TR_TARGET` directly.
 *
 * The group and `<sys>.<cli>` target forms require extended transport control (CTC) to
 * be active. SAP validates the target server-side: an unknown target yields HTTP 400
 * "Target 'X' does not exist". Verified live on a4h (S/4HANA 2023, kernel 7.58):
 * `tm:target="LOCAL"` → 201 with the target set; unknown targets → 400. NOTE: this
 * endpoint was rejected on NW 7.50 (npl) — older releases may not support it.
 *
 * @param target  the transport target (`TR_TARGET`); e.g. `C11`, `C11.021`, `/TRG/`, `LOCAL`
 * @param owner   task owner; defaults to the connected user when omitted
 */
export async function createTransportWithTarget(
  http: AdtHttpClient,
  safety: SafetyConfig,
  description: string,
  target: string,
  owner?: string,
): Promise<string> {
  checkTransport(safety, '', 'CreateTransport', true);

  const ownerAttr = owner ? ` tm:owner="${escapeXmlAttr(owner)}"` : '';
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<tm:root xmlns:tm="${CTS_NAMESPACE_TM}" tm:useraction="newrequest">
  <tm:request tm:desc="${escapeXmlAttr(description)}" tm:type="K" tm:target="${escapeXmlAttr(target)}" tm:cts_project="">
    <tm:task${ownerAttr}/>
  </tm:request>
</tm:root>`;

  const resp = await http.post('/sap/bc/adt/cts/transportrequests', body, 'text/plain', {
    Accept: CTS_CONTENT_TYPE_ORGANIZER,
  });

  // Response: <tm:root><tm:request tm:number="A4HK…"> — extract the new request id.
  const reqNode = findDeepNodes(parseXml(resp.body), 'request')[0];
  return String(reqNode?.['@_number'] ?? '');
}

/**
 * List the transport layers available on the system — the valid values for
 * `createTransport`'s `transportLayer` parameter.
 *
 * GETs the package editor's transport-layer value help
 * (`/sap/bc/adt/packages/valuehelps/transportlayers`), which returns a
 * `nameditem:namedItemList`. Each entry has a `name` (the layer; empty = the
 * local/no-transport layer), a `description`, and sometimes a `data` element
 * carrying the resolved consolidation target (e.g. `DEV`).
 *
 * This is the discovery primitive that lets a client pick a real `transportLayer`
 * value instead of guessing one. A layer appearing here does NOT guarantee the
 * created request gets a target — that still depends on the layer having a classic
 * STMS consolidation route (gCTS-only layers, for instance, do not populate a
 * classic workbench target). Read-only; does not require `allowTransportWrites`.
 */
export async function listTransportLayers(http: AdtHttpClient, safety: SafetyConfig): Promise<TransportLayer[]> {
  checkOperation(safety, OperationType.Read, 'ListTransportLayers');

  const resp = await http.get('/sap/bc/adt/packages/valuehelps/transportlayers', {
    Accept: 'application/vnd.sap.adt.nameditems.v1+xml',
  });

  return parseTransportLayers(resp.body);
}

/** Parse a `nameditem:namedItemList` value-help response into transport layers. */
function parseTransportLayers(xml: string): TransportLayer[] {
  return parseNamedItems(xml).map((item) => ({
    name: item.name,
    description: item.description,
    ...(item.data ? { target: item.data } : {}),
  }));
}

/**
 * List the valid transport targets (Transportziel / TR_TARGET) this system offers — the
 * valid values for `createTransportWithTarget`'s `target`.
 *
 * GETs the official ADT transport-target value help
 * (`/sap/bc/adt/cts/transportrequests/valuehelp/target`), a `nameditem:namedItemList`
 * advertised in ADT discovery only on releases whose TM stack supports targets (the same
 * gate as `supportsExplicitTransportTarget`). NW 7.50/7.51 do not expose it (HTTP 404).
 * Read-only; does not require `allowTransportWrites`. Verified live on a4h (returns `DEV`).
 */
export async function listTransportTargets(http: AdtHttpClient, safety: SafetyConfig): Promise<TransportTarget[]> {
  checkOperation(safety, OperationType.Read, 'ListTransportTargets');

  const resp = await http.get('/sap/bc/adt/cts/transportrequests/valuehelp/target?maxItemCount=200', {
    Accept: 'application/vnd.sap.adt.nameditems.v1+xml',
  });

  return parseNamedItems(resp.body)
    .filter((item) => item.name)
    .map((item) => ({ name: item.name, description: item.description }));
}

/**
 * Whether this system's ADT stack supports setting an explicit transport target at creation.
 *
 * SAP's own Eclipse client gates this on ADT *discovery capability*, not a release number:
 * the `/sap/bc/adt/cts/transportrequests` collection advertises the
 * `application/vnd.sap.adt.transportorganizer.v1+xml` Accept media type only on releases
 * whose TM resource implements `useraction="newrequest"`. On NW 7.50/7.51 that Accept type is
 * absent (verified live: a4h 7.58 advertises it, npl 7.50 does not).
 *
 * @returns `true`/`false` per discovery, or `undefined` when discovery has not been loaded
 *          (caller should then attempt and rely on the runtime error as the fallback signal).
 */
export function supportsExplicitTransportTarget(http: AdtHttpClient): boolean | undefined {
  if (!http.hasDiscoveryData()) return undefined;
  return (http.discoveryAcceptFor('/sap/bc/adt/cts/transportrequests') ?? '').includes('transportorganizer');
}

/**
 * Parse the `newreleasejobs` response body into release reports.
 *
 * Real a4h 758 shape (verified live): `tm:root > tm:releasereports > chkrun:checkReport`, each carrying
 * `chkrun:reporter`/`status`/`statusText`/`triggeringUri`; on a blocked release the report also nests
 * `chkrun:checkMessageList > chkrun:checkMessage` (`chkrun:type`/`shortText`/`uri`). `removeNSPrefix`
 * strips the namespaces, so we read `checkReport`/`checkMessage` + `@_`-prefixed attrs — same idiom as
 * `parseSyntaxCheckResult`. Empty/garbage body → `[]` (graceful: NW 7.5x never reaches here, and a
 * non-report 200 must not throw). NOTE: relies on all `checkReport`s sharing one `tm:releasereports`
 * parent (the verified contract); `findDeepNodes` returns the first matching branch's children.
 */
export function parseReleaseReports(xml: string): TransportReleaseReport[] {
  const parsed = parseXml(xml);
  return findDeepNodes(parsed, 'checkReport').map((report) => {
    const r = report as Record<string, unknown>;
    const status = String(r['@_status'] ?? '');
    const messages: TransportReleaseMessage[] = findDeepNodes(report, 'checkMessage').map((m) => {
      const msg = m as Record<string, unknown>;
      const type = String(msg['@_type'] ?? '');
      const uri = String(msg['@_uri'] ?? '');
      return {
        severity: type === 'E' ? 'error' : type === 'W' ? 'warning' : 'info',
        type,
        text: decodeXmlEntities(String(msg['@_shortText'] ?? '')),
        ...(uri ? { uri } : {}),
      };
    });
    return {
      reporter: String(r['@_reporter'] ?? ''),
      status,
      statusText: decodeXmlEntities(String(r['@_statusText'] ?? '')),
      ...(r['@_triggeringUri'] ? { triggeringUri: String(r['@_triggeringUri']) } : {}),
      released: status === 'released',
      messages,
    };
  });
}

/**
 * Reports that signal a FAILED release: a `status` that is present and not `released`. A status-less
 * report is treated as non-failing (fail-soft) — real a4h reports always carry `status`, so a missing
 * one means a shape we don't recognize, not a confirmed failure.
 */
export function failedReleaseReports(reports: TransportReleaseReport[]): TransportReleaseReport[] {
  return reports.filter((r) => r.status !== '' && !r.released);
}

/** Release a transport request; returns the parsed release check report(s) (`[]` if none/unparseable). */
export async function releaseTransport(
  http: AdtHttpClient,
  safety: SafetyConfig,
  transportId: string,
  requestOptions?: AdtRequestOptions,
): Promise<TransportReleaseReport[]> {
  checkTransport(safety, transportId, 'ReleaseTransport', true);

  const resp = await http.post(
    `/sap/bc/adt/cts/transportrequests/${encodeURIComponent(transportId)}/newreleasejobs`,
    undefined,
    undefined,
    { Accept: CTS_CONTENT_TYPE_ORGANIZER },
    requestOptions,
  );
  return parseReleaseReports(resp.body);
}

/** Collect every node with a local XML name, rather than stopping at the first matching branch. */
function collectAllNamedNodes(value: unknown, name: string, output: Record<string, unknown>[] = []) {
  if (!value || typeof value !== 'object') return output;
  if (Array.isArray(value)) {
    for (const entry of value) collectAllNamedNodes(entry, name, output);
    return output;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === name) {
      const candidates = Array.isArray(child) ? child : [child];
      for (const candidate of candidates) {
        if (candidate && typeof candidate === 'object') output.push(candidate as Record<string, unknown>);
      }
    }
    collectAllNamedNodes(child, name, output);
  }
  return output;
}

/**
 * Flatten a transport-organizer document into request/task state rows.
 *
 * Unlike `parseTransportList`, this deliberately supports a standalone `<tm:task>` response and a
 * task lookup whose response contains the parent request tree. That makes it safe to verify either
 * kind of id after `newreleasejobs`.
 */
export function parseTransportNodeStates(xml: string): TransportReleaseNodeState[] {
  const parsed = parseXml(xml);
  const states = new Map<string, TransportReleaseNodeState>();

  const parentIdFrom = (value: unknown): string => {
    const raw = String(value ?? '')
      .trim()
      .replace(/\/+$/, '');
    return raw.slice(raw.lastIndexOf('/') + 1);
  };

  const add = (node: Record<string, unknown>, kind: 'request' | 'task', structuralParent?: string) => {
    const id = String(node['@_number'] ?? '').trim();
    if (!id) return;
    const key = id.toUpperCase();
    const status = String(node['@_status'] ?? '').toUpperCase();
    const parentId = parentIdFrom(structuralParent ?? node['@_parent']);
    const previous = states.get(key);
    states.set(key, {
      id,
      kind,
      ...(parentId ? { parentId } : previous?.parentId ? { parentId: previous.parentId } : {}),
      initialStatus: status || previous?.initialStatus || '',
      lastStatus: status || previous?.lastStatus || '',
      confirmedReleased: TERMINAL_RELEASE_STATUSES.has(status || previous?.lastStatus || ''),
      ...(TERMINAL_RELEASE_STATUSES.has(status || previous?.lastStatus || '')
        ? { confirmation: 'observed_terminal' as const }
        : {}),
    });
  };

  for (const request of collectAllNamedNodes(parsed, 'request')) {
    const requestId = String(request['@_number'] ?? '').trim();
    add(request, 'request');
    for (const task of collectAllNamedNodes(request, 'task')) add(task, 'task', requestId);
  }

  for (const task of collectAllNamedNodes(parsed, 'task')) add(task, 'task');
  return [...states.values()];
}

async function readTransportNodeStates(
  http: AdtHttpClient,
  safety: SafetyConfig,
  lookupId: string,
  requestOptions?: AdtRequestOptions,
): Promise<TransportReleaseNodeState[]> {
  checkTransport(safety, lookupId, 'GetTransportReleaseState', false);
  const resp = await http.get(
    `/sap/bc/adt/cts/transportrequests/${encodeURIComponent(lookupId)}`,
    {
      Accept: CTS_CONTENT_TYPE_ORGANIZER,
    },
    requestOptions,
  );
  return parseTransportNodeStates(resp.body);
}

const transportIdsEqual = (left: string | undefined, right: string) =>
  (left ?? '').toUpperCase() === right.toUpperCase();

function releaseErrorText(err: unknown): string {
  // Convergence errors bypass dispatch's minimal-error formatter. Never copy SAP
  // response text or ADT paths into this normal tool-result evidence.
  if (err instanceof AdtApiError) return `SAP CTS request failed with HTTP ${err.statusCode}.`;
  if (err instanceof AdtNetworkError) return 'SAP CTS network request failed.';

  const message = err instanceof Error ? err.message : String(err);
  return message.length <= 300 ? message : `${message.slice(0, 300)}…`;
}

/** Fail closed when the transport allowlist cannot authorize a concurrently changing CTS subtree. */
export function checkRecursiveTransportReleaseScope(safety: SafetyConfig): void {
  const explicitlyUnrestricted =
    safety.allowedTransports.length === 0 || safety.allowedTransports.some((entry) => entry.trim() === '*');
  if (explicitlyUnrestricted) return;

  throw new AdtSafetyError(
    'Recursive transport release is blocked by a restrictive allowedTransports policy. ' +
      'SAP can fold a child task attached concurrently into the parent release, so exact/prefix allowlists ' +
      'cannot authorize the complete live subtree atomically. Use an empty legacy allowlist or explicit "*" ' +
      'only when every current and concurrently attached child of the request is authorized.',
  );
}

const isTerminalReleaseReadError = (err: unknown) =>
  err instanceof AdtApiError && [400, 401, 403, 404].includes(err.statusCode);

function numericOption(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : fallback;
}

async function waitForReleasePoll(milliseconds: number, options: TransportReleaseWaitOptions): Promise<void> {
  if (milliseconds <= 0 || options.signal?.aborted) return;
  if (options.sleep) {
    await options.sleep(milliseconds);
    return;
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, milliseconds);
    const signal = options.signal;
    signal?.addEventListener('abort', done, { once: true });

    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
  });
}

function buildReleaseResult(
  requestedId: string,
  recursive: boolean,
  outcome: TransportReleaseOutcome,
  intended: TransportReleaseNodeState[],
  submissions: TransportReleaseSubmission[],
  polls: number,
  elapsedMs: number,
  lastReadError?: string,
  unexpectedChildren: string[] = [],
): TransportReleaseResult {
  const released = (
    recursive
      ? [...intended.filter((node) => node.kind === 'task'), ...intended.filter((node) => node.kind === 'request')]
      : intended
  )
    .filter((node) => node.confirmedReleased)
    .map((node) => node.id);
  const reports = submissions.find((submission) => transportIdsEqual(submission.id, requestedId))?.reports ?? [];
  const reportConflicts = submissions
    .filter(
      (submission) =>
        failedReleaseReports(submission.reports).length > 0 &&
        intended.some((node) => transportIdsEqual(node.id, submission.id) && node.confirmedReleased),
    )
    .map((submission) => submission.id);

  return {
    requestedId,
    recursive,
    outcome,
    verified: outcome === 'released',
    released,
    intended: intended.map((node) => ({ ...node })),
    submissions: submissions.map((submission) => ({ ...submission, reports: [...submission.reports] })),
    reports,
    polls,
    elapsedMs,
    ...(lastReadError ? { lastReadError } : {}),
    ...(reportConflicts.length > 0 ? { reportConflicts } : {}),
    ...(unexpectedChildren.length > 0 ? { unexpectedChildren: [...unexpectedChildren] } : {}),
  };
}

interface TransportReleasePreparation {
  intended: TransportReleaseNodeState[];
  terminal?: { outcome: TransportReleaseOutcome; detail?: string };
}

async function prepareTransportRelease(
  http: AdtHttpClient,
  safety: SafetyConfig,
  transportId: string,
  recursive: boolean,
  operation: string,
  requestOptions: AdtRequestOptions,
  stoppedBeforeSubmission: () => 'aborted' | 'deadline' | undefined,
): Promise<TransportReleasePreparation> {
  const terminal = (
    intended: TransportReleaseNodeState[],
    detail?: string,
    outcome: TransportReleaseOutcome = 'unknown',
  ): TransportReleasePreparation => ({ intended, terminal: { outcome, detail } });
  let discovered: TransportReleaseNodeState[];
  try {
    discovered = await readTransportNodeStates(http, safety, transportId, requestOptions);
  } catch (err) {
    return terminal([], releaseErrorText(err));
  }
  const requested = discovered.find((node) => transportIdsEqual(node.id, transportId));
  if (!requested) {
    return terminal([], `Transport '${transportId}' was not present in the CTS state response.`);
  }
  if (recursive && requested.kind !== 'request') {
    return terminal([requested], `Recursive release requires a parent request, but '${transportId}' is a task.`);
  }

  const intended = [
    requested,
    ...(recursive
      ? discovered.filter((node) => node.kind === 'task' && transportIdsEqual(node.parentId, transportId))
      : []),
  ].map((node) => ({ ...node }));
  for (const node of intended) checkTransport(safety, node.id, operation, true);
  const unknown = intended.filter((node) => !isKnownReleaseStatus(node.lastStatus));
  if (unknown.length > 0) {
    const detail = `CTS returned an unknown initial status for: ${unknown
      .map((node) => `${node.id}=${node.lastStatus || '(missing)'}`)
      .join(', ')}.`;
    return terminal(intended, detail);
  }
  if (intended.every((node) => node.confirmedReleased)) return terminal(intended, undefined, 'released');
  const stopped = stoppedBeforeSubmission();
  if (!stopped) return { intended };
  const detail =
    stopped === 'aborted'
      ? 'Transport release verification was aborted before submission.'
      : 'Transport release deadline expired before submission.';
  return terminal(intended, detail);
}

async function releaseTransportWithConvergence(
  http: AdtHttpClient,
  safety: SafetyConfig,
  transportId: string,
  recursive: boolean,
  options: TransportReleaseWaitOptions,
): Promise<TransportReleaseResult> {
  const operation = recursive ? 'ReleaseTransportRecursive' : 'ReleaseTransport';
  checkTransport(safety, transportId, operation, true);
  if (recursive) checkRecursiveTransportReleaseScope(safety);

  const now = options.now ?? Date.now;
  const startedAt = now();
  const relativeDeadline = startedAt + numericOption(options.timeoutMs, DEFAULT_RELEASE_TIMEOUT_MS);
  const suppliedDeadline =
    typeof options.deadline === 'number' && Number.isFinite(options.deadline)
      ? options.deadline
      : Number.POSITIVE_INFINITY;
  const deadline = Math.min(relativeDeadline, suppliedDeadline);
  const elapsed = () => Math.max(0, now() - startedAt);
  const requestOptions = { deadline, signal: options.signal };
  const initialResult = (
    outcome: TransportReleaseOutcome,
    intended: TransportReleaseNodeState[] = [],
    detail?: string,
  ) => buildReleaseResult(transportId, recursive, outcome, intended, [], 0, elapsed(), detail);
  const preparation = await prepareTransportRelease(
    http,
    safety,
    transportId,
    recursive,
    operation,
    requestOptions,
    () => (options.signal?.aborted ? 'aborted' : now() >= deadline ? 'deadline' : undefined),
  );
  const { intended } = preparation;
  if (preparation.terminal) {
    return initialResult(preparation.terminal.outcome, intended, preparation.terminal.detail);
  }

  const submissions: TransportReleaseSubmission[] = [];
  const requestedState = intended[0]!;
  const taskSubmissionOrder = recursive ? intended.filter((node) => node.kind === 'task') : [];
  const frozenTaskKeys = new Set(taskSubmissionOrder.map((node) => node.id.toUpperCase()));
  let polls = 0;
  let lastReadError: string | undefined;
  let missingIds: string[] = [];
  let unexpectedChildren: string[] = [];
  const maxDelayMs = numericOption(options.maxDelayMs, DEFAULT_RELEASE_MAX_DELAY_MS);
  let delayMs = Math.min(numericOption(options.initialDelayMs, DEFAULT_RELEASE_INITIAL_DELAY_MS), maxDelayMs);
  const lookupId = recursive ? requestedState.id : transportId;
  const allReleased = () => intended.every((node) => node.confirmedReleased);
  const hasInFlightNode = () =>
    intended.some((node) => IN_FLIGHT_RELEASE_STATUSES.has(node.lastStatus) && !node.confirmedReleased);
  const submissionFailed = () => submissions.some((submission) => submission.error !== undefined);
  const finalOutcomeIsDecided = () =>
    !hasInFlightNode() &&
    submissions.some(
      (submission) =>
        submission.error !== undefined ||
        (transportIdsEqual(submission.id, requestedState.id) && failedReleaseReports(submission.reports).length > 0),
    );
  const submissionWasAccepted = (id: string) => {
    const submission = submissions.find((entry) => transportIdsEqual(entry.id, id));
    return (
      submission !== undefined &&
      submission.error === undefined &&
      submission.reports.length > 0 &&
      failedReleaseReports(submission.reports).length === 0
    );
  };
  const result = (outcome: TransportReleaseOutcome, detail?: string) =>
    buildReleaseResult(
      transportId,
      recursive,
      outcome,
      intended,
      submissions,
      polls,
      elapsed(),
      detail,
      unexpectedChildren,
    );

  const submissionFailureDetail = (): string | undefined => {
    const failed = submissions.filter((submission) => submission.error);
    return failed.length === 0
      ? undefined
      : `Release submission returned an error for ${failed
          .map((submission) => `${submission.id}: ${submission.error}`)
          .join('; ')}. The submission outcome is uncertain; use the returned CTS state before retrying.`;
  };

  const finishWithoutTerminalRelease = (): TransportReleaseResult => {
    const unknownStatuses = intended.filter((node) => !isKnownReleaseStatus(node.lastStatus));
    const submissionFailure = submissionFailureDetail();
    const stateDetail =
      lastReadError ??
      (missingIds.length > 0
        ? `CTS state omitted intended id(s): ${missingIds.join(', ')}.`
        : unknownStatuses.length > 0
          ? `CTS returned unknown status(es): ${unknownStatuses
              .map((node) => `${node.id}=${node.lastStatus || '(missing)'}`)
              .join(', ')}.`
          : undefined);
    const detail = [submissionFailure, stateDetail].filter(Boolean).join(' ') || undefined;
    const unknown = detail || unexpectedChildren.length > 0;
    const blocked = submissions.some((submission) => failedReleaseReports(submission.reports).length > 0);
    return result(unknown ? 'unknown' : blocked ? 'blocked' : 'timeout', detail);
  };

  const submit = async (node: TransportReleaseNodeState): Promise<void> => {
    try {
      const reports = await releaseTransport(http, safety, node.id, requestOptions);
      submissions.push({ id: node.id, reports });
    } catch (err) {
      submissions.push({ id: node.id, reports: [], error: releaseErrorText(err) });
    }
  };

  const refresh = async (): Promise<TransportReleaseResult | undefined> => {
    try {
      const latest = await readTransportNodeStates(http, safety, lookupId, requestOptions);
      polls += 1;
      lastReadError = undefined;
      const latestById = new Map(latest.map((node) => [node.id.toUpperCase(), node]));
      unexpectedChildren = recursive
        ? latest
            .filter(
              (node) =>
                node.kind === 'task' &&
                transportIdsEqual(node.parentId, requestedState.id) &&
                !frozenTaskKeys.has(node.id.toUpperCase()),
            )
            .map((node) => node.id)
            .sort()
        : [];
      missingIds = [];
      const observedParent = latestById.get(requestedState.id.toUpperCase());
      const parentIsTerminal =
        recursive && observedParent !== undefined && TERMINAL_RELEASE_STATUSES.has(observedParent.lastStatus);
      for (const node of intended) {
        const observed = latestById.get(node.id.toUpperCase());
        if (observed) {
          node.lastStatus = observed.lastStatus;
          node.confirmedReleased = TERMINAL_RELEASE_STATUSES.has(node.lastStatus);
          node.confirmation = node.confirmedReleased ? 'observed_terminal' : undefined;
          continue;
        }

        const alreadyConfirmed = node.confirmedReleased;
        const existingConfirmation = node.confirmation;
        const disappearedReleasedTask =
          node.kind === 'task' && (parentIsTerminal || alreadyConfirmed || submissionWasAccepted(node.id));
        if (disappearedReleasedTask) {
          node.confirmedReleased = true;
          node.confirmation = parentIsTerminal
            ? 'parent_terminal'
            : alreadyConfirmed
              ? existingConfirmation
              : 'accepted_submission_absence';
        } else {
          node.lastStatus = '';
          node.confirmedReleased = false;
          node.confirmation = undefined;
          missingIds.push(node.id);
        }
      }
    } catch (err) {
      polls += 1;
      if (
        err instanceof AdtApiError &&
        err.statusCode === 404 &&
        requestedState.kind === 'task' &&
        submissionWasAccepted(requestedState.id)
      ) {
        requestedState.confirmedReleased = true;
        requestedState.confirmation = 'accepted_submission_absence';
        lastReadError = undefined;
        missingIds = [];
        return result('released');
      }
      lastReadError = releaseErrorText(err);
      if (isTerminalReleaseReadError(err)) {
        return result('unknown', [submissionFailureDetail(), lastReadError].filter(Boolean).join(' '));
      }
      return undefined;
    }

    if (unexpectedChildren.length > 0) {
      const parentWasSubmitted = submissions.some((submission) => transportIdsEqual(submission.id, requestedState.id));
      const detail = parentWasSubmitted
        ? `CTS added non-frozen child task(s) during recursive release: ${unexpectedChildren.join(', ')}. ` +
          'Exact-set terminal verification was refused.'
        : `CTS added non-frozen child task(s) before parent release: ${unexpectedChildren.join(', ')}. ` +
          'The parent release was not submitted.';
      return result('unknown', detail);
    }

    return allReleased() ? result('released') : undefined;
  };

  const stopped = (): TransportReleaseResult | undefined => {
    if (options.signal?.aborted) {
      const detail = [submissionFailureDetail(), 'Transport release verification was aborted.']
        .filter(Boolean)
        .join(' ');
      return result('unknown', detail);
    }
    return now() >= deadline ? finishWithoutTerminalRelease() : undefined;
  };

  const pollUntil = async (ready: () => boolean, immediate: boolean): Promise<TransportReleaseResult | undefined> => {
    while (true) {
      if (!immediate) {
        const beforeSleep = stopped();
        if (beforeSleep) return beforeSleep;
        await waitForReleasePoll(Math.min(delayMs, Math.max(0, deadline - now())), options);
        delayMs = Math.min(maxDelayMs, Math.max(delayMs === 0 ? 1 : delayMs, delayMs * 2));
        const afterSleep = stopped();
        if (afterSleep) return afterSleep;
      }
      immediate = false;

      const terminal = await refresh();
      if (terminal) return terminal;
      // A transient read leaves lastReadError set. Never authorize a phase transition from stale state.
      if (lastReadError === undefined && ready()) return stopped();
    }
  };

  // Phase 1: poll O, then submit each frozen D task at most once.
  if (recursive) {
    if (hasInFlightNode()) {
      const terminal = await pollUntil(() => !hasInFlightNode(), true);
      if (terminal) return terminal;
    }
    for (const node of taskSubmissionOrder) {
      if (node.confirmedReleased) continue;
      if (!MODIFIABLE_RELEASE_STATUSES.has(node.lastStatus)) break;
      await submit(node);
      if (submissionFailed()) break;
    }

    // Phase 2: only a coherent fresh tree snapshot may authorize the parent POST.
    const preParent = await pollUntil(
      () =>
        submissionFailed() ||
        (missingIds.length === 0 &&
          (MODIFIABLE_RELEASE_STATUSES.has(requestedState.lastStatus) || requestedState.confirmedReleased) &&
          taskSubmissionOrder.every(
            (node) => MODIFIABLE_RELEASE_STATUSES.has(node.lastStatus) || node.confirmedReleased,
          )),
      true,
    );
    if (preParent) return preParent;

    if (!submissionFailed() && MODIFIABLE_RELEASE_STATUSES.has(requestedState.lastStatus)) {
      await submit(requestedState);
      const terminal = await pollUntil(finalOutcomeIsDecided, true);
      return terminal ?? finishWithoutTerminalRelease();
    }

    const terminal = await pollUntil(finalOutcomeIsDecided, false);
    return terminal ?? finishWithoutTerminalRelease();
  }

  if (IN_FLIGHT_RELEASE_STATUSES.has(requestedState.lastStatus)) {
    const terminal = await pollUntil(() => MODIFIABLE_RELEASE_STATUSES.has(requestedState.lastStatus), true);
    if (terminal) return terminal;
  }
  if (MODIFIABLE_RELEASE_STATUSES.has(requestedState.lastStatus)) await submit(requestedState);
  const terminal = await pollUntil(finalOutcomeIsDecided, true);
  return terminal ?? finishWithoutTerminalRelease();
}

/** Release one request/task and return after terminal CTS state or accepted released-task disappearance. */
export async function releaseTransportAndWait(
  http: AdtHttpClient,
  safety: SafetyConfig,
  transportId: string,
  options: TransportReleaseWaitOptions = {},
): Promise<TransportReleaseResult> {
  return releaseTransportWithConvergence(http, safety, transportId, false, options);
}

/**
 * Release a parent request recursively — tasks first, then the parent — and wait until the frozen
 * parent/task set has terminal CTS evidence. Raw failed reports are preserved but final CTS state is authoritative.
 * SAP has no atomic compare-tree-and-release operation: exact/prefix transport allowlists are therefore
 * refused, and any non-frozen child observed by the mandatory pre-parent snapshot or readback makes the
 * result unverified. The fresh snapshot narrows, but cannot eliminate, the backend's GET-to-POST race.
 */
export async function releaseTransportRecursive(
  http: AdtHttpClient,
  safety: SafetyConfig,
  transportId: string,
  options: TransportReleaseWaitOptions = {},
): Promise<TransportReleaseResult> {
  return releaseTransportWithConvergence(http, safety, transportId, true, options);
}

/**
 * Remove a single object from a transport task.
 *
 * SAP ADT exposes this as the `removeobject` action on the task URI (atom rel
 * `http://www.sap.com/cts/relations/removeobject`, "Remove Locked Object"). It MUST be a
 * PUT — a POST with the same body is accepted (HTTP 200) but silently no-ops. Mirrors the
 * `changeowner` PUT in `reassignSingle`. Verified live on S/4HANA SAP_BASIS 758 and 816:
 * clears the lock so a request holding a deleted object's lingering record (lock_status="X")
 * can then be deleted.
 *
 * Release-sensitive — NOT functional on NW 7.5x (verified on 7.50): (1) the 7.50
 * `CL_ADT_TM_RESOURCE` does not honor `tm:useraction="removeobject"` (the PUT returns
 * HTTP 400 "User does not exist in the system" — the same `tm:useraction` mishandling
 * documented for `newrequest` in `createTransport`), and (2) the 7.50 transportorganizer
 * XML omits `tm:lock_status` entirely, so `parseTransportList` reports `locked:false` and
 * the `deleteTransport` filter never reaches this call. Net effect on 7.5x: the
 * `removeLockedObjects` flag is inert and `delete` still fails with the original
 * "...contains locked objects" (clean such requests in SE09/SE10). No data loss either way.
 */
async function removeTransportObject(http: AdtHttpClient, taskId: string, obj: TransportObject): Promise<void> {
  const body = `<?xml version="1.0" encoding="ASCII"?>
<tm:root xmlns:tm="${CTS_NAMESPACE_TM}"
 tm:number="${escapeXmlAttr(taskId)}"
 tm:useraction="removeobject">
  <tm:request>
    <tm:abap_object tm:pgmid="${escapeXmlAttr(obj.pgmid)}" tm:type="${escapeXmlAttr(obj.type)}" tm:name="${escapeXmlAttr(obj.name)}" tm:position="${escapeXmlAttr(obj.position)}" tm:obj_desc="${escapeXmlAttr(obj.description)}"/>
  </tm:request>
</tm:root>`;

  await http.put(`/sap/bc/adt/cts/transportrequests/${encodeURIComponent(taskId)}`, body, CTS_CONTENT_TYPE_ORGANIZER, {
    Accept: CTS_CONTENT_TYPE_ORGANIZER,
  });
}

/**
 * Delete a transport request.
 *
 * @param recursive            delete child tasks first, then the parent request.
 * @param removeLockedObjects  strip locked objects from each task before deleting. ADT refuses to
 *   delete a request/task that still holds locked objects (HTTP 400 "...contains locked objects") —
 *   e.g. when a deleted object's record lingers in the task. With this flag ARC-1 removes those
 *   objects first (the ADT "Remove Locked Object" operation) so the request can be discarded.
 */
export async function deleteTransport(
  http: AdtHttpClient,
  safety: SafetyConfig,
  transportId: string,
  recursive = false,
  removeLockedObjects = false,
): Promise<void> {
  checkTransport(safety, transportId, 'DeleteTransport', true);

  if (recursive || removeLockedObjects) {
    const transport = await getTransport(http, safety, transportId);
    if (transport) {
      for (const task of transport.tasks) {
        if (task.status === 'R') continue;
        if (removeLockedObjects) {
          for (const obj of task.objects.filter((o) => o.locked)) {
            checkTransport(safety, task.id, 'RemoveTransportObject', true);
            await removeTransportObject(http, task.id, obj);
          }
        }
        if (recursive) {
          checkTransport(safety, task.id, 'DeleteTransport', true);
          await http.delete(`/sap/bc/adt/cts/transportrequests/${encodeURIComponent(task.id)}`);
        }
      }
    }
  }

  await http.delete(`/sap/bc/adt/cts/transportrequests/${encodeURIComponent(transportId)}`);
}

/**
 * Remove a single object from a transport request, keeping the request itself.
 *
 * The full CTS object key is (pgmid, type, name) — the OBJECT type alone does NOT determine the
 * PGMID (e.g. object type COMM is valid under both R3OB and LIMU; SAP message TR220), so all three
 * are required and matched together. ARC-1 resolves the entry from the request's actual object list
 * (which carries the real `position` the removeobject PUT needs) and removes it via the ADT
 * "Remove Locked Object" operation — regardless of whether the entry is locked.
 *
 * Use this to clean an object out of a request you want to KEEP (e.g. an object you created and then
 * deleted without transporting it onward). To discard the whole request, use deleteTransport.
 */
export async function removeObjectFromTransport(
  http: AdtHttpClient,
  safety: SafetyConfig,
  transportId: string,
  pgmid: string,
  type: string,
  name: string,
): Promise<{ taskId: string; object: TransportObject }> {
  checkTransport(safety, transportId, 'RemoveTransportObject', true);

  const transport = await getTransport(http, safety, transportId);
  if (!transport) {
    throw new Error(`Transport request ${transportId} not found.`);
  }

  const wantPgmid = pgmid.trim().toUpperCase();
  const wantType = type.trim().toUpperCase();
  const wantName = name.trim().toUpperCase();

  for (const task of transport.tasks) {
    const match = task.objects.find(
      (o) =>
        o.pgmid.toUpperCase() === wantPgmid && o.type.toUpperCase() === wantType && o.name.toUpperCase() === wantName,
    );
    if (match) {
      checkTransport(safety, task.id, 'RemoveTransportObject', true);
      await removeTransportObject(http, task.id, match);
      return { taskId: task.id, object: match };
    }
  }

  throw new Error(
    `Object ${wantPgmid} ${wantType} ${wantName} is not in transport ${transportId} (checked all tasks).`,
  );
}

/** Reassign a transport request to a new owner */
export async function reassignTransport(
  http: AdtHttpClient,
  safety: SafetyConfig,
  transportId: string,
  newOwner: string,
  recursive = false,
): Promise<void> {
  checkTransport(safety, transportId, 'ReassignTransport', true);

  if (recursive) {
    const transport = await getTransport(http, safety, transportId);
    if (transport) {
      for (const task of transport.tasks) {
        if (task.status !== 'R') {
          checkTransport(safety, task.id, 'ReassignTransport', true);
          await reassignSingle(http, task.id, newOwner);
        }
      }
    }
  }

  await reassignSingle(http, transportId, newOwner);
}

async function reassignSingle(http: AdtHttpClient, transportId: string, newOwner: string): Promise<void> {
  const body = `<?xml version="1.0" encoding="ASCII"?>
<tm:root xmlns:tm="${CTS_NAMESPACE_TM}"
 tm:number="${escapeXmlAttr(transportId)}"
 tm:targetuser="${escapeXmlAttr(newOwner)}"
 tm:useraction="changeowner"/>`;

  await http.put(
    `/sap/bc/adt/cts/transportrequests/${encodeURIComponent(transportId)}`,
    body,
    CTS_CONTENT_TYPE_ORGANIZER,
    { Accept: CTS_CONTENT_TYPE_ORGANIZER },
  );
}

// ─── Transport Info (pre-flight check) ──────────────────────────────

/** Transport requirement info returned by the CTS transport checks endpoint */
export interface TransportInfo {
  /** Whether transport recording is required ('X' = required, '' = not needed) */
  recording: boolean;
  /** Whether the package is a local package (no transport needed) */
  isLocal: boolean;
  /** Delivery unit: 'LOCAL' for local packages, transport layer name otherwise */
  deliveryUnit: string;
  /** Package name */
  devclass: string;
  /** SAP's echoed operation: `I` for create/insert, empty for modify. */
  operation: string;
  /** SAP transport-check result code (normally `S`). */
  result: string;
  /** Whether SAP returned `KORRFLAG=X` (informational; not reliable as the sole requirement signal). */
  correctionFlag: boolean;
  /** Whether SAP requires selection from an existing request (`EXISTING_REQ_ONLY=X`). */
  existingRequestOnly: boolean;
  /** Diagnostics returned inside the HTTP-200 transport-check response. */
  messages: Array<{ severity: string; text: string; messageClass: string; number: string }>;
  /** Available existing transports the object could be added to */
  existingTransports: Array<{ id: string; description: string; owner: string }>;
  /** If the object is already locked in a transport */
  lockedTransport?: string;
  /** Owner of the parent request holding the object lock. */
  lockedTransportOwner?: string;
  /** Tasks below the parent request holding the object lock. */
  lockedTasks: string[];
}

/**
 * Check transport requirements for an object URL and package.
 *
 * Calls POST /sap/bc/adt/cts/transportchecks to determine whether a
 * transport number is needed for object creation/modification. This is the
 * same endpoint used by ADT Eclipse and abap-adt-api's `transportInfo()`.
 *
 * @param objectUrl - ADT object URL (e.g., `/sap/bc/adt/oo/classes/zcl_foo`)
 * @param devclass - Package name (e.g., `$TMP`, `Z_RAP_VB_1`)
 * @param operation - `I` for insert/create, empty string for modify (default: `I`)
 */
export async function getTransportInfo(
  http: AdtHttpClient,
  safety: SafetyConfig,
  objectUrl: string,
  devclass: string,
  operation: 'I' | '' = 'I',
): Promise<TransportInfo> {
  // Transport info is a read operation — doesn't require allowTransportWrites.
  checkOperation(safety, OperationType.Read, 'TransportInfo');

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
    <DATA>
      <DEVCLASS>${escapeXmlAttr(devclass)}</DEVCLASS>
      <URI>${escapeXmlAttr(objectUrl)}</URI>
      <OPERATION>${escapeXmlAttr(operation)}</OPERATION>
    </DATA>
  </asx:values>
</asx:abap>`;

  const resp = await http.post(
    '/sap/bc/adt/cts/transportchecks',
    body,
    'application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.transport.service.checkData',
    { Accept: 'application/vnd.sap.as+xml' },
  );

  const info = parseTransportInfo(resp.body);
  const fatalMessages = info.messages.filter((message) =>
    ['E', 'A', 'X'].includes(message.severity.trim().toUpperCase()),
  );
  if (fatalMessages.length > 0) {
    const detail = fatalMessages
      .slice(0, 5)
      .map((message) => message.text || `${message.messageClass} ${message.number}`.trim())
      .filter(Boolean)
      .join('; ');
    throw new Error(`SAP transport check failed${detail ? `: ${detail}` : ''}`);
  }
  return info;
}

/**
 * Read the current transport lock for an ABAP object via its `/transports` endpoint.
 *
 * The endpoint returns a `com.sap.adt.lock.result2` payload with flat
 * `<DATA><CORRNR>…<CORRUSER>…<CORRTEXT>…</DATA>` when the object is
 * currently locked (CORRNR is the parent K-request, already resolved
 * by SAP). Empty body is normal for unlocked objects. 404 is normal
 * for object types that don't expose this subresource (e.g. TABL, DDLS,
 * BDEF, PROG on NetWeaver) — treated like empty so callers can fall
 * back to `transportchecks`.
 */
export async function getObjectTransports(
  http: AdtHttpClient,
  safety: SafetyConfig,
  objectUrl: string,
): Promise<{
  lockedTransport?: string;
  relatedTransports: Array<{ id: string; description: string; owner: string; status: string }>;
  candidateTransports: Array<{ id: string; description: string; owner: string }>;
}> {
  checkOperation(safety, OperationType.Read, 'GetObjectTransports');

  let body: string;
  try {
    const resp = await http.get(`${objectUrl}/transports`, { Accept: 'application/vnd.sap.as+xml' });
    body = resp.body;
  } catch (err) {
    if (err instanceof AdtApiError && err.isNotFound) {
      return { relatedTransports: [], candidateTransports: [] };
    }
    throw err;
  }

  if (!body || body.trim() === '') {
    return { relatedTransports: [], candidateTransports: [] };
  }

  const lock = parseObjectTransports(body);
  const relatedTransports: Array<{ id: string; description: string; owner: string; status: string }> = [];
  if (lock.corrNr) {
    relatedTransports.push({
      id: lock.corrNr,
      description: lock.corrText ?? '',
      owner: lock.corrUser ?? '',
      status: 'D',
    });
  }

  return {
    ...(lock.corrNr ? { lockedTransport: lock.corrNr } : {}),
    relatedTransports,
    candidateTransports: [],
  };
}

/**
 * Parse the `com.sap.adt.lock.result2` shape returned by
 * `GET {objectUrl}/transports`. Flat CORRNR/CORRUSER/CORRTEXT on DATA.
 */
function parseObjectTransports(xml: string): { corrNr?: string; corrUser?: string; corrText?: string } {
  const parsed = parseXml(xml);
  const corrNr = String(findDeepValue(parsed, 'CORRNR') ?? '').trim();
  const corrUser = String(findDeepValue(parsed, 'CORRUSER') ?? '').trim();
  const corrText = String(findDeepValue(parsed, 'CORRTEXT') ?? '').trim();
  return {
    ...(corrNr ? { corrNr } : {}),
    ...(corrUser ? { corrUser } : {}),
    ...(corrText ? { corrText } : {}),
  };
}

/** Parse transport check response XML */
function parseTransportInfo(xml: string): TransportInfo {
  const parsed = parseXml(xml);

  // Extract flat fields from DATA element
  const recording = String(findDeepValue(parsed, 'RECORDING') ?? '') === 'X';
  const isLocal = String(findDeepValue(parsed, 'DLVUNIT') ?? '') === 'LOCAL';
  const deliveryUnit = String(findDeepValue(parsed, 'DLVUNIT') ?? '');
  const devclass = String(findDeepValue(parsed, 'DEVCLASS') ?? '');
  const operation = String(findDeepValue(parsed, 'OPERATION') ?? '');
  const result = String(findDeepValue(parsed, 'RESULT') ?? '');
  const correctionFlag = String(findDeepValue(parsed, 'KORRFLAG') ?? '') === 'X';
  const existingRequestOnly = String(findDeepValue(parsed, 'EXISTING_REQ_ONLY') ?? '') === 'X';

  const messageContainer = findDeepNodes(parsed, 'MESSAGES')[0];
  const messageNodes = messageContainer ? findDeepNodes(messageContainer, 'CTS_MESSAGE') : [];
  const messages = messageNodes.map((message) => ({
    severity: String(message.SEVERITY ?? ''),
    text: String(message.TEXT ?? ''),
    messageClass: String(message.ARBGB ?? ''),
    number: String(message.MSGNR ?? ''),
  }));

  // Live 7.50/7.58/8.16 shape:
  // LOCKS/CTS_OBJECT_LOCK/LOCK_HOLDER/REQ_HEADER + TASK_HEADERS/CTS_TASK_HEADER.
  // Keep LOCKS/HEADER below as a compatibility fallback for older recorded fixtures.
  const lockContainer = findDeepNodes(parsed, 'LOCKS')[0];
  let lockedTransport: string | undefined;
  let lockedTransportOwner: string | undefined;
  const lockedTasks: string[] = [];
  if (lockContainer) {
    const objectLocks = findDeepNodes(lockContainer, 'CTS_OBJECT_LOCK');
    for (const objectLock of objectLocks) {
      const holder = findDeepNodes(objectLock, 'LOCK_HOLDER')[0];
      if (!holder) continue;
      const header = findDeepNodes(holder, 'REQ_HEADER')[0];
      const trkorr = String(header?.TRKORR ?? '').trim();
      if (trkorr && !lockedTransport) {
        lockedTransport = trkorr;
        const owner = String(header?.AS4USER ?? '').trim();
        if (owner) lockedTransportOwner = owner;
      }
      for (const task of findDeepNodes(holder, 'CTS_TASK_HEADER')) {
        const taskId = String(task.TRKORR ?? '').trim();
        if (taskId && !lockedTasks.includes(taskId)) lockedTasks.push(taskId);
      }
    }

    if (!lockedTransport) {
      const legacyHeader = findDeepNodes(lockContainer, 'HEADER')[0];
      const trkorr = String(legacyHeader?.TRKORR ?? '').trim();
      if (trkorr) {
        lockedTransport = trkorr;
        const owner = String(legacyHeader?.AS4USER ?? '').trim();
        if (owner) lockedTransportOwner = owner;
      }
    }
  }

  // Live shape: REQUESTS contains 0..N CTS_REQUEST nodes, each with its own REQ_HEADER.
  // Iterate CTS_REQUEST explicitly: findDeepNodes() deliberately returns the first matching
  // branch and would otherwise lose all but the first header.
  const existingTransports: TransportInfo['existingTransports'] = [];
  const addHeader = (header: Record<string, unknown> | undefined): void => {
    if (!header) return;
    const id = String(header.TRKORR ?? '').trim();
    if (!id || existingTransports.some((transport) => transport.id === id)) return;
    existingTransports.push({
      id,
      description: String(header.AS4TEXT ?? ''),
      owner: String(header.AS4USER ?? ''),
    });
  };

  const requestContainer = findDeepNodes(parsed, 'REQUESTS')[0];
  if (requestContainer) {
    for (const request of findDeepNodes(requestContainer, 'CTS_REQUEST')) {
      addHeader(findDeepNodes(request, 'REQ_HEADER')[0]);
    }
  }

  // Compatibility fallback for the simplified/legacy shape ARC-1 supported before the live
  // contract was captured. It is intentionally secondary so lock headers never become candidates.
  if (existingTransports.length === 0) {
    const legacyTransports = findDeepNodes(parsed, 'TRANSPORTS')[0];
    if (legacyTransports) {
      for (const header of findDeepNodes(legacyTransports, 'headers')) addHeader(header);
    }
  }

  return {
    recording,
    isLocal,
    deliveryUnit,
    devclass,
    operation,
    result,
    correctionFlag,
    existingRequestOnly,
    messages,
    existingTransports,
    lockedTasks,
    ...(lockedTransport ? { lockedTransport } : {}),
    ...(lockedTransportOwner ? { lockedTransportOwner } : {}),
  };
}

/** Deep value finder for flat XML structures */
function findDeepValue(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findDeepValue(item, key);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const record = obj as Record<string, unknown>;
  if (key in record) return record[key];
  for (const val of Object.values(record)) {
    const found = findDeepValue(val, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

// ─── Parsers ────────────────────────────────────────────────────────

function parseTransportList(xml: string): TransportRequest[] {
  const parsed = parseXml(xml);
  const requests = findDeepNodes(parsed, 'request');

  return requests.map((req) => {
    const tasks: TransportTask[] = findDeepNodes(req, 'task').map((t) => {
      // Objects are collected per <task>. The ADT transportorganizer XML nests <abap_object>
      // under <task>, not directly under <request>, so request-level entries (rare, e.g. some
      // non-workbench request shapes) are not represented here — which is why `removeLockedObjects`
      // in deleteTransport iterates tasks. `tm:lock_status` is "X" when locked; absent on NW 7.5x.
      const objects: TransportObject[] = findDeepNodes(t, 'abap_object').map((o) => ({
        pgmid: String(o['@_pgmid'] ?? ''),
        type: String(o['@_type'] ?? ''),
        name: String(o['@_name'] ?? ''),
        wbtype: String(o['@_wbtype'] ?? ''),
        description: String(o['@_obj_desc'] ?? o['@_obj_info'] ?? ''),
        locked: String(o['@_lock_status'] ?? '') === 'X',
        position: String(o['@_position'] ?? '000000'),
      }));

      return {
        id: String(t['@_number'] ?? ''),
        description: String(t['@_desc'] ?? ''),
        owner: String(t['@_owner'] ?? ''),
        status: String(t['@_status'] ?? ''),
        objects,
      };
    });

    // Request-level <tm:abap_object> children, read STRUCTURALLY.
    //
    // findDeepNodes must not be used here: it only stops early when the key is a DIRECT
    // property, and on the common shape (objects only under tasks) it recurses into <tm:task>
    // and returns the first task's objects — which would duplicate them onto the request and
    // stamp them with the request id instead of their task's.
    const directObjects = req.abap_object;
    const requestObjects: TransportObject[] = (
      Array.isArray(directObjects) ? directObjects : directObjects ? [directObjects] : []
    )
      .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
      .map((o) => ({
        pgmid: String(o['@_pgmid'] ?? ''),
        type: String(o['@_type'] ?? ''),
        name: String(o['@_name'] ?? ''),
        wbtype: String(o['@_wbtype'] ?? ''),
        description: String(o['@_obj_desc'] ?? o['@_obj_info'] ?? ''),
        locked: String(o['@_lock_status'] ?? '') === 'X',
        position: String(o['@_position'] ?? '000000'),
      }));

    return {
      id: String(req['@_number'] ?? ''),
      description: String(req['@_desc'] ?? ''),
      owner: String(req['@_owner'] ?? ''),
      status: String(req['@_status'] ?? ''),
      type: String(req['@_type'] ?? ''),
      target: String(req['@_target'] ?? ''),
      targetDesc: String(req['@_target_desc'] ?? ''),
      tasks,
      ...(requestObjects.length ? { requestObjects } : {}),
    };
  });
}
