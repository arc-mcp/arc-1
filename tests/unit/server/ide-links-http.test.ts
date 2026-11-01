/** Real HTTP bearer middleware + SDK transport + request-local MCP server contracts. */
import { EventEmitter, once } from 'node:events';
import { createServer as createHttpServer, type Server as HttpServer, request as httpRequest } from 'node:http';
import { createXsuaaTokenVerifier, type XsuaaCredentials } from '@arc-mcp/xsuaa-auth';
import type { BTPConfig } from '@arc-mcp/xsuaa-auth/btp';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtClient } from '../../../src/adt/client.js';
import { AdtHttpClient } from '../../../src/adt/http.js';
import { CachingLayer } from '../../../src/cache/caching-layer.js';
import { MemoryCache } from '../../../src/cache/memory.js';
import { resetCachedFeatures, setCachedFeatures } from '../../../src/handlers/feature-cache.js';
import { canonicalDestinationUrl, opaqueDestinationValue } from '../../../src/server/destination-discovery.js';
import { DestinationRegistry } from '../../../src/server/destination-registry.js';
import { startHttpServer } from '../../../src/server/http.js';
import { logger } from '../../../src/server/logger.js';
import { buildAggregateToolSurfaceConfig, buildMultiTargetConfig } from '../../../src/server/multi-target-runtime.js';
import { createServer } from '../../../src/server/server.js';
import { DEFAULT_CONFIG, type ServerConfig } from '../../../src/server/types.js';
import { featuresOff } from '../handlers/handler-test-config.js';

const verifiedTokens = vi.hoisted(() => new Map<string, AuthInfo | 'machine'>());
vi.mock('@arc-mcp/xsuaa-auth', async (importOriginal) => {
  const original = await importOriginal<typeof import('@arc-mcp/xsuaa-auth')>();
  const { InvalidTokenError } = await import('@modelcontextprotocol/sdk/server/auth/errors.js');
  return {
    ...original,
    createXsuaaTokenVerifier: vi.fn((_credentials, options) => async (token: string) => {
      const auth = verifiedTokens.get(token);
      if (auth === 'machine' && options?.requireUserToken) throw new original.XsuaaUserTokenRequiredError();
      if (!auth || auth === 'machine') throw new InvalidTokenError('Invalid test token');
      return options?.userAttributeNames?.includes('arc1_targets')
        ? auth
        : { ...auth, extra: { userName: auth.extra?.userName } };
    }),
  };
});

const resolveDestination = vi.hoisted(() => vi.fn());
vi.mock('../../../src/server/multi-target-destination-runtime.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/server/multi-target-destination-runtime.js')>()),
  resolveRuntimeSubaccountPpDestination: resolveDestination,
}));
vi.mock('@arc-mcp/xsuaa-auth/btp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@arc-mcp/xsuaa-auth/btp')>()),
  createConnectivityProxy: vi.fn(() => undefined),
}));
const BTP = {
  xsuaaUrl: 'https://xsuaa.example.test',
  xsuaaClientId: 'test',
  xsuaaSecret: 'test',
  destinationUrl: 'https://destination.example.test',
  destinationClientId: 'test',
  destinationSecret: 'test',
  destinationTokenUrl: 'https://destination.example.test/oauth/token',
  connectivityProxyHost: '',
  connectivityProxyPort: '',
  connectivityClientId: '',
  connectivitySecret: '',
  connectivityTokenUrl: '',
} satisfies BTPConfig;
const SOURCE = 'CLASS cl_abap_typedescr DEFINITION.';
const XSUAA: XsuaaCredentials = {
  url: 'https://tenant.authentication.example.test',
  clientid: 'arc1-test-client',
  clientsecret: 'test-client-secret-with-enough-entropy',
  xsappname: 'arc1-test!t1',
  uaadomain: 'authentication.example.test',
};
const CONFIG: ServerConfig = {
  ...DEFAULT_CONFIG,
  transport: 'http-streamable',
  httpAddr: '127.0.0.1:0',
  xsuaaAuth: true,
  ideLinks: 'eclipse',
  ideSystemId: 'A4H',
  multiTargetEndpoints: true,
  multiTargetAuthorization: 'xsuaa-attribute',
  cacheMode: 'none',
  allowDataPreview: true,
  allowFreeSQL: true,
  authRateLimit: 0,
  mcpHttpRateLimit: 0,
};

function makeRegistry(
  count = 3,
  sqlClients: number[] = [],
  config = CONFIG,
  quarantine: number[] = [],
  description?: string,
) {
  const url = canonicalDestinationUrl('http://sap.internal:50000') as string;
  return DestinationRegistry.fromDiscovery(
    {
      subaccount: Array.from({ length: count }, (_, index) => ({
        name: `DEST_${index}`,
        type: 'HTTP',
        urlState: 'valid' as const,
        urlFingerprint: opaqueDestinationValue(url),
        authentication: 'PrincipalPropagation',
        proxyType: 'OnPremise',
        sapSysId: 'A4H',
        sapClient: index === 2 ? '000' : String(index).padStart(3, '0'),
        description: description ?? `SAP target ${index}`,
        hasCloudConnectorLocationId: false,
        arcProperties: {
          'arc1.enabled': quarantine.includes(index) ? 'invalid' : 'true',
          ...(index === 2 ? { 'arc1.target_alias': 'A4H-OTHER' } : {}),
          'arc1.allow_data_preview': String(sqlClients.includes(index)),
          'arc1.allow_free_sql': String(sqlClients.includes(index)),
        },
      })),
      instanceNames: [],
      scannedCount: count,
      unrelatedCount: 0,
      arcAdjacentWithoutMarkerCount: 0,
    },
    config,
    { authorizationMode: config.multiTargetAuthorization },
  );
}

function addUser(grants: unknown, scopes = ['read'], status = 'valid'): string {
  const token = `user.${verifiedTokens.size}.signature`;
  verifiedTokens.set(token, {
    token,
    clientId: 'test-client',
    scopes,
    expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
    extra: {
      // Deliberately identical email: isolation must use the verified request, not an email cache.
      userName: 'user/ias/same-email@example.test',
      xsuaaUserAttributes: { arc1_targets: grants },
      xsuaaUserAttributeStatus: { arc1_targets: status },
    },
  });
  return token;
}

type Result = {
  instructions?: string;
  content?: Array<{ type: string; text: string }>;
  isError?: boolean;
};
function result(response: { status: number; text: string }): Result {
  expect(response.status, response.text.slice(0, 200)).toBe(200);
  const line = response.text.split('\n').find((value) => value.startsWith('data: '));
  expect(line).toBeDefined();
  const message = JSON.parse((line as string).slice(6));
  expect(message.error).toBeUndefined();
  return message.result;
}

describe('request-scoped Eclipse links over real pinned/aggregate HTTP routing', () => {
  let app: express.Express;
  let httpServer: HttpServer;
  let sequence = 0;
  const servers: Server[] = [];
  const httpServers: HttpServer[] = [];
  let network: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    verifiedTokens.clear();
    resetCachedFeatures();
    for (const target of ['A4H/000', 'A4H/001', 'A4H-OTHER/000']) setCachedFeatures(featuresOff(), target);
    resolveDestination.mockReset().mockImplementation(async (_btp, destinationName: string) => {
      const target = makeRegistry().targets.find((item) => item.destinationName === destinationName)!;
      return {
        destination: {
          URL: 'http://sap.internal:50000',
          Name: target.destinationName,
          'sap-client': target.client,
          Type: 'HTTP',
          Authentication: 'PrincipalPropagation',
          ProxyType: 'OnPremise',
          User: '',
          Password: '',
          originalProperties: {
            Name: target.destinationName,
            URL: 'http://sap.internal:50000',
            Type: 'HTTP',
            Authentication: 'PrincipalPropagation',
            ProxyType: 'OnPremise',
            'sap-sysid': 'A4H',
            'sap-client': target.client,
            Description: `SAP target ${target.destinationName.slice(-1)}`,
            'arc1.enabled': 'true',
            'arc1.allow_data_preview': 'false',
            'arc1.allow_free_sql': 'false',
            ...(target.target === 'A4H-OTHER/000' ? { 'arc1.target_alias': 'A4H-OTHER' } : {}),
          },
        },
        authTokens: { sapConnectivityAuth: 'Bearer test-assertion' },
      };
    });
    vi.spyOn(AdtHttpClient.prototype, 'get').mockResolvedValue({ statusCode: 200, headers: {}, body: SOURCE });
    vi.spyOn(AdtClient.prototype, 'getInactiveObjects').mockResolvedValue([]);
    vi.mocked(createXsuaaTokenVerifier).mockClear();
    sequence = 0;
    network = vi.fn(async () => {
      throw new Error('Unexpected network access in authorization test');
    });
    vi.stubGlobal('fetch', network);
    for (const name of ['info', 'warn', 'error', 'emitAudit'] as const)
      vi.spyOn(logger, name).mockImplementation(() => {});
    vi.spyOn(express.application, 'listen').mockImplementation(function (this: express.Express) {
      app = this;
      return new EventEmitter() as never;
    });
  });
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
    await Promise.all(
      httpServers.splice(0).map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
            server.closeAllConnections();
          }),
      ),
    );
    expect(network).not.toHaveBeenCalled();
    resetCachedFeatures();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function start(registry = makeRegistry(), config = CONFIG, omitProjection = false) {
    await startHttpServer(undefined, config, XSUAA, undefined, {
      registry,
      authorizationMode: config.multiTargetAuthorization,
      aggregateFactory: (authorization) => {
        const server = createServer(buildAggregateToolSurfaceConfig(config, registry.targets), {
          btpConfig: BTP,
          multiTarget: {
            mode: 'aggregate',
            registry,
            instanceConfig: config,
            authorization: omitProjection ? undefined : authorization,
          },
        });
        servers.push(server);
        return server;
      },
      createPinnedServer: (target, authorization) => {
        const server = createServer(buildMultiTargetConfig(config, target, { mode: 'pinned' }), {
          btpConfig: BTP,
          multiTarget: { mode: 'pinned', registry, instanceConfig: config, target, authorization },
        });
        servers.push(server);
        return server;
      },
    });
    await listen();
  }
  async function listen() {
    // Supertest's implicit listen(0) binds :: but connects to 127.0.0.1. On macOS
    // that wildcard can share a port with an unrelated IPv4 listener. Bind the
    // exact loopback address and keep the listener alive for this test's calls.
    httpServer = createHttpServer(app);
    httpServer.listen(0, '127.0.0.1');
    await once(httpServer, 'listening');
    httpServers.push(httpServer);
  }
  function rpc(
    token: string | undefined,
    method: string,
    params?: unknown,
    path = '/multi/mcp',
    headers: Record<string, string> = {},
  ) {
    const call = request(httpServer)
      .post(path)
      .set(headers)
      .set('Accept', 'application/json, text/event-stream')
      .set('MCP-Protocol-Version', '2025-11-25');
    if (token) call.set('Authorization', `Bearer ${token}`);
    return call.send({ jsonrpc: '2.0', id: ++sequence, method, ...(params ? { params } : {}) });
  }
  const preference = { 'Arc1-Ide-Client': 'eclipse' };
  async function read(
    token: string,
    target: string,
    pinned: boolean,
    headers: Record<string, string> = {},
    name = 'CL_ABAP_TYPEDESCR',
  ) {
    return result(
      await rpc(
        token,
        'tools/call',
        { name: 'SAPRead', arguments: { type: 'CLAS', extensions: 'none', name, ...(pinned ? {} : { target }) } },
        pinned ? `/${target}/mcp` : '/multi/mcp',
        headers,
      ),
    );
  }
  function expectLinks(response: Result, enabled = false, target?: string, source = SOURCE) {
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    expect(response.content?.[0]).toEqual({ type: 'text', text: source });
    expect(response.content).toHaveLength(enabled ? 2 : 1);
    expect(JSON.stringify(response)).not.toContain('vscode://');
    if (enabled) {
      const text = response.content![1].text;
      expect(text).toContain('SAP SID: A4H; client:');
      if (target) expect(text).toContain(`target: ${target};`);
      else expect(text).not.toContain('target:');
      expect(text).toContain('(adt://A4H/sap/bc/adt/oo/classes/cl_abap_typedescr)');
    }
  }

  it.each(['standard', 'xsuaa-attribute'] as const)(
    "isolates concurrent users' preferences across both endpoints, SAP clients and duplicate-SID route aliases (%s)",
    async (mode) => {
      const config = { ...CONFIG, multiTargetAuthorization: mode };
      await start(makeRegistry(3, [], config), config);
      const alice = addUser(['A4H/000', 'A4H/001', 'A4H-OTHER/000']);
      const bob = addUser(['A4H/000', 'A4H/001', 'A4H-OTHER/000']);
      const targets = ['A4H/000', 'A4H/001', 'A4H-OTHER/000'];
      await Promise.all(
        [alice, bob].flatMap((user, u) =>
          [true, false].flatMap((pinned) =>
            targets.map(async (target) => {
              const enabled = u === 0;
              for (let repeat = 0; repeat < 2; repeat++)
                expectLinks(await read(user, target, pinned, enabled ? preference : {}), enabled, target);
            }),
          ),
        ),
      );
      expect(resolveDestination).toHaveBeenCalledTimes(24);
      expect(vi.mocked(AdtHttpClient.prototype.get).mock.calls).toHaveLength(24);
      // Presentation does not add a SAP call, leak into its headers, or appear in audit previews.
      expect(JSON.stringify(vi.mocked(AdtHttpClient.prototype.get).mock.calls)).not.toMatch(/adt:\/\/|Arc1-Ide/i);
      expect(JSON.stringify(vi.mocked(logger.emitAudit).mock.calls)).not.toMatch(/adt:\/\/|Arc1-Ide/i);
    },
  );

  it.each(['api-key', 'jwt'] as const)(
    'requires authentication for traditional /mcp presentation (%s)',
    async (auth) => {
      const config: ServerConfig = {
        ...CONFIG,
        url: 'https://sap.example.test',
        xsuaaAuth: auth === 'jwt',
        multiTargetEndpoints: false,
        multiTargetAuthorization: 'standard',
        apiKeys: auth === 'api-key' ? [{ key: 'single-viewer-key-for-test', profile: 'viewer' }] : undefined,
      };
      setCachedFeatures(featuresOff());
      await startHttpServer(
        () => {
          const server = createServer(config);
          servers.push(server);
          return server;
        },
        config,
        auth === 'jwt' ? XSUAA : undefined,
      );
      await listen();
      const token = auth === 'jwt' ? addUser([]) : 'single-viewer-key-for-test';
      const params = { name: 'SAPRead', arguments: { type: 'CLAS', extensions: 'none', name: 'CL_ABAP_TYPEDESCR' } };
      const denied = await rpc(undefined, 'tools/call', params, '/mcp', preference);
      expect(denied.status).toBe(401);
      expect(denied.text).not.toMatch(/vscode:|adt:/);
      expect(AdtHttpClient.prototype.get).not.toHaveBeenCalled();
      expectLinks(result(await rpc(token, 'tools/call', params, '/mcp', preference)), true);
      expectLinks(
        result(
          await rpc(token, 'tools/call', params, '/mcp', {
            'Arc1-Ide-Client': 'vscode',
            'Arc1-Ide-Destinations-V1': '@single=LOCAL',
          }),
        ),
      );
      expectLinks(result(await rpc(token, 'tools/call', params, '/mcp')));
      expect(resolveDestination).not.toHaveBeenCalled();
    },
  );

  it('keeps presentation out of a shared single-target source cache', async () => {
    const cachingLayer = new CachingLayer(new MemoryCache());
    const config: ServerConfig = {
      ...CONFIG,
      url: 'https://sap.example.test',
      username: 'shared-test-sap-user',
      password: 'test-only-password',
      xsuaaAuth: false,
      multiTargetEndpoints: false,
      multiTargetAuthorization: 'standard',
      cacheMode: 'memory',
      apiKeys: [
        { key: 'alice-viewer-key-for-test', profile: 'viewer' },
        { key: 'bob-viewer-key-for-test', profile: 'viewer' },
      ],
    };
    setCachedFeatures(featuresOff());
    vi.mocked(AdtHttpClient.prototype.get)
      .mockResolvedValueOnce({ statusCode: 200, headers: { etag: 'source-v1' }, body: SOURCE })
      .mockResolvedValue({ statusCode: 304, headers: { etag: 'source-v1' }, body: '' });
    await startHttpServer(() => {
      const server = createServer(config, { cachingLayer });
      servers.push(server);
      return server;
    }, config);
    await listen();
    const params = {
      name: 'SAPRead',
      arguments: { type: 'CLAS', extensions: 'none', name: 'CL_ABAP_TYPEDESCR', version: 'active' },
    };
    const revalidated = `[cached:revalidated]\n${SOURCE}`;
    for (const [user, enabled, source] of [
      ['alice', true, SOURCE],
      ['bob', false, revalidated],
      ['alice', false, revalidated],
      ['bob', true, revalidated],
    ] as const) {
      const headers = enabled ? preference : {};
      expectLinks(
        result(await rpc(`${user}-viewer-key-for-test`, 'tools/call', params, '/mcp', headers)),
        enabled,
        undefined,
        source,
      );
    }
    expect(cachingLayer.cache.getSource('CLAS', 'CL_ABAP_TYPEDESCR', 'active')?.source).toBe(SOURCE);
    expect(cachingLayer.listActivity().counts).toMatchObject({ source_store: 1, source_hit: 3 });
    const reads = vi.mocked(AdtHttpClient.prototype.get).mock.calls;
    expect(reads).toHaveLength(4);
    for (const read of reads.slice(1)) expect(read[1]).toMatchObject({ 'If-None-Match': 'source-v1' });
    expect(JSON.stringify(reads)).not.toMatch(/adt:\/\/|Arc1-Ide/i);
  });

  it('handles duplicate raw header lines without ambiguity or a sticky preference', async () => {
    await start();
    const token = addUser(['A4H/000']);
    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP test listener');
    for (const [clients, expected] of [
      [['eclipse'], true],
      [['eclipse', 'eclipse'], false],
      [['vscode'], false],
      [['vscode', 'eclipse'], false],
    ] as const) {
      const body = JSON.stringify({
        jsonrpc: '2.0',
        id: ++sequence,
        method: 'tools/call',
        params: {
          name: 'SAPRead',
          arguments: { type: 'CLAS', extensions: 'none', name: 'CL_ABAP_TYPEDESCR' },
        },
      });
      const response = await new Promise<{ status: number; text: string }>((resolve, reject) => {
        const req = httpRequest(
          {
            hostname: '127.0.0.1',
            port: address.port,
            path: '/A4H/000/mcp',
            method: 'POST',
            headers: [
              'Host',
              `127.0.0.1:${address.port}`,
              'Authorization',
              `Bearer ${token}`,
              'Content-Type',
              'application/json',
              'Content-Length',
              String(Buffer.byteLength(body)),
              'Accept',
              'application/json, text/event-stream',
              'MCP-Protocol-Version',
              '2025-11-25',
              ...clients.flatMap((value) => ['Arc1-Ide-Client', value]),
            ],
          },
          (res) => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
              text += chunk;
            });
            res.on('end', () => resolve({ status: res.statusCode!, text }));
            res.on('error', reject);
          },
        );
        req.on('error', reject);
        req.end(body);
      });
      expectLinks(result(response), expected, 'A4H/000');
    }
    expectLinks(await read(token, 'A4H/000', true));
  });

  it.each([true, false])(
    'does not infer link preferences from client identity or a previous initialize (pinned=%s)',
    async (pinned) => {
      await start();
      const token = addUser(['A4H/000']);
      const path = pinned ? '/A4H/000/mcp' : '/multi/mcp';
      const init = await rpc(
        token,
        'initialize',
        {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'Visual Studio Code', version: '1.142.0' },
        },
        path,
        preference,
      );
      expect(init.status).toBe(200);
      expect(init.headers['mcp-session-id']).toBeUndefined();
      expectLinks(
        await read(token, 'A4H/000', pinned, {
          'User-Agent': 'Visual Studio Code/1.142.0',
          'Arc1-Ide-Destinations-V1': 'A4H/000=USER_AGENT_ONLY',
        }),
      );
      const claimedMetadata = await rpc(
        token,
        'tools/call',
        {
          name: 'SAPRead',
          arguments: {
            type: 'CLAS',
            extensions: 'none',
            name: 'CL_ABAP_TYPEDESCR',
            ...(pinned ? {} : { target: 'A4H/000' }),
          },
          // Synthetic tool metadata: real captures did not send clientInfo on legacy tools/call.
          _meta: {
            'io.modelcontextprotocol/clientInfo': { name: 'Visual Studio Code', version: '1.142.0' },
            'vscode.conversationId': 'untrusted-hint',
          },
        },
        path,
        { 'Arc1-Ide-Destinations-V1': 'A4H/000=METADATA_ONLY' },
      );
      expectLinks(result(claimedMetadata));
      // Presentation is an explicit preference, not proof of a particular client binary.
      expectLinks(
        await read(token, 'A4H/000', pinned, {
          ...preference,
          'User-Agent': 'GithubCopilot/1.527.0',
        }),
        true,
        'A4H/000',
      );
      expectLinks(await read(token, 'A4H/000', pinned));
    },
  );

  it.each([true, false])('ignores ordinary clients and removed VS Code mappings (pinned=%s)', async (pinned) => {
    await start();
    const token = addUser(['A4H/000']);
    for (const headers of [
      {},
      { 'User-Agent': 'Eclipse' },
      { 'Arc1-Ide-Destinations-V1': 'A4H/000=DEV' },
      { 'Arc1-Ide-Client': 'claude' },
      { 'Arc1-Ide-Client': 'vscode', 'Arc1-Ide-Destinations-V1': 'A4H/000=DEV' },
      { 'Arc1-Ide-Client': 'vscode', 'Arc1-Ide-Destinations-V1': 'bad' },
    ] as Record<string, string>[])
      expectLinks(await read(token, 'A4H/000', pinned, headers));
    expectLinks(await read(token, 'A4H/000', pinned, preference), true, 'A4H/000');
    // A following request from the same authenticated user has no remembered preference.
    expectLinks(await read(token, 'A4H/000', pinned));
  });

  it.each([true, false])(
    'cannot grant target or read access and never decorates denials (pinned=%s)',
    async (pinned) => {
      await start();
      const token = addUser(['A4H/000']);
      const denied = await rpc(
        token,
        'tools/call',
        {
          name: 'SAPRead',
          arguments: {
            type: 'CLAS',
            extensions: 'none',
            name: 'CL_ABAP_TYPEDESCR',
            ...(pinned ? {} : { target: 'A4H/001' }),
          },
        },
        pinned ? '/A4H/001/mcp' : '/multi/mcp',
        preference,
      );
      if (pinned) expect(denied.status).toBe(404);
      else expect(result(denied).isError).toBe(true);
      expect(denied.text).not.toMatch(/vscode:|adt:/);
      const noRead = addUser(['A4H/000'], []);
      const scopeDenied = await rpc(
        noRead,
        'tools/call',
        {
          name: 'SAPRead',
          arguments: {
            type: 'CLAS',
            extensions: 'none',
            name: 'CL_ABAP_TYPEDESCR',
            ...(pinned ? {} : { target: 'A4H/000' }),
          },
        },
        pinned ? '/A4H/000/mcp' : '/multi/mcp',
        preference,
      );
      expect(scopeDenied.status).toBe(403);
      expect(scopeDenied.text).not.toMatch(/vscode:|adt:/);
      expect(resolveDestination).not.toHaveBeenCalled();
    },
  );

  it('keeps runtime destination-drift refusal ahead of presentation', async () => {
    await start();
    const token = addUser(['A4H/000']);
    const original = resolveDestination.getMockImplementation()!;
    resolveDestination.mockImplementation(async (...args) => {
      const value = await original(...args);
      value.destination.URL = 'https://different.example.test';
      return value;
    });
    for (const pinned of [true, false]) {
      const response = await read(token, 'A4H/000', pinned, preference);
      expect(response.isError).toBe(true);
      expect(JSON.parse(response.content![0].text).error).toBe('TARGET_CONFIG_CHANGED');
      expect(JSON.stringify(response)).not.toMatch(/vscode:|adt:/);
    }
    expect(AdtHttpClient.prototype.get).not.toHaveBeenCalled();
  });

  it('inherits only the admin switch and refuses a valid preference when disabled', async () => {
    const base = { ...CONFIG, ideLinks: 'off' as const, ideSystemId: 'DEV' };
    const registry = makeRegistry(3, [], base);
    expect(
      buildMultiTargetConfig({ ...base, ideLinks: 'eclipse' }, registry.targets[0], { mode: 'pinned' }),
    ).toMatchObject({
      ideLinks: 'eclipse',
      ideSystemId: 'A4H',
    });
    expect(buildAggregateToolSurfaceConfig({ ...base, ideLinks: 'eclipse' }, registry.targets)).toMatchObject({
      ideLinks: 'eclipse',
      ideSystemId: '',
    });
    await start(registry, base);
    const token = addUser(['A4H/000']);
    for (const pinned of [true, false]) expectLinks(await read(token, 'A4H/000', pinned, preference));
  });
});
