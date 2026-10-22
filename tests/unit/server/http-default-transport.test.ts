/**
 * HTTP mode builds an MCP Server per request (createAndStartServer → startHttpServer factory). The shared
 * identity's SAP login (cookies, CSRF token) must outlive a request; AdtClient caches must not. Adapted
 * from the #871 review reproduction: a structure replaced by a transparent table between calls must be
 * re-resolved (issue #285), and SAP_ALLOWED_PACKAGES subtree rules must see a fresh package hierarchy.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BTPConfig } from '@arc-mcp/xsuaa-auth/btp';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { afterEach, expect, it, vi } from 'vitest';
import { Semaphore } from '../../../src/adt/semaphore.js';
import { DEFAULT_CONFIG, type ServerConfig } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { featuresOff } from '../handlers/handler-test-config.js';
import { mockFetch } from '../handlers/setup-undici-mock.js';

const runtime = vi.hoisted(() => ({ factory: undefined as (() => Server) | undefined }));
vi.mock('../../../src/server/http.js', () => ({
  startHttpServer: vi.fn(async (factory: () => Server) => {
    runtime.factory = factory;
    return { close: vi.fn() };
  }),
}));
vi.mock('../../../src/server/shutdown.js', () => ({ registerShutdownHandlers: vi.fn(), closeHttpServer: vi.fn() }));
vi.mock('@arc-mcp/xsuaa-auth/btp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@arc-mcp/xsuaa-auth/btp')>()),
  lookupDestinationWithUserToken: vi.fn(),
  resolveBTPDestination: vi.fn(),
  parseVCAPServices: vi.fn(),
}));

const { lookupDestinationWithUserToken, parseVCAPServices, resolveBTPDestination } = await import(
  '@arc-mcp/xsuaa-auth/btp'
);
const { AdtHttpClient } = await import('../../../src/adt/http.js');
const { PerUserTransportPool } = await import('../../../src/server/per-user-transport.js');
const { createAndStartServer, createServer, SHARED_TRANSPORT_MAX_AGE_MS } = await import(
  '../../../src/server/server.js'
);
const adtFeatures = await import('../../../src/adt/features.js');
const { resetCachedFeatures, setCachedFeatures } = await import('../../../src/handlers/feature-cache.js');

async function callTool(server: Server, name: string, args: Record<string, unknown>, authInfo?: AuthInfo) {
  const handlers = (server as unknown as { _requestHandlers: Map<string, (...args: unknown[]) => unknown> })
    ._requestHandlers;
  try {
    return (await handlers.get('tools/call')!(
      { method: 'tools/call', params: { name, arguments: args } },
      { authInfo },
    )) as { isError?: boolean; content: Array<{ text: string }> };
  } finally {
    await server.close();
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.mocked(lookupDestinationWithUserToken).mockReset();
  mockFetch.mockReset();
  resetCachedFeatures();
});

/** Start the real HTTP factory against a mocked 7.50-like SAP; ZSWAP lives in `pkg` (a child of ZROOT). */
async function startFactory(allowedPackages: string[], pkg: string) {
  vi.spyOn(adtFeatures, 'probeFeatures').mockResolvedValue({
    ...featuresOff(),
    abapRelease: '750',
    systemType: 'onprem',
    discoveryMap: new Map([['/sap/bc/adt/ddic/structures', ['application/*']]]),
  });
  const sap = {
    type: 'TABL/DS',
    inAllowedTree: true,
    calls: [] as Array<{ method: string; url: string; cookie: string }>,
  };
  mockFetch.mockImplementation(async (url: string, options: { method?: string; headers?: Record<string, string> }) => {
    const method = options.method ?? 'GET';
    sap.calls.push({ method, url: String(url), cookie: options.headers?.Cookie ?? '' });
    const login = ['SAP_SESSIONID_A4H_001=S1; path=/'];
    if (String(url).includes('/informationsystem/search?')) {
      return mockResponse(
        200,
        `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/structures/ZSWAP" adtcore:type="${sap.type}" adtcore:name="ZSWAP"/></adtcore:objectReferences>`,
        {},
        login,
      );
    }
    if (String(url).includes('/repository/nodestructure') && String(url).includes('parent_name=ZROOT')) {
      return mockResponse(
        200,
        `<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><TREE_CONTENT>${sap.inAllowedTree ? `<SEU_ADT_REPOSITORY_OBJ_NODE><OBJECT_TYPE>DEVC/K</OBJECT_TYPE><OBJECT_NAME>${pkg}</OBJECT_NAME></SEU_ADT_REPOSITORY_OBJ_NODE>` : ''}</TREE_CONTENT></DATA></asx:values></asx:abap>`,
        { 'x-csrf-token': 'T' },
        login,
      );
    }
    if (String(url).includes('/repository/nodestructure')) return mockResponse(200, '', { 'x-csrf-token': 'T' });
    if (String(url).includes('_action=LOCK')) {
      return mockResponse(200, '<asx:values><LOCK_HANDLE>LH7</LOCK_HANDLE><CORRNR></CORRNR></asx:values>', {}, login);
    }
    return mockResponse(
      200,
      `<adtcore:object xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="${pkg}"/></adtcore:object>`,
      { 'x-csrf-token': 'T' },
      login,
    );
  });

  const startup = await createAndStartServer({
    ...DEFAULT_CONFIG,
    url: 'http://sap:8000',
    username: 'admin',
    password: 'secret',
    allowWrites: true,
    allowedPackages,
    lintBeforeWrite: false,
    cacheMode: 'none',
    transport: 'http-streamable',
  });
  await startup.close();
  const callTable = async (action: 'delete' | 'update') => {
    const source = "@EndUserText.label : 'Changed'\ndefine type zswap { field1 : abap.char(1); }";
    return callTool(runtime.factory!(), 'SAPWrite', { action, type: 'TABL', name: 'ZSWAP', source });
  };
  return { sap, callTable };
}

it('shares the SAP login across HTTP requests but re-resolves TABL routes per request', async () => {
  const { sap, callTable } = await startFactory(['*'], '$TMP');

  const deleted = await callTable('delete');
  expect(deleted.isError, deleted.content[0]?.text).not.toBe(true);

  // ZSWAP is recreated as a transparent table in SE11 before the next, independent tool call.
  sap.type = 'TABL/DT';
  sap.calls.length = 0;
  const updated = await callTable('update');

  expect(sap.calls[0]?.cookie).toContain('SAP_SESSIONID_A4H_001=S1');
  expect(sap.calls.filter((c) => c.url.includes('/informationsystem/search?'))).toHaveLength(1);
  expect(sap.calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  expect(updated.isError).toBe(true);
  expect(updated.content[0]?.text).toContain('Use SE11');
});

it('resolves the SAP_ALLOWED_PACKAGES subtree afresh for every HTTP request', async () => {
  // A package re-parented in SAP must affect the next request, not wait out a process-wide cache TTL.
  const { sap, callTable } = await startFactory(['ZROOT/**'], 'ZCHILD');
  const hierarchyFetches = () => sap.calls.filter((c) => c.url.includes('/repository/nodestructure')).length;

  expect((await callTable('update')).isError).not.toBe(true);
  expect(hierarchyFetches()).toBeGreaterThan(0);
  sap.inAllowedTree = false;
  sap.calls.length = 0;
  const denied = await callTable('update');
  expect(denied.isError).toBe(true);
  expect(denied.content[0]?.text).toContain("Operations on package 'ZCHILD' are blocked");
  expect(hierarchyFetches()).toBeGreaterThan(0);
  expect(sap.calls.some((c) => c.method === 'PUT' || c.url.includes('_action=LOCK'))).toBe(false);
});

it('keeps the shared SAP login out of PP requests and never falls back after an exchange failure', async () => {
  vi.stubEnv('SAP_BTP_PP_DESTINATION', 'PER_USER');
  setCachedFeatures({ ...featuresOff(), abapRelease: '758', systemType: 'onprem' });
  const config = {
    ...DEFAULT_CONFIG,
    url: 'http://sap:8000',
    username: 'TECH',
    password: 'secret',
    ppEnabled: true,
    ppStrict: false,
    ppStrictExplicit: true,
    cacheMode: 'none' as const,
  };
  const defaultHttp = new AdtHttpClient({ baseUrl: config.url, username: 'TECH', password: 'secret' });
  // Only Cloud Connector credentials are pooled; this OAuth2UserTokenExchange route stays request-local.
  const perUserTransports = new PerUserTransportPool(SHARED_TRANSPORT_MAX_AGE_MS);
  mockFetch.mockResolvedValue(
    mockResponse(200, 'REPORT ztest.', {}, [
      'SAP_SESSIONID_A4H_001=shared-session; path=/',
      'MYSAPSSO2=shared-ticket; path=/',
    ]),
  );
  await defaultHttp.get('/sap/bc/adt/programs/programs/ZTEST/source/main');
  const callAs = (user: string) =>
    callTool(
      createServer(config, { defaultHttp, perUserTransports, btpConfig: {} as BTPConfig }),
      'SAPRead',
      { type: 'PROG', name: 'ZTEST' },
      {
        token: `header.${Buffer.from(JSON.stringify({ user_name: user })).toString('base64url')}.signature`,
        clientId: user,
        scopes: ['read'],
        extra: { userName: user },
      },
    );

  // The same SAP host makes the Cookie assertion meaningful; a different destination would hide leakage.
  for (const user of ['ALICE', 'BOB']) {
    vi.mocked(lookupDestinationWithUserToken).mockResolvedValue({
      destination: {
        Name: 'PER_USER',
        URL: config.url,
        Type: 'HTTP',
        Authentication: 'OAuth2UserTokenExchange',
        ProxyType: 'Internet',
        User: '',
        Password: '',
      },
      authTokens: { bearerToken: `token-${user}` },
    });
    mockFetch.mockClear();
    mockFetch.mockResolvedValue(mockResponse(200, 'REPORT ztest.', {}, [`SAP_SESSIONID_A4H_001=${user}; path=/`]));
    const result = await callAs(user);
    expect(result.isError, result.content[0]?.text).not.toBe(true);
    expect(mockFetch).toHaveBeenCalled();
    for (const [, options] of mockFetch.mock.calls) {
      expect(options.headers.Authorization).toBe(`Bearer token-${user}`);
      expect(options.headers.Cookie ?? '').not.toMatch(/shared-session|shared-ticket/);
      expect(options.headers.Cookie ?? '').not.toContain(user === 'ALICE' ? 'BOB' : 'ALICE');
    }
  }
  expect(perUserTransports.size).toBe(0);
  vi.mocked(lookupDestinationWithUserToken).mockRejectedValue(new Error('exchange unavailable'));
  mockFetch.mockClear();
  const failed = await callAs('CAROL');
  expect(failed.isError).toBe(true);
  expect(failed.content[0]?.text).toContain('Principal propagation failed');
  expect(mockFetch).not.toHaveBeenCalled();

  // PP also must not replace the shared identity's cookies with a per-user login.
  await defaultHttp.get('/sap/bc/adt/programs/programs/ZTEST/source/main');
  expect(mockFetch.mock.calls[0]?.[1].headers.Cookie).toContain('shared-session');
  expect(mockFetch.mock.calls[0]?.[1].headers.Cookie).toContain('shared-ticket');
});

it('replaces an aged shared transport for new requests while previously created requests retain theirs', async () => {
  let logins = 0;
  mockFetch.mockImplementation(async (_url: string, options: { headers?: Record<string, string> }) =>
    mockResponse(
      200,
      'REPORT ztest.',
      {},
      options.headers?.Cookie?.includes('SAP_SESSIONID') ? [] : [`SAP_SESSIONID_A4H_001=S${++logins}; path=/`],
    ),
  );
  const f = await startRotationFactory();
  /** Inspect this tool's source request, excluding any still-finishing startup auth probe. */
  const firstCookie = async (server = runtime.factory!()) => {
    mockFetch.mockClear();
    const result = await callTool(server, 'SAPRead', { type: 'PROG', name: 'ZTEST' });
    expect(result.isError, result.content[0]?.text).not.toBe(true);
    const sourceCalls = mockFetch.mock.calls.filter(
      ([url]) => new URL(String(url)).pathname === '/sap/bc/adt/programs/programs/ZTEST/source/main',
    );
    expect(sourceCalls).toHaveLength(1);
    return String(sourceCalls[0]?.[1].headers.Cookie ?? '');
  };

  expect(await firstCookie()).toBe('');
  const reused = await firstCookie();
  expect(reused).toMatch(/SAP_SESSIONID_A4H_001=S\d/);
  const running = runtime.factory!(); // constructed before rollover, dispatched afterward

  f.advance(SHARED_TRANSPORT_MAX_AGE_MS - 1);
  expect(await firstCookie()).toBe(reused);
  f.advance(1);
  expect(await firstCookie()).toBe('');
  expect(await firstCookie(running)).toBe(reused);
});

it('keeps a PP credential without a Cloud Connector route request-local', async () => {
  vi.stubEnv('SAP_BTP_DESTINATION', 'SHARED');
  vi.stubEnv('SAP_BTP_PP_DESTINATION', 'PER_USER');
  vi.mocked(resolveBTPDestination).mockResolvedValue({
    url: 'http://sap:8000',
    username: 'TECH',
    password: 'secret',
    client: '001',
    proxy: null,
  } as Awaited<ReturnType<typeof resolveBTPDestination>>);
  vi.mocked(parseVCAPServices).mockReturnValue({} as BTPConfig);
  vi.mocked(lookupDestinationWithUserToken).mockImplementation(async (_btp, _name, userJwt) => ({
    destination: {
      Name: 'PER_USER',
      URL: 'http://sap:8000',
      Type: 'HTTP',
      Authentication: 'PrincipalPropagation',
      ProxyType: 'Internet',
      User: '',
      Password: '',
    },
    authTokens: { sapConnectivityAuth: `Bearer ${userJwt}` },
  }));
  let logins = 0;
  mockFetch.mockImplementation(async (_url: string, options: { headers?: Record<string, string> }) =>
    mockResponse(
      200,
      'REPORT ztest.',
      {},
      options.headers?.Cookie?.includes('SAP_SESSIONID') ? [] : [`SAP_SESSIONID_A4H_001=S${++logins}; path=/`],
    ),
  );
  const f = await startRotationFactory({ ppEnabled: true, ppStrict: false, ppStrictExplicit: true });
  const jwt = (user: string, issued: number) =>
    `header.${Buffer.from(JSON.stringify({ user_name: user, iat: issued, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.signature`;
  /** Cookie on this user's source request; the startup probe and other identities are excluded. */
  const cookieAs = async (token: string) => {
    mockFetch.mockClear();
    const user = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()).user_name as string;
    const result = await callTool(
      runtime.factory!(),
      'SAPRead',
      { type: 'PROG', name: 'ZTEST' },
      { token, clientId: user, scopes: ['read'], extra: { userName: user } },
    );
    expect(result.isError, result.content[0]?.text).not.toBe(true);
    const sourceCalls = mockFetch.mock.calls.filter(
      ([url, options]) =>
        new URL(String(url)).pathname === '/sap/bc/adt/programs/programs/ZTEST/source/main' &&
        options.headers['SAP-Connectivity-Authentication'] === `Bearer ${token}`,
    );
    expect(sourceCalls).toHaveLength(1);
    expect(sourceCalls[0]?.[1].headers.Authorization).toBeUndefined();
    return String(sourceCalls[0]?.[1].headers.Cookie ?? '');
  };
  const alice = jwt('ALICE', 1);

  expect(await cookieAs(alice)).toBe('');
  const aliceLogin = await cookieAs(alice);
  expect(aliceLogin).toBe('');
  // Another user, and the same user with a refreshed token, never receive this login.
  expect(await cookieAs(jwt('BOB', 1))).toBe('');
  expect(await cookieAs(jwt('ALICE', 2))).toBe('');
  expect(await cookieAs(alice)).toBe(aliceLogin);

  f.advance(SHARED_TRANSPORT_MAX_AGE_MS);
  expect(await cookieAs(alice)).toBe('');
  expect(await cookieAs(alice)).toBe('');
});

/** Factory with production dispatch; SAP responses are supplied by each regression below. */
async function startRotationFactory(overrides: Partial<ServerConfig> = {}) {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.spyOn(adtFeatures, 'probeFeatures').mockResolvedValue({
    ...featuresOff(),
    abapRelease: '758',
    systemType: 'onprem',
  });
  const startup = await createAndStartServer({
    ...DEFAULT_CONFIG,
    url: 'http://sap:8000',
    username: 'TECH',
    password: 'secret',
    cacheMode: 'none',
    transport: 'http-streamable',
    allowWrites: true,
    allowedPackages: ['$TMP'],
    lintBeforeWrite: false,
    ...overrides,
  });
  await startup.close();
  return {
    read: (name: string) => callTool(runtime.factory!(), 'SAPRead', { type: 'PROG', name }),
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it('shares the SAP concurrency limit across transport rollover', async () => {
  const entered = deferred();
  const resume = deferred();
  const requests: string[] = [];
  mockFetch.mockImplementation(async (url: string) => {
    requests.push(String(url));
    if (String(url).includes('/ZPENDING/')) {
      entered.resolve();
      await resume.promise;
    }
    return mockResponse(200, 'REPORT ztest.', { 'x-csrf-token': 'T' });
  });
  const f = await startRotationFactory({ maxConcurrent: 1 });
  expect((await f.read('ZWARM')).isError).not.toBe(true);
  const pending = f.read('ZPENDING');
  await entered.promise;
  f.advance(SHARED_TRANSPORT_MAX_AGE_MS);
  const beforeReplacement = requests.length;
  const atLimiter = deferred();
  let waiting = 0;
  const acquire = Semaphore.prototype.acquire;
  vi.spyOn(Semaphore.prototype, 'acquire').mockImplementationOnce(function (this: Semaphore, signal) {
    const slot = acquire.call(this, signal);
    waiting = this.waiting;
    atLimiter.resolve();
    return slot;
  });
  const replacement = f.read('ZNEW');
  try {
    // Observe the real limiter's queue, independent of delays before or after acquisition.
    await atLimiter.promise;
    expect(waiting).toBe(1);
    expect(requests).toHaveLength(beforeReplacement);
  } finally {
    resume.resolve();
    const results = await Promise.all([pending, replacement]);
    for (const result of results) expect(result.isError, result.content[0]?.text).not.toBe(true);
  }
  expect(requests.some((url) => url.includes('/ZNEW/'))).toBe(true);
});

it('keeps a delayed old response out of the replacement transport', async () => {
  const entered = deferred();
  const resume = deferred();
  const cookies = new Map<string, string>();
  let generation = 'OLD';
  mockFetch.mockImplementation(async (url: string, options: { headers?: Record<string, string> }) => {
    const name = new URL(String(url)).pathname.split('/')[6] ?? '';
    cookies.set(name, options.headers?.Cookie ?? '');
    if (name === 'ZPENDING') {
      entered.resolve();
      await resume.promise;
      return mockResponse(200, 'REPORT zpending.', {}, ['SAP_SESSIONID_A4H_001=OLD_LATE; path=/']);
    }
    return mockResponse(200, 'REPORT ztest.', { 'x-csrf-token': 'T' }, [`SAP_SESSIONID_A4H_001=${generation}; path=/`]);
  });
  const f = await startRotationFactory();
  expect((await f.read('ZWARM')).isError).not.toBe(true);
  const pending = f.read('ZPENDING');
  await entered.promise;
  try {
    f.advance(SHARED_TRANSPORT_MAX_AGE_MS);
    generation = 'NEW';
    expect((await f.read('ZNEW')).isError).not.toBe(true);
    expect(cookies.get('ZNEW')).toBe('');
  } finally {
    resume.resolve();
  }
  expect((await pending).isError).not.toBe(true);
  expect((await f.read('ZVERIFY')).isError).not.toBe(true);
  expect(cookies.get('ZVERIFY')).toBe('SAP_SESSIONID_A4H_001=NEW');
});

it('preserves lock, CSRF token and context through UNLOCK when a PUT crosses rollover', async () => {
  const entered = deferred();
  const resume = deferred();
  const seen: Array<{ url: string; cookie: string; token: string }> = [];
  let generation = 'OLD';
  mockFetch.mockImplementation(async (url: string, options: { method?: string; headers?: Record<string, string> }) => {
    seen.push({
      url: String(url),
      cookie: options.headers?.Cookie ?? '',
      token: options.headers?.['X-CSRF-Token'] ?? '',
    });
    if (String(url).includes('_action=LOCK')) {
      return mockResponse(200, '<asx:values><LOCK_HANDLE>LOCK_OLD</LOCK_HANDLE><CORRNR></CORRNR></asx:values>', {}, [
        'sap-contextid=CONTEXT_OLD; path=/',
      ]);
    }
    if (options.method === 'PUT') {
      entered.resolve();
      await resume.promise;
      return mockResponse(200, '', {}, ['SAP_SESSIONID_A4H_001=OLD_LATE; path=/']);
    }
    if (String(url).includes('_action=UNLOCK')) return mockResponse(200, '');
    if (String(url).includes('/core/http/sessions')) return mockResponse(200, '', {}, ['sap-contextid=0; path=/']);
    const body = new URL(String(url)).pathname.endsWith('/ZWRITE')
      ? '<adtcore:object xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="$TMP"/></adtcore:object>'
      : 'REPORT ztest.';
    return mockResponse(200, body, { 'x-csrf-token': `TOKEN_${generation}` }, [
      `SAP_SESSIONID_A4H_001=${generation}; path=/`,
    ]);
  });
  const f = await startRotationFactory();
  expect((await f.read('ZWARM')).isError).not.toBe(true);
  const pending = callTool(runtime.factory!(), 'SAPWrite', {
    action: 'update',
    type: 'PROG',
    name: 'ZWRITE',
    source: 'REPORT zwrite.',
  });
  await entered.promise;
  try {
    f.advance(SHARED_TRANSPORT_MAX_AGE_MS);
    generation = 'NEW';
    expect((await f.read('ZNEW')).isError).not.toBe(true);
  } finally {
    resume.resolve();
  }
  const result = await pending;
  expect(result.isError, result.content[0]?.text).not.toBe(true);
  const unlock = seen.find((c) => c.url.includes('_action=UNLOCK'));
  expect(unlock?.url).toContain('lockHandle=LOCK_OLD');
  expect(unlock?.cookie).toContain('SAP_SESSIONID_A4H_001=OLD_LATE');
  expect(unlock?.cookie).toContain('sap-contextid=CONTEXT_OLD');
  expect(unlock?.token).toBe('TOKEN_OLD');
  expect(unlock?.cookie).not.toContain('NEW');
  expect((await f.read('ZVERIFY')).isError).not.toBe(true);
  expect(seen.find((c) => c.url.includes('/ZVERIFY/'))?.cookie).toBe('SAP_SESSIONID_A4H_001=NEW');
});

it('reloads the cookie file on rotation without revoking an unchanged configured ticket', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'arc1-cookie-rotation-'));
  const cookieFile = join(dir, 'cookies.txt');
  const writeTicket = (ticket: string) =>
    writeFileSync(cookieFile, `.sap\tTRUE\t/\tFALSE\t0\tMYSAPSSO2\t${ticket}\n`, { mode: 0o600 });
  mockFetch.mockImplementation(async () => mockResponse(200, 'REPORT ztest.', { 'x-csrf-token': 'T' }));
  try {
    writeTicket('STILL_VALID');
    const f = await startRotationFactory({ cookieFile });
    expect((await f.read('ZTEST')).isError).not.toBe(true);
    f.advance(SHARED_TRANSPORT_MAX_AGE_MS);
    expect((await f.read('ZTEST')).isError).not.toBe(true);
    expect(mockFetch.mock.lastCall?.[1].headers.Cookie).toBe('MYSAPSSO2=STILL_VALID');
    writeTicket('REPLACED');
    f.advance(SHARED_TRANSPORT_MAX_AGE_MS);
    expect((await f.read('ZTEST')).isError).not.toBe(true);
    expect(mockFetch.mock.lastCall?.[1].headers.Cookie).toBe('MYSAPSSO2=REPLACED');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
