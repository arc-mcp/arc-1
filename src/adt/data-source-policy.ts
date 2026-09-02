/** Experimental exact-name data-source blocklist and live CDS-lineage evaluation. */

import { randomBytes } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import { logger } from '../server/logger.js';
import { canonicalDataSourceName, DataSourceNameError, dataSourcePolicyFingerprint } from './data-source-name.js';
import { AdtApiError, AdtNetworkError, AdtSafetyError } from './errors.js';
import { analyzeSqlDataSources } from './sql-source-analyzer.js';

const MAX_GRAPH_XML_CHARS = 5_000_000;
const MAX_GRAPH_DEPTH = 64;
const MAX_GRAPH_NODES = 1_000;
const MAX_DIRECT_SOURCES = 64;
const MAX_REPLACEMENT_SOURCES = 256;
const MAX_RESOLUTION_ROOTS = 64;

const graphParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  isArray: (name) => name === 'elementInfo' || name === 'entry',
  parseAttributeValue: false,
  parseTagValue: false,
  processEntities: false,
});

class DataSourceLineageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataSourceLineageError';
  }
}

/**
 * Stable, distinct client-facing outcomes.
 *
 * - `DATA_SOURCE_BLOCKED`      an exact configured rule matched.
 * - `DATA_LINEAGE_UNRESOLVED`  SAP metadata/identity/graph/replacement lineage could not be proven.
 * - `DATA_SQL_UNSUPPORTED`     the caller's SQL is outside the strict accepted grammar.
 *
 * They stay distinguishable on purpose: a model that cannot tell "blocked by policy" from "SQL not
 * supported" cannot self-correct. That does permit coarse membership probing, which is a documented,
 * deliberate trade rather than an oversight.
 */
export type DataSourcePolicyErrorCode = 'DATA_SOURCE_BLOCKED' | 'DATA_LINEAGE_UNRESOLVED' | 'DATA_SQL_UNSUPPORTED';

/** Opaque, bounded, non-secret correlation id shared by the client error and the audit record. */
export function newDecisionId(): string {
  return `dsp_${randomBytes(8).toString('hex')}`;
}

export class DataSourcePolicyError extends AdtSafetyError {
  readonly decisionId: string;
  readonly matchedSource?: string;
  readonly reason: string;
  /** Always false: every policy denial happens before the SAP data request is submitted. */
  readonly executed = false;

  constructor(
    readonly code: DataSourcePolicyErrorCode,
    readonly directSource: string,
    readonly sourcePath: string[],
    reason: string,
    options: { decisionId?: string; matchedSource?: string } = {},
  ) {
    const path = sourcePath.length > 0 ? sourcePath.join(' -> ') : directSource;
    const decisionId = options.decisionId ?? newDecisionId();
    super(
      `${code}: request denied before data execution (executed=false, decisionId=${decisionId}). ` +
        `Source path: ${path}. Reason: ${reason}. ` +
        'Operator action: use a permitted static source, or change SAP_BLOCKED_DATA_SOURCES only after security review.',
    );
    this.name = 'DataSourcePolicyError';
    this.decisionId = decisionId;
    this.reason = reason;
    if (options.matchedSource) this.matchedSource = options.matchedSource;
  }

  /**
   * Client-facing text.
   *
   * `ARC1_MINIMAL_ERRORS` is a CLIENT DISCLOSURE control only: it removes the direct root, the
   * matched rule, the dependency path and the configuration variable name, keeping just enough for
   * the model to act (stable code, executed=false, decision id, and a safe alternative). It does not
   * change the decision and does not reduce what the audit event records.
   *
   * The three codes stay distinguishable even in minimal mode, which does permit coarse membership
   * probing. That is a deliberate, documented trade: a model that cannot tell "blocked by policy"
   * from "SQL not supported" cannot correct itself.
   */
  clientMessage(minimalErrors: boolean): string {
    if (!minimalErrors) return this.message;
    return (
      `${this.code}: the request was denied by the administrator's data-source policy before any SAP ` +
      `data request was executed (executed=false, decisionId=${this.decisionId}). ` +
      `${this.safeAlternative()} Details are recorded in the server audit log; ask an operator to ` +
      'correlate the decision id.'
    );
  }

  /** Guidance that does not reveal policy-sensitive names. */
  private safeAlternative(): string {
    switch (this.code) {
      case 'DATA_SQL_UNSUPPORTED':
        return 'Rewrite the request as one complete static SELECT/WITH without comments, host expressions or dynamic sources, or use the structured SAPRead(type="TABLE_QUERY") parameters.';
      case 'DATA_LINEAGE_UNRESOLVED':
        return 'Query a source whose lineage ARC-1 can resolve, or use the structured SAPRead(type="TABLE_QUERY") parameters.';
      default:
        return 'Use a different data source.';
    }
  }
}

/**
 * SQL node kinds SAP emits in the dependency branch. Verified live on SAP_BASIS 750, 758 and 816.
 * Anything outside this set inside a SQL branch fails closed.
 */
export const SQL_NODE_KINDS = ['CDS_VIEW', 'TABLE', 'CDS_TABLE_FUNCTION'] as const;
export type SqlNodeKind = (typeof SQL_NODE_KINDS)[number];

/**
 * The EXACT auxiliary chain SAP emits for access-control metadata, verified live on 758/816 for the
 * released standard view I_BUSINESSPARTNER:
 *
 *   RELATED_OBJECTS_TREE -> RELATED_OBJECTS_ENTRY -> DCLS_OBJECT_LIST -> DCLS/DL leaf
 *
 * These carry no application data, so they are validated and then dropped from lineage. Matching is
 * on the exact TYPE value and exact nesting — never on a name merely containing "RELATED" or "DCLS",
 * which would let an attacker-shaped subtree hide a real data source.
 */
const AUXILIARY_CHILD_KIND: Record<string, string> = {
  RELATED_OBJECTS_TREE: 'RELATED_OBJECTS_ENTRY',
  RELATED_OBJECTS_ENTRY: 'DCLS_OBJECT_LIST',
  DCLS_OBJECT_LIST: 'DCLS_OBJECT',
};

/** adtcore:type of the terminal access-control object; it legitimately carries no properties. */
const DCL_OBJECT_ADTCORE_TYPE = 'DCLS/DL';

export interface CdsDependencyNode {
  name: string;
  aliases: string[];
  kind: SqlNodeKind;
  relation?: string;
  databaseExists?: boolean;
  /** Access-control presence, retained as audit context only — never an authorization decision. */
  accessControlled: boolean;
  children: CdsDependencyNode[];
}

export type ResolvedDirectDataSource =
  | { kind: 'table'; name: string }
  | { kind: 'cds'; name: string; ddlSource: string }
  | { kind: 'classic-view' | 'structure' | 'unknown'; name: string };

export interface DataSourcePolicyResolver {
  resolveDirectSource(name: string): Promise<ResolvedDirectDataSource>;
  readTableSource(name: string): Promise<string>;
  readCdsDependencyGraph(ddlSource: string): Promise<CdsDependencyNode>;
}

export interface DataSourcePolicyBackend {
  searchObject(
    name: string,
    maxResults: number,
  ): Promise<Array<{ objectName: string; objectType: string; uri: string }>>;
  readTableSource(name: string): Promise<string>;
  dependencyGraphAccept(): string | undefined;
  readDependencyGraph(path: string, accept: string): Promise<string>;
}

/** Request-scoped adapter from ADT metadata reads to the pure lineage evaluator. */
export class DataSourceBlocklistGuard {
  /** Per-decision instrumentation. The guard is constructed per logical request and never reused. */
  private metadataRequests = 0;
  private graphNodes = 0;

  constructor(
    private readonly blockedSources: string[],
    private readonly backend: DataSourcePolicyBackend,
  ) {}

  /**
   * Run one policy decision and record exactly one audit event for it, allow or deny.
   *
   * The audit record is the protected copy: it always carries the complete normalized decision, so
   * an operator can reconstruct a denial even when the client was told almost nothing.
   */
  private async decide(directRootsHint: string[], run: () => Promise<string[]>): Promise<void> {
    const decisionId = newDecisionId();
    const started = Date.now();
    const fingerprint = dataSourcePolicyFingerprint(this.blockedSources);
    let directRoots = directRootsHint;
    try {
      directRoots = await run();
      logger.emitAudit({
        timestamp: new Date().toISOString(),
        level: 'info',
        event: 'data_source_policy_decision',
        decision: 'allow',
        decisionId,
        executed: true,
        directRoots,
        policyFingerprint: fingerprint,
        metadataRequests: this.metadataRequests,
        graphNodes: this.graphNodes,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      const policyError =
        error instanceof DataSourcePolicyError
          ? error
          : new DataSourcePolicyError(
              'DATA_LINEAGE_UNRESOLVED',
              directRoots[0] ?? 'UNKNOWN',
              [],
              safeLineageFailureReason(error),
              { decisionId },
            );
      logger.emitAudit({
        timestamp: new Date().toISOString(),
        level: 'warn',
        event: 'data_source_policy_decision',
        decision: 'deny',
        decisionId: policyError.decisionId,
        code: policyError.code,
        executed: false,
        directRoots,
        ...(policyError.matchedSource ? { matchedSource: policyError.matchedSource } : {}),
        ...(policyError.sourcePath.length > 0 ? { sourcePath: policyError.sourcePath } : {}),
        reason: policyError.reason,
        policyFingerprint: fingerprint,
        metadataRequests: this.metadataRequests,
        graphNodes: this.graphNodes,
        durationMs: Date.now() - started,
      });
      throw policyError;
    }
  }

  async enforceTableContents(tableName: string, sqlFilter?: string): Promise<void> {
    if (this.blockedSources.length === 0) return;
    if (!sqlFilter?.trim()) return this.enforceSources([tableName]);

    // A filtered DDIC preview is refused whatever the table is, but a directly blocked table still
    // reports as blocked so the operator sees the real reason.
    await this.decide([tableName], async () => {
      const source = canonicalDataSourceName(tableName, 'TABLE_CONTENTS table name');
      if (this.blockedSources.includes(source)) {
        throw new DataSourcePolicyError(
          'DATA_SOURCE_BLOCKED',
          source,
          [source],
          `exact source ${source} matches the configured blocklist`,
          {
            matchedSource: source,
          },
        );
      }
      throw new DataSourcePolicyError(
        'DATA_SQL_UNSUPPORTED',
        source,
        [source],
        'the TABLE_CONTENTS sqlFilter condition language is outside the strict analyzed subset; use the structured TABLE_QUERY where/columns parameters instead',
      );
    });
  }

  /**
   * Authorize every statement of one logical request together.
   *
   * The union of canonical direct sources is deduplicated before any SAP call, so N chunks that all
   * read the same table cost exactly one lineage resolution, and a source appearing in only one chunk
   * still denies the whole batch.
   */
  async enforceSqlBatch(statements: string[]): Promise<void> {
    if (this.blockedSources.length === 0) return;
    await this.decide([], async () => {
      const union: string[] = [];
      const seen = new Set<string>();
      for (const statement of statements) {
        for (const source of this.analyzeOrThrow(statement)) {
          if (!seen.has(source)) {
            seen.add(source);
            union.push(source);
          }
        }
      }
      await this.evaluate(union);
      return union;
    });
  }

  private analyzeOrThrow(sql: string): string[] {
    try {
      return analyzeSqlDataSources(sql);
    } catch (error) {
      throw new DataSourcePolicyError(
        'DATA_SQL_UNSUPPORTED',
        'SQL',
        [],
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async enforceSources(directSources: string[]): Promise<void> {
    if (this.blockedSources.length === 0) return;
    await this.decide(directSources, async () => {
      await this.evaluate(directSources);
      return directSources;
    });
  }

  /** The evaluation itself, without audit framing, so exactly one event is emitted per request. */
  private async evaluate(directSources: string[]): Promise<void> {
    await enforceBlockedDataSources(directSources, this.blockedSources, {
      resolveDirectSource: (name) => this.resolveDirectSource(name),
      readTableSource: (name) => {
        this.metadataRequests += 1;
        return this.backend.readTableSource(name);
      },
      readCdsDependencyGraph: (ddlSource) => this.readCdsDependencyGraph(ddlSource),
    });
  }

  private async resolveDirectSource(name: string): Promise<ResolvedDirectDataSource> {
    const requested = canonicalDataSourceName(name);
    const canonicalSearchName = (displayName: string): string | undefined => {
      const match = displayName
        .trim()
        .toUpperCase()
        .match(/^([A-Z0-9_/$]+)(?: \([^)]*\))?$/);
      return match?.[1];
    };
    // NW 7.50 decorates exact names (for example "SCARR (Database Table)"
    // and "X (Entity)"). Fuzzy search hits cannot prove source identity.
    this.metadataRequests += 1;
    const matches = (await this.backend.searchObject(requested, 100)).filter(
      (match) => canonicalSearchName(match.objectName) === requested,
    );
    const stobMatches = matches.filter((match) => match.objectType.toUpperCase().startsWith('STOB/'));
    const ddlsMatches = matches.filter((match) => match.objectType.toUpperCase() === 'DDLS/DF');
    const tableMatches = matches.filter((match) => match.objectType.toUpperCase() === 'TABL/DT');
    const structureMatches = matches.filter((match) => match.objectType.toUpperCase() === 'TABL/DS');
    const viewMatches = matches.filter((match) => match.objectType.toUpperCase() === 'VIEW/DV');

    const competingKinds =
      Number(stobMatches.length > 0) + Number(tableMatches.length > 0) + Number(viewMatches.length > 0);
    if (competingKinds > 1) return { kind: 'unknown', name };

    if (stobMatches.length > 0) {
      const ddlSources = new Set<string>();
      for (const match of [...stobMatches, ...ddlsMatches]) {
        const sourceMatch = match.uri.match(/\/ddic\/ddl\/sources\/([^/?#]+)(?:\/source\/main)?(?:#|$)/i);
        if (!sourceMatch?.[1]) continue;
        try {
          ddlSources.add(canonicalDataSourceName(decodeURIComponent(sourceMatch[1])));
        } catch {
          return { kind: 'unknown', name };
        }
      }
      if (ddlSources.size !== 1) return { kind: 'unknown', name };
      return { kind: 'cds', name, ddlSource: [...ddlSources][0]! };
    }

    if (tableMatches.length === 1) return { kind: 'table', name };
    if (tableMatches.length > 1) return { kind: 'unknown', name };
    if (viewMatches.length > 0) return { kind: 'classic-view', name };
    if (structureMatches.length > 0) return { kind: 'structure', name };
    return { kind: 'unknown', name };
  }

  private async readCdsDependencyGraph(ddlSource: string): Promise<CdsDependencyNode> {
    const collection = '/sap/bc/adt/ddic/ddl/dependencies/graphdata';
    const requestGraph = async (accept: string): Promise<CdsDependencyNode> => {
      const params = new URLSearchParams({ ddlsourceName: ddlSource });
      // Metrics add roughly 40% payload without changing topology, and authorization only needs
      // topology. Live-verified: the v3 media type returns 406 on SAP_BASIS 750, which is what
      // drives the element-info fallback below.
      if (/SQLDependencyModel/i.test(accept)) params.set('addMetrics', 'false');
      this.metadataRequests += 1;
      const graph = parseCdsDependencyGraph(
        await this.backend.readDependencyGraph(`${collection}?${params.toString()}`, accept),
      );
      const count = (node: CdsDependencyNode): number => 1 + node.children.reduce((n, c) => n + count(c), 0);
      this.graphNodes += count(graph);
      return graph;
    };

    const discoveredAccept = this.backend.dependencyGraphAccept();
    if (discoveredAccept) return requestGraph(discoveredAccept);
    try {
      return await requestGraph('application/vnd.sap.adt.ddl.SQLDependencyModel.v3+xml');
    } catch (error) {
      if (!(error instanceof AdtApiError) || ![406, 415].includes(error.statusCode)) throw error;
      return requestGraph('application/vnd.sap.adt.elementinfo+xml');
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function firstRecord(value: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(value)) return asRecord(value[0]);
  return asRecord(value);
}

function attribute(node: Record<string, unknown>, name: string): string | undefined {
  const value = node[`@_${name}`];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseProperties(node: Record<string, unknown>): Map<string, string> {
  const properties = firstRecord(node.properties);
  const entries = Array.isArray(properties?.entry) ? properties.entry : properties?.entry ? [properties.entry] : [];
  const result = new Map<string, string>();
  for (const rawEntry of entries) {
    const entry = asRecord(rawEntry);
    if (!entry) continue;
    const key = attribute(entry, 'key')?.toUpperCase();
    const text = entry['#text'];
    const value = attribute(entry, 'value') ?? (typeof text === 'string' && text.trim() ? text.trim() : undefined);
    if (key && value !== undefined) result.set(key, value);
  }
  return result;
}

/**
 * Parse SAP dependency-analyzer XML (750 element-info and 758/816 SQLDependencyModel v3) into one
 * bounded, explicitly classified tree.
 *
 * Every node is classified before it can influence a decision. SQL nodes enter lineage; the verified
 * auxiliary access-control chain is validated and dropped; anything else fails closed. Explicit kind
 * classification is the primary boundary here — a later failed table-source read is defence in depth,
 * not the protection.
 */
export function parseCdsDependencyGraph(xml: string): CdsDependencyNode {
  if (xml.length > MAX_GRAPH_XML_CHARS) {
    throw new DataSourceLineageError(`CDS dependency graph exceeds input limit ${MAX_GRAPH_XML_CHARS} characters`);
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = graphParser.parse(xml) as Record<string, unknown>;
  } catch {
    throw new DataSourceLineageError('CDS dependency graph XML is malformed');
  }
  const root = firstRecord(parsed.elementInfo);
  if (!root) throw new DataSourceLineageError('CDS dependency graph is missing its root elementInfo node');

  let nodeCount = 0;

  const rawChildren = (raw: Record<string, unknown>): Record<string, unknown>[] => {
    const kids = Array.isArray(raw.elementInfo) ? raw.elementInfo : raw.elementInfo ? [raw.elementInfo] : [];
    return kids.map((child) => {
      const record = asRecord(child);
      if (!record) throw new DataSourceLineageError('CDS dependency graph contains a malformed child node');
      return record;
    });
  };

  const countNode = (depth: number): void => {
    if (depth > MAX_GRAPH_DEPTH)
      throw new DataSourceLineageError(`CDS dependency graph exceeds depth limit ${MAX_GRAPH_DEPTH}`);
    nodeCount += 1;
    if (nodeCount > MAX_GRAPH_NODES)
      throw new DataSourceLineageError(`CDS dependency graph exceeds node limit ${MAX_GRAPH_NODES}`);
  };

  /** Validate one node of the auxiliary access-control chain and everything under it. */
  const visitAuxiliary = (raw: Record<string, unknown>, expected: string, depth: number): void => {
    countNode(depth);
    const properties = parseProperties(raw);
    const declared = properties.get('TYPE')?.trim().toUpperCase();

    if (expected === 'DCLS_OBJECT') {
      // The terminal DCL object carries an adtcore:type and, live, no properties at all.
      if (declared !== undefined) {
        throw new DataSourceLineageError(`access-control object declares unexpected TYPE ${declared}`);
      }
      if (attribute(raw, 'type')?.toUpperCase() !== DCL_OBJECT_ADTCORE_TYPE) {
        throw new DataSourceLineageError('access-control branch terminal is not a DCLS/DL object');
      }
      if (rawChildren(raw).length > 0) {
        throw new DataSourceLineageError('access-control object has unexpected children');
      }
      return;
    }

    if (declared !== expected) {
      throw new DataSourceLineageError(
        `access-control branch expected ${expected} but found ${declared ?? 'a node with no TYPE'}`,
      );
    }
    const nextExpected = AUXILIARY_CHILD_KIND[expected]!;
    for (const child of rawChildren(raw)) visitAuxiliary(child, nextExpected, depth + 1);
  };

  const visit = (raw: Record<string, unknown>, depth: number): CdsDependencyNode => {
    countNode(depth);

    const properties = parseProperties(raw);
    const declared = properties.get('TYPE')?.trim().toUpperCase();
    if (!declared) {
      throw new DataSourceLineageError('CDS dependency graph node is missing TYPE');
    }
    if (!(SQL_NODE_KINDS as readonly string[]).includes(declared)) {
      throw new DataSourceLineageError(`CDS dependency graph node declares unsupported kind ${declared}`);
    }
    const kind = declared as SqlNodeKind;

    const rawName = attribute(raw, 'name');
    if (!rawName) throw new DataSourceLineageError('CDS dependency graph node is missing its name');
    let name: string;
    try {
      name = canonicalDataSourceName(rawName, 'CDS dependency graph node');
    } catch {
      throw new DataSourceLineageError('CDS dependency graph node has an invalid technical name');
    }

    // ENTITY_NAME is mixed case live (I_BusinessPartner) and can be empty on table nodes.
    const aliases = new Set<string>([name]);
    for (const key of ['ENTITY_NAME', 'NODE_NAME']) {
      const value = properties.get(key);
      if (!value) continue;
      try {
        aliases.add(canonicalDataSourceName(value, `CDS dependency graph ${key}`));
      } catch {
        throw new DataSourceLineageError(`CDS dependency graph node ${name} has an invalid ${key}`);
      }
    }

    const accessState = properties.get('AC_STATE')?.trim().toUpperCase();
    const hasDcl = properties.get('HAS_DCL')?.trim().toUpperCase() === 'X';
    let accessControlled = hasDcl || (accessState !== undefined && !['NA', 'NONE', ''].includes(accessState));

    const children: CdsDependencyNode[] = [];
    for (const child of rawChildren(raw)) {
      const childType = parseProperties(child).get('TYPE')?.trim().toUpperCase();
      if (childType !== undefined && childType in AUXILIARY_CHILD_KIND) {
        // A recognized auxiliary branch: validate its exact shape, record that access control is
        // present, and drop it. It contributes no application data and must never enter lineage.
        visitAuxiliary(child, childType, depth + 1);
        accessControlled = true;
        continue;
      }
      children.push(visit(child, depth + 1));
    }

    // Deterministic ordering so the same graph always reports the same first blocked path,
    // regardless of the order SAP happens to serialize siblings in.
    children.sort((a, b) => (a.name === b.name ? 0 : a.name < b.name ? -1 : 1));

    const dbExists = properties.get('DB_EXISTS');
    return {
      name,
      aliases: [...aliases],
      kind,
      ...(properties.get('RELATION') ? { relation: properties.get('RELATION')!.toUpperCase() } : {}),
      ...(dbExists !== undefined ? { databaseExists: dbExists.toUpperCase() === 'X' } : {}),
      accessControlled,
      children,
    };
  };

  try {
    return visit(root, 0);
  } catch (error) {
    if (error instanceof DataSourceNameError) {
      throw new DataSourceLineageError('CDS dependency graph contains an invalid technical name');
    }
    throw error;
  }
}

interface DdlStringSpan {
  start: number;
  value: string;
}

/**
 * Mask comments and quoted literals while retaining their original offsets.
 * Authorization annotations are then found only in active DDL syntax.
 */
function scanDdlStructure(source: string): { structural: string; strings: DdlStringSpan[] } {
  const structural = source.split('');
  const strings: DdlStringSpan[] = [];
  let cursor = 0;

  const mask = (index: number): void => {
    if (structural[index] !== '\n' && structural[index] !== '\r') structural[index] = ' ';
  };

  while (cursor < source.length) {
    if (source[cursor] === '/' && source[cursor + 1] === '/') {
      mask(cursor++);
      mask(cursor++);
      while (cursor < source.length && source[cursor] !== '\n' && source[cursor] !== '\r') mask(cursor++);
      continue;
    }
    if (source[cursor] === '/' && source[cursor + 1] === '*') {
      mask(cursor++);
      mask(cursor++);
      let closed = false;
      while (cursor < source.length) {
        if (source[cursor] === '*' && source[cursor + 1] === '/') {
          mask(cursor++);
          mask(cursor++);
          closed = true;
          break;
        }
        mask(cursor++);
      }
      if (!closed) throw new DataSourceLineageError('table DDL contains an unterminated block comment');
      continue;
    }
    if (source[cursor] === "'") {
      const start = cursor;
      let value = '';
      let closed = false;
      mask(cursor++);
      while (cursor < source.length) {
        const char = source[cursor]!;
        if (char === '\\' && cursor + 1 < source.length) {
          value += source[cursor + 1]!;
          mask(cursor++);
          mask(cursor++);
          continue;
        }
        if (char === "'") {
          mask(cursor++);
          if (source[cursor] === "'") {
            value += "'";
            mask(cursor++);
            continue;
          }
          closed = true;
          break;
        }
        value += char;
        mask(cursor++);
      }
      if (!closed) throw new DataSourceLineageError('table DDL contains an unterminated string literal');
      strings.push({ start, value });
      continue;
    }
    cursor += 1;
  }

  return { structural: structural.join(''), strings };
}

/** Return a table's active CDS replacement object; malformed or duplicate annotations fail closed. */
export function extractReplacementObject(source: string): string | undefined {
  const { structural, strings } = scanDdlStructure(source);
  const markers = [...structural.matchAll(/@\s*AbapCatalog\s*\.\s*replacementObject\b/gi)];
  if (markers.length === 0) return undefined;
  const annotations = [...structural.matchAll(/@\s*AbapCatalog\s*\.\s*replacementObject\s*:/gi)];
  if (markers.length !== 1 || annotations.length !== 1 || markers[0]!.index !== annotations[0]!.index) {
    throw new DataSourceLineageError('replacementObject annotation is duplicated or malformed');
  }

  const annotation = annotations[0]!;
  const valueStart = annotation.index + annotation[0].length;
  const valueSpan = strings.find((span) => span.start >= valueStart);
  if (!valueSpan || structural.slice(valueStart, valueSpan.start).trim().length > 0) {
    throw new DataSourceLineageError('replacementObject annotation is present but malformed');
  }
  try {
    return canonicalDataSourceName(valueSpan.value);
  } catch {
    throw new DataSourceLineageError('replacementObject annotation value is not an exact technical name');
  }
}

function safeLineageFailureReason(error: unknown): string {
  if (error instanceof DataSourceLineageError) return error.message;
  if (error instanceof AdtApiError) {
    return `SAP metadata request failed with HTTP ${error.statusCode} during lineage resolution`;
  }
  if (error instanceof AdtNetworkError) {
    return 'SAP metadata request failed because the backend was unreachable during lineage resolution';
  }
  return 'lineage metadata resolution failed without safe diagnostic details';
}

function unresolved(directSource: string, sourcePath: string[], reason: string): DataSourcePolicyError {
  return new DataSourcePolicyError('DATA_LINEAGE_UNRESOLVED', directSource, sourcePath, reason);
}

/** Evaluate direct sources and their active lineage before a data-preview request is sent. */
export async function enforceBlockedDataSources(
  directSources: string[],
  configuredBlockedSources: string[],
  resolver: DataSourcePolicyResolver,
): Promise<void> {
  if (configuredBlockedSources.length === 0) return;

  let blocked: Set<string>;
  let roots: string[];
  try {
    blocked = new Set(configuredBlockedSources.map((name) => canonicalDataSourceName(name)));
    roots = [...new Set(directSources.map((name) => canonicalDataSourceName(name)))];
  } catch (error) {
    throw unresolved('UNKNOWN', [], error instanceof Error ? error.message : String(error));
  }
  if (roots.length === 0) throw unresolved('UNKNOWN', [], 'no direct source was supplied');

  const replacementCache = new Map<string, string | undefined>();
  const activeResolution = new Set<string>();

  const checkBlocked = (directSource: string, path: string[], aliases: string[]): void => {
    const matched = aliases.find((alias) => blocked.has(alias));
    if (matched) {
      throw new DataSourcePolicyError(
        'DATA_SOURCE_BLOCKED',
        directSource,
        path,
        `exact source ${matched} matches SAP_BLOCKED_DATA_SOURCES`,
        { matchedSource: matched },
      );
    }
  };

  // Preflight every root before resolving any of them. A blocked source in the
  // second arm of a join/union must not be preceded by metadata traffic for the
  // first source: direct matches have a stronger zero-SAP-call contract.
  for (const root of roots) checkBlocked(root, [root], [root]);
  if (roots.length > MAX_DIRECT_SOURCES) {
    throw unresolved(roots[0]!, [roots[0]!], `request exceeds direct-source limit ${MAX_DIRECT_SOURCES}`);
  }

  const replacementFor = async (table: string): Promise<string | undefined> => {
    if (replacementCache.has(table)) return replacementCache.get(table);
    if (replacementCache.size >= MAX_REPLACEMENT_SOURCES) {
      throw new DataSourceLineageError(`replacement inspection exceeds source limit ${MAX_REPLACEMENT_SOURCES}`);
    }
    const replacement = extractReplacementObject(await resolver.readTableSource(table));
    replacementCache.set(table, replacement);
    return replacement;
  };

  const replacementAt = async (directSource: string, table: string, path: string[]): Promise<string | undefined> => {
    try {
      return await replacementFor(table);
    } catch (error) {
      if (error instanceof DataSourcePolicyError) throw error;
      throw unresolved(directSource, path, safeLineageFailureReason(error));
    }
  };

  const evaluateResolved = async (
    directSource: string,
    resolved: ResolvedDirectDataSource,
    path: string[],
  ): Promise<void> => {
    checkBlocked(directSource, path, [canonicalDataSourceName(resolved.name)]);
    if (resolved.kind === 'table') {
      const table = canonicalDataSourceName(resolved.name);
      const replacement = await replacementAt(directSource, table, path);
      if (replacement) await evaluateRoot(directSource, replacement, [...path, replacement]);
      return;
    }
    if (resolved.kind !== 'cds') {
      throw unresolved(
        directSource,
        path,
        `source kind ${resolved.kind} has no proven lineage in the experimental policy`,
      );
    }

    const graph = await resolver.readCdsDependencyGraph(canonicalDataSourceName(resolved.ddlSource));
    const normalizedGraphAliases = graph.aliases.map((alias) => canonicalDataSourceName(alias));
    if (!normalizedGraphAliases.includes(canonicalDataSourceName(resolved.name))) {
      throw unresolved(
        directSource,
        path,
        `dependency graph root ${graph.name} does not identify requested CDS source ${resolved.name}`,
      );
    }
    const graphPath = graph.name === path.at(-1) ? path : [...path, graph.name];
    const validateGraph = (node: CdsDependencyNode, nodePath: string[], isRoot: boolean): void => {
      checkBlocked(
        directSource,
        nodePath,
        node.aliases.map((alias) => canonicalDataSourceName(alias)),
      );
      if (node.databaseExists === false) {
        throw unresolved(directSource, nodePath, `dependency ${node.name} is not active in the database`);
      }
      if (node.kind === 'TABLE') {
        if (node.children.length > 0)
          throw unresolved(directSource, nodePath, `table node ${node.name} has unexpected children`);
        return;
      }
      if (node.kind === 'CDS_TABLE_FUNCTION') {
        // Live 758 confirms SAP emits TYPE=CDS_TABLE_FUNCTION and does NOT expand the AMDP USING
        // list, so the node's real data sources are simply absent from the graph. Refusing on the
        // declared kind is the primary boundary; it is never inferred from a later failed read.
        throw unresolved(
          directSource,
          nodePath,
          `CDS table function ${node.name} is not supported by the experimental policy: SAP does not expose its AMDP USING lineage in the dependency graph`,
        );
      }
      if (node.kind !== 'CDS_VIEW') {
        throw unresolved(directSource, nodePath, `dependency kind ${node.kind} is unsupported`);
      }
      if (node.children.length === 0) {
        throw unresolved(
          directSource,
          nodePath,
          `${isRoot ? 'CDS root' : 'CDS dependency'} ${node.name} has no proven terminal source`,
        );
      }
      for (const child of node.children) validateGraph(child, [...nodePath, child.name], false);
    };
    // Check the complete graph before any table-source reads. This preserves the
    // strongest denial on old releases where canonical replacement metadata may
    // be unavailable for an earlier sibling table.
    validateGraph(graph, graphPath, true);

    const expandReplacements = async (node: CdsDependencyNode, nodePath: string[]): Promise<void> => {
      if (node.kind === 'TABLE') {
        const replacement = await replacementAt(directSource, node.name, nodePath);
        if (replacement) await evaluateRoot(directSource, replacement, [...nodePath, replacement]);
        return;
      }
      for (const child of node.children) await expandReplacements(child, [...nodePath, child.name]);
    };
    await expandReplacements(graph, graphPath);
  };

  const evaluateRoot = async (directSource: string, name: string, path: string[]): Promise<void> => {
    checkBlocked(directSource, path, [name]);
    if (activeResolution.size >= MAX_RESOLUTION_ROOTS) {
      throw unresolved(directSource, path, `replacement lineage exceeds depth limit ${MAX_RESOLUTION_ROOTS}`);
    }
    const cycleKey = `${directSource}\u0000${name}`;
    if (activeResolution.has(cycleKey)) throw unresolved(directSource, path, `replacement cycle detected at ${name}`);
    activeResolution.add(cycleKey);
    try {
      const resolved = await resolver.resolveDirectSource(name);
      await evaluateResolved(directSource, resolved, path);
    } finally {
      activeResolution.delete(cycleKey);
    }
  };

  for (const root of roots) {
    try {
      await evaluateRoot(root, root, [root]);
    } catch (error) {
      if (error instanceof DataSourcePolicyError) throw error;
      throw unresolved(root, [root], safeLineageFailureReason(error));
    }
  }
}
