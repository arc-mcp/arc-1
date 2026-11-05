/** Full native organizer evidence. A generic 404 never establishes CTS deletion. */
import type { AdtApiError } from '../../../src/adt/errors.js';
import type { AdtHttpClient, AdtRequestOptions, AdtResponse } from '../../../src/adt/http.js';
import { type NativeXmlElement, nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';
import { isCtsRequestAbsent } from "../../../src/adt/pinned-cts-evidence.js";
import { type CtsTree, parseCtsTree } from '../../../src/adt/pinned-cts-evidence.js';
import { CTS_CONTENT_TYPE_ORGANIZER, CTS_NAMESPACE_TM as TM } from '../../../src/adt/transport-contract.js';
import type { TransportObject } from '../../../src/adt/types.js';
import {
  CTS_BASE,
  CTS_PACKAGE,
  CTS_RESERVED,
  type CtsGraph,
  type CtsOwnedRequest,
  type CtsRound,
  type CtsStep,
} from './native-cts-fixtures.js';
import { type PackageJournal, packageHash } from './native-package-evidence.js';
export function generatedCtsId(body: string, existing: readonly string[]) {
  const id = body.trim().replace(/^\/(?:sap\/bc\/adt\/cts\/transportrequests|com\.sap\.cts\/object_record)\//, '');
  if (!/^A4HK[0-9]{6}$/.test(id) || (CTS_RESERVED as readonly string[]).includes(id) || existing.includes(id))
    throw new Error('Generated request identity unconfirmed.');
  return id;
}
export function observedCtsIds(body: string) {
  const root = nativeXmlRoot(body, 'root', TM, true);
  return [
    ...new Set(
      [
        ...root.children('request', TM),
        ...root.children('task', TM),
        ...root.children('request', TM).flatMap((r) => r.children('task', TM)),
      ]
        .map((n) => n.attribute('number', TM))
        .filter((id): id is string => !!id && /^[A-Z0-9]{1,20}$/.test(id)),
    ),
  ];
}
export interface CtsEvidence extends CtsTree {
  summaryRows: number;
}
export function assertEmptyCtsGraph(tree: CtsEvidence) {
  if (tree.summaryRows || [tree.parent, ...tree.tasks].some((node) => node?.objects.length))
    throw new Error('Exact empty CTS direct and summary inventory required.');
}
export function inspectCtsTree(body: string, parent: string): CtsEvidence {
  const tree = parseCtsTree(body, parent),
    root = nativeXmlRoot(body, 'root', TM, true);
  let summaryRows = 0;
  const summaryKeys = new Set<string>();
  for (const node of [
    ...root.children('request', TM),
    ...root.children('task', TM),
    ...root.children('request', TM).flatMap((r) => r.children('task', TM)),
  ]) {
    const id = node.attribute('number', TM);
    if (
      !id ||
      !/^A4HK[0-9]{6}$/.test(id) ||
      (CTS_RESERVED as readonly string[]).includes(id) ||
      node.attribute('target', TM) !== '' ||
      node.attribute('source_client', TM) !== '001' ||
      node.attribute('uri', TM) !== CTS_BASE + id
    )
      throw new Error('Exact native local-target/client/URI evidence required.');
    // Every native summary row is inspected as well as the normal per-node object list.
    for (const summary of node.children('all_objects', TM)) {
      summaryRows += summary.children('abap_object', TM).length;
      const fields = summary.canonicalValue({}) as Array<[string, unknown]>;
      for (const [key] of fields) {
        if (key === 'text' || JSON.parse(key)[0] !== 'element')
          throw new Error('Unqualified CTS summary completeness.');
      }
      const members = [tree.parent?.id, ...tree.tasks.map((task) => task.id)].filter(Boolean);
      summary.canonicalValue({
        omitChild: (name, namespace, child, depth) => {
          if (depth !== 1 || name !== 'abap_object' || namespace !== TM) throw new Error('Unknown CTS object summary.');
          const key = JSON.stringify(['pgmid', 'type', 'name', 'position'].map((name) => child.attribute(name, TM)));
          if (summaryKeys.has(key)) throw new Error('Duplicate CTS summary identity.');
          summaryKeys.add(key);
          assertSummaryRecord(child, members);
          return true;
        },
      });
    }
  }
  return { ...tree, summaryRows };
}
/** Native organizer navigation is inert evidence; it never selects a request or grants ownership. */
function assertSummaryRecord(row: NativeXmlElement, members: (string | undefined)[]) {
  const atom = 'http://www.w3.org/2005/Atom';
  const attributes = [
    'pgmid',
    'type',
    'name',
    'position',
    'lock_status',
    'wbtype',
    'dummy_uri',
    'obj_info',
    'obj_desc',
    'img_activity',
  ];
  const links = row.children('link', atom);
  if (links.length > 3 || new Set(links.map((link) => link.attribute('rel', ''))).size !== links.length)
    throw new Error('Ambiguous CTS summary navigation.');
  for (const [key] of row.canonicalValue({}) as Array<[string, unknown]>) {
    if (key === 'text') throw new Error('Unknown CTS summary text.');
    const [kind, namespace, name] = JSON.parse(key) as string[];
    if (
      !(
        (kind === 'attribute' && namespace === TM && attributes.includes(name)) ||
        (kind === 'element' && namespace === atom && name === 'link')
      )
    )
      throw new Error('Unknown CTS summary record shape.');
  }
  for (const link of links) {
    for (const [key] of link.canonicalValue({}) as Array<[string, unknown]>) {
      if (key === 'text') throw new Error('Unknown CTS summary link text.');
      const [kind, namespace, name] = JSON.parse(key) as string[];
      if (kind !== 'attribute' || namespace !== '' || !['href', 'rel', 'type', 'title'].includes(name))
        throw new Error('Unknown CTS summary link shape.');
    }
    const relation = ['removeobject', 'lockobject', 'moveobjects'].find(
      (name) => link.attribute('rel', '') === `http://www.sap.com/cts/relations/${name}`,
    );
    const suffix =
      relation === 'removeobject'
        ? ''
        : relation === 'lockobject' || relation === 'moveobjects'
          ? `/${relation}`
          : undefined;
    if (
      suffix === undefined ||
      link.attribute('type', '') !== 'application/xml' ||
      !members.some((member) => link.attribute('href', '') === `${CTS_BASE}${member}${suffix}`)
    )
      throw new Error('Unqualified CTS summary navigation.');
  }
}
export function bindCreatedRequest(tree: CtsEvidence, graph: CtsGraph, round: CtsRound): CtsOwnedRequest {
  assertEmptyCtsGraph(tree);
  const parent = tree.parent,
    task = tree.tasks[0];
  if (
    !parent ||
    tree.tasks.length !== 1 ||
    !task ||
    parent.owner !== 'MARIAN' ||
    task.owner !== 'MARIAN' ||
    parent.type !== 'K' ||
    parent.status !== 'D' ||
    task.status !== 'D' ||
    parent.description !== graph.descriptions[round] ||
    !['Unclassified', 'Development/Correction'].includes(task.type) ||
    parent.objects.length ||
    task.objects.length
  )
    throw new Error('Exact one-own-empty-task creation readback required.');
  return { round, parent: parent.id, task: task.id, taskType: task.type, description: parent.description };
}
export function assertCtsOwnedTree(tree: CtsTree, own: CtsOwnedRequest, graph: CtsGraph, step?: CtsStep) {
  const parent = tree.parent;
  if (!parent) throw new Error('Owned parent missing.');
  if (
    parent.id !== own.parent ||
    parent.owner !== 'MARIAN' ||
    parent.type !== 'K' ||
    parent.description !== own.description ||
    tree.tasks.some((t) => t.id !== own.task)
  )
    throw new Error('Foreign or changed CTS membership.');
  const task = tree.tasks[0];
  if (task) {
    if (
      !['MARIAN', ...(step === 'reassign-away' || step === 'reassign-back' ? ['ARC1_WG_RO'] : [])].includes(task.owner)
    )
      throw new Error('Unexpected task owner.');
    if (
      task.type !== own.taskType &&
      !(step === 'create-class' && own.taskType === 'Unclassified' && task.type === 'Development/Correction')
    )
      throw new Error('Unexpected literal task type.');
  } else if (!['R', 'N'].includes(parent.status) && step !== 'delete-recursive')
    throw new Error('Open parent lost own task.');
  const cls = graph.classes[own.round === 'B' ? 1 : 0];
  const rows = [parent, ...tree.tasks].flatMap((n) => n.objects);
  for (const row of rows) {
    // This representative owns the whole CLAS row only. Unproven LIMU/prefix matches are retained and refused.
    if (own.round === 'C' || row.pgmid !== 'R3TR' || row.type !== 'CLAS' || row.name !== cls.name || !row.lockKnown)
      throw new Error('Unproven CTS object membership.');
  }
  return rows;
}
export function assertCtsSummaries(body: string, own: CtsOwnedRequest, graph: CtsGraph) {
  const root = nativeXmlRoot(body, 'root', TM, true),
    cls = graph.classes[own.round === 'B' ? 1 : 0];
  for (const node of [
    ...root.children('request', TM),
    ...root.children('task', TM),
    ...root.children('request', TM).flatMap((r) => r.children('task', TM)),
  ])
    for (const group of node.children('all_objects', TM))
      for (const row of group.children('abap_object', TM))
        if (
          own.round === 'C' ||
          row.attribute('pgmid', TM) !== 'R3TR' ||
          row.attribute('type', TM) !== 'CLAS' ||
          row.attribute('name', TM) !== cls.name
        )
          throw new Error('Unproven native summary membership.');
}
export async function ctsRead(
  http: AdtHttpClient,
  parent: string,
  options: AdtRequestOptions,
  record: PackageJournal,
  confirmedDeleted = false,
): Promise<CtsEvidence> {
  let response: AdtResponse;
  try {
    response = await http.get(
      CTS_BASE + parent,
      { Accept: CTS_CONTENT_TYPE_ORGANIZER, 'Cache-Control': 'no-cache' },
      options,
    );
  } catch (error) {
    if (!confirmedDeleted || !isCtsRequestAbsent(error, parent)) throw error;
    const native = error as AdtApiError;
    record({
      nativeOrganizer: parent,
      status: native.statusCode,
      body: native.responseBody,
      sha256: packageHash(native.responseBody!),
      typedAbsence: true,
    });
    return { tasks: [], summaryRows: 0 } satisfies CtsEvidence;
  }
  record({
    nativeOrganizer: parent,
    status: response.statusCode,
    body: response.body,
    sha256: packageHash(response.body),
  });
  if (response.statusCode !== 200) throw new Error('Successful typed organizer read required.');
  return inspectCtsTree(response.body, parent);
}
export async function ctsPackage(http: AdtHttpClient, options: AdtRequestOptions, record: PackageJournal) {
  const response = await http.get(
    `/sap/bc/adt/packages/${CTS_PACKAGE}`,
    { Accept: 'application/*', 'Cache-Control': 'no-cache' },
    options,
  );
  const sha256 = packageHash(response.body);
  record({ package: CTS_PACKAGE, status: response.statusCode, sha256, body: response.body });
  const core = 'http://www.sap.com/adt/core',
    ns = 'http://www.sap.com/adt/packages';
  const root = nativeXmlRoot(response.body, 'package', ns, true),
    attributes = root.child('attributes', ns),
    transport = root.child('transport', ns);
  // Source-backed actual package shape. The complete canonical receipt is freshly bound by preflight;
  // the shared repository writer still performs its own package/recording authorization.
  if (
    response.statusCode !== 200 ||
    root.attribute('name', core) !== CTS_PACKAGE ||
    root.attribute('type', core) !== 'DEVC/K' ||
    root.attribute('version', core) !== 'active' ||
    root.attribute('responsible', core) !== 'MARIAN' ||
    root.attribute('masterSystem', core) !== 'A4H' ||
    root.child('packageRef', core)?.attribute('name', core) !== CTS_PACKAGE ||
    attributes?.attribute('recordChanges', ns) !== 'true' ||
    attributes.attribute('packageType', ns) !== 'development' ||
    transport?.child('softwareComponent', ns)?.attribute('name', ns) !== 'HOME' ||
    transport.child('transportLayer', ns)?.attribute('name', ns) !== ''
  )
    throw new Error('Fresh fixed recording-package receipt changed.');
  return packageHash(JSON.stringify(root.canonicalValue({})));
}
export function classEntry(tree: CtsTree, own: CtsOwnedRequest, graph: CtsGraph): TransportObject {
  const rows = assertCtsOwnedTree(tree, own, graph),
    task = tree.tasks.find((t) => t.id === own.task);
  if (!task || rows.length !== 1 || task.objects.length !== 1 || !task.objects[0].lockKnown)
    throw new Error('Exactly one full own task CLAS entry required.');
  return task.objects[0];
}
