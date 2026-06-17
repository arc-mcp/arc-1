// Public extension API types (@experimental — may break in any release; gated by `apiVersion`).
// See docs/research/extension-framework-spec.md §2.

import type { ZodTypeAny } from 'zod';
import type { AdtClient } from '../adt/client.js';
import type { OperationTypeCode } from '../adt/safety.js';
import type { Scope } from '../authz/policy.js';
import type { CachingLayer } from '../cache/caching-layer.js';
import type { ToolResult } from '../registry/tool-registry.js';
import type { SafeHttpClient } from '../server/safe-http-client.js';

export type { SafeHttpClient, Scope, ToolResult };

/**
 * `AdtClient` narrowed to its safe read facade. Omits (review B1):
 *  - `http`            — the raw, UNGATED AdtHttpClient (all HTTP must go through `ctx.http`)
 *  - `safety`/`withSafety` — the safety ref + the escalation hatch
 *  - the package-hierarchy cache mutators
 * Every retained method already runs `checkOperation` internally, so exposing them is safe.
 */
export type ReadOnlyAdtClient = Omit<
  AdtClient,
  'http' | 'safety' | 'withSafety' | 'getPackageHierarchyResolver' | 'invalidatePackageHierarchy'
>;

/** Minimal structured logger handed to plugins (stderr only — never `console.log`). */
export interface PluginLogger {
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

/** Per-call context a plugin tool receives. Built fresh per request (never bound at registration). */
export interface ToolContext {
  readonly client: ReadOnlyAdtClient; // high-level reads only — `.http` deliberately absent
  readonly http: SafeHttpClient; // the ONLY HTTP path — gated, any SAP path
  readonly cache?: CachingLayer;
  readonly logger: PluginLogger;
  readonly authInfo?: { userName?: string; scopes: string[]; clientId?: string };
  readonly requestId: string;
  // Optional, capability-detected (PR5) — present only when the client supports the capability:
  /** Ask the user for input mid-tool (elicitation). `requestedSchema` defaults to a confirm. */
  readonly elicit?: (message: string, requestedSchema?: Record<string, unknown>) => Promise<ElicitOutcome>;
  /** Send a client-visible progress/log line (distinct from the stderr `logger`). */
  readonly notify?: (level: 'info' | 'warning' | 'error', message: string) => Promise<void>;
  /** Ask the LLM a sub-question (sampling). Returns the text answer. */
  readonly sampling?: (systemPrompt: string, userMessage: string, maxTokens?: number) => Promise<string>;
}

/** The outcome of `ctx.elicit` — the MCP elicitation result. */
export interface ElicitOutcome {
  action: 'accept' | 'decline' | 'cancel';
  content?: Record<string, unknown>;
}

/** A plugin tool definition (code tier). Named to avoid colliding with the internal MCP ToolDefinition. */
export interface PluginToolDefinition {
  readonly name: `Custom_${string}`;
  readonly description: string;
  readonly schema: ZodTypeAny; // input validation; converted to JSON Schema for tools/list (PR3)
  readonly policy: { scope: Scope; opType: OperationTypeCode };
  readonly availableOn?: 'all' | 'onprem' | 'btp';
  handler(args: unknown, ctx: ToolContext): Promise<ToolResult>;
}

/** The default export shape of an `ARC1_PLUGINS` code plugin. */
export interface Plugin {
  readonly name: string;
  readonly version: string;
  readonly apiVersion: number;
  readonly tools: PluginToolDefinition[];
  readonly manifests?: string[];
}
