/**
 * SAPDiagnose action="debug" schema fragment. Listed only when the server ceiling allows debugger
 * captures, so the default tools/list stays byte-identical (and token-free) for everyone else.
 */

import type { ServerConfig } from '../server/types.js';

/** Debugger captures need SAP_ALLOW_DEBUG and SAP_ALLOW_DATA_PREVIEW (variable values are data). */
export function isDebugActionVisible(config: Pick<ServerConfig, 'allowDebug' | 'allowDataPreview'>): boolean {
  return config.allowDebug && config.allowDataPreview;
}

export const SAPDIAGNOSE_DEBUG_DESCRIPTION =
  '- "debug": capture ONE run (breakpoints/line/exceptionClass, trigger): stack+variables(+steps) per stop, released; list variables up front. line: 1-based; timeoutSeconds: first-hit wait (60, max 240).\n';

export const SAPDIAGNOSE_DEBUG_PROPERTIES: Record<string, unknown> = {
  breakpoints: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        name: { type: 'string' },
        line: { type: 'number' },
        method: { type: 'string' },
        include: { type: 'string' },
        hits: { type: 'number' },
      },
    },
    description:
      'debug: stops (max 6): line|method (CLAS: lhc_x~check), include (implementations|testclasses, else auto), hits (1-10); type/name default to top-level.',
  },
  exceptionClass: { type: 'string', description: 'debug: stop when this exception is raised.' },
  trigger: {
    type: 'string',
    enum: ['unittest', 'http', 'none'],
    description:
      'debug: unittest (default: ABAP Unit of triggerName or breakpoint object), http (GET url), none (user runs it, same SAP user).',
  },
  triggerName: { type: 'string', description: 'debug: unit-test CLAS/PROG/FUGR (else breakpoint object).' },
  variables: {
    type: 'array',
    items: { type: 'string' },
    description: 'debug: read per stop/step (LV_X, LS_S-F, ME->MV_A); default: locals.',
  },
  steps: { type: 'number', description: 'debug: steps per stop (0-20).' },
  stepMode: { type: 'string', enum: ['over', 'into', 'out'], description: 'debug: step kind (default over).' },
};
