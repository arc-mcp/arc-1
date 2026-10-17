/** Separate SQL and bounded stored-text arguments without widening either data permission. */
import { z } from 'zod';
import { LongTextInputSchema } from './long-text-input.js';

export function validateLongTextQueryOptions(
  input: Record<string, unknown>,
  ctx: { addIssue: (issue: { code: 'custom'; path: string[]; message: string }) => void },
): void {
  if (input.action !== 'long_text') {
    if (input.longText !== undefined)
      ctx.addIssue({ code: 'custom', path: ['longText'], message: 'longText requires action=long_text.' });
    if (input.sql === undefined)
      ctx.addIssue({
        code: 'custom',
        path: ['sql'],
        message: 'SQL queries require sql; stored texts use action=long_text.',
      });
    return;
  }
  if (!input.longText)
    ctx.addIssue({
      code: 'custom',
      path: ['longText'],
      message: 'action=long_text requires longText with mode=discover, read or search.',
    });
  for (const [field, value] of Object.entries(input)) {
    if (['action', 'longText'].includes(field) || value === undefined) continue;
    ctx.addIssue({ code: 'custom', path: [field], message: `action=long_text uses longText only; omit ${field}.` });
  }
}

export const SAPQuerySchema = z
  .object({
    action: z.enum(['sql', 'long_text']).optional(),
    sql: z.string().optional(),
    maxRows: z.coerce.number().optional(),
    longText: LongTextInputSchema.optional(),
  })
  .strict()
  .superRefine(validateLongTextQueryOptions);

export const SAPQuerySchemaBtp = z
  .object({
    action: z
      .enum(['sql'], { error: 'BTP ABAP supports only action=sql; stored long texts are unsupported.' })
      .optional(),
    sql: SAPQuerySchema.shape.sql.unwrap(),
    maxRows: SAPQuerySchema.shape.maxRows,
  })
  .strict();
