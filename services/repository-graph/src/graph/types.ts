export const RELATION_KINDS = [
  'belongs_to',
  'inherits_from',
  'implements',
  'references',
  'static_call',
  'function_call',
  'reads_from',
  'projects_on',
  'associates_to',
  'composes',
] as const;

export type RelationKind = (typeof RELATION_KINDS)[number];
export type Direction = 'incoming' | 'outgoing' | 'both';
export type ResolutionStatus = 'resolved' | 'unresolved' | 'out_of_scope';

export interface NodeRef {
  name: string;
  systemKey: string;
  type: string;
}

export interface GraphNodeInput extends NodeRef {
  description?: string;
  locator?: string;
  packageName?: string;
  resolutionStatus?: ResolutionStatus;
}

export interface GraphEdgeInput {
  evidenceMethod: string;
  evidenceOwner: string;
  relation: RelationKind;
  source: NodeRef;
  sourceResource: string;
  target: NodeRef;
}

export interface GraphImport {
  collection?: GraphCollectionReport;
  evidenceScopes?: Array<{ evidenceOwner: string; sourceResource: string }>;
  extractorVersion: string;
  nodes: GraphNodeInput[];
  observations: GraphEdgeInput[];
  scope: string;
  systemKey: string;
}

export const COLLECTION_REASONS = [
  'empty_source',
  'structure_error',
  'unknown_statement',
  'macro_statement',
  'unsupported_cds',
  'read_failed',
  'parse_exception',
] as const;
export type CollectionReason = (typeof COLLECTION_REASONS)[number];

export interface SourceOutcome {
  name: string;
  type: string;
  status: 'parsed' | 'partial' | 'failed' | 'read_failed';
  reasons: CollectionReason[];
  dynamicTargets: number;
}

export interface GraphCollectionReport {
  status: 'complete' | 'partial';
  sources: SourceOutcome[];
  counters: Record<string, number>;
}

export interface GraphNode extends Required<Omit<GraphNodeInput, 'locator'>> {
  id: number;
  locator: string | null;
}

export interface GraphEdge {
  evidenceMethod: string;
  evidenceOwner: string;
  id: number;
  relation: RelationKind;
  source: GraphNode;
  sourceResource: string;
  target: GraphNode;
}

export interface GraphTraversal {
  exploredObservations: number;
  nodes: GraphNode[];
  observations: GraphEdge[];
  partial: boolean;
  truncated: boolean;
}

export interface TraversalOptions {
  direction: Direction;
  edgeBudget: number;
  kinds?: RelationKind[];
  maxEdges: number;
  maxHops: number;
  maxNodes: number;
  statementTimeoutMs: number;
}

const SYSTEM_PATTERN = /^[A-Z0-9][A-Z0-9._:-]{0,127}$/;
const TYPE_PATTERN = /^[A-Z0-9_/]{1,40}$/;

function bounded(value: string, field: string, maximum: number): string {
  const normalized = value.trim().toUpperCase();
  // biome-ignore lint/suspicious/noControlCharactersInRegex: explicitly reject control characters
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error(`Invalid ${field}`);
  }
  return normalized;
}

export function normalizeNodeRef(input: NodeRef): NodeRef {
  const systemKey = bounded(input.systemKey, 'systemKey', 128);
  const type = bounded(input.type, 'type', 40);
  const name = bounded(input.name, 'name', 255);
  if (!SYSTEM_PATTERN.test(systemKey)) throw new Error('Invalid systemKey');
  if (!TYPE_PATTERN.test(type)) throw new Error('Invalid type');
  return { name, systemKey, type };
}

export function isRelationKind(value: unknown): value is RelationKind {
  return typeof value === 'string' && (RELATION_KINDS as readonly string[]).includes(value);
}

export function validateTraversalOptions(options: Partial<TraversalOptions>): TraversalOptions {
  const direction = options.direction ?? 'both';
  if (!['incoming', 'outgoing', 'both'].includes(direction)) throw new Error('Invalid direction');
  const maxHops = options.maxHops ?? 1;
  const maxNodes = options.maxNodes ?? 100;
  const maxEdges = options.maxEdges ?? 300;
  const edgeBudget = options.edgeBudget ?? 10_000;
  const statementTimeoutMs = options.statementTimeoutMs ?? 2_000;
  if (!Number.isInteger(maxHops) || maxHops < 1 || maxHops > 3) throw new Error('maxHops must be 1..3');
  if (!Number.isInteger(maxNodes) || maxNodes < 1 || maxNodes > 100) throw new Error('maxNodes must be 1..100');
  if (!Number.isInteger(maxEdges) || maxEdges < 1 || maxEdges > 300) throw new Error('maxEdges must be 1..300');
  if (!Number.isInteger(edgeBudget) || edgeBudget < 1 || edgeBudget > 10_000) {
    throw new Error('edgeBudget must be 1..10000');
  }
  if (!Number.isInteger(statementTimeoutMs) || statementTimeoutMs < 50 || statementTimeoutMs > 2_000) {
    throw new Error('statementTimeoutMs must be 50..2000');
  }
  const kinds = options.kinds;
  if (kinds && (kinds.length === 0 || kinds.some((kind) => !isRelationKind(kind)))) {
    throw new Error('Invalid relation kind');
  }
  return { direction, edgeBudget, kinds, maxEdges, maxHops, maxNodes, statementTimeoutMs };
}
