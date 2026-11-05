import { AdtApiError, AdtSafetyError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import { type NativeXmlElement, nativeXmlRoot } from './native-xml-evidence.js';
import { supportsExplicitTransportTarget } from './transport.js';
import { CTS_CONTENT_TYPE_ORGANIZER, CTS_NAMESPACE_TM as NS } from './transport-contract.js';
import type { TransportObject } from './types.js';

export interface CtsNode {
  id: string;
  kind: 'request' | 'task';
  status: string;
  owner: string;
  type: string;
  target: string;
  description?: string;
  objects: Array<TransportObject & { lockKnown: boolean }>;
}

export interface CtsTree {
  parent?: CtsNode;
  tasks: CtsNode[];
}

export function ctsId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Z0-9]{1,20}$/.test(value))
    throw new AdtSafetyError('CTS requires an exact canonical request or task ID.');
  return value;
}

const attr = (node: NativeXmlElement, name: string) => node.attribute(name, NS);

function required(node: NativeXmlElement, name: string): string {
  const value = attr(node, name);
  if (!value || value !== value.trim() || value.length > 256)
    throw new AdtSafetyError('Native CTS identity/state is missing or ambiguous.');
  return value;
}

export const ctsObjectKey = (object: Pick<TransportObject, 'pgmid' | 'type' | 'name' | 'position'>) =>
  JSON.stringify([object.pgmid, object.type, object.name, object.position]);

function completeNode(node: NativeXmlElement, allowed: readonly string[]): void {
  const fields = node.canonicalValue({}) as Array<[string, unknown]>;
  for (const [key] of fields) {
    if (key === 'text') throw new AdtSafetyError('Unexpected CTS inventory text.');
    const [kind, namespace, name] = JSON.parse(key) as string[];
    if (kind === 'attribute' && /trunc|hasmore|count|next|page/i.test(name))
      throw new AdtSafetyError('CTS inventory has unqualified completeness metadata.');
    if (
      kind === 'element' &&
      !(
        (namespace === NS && allowed.includes(name)) ||
        (namespace === 'http://www.w3.org/2005/Atom' && name === 'link')
      )
    )
      throw new AdtSafetyError('CTS inventory contains an unqualified native child shape.');
  }
  for (const link of node.children('link', 'http://www.w3.org/2005/Atom'))
    if (['next', 'last'].includes(link.attribute('rel', '') ?? ''))
      throw new AdtSafetyError('Paged CTS evidence is incomplete.');
}

function nodeEvidence(node: NativeXmlElement, kind: CtsNode['kind']): CtsNode {
  completeNode(
    node,
    kind === 'request'
      ? ['task', 'abap_object', 'all_objects', 'long_desc', 'attributes']
      : ['abap_object', 'long_desc', 'attributes'],
  );
  const objects = node.children('abap_object', NS).map((entry): TransportObject & { lockKnown: boolean } => {
    const lock = attr(entry, 'lock_status');
    if (lock !== undefined && lock !== '' && lock !== 'X') throw new AdtSafetyError('Unknown CTS lock state.');
    const object = {
      pgmid: required(entry, 'pgmid'),
      type: required(entry, 'type'),
      name: required(entry, 'name'),
      position: required(entry, 'position'),
      description: attr(entry, 'obj_desc') ?? attr(entry, 'obj_info') ?? '',
      wbtype: attr(entry, 'wbtype') ?? '',
      locked: lock === 'X',
      lockKnown: lock !== undefined,
    };
    if (
      object.pgmid.length > 4 ||
      object.type.length > 4 ||
      object.name.length > 120 ||
      !/^[0-9]{6}$/.test(object.position)
    )
      throw new AdtSafetyError('Unqualified native CTS object key widths or position.');
    return object;
  });
  if (objects.length > 1000 || new Set(objects.map(ctsObjectKey)).size !== objects.length)
    throw new AdtSafetyError('CTS object inventory is oversized or contains ambiguous duplicate keys.');
  const type = kind === 'request' ? required(node, 'type') : (attr(node, 'type') ?? '');
  // K/W/T are established organizer request families. Other categories require separate native proof.
  if (kind === 'request' && !['K', 'W', 'T'].includes(type)) throw new AdtSafetyError('Unqualified CTS request type.');
  const status = required(node, 'status');
  if (!['D', 'L', 'O', 'P', 'R', 'N'].includes(status)) throw new AdtSafetyError('Unqualified CTS state.');
  const target = attr(node, 'target') ?? '';
  if (target.length > 64 || target !== target.trim()) throw new AdtSafetyError('Invalid native CTS routing metadata.');
  return {
    id: ctsId(required(node, 'number')),
    kind,
    type,
    status,
    owner: required(node, 'owner'),
    target,
    description: attr(node, 'desc'),
    objects,
  };
}

/** A successful, typed organizer read is required for absence; HTTP 404 alone is never proof. */
export function parseCtsTree(body: string, parent: string): CtsTree {
  const root = nativeXmlRoot(body, 'root', NS, true);
  completeNode(root, ['request', 'task']);
  const requests = root.children('request', NS);
  const siblings = root.children('task', NS);
  if (!requests.length && !siblings.length) return { tasks: [] };
  if (requests.length !== 1 || attr(requests[0], 'number') !== parent)
    throw new AdtSafetyError('CTS response does not identify exactly the selected parent request.');
  const request = requests[0];
  if (attr(request, 'parent')) throw new AdtSafetyError('CTS parent request has a parent.');
  const tasks = [...request.children('task', NS), ...siblings];
  if (tasks.length > 256) throw new AdtSafetyError('CTS task inventory exceeds 256 entries.');
  const evidence = tasks.map((task) => {
    const ref = attr(task, 'parent');
    if (
      (siblings.includes(task) && !ref) ||
      (ref && ref !== parent && ref !== `/sap/bc/adt/cts/transportrequests/${parent}`)
    )
      throw new AdtSafetyError('CTS task has a conflicting or missing parent.');
    if (task.hasChild('task')) throw new AdtSafetyError('Nested CTS task trees are unqualified.');
    return nodeEvidence(task, 'task');
  });
  if (new Set([parent, ...evidence.map((task) => task.id)]).size !== evidence.length + 1)
    throw new AdtSafetyError('CTS membership contains duplicate IDs.');
  return { parent: nodeEvidence(request, 'request'), tasks: evidence };
}

export async function readCtsTree(http: AdtHttpClient, parent: string): Promise<CtsTree> {
  const response = await http.get(`/sap/bc/adt/cts/transportrequests/${ctsId(parent)}`, {
    Accept: CTS_CONTENT_TYPE_ORGANIZER,
  });
  return parseCtsTree(response.body, parent);
}

export function assertCtsMembers(
  tree: CtsTree,
  frozen: readonly string[],
  removed: ReadonlySet<string> = new Set(),
): void {
  const actual = [tree.parent?.id, ...tree.tasks.map((task) => task.id)].filter((id): id is string => !!id);
  if (actual.some((id) => !frozen.includes(id)) || frozen.some((id) => !removed.has(id) && !actual.includes(id)))
    throw new AdtSafetyError('CTS membership changed after preflight; no further explicit mutation is allowed.');
}

export function ctsMutable(node: CtsNode): void {
  if (!['D', 'L'].includes(node.status))
    throw new AdtSafetyError('This CTS operation requires a modifiable native request/task.');
}

/** Native TMS routing value, never an ARC-1 target selector or URL. */
export function nativeCtsTarget(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:[A-Z][A-Z0-9]{2}(?:\.[0-9]{3})?|\/[A-Z0-9_]{1,30}\/)$/u.test(value))
    throw new AdtSafetyError('CTS target must be a native system, system.client or /GROUP/ value.');
  return value;
}

const EXCEPTION_NS = 'http://www.sap.com/abapxml/types/communicationframework';

export function isCtsRequestAbsent(error: unknown, parent: string): boolean {
  try {
    const id = ctsId(parent);
    if (
      !(error instanceof AdtApiError) ||
      error.statusCode !== 404 ||
      error.path !== `/sap/bc/adt/cts/transportrequests/${id}` ||
      !error.responseBody ||
      Buffer.byteLength(error.responseBody, 'utf8') > 32 * 1024
    )
      return false;
    const root = nativeXmlRoot(error.responseBody, 'exception', EXCEPTION_NS, true);
    // Diagnostic wording/language is not identity evidence. Only scalar diagnostic text is omitted.
    for (const name of ['message', 'localizedMessage']) {
      const message = root.child(name, '');
      if (message) {
        const fields = message.canonicalValue({ omitAttribute: (key, ns) => key === 'lang' && ns === '' }) as Array<
          [string, unknown]
        >;
        if (fields.length !== 1 || fields[0][0] !== 'text') return false;
      }
    }
    const actual = root.canonicalValue({
      omitChild: (name, ns, _child, depth) =>
        depth === 1 && ns === '' && ['message', 'localizedMessage'].includes(name),
    });
    const expected = nativeXmlRoot(
      `<e:exception xmlns:e="${EXCEPTION_NS}"><namespace id="com.sap.adt"/><type id="ExceptionResourceNotFound"/><properties><entry key="T100KEY-ID">SADT_RESOURCE</entry><entry key="T100KEY-NO">002</entry><entry key="T100KEY-V1">Transport Request/Task</entry><entry key="T100KEY-V2">${id}</entry></properties></e:exception>`,
      'exception',
      EXCEPTION_NS,
      true,
    ).canonicalValue({});
    return JSON.stringify(actual) === JSON.stringify(expected);
  } catch {
    return false;
  }
}

/** Call only after an acknowledged DELETE; initial/preflight reads retain their strict contract. */
export async function readCtsTreeAfterDelete(http: AdtHttpClient, parent: string): Promise<CtsTree> {
  try {
    return await readCtsTree(http, parent);
  } catch (error) {
    if (isCtsRequestAbsent(error, parent)) return { tasks: [] };
    throw error;
  }
}

function text(element: NativeXmlElement, name: string): string {
  const parent = element.canonicalValue({}) as Array<[string, unknown]>;
  const matches = parent.filter(
    ([key]) => key === JSON.stringify(['element', 'http://www.sap.com/adt/nameditem', name]),
  );
  const children = matches[0]?.[1] as Array<Array<[string, unknown]>> | undefined;
  if (matches.length !== 1 || children?.length !== 1)
    throw new AdtSafetyError('Missing or repeated native CTS value-help field.');
  const fields = children[0];
  if (fields.length === 0) return '';
  if (fields.length !== 1 || fields[0][0] !== 'text' || typeof fields[0][1] !== 'string')
    throw new AdtSafetyError('Ambiguous native CTS value-help field.');
  return fields[0][1];
}

export async function readCtsValues(http: AdtHttpClient, kind: 'layers' | 'targets') {
  if (kind === 'targets' && supportsExplicitTransportTarget(http) !== true)
    throw new AdtSafetyError('CTS target value help requires affirmative discovery evidence.');
  const response = await http.get(
    kind === 'targets'
      ? '/sap/bc/adt/cts/transportrequests/valuehelp/target?maxItemCount=200'
      : '/sap/bc/adt/packages/valuehelps/transportlayers',
    { Accept: 'application/vnd.sap.adt.nameditems.v1+xml' },
  );
  const ns = 'http://www.sap.com/adt/nameditem';
  const root = nativeXmlRoot(response.body, 'namedItemList', ns, true);
  const count = text(root, 'totalItemCount');
  const items = root.children('namedItem', ns);
  const fields = root.canonicalValue({}) as Array<[string, unknown]>;
  if (
    fields.some(
      ([key]) =>
        key === 'text' ||
        (JSON.parse(key)[0] === 'element' &&
          (JSON.parse(key)[1] !== ns || !['totalItemCount', 'namedItem'].includes(JSON.parse(key)[2]))),
    ) ||
    !/^(0|[1-9][0-9]*)$/.test(count) ||
    Number(count) !== items.length ||
    items.length >= 200
  )
    throw new AdtSafetyError('CTS value help is incomplete, truncated or exceeds the private candidate bound.');
  const values = items.map((item) => ({
    name: text(item, 'name'),
    description: text(item, 'description'),
    nativeTarget: kind === 'targets' ? text(item, 'name') : text(item, 'data'),
  }));
  if (new Set(values.map((value) => value.name)).size !== values.length)
    throw new AdtSafetyError('CTS value-help identities are ambiguous.');
  return values;
}

const ns = 'http://www.sap.com/abapxml/inactiveCtsObjects',
  core = 'http://www.sap.com/adt/core';

const requestPath = '/sap/bc/adt/cts/transportrequests/';

/** Only the established rich inventory shape can prove an entry unrelated. Unknown count/paging
 * metadata at any relevant level is not evidence of completeness, even when it says zero/false. */
function shape(
  node: NativeXmlElement,
  children: readonly string[],
  attributes: readonly string[] = [],
  attributeNs = ns,
): void {
  const fields = node.canonicalValue({
    omitChild: (name, namespace) => {
      if (namespace !== ns || !children.includes(name))
        throw new AdtSafetyError('Inactive CTS inventory has an unqualified child shape.');
      return true;
    },
  }) as Array<[string, unknown]>;
  for (const [key] of fields) {
    if (key === 'text') throw new AdtSafetyError('Inactive CTS inventory has unqualified text.');
    const [kind, namespace, name] = JSON.parse(key) as string[];
    if (
      !(kind === 'element' && namespace === ns && children.includes(name)) &&
      !(kind === 'attribute' && namespace === attributeNs && attributes.includes(name))
    )
      throw new AdtSafetyError('Inactive CTS inventory has an unqualified shape or completeness metadata.');
  }
}

function exactEmpty(node: NativeXmlElement): boolean {
  return (node.canonicalValue({}) as unknown[]).length === 0;
}

function user(node: NativeXmlElement): void {
  const value = node.attribute('user', ns);
  if (!value || value !== value.trim() || value.length > 128)
    throw new AdtSafetyError('Incomplete inactive CTS user evidence.');
}

function objectReference(node: NativeXmlElement): void {
  shape(node, [], ['uri', 'type', 'name', 'description', 'parentUri'], core);
  for (const name of ['uri', 'type', 'name']) {
    const value = node.attribute(name, core);
    if (
      !value ||
      value !== value.trim() ||
      [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    )
      throw new AdtSafetyError('Incomplete inactive CTS object evidence.');
  }
  // Object navigation is inert. It cannot provide transport assignment or package authority.
  for (const name of ['uri', 'parentUri']) {
    const value = node.attribute(name, core);
    if (value !== undefined && (!value.startsWith('/sap/bc/adt/') || /[\s\\]/.test(value)))
      throw new AdtSafetyError('Malformed inactive object reference.');
  }
}

function assignment(node: NativeXmlElement): { id: string; parentId?: string } {
  shape(node, [], ['uri', 'type', 'name', 'description', 'parentUri'], core);
  const id = node.attribute('name', core),
    uri = node.attribute('uri', core),
    parent = node.attribute('parentUri', core);
  if (!id || node.attribute('type', core) !== '/RQ')
    throw new AdtSafetyError('Incomplete inactive CTS assignment evidence.');
  ctsId(id);
  if (uri !== `${requestPath}${id}`) throw new AdtSafetyError('Conflicting or malformed inactive CTS assignment URI.');
  let parentId: string | undefined;
  if (parent !== undefined) {
    if (!parent.startsWith(requestPath)) throw new AdtSafetyError('Malformed inactive CTS parent URI.');
    parentId = ctsId(parent.slice(requestPath.length));
    if (parentId === id) throw new AdtSafetyError('Inactive CTS assignment cannot be its own parent.');
  }
  return { id, parentId };
}

export async function assertCtsNoInactive(http: AdtHttpClient, ids: readonly string[]): Promise<void> {
  const response = await http.get('/sap/bc/adt/activation/inactiveobjects', {
    Accept: 'application/vnd.sap.adt.inactivectsobjects.v1+xml',
  });
  if (
    response.statusCode !== 200 ||
    Object.keys(response.headers).some((name) => name.toLowerCase() === 'content-range')
  )
    throw new AdtSafetyError('Inactive CTS inventory is not a complete successful response.');
  const root = nativeXmlRoot(response.body, 'inactiveObjects', ns, true);
  shape(root, ['entry']);
  const entries = root.children('entry', ns);
  if (entries.length > 1000) throw new AdtSafetyError('Inactive CTS inventory exceeds its bound.');
  let selectedInactive = false;
  for (const entry of entries) {
    shape(entry, ['object', 'transport']);
    const objectNode = entry.child('object', ns),
      transportNode = entry.child('transport', ns);
    if (!objectNode || !transportNode) throw new AdtSafetyError('Missing rich inactive CTS assignment evidence.');
    shape(objectNode, ['ref'], ['user', 'deleted']);
    shape(transportNode, ['ref'], ['user', 'linked']);
    const object = objectNode.child('ref', ns),
      transport = transportNode.child('ref', ns);
    if (!object) {
      if (!exactEmpty(objectNode)) throw new AdtSafetyError('Incomplete inactive CTS object evidence.');
      if (!transport) {
        if (!exactEmpty(transportNode)) throw new AdtSafetyError('Incomplete inactive CTS assignment evidence.');
        continue; // Exact native empty slot, not a missing object/transport container.
      }
      user(transportNode);
      if (transportNode.attribute('linked', ns) !== 'false')
        throw new AdtSafetyError('Unqualified inactive CTS transport heading.');
      assignment(transport);
      continue; // A request heading is not an inactive object or an authorization receipt.
    }
    user(objectNode);
    if (!['true', 'false'].includes(objectNode.attribute('deleted', ns) ?? ''))
      throw new AdtSafetyError('Unqualified inactive CTS deletion state.');
    objectReference(object);
    if (!transport) {
      if (!exactEmpty(transportNode)) throw new AdtSafetyError('Incomplete inactive CTS assignment evidence.');
      continue; // Present, exact empty native transport slot explicitly represents no assignment.
    }
    user(transportNode);
    if (!['true', 'false'].includes(transportNode.attribute('linked', ns) ?? ''))
      throw new AdtSafetyError('Unqualified inactive CTS object assignment.');
    const { id, parentId } = assignment(transport);
    if (ids.includes(id) || (parentId !== undefined && ids.includes(parentId))) selectedInactive = true;
  }
  if (selectedInactive) throw new AdtSafetyError('Release refused: selected request/task contains inactive objects.');
}
