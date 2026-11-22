/** Failed batch activation: the inactive-draft check of a TABL structure uses its resolved /ddic/structures/ URL. */
import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');

beforeEach(() => {
  vi.resetAllMocks();
  resetCachedFeatures();
});

it('checks a structure in a failed objects[] batch at /ddic/structures/', async () => {
  const progUrl = '/sap/bc/adt/programs/programs/zarc1_prog';
  mockFetch.mockImplementation((url: string | URL) => {
    const parsed = new URL(String(url));
    const csrf = { 'x-csrf-token': 'T' };
    if (parsed.pathname.endsWith('/informationsystem/search'))
      return Promise.resolve(
        mockResponse(
          200,
          '<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/structures/zarc1_s" adtcore:type="TABL/DS" adtcore:name="ZARC1_S"/></adtcore:objectReferences>',
          csrf,
        ),
      );
    // Only the program fails with a message, so the structure still gets the draft check.
    if (parsed.pathname === '/sap/bc/adt/activation')
      return Promise.resolve(
        mockResponse(
          200,
          `<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><msg objDescr="ZARC1_PROG" type="E" shortText="Syntax error" uri="${progUrl}"/></chkl:messages>`,
          csrf,
        ),
      );
    return Promise.resolve(mockResponse(200, '', csrf));
  });
  const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
    objects: [
      { type: 'TABL', name: 'ZARC1_S' },
      { type: 'PROG', name: 'ZARC1_PROG' },
    ],
  });
  expect(result.isError).toBe(true);
  const checks = mockFetch.mock.calls
    .filter(([url]) => new URL(String(url)).pathname === '/sap/bc/adt/checkruns')
    .map(([, init]) => String((init as RequestInit | undefined)?.body ?? ''));
  expect(checks.some((body) => body.includes('adtcore:uri="/sap/bc/adt/ddic/structures/ZARC1_S"'))).toBe(true);
  expect(checks.some((body) => body.includes('/ddic/tables/'))).toBe(false);
});
