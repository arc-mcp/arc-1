/**
 * CTS Transport management for SAP ADT.
 *
 * Transport mutations require explicit opt-in via allowWrites + allowTransportWrites.
 * Safety checks are applied at every entry point.
 */

import { AdtApiError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import { checkOperation, checkTransport, OperationType, type SafetyConfig } from './safety.js';
import type { TransportObject, TransportRequest, TransportTask } from './types.js';
import { escapeXmlAttr, findDeepNodes, parseXml } from './xml-parser.js';

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
 * Uses POST `/sap/bc/adt/cts/transports` (the same endpoint Eclipse ADT and
 * marcellourbani/abap-adt-api use). The legacy POST `/cts/transportrequests`
 * path with a `<tm:root tm:useraction="newrequest">` body is rejected by
 * NW 7.5x with HTTP 400 "user action  is not supported" because that release's
 * `CL_ADT_TM_RESOURCE` only accepts `useraction` on PUT operations
 * (changeowner, release). Verified against NW 7.51 SP02.
 *
 * SAP infers the transport type (K/W/T) from the package's transport route
 * configured in TADIR, so the legacy `transportType` argument is ignored
 * by the backend and kept here only for API compatibility.
 *
 * @param targetPackage required — DEVCLASS the transport is created for
 * @param objectUrl optional — ADT object URL hint for transport-route lookup;
 *                  the object is NOT locked or attached to the transport
 */
export async function createTransport(
  http: AdtHttpClient,
  safety: SafetyConfig,
  description: string,
  targetPackage: string,
  _transportType = 'K',
  objectUrl?: string,
): Promise<string> {
  checkTransport(safety, '', 'CreateTransport', true);

  if (!targetPackage) {
    throw new Error(
      'createTransport: targetPackage (DEVCLASS) is required by the ADT CreateCorrectionRequest endpoint.',
    );
  }

  const refXml = objectUrl ? `<REF>${escapeXmlAttr(objectUrl)}</REF>` : '<REF/>';
  const body = `<?xml version="1.0" encoding="UTF-8"?><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
    <DATA>
      <DEVCLASS>${escapeXmlAttr(targetPackage)}</DEVCLASS>
      <REQUEST_TEXT>${escapeXmlAttr(description)}</REQUEST_TEXT>
      ${refXml}
      <OPERATION>I</OPERATION>
    </DATA>
  </asx:values>
</asx:abap>`;

  const resp = await http.post(
    '/sap/bc/adt/cts/transports',
    body,
    'application/vnd.sap.as+xml; charset=UTF-8; dataname=com.sap.adt.CreateCorrectionRequest',
    { Accept: 'text/plain' },
  );

  // Response body is a path like "/com.sap.cts/object_record/NEDK928884" —
  // the transport ID is the last path segment.
  const transportId =
    String(resp.body ?? '')
      .trim()
      .split('/')
      .pop() ?? '';
  return transportId;
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

/** Delete a transport request */
export async function deleteTransport(
  http: AdtHttpClient,
  safety: SafetyConfig,
  transportId: string,
  recursive = false,
): Promise<void> {
  checkTransport(safety, transportId, 'DeleteTransport', true);

  if (recursive) {
    const transport = await getTransport(http, safety, transportId);
    if (transport) {
      for (const task of transport.tasks) {
        if (task.status !== 'R') {
          checkTransport(safety, task.id, 'DeleteTransport', true);
          await http.delete(`/sap/bc/adt/cts/transportrequests/${encodeURIComponent(task.id)}`);
        }
      }
    }
  }

  await http.delete(`/sap/bc/adt/cts/transportrequests/${encodeURIComponent(transportId)}`);
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
      tasks,
    };
  });
}
