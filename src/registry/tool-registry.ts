// Typed tool registry — the single dispatch table for built-in AND plugin (extension) tools.
//
// FEAT-61 PR1: this replaces the hand-written `switch (toolName)` in `handleToolCall`
// (src/handlers/dispatch.ts). Built-ins register at startup with thin adapter `invoke`s that
// call their existing handlers; the shared pipeline (rate-limit, scope, Zod, audit) stays in
// `handleToolCall` and is unchanged — the registry only owns the inner dispatch.
//
// See docs/research/extension-framework-spec.md §4.

import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { AdtClient } from '../adt/client.js';
import type { OperationTypeCode } from '../adt/safety.js';
import { hasRequiredScope, OPTYPE_SCOPE, type Scope } from '../authz/policy.js';
import type { CachingLayer } from '../cache/caching-layer.js';
import type { CacheSecurityContext } from '../handlers/cache-security.js';
import type { ServerConfig } from '../server/types.js';

/**
 * The MCP tool result shape. Defined locally to keep the registry free of any runtime
 * dependency on the handler module (which imports the registry). It is structurally identical
 * to `ToolResult` in src/handlers/shared.ts; both unify on the public `arc-1/public` type in PR2.
 */
export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/**
 * Per-request context handed to a tool's `invoke`. Built fresh in `handleToolCall` for each
 * call (carrying the per-user `effectiveClient` from `withSafety()`), NEVER bound at registration.
 * PR2 narrows the plugin-facing surface (ReadOnlyAdtClient + a gated SafeHttpClient); built-in
 * adapters use this internal bundle directly.
 */
export interface ToolDispatchContext {
  readonly client: AdtClient;
  readonly config: ServerConfig;
  readonly args: Record<string, unknown>;
  readonly cache?: CachingLayer;
  readonly authInfo?: AuthInfo;
  readonly isPerUserClient?: boolean;
  readonly cacheSecurity: CacheSecurityContext;
  readonly server?: Server;
  readonly requestId: string;
}

/** A registered tool — a built-in or a plugin-contributed `Custom_*` tool. */
export interface RegistryEntry {
  readonly name: string;
  readonly source: 'builtin' | 'plugin';
  /** Identifies the contributing plugin (plugin tools only) — used for audit + diagnostics. */
  readonly pluginName?: string;
  /** Authorization metadata — the SAME shape ACTION_POLICY uses; gated identically to a built-in. */
  readonly policy: { scope: Scope; opType: OperationTypeCode; featureGate?: string };
  /** Plugin tools only: system-type visibility hint, enforced in `tools/list` (default `all`). */
  readonly availableOn?: 'all' | 'onprem' | 'btp';
  /** For plugin tools: the pre-computed MCP `tools/list` shape (built-ins list via getToolDefinitions). */
  readonly listing?: { description: string; inputSchema: Record<string, unknown> };
  invoke(ctx: ToolDispatchContext): Promise<ToolResult>;
}

const CUSTOM_PREFIX = 'Custom_';

/**
 * In-memory registry of tools. One instance per server. Built-ins are registered first (at
 * startup); plugins are registered after (by the loader). Registration is fail-fast: a malformed
 * entry or a name collision throws, so a bad plugin refuses server start rather than shadowing a
 * built-in or silently dropping a tool.
 */
export class ToolRegistry {
  // Map preserves insertion order (ECMAScript guarantee), so it IS the registration order.
  private readonly entries = new Map<string, RegistryEntry>();

  register(entry: RegistryEntry): void {
    if (!entry?.name) {
      throw new Error('ToolRegistry.register: entry.name is required');
    }
    if (!entry.policy?.scope || !entry.policy.opType) {
      throw new Error(
        `ToolRegistry.register: tool '${entry.name}' must declare policy.scope + policy.opType (got ${JSON.stringify(entry.policy)})`,
      );
    }
    if (entry.source === 'plugin' && !entry.name.startsWith(CUSTOM_PREFIX)) {
      throw new Error(
        `ToolRegistry.register: plugin tool '${entry.name}' must use the reserved '${CUSTOM_PREFIX}' namespace`,
      );
    }
    // policy.opType↔scope consistency: the declared scope must COVER the op's required scope, so a
    // plugin can't claim a benign `read` scope while declaring (and later performing) a higher op.
    // Built-ins derive their policy from ACTION_POLICY (already consistent); only gate plugin entries.
    if (entry.source === 'plugin') {
      const needed = OPTYPE_SCOPE[entry.policy.opType];
      if (!needed || !hasRequiredScope([entry.policy.scope], needed)) {
        throw new Error(
          `ToolRegistry.register: plugin tool '${entry.name}' declares scope '${entry.policy.scope}' but opType '${entry.policy.opType}' requires scope '${needed ?? '?'}'`,
        );
      }
    }
    if (this.entries.has(entry.name)) {
      throw new Error(`ToolRegistry.register: duplicate tool name '${entry.name}'`);
    }
    this.entries.set(entry.name, entry);
  }

  get(name: string): RegistryEntry | undefined {
    return this.entries.get(name);
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  /** Built-ins first (registration order), then plugins (registration order). Deterministic for `tools/list`. */
  list(): RegistryEntry[] {
    const all = [...this.entries.values()];
    return [...all.filter((e) => e.source === 'builtin'), ...all.filter((e) => e.source === 'plugin')];
  }

  size(): number {
    return this.entries.size;
  }
}
