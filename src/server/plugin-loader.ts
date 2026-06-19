// Plugin loader — loads local trusted extensions listed in ARC1_PLUGINS and registers their
// Custom_* tools into the ToolRegistry. FEAT-61 PR3. See docs/research/extension-framework-spec.md §7.
//
// A plugin is a LOCAL file (no npm). Each `ARC1_PLUGINS` entry is an absolute path to a `.js`
// module whose default export is a `Plugin`. Loading is fail-fast: a malformed plugin, an
// apiVersion mismatch, or a name collision refuses server start rather than silently dropping a
// tool or shadowing a built-in.

import { readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { registerManifestTool } from '../plugins/manifest-interpreter.js';
import type { Plugin, PluginToolDefinition, ToolContext } from '../public/types.js';
import type { RegistryEntry, ToolDispatchContext, ToolRegistry, ToolResult } from '../registry/tool-registry.js';
import { logger } from './logger.js';
import { createPluginRunOps, createReadOnlyAdtClient, createSafeHttpClient } from './safe-http-client.js';

/** The apiVersion this ARC-1 understands. Bump on every breaking change to the plugin API. */
export const SUPPORTED_API_VERSION = 1;

export interface LoadedPlugin {
  name: string;
  version: string;
  path: string;
  toolNames: string[];
}

/** Refuse anything not an absolute, readable, owner-only, non-world-writable file. */
function assertLoadablePath(p: string): void {
  if (!isAbsolute(p)) {
    throw new Error(`ARC1_PLUGINS entry must be an absolute path: '${p}'`);
  }
  const st = statSync(p); // throws (ENOENT/EACCES) if missing or unreadable
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) {
    throw new Error(`Plugin '${p}' is not owned by the server user — refusing to load`);
  }
  if ((st.mode & 0o002) !== 0) {
    throw new Error(`Plugin '${p}' is world-writable — refusing to load`);
  }
}

function pluginLogger(toolName: string): ToolContext['logger'] {
  const tag = `[plugin ${toolName}]`;
  return {
    info: (m, d) => logger.info(`${tag} ${m}`, d as Record<string, unknown> | undefined),
    warn: (m, d) => logger.warn(`${tag} ${m}`, d as Record<string, unknown> | undefined),
    error: (m, d) => logger.error(`${tag} ${m}`, d as Record<string, unknown> | undefined),
  };
}

/** Build the optional MCP capabilities (elicit/notify/sampling) from the request's Server, gated by
 *  the client's declared capabilities. Returns empty when there is no server (stdio CLI / tests). */
function buildMcpCapabilities(
  server: ToolDispatchContext['server'],
): Pick<ToolContext, 'elicit' | 'notify' | 'sampling'> {
  if (!server) return {};
  const caps = server.getClientCapabilities?.();
  return {
    elicit: caps?.elicitation
      ? async (message, requestedSchema) => {
          const res = await server.elicitInput({
            message,
            requestedSchema: (requestedSchema ?? { type: 'object', properties: {} }) as never,
          });
          return res as { action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> };
        }
      : undefined,
    notify: async (level, message) => {
      await server.sendLoggingMessage({ level, data: message });
    },
    sampling: caps?.sampling
      ? async (systemPrompt, userMessage, maxTokens) => {
          const res = await server.createMessage({
            messages: [{ role: 'user', content: { type: 'text', text: userMessage } }],
            systemPrompt,
            maxTokens: maxTokens ?? 1000,
          });
          return res.content.type === 'text' ? res.content.text : '';
        }
      : undefined,
  };
}

/** Build a plugin tool's `invoke`: validate args against its Zod schema, build the gated public
 *  ToolContext per call, then run the handler. Errors are contained (handleToolCall's try/catch). */
function makePluginInvoke(def: PluginToolDefinition): (ctx: ToolDispatchContext) => Promise<ToolResult> {
  return async (dispatchCtx: ToolDispatchContext): Promise<ToolResult> => {
    const parsed = def.schema.safeParse(dispatchCtx.args);
    if (!parsed.success) {
      return {
        content: [{ type: 'text', text: `Invalid arguments for ${def.name}: ${parsed.error.message}` }],
        isError: true,
      };
    }
    const publicCtx: ToolContext = {
      // `client` is a runtime read-only Proxy (escape hatches `.http`/`.safety`/`withSafety` blocked,
      // not just type-hidden); `http` is the gated read-only surface — the only sanctioned low-level
      // HTTP path. Both close review B1. See safe-http-client.ts.
      client: createReadOnlyAdtClient(dispatchCtx.client),
      http: createSafeHttpClient(
        dispatchCtx.client.http,
        dispatchCtx.client.safety,
        def.name,
        def.policy.scope,
        dispatchCtx.config.allowPluginRawWrites,
      ),
      run: createPluginRunOps(
        dispatchCtx.client.http,
        dispatchCtx.client.safety,
        dispatchCtx.config.allowPluginExecute,
        def.policy.scope,
        def.name,
      ),
      logger: pluginLogger(def.name),
      authInfo: dispatchCtx.authInfo
        ? {
            userName: dispatchCtx.authInfo.extra?.userName as string | undefined,
            scopes: dispatchCtx.authInfo.scopes,
            clientId: dispatchCtx.authInfo.clientId,
          }
        : undefined,
      requestId: dispatchCtx.requestId,
      ...buildMcpCapabilities(dispatchCtx.server),
    };
    return def.handler(parsed.data, publicCtx);
  };
}

/** Register one plugin tool into the registry (fail-fast on collision / namespace / missing policy). */
export function registerPluginTool(registry: ToolRegistry, pluginName: string, def: PluginToolDefinition): void {
  const inputSchema = z.toJSONSchema(def.schema) as Record<string, unknown>;
  const entry: RegistryEntry = {
    name: def.name,
    source: 'plugin',
    pluginName,
    policy: def.policy,
    availableOn: def.availableOn,
    listing: { description: def.description, inputSchema },
    invoke: makePluginInvoke(def),
  };
  registry.register(entry);
}

function validatePlugin(plugin: Plugin | undefined, path: string): asserts plugin is Plugin {
  if (!plugin || typeof plugin.name !== 'string' || !Array.isArray(plugin.tools)) {
    throw new Error(
      `Plugin at '${path}' has no valid default export (expected { name, version, apiVersion, tools[] })`,
    );
  }
  if (plugin.apiVersion !== SUPPORTED_API_VERSION) {
    throw new Error(
      `Plugin '${plugin.name}' targets apiVersion ${plugin.apiVersion}; this ARC-1 supports ${SUPPORTED_API_VERSION}`,
    );
  }
}

/** Read + register a declarative `*.tool.json` manifest. Returns the tool name. */
function loadManifestFile(registry: ToolRegistry, pluginName: string, manifestPath: string): string {
  assertLoadablePath(manifestPath);
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: string };
  registerManifestTool(registry, pluginName, parsed);
  return String(parsed.name);
}

/**
 * Load every `ARC1_PLUGINS` path and register its tools. Throws (fail-fast) on any problem.
 * A `.json` path is a standalone manifest tool; a `.js` path is a code plugin (which may also
 * reference `*.tool.json` manifests via its `manifests[]`, resolved relative to the plugin).
 */
export async function loadPlugins(paths: string[], registry: ToolRegistry): Promise<LoadedPlugin[]> {
  const loaded: LoadedPlugin[] = [];
  for (const p of paths) {
    if (p.endsWith('.json')) {
      const toolName = loadManifestFile(registry, p, p);
      loaded.push({ name: p, version: '—', path: p, toolNames: [toolName] });
      logger.info(`Loaded manifest tool '${toolName}'`, { path: p });
      continue;
    }
    assertLoadablePath(p);
    const mod = (await import(pathToFileURL(p).href)) as { default?: Plugin };
    const plugin = mod.default;
    validatePlugin(plugin, p);
    for (const def of plugin.tools) {
      registerPluginTool(registry, plugin.name, def);
    }
    const manifestNames: string[] = [];
    for (const m of plugin.manifests ?? []) {
      const abs = isAbsolute(m) ? m : resolve(dirname(p), m);
      manifestNames.push(loadManifestFile(registry, plugin.name, abs));
    }
    const toolNames = [...plugin.tools.map((t) => t.name), ...manifestNames];
    loaded.push({ name: plugin.name, version: plugin.version, path: p, toolNames });
    logger.info(`Loaded extension '${plugin.name}' v${plugin.version} (${toolNames.length} tool(s))`, { path: p });
  }
  return loaded;
}
