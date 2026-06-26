/**
 * Zod ↔ JSON-Schema per-property TYPE parity (the sync-test fallback from the PR-5 spike).
 *
 * tools.ts (the JSON Schema the LLM sees) is hand-written; schemas.ts (the Zod runtime validation)
 * is independent. Three guards already keep them in sync:
 *   - schema-key-sync.test.ts        — the property KEY set matches
 *   - registry-sync.test.ts          — the `type` field's enum matches the registry
 *   - tool-definitions-snapshot.test — the exact JSON bytes are frozen
 * The one drift class none of them catch: a field whose BASE TYPE is changed in Zod but not in
 * tools.ts (e.g. boolean→string). It would pass key-sync (key present), pass the snapshot (tools.ts
 * unchanged), and pass registry-sync (not the type enum) — yet silently make Zod reject what the LLM
 * is told is valid. This test closes that sliver by deriving each tool's JSON Schema from Zod via
 * z.toJSONSchema() and asserting the per-property base type + enum membership match the hand-written
 * schema, modulo the two documented, mechanical differences:
 *   - descriptions          — live only in tools.ts, never in Zod (see docs/research/2026-06-12-zod-to-jsonschema-spike.md)
 *   - nullable optional props — tools.ts wraps SAPWrite optionals as `type: [..., "null"]` for OpenAI
 *
 * Background + the GO/NO-GO that rejected full schema generation: docs/research/2026-06-12-zod-to-jsonschema-spike.md.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
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

type JsonNode = Record<string, unknown>;

/**
 * Reduce a JSON-Schema property node to its wire-contract essentials, normalized so the two
 * documented, mechanical differences (description text; the OpenAI `null` union on optionals) don't
 * register as drift. Compares base type, enum membership (order-independent — the LLM-facing order
 * is frozen by the snapshot), and array item type.
 */
// `integer` is a refinement-subtype of `number`, not a different category. zod emits `integer` for
// `.int()` while several hand-written maxResults fields say `number` (a real but benign pre-existing
// looseness — see docs/research/2026-06-12-zod-to-jsonschema-spike.md). This test guards base-type CATEGORY
// drift (boolean→string, array→object), so both collapse to `number`.
const normPrim = (t: string): string => (t === 'integer' ? 'number' : t);

function wireType(node: unknown): string {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return JSON.stringify(node ?? null);
  const p = node as JsonNode;
  let type = p.type as string | string[] | undefined;
  if (typeof type === 'string') {
    type = normPrim(type);
  } else if (Array.isArray(type)) {
    const stripped = type.filter((t) => t !== 'null').map(normPrim); // drop makeOptionalPropertiesNullable's union
    type = stripped.length === 1 ? stripped[0] : stripped.sort();
  }
  const enumSet = Array.isArray(p.enum) ? [...(p.enum as unknown[])].map(String).sort() : undefined;
  const items = p.items !== undefined ? wireType(p.items) : undefined;
  const anyOf = Array.isArray(p.anyOf) ? (p.anyOf as unknown[]).map(wireType).sort() : undefined;
  return JSON.stringify({ type, enum: enumSet, items, anyOf });
}

// zod's empty/any node (e.g. a field whose Zod type is a `.transform()` — genuinely not
// representable in JSON Schema). `wireType` reduces such a node to "{}"; the comparison skips it.
const ANY_NODE = '{}';

/**
 * Derive a tool's JSON Schema from its Zod schema. `unrepresentable: 'any'` keeps generation from
 * throwing on `.transform()` fields (e.g. SAPContext.siblingMaxCandidates) — those emit `any` and
 * are skipped below, since a transform has no JSON-Schema type to compare against.
 */
function generatedProps(tool: string, btp: boolean): Record<string, unknown> {
  const schema = getToolSchema(tool, btp, true);
  if (!schema) throw new Error(`getToolSchema returned undefined for ${tool} (${btp ? 'btp' : 'onprem'})`);
  const json = z.toJSONSchema(schema, { unrepresentable: 'any' }) as JsonNode;
  return (json.properties as Record<string, unknown>) ?? {};
}

function handWrittenProps(tool: string, btp: boolean): Record<string, unknown> | null {
  // features() = all backends available, so feature-gated tools (SAPGit) are registered.
  const def = getToolDefinitions(fullConfig(btp), true, features()).find((d) => d.name === tool);
  return def ? (((def.inputSchema as JsonNode).properties as Record<string, unknown>) ?? {}) : null;
}

describe('Zod ↔ JSON-Schema per-property type parity', () => {
  for (const tool of TOOLS) {
    for (const btp of [false, true]) {
      it(`${tool} (${btp ? 'btp' : 'onprem'}) property types are reproducible from Zod`, () => {
        const hand = handWrittenProps(tool, btp);
        expect(hand, `${tool} (${btp ? 'btp' : 'onprem'}) not registered under the full config`).not.toBeNull();
        const gen = generatedProps(tool, btp);

        // Only docs/compare keys present on BOTH sides — the key SET is schema-key-sync.test.ts's job.
        // Skip keys zod can't represent (ANY_NODE, i.e. `.transform()` fields): nothing to compare.
        const shared = Object.keys(hand as object).filter((k) => k in gen && wireType(gen[k]) !== ANY_NODE);
        const mismatches = shared
          .filter((k) => wireType((hand as JsonNode)[k]) !== wireType(gen[k]))
          .map((k) => `${k}: hand=${wireType((hand as JsonNode)[k])} gen=${wireType(gen[k])}`);

        expect(mismatches, `${tool} (${btp ? 'btp' : 'onprem'}) Zod-derived types diverge from tools.ts`).toEqual([]);
      });
    }
  }
});
