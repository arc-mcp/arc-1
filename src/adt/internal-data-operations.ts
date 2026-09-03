/**
 * Private registry of ARC-1's own fixed data reads.
 *
 * Some features read SAP metadata tables with statements ARC-1 builds itself: repository lookup,
 * class hierarchy, transaction enrichment, BOR method resolution and authorization-trace decoding.
 * They are declared here so that code, tests and operator documentation cannot drift apart, and so
 * that "which feature breaks if I block this table?" has one answer.
 *
 * This registry is NOT a bypass. Every entry still goes through the same
 * `checkOperation(Query|FreeSQL)` capability gate, the same caller scopes, and the same data-source
 * blocklist, in that order. There is deliberately no `internal=true` argument, no caller-settable
 * flag, and nothing here is reachable from an MCP tool schema — blocking a table listed below really
 * does disable the feature that reads it, which is the intended, documented behaviour.
 *
 * Criticality drives model feedback:
 * - `core`     the feature cannot produce a correct answer without the source, so it must fail with
 *              an actionable reason (and an alternative where one exists);
 * - `optional` the feature degrades to a still-correct but less complete answer, so it must return
 *              its data WITH an explicit warning. Silently swallowing the policy error would let the
 *              model infer success from an incomplete result, which is the failure mode this
 *              registry exists to prevent.
 */

export type InternalDataOperationId =
  | 'tadir_lookup_db'
  | 'tran_program_enrichment'
  | 'class_hierarchy'
  | 'interface_implementers'
  | 'bor_method_lookup'
  | 'authorization_trace';

export interface InternalDataOperation {
  /** Exact canonical sources this server-owned operation reads. */
  readonly sources: readonly string[];
  /** The user-facing feature that depends on it. */
  readonly consumer: string;
  readonly criticality: 'core' | 'optional';
  /** Model-facing guidance used when the policy denies the read. */
  readonly guidance: string;
}

export const INTERNAL_DATA_OPERATIONS: Record<InternalDataOperationId, InternalDataOperation> = {
  tadir_lookup_db: {
    sources: ['TADIR'],
    consumer: 'SAPSearch(searchType="tadir_lookup", source="db"|"both")',
    criticality: 'core',
    guidance:
      'Retry with source="adt", which uses the ADT information system instead of TADIR. ' +
      'Note the ADT path cannot see orphan/ghost TADIR rows, so a "db"/"both" split-brain check is not possible while TADIR is blocked.',
  },
  tran_program_enrichment: {
    sources: ['TSTC'],
    consumer: 'SAPRead(type="TRAN") program-name enrichment',
    criticality: 'optional',
    guidance:
      'Transaction metadata is returned without the program name; read the transaction in SAP GUI (SE93) for it.',
  },
  class_hierarchy: {
    sources: ['SEOMETAREL'],
    consumer: 'SAPNavigate(action="hierarchy")',
    criticality: 'core',
    guidance:
      'Class hierarchy is derived from SEOMETAREL and has no alternative source in ARC-1. ' +
      'Use SAPRead(type="CLAS", include="definitions") to inspect the declared superclass and interfaces instead.',
  },
  interface_implementers: {
    sources: ['SEOMETAREL'],
    consumer: 'SAPWhereUsed interface-implementer augmentation',
    criticality: 'optional',
    guidance:
      'The native SAP where-used result is returned, but the list of classes implementing this interface may be incomplete.',
  },
  bor_method_lookup: {
    sources: ['SWOTLV'],
    consumer: 'SAPRead(type="SOBJ") BOR method catalogue and implementation lookup',
    criticality: 'core',
    guidance:
      'BOR method resolution requires SWOTLV and has no alternative source in ARC-1. Inspect the object type in SAP GUI (SWO1) instead.',
  },
  authorization_trace: {
    sources: ['SUAUTHVALTRC', 'TOBJ'],
    consumer: 'SAPDiagnose(action="authorization_trace")',
    criticality: 'core',
    guidance:
      'The authorization trace needs SUAUTHVALTRC for the trace rows and TOBJ to decode field names. ' +
      'Both are required: returning positional values without their field names would be ambiguous and misleading, so the action is denied rather than partially answered.',
  },
};

/** Every distinct source ARC-1 reads for its own features, for docs and operator tooling. */
export function internalDataSources(): string[] {
  return [...new Set(Object.values(INTERNAL_DATA_OPERATIONS).flatMap((op) => [...op.sources]))].sort();
}

/** Registry entries whose sources intersect a configured blocklist. */
export function internalOperationsBlockedBy(
  blockedDataSources: readonly string[],
): Array<{ id: InternalDataOperationId; operation: InternalDataOperation; blocked: string[] }> {
  const blocked = new Set(blockedDataSources);
  const hits: Array<{ id: InternalDataOperationId; operation: InternalDataOperation; blocked: string[] }> = [];
  for (const [id, operation] of Object.entries(INTERNAL_DATA_OPERATIONS)) {
    const matched = operation.sources.filter((source) => blocked.has(source));
    if (matched.length > 0) {
      hits.push({ id: id as InternalDataOperationId, operation, blocked: matched });
    }
  }
  return hits;
}

/**
 * Model-facing explanation for a denied internal read.
 *
 * `reason` carries the already-redacted policy text, so this adds the affected feature and the
 * alternative without re-deriving anything policy-sensitive.
 */
export function internalOperationDenial(id: InternalDataOperationId, reason: string): string {
  const operation = INTERNAL_DATA_OPERATIONS[id];
  return `${reason}\n\nAffected: ${operation.consumer}. ${operation.guidance}`;
}

/** Warning appended to a degraded-but-correct result when an optional internal read is denied. */
export function internalOperationWarning(id: InternalDataOperationId, reason: string): string {
  const operation = INTERNAL_DATA_OPERATIONS[id];
  return `Incomplete result: ${operation.consumer} could not read ${operation.sources.join(' / ')}. ${operation.guidance} (${reason})`;
}
