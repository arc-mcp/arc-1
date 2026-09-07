import {
  type GraphEdge,
  type GraphNode,
  type GraphTraversal,
  type NodeRef,
  normalizeNodeRef,
  type TraversalOptions,
  validateTraversalOptions,
} from '../types.js';

export async function traverseGraph(
  startNode: GraphNode | null,
  rawOptions: TraversalOptions,
  fetchEdges: (frontier: number[], options: TraversalOptions, limit: number) => Promise<GraphEdge[]>,
): Promise<GraphTraversal> {
  const options = validateTraversalOptions(rawOptions);
  if (!startNode) return { exploredObservations: 0, nodes: [], observations: [], partial: false, truncated: false };
  const nodes = new Map<number, GraphNode>([[startNode.id, startNode]]);
  const observations: GraphEdge[] = [];
  const expanded = new Set<number>();
  let frontier = [startNode.id];
  let explored = 0;
  let truncated = false;
  for (let hop = 0; hop < options.maxHops && frontier.length; hop += 1) {
    const remainingBudget = options.edgeBudget - explored;
    const remainingResults = options.maxEdges - observations.length;
    const usableLimit = Math.min(remainingBudget, remainingResults);
    const fetchedEdges = await fetchEdges(frontier, options, usableLimit + 1);
    const overLimit = fetchedEdges.length > usableLimit;
    const edges = overLimit ? fetchedEdges.slice(0, usableLimit) : fetchedEdges;
    explored += fetchedEdges.length;
    if (overLimit) truncated = true;
    const next = new Set<number>();
    for (const edge of edges) {
      if (observations.length >= options.maxEdges) {
        truncated = true;
        break;
      }
      if (
        nodes.size +
          [edge.source, edge.target].filter(
            (node, index, both) => !nodes.has(node.id) && both.findIndex((other) => other.id === node.id) === index,
          ).length >
        options.maxNodes
      ) {
        truncated = true;
        continue;
      }
      if (!observations.some((existing) => existing.id === edge.id)) observations.push(edge);
      for (const node of [edge.source, edge.target]) {
        if (!nodes.has(node.id) && nodes.size >= options.maxNodes) {
          truncated = true;
          continue;
        }
        nodes.set(node.id, node);
        if (!expanded.has(node.id)) next.add(node.id);
      }
    }
    for (const id of frontier) expanded.add(id);
    frontier = [...next].filter((id) => !expanded.has(id));
    if (truncated) break;
  }
  return {
    exploredObservations: explored,
    nodes: [...nodes.values()],
    observations,
    partial: truncated,
    truncated,
  };
}

export function selectShortestPath(
  traversal: GraphTraversal,
  start: NodeRef,
  target: NodeRef,
  options: TraversalOptions,
): GraphTraversal {
  const normalizedTarget = normalizeNodeRef(target);
  const targetNode = traversal.nodes.find(
    (node) =>
      node.systemKey === normalizedTarget.systemKey &&
      node.type === normalizedTarget.type &&
      node.name === normalizedTarget.name,
  );
  if (!targetNode || traversal.nodes.length === 0) return { ...traversal, nodes: [], observations: [] };
  const startNode = traversal.nodes.find((node) => {
    const normalizedStart = normalizeNodeRef(start);
    return (
      node.systemKey === normalizedStart.systemKey &&
      node.type === normalizedStart.type &&
      node.name === normalizedStart.name
    );
  });
  if (!startNode) return { ...traversal, nodes: [], observations: [] };
  const queue = [startNode.id];
  const previous = new Map<number, { edge: GraphEdge; node: number }>();
  const seen = new Set(queue);
  while (queue.length) {
    const current = queue.shift();
    if (current === undefined || current === targetNode.id) break;
    for (const edge of traversal.observations) {
      const candidates: Array<{ from: number; to: number }> = [];
      if (options.direction !== 'incoming') candidates.push({ from: edge.source.id, to: edge.target.id });
      if (options.direction !== 'outgoing') candidates.push({ from: edge.target.id, to: edge.source.id });
      for (const candidate of candidates) {
        if (candidate.from !== current || seen.has(candidate.to)) continue;
        seen.add(candidate.to);
        previous.set(candidate.to, { edge, node: current });
        queue.push(candidate.to);
      }
    }
  }
  if (!previous.has(targetNode.id) && startNode.id !== targetNode.id)
    return { ...traversal, nodes: [], observations: [] };
  const pathEdges: GraphEdge[] = [];
  const pathNodeIds = new Set<number>([targetNode.id]);
  let cursor = targetNode.id;
  while (cursor !== startNode.id) {
    const step = previous.get(cursor);
    if (!step) break;
    pathEdges.unshift(step.edge);
    pathNodeIds.add(step.node);
    cursor = step.node;
  }
  return {
    ...traversal,
    nodes: traversal.nodes.filter((node) => pathNodeIds.has(node.id)),
    observations: pathEdges,
  };
}
