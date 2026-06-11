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

const EXPECTED_RUNTIME_EXPORTS = [
  'KNOWN_BASE_TYPES',
  'SLASH_TYPE_EVIDENCE',
  'SLASH_TYPE_MAP',
  'TOOL_SCOPES',
  'buildCreateXml',
  'getCachedDiscovery',
  'getCachedFeatures',
  'handleToolCall',
  'hasRequiredScope',
  'looksLikeFieldName',
  'normalizeObjectType',
  'normalizeTypeArgsForValidation',
  'objectBasePath',
  'resetCachedFeatures',
  'setCachedDiscovery',
  'setCachedFeatures',
  'stripFmParamCommentBlock',
  'stripLlmEmptyValues',
  'transliterateQuery',
  'warnCdsReservedKeywords',
].sort();

describe('handlers/intent.ts public surface', () => {
  it('re-exports exactly the locked runtime set', () => {
    expect(Object.keys(intent).sort()).toEqual(EXPECTED_RUNTIME_EXPORTS);
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
    expect(intent.handleToolCall).toBe(dispatch.handleToolCall);
    expect(intent.hasRequiredScope).toBe(dispatch.hasRequiredScope);
    expect(intent.TOOL_SCOPES).toBe(dispatch.TOOL_SCOPES);
    expect(intent.warnCdsReservedKeywords).toBe(cdsHints.warnCdsReservedKeywords);
    expect(intent.getCachedDiscovery).toBe(featureCache.getCachedDiscovery);
    expect(intent.getCachedFeatures).toBe(featureCache.getCachedFeatures);
    expect(intent.resetCachedFeatures).toBe(featureCache.resetCachedFeatures);
    expect(intent.setCachedDiscovery).toBe(featureCache.setCachedDiscovery);
    expect(intent.setCachedFeatures).toBe(featureCache.setCachedFeatures);
    expect(intent.looksLikeFieldName).toBe(search.looksLikeFieldName);
    expect(intent.transliterateQuery).toBe(search.transliterateQuery);
    expect(intent.KNOWN_BASE_TYPES).toBe(objectTypes.KNOWN_BASE_TYPES);
    expect(intent.SLASH_TYPE_EVIDENCE).toBe(objectTypes.SLASH_TYPE_EVIDENCE);
    expect(intent.SLASH_TYPE_MAP).toBe(objectTypes.SLASH_TYPE_MAP);
    expect(intent.normalizeObjectType).toBe(objectTypes.normalizeObjectType);
    expect(intent.normalizeTypeArgsForValidation).toBe(objectTypes.normalizeTypeArgsForValidation);
    expect(intent.objectBasePath).toBe(objectTypes.objectBasePath);
    expect(intent.stripLlmEmptyValues).toBe(objectTypes.stripLlmEmptyValues);
    expect(intent.buildCreateXml).toBe(writeHelpers.buildCreateXml);
    expect(intent.stripFmParamCommentBlock).toBe(writeHelpers.stripFmParamCommentBlock);
  });
});
