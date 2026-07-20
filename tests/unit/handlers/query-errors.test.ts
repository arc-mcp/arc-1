import { describe, expect, it, vi } from 'vitest';
import type { AdtClient } from '../../../src/adt/client.js';
import { AdtApiError } from '../../../src/adt/errors.js';
import { handleSAPQuery } from '../../../src/handlers/query.js';
import { classifySapQueryParserError } from '../../../src/handlers/query-errors.js';

function parserError(message = 'Invalid query string. Only one SELECT statement is allowed', statusCode = 400) {
  return new AdtApiError(message, statusCode, '/sap/bc/adt/datapreview/freestyle');
}

function hintFor(sql: string, message?: string, statusCode?: number): string {
  return classifySapQueryParserError(parserError(message, statusCode), sql) ?? '';
}

function dataPreviewMessage004(message: string): AdtApiError {
  const body =
    '<?xml version="1.0" encoding="utf-8"?><exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework">' +
    `<message lang="EN">${message}</message><localizedMessage lang="EN">${message}</localizedMessage>` +
    '<properties><entry key="T100KEY-ID">ADT_DATAPREVIEW_MSG</entry><entry key="T100KEY-NO">004</entry>' +
    `<entry key="T100KEY-V1">${message}</entry></properties></exc:exception>`;
  return new AdtApiError(body, 400, '/sap/bc/adt/datapreview/freestyle', body);
}

describe('classifySapQueryParserError', () => {
  it.each([
    ['SELECT TOP 5 mandt FROM t000', 'TOP', 'maxRows: 5'],
    ['SELECT mandt FROM t000 LIMIT 7', 'LIMIT', 'maxRows: 7'],
    ['SELECT mandt FROM t000 FETCH FIRST 9 ROWS ONLY', 'FETCH FIRST/NEXT', 'maxRows: 9'],
  ])('maps %s row limiting to SAPQuery maxRows', (sql, syntax, maxRows) => {
    const hint = hintFor(sql);
    expect(hint).toContain(syntax);
    expect(hint).toContain(maxRows);
  });

  it('explains that OFFSET requires key-based pagination rather than claiming maxRows is equivalent', () => {
    const hint = hintFor('SELECT mandt FROM t000 ORDER BY mandt OFFSET 5 ROWS');
    expect(hint).toContain('OFFSET pagination is not supported');
    expect(hint).toContain('WHERE/ORDER BY keys');
  });

  it.each(['@lv_client', ':client', '?'])(
    'explains why the freestyle endpoint cannot resolve parameter syntax %s',
    (parameter) => {
      const hint = hintFor(`SELECT mandt FROM t000 WHERE mandt = ${parameter}`);
      expect(hint).toContain('no ABAP host-program or prepared-statement context');
      expect(hint).toContain('single-quoted literal');
    },
  );

  it('requires AS for table aliases', () => {
    const hint = hintFor('SELECT t~mandt FROM t000 t');
    expect(hint).toContain('requires AS for table aliases');
    expect(hint).toContain('t000 AS t');
    expect(hint).toContain('t~field');
  });

  it.each([
    'SELECT FROM t000 FIELDS mandt',
    "SELECT mandt FROM t000 USING CLIENT '000'",
    'SELECT mandt FROM t000 WITH PRIVILEGED ACCESS',
  ])('does not mistake a source addition for an alias missing AS: %s', (sql) => {
    expect(hintFor(sql, 'invalid query string')).not.toContain('requires AS for table aliases');
  });

  it('explains the comma-versus-AS choice for a simple select-list pair', () => {
    const hint = hintFor('SELECT mandt client FROM t000');
    expect(hint).toContain('commas between select-list fields');
    expect(hint).toContain('mandt AS client');
  });

  it.each([
    ['SELECT t.mandt FROM t000 AS t', 't~mandt'],
    ['SELECT t.* FROM t000 AS t', 't~*'],
  ])('converts dot access only for a declared source alias: %s', (sql, replacement) => {
    const hint = hintFor(sql);
    expect(hint).toContain(replacement);
    expect(hint).toContain('Only declared table aliases');
  });

  it('treats a source-qualified dot as a schema prefix, not an alias separator', () => {
    const hint = hintFor('SELECT mandt FROM SAPSR3.T000');
    expect(hint).toContain('Database schema prefixes are not accepted');
    expect(hint).toContain('FROM T000');
    expect(hint).not.toContain('SAPSR3~T000');
  });

  it('does not suggest a tilde for CDS cast type syntax', () => {
    const hint = hintFor('SELECT CAST( mandt AS abap.char(3) ) AS client FROM t000');
    expect(hint).toContain('CDS cast type syntax');
    expect(hint).toContain('CAST(value AS CHAR)');
    expect(hint).not.toContain('abap~char');
  });

  it.each([
    ["SELECT mandt FROM t000 WHERE mandt != '999'", '<> or NE'],
    ["SELECT mtext FROM t000 WHERE mtext ILIKE '%client%'", 'UPPER(name) LIKE'],
    ['SELECT mandt || mtext AS label FROM t000', 'CONCAT(left, right)'],
  ])('provides the ABAP SQL replacement for %s', (sql, replacement) => {
    expect(hintFor(sql)).toContain(replacement);
  });

  it.each([
    ['SELECT mtext FROM t000 WHERE mtext = NULL', 'IS NULL'],
    ['SELECT mtext FROM t000 WHERE mtext != NULL', 'IS NOT NULL'],
    ['SELECT mtext FROM t000 WHERE NULL <> mtext', 'IS NOT NULL'],
  ])('maps invalid NULL comparison in %s to %s', (sql, replacement) => {
    expect(hintFor(sql)).toContain(replacement);
  });

  it.each([
    ['SELECT mandt FROM t000 -- comment', 'Remove comments and double quotes'],
    ['SELECT mandt FROM t000 /* comment */', 'Remove comments and double quotes'],
    ['SELECT mandt FROM "T000"', 'double quote starts a comment'],
    ['SELECT mandt FROM t000;', 'without a trailing semicolon'],
  ])('provides a focused lexical correction for %s', (sql, expected) => {
    expect(hintFor(sql)).toContain(expected);
  });

  it.each([
    ['WITH +x AS ( SELECT mandt FROM t000 ) SELECT mandt FROM +x', 'rejects CTEs'],
    ['SELECT x~mandt FROM ( SELECT mandt FROM t000 ) AS x', 'Derived tables'],
    ['SELECT row_number( ) OVER ( ORDER BY mandt ) AS rn FROM t000', 'Window expressions'],
  ])('identifies unsupported endpoint query shapes: %s', (sql, expected) => {
    expect(hintFor(sql)).toContain(expected);
  });

  it.each([
    ['SELECT mandt FROM t000 INTERSECT SELECT mandt FROM t000', 'IN or EXISTS'],
    ['SELECT mandt FROM t000 EXCEPT SELECT mandt FROM t000', 'NOT EXISTS'],
  ])('suggests a semantics-preserving direction for set operator query %s', (sql, alternative) => {
    const hint = hintFor(sql);
    expect(hint).toContain('injected ABAP row limit');
    expect(hint).toContain(alternative);
  });

  it('turns the live FULL JOIN 500 crash into a useful syntax error', () => {
    const hint = hintFor(
      'SELECT a~mandt FROM t000 AS a FULL JOIN t000 AS b ON a~mandt = b~mandt',
      'Application Server Error: substring boundary exceeded',
      500,
    );
    expect(hint).toContain('FULL JOIN is not supported');
    expect(hint).toContain('LEFT OUTER');
    expect(hint).toContain('RIGHT OUTER');
  });

  it.each(['ambiguous', 'zweideutig'])(
    'preserves an actionable ambiguity diagnosis for localized marker %s',
    (marker) => {
      const hint = hintFor(
        'SELECT tabname FROM dd02l AS l INNER JOIN dd02t AS t ON l~tabname = t~tabname',
        `The column TABNAME is ${marker}`,
      );
      expect(hint).toContain('more than one joined source');
      expect(hint).toContain('alias~field');
    },
  );

  it('ignores dialect-looking text inside a single-quoted literal', () => {
    const hint = hintFor("SELECT mtext FROM t000 WHERE mtext = 'DESC LIMIT @x != NULL --'", 'invalid query string');
    expect(hint).toContain('ADT freestyle SQL parser rejected');
    expect(hint).not.toContain('belongs to another SQL dialect');
    expect(hint).not.toContain('ASCENDING');
    expect(hint).not.toContain('host-program');
  });

  it('does not relabel unrelated server failures', () => {
    expect(
      classifySapQueryParserError(parserError('Database unavailable', 500), 'SELECT mandt FROM t000'),
    ).toBeUndefined();
  });
});

describe('handleSAPQuery parser-error ordering', () => {
  it('classifies a message-004 DESC failure before unknown-column enrichment', async () => {
    const client = {
      runQueryWithMetrics: vi
        .fn()
        .mockRejectedValue(dataPreviewMessage004('"DESC" is not allowed here. "." is expected.')),
      runQuery: vi.fn(),
    } as unknown as AdtClient;

    const result = await handleSAPQuery(client, {
      sql: 'SELECT mandt FROM t000 ORDER BY mandt DESC',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('ASCENDING or DESCENDING');
    expect(result.content[0]?.text).not.toContain('Unknown column');
    expect(client.runQuery).not.toHaveBeenCalled();
  });

  it('still enriches a verified unknown column with the table metadata', async () => {
    const client = {
      runQueryWithMetrics: vi.fn().mockRejectedValue(dataPreviewMessage004('Unknown column name "BOGUS".')),
      runQuery: vi.fn().mockResolvedValue({ columns: ['MANDT', 'MTEXT'], rows: [] }),
    } as unknown as AdtClient;

    const result = await handleSAPQuery(client, { sql: 'SELECT bogus FROM t000' });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe('Unknown column "BOGUS" on T000. Available columns: MANDT, MTEXT.');
    expect(client.runQuery).toHaveBeenCalledWith('SELECT * FROM t000', 1);
  });

  it('uses the qualified join alias to enrich an unknown column from the correct table', async () => {
    const client = {
      runQueryWithMetrics: vi.fn().mockRejectedValue(dataPreviewMessage004('Unknown column name "BOGUS".')),
      runQuery: vi.fn().mockResolvedValue({ columns: ['TABNAME', 'DDLANGUAGE', 'DDTEXT'], rows: [] }),
    } as unknown as AdtClient;

    const result = await handleSAPQuery(client, {
      sql: "SELECT t~bogus FROM dd02l AS b INNER JOIN dd02t AS t ON b~tabname = t~tabname WHERE b~tabname = 'T000'",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(
      'Unknown column "BOGUS" on DD02T. Available columns: TABNAME, DDLANGUAGE, DDTEXT.',
    );
    expect(client.runQuery).toHaveBeenCalledWith('SELECT * FROM dd02t', 1);
  });

  it('preserves the SAP error for an unqualified unknown column across multiple sources', async () => {
    const error = dataPreviewMessage004('Unknown column name "BOGUS".');
    const client = {
      runQueryWithMetrics: vi.fn().mockRejectedValue(error),
      runQuery: vi.fn(),
    } as unknown as AdtClient;

    await expect(
      handleSAPQuery(client, {
        sql: 'SELECT bogus FROM dd02l AS b INNER JOIN dd02t AS t ON b~tabname = t~tabname',
      }),
    ).rejects.toBe(error);
    expect(client.runQuery).not.toHaveBeenCalled();
  });

  it('keeps an ambiguous message-004 error actionable without querying irrelevant metadata', async () => {
    const client = {
      runQueryWithMetrics: vi
        .fn()
        .mockRejectedValue(
          dataPreviewMessage004(
            'The column name or association "TABNAME" is ambiguous, which means it occurs in multiple tables.',
          ),
        ),
      runQuery: vi.fn(),
    } as unknown as AdtClient;

    const result = await handleSAPQuery(client, {
      sql: 'SELECT tabname FROM dd02l AS l INNER JOIN dd02t AS t ON l~tabname = t~tabname',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('more than one joined source');
    expect(result.content[0]?.text).not.toContain('Unknown column');
    expect(client.runQuery).not.toHaveBeenCalled();
  });
});
