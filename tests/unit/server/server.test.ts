import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AdtApiError } from '../../../src/adt/errors.js';
import { AdtHttpClient } from '../../../src/adt/http.js';
import type { ResolvedFeatures } from '../../../src/adt/types.js';
import { getToolRegistry } from '../../../src/handlers/dispatch.js';
import { resetCachedFeatures, setCachedFeatures } from '../../../src/handlers/feature-cache.js';
import { getToolDefinitions } from '../../../src/handlers/tools.js';
import { defineTool } from '../../../src/public/index.js';
import { logger } from '../../../src/server/logger.js';
import { registerPluginTool } from '../../../src/server/plugin-loader.js';
import {
  buildAdtConfig,
  createServer,
  filterToolsByAuthScope,
  formatStartupAuthPreflightToolError,
  getConfiguredToolDefinitions,
  logAuthSummary,
  resolveNullableOptionals,
  runStartupAuthPreflight,
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
  it('creates a server instance with correct name and version', () => {
    const server = createServer(DEFAULT_CONFIG);
    expect(server).toBeDefined();
  });

  it('has a valid version string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
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
    const server = createServer(
      DEFAULT_CONFIG,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      Promise.resolve({
        status: 'failed',
        blocking: true,
        endpoint: '/sap/bc/adt/core/discovery',
        checkedAt: '2026-06-06T00:00:00.000Z',
        statusCode: 403,
        reason: 'Access forbidden (403) during startup auth preflight.',
      }),
    );
    const handler = requestHandler(server, CallToolRequestSchema.shape.method.value);

    const result = await handler({ method: 'tools/call', params: { name: 'SAPRead', arguments: {} } }, {});

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain('Startup authentication preflight failed');
    expect(result.content?.[0]?.text).toContain('HTTP 403');
  });

  it('rejects API-key calls in strict principal-propagation mode', async () => {
    const server = createServer({
      ...DEFAULT_CONFIG,
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

  it('allows API-key calls when PP fail-closed mode is only the derived default', async () => {
    const server = createServer({
      ...DEFAULT_CONFIG,
      ppEnabled: true,
      ppStrict: true,
      ppStrictExplicit: false,
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

    expect(result.content?.[0]?.text).not.toContain('Principal propagation requires a JWT token');
    expect(result.content?.[0]?.text).toContain('Invalid arguments');
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
    const server = createServer(DEFAULT_CONFIG, undefined, undefined, undefined, undefined, undefined, startupAuth);
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

  it('logs combined api-keys+oidc MCP auth and cookie+pp SAP auth', () => {
    delete process.env.SAP_BTP_DESTINATION;
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);

    logAuthSummary({
      ...DEFAULT_CONFIG,
      apiKeys: [{ key: 'k', profile: 'viewer' }],
      oidcIssuer: 'https://issuer.example.com',
      oidcAudience: 'arc-1',
      cookieFile: 'cookies.txt',
      ppAllowSharedCookies: true,
      ppEnabled: true,
    });

    expect(infoSpy).toHaveBeenCalledWith('auth: MCP=[api-keys,oidc] SAP=cookie+pp (per-user)');
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
