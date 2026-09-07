import { Config, MemoryFile, Objects, Registry, Version } from '@abaplint/core';
import type { GraphEdgeInput, GraphNodeInput, NodeRef, RelationKind } from '../graph/types.js';
import { normalizeNodeRef } from '../graph/types.js';
import { analyzeAbapSource, type ExtractedReference, type SourceAnalysis, SourceParseError } from './abap-extractor.js';

export { analyzeAbapSource, extractAbapReferences, SourceParseError } from './abap-extractor.js';

interface SourceObject extends GraphNodeInput {
  source: string;
}

function cleanCds(source: string): string {
  // Consume lexical tokens in source order: comment markers inside strings are not comments.
  // Preserve newlines and offsets so evidence locations still refer to the original source.
  return source.replace(/'(?:''|[^'])*'|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, (token) => token.replace(/[^\r\n]/g, ' '));
}

export function extractCdsReferences(source: string): ExtractedReference[] {
  const cleaned = cleanCds(source);
  const references: ExtractedReference[] = [];
  const patterns: Array<[RegExp, RelationKind]> = [
    [/\bselect\s+from\s+([\w/]+)/gi, 'reads_from'],
    [/\bprojection\s+on\s+([\w/]+)/gi, 'projects_on'],
    [/\bjoin\s+([\w/]+)/gi, 'reads_from'],
    [
      /\bassociation\s+(?:\[[^\]]*\]\s+|of\s+(?:exact\s+one|one|many)\s+)?to\s+(?:(?:parent|exact\s+one|one|many)\s+)?([\w/]+)/gi,
      'associates_to',
    ],
    [/\bcomposition\s+(?:\[[^\]]*\]\s+)?of\s+([\w/]+)/gi, 'composes'],
  ];
  for (const [pattern, relation] of patterns) {
    for (const match of cleaned.matchAll(pattern)) {
      const name = match[1]?.toUpperCase();
      if (!name || references.some((item) => item.name === name && item.relation === relation)) continue;
      const line = cleaned.slice(0, match.index).split('\n').length;
      references.push({ line, name, relation });
    }
  }
  return references;
}

export function analyzeCdsSource(source: string, objectName: string): SourceAnalysis {
  const registry = new Registry(Config.getDefault(Version.v758));
  registry.addFile(new MemoryFile(`${objectName.replaceAll('/', '#')}.ddls.asddls`, source));
  registry.parse();
  const object = [...registry.getObjects()].find((candidate) => candidate instanceof Objects.DataDefinition);
  const parsed = object instanceof Objects.DataDefinition && !object.hasParserError() && !!object.getTree();
  return {
    dynamicTargets: 0,
    method: 'cds-static-v2',
    reasons: parsed ? [] : [source.trim() ? 'unsupported_cds' : 'empty_source'],
    references: parsed ? extractCdsReferences(source) : [],
    status: parsed ? 'parsed' : 'failed',
  };
}

function inferredType(name: string, relation: RelationKind): string {
  if (relation === 'function_call') return 'FUNC';
  if (relation === 'implements' || name.startsWith('ZIF_') || name.startsWith('YIF_') || name.startsWith('IF_')) {
    return 'INTF';
  }
  if (/^(ZCL_|YCL_|CL_|ZCX_|YCX_|CX_|\/[^/]+\/CL_|\/[^/]+\/CX_)/.test(name)) return 'CLAS';
  if (['projects_on', 'associates_to', 'composes'].includes(relation)) return 'DDLS';
  if (relation === 'reads_from') return 'UNRESOLVED';
  return 'UNRESOLVED';
}

function resolveTarget(
  systemKey: string,
  name: string,
  relation: RelationKind,
  knownTargets: Map<string, NodeRef[]>,
): NodeRef {
  const candidates = knownTargets.get(`${systemKey}\u0000${name}`) ?? [];
  const expectedType = inferredType(name, relation);
  const expected = candidates.filter(
    (candidate) => candidate.type === expectedType || candidate.type.startsWith(`${expectedType}/`),
  );
  if (expected.length === 1) return expected[0]!;
  if (candidates.length === 1) return candidates[0]!;
  return { name, systemKey, type: expectedType };
}

export function extractGraphObject(
  object: SourceObject,
  catalog: GraphNodeInput[],
): {
  analysis: SourceAnalysis;
  evidenceScope: { evidenceOwner: string; sourceResource: string };
  node: GraphNodeInput;
  observations: GraphEdgeInput[];
} {
  const sourceRef = normalizeNodeRef(object);
  const knownTargets = new Map<string, NodeRef[]>();
  for (const node of catalog) {
    const normalized = normalizeNodeRef(node);
    const key = `${normalized.systemKey}\u0000${normalized.name}`;
    knownTargets.set(key, [...(knownTargets.get(key) ?? []), normalized]);
  }
  const analysis = sourceRef.type.startsWith('DDLS')
    ? analyzeCdsSource(object.source, sourceRef.name)
    : analyzeAbapSource(object.source, sourceRef.type, sourceRef.name);
  if (analysis.status !== 'parsed') throw new SourceParseError(analysis);
  const evidenceOwner = `${sourceRef.type}:${sourceRef.name}`;
  const sourceResource = `active:${sourceRef.type}:${sourceRef.name}`;
  return {
    analysis,
    evidenceScope: { evidenceOwner, sourceResource },
    node: {
      description: object.description,
      locator: object.locator,
      name: sourceRef.name,
      packageName: object.packageName,
      resolutionStatus: object.resolutionStatus,
      systemKey: sourceRef.systemKey,
      type: sourceRef.type,
    },
    observations: analysis.references.map((reference) => {
      const target = resolveTarget(sourceRef.systemKey, reference.name, reference.relation, knownTargets);
      return {
        evidenceMethod: analysis.method,
        evidenceOwner,
        relation: reference.relation,
        source: sourceRef,
        sourceResource,
        target,
      };
    }),
  };
}
