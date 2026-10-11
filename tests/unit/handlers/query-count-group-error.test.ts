import { describe, expect, it, vi } from 'vitest';
import type { AdtClient } from '../../../src/adt/client.js';
import { AdtApiError } from '../../../src/adt/errors.js';
import { handleSAPQuery } from '../../../src/handlers/query.js';
import { classifySapQueryParserError } from '../../../src/handlers/query-errors.js';

const sql = 'SELECT COUNT(*) AS n FROM t000 GROUP BY cccategory';
const message = 'Incorrect nesting: For the statement "CATCH", there is no open structure introduced by "TRY".';
const endSelectMessage =
  'Incorrect nesting: Before the statement "ENDMETHOD", the control structure introduced by "SELECT" must be closed by "ENDSELECT".';
const error = (text = message, status = 400) => new AdtApiError(text, status, '/sap/bc/adt/datapreview/freestyle');

describe('count-only grouped SQL generation failure', () => {
  it.each([message, endSelectMessage])('recognizes the SAP nesting diagnostic: %s', (text) => {
    const result = classifySapQueryParserError(error(text), sql, false, false);
    expect(result).toContain('scalar');
    expect(result).toContain('grouping columns');
    expect(result).toContain('additional result columns');
  });

  it('accepts whitespace and an omitted COUNT alias', () => {
    expect(
      classifySapQueryParserError(error(), 'select count( * )\nfrom t000\ngroup by cccategory', false, false),
    ).toContain('scalar');
  });

  it.each([
    'SELECT COUNT(*) AS n FROM t000',
    'SELECT DISTINCT COUNT(*) AS n FROM t000 GROUP BY cccategory',
    'SELECT COUNT( DISTINCT cccategory ) AS n FROM t000 GROUP BY mandt',
    'SELECT cccategory, COUNT(*) AS n FROM t000 GROUP BY cccategory',
    'SELECT MIN( mandt ) AS m, COUNT(*) AS n FROM t000 GROUP BY cccategory',
    "SELECT COUNT(*) FROM t000 WHERE mtext = 'GROUP BY cccategory'",
    'SELECT COUNT(*) FROM t000 WHERE mandt IN ( SELECT mandt FROM t000 GROUP BY mandt )',
  ])('does not misclassify a different query shape: %s', (query) => {
    expect(classifySapQueryParserError(error(), query, false, false) ?? '').not.toContain('scalar');
  });

  it.each([
    error('Unknown column CCCATEGORY'),
    error('Unknown column ENDSELECT'),
    error(message, 403),
    error(message, 500),
  ])('does not override unrelated SAP errors', (err) => {
    expect(classifySapQueryParserError(err, sql, false, false) ?? '').not.toContain('scalar');
  });

  it.each([message, endSelectMessage])('keeps the hint but redacts SAP details in minimal mode: %s', (text) => {
    const result = classifySapQueryParserError(error(text), sql, false, true)!;
    expect(result).toContain('grouping columns');
    expect(result).not.toContain('Incorrect nesting');
    expect(result).not.toContain('ENDMETHOD');
    expect(result).not.toContain('/sap/bc/adt');
  });

  it('reports the failure without rewriting or retrying the SQL', async () => {
    const runQueryBatch = vi.fn().mockRejectedValue(error());
    const client = { runQueryBatch } as unknown as AdtClient;
    const result = await handleSAPQuery(client, { sql, maxRows: 10 }, false);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('grouping columns');
    expect(runQueryBatch).toHaveBeenCalledExactlyOnceWith([sql], 10);
  });

  it('leaves a successful backend result unchanged', async () => {
    const runQueryBatch = vi.fn().mockResolvedValue({ columns: ['N'], rows: [{ N: '3' }] });
    const result = await handleSAPQuery({ runQueryBatch } as unknown as AdtClient, { sql, maxRows: 10 }, false);
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toMatchObject({ columns: ['N'], rows: [{ N: '3' }] });
    expect(runQueryBatch).toHaveBeenCalledExactlyOnceWith([sql], 10);
  });
});
