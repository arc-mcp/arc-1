/**
 * HTTP mode builds an MCP Server per request (createAndStartServer → startHttpServer factory). The shared
 * identity's SAP login (cookies, CSRF token) must outlive a request; AdtClient route caches must not.
 * Adapted from the #871 review reproduction: a structure replaced by a transparent table between calls
 * must be re-resolved, or NW 7.50 writes it through /ddic/structures/ (issue #285).
 */
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

const { createAndStartServer } = await import('../../../src/server/server.js');
const adtFeatures = await import('../../../src/adt/features.js');
const { resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');

afterEach(() => {
  vi.restoreAllMocks();
  mockFetch.mockReset();
  resetCachedFeatures();
});

it('shares the SAP login across HTTP requests but re-resolves TABL routes per request', async () => {
  const features = {
    ...featuresOff(),
    abapRelease: '750',
    systemType: 'onprem' as const,
    discoveryMap: new Map([['/sap/bc/adt/ddic/structures', ['application/*']]]),
  };
  vi.spyOn(adtFeatures, 'probeFeatures').mockResolvedValue(features);
  let actualType = 'TABL/DS';
  const calls: Array<{ method: string; url: string; cookie: string }> = [];
  mockFetch.mockImplementation(async (url: string, options: { method?: string; headers?: Record<string, string> }) => {
    const method = options.method ?? 'GET';
    calls.push({ method, url: String(url), cookie: options.headers?.Cookie ?? '' });
    const login = ['SAP_SESSIONID_A4H_001=S1; path=/'];
    if (String(url).includes('/informationsystem/search?')) {
      return mockResponse(
        200,
        `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/structures/ZSWAP" adtcore:type="${actualType}" adtcore:name="ZSWAP"/></adtcore:objectReferences>`,
        {},
        login,
      );
    }
    if (String(url).includes('_action=LOCK')) {
      return mockResponse(200, '<asx:values><LOCK_HANDLE>LH7</LOCK_HANDLE><CORRNR></CORRNR></asx:values>', {}, login);
    }
    return mockResponse(
      200,
      '<adtcore:object xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="$TMP"/></adtcore:object>',
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
    allowedPackages: ['*'],
    lintBeforeWrite: false,
    cacheMode: 'none',
    transport: 'http-streamable',
  });
  await startup.close();
  const callTable = async (action: 'delete' | 'update') => {
    const server = runtime.factory!();
    const handlers = (server as unknown as { _requestHandlers: Map<string, (...args: unknown[]) => unknown> })
      ._requestHandlers;
    const source = "@EndUserText.label : 'Changed'\ndefine type zswap { field1 : abap.char(1); }";
    try {
      return (await handlers.get('tools/call')!(
        {
          method: 'tools/call',
          params: { name: 'SAPWrite', arguments: { action, type: 'TABL', name: 'ZSWAP', source } },
        },
        {},
      )) as { isError?: boolean; content: Array<{ text: string }> };
    } finally {
      await server.close();
    }
  };

  const deleted = await callTable('delete');
  expect(deleted.isError, deleted.content[0]?.text).not.toBe(true);

  // ZSWAP is recreated as a transparent table in SE11 before the next, independent tool call.
  actualType = 'TABL/DT';
  calls.length = 0;
  const updated = await callTable('update');

  expect(calls[0]?.cookie).toContain('SAP_SESSIONID_A4H_001=S1');
  expect(calls.filter((c) => c.url.includes('/informationsystem/search?'))).toHaveLength(1);
  expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  expect(updated.isError).toBe(true);
  expect(updated.content[0]?.text).toContain('Use SE11');
});
