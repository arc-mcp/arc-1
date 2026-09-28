/**
 * HTTP mode builds an MCP Server per request (createAndStartServer → startHttpServer factory). The shared
 * identity's SAP login (cookies, CSRF token) must outlive a request; AdtClient caches must not. Adapted
 * from the #871 review reproduction: a structure replaced by a transparent table between calls must be
 * re-resolved (issue #285), and SAP_ALLOWED_PACKAGES subtree rules must see a fresh package hierarchy.
 */
import type { BTPConfig } from '@arc-mcp/xsuaa-auth/btp';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
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
}));

const { lookupDestinationWithUserToken } = await import('@arc-mcp/xsuaa-auth/btp');
const { AdtHttpClient } = await import('../../../src/adt/http.js');
const { createAndStartServer, createServer } = await import('../../../src/server/server.js');
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
  mockFetch.mockResolvedValue(
    mockResponse(200, 'REPORT ztest.', {}, [
      'SAP_SESSIONID_A4H_001=shared-session; path=/',
      'MYSAPSSO2=shared-ticket; path=/',
    ]),
  );
  await defaultHttp.get('/sap/bc/adt/programs/programs/ZTEST/source/main');
  const callAs = (user: string) =>
    callTool(
      createServer(config, { defaultHttp, btpConfig: {} as BTPConfig }),
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
