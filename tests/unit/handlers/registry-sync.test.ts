/**
 * Drift guards for the single-source object-type registry (Stage A4).
 *
 * tool-registry.ts feeds three places that must never disagree:
 *   - the JSON-Schema `enum`s in tools.ts (what the LLM is allowed to send),
 *   - the Zod `z.enum`s in schemas.ts (what the runtime accepts),
 *   - the per-tool handler routing (read.ts switch / write.ts URL routing / context.ts).
 * A type present in one but not another is a latent bug (advertised-but-rejected or
 * accepted-but-unhandled). These tests fail loudly if any drifts. (The BTP-vs-onprem split is no
 * longer a drift risk: both arrays derive from one `*_TYPE_TABLE`, so they can't disagree.)
 */

import { describe, expect, it, vi } from 'vitest';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { isServerDrivenObjectType } from '../../../src/adt/server-driven.js';
import { canonicalTablType, KNOWN_BASE_TYPES } from '../../../src/handlers/object-types.js';
import { getToolSchema } from '../../../src/handlers/schemas.js';
import {
  SAPCONTEXT_TYPES_BTP,
  SAPCONTEXT_TYPES_ONPREM,
  SAPREAD_TYPES_BTP,
  SAPREAD_TYPES_ONPREM,
  SAPWRITE_TYPES_BTP,
  SAPWRITE_TYPES_ONPREM,
} from '../../../src/handlers/tool-registry.js';
import { getToolDefinitions } from '../../../src/handlers/tools.js';
import type { ServerConfig } from '../../../src/server/types.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { btp, onprem } from './handler-test-config.js';

/** Minimal valid SAPRead input per type — shared by the Zod-accept and dispatch-coverage blocks. */
function readArgs(type: string): Record<string, unknown> {
  const base: Record<string, unknown> = { type, name: 'ZARC1_X' };
  if (type === 'VERSION_SOURCE') base.versionUri = '/sap/bc/adt/x';
  return base;
}

// Real AdtClient over a mocked fetch — used only by the SAPRead dispatch-coverage block.
const mockFetch = vi.fn();
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, fetch: mockFetch };
});
const { AdtClient } = await import('../../../src/adt/client.js');
const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');

// allowWrites registers SAPWrite (the BTP/onprem type matrix this file checks); the other gate
// flags don't affect the type enums, so they're left at their defaults.
const onpremFull: ServerConfig = onprem({ allowWrites: true });
const btpFull: ServerConfig = btp({ allowWrites: true });

function typeEnum(config: ServerConfig, toolName: string): string[] {
  const tool = getToolDefinitions(config, true).find((t) => t.name === toolName);
  if (!tool) throw new Error(`tool ${toolName} not present for config`);
  return (tool.inputSchema as any).properties.type.enum as string[];
}

// No "BTP ∪ ONPREM_ONLY == on-prem" partition block: both arrays are now derived from one
// `*_TYPE_TABLE` in tool-registry.ts (onprem = every row, btp = the `btp:true` rows), so subset
// membership holds by construction and asserting it here could never fail. The exact BTP
// membership is pinned independently by the committed tool-definition snapshot fixtures
// (tests/fixtures/tool-definitions/btp-*.json). This block only length-checks that the
// derivation yields a PROPER subset — the one regression class (filter returning all/no rows)
// the enum-equality blocks below can't see, since they compare the derived array to itself.
describe('registry sync — derived BTP arrays are a proper non-empty subset of on-prem', () => {
  function expectProperSubset(onpremTypes: readonly string[], btpTypes: readonly string[]) {
    expect(btpTypes.length).toBeGreaterThan(0);
    expect(btpTypes.length).toBeLessThan(onpremTypes.length); // every tool has on-prem-only types
  }
  it('SAPRead', () => expectProperSubset(SAPREAD_TYPES_ONPREM, SAPREAD_TYPES_BTP));
  it('SAPWrite', () => expectProperSubset(SAPWRITE_TYPES_ONPREM, SAPWRITE_TYPES_BTP));
  it('SAPContext', () => expectProperSubset(SAPCONTEXT_TYPES_ONPREM, SAPCONTEXT_TYPES_BTP));
});

describe('registry sync — every SAPWrite type is routable (no silent objectBasePath fallback)', () => {
  // write.ts routes by URL (objectBasePath / server-driven engine), not a per-type switch, so an
  // unhandled write type does NOT throw — it silently falls through objectBasePath to the generic
  // /programs/programs/ path and mis-writes. Guard structurally: every write type must resolve to a
  // real base path (canonical type in KNOWN_BASE_TYPES), be a server-driven object, or be FUNC
  // (which objectBasePath deliberately throws on because it needs the parent group — write.ts
  // handles FUNC via a dedicated pre-switch branch).
  for (const type of SAPWRITE_TYPES_ONPREM) {
    it(`${type} has a real route`, () => {
      const canonical = canonicalTablType(type);
      const routable = KNOWN_BASE_TYPES.has(canonical) || isServerDrivenObjectType(canonical) || canonical === 'FUNC';
      expect(routable, `${type} (canonical ${canonical}) has no objectBasePath case / server-driven / FUNC route`).toBe(
        true,
      );
    });
  }
});

describe('registry sync — JSON-Schema enums equal the registry', () => {
  it('SAPRead', () => {
    expect(typeEnum(onpremFull, 'SAPRead')).toEqual([...SAPREAD_TYPES_ONPREM]);
    expect(typeEnum(btpFull, 'SAPRead')).toEqual([...SAPREAD_TYPES_BTP]);
  });
  it('SAPWrite', () => {
    expect(typeEnum(onpremFull, 'SAPWrite')).toEqual([...SAPWRITE_TYPES_ONPREM]);
    expect(typeEnum(btpFull, 'SAPWrite')).toEqual([...SAPWRITE_TYPES_BTP]);
  });
  it('SAPContext', () => {
    expect(typeEnum(onpremFull, 'SAPContext')).toEqual([...SAPCONTEXT_TYPES_ONPREM]);
    expect(typeEnum(btpFull, 'SAPContext')).toEqual([...SAPCONTEXT_TYPES_BTP]);
  });
});

describe('registry sync — Zod enums accept every registry type and reject bogus', () => {
  it('SAPRead onprem + btp', () => {
    for (const t of SAPREAD_TYPES_ONPREM) {
      expect(getToolSchema('SAPRead', false)!.safeParse(readArgs(t)).success, `onprem accepts ${t}`).toBe(true);
    }
    for (const t of SAPREAD_TYPES_BTP) {
      expect(getToolSchema('SAPRead', true)!.safeParse(readArgs(t)).success, `btp accepts ${t}`).toBe(true);
    }
    expect(getToolSchema('SAPRead', false)!.safeParse({ type: 'NOPE', name: 'x' }).success).toBe(false);
  });

  it('SAPWrite onprem + btp', () => {
    const wargs = (type: string) => ({ action: 'create', type, name: 'ZARC1_X', source: 'x', package: '$TMP' });
    for (const t of SAPWRITE_TYPES_ONPREM) {
      expect(getToolSchema('SAPWrite', false)!.safeParse(wargs(t)).success, `onprem accepts ${t}`).toBe(true);
    }
    for (const t of SAPWRITE_TYPES_BTP) {
      expect(getToolSchema('SAPWrite', true)!.safeParse(wargs(t)).success, `btp accepts ${t}`).toBe(true);
    }
    expect(getToolSchema('SAPWrite', false)!.safeParse({ action: 'create', type: 'NOPE', name: 'x' }).success).toBe(
      false,
    );
  });

  it('SAPContext onprem + btp', () => {
    for (const t of SAPCONTEXT_TYPES_ONPREM) {
      expect(getToolSchema('SAPContext', false)!.safeParse({ action: 'deps', type: t, name: 'X' }).success).toBe(true);
    }
    for (const t of SAPCONTEXT_TYPES_BTP) {
      expect(getToolSchema('SAPContext', true)!.safeParse({ action: 'deps', type: t, name: 'X' }).success).toBe(true);
    }
  });
});

describe('registry sync — every SAPRead type reaches a real handler case', () => {
  // The SAPRead switch has a `default:` that returns 'Unknown SAPRead type: ...'. If a registry
  // type lacked a case it would fall there. We drive the real handler with a fetch that always
  // rejects: known types fail with a transport error (not the default), unknown types (unreachable
  // via Zod anyway) would hit the default. So: result must never be the unknown-type message.
  const config: ServerConfig = {
    ...DEFAULT_CONFIG,
    allowWrites: true,
    allowDataPreview: true,
    allowFreeSQL: true,
  };

  function client() {
    return new AdtClient({
      baseUrl: 'http://sap:8000',
      username: 'u',
      password: 'p',
      safety: unrestrictedSafetyConfig(),
    });
  }

  // The shared readArgs is already proven valid for every type by the Zod-accept block above,
  // so no per-iteration self-check is needed here.
  for (const type of SAPREAD_TYPES_ONPREM) {
    it(`SAPRead ${type} dispatches (not the unknown-type default)`, async () => {
      vi.resetAllMocks();
      resetCachedFeatures();
      mockFetch.mockRejectedValue(new Error('SENTINEL_FETCH_FAIL'));

      const result = await handleToolCall(client(), config, 'SAPRead', readArgs(type));
      const text = result.content.map((c) => c.text).join('');
      expect(text, `${type} fell through to the SAPRead default case`).not.toContain('Unknown SAPRead type:');
    });
  }
});
