import { z } from 'zod';

export const GRAPH_ACTIONS = ['status', 'search', 'neighbors', 'impact', 'path', 'package_coupling'] as const;
export const RELATIONS = [
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
const name = z
  .string()
  .trim()
  .min(1)
  .max(255)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: reject control characters in external metadata
  .regex(/^[^\u0000-\u001f\u007f]+$/);
const objectType = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9_/]+$/);
export const graphInputSchema = z
  .object({
    action: z.enum(GRAPH_ACTIONS),
    query: name.optional(),
    name: name.optional(),
    type: objectType.optional(),
    targetName: name.optional(),
    targetType: objectType.optional(),
    depth: z.number().int().min(1).max(3).default(1),
    direction: z.enum(['incoming', 'outgoing', 'both']).default('both'),
    limit: z.number().int().min(1).max(100).default(20),
    maxNodes: z.number().int().min(1).max(100).default(100),
    maxEdges: z.number().int().min(1).max(300).default(300),
    kinds: z.array(z.enum(RELATIONS)).min(1).max(10).optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    const fields =
      input.action === 'search'
        ? ['query']
        : ['neighbors', 'impact', 'path'].includes(input.action)
          ? ['name', 'type', ...(input.action === 'path' ? ['targetName', 'targetType'] : [])]
          : [];
    for (const field of fields)
      if (!input[field as keyof typeof input])
        ctx.addIssue({ code: 'custom', path: [field], message: 'Required for this action' });
    if (input.action === 'impact' && input.kinds?.every((kind) => kind === 'belongs_to'))
      ctx.addIssue({ code: 'custom', path: ['kinds'], message: 'Impact requires a dependency relation' });
  });
export type GraphInput = z.infer<typeof graphInputSchema>;
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const coverageSchema = z
  .object({
    status: z.enum(['unknown', 'partial', 'complete']),
    generation: z.string().max(40).nullable(),
    asOf: z.iso.datetime({ offset: true }).nullable(),
    scope: z.string().max(1024).nullable(),
    extractorVersion: z.string().max(128).nullable(),
    sourceCounts: z.object({ parsed: count, failed: count, partial: count, dynamicTargets: count }).strict(),
  })
  .strict();
export const graphResponseSchema = z
  .object({
    apiVersion: z.literal(2),
    systemKey: z.string().regex(/^[A-Z0-9][A-Z0-9._:-]{0,127}$/),
    audience: z.string().min(1).max(128),
    action: z.enum(GRAPH_ACTIONS),
    coverage: coverageSchema,
    nodes: z
      .array(
        z
          .object({
            id,
            name,
            type: objectType,
            adtType: objectType,
            packageName: z.string().max(255),
            description: z.string().max(1024),
            resolutionStatus: z.enum(['resolved', 'unresolved', 'out_of_scope']),
          })
          .strict(),
      )
      .max(100),
    edges: z
      .array(
        z
          .object({
            id,
            sourceId: id,
            targetId: id,
            relation: z.enum(RELATIONS),
            evidenceMethod: z.string().min(1).max(128),
          })
          .strict(),
      )
      .max(300),
    couplings: z
      .array(z.object({ sourcePackage: name, targetPackage: name, observationCount: count }).strict())
      .max(100),
    startStatus: z.enum(['not_requested', 'found', 'not_indexed', 'ambiguous']),
    targetStatus: z.enum(['not_requested', 'found', 'not_indexed', 'ambiguous']),
    hasMore: z.boolean(),
    truncationReasons: z.array(z.enum(['result_limit', 'traversal_budget'])).max(2),
    pathFound: z.boolean().nullable(),
    scope: z
      .object({ depth: z.number().int().min(1).max(3), direction: z.enum(['incoming', 'outgoing', 'both']) })
      .strict(),
  })
  .strict()
  .superRefine((result, ctx) => {
    const ids = new Set(result.nodes.map((node) => node.id));
    if (
      ids.size !== result.nodes.length ||
      new Set(result.edges.map((edge) => edge.id)).size !== result.edges.length ||
      result.edges.some((edge) => !ids.has(edge.sourceId) || !ids.has(edge.targetId))
    )
      ctx.addIssue({ code: 'custom', message: 'Graph is not a closed deduplicated subgraph' });
    if (result.hasMore !== result.truncationReasons.length > 0)
      ctx.addIssue({ code: 'custom', message: 'Inconsistent truncation' });
  });
export type GraphResponse = z.infer<typeof graphResponseSchema>;
