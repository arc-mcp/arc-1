import { type GraphImport, isRelationKind, normalizeNodeRef } from '../types.js';

function text(value: string | undefined, maximum: number, required = false) {
  if ((required && !value) || (value?.length ?? 0) > maximum || value?.includes('\u0000'))
    throw new Error('Invalid graph import metadata');
}

export function validateGraphImport(input: GraphImport): string {
  const systemKey = normalizeNodeRef({ systemKey: input.systemKey, type: 'SYSTEM', name: input.systemKey }).systemKey;
  // Bounded single publication; larger inventories must be split into explicit scopes.
  if (
    input.nodes.length > 100_000 ||
    input.observations.length > 1_000_000 ||
    (input.evidenceScopes?.length ?? 0) > 100_000
  )
    throw new Error('Graph import exceeds publication limits');
  text(input.scope, 1024, true);
  text(input.extractorVersion, 128, true);
  for (const node of input.nodes) {
    if (normalizeNodeRef(node).systemKey !== systemKey) throw new Error('Cross-system graph import');
    text(node.description, 1024);
    text(node.packageName, 255);
    text(node.locator, 1024);
    if (node.resolutionStatus && !['resolved', 'unresolved', 'out_of_scope'].includes(node.resolutionStatus))
      throw new Error('Invalid graph resolution status');
  }
  for (const edge of input.observations) {
    if (normalizeNodeRef(edge.source).systemKey !== systemKey || normalizeNodeRef(edge.target).systemKey !== systemKey)
      throw new Error('Cross-system graph import');
    if (!isRelationKind(edge.relation)) throw new Error('Invalid graph relation');
    text(edge.evidenceOwner, 512, true);
    text(edge.evidenceMethod, 128, true);
    text(edge.sourceResource, 1024, true);
  }
  for (const scope of input.evidenceScopes ?? []) {
    text(scope.evidenceOwner, 512, true);
    text(scope.sourceResource, 1024, true);
  }
  return systemKey;
}
