/** SAPRead input rules for structured and unfiltered data preview types. */

import { type CdsPreviewOptions, validateCdsPreviewOptions } from '../adt/cds-preview.js';

/** The SAPRead fields these rules read; validateSapReadInput extends it with the rest. */
export type DataPreviewInput = {
  type: string;
  name?: string;
  sqlFilter?: string;
  columns?: string[];
  where?: unknown[];
};

type IssueContext = { addIssue: (issue: { code: 'custom'; path: string[]; message: string }) => void };

export function validateDataPreviewInput(input: DataPreviewInput, ctx: IssueContext): void {
  if (input.type === 'CDS_PREVIEW') {
    const allowed = new Set(['type', 'name', 'columns', 'where', 'maxRows']);
    for (const [key, value] of Object.entries<unknown>(input)) {
      const filler =
        value === undefined ||
        value === null ||
        value === '' ||
        value === false ||
        (Array.isArray(value) && value.length === 0);
      if (!filler && !allowed.has(key))
        ctx.addIssue({ code: 'custom', path: [key], message: `CDS_PREVIEW does not accept ${key}.` });
    }
    try {
      validateCdsPreviewOptions(input.name ?? '', input as CdsPreviewOptions);
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        path: ['name'],
        message: error instanceof Error ? error.message : 'Invalid CDS_PREVIEW input.',
      });
    }
    return;
  }
  if (input.type === 'TABLE_QUERY') {
    if (!('name' in input) || !input.name) {
      ctx.addIssue({ code: 'custom', path: ['name'], message: 'TABLE_QUERY requires a table or CDS view name.' });
    }
  }

  // Each data preview type reads only its own filter parameters. A filter sent to the other type
  // would be dropped and return unfiltered rows that look filtered, so refuse it. Empty values stay
  // accepted: strict-mode clients send filler for every advertised property.
  if (input.type !== 'TABLE_CONTENTS' && input.sqlFilter?.trim()) {
    ctx.addIssue({
      code: 'custom',
      path: ['sqlFilter'],
      message:
        input.type === 'TABLE_QUERY'
          ? 'TABLE_QUERY does not accept sqlFilter. Use where, for example where=[{"field":"MANDT","op":"=","value":"100"}].'
          : 'sqlFilter is only supported for type=TABLE_CONTENTS.',
    });
  }
  for (const key of ['columns', 'where'] as const) {
    if (input.type !== 'TABLE_QUERY' && (input[key]?.length ?? 0) > 0) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message:
          input.type === 'TABLE_CONTENTS'
            ? `TABLE_CONTENTS does not accept ${key}. Use type=TABLE_QUERY with ${key}.`
            : `${key} is only supported for type=TABLE_QUERY.`,
      });
    }
  }

  if (input.type === 'TABLE_CONTENTS' && input.sqlFilter) {
    const sqlFilter = input.sqlFilter.trim();
    if (/^select\b/i.test(sqlFilter)) {
      ctx.addIssue({
        code: 'custom',
        path: ['sqlFilter'],
        message:
          'TABLE_CONTENTS sqlFilter must be a condition expression only (no SELECT statement). Example: "MANDT = \'100\'" or "MATNR LIKE \'Z%\'".',
      });
    }
    if (/^where\b/i.test(sqlFilter)) {
      ctx.addIssue({
        code: 'custom',
        path: ['sqlFilter'],
        message:
          'TABLE_CONTENTS sqlFilter must not start with WHERE. Pass only the condition expression, for example: "MANDT = \'100\'".',
      });
    }
    if (sqlFilter.includes(';')) {
      ctx.addIssue({
        code: 'custom',
        path: ['sqlFilter'],
        message:
          'TABLE_CONTENTS sqlFilter must contain exactly one condition expression (no semicolons or multiple statements).',
      });
    }
  }
}
