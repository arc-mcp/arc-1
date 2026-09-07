import { type GraphInput, type GraphResponse, graphResponseSchema } from './contract-v2.js';
import type { GraphStore } from './store/store.js';
import { type GraphNode, RELATION_KINDS, validateTraversalOptions } from './types.js';

const canonical = (type: string) => type.split('/')[0] ?? type;

export async function queryV2(
  store: GraphStore,
  input: GraphInput,
  systemKey: string,
  audience: string,
): Promise<GraphResponse> {
  return store.withSnapshot((snapshot) => querySnapshot(snapshot, input, systemKey, audience));
}

async function querySnapshot(
  store: GraphStore,
  input: GraphInput,
  systemKey: string,
  audience: string,
): Promise<GraphResponse> {
  const before = await store.coverage(systemKey);
  const result: GraphResponse = {
    apiVersion: 2,
    systemKey,
    audience,
    action: input.action,
    coverage: before,
    nodes: [],
    edges: [],
    couplings: [],
    startStatus: 'not_requested',
    targetStatus: 'not_requested',
    hasMore: false,
    truncationReasons: [],
    pathFound: null,
    scope: { depth: input.depth, direction: input.action === 'impact' ? 'incoming' : input.direction },
  };
  let nodes: GraphNode[] = [];
  if (input.action === 'search') {
    nodes = await store.search(systemKey, input.query!, input.limit + 1);
    if (nodes.length > input.limit) {
      result.hasMore = true;
      result.truncationReasons.push('result_limit');
      nodes.pop();
    }
  } else if (input.action === 'package_coupling') {
    const rows = await store.packageCoupling(systemKey, input.kinds, input.limit + 1);
    if (rows.length > input.limit) {
      result.hasMore = true;
      result.truncationReasons.push('result_limit');
      rows.pop();
    }
    result.couplings = rows as GraphResponse['couplings'];
  } else if (input.action !== 'status') {
    const start = await store.resolve(systemKey, input.type!, input.name!);
    result.startStatus = start.status;
    const target =
      input.action === 'path' ? await store.resolve(systemKey, input.targetType!, input.targetName!) : undefined;
    if (target) result.targetStatus = target.status;
    if (input.action === 'path') result.pathFound = false;
    if (start.node && (!target || target.node)) {
      const options = validateTraversalOptions({
        direction: result.scope.direction,
        maxHops: input.depth,
        maxNodes: input.maxNodes,
        maxEdges: input.maxEdges,
        kinds:
          input.action === 'impact'
            ? (input.kinds ?? RELATION_KINDS).filter((kind) => kind !== 'belongs_to')
            : input.kinds,
      });
      const traversal = target?.node
        ? await store.shortestPath(start.node, target.node, options)
        : await store.traverse(start.node, options);
      nodes = traversal.nodes;
      result.edges = traversal.observations.map((edge) => ({
        id: edge.id,
        sourceId: edge.source.id,
        targetId: edge.target.id,
        relation: edge.relation,
        evidenceMethod: edge.evidenceMethod,
      }));
      result.hasMore = traversal.truncated;
      if (result.hasMore) result.truncationReasons.push('traversal_budget');
      if (target) result.pathFound = nodes.length > 0;
    }
  }
  result.nodes = nodes.map((node) => ({
    id: node.id,
    name: node.name,
    type: canonical(node.type),
    adtType: node.type,
    packageName: node.packageName,
    description: node.description.slice(0, 1024),
    resolutionStatus: node.resolutionStatus,
  }));
  return graphResponseSchema.parse(result);
}
