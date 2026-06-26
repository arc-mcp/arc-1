import type { AdtClient, SourceReadOptions, SourceReadResult } from './client.js';
import { findWhereUsed, getWhereUsedScope, type WhereUsedResult } from './codeintel.js';
import { AdtApiError, isNotFoundError } from './errors.js';

export type StructureNodeKind = 'root' | 'include' | 'append';

export interface StructureNode {
  structure: string;
  attribute: string | null;
  kind: StructureNodeKind;
  children: StructureNode[];
  cyclic?: boolean;
  truncated?: boolean;
  error?: string;
}

export interface EmbeddedStructureRef {
  name: string;
  attribute: string | null;
  kind: 'include' | 'append';
}

export interface StructureHierarchyResult {
  name: string;
  type: 'TABL';
  includeExtensions: boolean;
  maxDepth: number;
  tree: StructureNode;
  summary: {
    totalNodes: number;
    includes: number;
    appends: number;
    cyclic: number;
    unresolved: number;
    truncated: number;
  };
  warnings?: string[];
}

type StructureHierarchyClient = Pick<AdtClient, 'getTabl' | 'resolveTablObjectUrl' | 'http' | 'safety'>;

const DEFAULT_MAX_DEPTH = 10;
const WHERE_USED_UNAVAILABLE_STATUSES = new Set([400, 404, 405, 415, 501]);

export function parseEmbeddedStructures(source: string): EmbeddedStructureRef[] {
  const refs: EmbeddedStructureRef[] = [];
  if (!source) return refs;

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.replace(/\/\/.*$/, '').trim();
    if (!line || line.startsWith('@') || line.startsWith('*')) continue;

    const classicInclude = line.match(/^\.include\s+([a-z0-9_/]+)/i);
    if (classicInclude?.[1]) {
      refs.push({ name: classicInclude[1].toUpperCase(), attribute: null, kind: 'include' });
      continue;
    }

    const namedInclude = line.match(/^([a-z][a-z0-9_]*)\s*:\s*include\s+([a-z0-9_/]+)\s*;?/i);
    if (namedInclude?.[1] && namedInclude[2]) {
      refs.push({
        name: namedInclude[2].toUpperCase(),
        attribute: namedInclude[1].toLowerCase(),
        kind: 'include',
      });
      continue;
    }

    const anonymousInclude = line.match(/^include\s+([a-z0-9_/]+)\s*;?/i);
    if (anonymousInclude?.[1]) {
      refs.push({ name: anonymousInclude[1].toUpperCase(), attribute: null, kind: 'include' });
    }
  }

  return refs;
}

export async function buildStructureHierarchy(
  client: StructureHierarchyClient,
  name: string,
  options: { version?: SourceReadOptions['version']; includeExtensions?: boolean; maxDepth?: number } = {},
): Promise<StructureHierarchyResult> {
  const rootName = normalizeStructureName(name);
  const includeExtensions = options.includeExtensions !== false;
  const maxDepth = parseMaxDepth(options.maxDepth);
  const warnings: string[] = [];
  const sourceCache = new Map<string, string | null>();
  let appendDiscoveryDisabled = false;

  const readSource = async (structureName: string): Promise<string | null> => {
    const upper = normalizeStructureName(structureName);
    if (sourceCache.has(upper)) return sourceCache.get(upper) ?? null;

    try {
      const result: SourceReadResult = await client.getTabl(upper, { version: options.version });
      sourceCache.set(upper, result.source);
      return result.source;
    } catch (err) {
      if (isNotFoundError(err)) {
        sourceCache.set(upper, null);
        return null;
      }
      throw err;
    }
  };

  const rootSource = await readSource(rootName);
  if (rootSource === null) {
    throw new AdtApiError(`Could not read source for structure/table ${rootName}`, 404, '');
  }

  const buildNode = async (
    structureName: string,
    kind: StructureNodeKind,
    attribute: string | null,
    path: readonly string[],
  ): Promise<StructureNode> => {
    const upper = normalizeStructureName(structureName);
    const node: StructureNode = { structure: upper, attribute, kind, children: [] };

    if (path.includes(upper)) {
      node.cyclic = true;
      return node;
    }

    const source = await readSource(upper);
    if (source === null) {
      node.error = `Could not read source for ${upper}`;
      return node;
    }

    if (path.length >= maxDepth) {
      node.truncated = true;
      return node;
    }

    const extensionRefs =
      includeExtensions && !appendDiscoveryDisabled
        ? await findExtensionRefs(client, upper, readSource, warnings, () => {
            appendDiscoveryDisabled = true;
          })
        : [];
    const childRefs = [...parseEmbeddedStructures(source), ...extensionRefs];
    const nextPath = [...path, upper];
    for (const ref of childRefs) {
      node.children.push(await buildNode(ref.name, ref.kind, ref.attribute, nextPath));
    }
    return node;
  };

  const tree = await buildNode(rootName, 'root', null, []);
  return {
    name: rootName,
    type: 'TABL',
    includeExtensions,
    maxDepth,
    tree,
    summary: summarizeStructureTree(tree),
    ...(warnings.length > 0 ? { warnings: [...new Set(warnings)] } : {}),
  };
}

async function findExtensionRefs(
  client: StructureHierarchyClient,
  baseName: string,
  readSource: (name: string) => Promise<string | null>,
  warnings: string[],
  disableAppendDiscovery: () => void,
): Promise<EmbeddedStructureRef[]> {
  const candidates = new Set<string>();
  const baseObjectUrl = await client.resolveTablObjectUrl(baseName);
  const collectCandidates = (results: readonly WhereUsedResult[]) => {
    for (const result of results) {
      const candidate = normalizeStructureName(result.name);
      if (!candidate || candidate === baseName) continue;
      if (!/^TABL\//i.test(result.type)) continue;
      candidates.add(candidate);
    }
  };

  let scopedTypes: string[];
  try {
    const scope = await getWhereUsedScope(client.http, client.safety, baseObjectUrl);
    scopedTypes = Array.from(
      new Set(
        scope.entries
          .filter((entry) => entry.count > 0 && /^TABL\//i.test(entry.objectType))
          .map((entry) => entry.objectType),
      ),
    );
    for (const objectType of scopedTypes) {
      try {
        collectCandidates(await findWhereUsed(client.http, client.safety, baseObjectUrl, objectType));
      } catch (err) {
        if (isUnavailableWhereUsedError(err)) continue;
        throw err;
      }
    }
  } catch (err) {
    if (!isUnavailableWhereUsedError(err)) throw err;
    warnings.push(
      `Where-used scope endpoint unavailable for ${baseName}; append structure discovery may be incomplete.`,
    );
    disableAppendDiscovery();
    return [];
  }

  try {
    collectCandidates(await findWhereUsed(client.http, client.safety, baseObjectUrl));
  } catch (err) {
    if (isUnavailableWhereUsedError(err)) {
      warnings.push(`Where-used endpoint unavailable for ${baseName}; append structures were not resolved.`);
    } else {
      throw err;
    }
  }

  const extendRe = new RegExp(`extend\\s+type\\s+${escapeRegExp(baseName)}\\s+with`, 'i');
  const refs: EmbeddedStructureRef[] = [];
  for (const candidate of [...candidates].sort()) {
    const source = await readSource(candidate);
    if (source !== null && extendRe.test(source)) {
      refs.push({ name: candidate, attribute: null, kind: 'append' });
    }
  }
  return refs;
}

function summarizeStructureTree(tree: StructureNode): StructureHierarchyResult['summary'] {
  const summary = { totalNodes: 0, includes: 0, appends: 0, cyclic: 0, unresolved: 0, truncated: 0 };
  const visit = (node: StructureNode) => {
    summary.totalNodes += 1;
    if (node.kind === 'include') summary.includes += 1;
    if (node.kind === 'append') summary.appends += 1;
    if (node.cyclic) summary.cyclic += 1;
    if (node.error) summary.unresolved += 1;
    if (node.truncated) summary.truncated += 1;
    for (const child of node.children) visit(child);
  };
  visit(tree);
  return summary;
}

function normalizeStructureName(name: string): string {
  return name.trim().toUpperCase();
}

function parseMaxDepth(value: number | undefined): number {
  const parsed = Math.trunc(value ?? DEFAULT_MAX_DEPTH);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_DEPTH;
  return Math.max(1, Math.min(parsed, DEFAULT_MAX_DEPTH));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isUnavailableWhereUsedError(err: unknown): boolean {
  return err instanceof AdtApiError && WHERE_USED_UNAVAILABLE_STATUSES.has(err.statusCode);
}
