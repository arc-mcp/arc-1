import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BTPConfig } from '@arc-mcp/xsuaa-auth/btp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ToolListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AdtApiError } from '../../../src/adt/errors.js';
import * as adtFeatures from '../../../src/adt/features.js';
import { AdtHttpClient } from '../../../src/adt/http.js';
import type { ResolvedFeatures } from '../../../src/adt/types.js';
import { MemoryCache } from '../../../src/cache/memory.js';
import { getToolRegistry } from '../../../src/handlers/dispatch.js';
import { resetCachedFeatures, setCachedFeatures } from '../../../src/handlers/feature-cache.js';
import { getToolDefinitions } from '../../../src/handlers/tools.js';
import { defineTool } from '../../../src/public/index.js';
import { opaqueDestinationValue } from '../../../src/server/destination-discovery.js';
import { targetConnectionFingerprint } from '../../../src/server/destination-registry.js';
import { logger } from '../../../src/server/logger.js';
import { registerPluginTool } from '../../../src/server/plugin-loader.js';
import {
  buildAdtConfig,
  canUseSharedSingleTargetCredentials,
  createCachingLayer,
  createServer,
  filterToolsByAuthScope,
  formatStartupAuthPreflightToolError,
  getConfiguredToolDefinitions,
  logAuthSummary,
  probeClientFeatures,
  resolveNullableOptionals,
  resolvePpDestinationName,
  resolveSingleTargetOverlapState,
  runStartupAuthPreflight,
  runStartupAuthPreflightWithClient,
  VERSION,
} from '../../../src/server/server.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

type RequestHandler = (
  request: Record<string, unknown>,
  extra: { authInfo?: AuthInfo },
) => Promise<Record<string, any>>;

function requestHandler(server: Server, method: string): RequestHandler {
  const handlers = (server as unknown as { _requestHandlers: Map<string, RequestHandler> })._requestHandlers;
  const handler = handlers.get(method);
  if (!handler) throw new Error(`No request handler registered for ${method}`);
  return handler;
}

describe('MCP Server', () => {
  it.each([
    ['default', DEFAULT_CONFIG, 'arc-1'],
    ['custom', { ...DEFAULT_CONFIG, serverName: 'arc1-erp-dev' }, 'arc1-erp-dev'],
  ])('advertises the %s server name and version in the initialize handshake', async (_label, config, expectedName) => {
    const server = createServer(config);
    const client = new Client({ name: 'arc1-server-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      expect(client.getServerVersion()).toEqual({ name: expectedName, version: VERSION });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('has a valid version string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  // tools/list must never wait on SAP. Clients cancel it on their own schedule (Cline at ~5s) and
  // a probe against a real system can outlast that, which left the client with zero tools.
  it('answers tools/list without waiting for the startup probe', async () => {
    const neverResolves = new Promise<void>(() => {});
    const server = createServer(DEFAULT_CONFIG, { startupProbePromise: neverResolves });
    const handler = requestHandler(server, ListToolsRequestSchema.shape.method.value);

    const result = await Promise.race([
      handler({ method: 'tools/list', params: {} }, {}),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('tools/list blocked')), 250)),
    ]);

    // Unprobed answer is the superset — SAPGit included, not dropped while discovery is pending.
    // tests/unit/handlers/tool-surface-superset.test.ts holds the general invariant.
    expect((result.tools as { name: string }[]).map((t) => t.name)).toContain('SAPGit');
  });

  it('advertises listChanged and notifies the client once the startup probe resolves', async () => {
    let resolveProbe: () => void = () => {};
    const startupProbePromise = new Promise<void>((resolve) => {
      resolveProbe = resolve;
    });
    const server = createServer(DEFAULT_CONFIG, { startupProbePromise });
    const client = new Client({ name: 'arc1-listchanged-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    let notified = 0;

    try {
      client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
        notified += 1;
      });
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      expect(client.getServerCapabilities()?.tools).toEqual({ listChanged: true });
      expect(notified).toBe(0);

      resolveProbe();
      await vi.waitFor(() => expect(notified).toBe(1));
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('does not wire the notification on HTTP, where each request builds its own server', async () => {
    let resolveProbe: () => void = () => {};
    const startupProbePromise = new Promise<void>((resolve) => {
      resolveProbe = resolve;
    });
    const server = createServer({ ...DEFAULT_CONFIG, transport: 'http-streamable' }, { startupProbePromise });
    const sendSpy = vi.spyOn(server, 'sendToolListChanged');

    resolveProbe();
    await startupProbePromise;
    await new Promise((resolve) => setImmediate(resolve));

    expect(sendSpy).not.toHaveBeenCalled();
    sendSpy.mockRestore();
  });

  it('survives a probe that resolves before any client connected', async () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => undefined);

    // Never connected: the SDK's sendToolListChanged() rejects, and that must stay non-fatal.
    createServer(DEFAULT_CONFIG, { startupProbePromise: Promise.resolve() });

    await vi.waitFor(() =>
      expect(debugSpy).toHaveBeenCalledWith(
        'Skipped tools/list_changed notification after startup probe',
        expect.objectContaining({ error: expect.any(String) }),
      ),
    );
    expect(errorSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    debugSpy.mockRestore();
  });

  it('resolves schema nullable optionals off by default in auto mode', () => {
    const debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => undefined);

    expect(resolveNullableOptionals(DEFAULT_CONFIG, { name: 'GitHub Copilot', version: '1.0.0' })).toBe(false);
    expect(debugSpy).toHaveBeenCalledWith('schema nullable optionals auto mode resolved to off', {
      clientName: 'GitHub Copilot',
      clientVersion: '1.0.0',
    });

    debugSpy.mockRestore();
  });

  it('resolves schema nullable optionals explicit on/off overrides', () => {
    expect(resolveNullableOptionals({ ...DEFAULT_CONFIG, schemaNullableOptionals: 'on' })).toBe(true);
    expect(resolveNullableOptionals({ ...DEFAULT_CONFIG, schemaNullableOptionals: 'off' })).toBe(false);
  });

  it('configured tool definitions honor explicit nullable-optionals mode', () => {
    const tools = getConfiguredToolDefinitions({
      ...DEFAULT_CONFIG,
      allowWrites: true,
      schemaNullableOptionals: 'on',
    });
    const sapWrite = tools.find((tool) => tool.name === 'SAPWrite')!;
    const schema = sapWrite.inputSchema as Record<string, any>;

    expect(schema.properties.dataType.type).toEqual(['string', 'null']);
  });

  it('filters SAPManage actions to read-only set for read-scoped users', () => {
    const tools = getToolDefinitions({
      ...DEFAULT_CONFIG,
      allowWrites: true,
      allowFreeSQL: true,
      allowTransportWrites: true,
    });
    const filtered = filterToolsByAuthScope(tools, ['read']);
    const sapManage = filtered.find((tool) => tool.name === 'SAPManage');
    expect(sapManage).toBeDefined();
    const schema = sapManage!.inputSchema as Record<string, any>;
    const actionEnum: string[] = schema.properties.action.enum;
    // v0.7: flp_list_* are read-scoped (classification bug fix)
    expect(actionEnum).toContain('features');
    expect(actionEnum).toContain('probe');
    expect(actionEnum).toContain('cache_stats');
    expect(actionEnum).toContain('flp_list_catalogs');
    expect(actionEnum).toContain('flp_list_groups');
    expect(actionEnum).toContain('flp_list_tiles');
    // Write actions pruned
    expect(actionEnum).not.toContain('create_package');
    expect(actionEnum).not.toContain('flp_create_catalog');
    expect(filtered.map((tool) => tool.name)).not.toContain('SAPWrite');
  });

  it('keeps SAPManage write actions for write-scoped users', () => {
    const tools = getToolDefinitions({
      ...DEFAULT_CONFIG,
      allowWrites: true,
      allowFreeSQL: true,
      allowTransportWrites: true,
    });
    const filtered = filterToolsByAuthScope(tools, ['read', 'write']);
    const sapManage = filtered.find((tool) => tool.name === 'SAPManage');
    expect(sapManage).toBeDefined();
    const schema = sapManage!.inputSchema as Record<string, any>;
    const actionEnum: string[] = schema.properties.action.enum;
    expect(actionEnum).toContain('create_package');
    expect(actionEnum).toContain('flp_delete_catalog');
    expect(filtered.map((tool) => tool.name)).toContain('SAPWrite');
  });

  it('prunes SAPDiagnose apply_quickfix for read-scoped users', () => {
    const tools = getToolDefinitions({ ...DEFAULT_CONFIG, allowWrites: true });
    const filtered = filterToolsByAuthScope(tools, ['read']);
    const sapDiagnose = filtered.find((tool) => tool.name === 'SAPDiagnose');
    expect(sapDiagnose).toBeDefined();
    const schema = sapDiagnose!.inputSchema as Record<string, any>;
    const actionEnum: string[] = schema.properties.action.enum;
    expect(actionEnum).toContain('quickfix');
    expect(actionEnum).not.toContain('apply_quickfix');
  });

  it('keeps SAPDiagnose apply_quickfix for write-scoped users', () => {
    const tools = getToolDefinitions({ ...DEFAULT_CONFIG, allowWrites: true });
    const filtered = filterToolsByAuthScope(tools, ['read', 'write']);
    const sapDiagnose = filtered.find((tool) => tool.name === 'SAPDiagnose');
    expect(sapDiagnose).toBeDefined();
    const schema = sapDiagnose!.inputSchema as Record<string, any>;
    const actionEnum: string[] = schema.properties.action.enum;
    expect(actionEnum).toContain('quickfix');
    expect(actionEnum).toContain('apply_quickfix');
  });

  it('prunes hyperfocused SAP actions for read-scoped users', () => {
    const tools = getToolDefinitions({
      ...DEFAULT_CONFIG,
      toolMode: 'hyperfocused',
      allowWrites: true,
      allowFreeSQL: true,
      allowTransportWrites: true,
    });
    const filtered = filterToolsByAuthScope(tools, ['read']);
    const sap = filtered.find((tool) => tool.name === 'SAP');
    expect(sap).toBeDefined();
    const schema = sap!.inputSchema as Record<string, any>;
    const actionEnum: string[] = schema.properties.action.enum;

    expect(actionEnum).toContain('read');
    // Mixed delegators stay visible because their read sub-actions are usable.
    // Concrete mutating sub-actions are scope-checked after delegation.
    expect(actionEnum).toContain('manage');
    expect(actionEnum).toContain('transport');
    expect(actionEnum).toContain('git');
    expect(actionEnum).not.toContain('query');
    expect(actionEnum).not.toContain('write');
    expect(actionEnum).not.toContain('activate');
  });

  it('keeps only query for sql-scoped users in hyperfocused mode', () => {
    const tools = getToolDefinitions({
      ...DEFAULT_CONFIG,
      toolMode: 'hyperfocused',
      allowWrites: true,
      allowFreeSQL: true,
      allowTransportWrites: true,
    });
    const filtered = filterToolsByAuthScope(tools, ['sql']);
    const sap = filtered.find((tool) => tool.name === 'SAP');
    expect(sap).toBeDefined();
    const schema = sap!.inputSchema as Record<string, any>;
    const actionEnum: string[] = schema.properties.action.enum;
    expect(actionEnum).toEqual(['query']);
  });

  it('passes explicit nullable-optionals mode through tools/list', async () => {
    const server = createServer({ ...DEFAULT_CONFIG, allowWrites: true, schemaNullableOptionals: 'on' });
    const handler = requestHandler(server, ListToolsRequestSchema.shape.method.value);
    const result = await handler({ method: 'tools/list', params: {} }, {});
    const sapWrite = (result.tools as Array<{ name: string; inputSchema: Record<string, any> }>).find(
      (tool) => tool.name === 'SAPWrite',
    );

    expect(sapWrite?.inputSchema.properties.dataType.type).toEqual(['string', 'null']);
  });

  it('logs nullable-optionals auto clientInfo once during tools/list', async () => {
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const server = createServer(DEFAULT_CONFIG);
    const handler = requestHandler(server, ListToolsRequestSchema.shape.method.value);

    await handler({ method: 'tools/list', params: {} }, {});
    await handler({ method: 'tools/list', params: {} }, {});

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledWith('schema nullable optionals auto mode clientInfo', {
      clientName: 'unknown',
      clientVersion: 'unknown',
      resolvedNullableOptionals: false,
    });
    infoSpy.mockRestore();
  });
});

describe('createCachingLayer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses memory cache for auto mode on http-streamable without creating a SQLite file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'arc1-cache-auto-'));
    const dbPath = join(dir, 'arc1-cache.db');
    try {
      const layer = await createCachingLayer({
        ...DEFAULT_CONFIG,
        cacheMode: 'auto',
        transport: 'http-streamable',
        cacheFile: dbPath,
      });

      expect(layer?.cache).toBeInstanceOf(MemoryCache);
      expect(existsSync(dbPath)).toBe(false);
      layer?.cache.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('warns when persistent SQLite cache is explicitly enabled', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const dir = mkdtempSync(join(tmpdir(), 'arc1-cache-sqlite-'));
    const dbPath = join(dir, 'arc1-cache.db');
    try {
      const layer = await createCachingLayer({
        ...DEFAULT_CONFIG,
        cacheMode: 'sqlite',
        cacheFile: dbPath,
      });

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('stores SAP source in plaintext at rest'));
      layer?.cache.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('createServer request handlers', () => {
  it('filters listed tools by auth scopes and denyActions', async () => {
    const server = createServer({
      ...DEFAULT_CONFIG,
      allowDataPreview: true,
      allowWrites: true,
      allowTransportWrites: true,
      denyActions: ['SAPRead.TABLE_CONTENTS', 'SAPManage'],
    });
    const handler = requestHandler(server, ListToolsRequestSchema.shape.method.value);

    const result = await handler({ method: 'tools/list', params: {} }, { authInfo: readAuth() });
    const tools = result.tools as Array<Record<string, any>>;

    expect(tools.map((tool) => tool.name)).toContain('SAPRead');
    expect(tools.map((tool) => tool.name)).not.toContain('SAPManage');
    const sapRead = tools.find((tool) => tool.name === 'SAPRead');
    expect(sapRead?.inputSchema.properties.type.enum).not.toContain('TABLE_CONTENTS');
  });

  it('blocks tool calls before SAP access when startup auth preflight failed', async () => {
    const server = createServer(DEFAULT_CONFIG, {
      startupAuthPreflightPromise: Promise.resolve({
        status: 'failed',
        blocking: true,
        endpoint: '/sap/bc/adt/core/discovery',
        checkedAt: '2026-06-06T00:00:00.000Z',
        statusCode: 403,
        reason: 'Access forbidden (403) during startup auth preflight.',
      }),
    });
    const handler = requestHandler(server, CallToolRequestSchema.shape.method.value);

    const result = await handler({ method: 'tools/call', params: { name: 'SAPRead', arguments: {} } }, {});

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain('Startup authentication preflight failed');
    expect(result.content?.[0]?.text).toContain('HTTP 403');
  });

  it('rejects API-key calls in strict principal-propagation mode', async () => {
    const server = createServer({
      ...DEFAULT_CONFIG,
      apiKeys: [{ key: 'plain-api-key', profile: 'admin' }],
      ppEnabled: true,
      ppStrict: true,
      ppStrictExplicit: true,
    });
    const handler = requestHandler(server, CallToolRequestSchema.shape.method.value);

    const result = await handler(
      { method: 'tools/call', params: { name: 'SAPRead', arguments: {} } },
      {
        authInfo: {
          token: 'plain-api-key',
          clientId: 'api-key:admin',
          scopes: ['admin'],
          extra: {},
        },
      },
    );

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain('Principal propagation requires a JWT token');
  });

  it('allows JWT-shaped API-key calls when PP fail-closed mode is only the derived default', async () => {
    const server = createServer({
      ...DEFAULT_CONFIG,
      apiKeys: [{ key: 'key.part.value', profile: 'admin' }],
      ppEnabled: true,
      ppStrict: true,
      ppStrictExplicit: false,
    });
    const handler = requestHandler(server, CallToolRequestSchema.shape.method.value);

    const result = await handler(
      { method: 'tools/call', params: { name: 'SAPRead', arguments: {} } },
      {
        authInfo: {
          token: 'key.part.value',
          clientId: 'api-key:admin',
          scopes: ['admin'],
          extra: {},
        },
      },
    );

    expect(result.content?.[0]?.text).not.toContain('Principal propagation requires a JWT token');
    expect(result.content?.[0]?.text).not.toContain('Principal propagation failed');
    expect(result.content?.[0]?.text).toContain('Invalid arguments');
  });

  it('allows JWT-shaped API-key calls when ppStrict is explicitly false', async () => {
    const server = createServer({
      ...DEFAULT_CONFIG,
      apiKeys: [{ key: 'key.part.value', profile: 'admin' }],
      ppEnabled: true,
      ppStrict: false,
      ppStrictExplicit: true,
    });
    const handler = requestHandler(server, CallToolRequestSchema.shape.method.value);

    const result = await handler(
      { method: 'tools/call', params: { name: 'SAPRead', arguments: {} } },
      {
        authInfo: {
          token: 'key.part.value',
          clientId: 'api-key:admin',
          scopes: ['admin'],
          extra: {},
        },
      },
    );

    expect(result.content?.[0]?.text).not.toContain('Principal propagation requires a JWT token');
    expect(result.content?.[0]?.text).not.toContain('Principal propagation failed');
    expect(result.content?.[0]?.text).toContain('Invalid arguments');
  });

  it('does not infer API-key provenance from a colliding OIDC clientId', async () => {
    const server = createServer({
      ...DEFAULT_CONFIG,
      apiKeys: [{ key: 'real-api-key', profile: 'viewer' }],
      ppEnabled: true,
      ppStrict: false,
      ppStrictExplicit: true,
    });
    const handler = requestHandler(server, CallToolRequestSchema.shape.method.value);

    const result = await handler(
      { method: 'tools/call', params: { name: 'SAPRead', arguments: {} } },
      {
        authInfo: {
          token: 'header.payload.signature',
          clientId: 'api-key:viewer',
          scopes: ['read'],
          extra: { iss: 'https://issuer.example' },
        },
      },
    );

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain('BTP runtime configuration is unavailable');
    expect(result.content?.[0]?.text).not.toContain('Invalid arguments');
  });

  it('fails closed on JWT principal-propagation errors even when ppStrict is false', async () => {
    const ppDestination = process.env.SAP_BTP_PP_DESTINATION;
    const sharedDestination = process.env.SAP_BTP_DESTINATION;
    delete process.env.SAP_BTP_PP_DESTINATION;
    delete process.env.SAP_BTP_DESTINATION;

    try {
      const server = createServer(
        {
          ...DEFAULT_CONFIG,
          ppEnabled: true,
          ppStrict: false,
          ppStrictExplicit: true,
        },
        { btpConfig: {} as BTPConfig },
      );
      const handler = requestHandler(server, CallToolRequestSchema.shape.method.value);

      const result = await handler(
        { method: 'tools/call', params: { name: 'SAPRead', arguments: {} } },
        {
          authInfo: {
            token: 'header.payload.signature',
            clientId: 'oidc-client',
            scopes: ['read'],
            extra: { userName: 'PP_USER' },
          },
        },
      );

      expect(result.isError).toBe(true);
      expect(result.content?.[0]?.text).toContain('Principal propagation failed');
      expect(result.content?.[0]?.text).not.toContain('Invalid arguments');
    } finally {
      if (ppDestination === undefined) delete process.env.SAP_BTP_PP_DESTINATION;
      else process.env.SAP_BTP_PP_DESTINATION = ppDestination;
      if (sharedDestination === undefined) delete process.env.SAP_BTP_DESTINATION;
      else process.env.SAP_BTP_DESTINATION = sharedDestination;
    }
  });

  it('fails closed when a PP-enabled JWT request has no BTP runtime configuration', async () => {
    const server = createServer({
      ...DEFAULT_CONFIG,
      ppEnabled: true,
      ppStrict: false,
      ppStrictExplicit: true,
    });
    const handler = requestHandler(server, CallToolRequestSchema.shape.method.value);

    const result = await handler(
      { method: 'tools/call', params: { name: 'SAPRead', arguments: {} } },
      {
        authInfo: {
          token: 'header.payload.signature',
          clientId: 'oidc-client',
          scopes: ['read'],
          extra: { userName: 'PP_USER' },
        },
      },
    );

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain('BTP runtime configuration is unavailable');
    expect(result.content?.[0]?.text).not.toContain('Invalid arguments');
  });

  it('marks default-client cookies stale once after non-blocking cookie preflight 401', async () => {
    const markSpy = vi.spyOn(AdtHttpClient.prototype, 'markCookiesStale').mockImplementation(() => undefined);
    const startupAuth = Promise.resolve({
      status: 'inconclusive' as const,
      blocking: false,
      endpoint: '/sap/bc/adt/core/discovery',
      checkedAt: '2026-06-06T00:00:00.000Z',
      statusCode: 401,
      reason: 'stale cookie file',
    });
    const server = createServer(DEFAULT_CONFIG, { startupAuthPreflightPromise: startupAuth });
    const handler = requestHandler(server, CallToolRequestSchema.shape.method.value);

    await handler({ method: 'tools/call', params: { name: 'UnknownTool', arguments: {} } }, {});
    await handler({ method: 'tools/call', params: { name: 'UnknownTool', arguments: {} } }, {});

    expect(markSpy).toHaveBeenCalledTimes(1);
  });
});

describe('createServer tools/list — plugin tools (FEAT-61)', () => {
  afterEach(() => resetCachedFeatures());

  function readTool(name: `Custom_${string}`, extra: Partial<Parameters<typeof defineTool>[0]> = {}) {
    return defineTool({
      name,
      description: 'd',
      schema: z.object({}),
      policy: { scope: 'read', opType: 'R' },
      handler: async () => ({ content: [{ type: 'text', text: 'x' }] }),
      ...extra,
    });
  }

  async function listToolNames(
    config: Parameters<typeof createServer>[0],
    authInfo: AuthInfo = readAuth(),
  ): Promise<string[]> {
    const server = createServer(config);
    const handler = requestHandler(server, ListToolsRequestSchema.shape.method.value);
    const result = await handler({ method: 'tools/list', params: {} }, { authInfo });
    return (result.tools as Array<{ name: string }>).map((t) => t.name);
  }

  it('lists a read plugin tool but scope-prunes a write plugin tool for a read user', async () => {
    registerPluginTool(getToolRegistry(), 'demo', readTool('Custom_ListedRead'));
    registerPluginTool(
      getToolRegistry(),
      'demo',
      defineTool({
        name: 'Custom_HiddenWrite',
        description: 'w',
        schema: z.object({}),
        policy: { scope: 'write', opType: 'U' },
        handler: async () => ({ content: [{ type: 'text', text: 'x' }] }),
      }),
    );
    const names = await listToolNames({ ...DEFAULT_CONFIG, allowWrites: true });
    expect(names).toContain('Custom_ListedRead');
    expect(names).not.toContain('Custom_HiddenWrite'); // read user lacks the write scope
  });

  it('hides plugin tools in hyperfocused mode (only the SAP tool is exposed)', async () => {
    registerPluginTool(getToolRegistry(), 'demo', readTool('Custom_HfHidden'));
    const names = await listToolNames({ ...DEFAULT_CONFIG, toolMode: 'hyperfocused' });
    expect(names).toContain('SAP');
    expect(names).not.toContain('Custom_HfHidden');
  });

  it('enforces availableOn against the resolved system type', async () => {
    setCachedFeatures({ systemType: 'onprem' } as ResolvedFeatures);
    registerPluginTool(getToolRegistry(), 'demo', readTool('Custom_BtpOnly', { availableOn: 'btp' }));
    registerPluginTool(getToolRegistry(), 'demo', readTool('Custom_OnpremOnly', { availableOn: 'onprem' }));
    const names = await listToolNames(DEFAULT_CONFIG);
    expect(names).not.toContain('Custom_BtpOnly');
    expect(names).toContain('Custom_OnpremOnly');
  });
});

function readAuth(): AuthInfo {
  return {
    token: 'read-token',
    clientId: 'oidc-client',
    scopes: ['read', 'data'],
    extra: {},
  };
}

function writeCookieFixture(content: string): { file: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'arc1-server-cookies-test-'));
  const file = join(dir, 'cookies.txt');
  writeFileSync(file, content, 'utf-8');
  return {
    file,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe('buildAdtConfig', () => {
  it('includes username/password in shared config', () => {
    const cfg = buildAdtConfig({
      ...DEFAULT_CONFIG,
      url: 'http://sap.example.com:8000',
      username: 'DEVELOPER',
      password: 'secret',
    });

    expect(cfg.username).toBe('DEVELOPER');
    expect(cfg.password).toBe('secret');
  });

  it('omits shared credentials in per-user config', () => {
    const fixture = writeCookieFixture('.example.com\tTRUE\t/\tFALSE\t0\tSAP_SESSIONID\txyz789\n');
    const cfg = buildAdtConfig(
      {
        ...DEFAULT_CONFIG,
        url: 'http://sap.example.com:8000',
        username: 'DEVELOPER',
        password: 'secret',
        cookieFile: fixture.file,
      },
      undefined,
      undefined,
      { perUser: true },
    );
    try {
      expect(cfg.username).toBeUndefined();
      expect(cfg.password).toBeUndefined();
      expect(cfg.cookies).toBeUndefined();
    } finally {
      fixture.cleanup();
    }
  });

  it('preserves bearerTokenProvider for shared config', () => {
    const bearerTokenProvider = async () => 'token';
    const cfg = buildAdtConfig(
      {
        ...DEFAULT_CONFIG,
        url: 'http://sap.example.com:8000',
      },
      undefined,
      bearerTokenProvider,
    );

    expect(cfg.bearerTokenProvider).toBe(bearerTokenProvider);
  });

  it('preserves bearerTokenProvider for per-user config', () => {
    const bearerTokenProvider = async () => 'token';
    const cfg = buildAdtConfig(
      {
        ...DEFAULT_CONFIG,
        url: 'http://sap.example.com:8000',
        username: 'DEVELOPER',
        password: 'secret',
      },
      undefined,
      bearerTokenProvider,
      { perUser: true },
    );

    expect(cfg.bearerTokenProvider).toBe(bearerTokenProvider);
  });

  it('includes cookies in shared config when cookie file is provided', () => {
    const fixture = writeCookieFixture('.example.com\tTRUE\t/\tFALSE\t0\tSAP_SESSIONID\txyz789\n');
    const cfg = buildAdtConfig({
      ...DEFAULT_CONFIG,
      url: 'http://sap.example.com:8000',
      cookieFile: fixture.file,
    });

    try {
      expect(cfg.cookies).toEqual({ SAP_SESSIONID: 'xyz789' });
    } finally {
      fixture.cleanup();
    }
  });

  it('propagates disableSaml2 into ADT config', () => {
    const cfg = buildAdtConfig({
      ...DEFAULT_CONFIG,
      url: 'http://sap.example.com:8000',
      disableSaml2: true,
    });

    expect(cfg.disableSaml).toBe(true);
  });

  it('propagates gzipDataPreviewBody into ADT config', () => {
    const enabled = buildAdtConfig({
      ...DEFAULT_CONFIG,
      gzipDataPreviewBody: true,
    });
    const disabled = buildAdtConfig({
      ...DEFAULT_CONFIG,
      gzipDataPreviewBody: false,
    });

    expect(enabled.gzipDataPreviewBody).toBe(true);
    expect(disabled.gzipDataPreviewBody).toBe(false);
  });

  it('passes cookieFile and cookieString through to shared ADT config', () => {
    const fixture = writeCookieFixture('.example.com\tTRUE\t/\tFALSE\t0\tSAP_SESSIONID\txyz789\n');
    const cfg = buildAdtConfig({
      ...DEFAULT_CONFIG,
      url: 'http://sap.example.com:8000',
      cookieFile: fixture.file,
      cookieString: 'EXTRA=v',
    });
    try {
      expect(cfg.cookieFile).toBe(fixture.file);
      expect(cfg.cookieString).toBe('EXTRA=v');
    } finally {
      fixture.cleanup();
    }
  });

  it('strips cookieFile and cookieString in per-user config', () => {
    const fixture = writeCookieFixture('.example.com\tTRUE\t/\tFALSE\t0\tSAP_SESSIONID\txyz789\n');
    const cfg = buildAdtConfig(
      {
        ...DEFAULT_CONFIG,
        url: 'http://sap.example.com:8000',
        cookieFile: fixture.file,
        cookieString: 'EXTRA=v',
      },
      undefined,
      undefined,
      { perUser: true },
    );
    try {
      expect(cfg.cookieFile).toBeUndefined();
      expect(cfg.cookieString).toBeUndefined();
      expect(cfg.cookies).toBeUndefined();
    } finally {
      fixture.cleanup();
    }
  });
});

describe('single-target shared credential reachability', () => {
  it('distinguishes strict PP from an actually reachable shared /mcp client', () => {
    expect(
      canUseSharedSingleTargetCredentials(
        { apiKeys: [{ key: 'k', profile: 'viewer' }], ppEnabled: true, ppStrict: true, ppStrictExplicit: true },
        'TECH_USER',
        'PASSWORD',
      ),
    ).toBe(false);
    expect(
      canUseSharedSingleTargetCredentials(
        { apiKeys: [{ key: 'k', profile: 'viewer' }], ppEnabled: true, ppStrict: false, ppStrictExplicit: true },
        'TECH_USER',
        'PASSWORD',
      ),
    ).toBe(true);
    expect(
      canUseSharedSingleTargetCredentials(
        { apiKeys: [], ppEnabled: false, ppStrict: false, ppStrictExplicit: false },
        'TECH_USER',
        'PASSWORD',
      ),
    ).toBe(true);
    expect(
      canUseSharedSingleTargetCredentials(
        { apiKeys: [], ppEnabled: true, ppStrict: false, ppStrictExplicit: true },
        'TECH_USER',
        'PASSWORD',
      ),
    ).toBe(false);
    expect(
      canUseSharedSingleTargetCredentials(
        { apiKeys: [], ppEnabled: false, ppStrict: false, ppStrictExplicit: false },
        '',
        'PASSWORD',
      ),
    ).toBe(false);
  });

  it('derives the bare /mcp overlap from direct SAP_URL credentials', () => {
    const config = {
      ...DEFAULT_CONFIG,
      url: 'https://sap.internal:443/',
      client: '100',
      username: 'TECH_USER',
      password: 'PASSWORD',
    };

    const overlap = resolveSingleTargetOverlapState(config, undefined, false);

    expect(overlap).toEqual({
      usesSharedBasic: true,
      connectionFingerprint: targetConnectionFingerprint({
        urlFingerprint: opaqueDestinationValue('https://sap.internal/'),
        client: '100',
      }),
    });
  });

  it('does not classify a bearer-backed bare /mcp connection as shared Basic', () => {
    const overlap = resolveSingleTargetOverlapState(
      {
        ...DEFAULT_CONFIG,
        url: 'https://sap.internal',
        username: 'STALE_USER',
        password: 'STALE_PASSWORD',
      },
      undefined,
      true,
    );

    expect(overlap.usesSharedBasic).toBe(false);
    expect(overlap.connectionFingerprint).toBeDefined();
  });
});

describe('logAuthSummary', () => {
  const savedDestination = process.env.SAP_BTP_DESTINATION;

  afterEach(() => {
    if (savedDestination === undefined) {
      delete process.env.SAP_BTP_DESTINATION;
    } else {
      process.env.SAP_BTP_DESTINATION = savedDestination;
    }
    vi.restoreAllMocks();
  });

  it('logs api-keys MCP auth and basic shared SAP auth', () => {
    delete process.env.SAP_BTP_DESTINATION;
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);

    logAuthSummary({
      ...DEFAULT_CONFIG,
      apiKeys: [{ key: 'k', profile: 'viewer' }],
      username: 'DEVELOPER',
      password: 'secret',
    });

    expect(infoSpy).toHaveBeenCalledWith('auth: MCP=[api-keys] SAP=basic (shared)');
  });

  it('logs oidc MCP auth and per-user PP SAP auth', () => {
    delete process.env.SAP_BTP_DESTINATION;
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);

    logAuthSummary({
      ...DEFAULT_CONFIG,
      oidcIssuer: 'https://issuer.example.com',
      oidcAudience: 'arc-1',
      ppEnabled: true,
    });

    expect(infoSpy).toHaveBeenCalledWith('auth: MCP=[oidc] SAP=pp (per-user)');
  });

  it('labels and warns about mixed API-key and PP SAP identities', () => {
    delete process.env.SAP_BTP_DESTINATION;
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    logAuthSummary({
      ...DEFAULT_CONFIG,
      apiKeys: [{ key: 'k', profile: 'viewer' }],
      oidcIssuer: 'https://issuer.example.com',
      oidcAudience: 'arc-1',
      cookieFile: 'cookies.txt',
      ppAllowSharedCookies: true,
      ppEnabled: true,
    });

    expect(infoSpy).toHaveBeenCalledWith(
      'auth: MCP=[api-keys,oidc] SAP=cookie+pp (mixed: JWT per-user, API keys shared)',
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Mixed mode is supported'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Separate instances are recommended'));
  });

  it('warns when API keys are configured on an explicitly strict PP-only instance', () => {
    delete process.env.SAP_BTP_DESTINATION;
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    logAuthSummary({
      ...DEFAULT_CONFIG,
      apiKeys: [{ key: 'k', profile: 'viewer' }],
      xsuaaAuth: true,
      ppEnabled: true,
      ppStrict: true,
      ppStrictExplicit: true,
    });

    expect(infoSpy).toHaveBeenCalledWith('auth: MCP=[api-keys,xsuaa] SAP=pp (per-user)');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('rejects API-key MCP tool calls'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('supported mixed operation'));
  });

  it('labels a Basic-capable multi-target deployment with its per-target identity modes', () => {
    delete process.env.SAP_BTP_DESTINATION;
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);

    logAuthSummary({
      ...DEFAULT_CONFIG,
      xsuaaAuth: true,
      ppEnabled: true,
      multiTargetEndpoints: true,
      multiTargetAllowBasicAuth: true,
    });

    expect(infoSpy).toHaveBeenCalledWith(
      'auth: MCP=[xsuaa] SAP=destination+pp/basic-shared (multi-target) (per-target: PP per-user or Basic shared)',
    );
  });
});

describe('startup auth preflight', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips in principal propagation mode', async () => {
    const result = await runStartupAuthPreflight({
      ...DEFAULT_CONFIG,
      ppEnabled: true,
      url: 'http://sap.example.com:8000',
    });

    expect(result.status).toBe('skipped');
    expect(result.blocking).toBe(false);
    expect(result.reason.toLowerCase()).toContain('principal propagation');
  });

  it('skips when SAP URL is not configured', async () => {
    const result = await runStartupAuthPreflight({
      ...DEFAULT_CONFIG,
      ppEnabled: false,
      url: '',
    });

    expect(result.status).toBe('skipped');
    expect(result.blocking).toBe(false);
    expect(result.reason).toContain('SAP_URL');
  });

  it('formats a blocking preflight failure for tool calls', () => {
    const text = formatStartupAuthPreflightToolError({
      status: 'failed',
      blocking: true,
      endpoint: '/sap/bc/adt/core/discovery',
      checkedAt: '2026-04-21T00:00:00.000Z',
      statusCode: 401,
      reason: 'Authentication failed (401) during startup auth preflight.',
    });

    expect(text).toContain('Startup authentication preflight failed');
    expect(text).toContain('HTTP 401');
    expect(text).toContain('blocking shared SAP tool calls');
    expect(text).toContain('/sap/bc/adt/core/discovery');
  });

  it('returns blocking failure on 401/403 auth errors', async () => {
    vi.spyOn(AdtHttpClient.prototype, 'get').mockRejectedValue(
      new AdtApiError('Unauthorized', 401, '/sap/bc/adt/core/discovery', 'Unauthorized'),
    );

    const result = await runStartupAuthPreflight({
      ...DEFAULT_CONFIG,
      ppEnabled: false,
      url: 'http://sap.example.com:8000',
      username: 'TECH_USER',
      password: 'wrong',
    });

    expect(result.status).toBe('failed');
    expect(result.blocking).toBe(true);
    expect(result.statusCode).toBe(401);
  });

  it('can run on an existing client so direct callers retain its auth state', async () => {
    const get = vi.fn(async () => '<discovery/>');
    const client = { http: { get } } as unknown as import('../../../src/adt/client.js').AdtClient;

    const result = await runStartupAuthPreflightWithClient(
      {
        ...DEFAULT_CONFIG,
        ppEnabled: false,
        url: 'http://sap.example.com:8000',
      },
      client,
    );

    expect(result.status).toBe('ok');
    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith('/sap/bc/adt/core/discovery');
  });

  it('returns inconclusive and non-blocking on non-auth failures', async () => {
    vi.spyOn(AdtHttpClient.prototype, 'get').mockRejectedValue(new Error('connect ECONNREFUSED'));

    const result = await runStartupAuthPreflight({
      ...DEFAULT_CONFIG,
      ppEnabled: false,
      url: 'http://sap.example.com:8000',
      username: 'TECH_USER',
      password: 'secret',
    });

    expect(result.status).toBe('inconclusive');
    expect(result.blocking).toBe(false);
  });

  it('downgrades 401 to inconclusive (non-blocking) when in cookie-auth mode', async () => {
    const fixture = writeCookieFixture('.example.com\tTRUE\t/\tFALSE\t0\tSAP_SESSIONID\txyz789\n');
    vi.spyOn(AdtHttpClient.prototype, 'get').mockRejectedValue(
      new AdtApiError('Unauthorized', 401, '/sap/bc/adt/core/discovery', 'stale cookie'),
    );

    try {
      const result = await runStartupAuthPreflight({
        ...DEFAULT_CONFIG,
        ppEnabled: false,
        url: 'http://sap.example.com:8000',
        cookieFile: fixture.file,
      });

      expect(result.status).toBe('inconclusive');
      expect(result.blocking).toBe(false);
      expect(result.statusCode).toBe(401);
      expect(result.reason).toContain('arc1-cli extract-cookies');
    } finally {
      fixture.cleanup();
    }
  });

  it('keeps 403 blocking even in cookie-auth mode', async () => {
    const fixture = writeCookieFixture('.example.com\tTRUE\t/\tFALSE\t0\tSAP_SESSIONID\txyz789\n');
    vi.spyOn(AdtHttpClient.prototype, 'get').mockRejectedValue(
      new AdtApiError('Forbidden', 403, '/sap/bc/adt/core/discovery', 'forbidden'),
    );

    try {
      const result = await runStartupAuthPreflight({
        ...DEFAULT_CONFIG,
        ppEnabled: false,
        url: 'http://sap.example.com:8000',
        cookieFile: fixture.file,
      });

      expect(result.status).toBe('failed');
      expect(result.blocking).toBe(true);
      expect(result.statusCode).toBe(403);
    } finally {
      fixture.cleanup();
    }
  });

  it('keeps 401 blocking when not in cookie-auth mode', async () => {
    vi.spyOn(AdtHttpClient.prototype, 'get').mockRejectedValue(
      new AdtApiError('Unauthorized', 401, '/sap/bc/adt/core/discovery', 'wrong creds'),
    );

    const result = await runStartupAuthPreflight({
      ...DEFAULT_CONFIG,
      ppEnabled: false,
      url: 'http://sap.example.com:8000',
      username: 'TECH_USER',
      password: 'wrong',
    });

    expect(result.status).toBe('failed');
    expect(result.blocking).toBe(true);
  });

  // ─── P2 (codex review): cookieString-only stays blocking on 401 ────────
  // SAP_COOKIE_STRING is read once at startup and cannot change in the
  // running process — the runtime client cannot recover via lazy reload, so
  // promising "no restart needed" would be a lie. Only SAP_COOKIE_FILE gets
  // the non-blocking downgrade.
  it('keeps 401 blocking when only cookieString is set (no hot-reload promise)', async () => {
    vi.spyOn(AdtHttpClient.prototype, 'get').mockRejectedValue(
      new AdtApiError('Unauthorized', 401, '/sap/bc/adt/core/discovery', 'stale cookie'),
    );

    const result = await runStartupAuthPreflight({
      ...DEFAULT_CONFIG,
      ppEnabled: false,
      url: 'http://sap.example.com:8000',
      cookieString: 'MYSAPSSO2=abc123',
    });

    expect(result.status).toBe('failed');
    expect(result.blocking).toBe(true);
    expect(result.statusCode).toBe(401);
    // Reason must NOT promise hot-reload for cookieString.
    expect(result.reason).not.toContain('no restart needed');
    expect(result.reason).toContain('SAP_COOKIE_STRING');
    expect(result.reason).toContain('static');
  });

  it('downgrade applies even when both cookieFile and cookieString are set (file wins)', async () => {
    const fixture = writeCookieFixture('.example.com\tTRUE\t/\tFALSE\t0\tSAP_SESSIONID\txyz789\n');
    vi.spyOn(AdtHttpClient.prototype, 'get').mockRejectedValue(
      new AdtApiError('Unauthorized', 401, '/sap/bc/adt/core/discovery', 'stale cookie'),
    );

    try {
      const result = await runStartupAuthPreflight({
        ...DEFAULT_CONFIG,
        ppEnabled: false,
        url: 'http://sap.example.com:8000',
        cookieFile: fixture.file,
        cookieString: 'MYSAPSSO2=also-set',
      });

      // Presence of cookieFile makes the deployment hot-reloadable.
      expect(result.status).toBe('inconclusive');
      expect(result.blocking).toBe(false);
      expect(result.reason).toContain('arc1-cli extract-cookies');
    } finally {
      fixture.cleanup();
    }
  });
});

describe('direct client feature bootstrap', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('installs discovery evidence on the exact client that was probed', async () => {
    const discoveryMap = new Map([['/sap/bc/adt/programs/programs', ['application/vnd.sap.adt.programs.v2+xml']]]);
    vi.spyOn(adtFeatures, 'probeFeatures').mockResolvedValue({ discoveryMap } as ResolvedFeatures);
    const setDiscoveryMap = vi.fn();
    const client = { http: { setDiscoveryMap } } as unknown as import('../../../src/adt/client.js').AdtClient;

    await probeClientFeatures(DEFAULT_CONFIG, client);

    expect(setDiscoveryMap).toHaveBeenCalledOnce();
    expect(setDiscoveryMap).toHaveBeenCalledWith(discoveryMap);
  });
});

describe('resolvePpDestinationName', () => {
  afterEach(() => {
    delete process.env.SAP_BTP_PP_DESTINATION;
    delete process.env.SAP_BTP_DESTINATION;
  });

  it('single-destination mode: SAP_BTP_PP_DESTINATION wins, SAP_BTP_DESTINATION is the fallback', () => {
    expect(resolvePpDestinationName(DEFAULT_CONFIG)).toBeUndefined();
    process.env.SAP_BTP_DESTINATION = 'S4_SHARED';
    expect(resolvePpDestinationName(DEFAULT_CONFIG)).toBe('S4_SHARED');
    process.env.SAP_BTP_PP_DESTINATION = 'S4_PP';
    expect(resolvePpDestinationName(DEFAULT_CONFIG)).toBe('S4_PP');
  });

  it('discovered target runtime: its destination name wins and global env vars never leak in', () => {
    process.env.SAP_BTP_PP_DESTINATION = 'GLOBAL_PP';
    const cfg = { ...DEFAULT_CONFIG, destinationName: 'S4D' };
    expect(resolvePpDestinationName(cfg)).toBe('S4D');
  });
});
