import { beforeEach, describe, expect, it, vi } from 'vitest';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { mockResponse } from '../../helpers/mock-fetch.js';

const mockFetch = vi.fn();
vi.mock('undici', async (importOriginal) => ({
  ...(await importOriginal<typeof import('undici')>()),
  fetch: mockFetch,
}));
const { AdtClient } = await import('../../../src/adt/client.js');

describe('TABLE_CONTENTS returned row limit (#1068)', () => {
  beforeEach(() => vi.resetAllMocks());

  it.each([
    { values: [' A ', 'B', 'C'], limit: 1, expected: [' A '] },
    { values: [' A ', 'B', 'C'], limit: 2, expected: [' A ', 'B'] },
    { values: [' A ', 'B'], limit: 2, expected: [' A ', 'B'] },
    { values: [' A '], limit: 2, expected: [' A '] },
    { values: [], limit: 1, expected: [] },
  ])('returns $expected for $values with maxRows=$limit', async ({ values, limit, expected }) => {
    const xml = `<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><COLUMNS>
      <COLUMN><METADATA name="VALUE"/><DATASET>${values.map((v) => `<DATA>${v}</DATA>`).join('')}</DATASET></COLUMN>
      </COLUMNS></asx:values></asx:abap>`;
    mockFetch.mockImplementation(async () => mockResponse(200, xml, { 'x-csrf-token': 'T' }));
    const client = new AdtClient({
      baseUrl: 'http://sap:8000',
      username: 'test',
      password: 'test',
      safety: unrestrictedSafetyConfig(),
    });

    const result = await client.getTableContents('T000', limit);

    expect(result.columns).toEqual(['VALUE']);
    expect(result.rows).toEqual(expected.map((VALUE) => ({ VALUE })));
    const posts = mockFetch.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(String(posts[0]?.[0])).toContain(`rowNumber=${limit}&ddicEntityName=T000`);
  });
});
