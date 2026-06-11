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
import type { ToolResult } from '../../../src/handlers/intent.js';
import * as intent from '../../../src/handlers/intent.js';

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
});
