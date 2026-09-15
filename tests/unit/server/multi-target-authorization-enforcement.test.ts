/** Real HTTP bearer middleware + SDK transport + request-local MCP server contracts. */
import { EventEmitter } from 'node:events';
import type { XsuaaCredentials } from '@arc-mcp/xsuaa-auth';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toolJson } from '../../../src/handlers/shared.js';
import { canonicalDestinationUrl, opaqueDestinationValue } from '../../../src/server/destination-discovery.js';
import { DestinationRegistry } from '../../../src/server/destination-registry.js';
import { startHttpServer } from '../../../src/server/http.js';
import { logger } from '../../../src/server/logger.js';
import { buildTargetCatalog } from '../../../src/server/multi-target-catalog.js';
import { buildAggregateToolSurfaceConfig, buildMultiTargetConfig } from '../../../src/server/multi-target-runtime.js';
import { createServer } from '../../../src/server/server.js';
import { DEFAULT_CONFIG, type ServerConfig } from '../../../src/server/types.js';

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
      return auth;
    }),
  };
});

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
  multiTargetEndpoints: true,
  multiTargetAuthorization: 'xsuaa-attribute',
  cacheMode: 'none',
  allowDataPreview: true,
  allowFreeSQL: true,
  authRateLimit: 0,
  mcpHttpRateLimit: 0,
};

function makeRegistry(count = 3, sqlClients: number[] = [], config = CONFIG, quarantine: number[] = []) {
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
        sapClient: String(index).padStart(3, '0'),
        description: `SAP target ${index}`,
        hasCloudConnectorLocationId: false,
        arcProperties: {
          'arc1.enabled': quarantine.includes(index) ? 'invalid' : 'true',
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

type Tool = { name: string; inputSchema: { properties: Record<string, any>; required?: string[] } };
type Result = {
  tools?: Tool[];
  instructions?: string;
  content?: Array<{ type: string; text: string }>;
  isError?: boolean;
};
function result(response: request.Response): Result {
  expect(response.status, response.text.slice(0, 200)).toBe(200);
  const line = response.text.split('\n').find((value) => value.startsWith('data: '));
  expect(line).toBeDefined();
  const message = JSON.parse((line as string).slice(6));
  expect(message.error).toBeUndefined();
  return message.result;
}
function payload(value: Result): any {
  expect(value.content?.[0].type).toBe('text');
  return JSON.parse(value.content?.[0].text ?? '{}');
}

describe('opt-in target authorization over the real HTTP/SDK boundary', () => {
  let app: express.Express;
  let sequence = 0;
  const servers: Server[] = [];
  let network: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    verifiedTokens.clear();
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
    expect(network).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function start(registry = makeRegistry(), config = CONFIG, omitProjection = false) {
    await startHttpServer(undefined, config, XSUAA, undefined, {
      registry,
      aggregateFactory: (authorization) => {
        const server = createServer(buildAggregateToolSurfaceConfig(config, registry.targets), {
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
        const server = createServer(buildMultiTargetConfig(config, target), {
          multiTarget: { mode: 'pinned', registry, instanceConfig: config, target, authorization },
        });
        servers.push(server);
        return server;
      },
    });
  }
  function rpc(token: string | undefined, method: string, params?: unknown, path = '/multi/mcp') {
    const call = request(app)
      .post(path)
      .set('Accept', 'application/json, text/event-stream')
      .set('MCP-Protocol-Version', '2025-11-25');
    if (token) call.set('Authorization', `Bearer ${token}`);
    return call.send({ jsonrpc: '2.0', id: ++sequence, method, ...(params ? { params } : {}) });
  }
  async function list(token: string, path?: string) {
    return result(await rpc(token, 'tools/list', undefined, path)).tools as Tool[];
  }
  async function initialize(token: string, path?: string) {
    return result(
      await rpc(
        token,
        'initialize',
        {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'enforcement-test', version: '1' },
        },
        path,
      ),
    );
  }
  async function call(token: string, name: string, args: Record<string, unknown> = {}, path?: string) {
    return result(await rpc(token, 'tools/call', { name, arguments: args }, path));
  }

  it.each([0, 1, 2, 16, 17, 100, 256])('projects initialize/list/catalog for %i granted targets', async (count) => {
    const registry = makeRegistry(256);
    await start(registry);
    const grants = registry.targets.slice(0, count).map((target) => target.target);
    const token = addUser(grants);
    const init = await initialize(token);
    const tools = await list(token);
    expect(tools.some((tool) => tool.name === 'SAPTargets')).toBe(count > 1);
    if (count === 0) {
      expect(tools).toEqual([]);
      expect(init.instructions).toContain('No SAP targets are available to this account');
      expect(init.instructions).not.toContain('A4H/');
      return;
    }
    const executionTools = tools.filter((tool) => tool.name !== 'SAPTargets');
    expect(executionTools.length).toBeGreaterThan(0);
    for (const tool of executionTools) {
      expect(tool.inputSchema.required).toContain('target');
      expect(tool.inputSchema.properties.target.enum).toEqual(count <= 16 ? grants : undefined);
      if (count > 16) expect(tool.inputSchema.properties.target.pattern).toBeDefined();
    }
    if (count === 1) {
      expect(init.instructions).toContain(grants[0]);
      expect(init.instructions).not.toContain(registry.targets[1].target);
    } else {
      const catalog = await call(token, 'SAPTargets');
      expect(payload(catalog).map((entry: { target: string }) => entry.target)).toEqual(grants);
      expect(JSON.stringify(catalog)).not.toMatch(/nextOffset|destinationName|loadedAt/);
    }
  });

  it('isolates disjoint same-email users across concurrent initialize/list/call requests', async () => {
    await start(makeRegistry(4));
    const users = [addUser(['A4H/000', 'A4H/001']), addUser(['A4H/002', 'A4H/003'])];
    await Promise.all(
      Array.from({ length: 12 }, async (_, index) => {
        const owner = index % 2;
        const token = users[owner];
        const expected = owner === 0 ? ['A4H/000', 'A4H/001'] : ['A4H/002', 'A4H/003'];
        const [init, tools, catalog] = await Promise.all([initialize(token), list(token), call(token, 'SAPTargets')]);
        expect(init.instructions).not.toContain('SAP target 0');
        expect(tools.find((tool) => tool.name === 'SAPRead')?.inputSchema.properties.target.enum).toEqual(expected);
        expect(payload(catalog).map((entry: { target: string }) => entry.target)).toEqual(expected);
      }),
    );
  });

  it('projects capabilities from granted targets only, but preserves the selected-target ceiling', async () => {
    await start(makeRegistry(2, [1]));
    const source = addUser(['A4H/000'], ['read', 'data', 'sql']);
    const sql = addUser(['A4H/001'], ['read', 'data', 'sql']);
    const both = addUser(['A4H/000', 'A4H/001'], ['read', 'data', 'sql']);
    expect((await list(source)).map((tool) => tool.name)).not.toContain('SAPQuery');
    expect(
      (await list(source)).find((tool) => tool.name === 'SAPRead')?.inputSchema.properties.type.enum,
    ).not.toContain('TABLE_CONTENTS');
    expect((await list(sql)).map((tool) => tool.name)).toContain('SAPQuery');
    expect((await list(both)).map((tool) => tool.name)).toContain('SAPQuery');
    const denied = await call(both, 'SAPQuery', { target: 'A4H/000', sql: 'SELECT * FROM T000' });
    expect(denied.isError).toBe(true);
    expect(payload(denied).error).toBe('TARGET_POLICY_DENIED');
  });

  it('keeps Admin diagnostics separate from SAP execution grants', async () => {
    await start();
    const token = addUser([], ['read', 'admin']);
    expect((await list(token)).map((tool) => tool.name)).toEqual(['SAPTargets']);
    const catalog = payload(await call(token, 'SAPTargets'));
    expect(catalog.targets).toHaveLength(3);
    expect(catalog.targets.every((target: { granted: boolean }) => !target.granted)).toBe(true);
    expect(catalog.admin.authorization).toMatchObject({ grantMode: 'none', status: 'TARGET_GRANT_MISSING' });
    const direct = await call(token, 'SAPRead', { target: 'A4H/000', type: 'PROG', name: 'ZTEST' });
    expect(payload(direct).error).toBe('TARGET_NOT_AVAILABLE');
    expect((await rpc(token, 'tools/list', undefined, '/A4H/000/mcp')).status).toBe(404);
  });

  it('does not let a hidden SAPTargets call bypass the zero/one-target contract or deny actions', async () => {
    await start();
    for (const grants of [[], ['A4H/000']]) {
      expect(payload(await call(addUser(grants), 'SAPTargets')).error).toBe('UNKNOWN_TOOL');
    }
    await start(makeRegistry(), { ...CONFIG, denyActions: ['SAPTargets'] });
    const admin = addUser('*', ['read', 'admin']);
    expect((await list(admin)).map((tool) => tool.name)).not.toContain('SAPTargets');
    expect(payload(await call(admin, 'SAPTargets')).error).toBe('MULTI_TARGET_OPERATION_FORBIDDEN');
  });

  it('requires explicit target even for a single grant and reaches PP only after authorization', async () => {
    await start();
    const token = addUser(['A4H/000']);
    const args = { type: 'PROG', name: 'ZTEST' };
    expect(payload(await call(token, 'SAPRead', args)).error).toBe('TARGET_REQUIRED');
    expect(payload(await call(token, 'SAPRead', { ...args, target: 'A4H/001' })).error).toBe('TARGET_NOT_AVAILABLE');
    expect(payload(await call(token, 'SAPRead', { ...args, target: 'A4H/000' })).error).toBe('PP_SETUP_FAILED');
    const pinned = await list(token, '/A4H/000/mcp');
    expect(pinned.some((tool) => tool.name === 'SAPTargets')).toBe(false);
    expect(pinned.every((tool) => !tool.inputSchema.required?.includes('target'))).toBe(true);
    expect(payload(await call(token, 'SAPRead', args, '/A4H/000/mcp')).error).toBe('PP_SETUP_FAILED');
  });

  it('checks grants before registry availability on pinned and aggregate calls', async () => {
    await start(
      DestinationRegistry.unavailable(
        { code: 'REGISTRY_DISCOVERY_ERROR', message: 'Operator-only failure' },
        { authorizationMode: 'xsuaa-attribute' },
      ),
    );
    const token = addUser(['A4H/000']);
    const hidden = await rpc(token, 'tools/list', undefined, '/A4H/001/mcp');
    const allowed = await rpc(token, 'tools/list', undefined, '/A4H/000/mcp');
    expect(hidden.status).toBe(404);
    expect(hidden.body).toEqual({ error: 'Target not available' });
    expect(allowed.status).toBe(503);
    const args = { type: 'PROG', name: 'ZTEST' };
    expect(payload(await call(token, 'SAPRead', { ...args, target: 'A4H/001' })).error).toBe('TARGET_NOT_AVAILABLE');
    expect(payload(await call(token, 'SAPRead', { ...args, target: 'A4H/000' })).error).toBe(
      'MULTI_TARGET_REGISTRY_UNAVAILABLE',
    );
    expect(await list(token)).toEqual([]);
  });

  it.each(['/multi/mcp', '/A4H/000/mcp', '/ZZZ/999/mcp', '/authorize'])(
    'keeps real SDK auth semantics on %s',
    async (path) => {
      await start();
      verifiedTokens.set('machine.token.signature', 'machine');
      const noRead = addUser('*', ['data']);
      const expired = addUser('*');
      (verifiedTokens.get(expired) as AuthInfo).expiresAt = 1;
      for (const token of [undefined, 'invalid.token.signature', expired]) {
        const response = await rpc(token, 'tools/list', undefined, path);
        expect(response.status).toBe(401);
        expect(response.headers['www-authenticate']).toContain('resource_metadata=');
        expect(response.headers['cache-control']).toBe('private, no-store, no-transform');
      }
      expect((await rpc(noRead, 'tools/list', undefined, path)).status).toBe(403);
      const machine = await rpc('machine.token.signature', 'tools/list', undefined, path);
      expect(machine.status).toBe(403);
      expect(machine.body).toEqual({
        error: 'forbidden',
        error_description: 'A supported XSUAA user token is required.',
      });
    },
  );

  it('uses the same private request projection for the Copilot alias and explicit route', async () => {
    await start();
    const token = addUser(['A4H/001']);
    const explicit = await rpc(token, 'tools/list');
    const alias = await rpc(token, 'tools/list', undefined, '/authorize');
    expect(result(alias)).toEqual(result(explicit));
    expect(alias.headers['cache-control']).toBe('private, no-store, no-transform');
    expect(explicit.headers['cache-control']).toBe('private, no-store, no-transform');
    const denied = await rpc(token, 'tools/list', undefined, '/A4H/000/mcp');
    expect(denied.headers['cache-control']).toBe('private, no-store, no-transform');
    expect((await request(app).get('/targets')).status).toBe(404);
  });

  it('does not reveal whether an ungranted target exists, including to Admin', async () => {
    await start();
    for (const scopes of [['read'], ['read', 'admin']]) {
      const token = addUser(['A4H/000'], scopes);
      const known = await rpc(token, 'tools/list', undefined, '/A4H/001/mcp');
      const absent = await rpc(token, 'tools/list', undefined, '/ZZZ/999/mcp');
      expect(known.status).toBe(404);
      expect(absent.status).toBe(404);
      expect(known.body).toEqual(absent.body);
      for (const target of ['A4H/001', 'ZZZ/999']) {
        const denied = await call(token, 'SAPRead', { target, type: 'PROG', name: 'ZTEST' });
        expect(denied.isError).toBe(true);
        expect(payload(denied)).toMatchObject({ error: 'TARGET_NOT_AVAILABLE', message: 'Target not available' });
        expect(payload(denied)).not.toHaveProperty('identity');
      }
    }
  });

  it('reprojects renewed tokens immediately without retaining an earlier caller grant', async () => {
    await start();
    const before = addUser(['A4H/000']);
    const after = addUser(['A4H/001']);
    for (const token of [before, after, before, after]) {
      const expected = token === before ? 'A4H/000' : 'A4H/001';
      expect((await list(token)).find((tool) => tool.name === 'SAPRead')?.inputSchema.properties.target.enum).toEqual([
        expected,
      ]);
    }
  });

  it('does not emit token values or raw grants in request audit records', async () => {
    await start();
    const raw = 'UNTRUSTED-RAW-GRANT-MARKER';
    const token = addUser(['*', raw], ['read', 'admin']);
    await initialize(token);
    await list(token);
    await call(token, 'SAPTargets');
    await call(token, 'SAPRead', { target: 'A4H/000', type: 'PROG', name: 'ZTEST' });
    const logs = JSON.stringify([vi.mocked(logger.emitAudit).mock.calls, vi.mocked(logger.info).mock.calls]);
    expect(logs).not.toContain(token);
    expect(logs).not.toContain(raw);
    expect(logs).not.toContain('xsuaaUserAttributes');
    expect(logger.emitAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'target_resolution_failed',
        errorCode: 'TARGET_GRANT_MALFORMED',
        authorizationMode: 'xsuaa-attribute',
        grantMode: 'none',
      }),
    );
    const exact = addUser(['A4H/000', 'A4H/000'], ['read']);
    await rpc(exact, 'tools/list', undefined, '/A4H/002/mcp');
    expect(logger.emitAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'target_resolution_failed',
        errorCode: 'TARGET_NOT_GRANTED',
        authorizationMode: 'xsuaa-attribute',
        grantMode: 'exact',
        exactGrantCount: 1,
      }),
    );
  });

  it('fails closed when a bootstrap factory omits the verified request projection', async () => {
    await start(makeRegistry(), CONFIG, true);
    const token = addUser('*', ['read', 'admin']);
    expect(await list(token)).toEqual([]);
    expect((await initialize(token)).instructions).not.toContain('A4H/');
    expect(payload(await call(token, 'SAPRead', { target: 'A4H/000', type: 'PROG', name: 'ZTEST' })).error).toBe(
      'INSUFFICIENT_SCOPE',
    );
  });

  it('keeps quarantined targets non-executable even when a token grants their exact ID', async () => {
    const registry = makeRegistry(3, [], CONFIG, [1]);
    expect(registry.targets).toHaveLength(2);
    expect(registry.counts.quarantined).toBe(1);
    await start(registry);
    const token = addUser(['A4H/000', 'A4H/001'], ['read', 'admin']);
    expect((await list(token)).find((tool) => tool.name === 'SAPRead')?.inputSchema.properties.target.enum).toEqual([
      'A4H/000',
    ]);
    const quarantine = await rpc(token, 'tools/list', undefined, '/A4H/001/mcp');
    const absent = await rpc(token, 'tools/list', undefined, '/ZZZ/999/mcp');
    expect(quarantine.status).toBe(404);
    expect(quarantine.body).toEqual(absent.body);
    expect(payload(await call(token, 'SAPRead', { target: 'A4H/001', type: 'PROG', name: 'ZTEST' })).error).toBe(
      'TARGET_NOT_AVAILABLE',
    );
    const catalog = payload(await call(token, 'SAPTargets'));
    expect(catalog.admin.counts.quarantined).toBe(1);
    expect(catalog.targets.map((target: { target: string }) => target.target)).not.toContain('A4H/001');
  });

  it.each([
    { grants: ['A4H/000', 'A4H/*'], status: 'valid' },
    { grants: ['*'], status: 'missing' },
    { grants: ['*'], status: 'invalid' },
    { grants: ['*'], status: 'limit_exceeded' },
  ])('fails closed for malformed/missing/limited grants: $status', async ({ grants, status }) => {
    await start();
    const token = addUser(grants, ['read'], status);
    expect(await list(token)).toEqual([]);
    expect(payload(await call(token, 'SAPRead', { target: 'A4H/000', type: 'PROG', name: 'ZTEST' })).error).toBe(
      'TARGET_NOT_AVAILABLE',
    );
  });

  it('supports wildcard execution grants without making wildcard a tool input', async () => {
    await start();
    const token = addUser('*');
    const tools = await list(token);
    expect(tools.find((tool) => tool.name === 'SAPRead')?.inputSchema.properties.target.enum).toEqual([
      'A4H/000',
      'A4H/001',
      'A4H/002',
    ]);
    expect(payload(await call(token, 'SAPRead', { target: '*', type: 'PROG', name: 'ZTEST' })).error).toBe(
      'INVALID_TARGET',
    );
    expect(payload(await call(token, 'SAPRead', { target: 'A4H/002', type: 'PROG', name: 'ZTEST' })).error).toBe(
      'PP_SETUP_FAILED',
    );
  });

  it('rejects paging in enforced mode and preserves the legacy catalog text/schema exactly', async () => {
    await start();
    const admin = addUser([], ['read', 'admin']);
    expect(payload(await call(admin, 'SAPTargets', { offset: 0 })).error).toBe('INVALID_ARGUMENTS');
    const legacy = { ...CONFIG, multiTargetAuthorization: 'legacy' as const };
    const registry = makeRegistry(17, [], legacy);
    await start(registry, legacy);
    const tools = await list(admin);
    expect(tools.find((tool) => tool.name === 'SAPTargets')?.inputSchema.properties.offset).toBeDefined();
    const response = await call(admin, 'SAPTargets', { offset: 0 });
    expect(response.content?.[0].text).toBe(toolJson(buildTargetCatalog(registry, { admin: true, offset: 0 })));
    expect(tools.some((tool) => tool.name === 'SAPRead')).toBe(true);
  });
});
