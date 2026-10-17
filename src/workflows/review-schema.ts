import { z } from 'zod';

const revision = z.object({ id: z.string(), uri: z.string(), timestamp: z.string(), author: z.string() }).passthrough();
const part = z
  .object({
    part: z.string(),
    baselineStatus: z.enum([
      'prior-revision',
      'prior-revision-unverified',
      'no-prior-snapshot',
      'baseline-ambiguous',
      'baseline-unavailable',
    ]),
    selectionMethod: z.enum(['exact-transport', 'latest-revision-fallback', 'active-only-fallback', 'no-revisions']),
    from: z.string().nullable(),
    to: z.string().nullable(),
    added: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    diff: z.string(),
    diffTruncated: z.boolean().optional(),
    hunksOmitted: z.boolean().optional(),
    statisticsComplete: z.boolean(),
    change: z.enum(['changed', 'unchanged', 'cosmetic', 'unknown']),
    historyCompleteness: z.enum(['not-advertised', 'partial']).optional(),
    sourceHashes: z
      .object({
        before: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .nullable(),
        after: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .optional(),
    revisions: z
      .object({
        before: revision.nullable(),
        after: revision.nullable(),
        skipped: z.array(z.object({ revision, reason: z.string() })),
      })
      .optional(),
  })
  .passthrough();

const reviewEvidenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    resultFormat: z.literal('structured'),
    target: z.string(),
    client: z.string(),
    transport: z.object({ id: z.string(), status: z.string() }).passthrough(),
    reviewMode: z.enum(['legacy', 'released', 'active', 'draft']),
    inventoryFingerprint: z.string(),
    offset: z.number().int().nonnegative(),
    shown: z.number().int().nonnegative(),
    totalObjects: z.number().int().nonnegative(),
    nextOffset: z.number().int().nonnegative().optional(),
    objects: z.array(
      z
        .object({
          type: z.string(),
          name: z.string(),
          taskIds: z.array(z.string()),
          components: z.array(
            z.object({ pgmid: z.string(), type: z.string(), name: z.string(), wbtype: z.string(), taskId: z.string() }),
          ),
          parts: z.array(part),
          inventoryReason: z.string().optional(),
          coverageGaps: z.array(z.string()).optional(),
        })
        .passthrough()
        .refine(
          (o) => o.parts.length > 0 || !!o.inventoryReason,
          'An object without source parts must explain the coverage gap.',
        )
        .refine((o) => new Set(o.parts.map((p) => p.part)).size === o.parts.length, 'Duplicate source part.'),
    ),
  })
  .passthrough();
export const reviewPageSchema = reviewEvidenceSchema.extend({ continuation: z.string() });
export type ReviewPageEvidence = z.infer<typeof reviewEvidenceSchema>;
export type ReviewPage = z.infer<typeof reviewPageSchema>;
