import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { AdtClient } from '../adt/client.js';
import { handleToolCall } from '../handlers/dispatch.js';
import type { ToolDefinition } from '../handlers/tools.js';
import { isActionDenied } from '../server/deny-actions.js';
import type { McpRateLimiter } from '../server/mcp-rate-limit.js';
import { filterToolsByAuthScope } from '../server/tool-auth.js';
import type { ServerConfig } from '../server/types.js';
import { GRAPH_ACTIONS } from './contract.js';
import { createRepositoryGraphRuntime, type RepositoryGraphRuntime } from './runtime.js';
import { addGraphTool } from './tools.js';

/** One ARC runtime owns the connection; only persistent stdio sessions subscribe. */
export function attachRepositoryGraph(
  config: ServerConfig,
  server: Server,
  client: AdtClient,
  options: { repositoryGraph?: RepositoryGraphRuntime; mcpRateLimiter?: McpRateLimiter },
  apiKeyProfile: (token: unknown) => Promise<string | undefined>,
) {
  const graph =
    config.graphMode === 'off' || config.multiTargetEndpoints
      ? undefined
      : (options.repositoryGraph ?? createRepositoryGraphRuntime(config));
  graph?.start();
  // Stateless HTTP creates a Server per request with no persistent notification channel.
  // Never retain those Servers in runtime listeners; each tools/list sees current state.
  const unsubscribe =
    config.transport === 'stdio'
      ? graph?.subscribe(() => {
          void server.sendToolListChanged().catch(() => undefined);
        })
      : undefined;
  server.onclose = () => {
    unsubscribe?.();
    if (!options.repositoryGraph) graph?.stop();
  };
  return {
    tools(tools: ToolDefinition[]): ToolDefinition[] {
      if (!graph?.listed || GRAPH_ACTIONS.every((action) => isActionDenied('SAPGraph', action, config.denyActions)))
        return tools;
      // This also applies deny rules on stdio. HTTP scopes are narrowed in the caller afterward.
      return filterToolsByAuthScope(
        addGraphTool(tools, config.toolMode === 'hyperfocused'),
        ['admin'],
        config.denyActions,
      );
    },
    call(
      toolName: string,
      args: Record<string, unknown>,
      extra: { authInfo?: AuthInfo; signal?: AbortSignal },
      requestId: string,
    ): Promise<Record<string, unknown>> | undefined {
      if (toolName !== 'SAPGraph' && !(toolName === 'SAP' && args.action === 'graph')) return undefined;
      return (async () => {
        const token = extra.authInfo?.token;
        const profile = await apiKeyProfile(token);
        // AuthInfo is supplied only by ARC's verified transport. Shape distinguishes JWT from
        // configured (possibly dotted) API keys; this is not an independent JWT validator.
        const verifiedJwt =
          !!extra.authInfo && profile === undefined && typeof token === 'string' && token.split('.').length === 3;
        return {
          ...(await handleToolCall(
            client,
            config,
            toolName,
            args,
            extra.authInfo,
            server,
            undefined,
            false,
            options.mcpRateLimiter,
            requestId,
            undefined,
            extra.signal,
            { repositoryGraph: graph, repositoryGraphJwtVerified: verifiedJwt },
          )),
        };
      })();
    },
  };
}
