import { getCurrentContext } from '../server/context.js';
import { discoverDdicAppends } from './ddic-extensions.js';
import { type EmbeddedStructureRef, parseEmbeddedStructures } from './embedded-structures.js';
import {
  assertExtensionReadAllowed,
  type ExtensionDiscoveryResult,
  ExtensionDiscoverySession,
  ExtensionProtocolError,
  type ExtensionProvider,
} from './extension-discovery.js';
import { parseRelationXml } from './repository-relations.js';

export { type EmbeddedStructureRef, parseEmbeddedStructures } from './embedded-structures.js';

import type { AdtClient, SourceReadOptions, SourceReadResult } from './client.js';
import { findWhereUsed, type WhereUsedResult } from './codeintel.js';
import { AdtApiError, isNotFoundError } from './errors.js';

export type StructureNodeKind = 'root' | 'include' | 'append';

export interface StructureNode {
  structure: string;
  attribute: string | null;
  kind: StructureNodeKind;
  children: StructureNode[];
  suffix?: string;
  cyclic?: boolean;
  truncated?: boolean;
  error?: string;
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
  extensionDiscovery?: ExtensionDiscoveryResult;
  warnings?: string[];
}

type StructureHierarchyClient = Pick<AdtClient, 'getTabl' | 'resolveTablObjectUrl' | 'http' | 'safety'>;

const DEFAULT_MAX_DEPTH = 5;
const MAX_APPEND_CANDIDATES = 12;
const WHERE_USED_UNAVAILABLE_STATUSES = new Set([400, 404, 405, 415, 501]);

export async function buildStructureHierarchy(
  client: StructureHierarchyClient,
  name: string,
  options: { version?: SourceReadOptions['version']; includeExtensions?: boolean; maxDepth?: number } = {},
): Promise<StructureHierarchyResult> {
  assertExtensionReadAllowed(client.safety, 'TABL');
  const rootName = normalizeStructureName(name);
  const includeExtensions = options.includeExtensions !== false;
  const maxDepth = parseMaxDepth(options.maxDepth);
  const warnings: string[] = [];
  const sourceCache = new Map<string, string | null>();
  let appendDiscoveryDisabled = false;
  let session: ExtensionDiscoverySession | undefined;
  let totalNodes = 0;
  const appendCache = new Map<string, EmbeddedStructureRef[]>();

  const readSource = async (structureName: string): Promise<string | null> => {
    const upper = normalizeStructureName(structureName);
    if (sourceCache.has(upper)) return sourceCache.get(upper) ?? null;

    try {
      const result: SourceReadResult = session
        ? await session.read('TABL', (request) =>
            client.getTabl(upper, { ...request, version: options.version ?? 'active' }),
          )
        : await client.getTabl(upper, { version: options.version ?? 'active' });
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

  session = new ExtensionDiscoverySession(
    'sources',
    {
      root: { type: 'TABL', name: rootName, version: options.version ?? 'active' },
      scope: 'explicit structure hierarchy',
    },
    client.safety,
    { signal: getCurrentContext()?.signal },
  );

  const buildNode = async (
    structureName: string,
    kind: StructureNodeKind,
    attribute: string | null,
    path: readonly string[],
    suffix?: string,
  ): Promise<StructureNode> => {
    const upper = normalizeStructureName(structureName);
    const node: StructureNode = { structure: upper, attribute, kind, children: [], ...(suffix ? { suffix } : {}) };
    totalNodes++;

    if (path.includes(upper)) {
      node.cyclic = true;
      return node;
    }

    let source: string | null = null;
    const sourceProvider: ExtensionProvider = {
      id: 'structure_source',
      family: 'ddic_include',
      status: 'returned',
      coverage: 'bounded_traversal',
      scope: upper,
    };
    await session!.provider(sourceProvider, async () => {
      source = await readSource(upper);
    });
    if (source === null) {
      sourceProvider.status = sourceProvider.status === 'denied' ? 'denied' : 'incomplete';
      sourceProvider.reason ??= 'source_unavailable';
      session!.omit('sources');
      node.error = `Could not read source for ${upper}`;
      return node;
    }

    if (path.length >= maxDepth) {
      node.truncated = true;
      session!.omit('depth');
      return node;
    }

    let extensionRefs: EmbeddedStructureRef[] = [];
    if (appendCache.has(upper)) extensionRefs = appendCache.get(upper)!;
    else if (includeExtensions && !appendDiscoveryDisabled && !session!.stopped) {
      const found = await discoverDdicAppends(client, session!, upper, path.length);
      extensionRefs = found.references.map((ref) => ({ name: ref.name, kind: 'append', attribute: null }));
      if (
        ['not_advertised', 'unsupported'].includes(found.provider.status) &&
        found.provider.reason !== 'unsupported_version'
      ) {
        warnings.push(
          `Append coverage for ${upper} uses a source-verified where-used candidate index; completeness is unknown.`,
        );
        const fallback: ExtensionProvider = {
          id: 'ddic_where_used',
          family: 'ddic_append',
          status: 'returned',
          coverage: 'candidate_index',
          scope: upper,
        };
        await session!.provider(fallback, async () => {
          extensionRefs = await findExtensionRefs(client, session!, upper, readSource, warnings, (reason) => {
            appendDiscoveryDisabled = true;
            fallback.status = reason === 'unsupported' ? 'unsupported' : 'incomplete';
            fallback.reason = reason;
          });
        });
      }
    }
    appendCache.set(upper, extensionRefs);
    const scanIssues: string[] = [];
    const embedded = parseEmbeddedStructures(source, scanIssues);
    if (scanIssues.length) {
      node.error = `Include scan incomplete: ${scanIssues.join(', ')}`;
      warnings.push(`DDIC ${upper}: ${node.error}`);
    }
    const childRefs = [...embedded, ...extensionRefs];
    const nextPath = [...path, upper];
    for (const ref of childRefs) {
      if (totalNodes >= session!.limits.nodes) {
        node.truncated = true;
        session!.omit('nodes');
        break;
      }
      if (session!.stopped) {
        totalNodes++;
        session!.omit('sources');
        node.children.push({
          structure: ref.name,
          attribute: ref.attribute,
          kind: ref.kind,
          children: [],
          truncated: true,
          ...(ref.suffix ? { suffix: ref.suffix } : {}),
        });
      } else node.children.push(await buildNode(ref.name, ref.kind, ref.attribute, nextPath, ref.suffix));
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
    ...(includeExtensions ? { extensionDiscovery: session.finish() } : {}),
    ...(warnings.length > 0 || session.result.issues.length > 0
      ? { warnings: [...new Set([...warnings, ...session.result.issues])] }
      : {}),
  };
}

async function findExtensionRefs(
  client: StructureHierarchyClient,
  session: ExtensionDiscoverySession,
  baseName: string,
  readSource: (name: string) => Promise<string | null>,
  warnings: string[],
  disableAppendDiscovery: (reason: 'unsupported' | 'candidate_limit') => void,
): Promise<EmbeddedStructureRef[]> {
  const candidates = new Set<string>();
  const baseObjectUrl = await session.read('TABL', (options) => client.resolveTablObjectUrl(baseName, options));
  const collectCandidates = (results: readonly WhereUsedResult[]) => {
    for (const result of results) {
      if (result.type.toUpperCase() !== 'TABL/DS' || result.isResult === false) continue;
      const candidate = normalizeStructureName(result.name);
      if (!/^(?:\/[A-Z0-9_]+\/)?[A-Z0-9_$]{1,30}$/.test(candidate))
        throw new ExtensionProtocolError('Invalid append candidate.');
      if (candidate === baseName) continue;
      candidates.add(candidate);
    }
  };

  try {
    collectCandidates(
      await session.read('TABL', (options) =>
        findWhereUsed(client.http, client.safety, baseObjectUrl, undefined, options, validateAppendIndex),
      ),
    );
  } catch (err) {
    if (isUnavailableWhereUsedError(err)) {
      warnings.push(
        `Where-used endpoint unavailable for ${baseName}; append discovery was skipped for the rest of the tree.`,
      );
      disableAppendDiscovery('unsupported');
    } else {
      throw err;
    }
  }

  // Every candidate needs a source read; large where-used lists otherwise fan out into thousands of requests.
  if (candidates.size > MAX_APPEND_CANDIDATES) {
    warnings.push(
      `Where-used returned ${candidates.size} structure candidates for ${baseName}, exceeding the append scan limit of ${MAX_APPEND_CANDIDATES}; append discovery was skipped for the rest of the tree.`,
    );
    session.omit('candidates', candidates.size);
    disableAppendDiscovery('candidate_limit');
    return [];
  }

  const extendRe = new RegExp(`^\\s*extend\\s+type\\s+${escapeRegExp(baseName)}\\s+with`, 'im');
  const refs: EmbeddedStructureRef[] = [];
  for (const candidate of [...candidates].sort()) {
    const source = await readSource(candidate);
    if (source !== null && extendRe.test(source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''))) {
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

function validateAppendIndex(xml: string): void {
  try {
    const parsed = parseRelationXml(xml);
    if (!Object.hasOwn(parsed, 'usageReferenceResult')) throw new ExtensionProtocolError('Invalid append index.');
  } catch {
    throw new ExtensionProtocolError('Invalid append index.');
  }
}
