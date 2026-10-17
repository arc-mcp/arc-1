import { z } from 'zod';
import { ATC_BATCH_MAX_OBJECTS, ATC_BATCH_NAME_MAX_LENGTH, ATC_BATCH_NAME_PATTERN } from '../adt/atc-batch.js';
import { SYNTAX_BATCH_TYPES } from '../adt/syntax-batch.js';
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

export const diagnosticObjectsSchema = (types: readonly string[]) =>
  z
    .array(
      z
        .object({
          type: z.enum(types),
          name: z.string().min(1).max(ATC_BATCH_NAME_MAX_LENGTH).regex(new RegExp(ATC_BATCH_NAME_PATTERN)),
        })
        .strict(),
    )
    .min(1)
    .max(ATC_BATCH_MAX_OBJECTS)
    .optional();
export const diagnosticObjectsJson = (types: readonly string[]) => ({
  type: 'array',
  minItems: 1,
  maxItems: ATC_BATCH_MAX_OBJECTS,
  items: {
    type: 'object',
    required: ['type', 'name'],
    additionalProperties: false,
    properties: {
      type: { type: 'string', enum: [...types] },
      name: { type: 'string', minLength: 1, maxLength: ATC_BATCH_NAME_MAX_LENGTH, pattern: ATC_BATCH_NAME_PATTERN },
    },
  },
});
/** Existing SAPRead syntax compatibility: only harmless strict-client defaults are ignored. */
export function isDiagnosticPlaceholder(key: string, value: unknown): boolean {
  return (
    value === false ||
    (Array.isArray(value) && value.length === 0) ||
    (key === 'format' && value === 'text') ||
    (key === 'maxResults' && value === 0)
  );
}
export function validateDiagnosticInputs(input: Record<string, unknown>, ctx: z.RefinementCtx) {
  const issue = (key: string, message: string) => ctx.addIssue({ code: 'custom', path: [key], message });
  if (input.filters !== undefined && (input.action !== 'dumps' || input.id !== undefined))
    issue('filters', 'filters requires dumps list mode.');
  let allowed: string[] | undefined;
  if (input.action === 'feed_schema') allowed = ['action'];
  if (input.action === 'activation_log') {
    allowed = ['action', 'type', 'name'];
    if (
      typeof input.name !== 'string' ||
      !new RegExp(ATC_BATCH_NAME_PATTERN).test(input.name) ||
      input.name.length > ATC_BATCH_NAME_MAX_LENGTH
    )
      issue('name', 'activation_log requires a repository object name.');
    if (!['DOMA', 'DTEL', 'TABL', 'DDLS'].includes(String(input.type)))
      issue('type', 'activation_log supports DOMA, DTEL, TABL and DDLS.');
  }
  if (input.action === 'dumps' && input.filters !== undefined)
    allowed = ['action', 'filters', 'user', 'from', 'to', 'maxResults'];
  if (input.action === 'syntax' && input.objects !== undefined) {
    allowed = ['action', 'objects', 'version'];
    if ((input.objects as { type: string }[]).some((o) => !(SYNTAX_BATCH_TYPES as readonly string[]).includes(o.type)))
      issue('objects', 'Batch syntax supports CLAS, PROG, INTF and DDLS.');
  }
  if (allowed)
    for (const [key, value] of Object.entries(input))
      if (value !== undefined && !allowed.includes(key) && !isDiagnosticPlaceholder(key, value))
        issue(key, `${key} is not supported for ${input.action}.`);
}
