/** Experimental exact-name data-source blocklist and live CDS-lineage evaluation. */

import { XMLParser } from 'fast-xml-parser';
import { AdtApiError, AdtNetworkError, AdtSafetyError } from './errors.js';
import { analyzeSqlDataSources, normalizeDataSourceName, SqlSourceAnalysisError } from './sql-source-analyzer.js';

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

export type DataSourcePolicyErrorCode = 'DATA_SOURCE_BLOCKED' | 'DATA_SOURCE_UNRESOLVED';

export class DataSourcePolicyError extends AdtSafetyError {
  constructor(
    readonly code: DataSourcePolicyErrorCode,
    readonly directSource: string,
    readonly sourcePath: string[],
    reason: string,
  ) {
    const path = sourcePath.length > 0 ? sourcePath.join(' -> ') : directSource;
    super(
      `${code}: request denied before data execution. Source path: ${path}. Reason: ${reason}. ` +
        'Operator action: use a permitted static source, or change SAP_BLOCKED_DATA_SOURCES only after security review.',
    );
    this.name = 'DataSourcePolicyError';
  }
}

export interface CdsDependencyNode {
  name: string;
  aliases: string[];
  kind: string;
  relation?: string;
  databaseExists?: boolean;
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
  constructor(
    private readonly blockedSources: string[],
    private readonly backend: DataSourcePolicyBackend,
  ) {}

  async enforceTableContents(tableName: string, sqlFilter?: string): Promise<void> {
    if (this.blockedSources.length === 0) return;
    if (!sqlFilter?.trim()) return this.enforceSources([tableName]);

    let source: string;
    try {
      source = normalizeDataSourceName(tableName);
    } catch (error) {
      throw new DataSourcePolicyError(
        'DATA_SOURCE_UNRESOLVED',
        'UNKNOWN',
        [],
        error instanceof Error ? error.message : String(error),
      );
    }
    if (this.blockedSources.some((name) => name.trim().toUpperCase() === source)) {
      throw new DataSourcePolicyError(
        'DATA_SOURCE_BLOCKED',
        source,
        [source],
        `exact source ${source} matches SAP_BLOCKED_DATA_SOURCES`,
      );
    }
    throw new DataSourcePolicyError(
      'DATA_SOURCE_UNRESOLVED',
      source,
      [source],
      'TABLE_CONTENTS sqlFilter is unsupported by the experimental security analyzer; use TABLE_QUERY',
    );
  }

  async enforceSql(sql: string): Promise<void> {
    if (this.blockedSources.length === 0) return;
    let directSources: string[];
    try {
      directSources = analyzeSqlDataSources(sql);
    } catch (error) {
      throw new DataSourcePolicyError(
        'DATA_SOURCE_UNRESOLVED',
        'SQL',
        ['SQL'],
        error instanceof Error ? error.message : String(error),
      );
    }
    await this.enforceSources(directSources);
  }

  async enforceSources(directSources: string[]): Promise<void> {
    await enforceBlockedDataSources(directSources, this.blockedSources, {
      resolveDirectSource: (name) => this.resolveDirectSource(name),
      readTableSource: (name) => this.backend.readTableSource(name),
      readCdsDependencyGraph: (ddlSource) => this.readCdsDependencyGraph(ddlSource),
    });
  }

  private async resolveDirectSource(name: string): Promise<ResolvedDirectDataSource> {
    const requested = normalizeDataSourceName(name);
    const canonicalSearchName = (displayName: string): string | undefined => {
      const match = displayName
        .trim()
        .toUpperCase()
        .match(/^([A-Z0-9_/$]+)(?: \([^)]*\))?$/);
      return match?.[1];
    };
    // NW 7.50 decorates exact names (for example "SCARR (Database Table)"
    // and "X (Entity)"). Fuzzy search hits cannot prove source identity.
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
          ddlSources.add(normalizeDataSourceName(decodeURIComponent(sourceMatch[1])));
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
      if (/SQLDependencyModel/i.test(accept)) params.set('addMetrics', 'true');
      return parseCdsDependencyGraph(
        await this.backend.readDependencyGraph(`${collection}?${params.toString()}`, accept),
      );
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

/** Parse old and new SAP dependency-analyzer XML into one bounded tree. */
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
  const visit = (raw: Record<string, unknown>, depth: number): CdsDependencyNode => {
    if (depth > MAX_GRAPH_DEPTH)
      throw new DataSourceLineageError(`CDS dependency graph exceeds depth limit ${MAX_GRAPH_DEPTH}`);
    nodeCount += 1;
    if (nodeCount > MAX_GRAPH_NODES)
      throw new DataSourceLineageError(`CDS dependency graph exceeds node limit ${MAX_GRAPH_NODES}`);

    const rawName = attribute(raw, 'name');
    if (!rawName) throw new DataSourceLineageError('CDS dependency graph node is missing its name');
    let name: string;
    try {
      name = normalizeDataSourceName(rawName);
    } catch {
      throw new DataSourceLineageError('CDS dependency graph node has an invalid technical name');
    }
    const properties = parseProperties(raw);
    const kind = properties.get('TYPE')?.trim().toUpperCase();
    if (!kind) throw new DataSourceLineageError(`CDS dependency graph node ${name} is missing TYPE`);
    const aliases = new Set<string>([name]);
    for (const key of ['ENTITY_NAME', 'NODE_NAME']) {
      const value = properties.get(key);
      if (value) {
        try {
          aliases.add(normalizeDataSourceName(value));
        } catch {
          throw new DataSourceLineageError(`CDS dependency graph node ${name} has an invalid ${key}`);
        }
      }
    }
    const dbExists = properties.get('DB_EXISTS');
    const rawChildren = Array.isArray(raw.elementInfo) ? raw.elementInfo : raw.elementInfo ? [raw.elementInfo] : [];
    const children = rawChildren.map((child) => {
      const record = asRecord(child);
      if (!record) throw new DataSourceLineageError(`CDS dependency graph node ${name} has a malformed child`);
      return visit(record, depth + 1);
    });
    return {
      name,
      aliases: [...aliases],
      kind,
      ...(properties.get('RELATION') ? { relation: properties.get('RELATION')!.toUpperCase() } : {}),
      ...(dbExists !== undefined ? { databaseExists: dbExists.toUpperCase() === 'X' } : {}),
      children,
    };
  };

  try {
    return visit(root, 0);
  } catch (error) {
    if (error instanceof SqlSourceAnalysisError) {
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
    return normalizeDataSourceName(valueSpan.value);
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
  return new DataSourcePolicyError('DATA_SOURCE_UNRESOLVED', directSource, sourcePath, reason);
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
    blocked = new Set(configuredBlockedSources.map((name) => normalizeDataSourceName(name)));
    roots = [...new Set(directSources.map((name) => normalizeDataSourceName(name)))];
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
    checkBlocked(directSource, path, [normalizeDataSourceName(resolved.name)]);
    if (resolved.kind === 'table') {
      const table = normalizeDataSourceName(resolved.name);
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

    const graph = await resolver.readCdsDependencyGraph(normalizeDataSourceName(resolved.ddlSource));
    const normalizedGraphAliases = graph.aliases.map((alias) => normalizeDataSourceName(alias));
    if (!normalizedGraphAliases.includes(normalizeDataSourceName(resolved.name))) {
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
        node.aliases.map((alias) => normalizeDataSourceName(alias)),
      );
      if (node.databaseExists === false) {
        throw unresolved(directSource, nodePath, `dependency ${node.name} is not active in the database`);
      }
      if (node.kind === 'TABLE') {
        if (node.children.length > 0)
          throw unresolved(directSource, nodePath, `table node ${node.name} has unexpected children`);
        return;
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
