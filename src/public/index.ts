// `arc-1/public` — the @experimental extension API surface.
//
// Stability: this API may break in ANY release. A plugin declares `apiVersion` (a single integer
// fuse); the loader rejects a mismatch. No semver guarantee until the feature graduates.
// See docs/research/2026-06-17-extension-framework-spec.md §2.

export { AdtApiError, AdtNetworkError, AdtSafetyError } from '../adt/errors.js';
export type { AdtResponse } from '../adt/http.js';

// Re-exported building blocks (stable shapes plugins reference):
export { OperationType, type OperationTypeCode } from '../adt/safety.js';
export type { Scope } from '../authz/policy.js';
export type { ToolResult } from '../registry/tool-registry.js';
export type { SafeHttpClient } from '../server/safe-http-client.js';
export { defineTool } from './define-tool.js';
export type {
  ElicitOutcome,
  Plugin,
  PluginLogger,
  PluginToolDefinition,
  ReadOnlyAdtClient,
  ToolContext,
} from './types.js';
