import { beforeEach, describe, expect, it, vi } from 'vitest';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { mockResponse } from '../../helpers/mock-fetch.js';

const mockFetch = vi.fn();
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, fetch: mockFetch };
});

const { AdtClient } = await import('../../../src/adt/client.js');

function tableSearchResponse(): Response {
  return mockResponse(
    200,
    '<?xml version="1.0"?><adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">' +
      '<adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/tables/T000" adtcore:type="TABL/DT" ' +
      'adtcore:name="T000"/></adtcore:objectReferences>',
  );
}

describe('data-source policy with unavailable discovery', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockImplementation(async (url: string) => {
      const path = String(url);
      if (path.includes('/repository/informationsystem/search')) return tableSearchResponse();
      if (path.includes('/ddic/tables/T000/source/main')) {
        return mockResponse(404, '<exc:exception><message>not found</message></exc:exception>');
      }
      return mockResponse(500, 'data request must not execute');
    });
  });

  it.each([
    ['SAPQuery', (client: InstanceType<typeof AdtClient>) => client.runQuery('SELECT COUNT(*) FROM T000')],
    ['TABLE_QUERY', (client: InstanceType<typeof AdtClient>) => client.runTableQuery('T000')],
    ['TABLE_CONTENTS', (client: InstanceType<typeof AdtClient>) => client.getTableContents('T000')],
  ])('classifies a canonical table-source 404 on %s', async (_label, call) => {
    const client = new AdtClient({
      baseUrl: 'http://sap:8000',
      safety: { ...unrestrictedSafetyConfig(), blockedDataSources: ['USR02'] },
    });

    await expect(call(client)).rejects.toMatchObject({
      code: 'DATA_POLICY_UNAVAILABLE',
      sourcePath: ['T000'],
    });
    const urls = mockFetch.mock.calls.map((entry) => String(entry[0]));
    expect(urls.filter((url) => url.includes('/ddic/tables/T000/source/main'))).toHaveLength(1);
    expect(urls.some((url) => url.includes('/datapreview/'))).toBe(false);
  });
});
