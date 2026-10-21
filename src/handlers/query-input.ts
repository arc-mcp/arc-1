/** Separate SQL and bounded business-data arguments without widening either data permission. */
import { z } from 'zod';
import { ApplicationLogInputSchema } from './application-log-input.js';
import { LongTextInputSchema } from './long-text-input.js';

export function validateQueryOptions(
  input: Record<string, unknown>,
  ctx: { addIssue: (issue: { code: 'custom'; path: string[]; message: string }) => void },
): void {
  const nested =
    input.action === 'application_log' ? 'applicationLog' : input.action === 'long_text' ? 'longText' : undefined;
  if (!nested) {
    if (input.applicationLog !== undefined)
      ctx.addIssue({
        code: 'custom',
        path: ['applicationLog'],
        message: 'applicationLog requires action=application_log.',
      });
    if (input.longText !== undefined)
      ctx.addIssue({ code: 'custom', path: ['longText'], message: 'longText requires action=long_text.' });
    if (input.sql === undefined)
      ctx.addIssue({
        code: 'custom',
        path: ['sql'],
        message: 'SQL queries require sql; bounded data reads require action.',
      });
    return;
  }
  if (!input[nested])
    ctx.addIssue({
      code: 'custom',
      path: [nested],
      message: `action=${input.action} requires ${nested}.`,
    });
  for (const [field, value] of Object.entries(input)) {
    if (['action', nested].includes(field) || value === undefined) continue;
    ctx.addIssue({
      code: 'custom',
      path: [field],
      message: `action=${input.action} uses ${nested} only; omit ${field}.`,
    });
  }
}

export const SAPQuerySchema = z
  .object({
    action: z.enum(['sql', 'long_text', 'application_log']).optional(),
    sql: z.string().optional(),
    maxRows: z.coerce.number().optional(),
    longText: LongTextInputSchema.optional(),
    applicationLog: ApplicationLogInputSchema.optional(),
  })
  .strict()
  .superRefine(validateQueryOptions);

export const SAPQuerySchemaBtp = z
  .object({
    action: z
      .enum(['sql'], { error: 'BTP ABAP supports only action=sql; bounded text/log reads are unsupported.' })
      .optional(),
    sql: SAPQuerySchema.shape.sql.unwrap(),
    maxRows: SAPQuerySchema.shape.maxRows,
  })
  .strict();
