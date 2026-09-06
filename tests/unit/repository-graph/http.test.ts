import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import { GraphClient } from '../../../src/repository-graph/client.js';
import { RepositoryGraphRuntime } from '../../../src/repository-graph/runtime.js';
import { createMcpHandler, createStandardVerifier } from '../../../src/server/http.js';
import { createServer } from '../../../src/server/server.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { jsonResponse, KEY, response } from './helpers.js';

describe('graph through HTTP transport authentication', () => {
  it('real SDK HTTP authenticates each stateless request, reuses graph runtime and denies invalid tokens', async () => {
    const graphFetch = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, init) => jsonResponse(response(JSON.parse(String(init?.body)).action)));
    const graph = new RepositoryGraphRuntime(
      new GraphClient(
        { url: 'https://graph.example', systemKey: 'TEST-001', audience: 'trial', readKey: () => KEY },
        graphFetch,
      ),
    );
    await graph.probe();
    const subscribe = vi.spyOn(graph, 'subscribe');
    const config = {
      ...DEFAULT_CONFIG,
      transport: 'http-streamable' as const,
      apiKeys: [{ key: 'mcp-viewer-credential', profile: 'viewer' }],
    };
    const verifier = await createStandardVerifier(config);
    const app = express();
    app.use(express.json());
    app.all(
      '/mcp',
      requireBearerAuth({ verifier: { verifyAccessToken: verifier } }),
      createMcpHandler(() =>
        createServer(config, { repositoryGraph: graph, startupAuthPreflightPromise: new Promise(() => {}) }),
      ),
    );
    const http = app.listen(0, '127.0.0.1');
    await once(http, 'listening');
    const url = new URL(`http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`);
    const client = new Client({ name: 'graph-http-test', version: '1' });
    try {
      const invalid = await fetch(url, {
        method: 'POST',
        headers: { authorization: 'Bearer wrong', 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      expect(invalid.status).toBe(401);
      await client.connect(
        new StreamableHTTPClientTransport(url, {
          requestInit: { headers: { authorization: 'Bearer mcp-viewer-credential' } },
        }),
      );
      for (let i = 0; i < 12; i++) {
        expect((await client.listTools()).tools.some((t) => t.name === 'SAPGraph')).toBe(true);
        expect(
          (await client.callTool({ name: 'SAPGraph', arguments: { action: 'search', query: 'Z' } })).isError,
        ).not.toBe(true);
      }
      // One probe, twelve queries; no per-request probe loop or retained Server subscription.
      expect(graphFetch).toHaveBeenCalledTimes(13);
      expect(subscribe).not.toHaveBeenCalled();
      expect(JSON.stringify(graphFetch.mock.calls)).not.toContain('mcp-viewer-credential');
    } finally {
      graph.stop();
      await client.close();
      http.closeAllConnections();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    }
  });
});
