import { z } from 'zod';

const contextName = /^(?:\/[A-Za-z0-9_]+\/)?[A-Za-z0-9_$]{1,40}$/;
export const extensionReadFields = {
  extensions: z.enum(['none', 'summary', 'sources']).optional(),
  enhancementContext: z
    .object({ type: z.enum(['PROG', 'FUGR', 'CLAS']), name: z.string().max(80).regex(contextName) })
    .strict()
    .optional(),
};

export const extensionReadProperties = {
  extensions: {
    type: 'string',
    enum: ['none', 'summary', 'sources'],
    description:
      'TABL full reads default summary; partial reads default none. sources adds bounded labelled appends/includes. Other families/inactive: unsupported.',
  },
  enhancementContext: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['PROG', 'FUGR', 'CLAS'] },
      name: { type: 'string', maxLength: 80, pattern: contextName.source },
    },
    required: ['type', 'name'],
    additionalProperties: false,
    description: 'INCL only: owning main object.',
  },
};

export function validateExtensionReadInput(
  input: Record<string, unknown>,
  ctx: { addIssue: (issue: { code: 'custom'; path: string[]; message: string }) => void },
): void {
  if (input.enhancementContext !== undefined && input.type !== 'INCL')
    ctx.addIssue({ code: 'custom', path: ['enhancementContext'], message: 'enhancementContext requires type=INCL.' });
  if (
    input.extensions !== undefined &&
    (!['TABL', 'PROG', 'INCL', 'FUNC', 'FUGR', 'CLAS', 'INTF', 'BDEF'].includes(String(input.type)) ||
      input.action ||
      ['indexes', 'text_symbols'].includes(String(input.include).toLowerCase()) ||
      input.format === 'editable')
  )
    ctx.addIssue({
      code: 'custom',
      path: ['extensions'],
      message: 'extensions requires a supported source read (TABL, PROG, INCL, FUNC, FUGR, CLAS, INTF, BDEF).',
    });
}
