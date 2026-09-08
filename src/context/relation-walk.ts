import { AdtApiError, AdtNetworkError, AdtResponseLimitError } from '../adt/errors.js';
import { type AdtRequestOptions, throwIfRequestCancelled } from '../adt/http-deadline.js';
import type { RelationDirection, RelationEdge, RelationNetwork, RelationObject } from '../adt/repository-relations.js';
import { RelationProtocolError } from '../adt/repository-relations.js';
import { AdtRequestBudgetError } from '../adt/request-attempt-budget.js';

export const RELATION_LIMITS = Object.freeze({
  nodes: 100,
  edges: 100,
  expansions: 8,
  requests: 12,
  bytes: 1048576,
  deadlineMs: 15000,
  concurrent: 2,
});
export interface RelationWalkOptions {
  direction: RelationDirection;
  depth: number;
  maxResults: number;
  expandPackages?: string[];
}
export interface RelationProvider {
  options: AdtRequestOptions;
  lookup(object: RelationObject, direction: RelationDirection): Promise<RelationNetwork>;
}

/** Serial BFS: each URI expands once per request; no graph/result state survives the call. */
export async function walkRelations(root: RelationObject, provider: RelationProvider, options: RelationWalkOptions) {
  if (
    !['incoming', 'outgoing'].includes(options.direction) ||
    !Number.isInteger(options.depth) ||
    options.depth < 1 ||
    options.depth > 3 ||
    !Number.isInteger(options.maxResults) ||
    options.maxResults < 1 ||
    options.maxResults > RELATION_LIMITS.nodes
  )
    throw new RangeError('Invalid relationship bounds.');
  const nodes = new Map([[root.uri, { ...root, level: 0 }]]);
  const edges = new Map<string, RelationEdge>(),
    expanded = new Set<string>();
  const queue = [root.uri];
  const boundaries: { uri: string; reason: 'depth' | 'type' | 'package' | 'missing' }[] = [];
  const truncation = new Set<string>();
  while (queue.length) {
    const uri = queue.shift()!,
      object = nodes.get(uri)!;
    if (object.level >= options.depth) {
      boundaries.push({ uri, reason: 'depth' });
      continue;
    }
    if (!['CLAS/OC', 'INTF/OI'].includes(object.type)) {
      boundaries.push({ uri, reason: 'type' });
      continue;
    }
    if (object.level > 0 && options.expandPackages?.length && !options.expandPackages.includes(object.package)) {
      boundaries.push({ uri, reason: 'package' });
      continue;
    }
    if (expanded.size >= RELATION_LIMITS.expansions) {
      queue.unshift(uri);
      truncation.add('expansions');
      break;
    }
    let network: RelationNetwork;
    try {
      throwIfRequestCancelled(provider.options);
      network = await provider.lookup(object, options.direction);
    } catch (error) {
      if (error instanceof AdtApiError && error.statusCode === 404 && object.level > 0) {
        boundaries.push({ uri, reason: 'missing' });
        continue;
      }
      // Auth and protocol errors are terminal, even after earlier successful expansions.
      // Cancellation is not success; only resource exhaustion may yield partial evidence.
      let reason: string | undefined;
      if (error instanceof AdtRequestBudgetError) reason = 'requests';
      else if (error instanceof AdtResponseLimitError) reason = 'bytes';
      else if (
        error instanceof AdtNetworkError &&
        provider.options.deadline !== undefined &&
        Date.now() >= provider.options.deadline &&
        !provider.options.signal?.aborted
      )
        reason = 'deadline';
      if (
        !reason ||
        !expanded.size ||
        provider.options.signal?.aborted ||
        provider.options.attemptBudget?.authorizationFailureObserved
      )
        throw error;
      truncation.add(reason);
      queue.unshift(uri);
      break;
    }
    expanded.add(uri);
    const found = new Map(network.objects.map((node) => [node.uri, node]));
    const adjacentUri = (edge: RelationEdge) => (options.direction === 'outgoing' ? edge.to : edge.from);
    // Keep BFS, but spend small expansion budgets on the root's package first.
    // URI tie-breaking is locale-independent, so bounded selections are reproducible.
    const rank = (edge: RelationEdge) =>
      root.package && found.get(adjacentUri(edge))?.package === root.package ? 0 : 1;
    for (const edge of network.edges.sort(
      (a, b) => rank(a) - rank(b) || (adjacentUri(a) < adjacentUri(b) ? -1 : adjacentUri(a) > adjacentUri(b) ? 1 : 0),
    )) {
      const adjacent = options.direction === 'outgoing' ? edge.to : edge.from;
      const target = found.get(adjacent);
      if (!target || (options.direction === 'outgoing' ? edge.from : edge.to) !== uri) {
        throw new RelationProtocolError('non-adjacent traversal result.');
      }
      const id = JSON.stringify([edge.from, edge.to]);
      const prior = nodes.get(adjacent);
      if (prior && (prior.name !== target.name || prior.type !== target.type || prior.package !== target.package)) {
        throw new RelationProtocolError('object identity changed during traversal; retry the analysis.');
      }
      if (!edges.has(id) && edges.size >= RELATION_LIMITS.edges) {
        truncation.add('edges');
        continue;
      }
      if (!prior) {
        if (nodes.size >= options.maxResults) {
          truncation.add('nodes');
          continue;
        }
        nodes.set(adjacent, { ...target, level: object.level + 1 });
        queue.push(adjacent);
      }
      edges.set(id, edge);
    }
  }
  return {
    root: root.uri,
    direction: options.direction,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    expanded: [...expanded],
    pending: queue,
    scopeBoundaries: boundaries,
    truncated: truncation.size > 0,
    truncationReasons: [...truncation],
    coverage: 'unknown',
    evidence: 'sap_relation_explorer',
    version: 'active',
    qualification:
      'Native relationship expansion steps, not proven direct source calls or complete runtime impact. Empty results do not prove unused code. Use SAPRead/SAPNavigate.references for targeted verification.',
  };
}
