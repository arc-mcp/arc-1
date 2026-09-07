import type { GraphResponse } from '../contract-v2.js';
import type { GraphImport, GraphNode, GraphTraversal, NodeRef, RelationKind, TraversalOptions } from '../types.js';

/** Database-independent boundary. All v2 response data belongs to one read snapshot. */
export interface GraphStore {
  close(): Promise<void>;
  ready(): Promise<{ migrationVersion: number }>;
  withSnapshot<T>(operation: (store: GraphStore) => Promise<T>): Promise<T>;
  coverage(systemKey: string): Promise<GraphResponse['coverage']>;
  resolve(
    systemKey: string,
    type: string,
    name: string,
  ): Promise<{
    status: 'found' | 'not_indexed' | 'ambiguous';
    node?: GraphNode;
  }>;
  node(ref: NodeRef): Promise<GraphNode | null>;
  search(systemKey: string, query: string, limit?: number): Promise<GraphNode[]>;
  traverse(start: NodeRef, options: TraversalOptions): Promise<GraphTraversal>;
  shortestPath(start: NodeRef, target: NodeRef, options: TraversalOptions): Promise<GraphTraversal>;
  packageCoupling(systemKey: string, kinds?: RelationKind[], limit?: number): Promise<Array<Record<string, unknown>>>;
  stats(systemKey?: string): Promise<Record<string, number>>;
  importGraph(input: GraphImport, replaceEvidence?: boolean): Promise<{ nodes: number; observations: number }>;
}
