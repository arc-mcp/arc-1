import { z } from 'zod';
import { RELATION_NAME } from '../adt/repository-relations.js';

/** Accept numeric strings, never JavaScript array/boolean/null-to-number coercion. */
export const relationNumber = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() !== '' ? Number(value) : value),
  z.number(),
);

export const LiveRelationsInput = z
  .object({
    action: z.literal('relations'),
    type: z.enum(['CLAS', 'INTF']),
    name: z.string().min(1).max(120).regex(RELATION_NAME),
    direction: z.enum(['incoming', 'outgoing']).default('outgoing'),
    depth: relationNumber.pipe(z.number().int().min(1).max(3)).default(1),
    maxResults: relationNumber.pipe(z.number().int().min(1).max(100)).default(50),
    expandPackages: z.array(z.string().min(1).max(120).regex(RELATION_NAME)).max(8).optional(),
  })
  .strict();
