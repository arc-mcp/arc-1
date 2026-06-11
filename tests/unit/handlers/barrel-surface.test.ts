/**
 * Locks the public export surface of src/handlers/intent.ts.
 *
 * The handler refactor (docs/plans/architecture-consolidation-plan.md, Stage A2) reduces
 * intent.ts to a re-export barrel. src/cli.ts, src/server/server.ts and ~10 test files import
 * these names from it, so the barrel must keep re-exporting exactly this set — losing one would
 * break a consumer at runtime. If you intentionally add/remove a public handler export, update
 * this list in the same change.
 *
 * The type-only export `ToolResult` is asserted separately (it has no runtime key).
 */

import { describe, expect, it } from 'vitest';
import * as cdsHints from '../../../src/handlers/cds-hints.js';
import * as dispatch from '../../../src/handlers/dispatch.js';
import * as featureCache from '../../../src/handlers/feature-cache.js';
import type { ToolResult } from '../../../src/handlers/intent.js';
import * as intent from '../../../src/handlers/intent.js';
import * as objectTypes from '../../../src/handlers/object-types.js';
import * as search from '../../../src/handlers/search.js';
import * as writeHelpers from '../../../src/handlers/write-helpers.js';

// Single source: each runtime export the barrel must re-expose → the module that actually owns it.
// Both the name-set lock and the binding-identity check derive from this map, so they can't drift
// (adding an entry here is the only way to extend the surface, and it gets identity coverage for
// free). If you intentionally add/remove a public handler export, edit this map in the same change.
const OWNER: Record<string, Record<string, unknown>> = {
  handleToolCall: dispatch,
  hasRequiredScope: dispatch,
  TOOL_SCOPES: dispatch,
  warnCdsReservedKeywords: cdsHints,
  getCachedDiscovery: featureCache,
  getCachedFeatures: featureCache,
  resetCachedFeatures: featureCache,
  setCachedDiscovery: featureCache,
  setCachedFeatures: featureCache,
  looksLikeFieldName: search,
  transliterateQuery: search,
  KNOWN_BASE_TYPES: objectTypes,
  SLASH_TYPE_EVIDENCE: objectTypes,
  SLASH_TYPE_MAP: objectTypes,
  normalizeObjectType: objectTypes,
  normalizeTypeArgsForValidation: objectTypes,
  objectBasePath: objectTypes,
  stripLlmEmptyValues: objectTypes,
  buildCreateXml: writeHelpers,
  stripFmParamCommentBlock: writeHelpers,
};

describe('handlers/intent.ts public surface', () => {
  it('re-exports exactly the locked runtime set', () => {
    expect(Object.keys(intent).sort()).toEqual(Object.keys(OWNER).sort());
  });

  it('still exports the ToolResult type', () => {
    // Compile-time guard: if ToolResult stops being exported, this file fails to type-check.
    const r: ToolResult = { content: [{ type: 'text', text: 'ok' }] };
    expect(r.content[0]).toBeDefined();
  });

  it('each re-export is bound to the real source symbol, not a same-named decoy', () => {
    // Object.keys() above only checks names — a re-export pointed at the wrong same-named symbol
    // (e.g. a stale stub left behind by a future split) would pass it. Assert binding identity
    // against the module that actually owns each symbol so a mis-pointed re-export fails loudly.
    const barrel = intent as Record<string, unknown>;
    for (const [name, owner] of Object.entries(OWNER)) {
      expect(barrel[name], `intent.${name} must be the same binding as its owning module`).toBe(owner[name]);
    }
  });
});
