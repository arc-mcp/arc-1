import { AdtSafetyError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import { checkTransport, type SafetyConfig } from './safety.js';
import { CTS_CONTENT_TYPE_ORGANIZER, CTS_NAMESPACE_TM } from './transport-contract.js';
import type { TransportObject } from './types.js';
import { escapeXmlAttr } from './xml-parser.js';

/** Private adapter entry; full native key is preflighted by its caller, and both guards stay mandatory. */
export async function removePinnedTransportEntry(
  http: AdtHttpClient,
  safety: SafetyConfig,
  taskId: string,
  object: TransportObject,
  operation: 'RemoveTransportObject' | 'DeleteTransportObject',
): Promise<void> {
  if (!safety.multiTargetWrite) throw new AdtSafetyError('Pinned CTS entry removal requires a verified scope.');
  checkTransport(safety, taskId, operation, true, http);
  await removeTransportObject(http, taskId, object);
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
export async function removeTransportObject(http: AdtHttpClient, taskId: string, obj: TransportObject): Promise<void> {
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
