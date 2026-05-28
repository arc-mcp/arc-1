import { describe, expect, it } from 'vitest';
import { buildTableQuerySql } from '../../../src/adt/client.js';

describe('buildTableQuerySql', () => {
  // ─── Basic SELECT ──────────────────────────────────────────────────

  it('builds SELECT * with no options', () => {
    expect(buildTableQuerySql('MSEG')).toBe('SELECT * FROM MSEG');
  });

  it('uppercases the table name', () => {
    expect(buildTableQuerySql('mseg')).toBe('SELECT * FROM MSEG');
  });

  it('selects specific columns', () => {
    expect(buildTableQuerySql('MSEG', ['MATNR', 'BWART', 'BUDAT_MKPF'])).toBe(
      'SELECT MATNR, BWART, BUDAT_MKPF FROM MSEG',
    );
  });

  // ─── WHERE conditions ──────────────────────────────────────────────

  it('adds a single WHERE condition', () => {
    expect(buildTableQuerySql('T000', undefined, [{ field: 'MANDT', op: '=', value: '100' }])).toBe(
      "SELECT * FROM T000 WHERE MANDT = '100'",
    );
  });

  it('ANDs multiple WHERE conditions', () => {
    const sql = buildTableQuerySql('MSEG', undefined, [
      { field: 'MATNR', op: '=', value: '300006888' },
      { field: 'BWART', op: '=', value: '262' },
      { field: 'BUDAT_MKPF', op: '>=', value: '20250101' },
    ]);
    expect(sql).toBe("SELECT * FROM MSEG WHERE MATNR = '300006888' AND BWART = '262' AND BUDAT_MKPF >= '20250101'");
  });

  it('handles LIKE operator', () => {
    expect(buildTableQuerySql('MARA', undefined, [{ field: 'MATNR', op: 'LIKE', value: 'Z%' }])).toBe(
      "SELECT * FROM MARA WHERE MATNR LIKE 'Z%'",
    );
  });

  it('handles NOT LIKE operator', () => {
    expect(buildTableQuerySql('MARA', undefined, [{ field: 'MATNR', op: 'NOT LIKE', value: 'Z%' }])).toBe(
      "SELECT * FROM MARA WHERE MATNR NOT LIKE 'Z%'",
    );
  });

  it('handles IS NULL operator (no value)', () => {
    expect(buildTableQuerySql('MARA', undefined, [{ field: 'MBRSH', op: 'IS NULL' }])).toBe(
      'SELECT * FROM MARA WHERE MBRSH IS NULL',
    );
  });

  it('handles IS NOT NULL operator', () => {
    expect(buildTableQuerySql('MARA', undefined, [{ field: 'MBRSH', op: 'IS NOT NULL' }])).toBe(
      'SELECT * FROM MARA WHERE MBRSH IS NOT NULL',
    );
  });

  it('handles IS NULL in lowercase (normalised)', () => {
    expect(buildTableQuerySql('MARA', undefined, [{ field: 'MBRSH', op: 'is null' }])).toBe(
      'SELECT * FROM MARA WHERE MBRSH IS NULL',
    );
  });

  // ─── IN / NOT IN ───────────────────────────────────────────────────

  it('handles IN operator with comma-separated raw values', () => {
    expect(buildTableQuerySql('MSEG', undefined, [{ field: 'BWART', op: 'IN', value: '261,262' }])).toBe(
      "SELECT * FROM MSEG WHERE BWART IN ('261', '262')",
    );
  });

  it('handles IN with parenthesised value for convenience', () => {
    expect(buildTableQuerySql('MSEG', undefined, [{ field: 'BWART', op: 'IN', value: '(261,262)' }])).toBe(
      "SELECT * FROM MSEG WHERE BWART IN ('261', '262')",
    );
  });

  it('handles NOT IN operator', () => {
    expect(buildTableQuerySql('MSEG', undefined, [{ field: 'BWART', op: 'NOT IN', value: '101,102' }])).toBe(
      "SELECT * FROM MSEG WHERE BWART NOT IN ('101', '102')",
    );
  });

  it('escapes inner single quotes in IN values', () => {
    expect(buildTableQuerySql('MARA', undefined, [{ field: 'MAKTX', op: 'IN', value: "O'Brien,Smith" }])).toBe(
      "SELECT * FROM MARA WHERE MAKTX IN ('O''Brien', 'Smith')",
    );
  });

  // ─── IN injection prevention ───────────────────────────────────────
  // buildInList wraps every element in quotes and double-escapes inner quotes,
  // so any injected SQL becomes a harmless string literal.

  it('neutralises SQL injection attempt in IN value (becomes quoted string)', () => {
    const sql = buildTableQuerySql('USR02', undefined, [{ field: 'BNAME', op: 'IN', value: "X') OR 1=1 --" }]);
    // The entire payload is treated as one string literal — injection neutralised
    expect(sql).toBe("SELECT * FROM USR02 WHERE BNAME IN ('X'') OR 1=1 --')");
  });

  it('neutralises subquery in IN value (becomes quoted string)', () => {
    const sql = buildTableQuerySql('USR02', undefined, [
      { field: 'BNAME', op: 'IN', value: 'SELECT BCODE FROM USR02' },
    ]);
    expect(sql).toBe("SELECT * FROM USR02 WHERE BNAME IN ('SELECT BCODE FROM USR02')");
  });

  it('handles unquoted numeric literals in IN value (wrapped as strings)', () => {
    const sql = buildTableQuerySql('T000', undefined, [{ field: 'MANDT', op: 'IN', value: '100,200' }]);
    expect(sql).toBe("SELECT * FROM T000 WHERE MANDT IN ('100', '200')");
  });

  // ─── BETWEEN removed ──────────────────────────────────────────────

  it('rejects BETWEEN operator (removed for safety)', () => {
    expect(() =>
      buildTableQuerySql('MSEG', undefined, [{ field: 'BUDAT_MKPF', op: 'BETWEEN', value: '20250101 AND 20250131' }]),
    ).toThrow('operator "BETWEEN" is not allowed');
  });

  // ─── General injection prevention ─────────────────────────────────

  it('escapes single quotes in scalar values', () => {
    const sql = buildTableQuerySql('MARA', undefined, [{ field: 'MATNR', op: '=', value: "O'Brien" }]);
    expect(sql).toBe("SELECT * FROM MARA WHERE MATNR = 'O''Brien'");
  });

  it('strips non-word characters from field names', () => {
    const sql = buildTableQuerySql('T000', undefined, [{ field: 'MANDT; DROP', op: '=', value: '100' }]);
    expect(sql).toBe("SELECT * FROM T000 WHERE MANDTDROP = '100'");
  });

  it('strips non-word characters from column names', () => {
    const sql = buildTableQuerySql('T000', ['MANDT; DROP TABLE T000--', 'MTEXT']);
    expect(sql).toBe('SELECT MANDTDROPTABLET000, MTEXT FROM T000');
  });

  // ─── Error cases ───────────────────────────────────────────────────

  it('throws on empty table name', () => {
    expect(() => buildTableQuerySql('')).toThrow('TABLE_QUERY: table name must not be empty');
  });

  it('throws on table name that sanitises to empty', () => {
    expect(() => buildTableQuerySql('!!!')).toThrow('TABLE_QUERY: table name must not be empty');
  });

  it('throws on disallowed operator', () => {
    expect(() => buildTableQuerySql('T000', undefined, [{ field: 'MANDT', op: 'DROP TABLE', value: '100' }])).toThrow(
      'TABLE_QUERY: operator "DROP TABLE" is not allowed',
    );
  });

  it('throws on operator with extra spaces that normalise to allowed op', () => {
    // 'IS  NULL' (double space) normalises to 'IS  NULL' which is NOT in the set → rejected
    expect(() => buildTableQuerySql('MARA', undefined, [{ field: 'MBRSH', op: 'IS  NULL' }])).toThrow('is not allowed');
  });

  // ─── Columns + WHERE combined ─────────────────────────────────────

  it('combines columns and WHERE', () => {
    const sql = buildTableQuerySql(
      'MSEG',
      ['MATNR', 'BWART', 'BUDAT_MKPF', 'MENGE'],
      [
        { field: 'MATNR', op: '=', value: '300006888' },
        { field: 'BWART', op: '=', value: '262' },
      ],
    );
    expect(sql).toBe("SELECT MATNR, BWART, BUDAT_MKPF, MENGE FROM MSEG WHERE MATNR = '300006888' AND BWART = '262'");
  });
});
