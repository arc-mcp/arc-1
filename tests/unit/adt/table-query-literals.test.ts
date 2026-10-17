import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';

const mockFetch = vi.fn();
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, fetch: mockFetch };
});
const { AdtClient } = await import('../../../src/adt/client.js');
const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

beforeEach(() => vi.resetAllMocks());

it('accepts the documented literal-prefix operator through public TABLE_QUERY dispatch', async () => {
  const xml = readFileSync(new URL('../../fixtures/xml/table-contents.xml', import.meta.url), 'utf8');
  mockFetch.mockResolvedValue(mockResponse(200, xml, { 'x-csrf-token': 'T' }));
  const client = new AdtClient({
    baseUrl: 'https://sap.invalid',
    safety: { ...defaultSafetyConfig(), allowDataPreview: true, allowFreeSQL: false },
  });
  const result = await handleToolCall(client, { ...DEFAULT_CONFIG, allowDataPreview: true }, 'SAPRead', {
    type: 'TABLE_QUERY',
    name: 'STXH',
    columns: ['TDNAME'],
    where: [{ field: 'TDNAME', op: 'STARTS_WITH', value: "Z_%#'" }],
  });
  expect(result.isError).not.toBe(true);
  const postCall = mockFetch.mock.calls.find((call) => String(call[0]).includes('/datapreview/freestyle'));
  expect(String((postCall?.[1] as RequestInit)?.body)).toBe(
    "SELECT TDNAME FROM STXH WHERE TDNAME LIKE 'Z#_#%##''%' ESCAPE '#'",
  );
});

it('keeps literal-preserving prefix reads behind data preview without requiring free SQL', async () => {
  const xml = readFileSync(new URL('../../fixtures/xml/table-contents.xml', import.meta.url), 'utf8');
  mockFetch.mockResolvedValue(mockResponse(200, xml, { 'x-csrf-token': 'T' }));
  const client = new AdtClient({
    baseUrl: 'https://sap.invalid',
    safety: { ...defaultSafetyConfig(), allowDataPreview: true, allowFreeSQL: false },
  });
  await client.runTableQuery('STXH', {
    columns: ['TDNAME'],
    where: [{ field: 'TDNAME', op: 'STARTS_WITH', value: '  Z_%' }],
    preserveLiteralSpaces: true,
  });
  const postCall = mockFetch.mock.calls.find((call) => String(call[0]).includes('/datapreview/freestyle'));
  expect(String((postCall?.[1] as RequestInit)?.body)).toBe(
    "SELECT TDNAME FROM STXH WHERE ( left( TDNAME, 5 ) = concat_with_space( ' ', 'Z_%', 2 ) AND length( TDNAME ) >= 5 )",
  );
});
