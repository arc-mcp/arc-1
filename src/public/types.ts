// Public extension API types (@experimental — may break in any release; gated by `apiVersion`).
// See docs/research/extension-framework-spec.md §2.

import type { ZodTypeAny } from 'zod';
import type { AdtClient } from '../adt/client.js';
import type { OperationTypeCode } from '../adt/safety.js';
import type { Scope } from '../authz/policy.js';
import type { ToolResult } from '../registry/tool-registry.js';
import type { SafeHttpClient } from '../server/safe-http-client.js';

export type { SafeHttpClient, Scope, ToolResult };

/**
 * `AdtClient` narrowed to its safe **plain-read** facade. Omits (review B1 + post-merge review):
 *  - `http`            — the raw, UNGATED AdtHttpClient (all HTTP must go through `ctx.http`)
 *  - `safety`/`withSafety` — the safety ref + the escalation hatch
 *  - the package-hierarchy cache mutators
 *  - `getTableContents`/`runQuery`/`runTableQuery` — the **scope-escalating** reads (they gate on
 *    `data`/`sql`, not `read`); a `read`-declared plugin must not reach them. v1 plugins have no
 *    data/SQL surface; a scoped `ctx.data`/`ctx.sql` facade is a v2 item.
 * Every retained method gates on `read` via `checkOperation`, so exposing them is safe. Enforced at
 * RUNTIME too — see `createReadOnlyAdtClient` (the type Omit alone is not a security boundary).
 */
export type ReadOnlyAdtClient = Omit<
  AdtClient,
  | 'http'
  | 'safety'
  | 'withSafety'
  | 'getPackageHierarchyResolver'
  | 'invalidatePackageHierarchy'
  | 'getTableContents'
  | 'runQuery'
  | 'runTableQuery'
>;

/**
 * Named, privileged operations a plugin can invoke (e.g. executing a console class). Each op is
 * gated server-side; calling one when its gate is closed throws `AdtSafetyError`.
 */
export interface PluginRunOps {
  /**
   * Run an ABAP **console class** (one implementing `IF_OO_ADT_CLASSRUN`) and return its console
   * output (`out->write( … )`) as plain text. Wraps `POST /sap/bc/adt/oo/classrun/{class}`.
   *
   * Gated (all must hold): the server opt-in `SAP_ALLOW_PLUGIN_EXECUTE=true`, `SAP_ALLOW_WRITES=true`
   * (executing ABAP is a mutation vector), and the calling tool must declare `write` scope. SAP-side
   * the user still needs execute authorization. The class name is validated (no path injection).
   */
  classRun(className: string): Promise<string>;
}

/** Minimal structured logger handed to plugins (stderr only — never `console.log`). */
export interface PluginLogger {
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

/** Per-call context a plugin tool receives. Built fresh per request (never bound at registration). */
export interface ToolContext {
  readonly client: ReadOnlyAdtClient; // high-level reads only — `.http`/`.safety` blocked at runtime too
  readonly http: SafeHttpClient; // the ONLY low-level HTTP path — gated. GET/HEAD always; POST/PUT/DELETE
  // to NON-ADT (OData/ICF) paths only when the admin sets SAP_ALLOW_PLUGIN_RAW_WRITES (+ allowWrites + write scope).
  readonly run: PluginRunOps; // named privileged ops (e.g. classRun) — each gated server-side
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
  /** System-type visibility, enforced in `tools/list`: a non-`all` tool is hidden when the resolved
   *  system type is known and differs (e.g. `btp` tool on an on-prem system). Default `all`. */
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
