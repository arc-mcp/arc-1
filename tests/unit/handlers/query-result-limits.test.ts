import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const fixture = (name: string) =>
  readFileSync(new URL(`../../fixtures/xml/query-1219-${name}.xml`, import.meta.url), 'utf8');
const UNION = "SELECT land1 FROM t005 WHERE land1 LIKE 'B%' UNION ALL SELECT land1 FROM t005 WHERE land1 LIKE 'C%'";
const FIRST_FIVE = ['BA', 'BB', 'BD', 'BE', 'BF'].map((LAND1) => ({ LAND1 }));

function createClient(maxDataPreviewResponseBytes?: number) {
  return new AdtClient({
    baseUrl: 'http://sap:8000',
    username: 'admin',
    password: 'secret',
    safety: unrestrictedSafetyConfig(),
    ...(maxDataPreviewResponseBytes ? { maxDataPreviewResponseBytes } : {}),
  });
}

function respond(xml: string) {
  mockFetch.mockImplementation(async (_url: unknown, init: RequestInit) =>
    init.method === 'HEAD' ? mockResponse(200, '', { 'x-csrf-token': 'T' }) : mockResponse(200, xml),
  );
}

function rowsXml(values: string[]) {
  return `<tableData><columns><metadata name="VALUE"/><dataSet>${values.map((v) => `<data>${v}</data>`).join('')}</dataSet></columns></tableData>`;
}

const posts = () => mockFetch.mock.calls.filter(([url]) => String(url).includes('/datapreview/freestyle'));

describe('freestyle result counts and row caps (#1219)', () => {
  beforeEach(() => vi.resetAllMocks());

  // Native fixtures: T005, SAP_BASIS 758 SP02/client001/direct HTTPS, 2026-11-12.
  // SAP returns all 40 UNION rows at rowNumber=5 and reports totalRows=0.
  it.each(['runQuery', 'runQueryWithMetrics', 'runQueryBatch'] as const)(
    '%s caps a single UNION response without rewriting SQL or retrying',
    async (method) => {
      respond(fixture('union'));
      const client = createClient();
      const result = method === 'runQueryBatch' ? await client[method]([UNION], 5) : await client[method](UNION, 5);
      expect(result.columns).toEqual(['LAND1']);
      expect(result.rows).toEqual(FIRST_FIVE);
      expect(posts()).toHaveLength(1);
      expect(String(posts()[0]![0])).toContain('rowNumber=5');
      expect(posts()[0]![1].body).toBe(UNION);
    },
  );

  it('caps public SAPQuery UNION rows and separates the raw SAP count', async () => {
    respond(fixture('union'));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPQuery', { sql: UNION, maxRows: 5 });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text);
    expect(data).toMatchObject({ sapReportedTotalRows: 0, rowsReturned: 5, rowLimitReached: true, rows: FIRST_FIVE });
    expect(data).not.toHaveProperty('totalRows');
    expect(data.executedQueryString).toContain('UNION ALL');
    expect(data.queryExecutionTimeMs).toBeGreaterThanOrEqual(0);
    expect(posts()).toHaveLength(1);
  });

  it.each([
    ['count', 'SELECT COUNT(*) AS n FROM t005', 250, [{ N: '250 ' }]],
    ['empty-count', "SELECT COUNT(*) AS n FROM t005 WHERE land1 = 'ZZZ'", 0, [{ N: '0 ' }]],
    ['distinct', 'SELECT DISTINCT xegld FROM t005', 250, [{ XEGLD: '' }, { XEGLD: 'X' }]],
    ['count-having', 'SELECT COUNT(*) AS n FROM t005 HAVING COUNT(*) > 9999', 0, [{ N: '0 ' }]],
    ['having-empty', "SELECT MAX( land1 ) AS mx FROM t005 HAVING MAX( land1 ) < 'A'", 0, []],
  ])('keeps %s rows without inventing a result total', async (name, sql, total, rows) => {
    respond(fixture(String(name)));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPQuery', { sql, maxRows: 5 });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text);
    expect(data).toMatchObject({
      sapReportedTotalRows: total,
      rowsReturned: rows.length,
      rowLimitReached: false,
      rows,
    });
    expect(data).not.toHaveProperty('totalRows');
    expect(posts()).toHaveLength(1);
  });

  it.each([1, 2, 3])('marks reaching the cap without claiming completeness (%i SAP rows)', async (count) => {
    respond(rowsXml(Array(count).fill('same ')));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPQuery', { sql: UNION, maxRows: 2 });
    const data = JSON.parse(result.content[0]!.text);
    expect(data.rows).toEqual(Array(Math.min(count, 2)).fill({ VALUE: 'same ' }));
    expect(data.rowLimitReached).toBe(count >= 2);
    expect(data).not.toHaveProperty('sapReportedTotalRows');
    expect(data).not.toHaveProperty('totalRows');
    expect(data).not.toHaveProperty('truncated');
  });

  it.each([
    [undefined, 100],
    [20_000, 10_000],
  ])('enforces the effective limit when SAP ignores maxRows=%s', async (requested, expected) => {
    respond(rowsXml(Array(expected + 1).fill('x')));
    const result = await createClient().runQuery(UNION, requested);
    expect(result.rows).toHaveLength(expected);
    expect(String(posts()[0]![0])).toContain(`rowNumber=${expected}`);
  });

  it('keeps the shared cap and omits untrustworthy combined metrics for IN-list chunks', async () => {
    respond(rowsXml(['one ', 'two ']));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPQuery', {
      sql: "SELECT land1 FROM t005 WHERE land1 IN ('AA','BB','CC','DD','EE','FF','GG','HH','II','JJ','KK','LL','MM','NN','OO','PP','QQ')",
      maxRows: 3,
    });
    const data = JSON.parse(result.content[0]!.text);
    expect(data).toMatchObject({
      rowsReturned: 3,
      rowLimitReached: true,
      rows: [{ VALUE: 'one ' }, { VALUE: 'two ' }, { VALUE: 'one ' }],
    });
    expect(data).not.toHaveProperty('sapReportedTotalRows');
    expect(data).not.toHaveProperty('totalRows');
    expect(posts()).toHaveLength(2);
    expect(posts().map(([url]) => new URL(String(url)).searchParams.get('rowNumber'))).toEqual(['3', '1']);
  });

  it('rejects an oversized UNION body before slicing even with maxRows=1', async () => {
    respond(fixture('union'));
    const result = await handleToolCall(createClient(64), DEFAULT_CONFIG, 'SAPQuery', { sql: UNION, maxRows: 1 });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({
      error: 'DATA_RESPONSE_TOO_LARGE',
      limitBytes: 64,
      retryable: false,
    });
    expect(posts()).toHaveLength(1);
    expect(result.content[0]!.text).not.toContain('LAND1');
    expect(result.content[0]!.text).toContain('narrow each branch with WHERE');
  });
});
