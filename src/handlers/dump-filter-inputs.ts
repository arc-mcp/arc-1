import { z } from 'zod';
export const dumpFilters = z
  .array(
    z
      .object({
        attribute: z.string().max(40),
        operator: z.string().max(40),
        values: z.array(z.string().max(128)).min(1).max(2),
      })
      .strict(),
  )
  .min(1)
  .max(8);
export const dumpFiltersJson = {
  type: 'array',
  minItems: 1,
  maxItems: 8,
  items: {
    type: 'object',
    properties: {
      attribute: { type: 'string', maxLength: 40 },
      operator: { type: 'string', maxLength: 40 },
      values: { type: 'array', items: { type: 'string', maxLength: 128 }, minItems: 1, maxItems: 2 },
    },
    required: ['attribute', 'operator', 'values'],
    additionalProperties: false,
  },
};

/** Reject meaningful unrelated inputs; tolerate harmless strict-client placeholders. */
export function validateDumpFilterInputs(input: Record<string, unknown>, ctx: z.RefinementCtx) {
  if (input.filters !== undefined && (input.action !== 'dumps' || input.id !== undefined))
    ctx.addIssue({ code: 'custom', path: ['filters'], message: 'filters requires dumps list mode.' });
  const allowed =
    input.action === 'feed_schema'
      ? ['action']
      : input.action === 'dumps' && input.filters !== undefined
        ? ['action', 'filters', 'user', 'from', 'to', 'maxResults']
        : undefined;
  if (!allowed) return;
  for (const [key, value] of Object.entries(input)) {
    const placeholder =
      value === false || (Array.isArray(value) && value.length === 0) || (key === 'maxResults' && value === 0);
    if (value !== undefined && !allowed.includes(key) && !placeholder)
      ctx.addIssue({ code: 'custom', path: [key], message: `${key} is not supported for ${input.action}.` });
  }
}
