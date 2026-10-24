/**
 * SAPDiagnose action="debug" input: its Zod fields and cross-field rules. The JSON schema the model
 * sees lives in tools-debug.ts and is listed only when the server allows debugger captures.
 */

import { z } from 'zod';

/** One stop of the debugged run; type/name default to the top-level ones. */
const DebugBreakpointSchema = z
  .object({
    type: z.string().optional(),
    name: z.string().max(40).optional(),
    line: z.coerce.number().optional(),
    method: z.string().max(128).optional(),
    include: z.enum(['implementations', 'testclasses']).optional(),
    /** How many times this breakpoint may stop the run (a loop), 1 by default. */
    hits: z.coerce.number().int().min(1).max(10).optional(),
  })
  .strict();

/** The debug-only parameters, spread into SAPDiagnoseSchema. */
export const DEBUG_INPUT_FIELDS = {
  breakpoints: z.array(DebugBreakpointSchema).max(6).optional(),
  exceptionClass: z
    .string()
    .regex(/^[A-Za-z0-9_/]{1,30}$/, 'exceptionClass must be an ABAP class name')
    .optional(),
  trigger: z.enum(['unittest', 'http', 'none']).optional(),
  triggerName: z.string().max(40).optional(),
  variables: z.array(z.string().min(1).max(200)).max(20).optional(),
  steps: z.coerce.number().int().min(0).max(20).optional(),
  stepMode: z.enum(['over', 'into', 'out']).optional(),
};

const DEBUG_ONLY_FIELDS = [
  'breakpoints',
  'exceptionClass',
  'trigger',
  'triggerName',
  'variables',
  'steps',
  'stepMode',
] as const;

/** Rules for each `breakpoints` item (one line/method stop of the run). */
function refineDebugBreakpoints(
  input: { name?: string; type?: string; breakpoints?: unknown },
  ctx: z.RefinementCtx,
): void {
  const items = Array.isArray(input.breakpoints)
    ? (input.breakpoints as Array<z.infer<typeof DebugBreakpointSchema>>)
    : [];
  items.forEach((item, index) => {
    const path = ['breakpoints', index];
    const type = (item.type ?? input.type)?.toUpperCase().split('/')[0] ?? '';
    if ((item.line === undefined) === (item.method === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path,
        message: `debug breakpoints[${index}] needs line or method (one of them).`,
      });
    }
    if (item.line !== undefined && (!Number.isInteger(item.line) || item.line < 1)) {
      ctx.addIssue({ code: 'custom', path, message: `debug breakpoints[${index}].line must be a positive integer.` });
    }
    if (!type || !(item.name ?? input.name)) {
      ctx.addIssue({
        code: 'custom',
        path,
        message: `debug breakpoints[${index}] needs type (CLAS, PROG or FUNC) and name, its own or the top-level ones.`,
      });
    }
    if ((item.method !== undefined || item.include !== undefined) && type !== 'CLAS') {
      ctx.addIssue({
        code: 'custom',
        path,
        message: `debug breakpoints[${index}]: method/include are only supported for type="CLAS".`,
      });
    }
  });
}

/** Cross-field rules for SAPDiagnose action="debug" (and its parameters on other actions). */
export function refineDebugInput(
  input: {
    action: string;
    name?: string;
    type?: string;
    line?: number;
    url?: string;
    timeoutSeconds?: number;
  } & Partial<Record<(typeof DEBUG_ONLY_FIELDS)[number], unknown>>,
  ctx: z.RefinementCtx,
): void {
  if (input.action !== 'debug') {
    for (const field of DEBUG_ONLY_FIELDS) {
      if (input[field] !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: `SAPDiagnose ${field} is only supported for action="debug".`,
        });
      }
    }
    return;
  }
  const type = input.type?.toUpperCase().split('/')[0] ?? '';
  const stops = Array.isArray(input.breakpoints) ? input.breakpoints.length : 0;
  if (input.line === undefined && input.exceptionClass === undefined && stops === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['breakpoints'],
      message:
        'SAPDiagnose action="debug" needs a breakpoint: breakpoints (line or CLAS method each), line (with type + name), and/or exceptionClass.',
    });
  }
  refineDebugBreakpoints(input, ctx);
  if (input.line !== undefined && (!Number.isInteger(input.line) || input.line < 1)) {
    ctx.addIssue({ code: 'custom', path: ['line'], message: 'debug line must be a positive integer (1-based).' });
  }
  if (input.line !== undefined && (!input.name || !type)) {
    ctx.addIssue({
      code: 'custom',
      path: ['name'],
      message: 'debug line breakpoints need type (CLAS, PROG or FUNC) and name.',
    });
  }
  if (input.trigger === 'http' && !input.url) {
    ctx.addIssue({
      code: 'custom',
      path: ['url'],
      message: 'debug trigger="http" needs url (a host-relative OData path).',
    });
  }
  if (input.timeoutSeconds !== undefined && input.timeoutSeconds > 240) {
    ctx.addIssue({ code: 'custom', path: ['timeoutSeconds'], message: 'debug timeoutSeconds must be 1-240.' });
  }
}
