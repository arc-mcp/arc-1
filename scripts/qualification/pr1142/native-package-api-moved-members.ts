/** Exact observed 609/610/611 recording graph, not permission to create or adopt further tasks. */
import { nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';
import { ctsObjectKey, parseCtsTree } from '../../../src/adt/pinned-cts-evidence.js';
import { CTS_NAMESPACE_TM as NS } from '../../../src/adt/transport-contract.js';
import { PACKAGE_API_MOVED_PAIR } from './native-package-api-moved-fixed.js';
import { packageApiDescription } from './native-package-api-profile.js';
import type { PackageGraph } from './native-package-fixtures.js';

export function inspectMovedPackageRequest(body: string, graph: PackageGraph, apiResource?: string, initial = false) {
  const pair = PACKAGE_API_MOVED_PAIR,
    tree = parseCtsTree(body, pair.request);
  const root = nativeXmlRoot(body, 'root', NS, true),
    parent = root.child('request', NS);
  const core = 'http://www.sap.com/adt/core';
  if (
    root.attribute('name', core) !== pair.request ||
    root.attribute('type', core) !== 'RQRQ' ||
    root.attribute('object_type', NS) !== 'R' ||
    root.attribute('createdBy', core) !== 'MARIAN' ||
    tree.parent?.owner !== 'MARIAN' ||
    tree.parent.type !== 'K' ||
    tree.parent.status !== 'D' ||
    tree.parent.description !== packageApiDescription(graph) ||
    parent?.attribute('target', NS) !== '' ||
    parent.attribute('source_client', NS) !== '001' ||
    tree.tasks.length !== 2
  )
    throw new Error('Moved request identity/state/target differs.');
  const tasks = [...parent.children('task', NS), ...root.children('task', NS)];
  for (const task of tree.tasks) {
    const node = tasks.find((n) => n.attribute('number', NS) === task.id);
    const original = task.id === pair.originalTask;
    if (
      (!original && task.id !== pair.task) ||
      task.owner !== 'MARIAN' ||
      task.status !== 'D' ||
      task.type !== (original ? 'Unclassified' : 'Development/Correction') ||
      task.description !== (original ? packageApiDescription(graph) : '') ||
      node?.attribute('parent', NS) !== pair.request ||
      node.attribute('target', NS) !== '' ||
      node.attribute('source_client', NS) !== '001' ||
      (original && task.objects.length)
    )
      throw new Error('Exact moved request task membership differs.');
  }
  const all = [tree.parent, ...tree.tasks].flatMap((node) => node.objects);
  if (
    all.some(
      (row) =>
        row.pgmid !== 'R3TR' ||
        !(
          (row.type === 'CLAS' && row.name === graph.clas.name) ||
          (!initial &&
            row.type === 'APIS' &&
            apiResource === `/sap/bc/adt/apireleases/apis/${encodeURIComponent(row.name)}`)
        ),
    ) ||
    new Set(all.map(ctsObjectKey)).size !== all.length
  )
    throw new Error('Foreign or ambiguous moved-request recording.');
  if (
    initial &&
    (tree.parent.objects.length ||
      all.length !== 1 ||
      tree.tasks.find((n) => n.id === pair.task)?.objects.length !== 1 ||
      all[0].position !== '000001' ||
      all[0].wbtype !== 'CLAS/OC' ||
      !all[0].lockKnown ||
      !all[0].locked)
  )
    throw new Error('Initial moved class recording differs.');
  // The native parent aggregate is a projection, not extra ownership. It must agree with direct rows.
  const aggregate = parent.child('all_objects', NS);
  if (
    !aggregate ||
    (aggregate.canonicalValue({}) as Array<[string, unknown]>).some(([key]) => {
      if (key === 'text') return true;
      const [kind, ns, name] = JSON.parse(key) as string[];
      return kind !== 'element' || ns !== NS || name !== 'abap_object';
    })
  )
    throw new Error('Unqualified moved-request aggregate.');
  const aggregateKeys = aggregate
    .children('abap_object', NS)
    .map((row) => JSON.stringify(['pgmid', 'type', 'name', 'position'].map((key) => row.attribute(key, NS))));
  const directKeys = all.map(ctsObjectKey);
  if (
    new Set(aggregateKeys).size !== aggregateKeys.length ||
    aggregateKeys.length !== directKeys.length ||
    aggregateKeys.some((key) => !directKeys.includes(key))
  )
    throw new Error('Moved request aggregate/direct membership differs.');
  return tree;
}
