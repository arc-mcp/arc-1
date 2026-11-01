/**
 * TABL write routing must follow SAP's current subtype on every call (issue #285 guard).
 *
 * The undici mock + createClient live in ./setup-undici-mock.ts — import that helper
 * and keep all other src-module imports dynamic (see its header for the ordering rules).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { featuresOff } from './handler-test-config.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures, setCachedFeatures } = await import('../../../src/handlers/feature-cache.js');

afterEach(() => {
  mockFetch.mockReset();
  resetCachedFeatures();
});

/** NW 7.50/7.51: discovery lists /ddic/structures but not /ddic/tables. */
const nw750 = () =>
  setCachedFeatures({
    ...featuresOff(),
    abapRelease: '750',
    systemType: 'onprem',
    discoveryMap: new Map<string, string[]>([['/sap/bc/adt/ddic/structures', ['application/*']]]),
  });

/** SAP around TABL ZSWAP. `search`: reported subtype, '' for no hit, or an HTTP error status. */
function mockSap(sap: { search: string | number; tables?: number }) {
  const calls: Array<{ method: string; path: string }> = [];
  mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
    const method = opts?.method ?? 'GET';
    const path = new URL(String(url)).pathname;
    calls.push({ method, path });
    if (path.endsWith('/informationsystem/search')) {
      if (typeof sap.search === 'number') return Promise.resolve(mockResponse(sap.search, 'denied'));
      const hit = sap.search
        ? `<adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/structures/ZSWAP" adtcore:type="${sap.search}" adtcore:name="ZSWAP"/>`
        : '';
      return Promise.resolve(
        mockResponse(
          200,
          `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">${hit}</adtcore:objectReferences>`,
        ),
      );
    }
    // Existence probes: /tables/ is absent on 7.50 (404 by default); /structures/ serves every TABL there.
    if (method === 'GET' && path.endsWith('/ddic/tables/ZSWAP'))
      return Promise.resolve(mockResponse(sap.tables ?? 404, ''));
    if (method === 'POST' && String(url).includes('_action=LOCK')) {
      return Promise.resolve(
        mockResponse(200, '<asx:values><LOCK_HANDLE>LH7</LOCK_HANDLE><CORRNR></CORRNR></asx:values>', {
          'x-csrf-token': 'T',
        }),
      );
    }
    return Promise.resolve(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
  });
  return calls;
}

const source = "@EndUserText.label : 'Swap'\ndefine type zswap { mandt : abap.clnt; }";
const update = (client = createClient()) =>
  handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', { action: 'update', type: 'TABL', name: 'ZSWAP', source });
const mutationTraffic = (calls: Array<{ method: string }>) => calls.filter((c) => !['GET', 'HEAD'].includes(c.method));

it('re-resolves the subtype on every write of a long-lived client (structure recreated as a table)', async () => {
  // stdio keeps one AdtClient per process. On NW 7.50 (no /ddic/tables/), a structure replaced by a
  // transparent table between calls must hit the SE11 refusal again, not a remembered /structures/ route.
  nw750();
  const sap = { search: 'TABL/DS' };
  const calls = mockSap(sap);
  const client = createClient();

  expect((await update(client)).isError).toBeUndefined();
  expect(calls.some((c) => c.method === 'PUT' && c.path.endsWith('/ddic/structures/ZSWAP/source/main'))).toBe(true);
  sap.search = 'TABL/DT';
  calls.length = 0;
  const result = await update(client);

  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).toContain('SE11');
  expect(mutationTraffic(calls)).toEqual([]);
});

describe.each([
  ['finds no TABL', ''],
  ['is not authorized (HTTP 403)', 403],
])('NW 7.50 when the repository search %s', (_label, search) => {
  it.each([
    ['SAPWrite update', 'SAPWrite', { action: 'update', type: 'TABL', name: 'ZSWAP', source }],
    ['SAPWrite delete', 'SAPWrite', { action: 'delete', type: 'TABL', name: 'ZSWAP' }],
    ['SAPActivate', 'SAPActivate', { type: 'TABL', name: 'ZSWAP' }],
    ['SAPActivate batch', 'SAPActivate', { objects: [{ type: 'TABL', name: 'ZSWAP' }] }],
  ])('refuses %s without touching SAP', async (_action, tool, args) => {
    // /structures/ answers for tables and structures alike on 7.50, so it proves nothing.
    nw750();
    const calls = mockSap({ search });
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, tool, args);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Cannot confirm that TABL "ZSWAP" is a structure');
    expect(result.content[0]?.text).toContain('has no /sap/bc/adt/ddic/tables/');
    expect(mutationTraffic(calls)).toEqual([]);
  });
});

describe('without ADT discovery data (tables endpoint unknown)', () => {
  it('writes through /tables/ when the fresh probe finds the object there', async () => {
    const calls = mockSap({ search: 403, tables: 200 });

    expect((await update()).isError).toBeUndefined();
    expect(calls.some((c) => c.method === 'PUT' && c.path.endsWith('/ddic/tables/ZSWAP/source/main'))).toBe(true);
  });

  it('refuses when only /structures/ answers (could be 7.50 without /tables/)', async () => {
    const calls = mockSap({ search: 403 });
    const result = await update();

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('ADT discovery is not loaded');
    expect(mutationTraffic(calls)).toEqual([]);
  });
});
