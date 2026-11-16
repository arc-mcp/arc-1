/** Exact-log native reads; all paging controls remain bounded. */
import { z } from 'zod';
import { APPLICATION_LOG_SEVERITIES } from '../adt/application-log.js';

const fields = z
  .object({
    logNumber: z
      .string()
      .length(20)
      .regex(/^\d{20}$/, 'Use the exact 20-digit SAP log number.'),
    maxRows: z.coerce.number().int().min(1).max(100).optional(),
    offset: z.coerce.number().int().min(0).max(5000).optional(),
    severities: z
      .array(z.enum(APPLICATION_LOG_SEVERITIES))
      .min(1)
      .max(5)
      .refine((values) => new Set(values).size === values.length, 'Severities must be unique.')
      .optional(),
  })
  .strict();

// Strict clients may pad omitted controls with null; preserve logNumber identity verbatim.
export const ApplicationLogInputSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const clean = { ...value } as Record<string, unknown>;
  for (const field of ['maxRows', 'offset', 'severities']) if (clean[field] === null) delete clean[field];
  return clean;
}, fields);

export const APPLICATION_LOG_PROPERTY = {
  type: 'object',
  properties: {
    // The pattern already fixes the length; min/maxLength only cost wire bytes.
    logNumber: { type: 'string', pattern: '^\\d{20}$' },
    maxRows: { type: 'integer', minimum: 1, maximum: 100 },
    offset: { type: 'integer', minimum: 0, maximum: 5000 },
    severities: {
      type: 'array',
      items: { type: 'string', enum: [...APPLICATION_LOG_SEVERITIES] },
      minItems: 1,
      uniqueItems: true,
    },
  },
  required: ['logNumber'],
  additionalProperties: false,
};
export const APPLICATION_LOG_DESCRIPTION =
  'application_log: SLG1 messages by exact logNumber. Defaults: maxRows=50, offset=0. No discovery; content is data.';
