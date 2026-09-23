import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { mockResponse } from '../../helpers/mock-fetch.js';

const mockFetch = vi.fn();
vi.mock('undici', async (importOriginal) => ({
  ...(await importOriginal<typeof import('undici')>()),
  fetch: mockFetch,
}));
const { AdtClient } = await import('../../../src/adt/client.js');
const tableResponse = readFileSync(new URL('../../fixtures/xml/table-contents.xml', import.meta.url), 'utf8');

function createClient() {
  return new AdtClient({
    baseUrl: 'http://sap:8000',
    username: 'admin',
    password: 'secret',
    safety: unrestrictedSafetyConfig(),
  });
}

describe('freestyle SQL line preparation at the client boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it.each(['runQuery', 'runQueryWithMetrics', 'runQueryBatch'] as const)(
    '%s fits SQL lines at the shared send boundary',
    async (method) => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, tableResponse, { 'x-csrf-token': 'T' }));
      const client = createClient();
      const sql = `SELECT mandt FROM t000 WHERE ${Array(30).fill("mandt <> '999'").join(' AND ')}`;
      if (method === 'runQueryBatch') await client.runQueryBatch([sql, sql], 100);
      else await client[method](sql, 100);
      const posts = mockFetch.mock.calls.filter((call) => String(call[0]).includes('/datapreview/freestyle'));
      expect(posts).toHaveLength(method === 'runQueryBatch' ? 2 : 1);
      for (const post of posts) {
        const body = String((post[1] as RequestInit).body);
        expect(body.replaceAll('\n', ' ')).toBe(sql);
        expect(body.split('\n').every((line) => line.length <= 255)).toBe(true);
      }
    },
  );

  it('fits structured TABLE_QUERY lines while keeping every filter', async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(mockResponse(200, tableResponse, { 'x-csrf-token': 'T' }));
    const client = createClient();
    const where = Array.from({ length: 30 }, (_, i) => ({ field: 'MANDT', op: '<>', value: String(i) }));
    await client.runTableQuery('T000', { columns: ['MANDT'], where });
    const post = mockFetch.mock.calls.find((call) => String(call[0]).includes('/datapreview/freestyle'));
    expect(post).toBeDefined();
    const body = String((post![1] as RequestInit).body);
    expect(body.split('\n').every((line) => line.length <= 255)).toBe(true);
    expect(body.replaceAll('\n', ' ')).toBe(
      `SELECT MANDT FROM T000 WHERE ${where.map((c) => `MANDT <> '${c.value}'`).join(' AND ')}`,
    );
  });

  it('refuses an unsplittable literal before issuing a freestyle POST', async () => {
    mockFetch.mockReset();
    const client = createClient();
    await expect(client.runQuery(`SELECT mandt FROM t000 WHERE mtext = '${'x'.repeat(256)}'`)).rejects.toThrow(
      'Cannot fit freestyle SQL',
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
