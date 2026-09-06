import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';
import { GraphClient } from '../../../src/repository-graph/client.js';
import { RepositoryGraphRuntime } from '../../../src/repository-graph/runtime.js';
import { logger } from '../../../src/server/logger.js';
import { createMcpRateLimiter, type McpRateLimiter } from '../../../src/server/mcp-rate-limit.js';
import { createServer } from '../../../src/server/server.js';
import { DEFAULT_CONFIG, type ServerConfig } from '../../../src/server/types.js';
import { jsonResponse, KEY, response } from './helpers.js';

function setup(systemKey = 'TEST-001') {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
    const args = JSON.parse(String(init?.body));
    return jsonResponse({ ...response(args.action), systemKey });
  });
  const graph = new RepositoryGraphRuntime(
    new GraphClient({ url: 'https://graph.example', systemKey, audience: 'trial', readKey: () => KEY }, fetcher),
  );
  return { graph, fetcher };
}
type Handler = (
  request: unknown,
  extra: { authInfo?: AuthInfo; signal?: AbortSignal },
) => Promise<{ content?: Array<{ text: string }>; tools?: Array<{ name: string }>; isError?: boolean }>;
function handler(server: Server, method: string): Handler {
  const callback = (server as unknown as { _requestHandlers: Map<string, Handler> })._requestHandlers.get(method)!;
  return (request, extra) => callback({ method, ...(request as Record<string, unknown>) }, extra);
}
const auth = (scopes: string[], token = 'verified.jwt.token'): AuthInfo => ({ token, scopes, clientId: 'client' });
const args = { action: 'search', query: 'Z' };

describe('native graph MCP', () => {
  it.each(['standard', 'hyperfocused'] as const)(
    'real SDK %s: late ready notification, list and call despite blocked SAP preflight',
    async (toolMode) => {
      const { graph, fetcher } = setup();
      fetcher.mockRejectedValueOnce(new Error('down'));
      const server = createServer(
        { ...DEFAULT_CONFIG, toolMode },
        {
          repositoryGraph: graph,
          startupAuthPreflightPromise: Promise.resolve({
            status: 'failed',
            blocking: true,
            endpoint: '/sap',
            checkedAt: new Date().toISOString(),
            statusCode: 401,
            reason: 'SAP deliberately unavailable in graph test',
          }),
        },
      );
      const client = new Client({ name: 'graph-regression', version: '1' });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      let changed = 0;
      client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
        changed++;
      });
      try {
        await graph.probe();
        await server.connect(st);
        await client.connect(ct);
        expect(JSON.stringify((await client.listTools()).tools)).not.toContain('SAPGraph');
        await graph.probe();
        await vi.waitFor(() => expect(changed).toBeGreaterThan(0));
        const listed = await client.listTools();
        expect(JSON.stringify(listed.tools)).toContain(toolMode === 'standard' ? 'SAPGraph' : '"graph"');
        const result = await client.callTool({
          name: toolMode === 'standard' ? 'SAPGraph' : 'SAP',
          arguments: toolMode === 'standard' ? args : { action: 'graph', params: args },
        });
        expect(result.isError).not.toBe(true);
        expect(JSON.stringify(result)).toContain('TEST-001');
        const sap = await client.callTool({ name: 'SAPRead', arguments: { type: 'CLAS', name: 'ZCL_TEST' } });
        expect(sap.isError).toBe(true);
        expect(fetcher.mock.calls.every(([_url, init]) => String(init?.body).includes('trial'))).toBe(true);
      } finally {
        graph.stop();
        await client.close();
        await server.close();
      }
    },
  );
  it.each([
    { denyActions: ['SAPGraph'], scopes: ['read'] },
    { denyActions: ['SAPGraph.search'], scopes: ['read'] },
    { denyActions: [], scopes: [] },
  ])('common scope and deny gates prevent backend requests: %j', async ({ denyActions, scopes }) => {
    const { graph, fetcher } = setup();
    await graph.probe();
    const audit = vi.spyOn(logger, 'emitAudit');
    const server = createServer({ ...DEFAULT_CONFIG, denyActions }, { repositoryGraph: graph });
    try {
      fetcher.mockClear();
      const result = await handler(server, 'tools/call')(
        { params: { name: 'SAPGraph', arguments: args } },
        { authInfo: auth(scopes) },
      );
      expect(result.isError).toBe(true);
      expect(fetcher).not.toHaveBeenCalled();
      expect(audit.mock.calls.some(([event]) => event.event === 'tool_call_start' && event.tool === 'SAPGraph')).toBe(
        true,
      );
    } finally {
      audit.mockRestore();
      graph.stop();
      await server.close();
    }
  });
  it('enforces wrapper and nested deny policy with one rate-limit charge', async () => {
    const { graph, fetcher } = setup();
    await graph.probe();
    const limiter = { consume: vi.fn().mockResolvedValue({ allowed: true }) } as unknown as McpRateLimiter;
    for (const denyActions of [['SAP.graph'], ['SAPGraph.search'], []]) {
      const server = createServer(
        { ...DEFAULT_CONFIG, toolMode: 'hyperfocused', denyActions },
        { repositoryGraph: graph, mcpRateLimiter: limiter },
      );
      fetcher.mockClear();
      vi.mocked(limiter.consume).mockClear();
      const result = await handler(server, 'tools/call')(
        { params: { name: 'SAP', arguments: { action: 'graph', params: args } } },
        { authInfo: auth(['read']) },
      );
      expect(result.isError === true).toBe(denyActions.length > 0);
      expect(limiter.consume).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls.length).toBe(denyActions.length ? 0 : 1);
      await server.close();
    }
    graph.stop();
  });
  it('strict JWT rejects dotted API keys but permits authenticated JWT graph reads without PP', async () => {
    const { graph, fetcher } = setup();
    await graph.probe();
    const config: ServerConfig = {
      ...DEFAULT_CONFIG,
      ppEnabled: true,
      ppStrict: true,
      ppStrictExplicit: true,
      apiKeys: [{ key: 'dotted.api.key', profile: 'viewer' }],
    };
    const server = createServer(config, { repositoryGraph: graph });
    try {
      fetcher.mockClear();
      const call = handler(server, 'tools/call');
      const denied = await call(
        { params: { name: 'SAPGraph', arguments: args } },
        { authInfo: auth(['read'], 'dotted.api.key') },
      );
      expect(denied.isError).toBe(true);
      expect(fetcher).not.toHaveBeenCalled();
      const allowed = await call({ params: { name: 'SAPGraph', arguments: args } }, { authInfo: auth(['read']) });
      expect(allowed.isError).not.toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(fetcher.mock.calls[0]?.[1]?.headers)).not.toContain('verified.jwt.token');
    } finally {
      graph.stop();
      await server.close();
    }
  });
  it('real rate limiter stops a second request before the graph backend', async () => {
    const { graph, fetcher } = setup();
    await graph.probe();
    const server = createServer(DEFAULT_CONFIG, { repositoryGraph: graph, mcpRateLimiter: createMcpRateLimiter(1) });
    try {
      fetcher.mockClear();
      const call = () =>
        handler(server, 'tools/call')({ params: { name: 'SAPGraph', arguments: args } }, { authInfo: auth(['read']) });
      expect((await call()).isError).not.toBe(true);
      const rejected = await call();
      expect(rejected.isError).toBe(true);
      expect(JSON.stringify(rejected)).toMatch(/rate.limit/i);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      graph.stop();
      await server.close();
    }
  });
  it.each(['standard', 'hyperfocused'] as const)(
    'does not advertise a wholly denied graph in %s mode',
    async (toolMode) => {
      const { graph } = setup();
      await graph.probe();
      const server = createServer(
        { ...DEFAULT_CONFIG, toolMode, denyActions: ['SAPGraph.*'] },
        { repositoryGraph: graph },
      );
      try {
        const tools = await handler(server, 'tools/list')({}, {});
        expect(JSON.stringify(tools)).not.toContain('SAPGraph');
        expect(JSON.stringify(tools)).not.toContain('"graph"');
      } finally {
        graph.stop();
        await server.close();
      }
    },
  );
  it('isolates two configured runtimes and a disabled server', async () => {
    const a = setup('A-001');
    const b = setup('B-001');
    await Promise.all([a.graph.probe(), b.graph.probe()]);
    const servers = [
      createServer(DEFAULT_CONFIG, { repositoryGraph: a.graph }),
      createServer(DEFAULT_CONFIG, { repositoryGraph: b.graph }),
      createServer(DEFAULT_CONFIG),
    ];
    try {
      const results = await Promise.all(
        servers.map((server) => handler(server, 'tools/call')({ params: { name: 'SAPGraph', arguments: args } }, {})),
      );
      expect(JSON.stringify(results[0])).toContain('A-001');
      expect(JSON.stringify(results[1])).toContain('B-001');
      expect(results[2]?.isError).toBe(true);
      expect(JSON.stringify(await handler(servers[2]!, 'tools/list')({}, {}))).not.toContain('SAPGraph');
    } finally {
      a.graph.stop();
      b.graph.stop();
      await Promise.all(servers.map((s) => s.close()));
    }
  });
});
