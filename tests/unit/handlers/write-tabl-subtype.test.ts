/**
 * TABL write routing must follow SAP's current subtype on every call (issue #285 guard).
 *
 * The undici mock + createClient live in ./setup-undici-mock.ts — import that helper
 * and keep all other src-module imports dynamic (see its header for the ordering rules).
 */
import { afterEach, expect, it } from 'vitest';
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

it('re-resolves the subtype on every write of a long-lived client (structure recreated as a table)', async () => {
  // stdio keeps one AdtClient per process. On NW 7.50 (no /ddic/tables/), a structure replaced by a
  // transparent table between calls must hit the SE11 refusal again, not a remembered /structures/ route.
  setCachedFeatures({
    ...featuresOff(),
    abapRelease: '750',
    systemType: 'onprem',
    discoveryMap: new Map<string, string[]>([['/sap/bc/adt/ddic/structures', ['application/*']]]),
  });
  let actualType = 'TABL/DS';
  const calls: Array<{ method: string; url: string }> = [];
  mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
    const method = opts?.method ?? 'GET';
    calls.push({ method, url: String(url) });
    if (method === 'GET' && String(url).includes('/informationsystem/search?')) {
      return Promise.resolve(
        mockResponse(
          200,
          `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/structures/ZSWAP" adtcore:type="${actualType}" adtcore:name="ZSWAP"/></adtcore:objectReferences>`,
        ),
      );
    }
    if (method === 'POST' && String(url).includes('_action=LOCK')) {
      return Promise.resolve(
        mockResponse(200, '<asx:values><LOCK_HANDLE>LH7</LOCK_HANDLE><CORRNR></CORRNR></asx:values>', {
          'x-csrf-token': 'T',
        }),
      );
    }
    return Promise.resolve(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
  });
  const client = createClient();
  const update = () =>
    handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
      action: 'update',
      type: 'TABL',
      name: 'ZSWAP',
      source: "@EndUserText.label : 'Swap'\ndefine type zswap { mandt : abap.clnt; }",
    });

  expect((await update()).isError).toBeUndefined();
  actualType = 'TABL/DT';
  calls.length = 0;
  const result = await update();

  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).toContain('SE11');
  expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
});
