/** Repeated MCP calls through a real loopback Connectivity proxy (#1085). */
import { createServer as createProxy, type Server as HttpServer, type RequestListener } from 'node:http';
import type { BTPProxyConfig } from '@arc-mcp/xsuaa-auth/btp';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { afterEach, expect, it, vi } from 'vitest';
import * as adtFeatures from '../../../src/adt/features.js';
import { resetCachedFeatures } from '../../../src/handlers/feature-cache.js';
import { Logger } from '../../../src/server/logger.js';
import { PerUserTransportPool } from '../../../src/server/per-user-transport.js';
import { createAndStartServer } from '../../../src/server/server.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { featuresOff } from '../handlers/handler-test-config.js';

const boundary = vi.hoisted(() => ({
  factory: undefined as (() => Server) | undefined,
  resolve: vi.fn(),
  lookup: vi.fn(),
}));
vi.mock('@arc-mcp/xsuaa-auth/btp', () => ({
  parseVCAPServices: () => ({}),
  resolveBTPDestination: boundary.resolve,
  lookupDestinationWithUserToken: boundary.lookup,
  createConnectivityProxy: vi.fn(),
}));
vi.mock('../../../src/server/http.js', () => ({
  startHttpServer: vi.fn(async (factory: () => Server) => {
    boundary.factory = factory;
    return { close: vi.fn() };
  }),
}));
vi.mock('../../../src/server/shutdown.js', () => ({ registerShutdownHandlers: vi.fn(), closeHttpServer: vi.fn() }));

// Resolve the asynchronous module mock before the first parallel dynamic imports.
await import('@arc-mcp/xsuaa-auth/btp');

const servers: HttpServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  boundary.lookup.mockReset();
  resetCachedFeatures();
});

function userToken(sub: string, exp = Math.floor(Date.now() / 1000) + 3600) {
  return `header.${Buffer.from(JSON.stringify({ sub, exp, iss: 'test-tenant', user_name: 'same-display-name' })).toString('base64url')}.signature`;
}

async function call(token: string, name = 'SAPRead', args: Record<string, unknown> = { type: 'PROG', name: 'ZTEST' }) {
  const server = boundary.factory!();
  const handlers = (server as unknown as { _requestHandlers: Map<string, (...args: unknown[]) => unknown> })
    ._requestHandlers;
  const authInfo: AuthInfo = {
    token,
    clientId: 'test-client',
    scopes: ['read', 'write'],
    extra: { userName: 'same-display-name' },
  };
  try {
    return (await handlers.get('tools/call')!(
      { method: 'tools/call', params: { name, arguments: args } },
      { authInfo },
    )) as { isError?: boolean; content: Array<{ text: string }> };
  } finally {
    await server.close();
  }
}

async function setup() {
  const audit = vi.spyOn(Logger.prototype, 'emitAudit');
  let issued = 0;
  const requests: Array<{
    cookie: string;
    credential: string;
    path: string;
    method: string;
    token: string;
    proxyAuth: string;
    authorization: string | undefined;
  }> = [];
  const custom: { reply?: RequestListener } = {};
  const proxy = createProxy((req, res) => {
    const cookie = req.headers.cookie ?? '';
    const credential = String(req.headers['sap-connectivity-authentication'] ?? '');
    requests.push({
      cookie,
      credential,
      path: req.url ?? '',
      method: req.method ?? '',
      token: String(req.headers['x-csrf-token'] ?? ''),
      proxyAuth: String(req.headers['proxy-authorization'] ?? ''),
      authorization: req.headers.authorization,
    });
    if (custom.reply) return custom.reply(req, res);
    if (!cookie.includes('SAP_SESSIONID')) res.setHeader('set-cookie', `SAP_SESSIONID_A4H_001=S${++issued}; path=/`);
    res.setHeader('x-csrf-token', 'T');
    res.end('REPORT ztest.');
  });
  servers.push(proxy);
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const address = proxy.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
  const btpProxy: BTPProxyConfig = {
    protocol: 'http',
    host: '127.0.0.1',
    port: address.port,
    getProxyToken: async () => 'service-token',
  };
  boundary.resolve.mockResolvedValue({
    url: 'http://sap.invalid:8000',
    username: 'TECH',
    password: 'shared-secret',
    client: '001',
    proxy: btpProxy,
  });
  boundary.lookup.mockImplementation(async (_config, _destination, token) => ({
    destination: {
      Name: 'PP',
      URL: 'http://sap.invalid:8000',
      ProxyType: 'OnPremise',
      Authentication: 'PrincipalPropagation',
    },
    authTokens: { sapConnectivityAuth: `Bearer ${token}` },
  }));
  vi.stubEnv('SAP_BTP_DESTINATION', 'SHARED');
  vi.stubEnv('SAP_BTP_PP_DESTINATION', 'PP');
  vi.spyOn(adtFeatures, 'probeFeatures').mockResolvedValue({
    ...featuresOff(),
    abapRelease: '758',
    systemType: 'onprem',
  });
  const startup = await createAndStartServer({
    ...DEFAULT_CONFIG,
    ppEnabled: true,
    ppStrict: true,
    ppStrictExplicit: true,
    cacheMode: 'none',
    transport: 'http-streamable',
    logLevel: 'error',
  });
  await startup.close();
  return { requests, issued: () => issued, btpProxy, custom, audit };
}

it('reuses one login across separate tool calls for the same PP credential', async () => {
  const sap = await setup();
  const token = userToken('alice');
  for (let i = 0; i < 4; i++) {
    const result = await call(token);
    expect(result.isError, result.content[0]?.text).not.toBe(true);
  }
  expect(sap.issued()).toBe(1);
  expect(
    sap.audit.mock.calls
      .map(([event]) => event)
      .filter((event) => event.event === 'auth_pp_created')
      .map((event) => event.transportReuse),
  ).toEqual(['pooled-new', 'pooled-reused', 'pooled-reused', 'pooled-reused']);
  expect(boundary.lookup).toHaveBeenCalledTimes(4); // No cached authorization decision.
  expect(sap.requests.filter((request) => request.cookie === '')).toHaveLength(1);
  expect(sap.requests.every((request) => request.credential === `Bearer ${token}`)).toBe(true);
  expect(
    sap.requests.every(
      (request) => request.proxyAuth === 'Bearer service-token' && request.authorization === undefined,
    ),
  ).toBe(true);
});

it('coordinates cold concurrent calls across fresh clients and retains separate stateful contexts', async () => {
  const sap = await setup();
  const pool = new PerUserTransportPool(600_000);
  const token = userToken('alice');
  const config = {
    baseUrl: 'http://sap.invalid:8000',
    client: '001',
    btpProxy: sap.btpProxy,
    sapConnectivityAuth: `Bearer ${token}`,
  };
  const clients = Array.from({ length: 4 }, () => pool.client(config, 'PP').client);
  await Promise.all(clients.map((client) => client.http.get('/read')));
  expect(sap.issued()).toBe(1);

  // A stateless read's stray application cookie must not be inherited by a new write.
  sap.custom.reply = (_req, res) => {
    res.setHeader('set-cookie', 'sap-contextid=STALE; path=/');
    res.end('ok');
  };
  await clients[0].http.get('/stray-context');
  let contexts = 0;
  sap.custom.reply = (req, res) => {
    if (req.url?.includes('_action=LOCK')) res.setHeader('set-cookie', `sap-contextid=C${++contexts}; path=/`);
    res.end('ok');
  };
  await Promise.all(
    clients.slice(0, 2).map((client, i) =>
      client.http.withStatefulSession(async (session) => {
        await session.post(`/object/${i}?_action=LOCK`);
        await session.put(`/object/${i}`, 'test');
        await session.post(`/object/${i}?_action=UNLOCK`);
      }),
    ),
  );
  for (const lock of sap.requests.filter((r) => r.path.includes('_action=LOCK')))
    expect(lock.cookie).not.toContain('sap-contextid');
  const writes = sap.requests.filter((r) => r.method === 'PUT');
  expect(writes).toHaveLength(2);
  expect(new Set(writes.map((r) => /sap-contextid=C\d/.exec(r.cookie)?.[0])).size).toBe(2);
  for (const write of writes) {
    expect(write.cookie).toContain('SAP_SESSIONID_A4H_001=S1');
    expect(write.token).toBe('T');
    const unlock = sap.requests.find(
      (r) =>
        new URL(r.path).pathname === new URL(write.path).pathname &&
        new URL(r.path).searchParams.get('_action') === 'UNLOCK',
    );
    expect(unlock?.cookie).toBe(write.cookie);
  }
  await pool.client(config, 'PP').client.http.get('/after');
  expect(sap.requests.at(-1)?.cookie).toBe('SAP_SESSIONID_A4H_001=S1; sap-contextid=STALE');
});

it('keeps an in-flight write and its late cookies isolated when the login is renewed', async () => {
  const sap = await setup();
  let elapsed = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
  const pool = new PerUserTransportPool(1000);
  const token = userToken('alice');
  const config = {
    baseUrl: 'http://sap.invalid:8000',
    client: '001',
    btpProxy: sap.btpProxy,
    sapConnectivityAuth: `Bearer ${token}`,
  };
  const old = pool.client(config, 'PP').client;
  await old.http.get('/read');
  let entered!: () => void;
  const writing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  sap.custom.reply = (req, res) => {
    if (req.method === 'PUT') {
      release = () => {
        res.setHeader('set-cookie', 'SAP_SESSIONID_A4H_001=OLD_LATE; path=/');
        res.end('saved');
      };
      entered();
      return;
    }
    if (req.url?.includes('_action=LOCK')) res.setHeader('set-cookie', 'sap-contextid=C1; path=/');
    else if (!req.headers.cookie) res.setHeader('set-cookie', 'SAP_SESSIONID_A4H_001=NEW; path=/');
    res.end('ok');
  };
  const write = old.http.withStatefulSession(async (session) => {
    await session.post('/object?_action=LOCK');
    await session.put('/object', 'test');
    await session.post('/object?_action=UNLOCK');
  });
  await writing;
  try {
    elapsed = 1000;
    await pool.client(config, 'PP').client.http.get('/new');
  } finally {
    release();
  }
  await write;
  await pool.client(config, 'PP').client.http.get('/verify');
  expect(sap.requests.find((r) => new URL(r.path).pathname === '/new')?.cookie).toBe('');
  const unlock = sap.requests.find((r) => r.path.includes('_action=UNLOCK'));
  expect(unlock?.cookie).toContain('sap-contextid=C1');
  expect(unlock?.cookie).toContain('SAP_SESSIONID_A4H_001=OLD_LATE');
  expect(unlock?.token).toBe('T');
  expect(sap.requests.at(-1)?.cookie).toBe('SAP_SESSIONID_A4H_001=NEW');
});

it('isolates users with identical display names and fails closed after a warm exchange fails', async () => {
  const sap = await setup();
  const alice = userToken('alice');
  const bob = userToken('bob');
  for (const token of [alice, bob, alice, bob]) expect((await call(token)).isError).not.toBe(true);
  expect(sap.issued()).toBe(2);
  const aliceCookies = sap.requests.filter((r) => r.credential === `Bearer ${alice}`).map((r) => r.cookie);
  const bobCookies = sap.requests.filter((r) => r.credential === `Bearer ${bob}`).map((r) => r.cookie);
  expect(aliceCookies).toEqual(['', 'SAP_SESSIONID_A4H_001=S1']);
  expect(bobCookies).toEqual(['', 'SAP_SESSIONID_A4H_001=S2']);
  const before = sap.requests.length;
  boundary.lookup.mockRejectedValue(new Error('exchange unavailable'));
  expect((await call(alice)).isError).toBe(true);
  expect(sap.requests).toHaveLength(before);
});
