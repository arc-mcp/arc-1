/**
 * Back-compat barrel for the handlers package.
 *
 * The intent dispatcher moved to dispatch.ts and each tool handler to its own module (Stage B).
 * This file re-exports the public surface that src/cli.ts, src/server/server.ts and the test
 * suite still import from "./intent.js". Locked by tests/unit/handlers/barrel-surface.test.ts.
 * @deprecated import from the specific handlers/* module instead.
 */

// warnCdsReservedKeywords moved to cds-hints.ts (Stage B); re-exported for back-compat.
export { warnCdsReservedKeywords } from './cds-hints.js';
// Dispatcher + scope helpers moved to dispatch.ts (Stage B); re-exported (barrel-locked).
export { handleToolCall, hasRequiredScope, TOOL_SCOPES } from './dispatch.js';
// Re-export the feature-cache accessors (moved to feature-cache.ts, Stage B; barrel-locked).
export {
  getCachedDiscovery,
  getCachedFeatures,
  resetCachedFeatures,
  setCachedDiscovery,
  setCachedFeatures,
} from './feature-cache.js';
// Re-export the public object-type surface for back-compat (locked by barrel-surface.test.ts).
// These moved to object-types.ts (Stage B) but consumers still import them from here.
export {
  KNOWN_BASE_TYPES,
  normalizeObjectType,
  normalizeTypeArgsForValidation,
  objectBasePath,
  SLASH_TYPE_EVIDENCE,
  SLASH_TYPE_MAP,
  stripLlmEmptyValues,
} from './object-types.js';
// transliterateQuery + looksLikeFieldName moved to search.ts (Stage B); re-exported (barrel-locked).
export { looksLikeFieldName, transliterateQuery } from './search.js';
// ToolResult moved to shared.ts (Stage B); re-exported for back-compat (barrel-surface.test.ts).
export type { ToolResult } from './shared.js';
// buildCreateXml + stripFmParamCommentBlock moved to write-helpers.ts (Stage B); re-exported.
export { buildCreateXml, stripFmParamCommentBlock } from './write-helpers.js';
