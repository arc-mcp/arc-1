/**
 * CTS Transport management for SAP ADT.
 *
 * Transport mutations require explicit opt-in via allowWrites + allowTransportWrites.
 * Safety checks are applied at every entry point.
 */

import { AdtApiError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import { checkOperation, checkTransport, OperationType, type SafetyConfig } from './safety.js';
import type {
  InactiveObject,
  TransportLayer,
  TransportObject,
  TransportRequest,
  TransportTarget,
  TransportTask,
} from './types.js';
import { escapeXmlAttr, findDeepNodes, parseXml } from './xml-parser.js';

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
 * request. Pass an explicit package to influence the transport route; SAP infers
 * K/W/T from the package's TADIR route, not from the request body.
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

/** A parsed `nameditem:namedItem`: identifier (`name`), human text (`description`), optional structured `data`. */
interface NamedItem {
  name: string;
  description: string;
  data: string;
}

/** Parse a `nameditem:namedItemList` value-help response (shared by transport layers + targets). */
function parseNamedItems(xml: string): NamedItem[] {
  const parsed = parseXml(xml);
  // The parser wraps some leaf elements (e.g. `data`) in single-element arrays; unwrap.
  const str = (v: unknown): string => {
    const x = Array.isArray(v) ? v[0] : v;
    return typeof x === 'string' ? x : typeof x === 'number' ? String(x) : '';
  };
  // Some items carry entity-encoded markup (e.g. "&lt;p&gt;Target: &lt;b&gt;DEV&lt;/b&gt;&lt;/p&gt;").
  // The shared parser leaves entities encoded — decode, strip tags, collapse whitespace.
  const clean = (v: unknown): string =>
    str(v)
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&') // decode &amp; last so encoded entities aren't double-decoded
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  return findDeepNodes(parsed, 'namedItem').map((item) => {
    const rec = item as Record<string, unknown>;
    // `name` is an identifier passed back verbatim (only trim); `description`/`data` get cleaned.
    return { name: str(rec.name).trim(), description: clean(rec.description), data: clean(rec.data) };
  });
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

/** Release a transport request */
export async function releaseTransport(http: AdtHttpClient, safety: SafetyConfig, transportId: string): Promise<void> {
  checkTransport(safety, transportId, 'ReleaseTransport', true);

  await http.post(
    `/sap/bc/adt/cts/transportrequests/${encodeURIComponent(transportId)}/newreleasejobs`,
    undefined,
    undefined,
    { Accept: CTS_CONTENT_TYPE_ORGANIZER },
  );
}

/** Release a transport request recursively — tasks first, then parent */
export async function releaseTransportRecursive(
  http: AdtHttpClient,
  safety: SafetyConfig,
  transportId: string,
): Promise<{ released: string[] }> {
  checkTransport(safety, transportId, 'ReleaseTransportRecursive', true);

  const transport = await getTransport(http, safety, transportId);
  const released: string[] = [];

  if (transport) {
    for (const task of transport.tasks) {
      if (task.status !== 'R') {
        checkTransport(safety, task.id, 'ReleaseTransportRecursive', true);
        await releaseTransport(http, safety, task.id);
        released.push(task.id);
      }
    }

    // Skip parent if already released (idempotent/retry-safe)
    if (transport.status === 'R') {
      return { released };
    }
  }

  await releaseTransport(http, safety, transportId);
  released.push(transportId);

  return { released };
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
  /** Available existing transports the object could be added to */
  existingTransports: Array<{ id: string; description: string; owner: string }>;
  /** If the object is already locked in a transport */
  lockedTransport?: string;
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
  operation = 'I',
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

  return parseTransportInfo(resp.body);
}

/**
 * List transport requests related to an ABAP object via the per-object
 * `/transports` endpoint.
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

  // Extract locked transport from LOCKS/HEADER
  const locks = findDeepNodes(parsed, 'LOCKS');
  let lockedTransport: string | undefined;
  if (locks.length > 0) {
    const headers = findDeepNodes(locks[0], 'HEADER');
    if (headers.length > 0) {
      const trkorr = String((headers[0] as Record<string, unknown>).TRKORR ?? '');
      if (trkorr) lockedTransport = trkorr;
    }
  }

  // Extract available transports
  const transportNodes = findDeepNodes(parsed, 'TRANSPORTS');
  const existingTransports: TransportInfo['existingTransports'] = [];
  if (transportNodes.length > 0) {
    // TRANSPORTS contains an array of transport header elements
    const headers = findDeepNodes(transportNodes[0], 'headers');
    for (const h of headers) {
      const rec = h as Record<string, unknown>;
      const id = String(rec.TRKORR ?? '');
      const description = String(rec.AS4TEXT ?? '');
      const owner = String(rec.AS4USER ?? '');
      if (id) existingTransports.push({ id, description, owner });
    }
  }

  return {
    recording,
    isLocal,
    deliveryUnit,
    devclass,
    existingTransports,
    ...(lockedTransport ? { lockedTransport } : {}),
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

    return {
      id: String(req['@_number'] ?? ''),
      description: String(req['@_desc'] ?? ''),
      owner: String(req['@_owner'] ?? ''),
      status: String(req['@_status'] ?? ''),
      type: String(req['@_type'] ?? ''),
      target: String(req['@_target'] ?? ''),
      targetDesc: String(req['@_target_desc'] ?? ''),
      tasks,
    };
  });
}
