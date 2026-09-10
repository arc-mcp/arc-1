import { z } from 'zod';
import { RELATION_NAME, RELATION_ROOT_TYPES, relationObjectSpec } from '../adt/relation-objects.js';

/** Accept numeric strings, never JavaScript array/boolean/null-to-number coercion. */
export const relationNumber = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() !== '' ? Number(value) : value),
  z.number(),
);

export const LiveRelationsInput = z
  .object({
    action: z.literal('relations'),
    type: z.preprocess(
      (value) => (typeof value === 'string' ? (relationObjectSpec(value)?.type ?? value) : value),
      z.enum(RELATION_ROOT_TYPES, {
        error: (issue) =>
          issue.input === undefined
            ? 'relations requires type (the root object type). Retry with type and name; objectType is only a references result filter, not the relations root type.'
            : issue.input === 'SOBJ' || issue.input === 'SOBJ/MO'
              ? 'relations does not support SOBJ roots: native SOBJ/MO means a maintenance object, whereas SAPRead SOBJ means a different BOR object. Do not substitute a BOR read or omit type to retry this maintenance-object map.'
              : undefined,
      }),
    ),
    name: z.string().min(1).max(120).regex(RELATION_NAME),
    direction: z.enum(['incoming', 'outgoing']).default('outgoing'),
    depth: relationNumber.pipe(z.number().int().min(1).max(3)).default(1),
    maxResults: relationNumber.pipe(z.number().int().min(1).max(100)).default(50),
    expandPackages: z.array(z.string().min(1).max(120).regex(RELATION_NAME)).max(8).optional(),
  })
  .strict();
