/**
 * Field-key parity between the Zod schemas (schemas.ts) and the hand-written JSON Schema
 * (tools.ts) — Stage A5, pulled from backlog B3.
 *
 * The two are maintained by hand and can silently drift: a field added to Zod but not to the
 * JSON Schema is invisible to LLM clients (they're never told it exists); a field in the JSON
 * Schema but not Zod is accepted-then-ignored. Today every tool has exact key parity, so the
 * allowlist below is empty. If you intentionally make them differ (rare), add the
 * `tool:field` to INTENTIONAL_MISMATCHES with a comment — don't just delete the assertion.
 *
 * Note: this checks the *property key set*, not types/descriptions. The full JSON byte surface
 * is frozen separately by tool-definitions-snapshot.test.ts.
 */

import { describe, expect, it } from 'vitest';
import { RELATIONS_MIME, RELATIONS_PATH } from '../../../src/adt/repository-relations.js';
import { getToolSchema } from '../../../src/handlers/schemas.js';
import { getToolDefinitions } from '../../../src/handlers/tools.js';
import { features, fullConfig } from './handler-test-config.js';

const TOOLS = [
  'SAPRead',
  'SAPSearch',
  'SAPWrite',
  'SAPActivate',
  'SAPNavigate',
  'SAPQuery',
  'SAPTransport',
  'SAPGit',
  'SAPContext',
  'SAPLint',
  'SAPDiagnose',
  'SAPManage',
] as const;

// Permanent schema differences only; the denied relations projection is checked explicitly below.
const INTENTIONAL_MISMATCHES = new Set<string>([]);

// Unwrap Zod v4 wrappers (superRefine/ZodEffects/pipe/optional/default) down to the ZodObject.
function zodObjectKeys(schema: unknown): string[] {
  let cur: any = schema;
  for (let i = 0; i < 10 && cur; i++) {
    if (cur.shape) return Object.keys(cur.shape);
    const d = cur._def ?? cur.def;
    if (!d) break;
    cur = d.innerType ?? d.schema ?? (typeof d.in === 'object' ? d.in : undefined) ?? d.out;
  }
  throw new Error('could not unwrap Zod schema to an object');
}

function jsonSchemaKeys(tool: string, btp: boolean, relationsAllowed: boolean): string[] | null {
  // features() has every backend feature available, so feature-gated tools (SAPGit) are registered.
  const defs = getToolDefinitions(
    { ...fullConfig(btp), denyActions: relationsAllowed ? [] : ['SAPNavigate.relations'] },
    true,
    features(),
    {
      discoveryMap: new Map([[RELATIONS_PATH, [RELATIONS_MIME]]]),
    },
  );
  const def = defs.find((d) => d.name === tool);
  if (!def) return null;
  return Object.keys((def.inputSchema as any).properties ?? {});
}

describe.each([false, true])('Zod ↔ JSON-Schema field-key parity, relationsAllowed=%s', (relationsAllowed) => {
  for (const tool of TOOLS) {
    for (const btp of [false, true]) {
      it(`${tool} (${btp ? 'btp' : 'onprem'}) has matching property keys`, () => {
        const jsonKeys = jsonSchemaKeys(tool, btp, relationsAllowed);
        // Under the all-gates-on full config every one of the 12 tools must be registered — a null
        // means the tool silently dropped out of getToolDefinitions (a gating regression), which
        // would otherwise make this parity check pass vacuously. Fail loudly instead.
        expect(jsonKeys, `${tool} (${btp ? 'btp' : 'onprem'}) is not registered under the full config`).not.toBeNull();
        const zodKeys = new Set(zodObjectKeys(getToolSchema(tool, btp)));
        const jsonSet = new Set(jsonKeys);
        if (tool === 'SAPNavigate' && !relationsAllowed) {
          // Runtime accepts deliberate conditional invocations, but denied tools/list must hide ONLY these fields.
          for (const field of ['direction', 'depth', 'expandPackages']) {
            expect(zodKeys.has(field)).toBe(true);
            expect(jsonSet.has(field)).toBe(false);
            zodKeys.delete(field);
          }
        }

        const onlyZod = [...zodKeys].filter((k) => !jsonSet.has(k) && !INTENTIONAL_MISMATCHES.has(`${tool}:${k}`));
        const onlyJson = [...jsonSet].filter((k) => !zodKeys.has(k) && !INTENTIONAL_MISMATCHES.has(`${tool}:${k}`));

        expect(onlyZod, `${tool} fields in Zod but missing from JSON Schema (LLM can't see them)`).toEqual([]);
        expect(onlyJson, `${tool} fields in JSON Schema but missing from Zod (accepted then ignored)`).toEqual([]);
      });
    }
  }
});
