import { describe, expect, it } from 'vitest';

import { analyzeSqlDataSources, SqlSourceAnalysisError } from '../../../src/adt/sql-source-analyzer.js';

/**
 * Strict-subset corpus for the experimental data-source blocklist.
 *
 * This is an authorization parser, so the bar is "provably one complete static SELECT/WITH", not
 * "probably fine". Everything here is grammar hardening; nothing in this file demonstrates an SAP
 * exploit. See docs/research/2026-09-02-data-source-policy-design-reassessment.md for the measured
 * support matrix that this corpus mirrors.
 */
describe('analyzeSqlDataSources', () => {
  describe('accepted static forms', () => {
    it.each([
      ['plain select', 'SELECT * FROM scarr', ['SCARR']],
      ['keyword case is irrelevant', 'select CarrId from ScArR', ['SCARR']],
      ['namespaced source', 'select carrid from /dmo/i_flight', ['/DMO/I_FLIGHT']],
      [
        'inner join with aliases',
        'SELECT * FROM scarr AS a INNER JOIN spfli AS b ON a~carrid = b~carrid',
        ['SCARR', 'SPFLI'],
      ],
      ['cross join', 'SELECT a~carrid FROM scarr AS a CROSS JOIN spfli AS b', ['SCARR', 'SPFLI']],
      ['union', 'SELECT * FROM scarr UNION SELECT * FROM spfli', ['SCARR', 'SPFLI']],
      ['union across lines', 'SELECT * FROM scarr\nUNION\nSELECT * FROM usr02', ['SCARR', 'USR02']],
      ['nested subquery', 'SELECT * FROM scarr WHERE carrid IN ( SELECT carrid FROM spfli )', ['SCARR', 'SPFLI']],
      ['CTE body, alias not a source', 'WITH +carrier AS ( SELECT * FROM scarr ) SELECT * FROM +carrier', ['SCARR']],
      ['parameterized CDS root', 'SELECT * FROM demo_cds_param( p_x = 1 )', ['DEMO_CDS_PARAM']],
      ['aggregate', 'SELECT COUNT(*) FROM scarr', ['SCARR']],
      ['group by / having', 'SELECT * FROM scarr GROUP BY carrid HAVING COUNT(*) > 1', ['SCARR']],
      ['order by', 'SELECT * FROM scarr ORDER BY carrid', ['SCARR']],
      ['up to n rows', 'SELECT * FROM scarr UP TO 10 ROWS', ['SCARR']],
    ])('extracts sources from %s', (_label, sql, expected) => {
      expect(analyzeSqlDataSources(sql)).toEqual(expected);
    });

    it('supports a hierarchy source', () => {
      const sql =
        'SELECT * FROM HIERARCHY( SOURCE demo_hier CHILD TO PARENT ASSOCIATION _rel ' +
        'START WHERE parentid IS INITIAL SIBLINGS ORDER BY id MULTIPLE PARENTS NOT ALLOWED )';
      expect(analyzeSqlDataSources(sql)).toEqual(['DEMO_HIER']);
    });

    // A double quote is only a comment OUTSIDE a literal; inside one it is ordinary data and must
    // not be refused, or legitimate filtering breaks.
    it.each([
      ['double quote inside a literal', "SELECT * FROM scarr WHERE carrname = 'a\"b'", ['SCARR']],
      ['doubled single quote is an escaped quote', "SELECT * FROM scarr WHERE carrname = 'it''s'", ['SCARR']],
      ['semicolon inside a literal', "SELECT * FROM scarr WHERE carrname = 'a;b'", ['SCARR']],
      ['at-sign inside a literal is not a host marker', "SELECT * FROM scarr WHERE carrname = '@literal'", ['SCARR']],
      ['keywords inside a literal are not sources', "SELECT * FROM scarr WHERE carrname = 'FROM usr02'", ['SCARR']],
      ['periods inside a literal do not end the statement', "SELECT * FROM scarr WHERE carrname = 'a.b'", ['SCARR']],
    ])('accepts %s', (_label, sql, expected) => {
      expect(analyzeSqlDataSources(sql)).toEqual(expected);
    });
  });

  // Comments are stripped by the parser's lexer, so while they are accepted the text the analyzer
  // inspects is not the text SAP receives. Live 758 answered an inline quote comment with HTTP 400
  // and ignored a column-one asterisk comment, so this is NOT a demonstrated exploit - it is refused
  // to remove an assumption about a parser ARC-1 does not control.
  describe('comment rejection (grammar hardening, not an exploit proof)', () => {
    it.each([
      ['inline quote comment', 'SELECT * FROM scarr " UNION SELECT * FROM usr02'],
      ['bare inline comment', 'SELECT * FROM scarr "note'],
      ['inline comment on a later line', 'SELECT *\nFROM scarr " note'],
    ])('refuses %s', (_label, sql) => {
      expect(() => analyzeSqlDataSources(sql)).toThrow(/ABAP inline comments/);
    });

    it.each([
      ['column-one asterisk comment', 'SELECT * FROM scarr\n* SELECT * FROM usr02'],
      ['leading asterisk comment line', '* hidden\nSELECT * FROM scarr'],
    ])('refuses %s', (_label, sql) => {
      expect(() => analyzeSqlDataSources(sql)).toThrow(/ABAP full-line comments/);
    });

    it('does not mistake SELECT * or COUNT(*) for a comment', () => {
      expect(analyzeSqlDataSources('SELECT * FROM scarr')).toEqual(['SCARR']);
      expect(analyzeSqlDataSources('SELECT COUNT(*) FROM scarr')).toEqual(['SCARR']);
    });

    it('refuses an unterminated string literal', () => {
      expect(() => analyzeSqlDataSources("SELECT * FROM scarr WHERE x = 'abc")).toThrow(/unterminated string literal/);
    });

    it('refuses a bare semicolon outside a literal', () => {
      expect(() => analyzeSqlDataSources('SELECT * FROM scarr;')).toThrow(/semicolons are not accepted/);
    });
  });

  describe('constructs refused with a specific reason', () => {
    it.each([
      ['privileged access', 'SELECT * FROM i_view WITH PRIVILEGED ACCESS', /privileged access/],
      ['client specified', 'SELECT * FROM scarr CLIENT SPECIFIED', /client override/],
      ['secondary connection (dynamic)', 'SELECT * FROM scarr CONNECTION (lv_conn)', /secondary database connection/],
      ['secondary connection (named)', 'SELECT * FROM scarr CONNECTION default', /secondary database connection/],
      ['dynamic data source', 'SELECT * FROM (lv_table)', /dynamic expression/],
      ['association path in FROM', 'SELECT * FROM i_view\\_assoc', /CDS association path/],
      ['association path in the field list', 'SELECT \\_assoc-field FROM i_view', /CDS column path/],
      ['host variable', 'SELECT * FROM scarr WHERE carrid = @lv_carrid', /host expressions/],
      ['host method expression', 'SELECT * FROM scarr WHERE carrid = @( zcl_demo=>value( ) )', /host expressions/],
      ['USING CLIENT with a host variable', 'SELECT * FROM scarr USING CLIENT @lv_client', /host expressions/],
      ['FOR ALL ENTRIES', 'SELECT * FROM scarr FOR ALL ENTRIES IN @lt', /host expressions/],
    ])('refuses %s', (_label, sql, reason) => {
      expect(() => analyzeSqlDataSources(sql)).toThrow(reason);
    });
  });

  describe('statement-shape failures', () => {
    // These are all refused, several by the parser rather than a targeted rule. That is intentional:
    // the contract is "provably one complete static SELECT/WITH", so an unparseable statement is
    // refused for the right reason even without a bespoke message.
    it.each([
      ['empty SQL', ''],
      ['whitespace only', '   \n\t '],
      ['SELECT SINGLE (legal ABAP, outside the v1 subset)', 'SELECT SINGLE * FROM scarr'],
      ['caller-supplied INTO target', 'SELECT * FROM scarr INTO TABLE @DATA(rows)'],
      ['caller-supplied APPENDING target', 'SELECT * FROM scarr APPENDING TABLE @lt'],
      ['two statements', 'SELECT * FROM scarr. SELECT * FROM spfli'],
      ['DML tail', 'SELECT * FROM scarr. DELETE FROM spfli'],
      ['non-select statement', 'DELETE FROM scarr'],
      ['update statement', 'UPDATE scarr SET carrname = @x'],
      ['truncated statement', 'SELECT * FROM'],
      ['malformed select', 'SELECT * scarr'],
      ['SQL double-dash comment is not ABAP', 'SELECT * FROM scarr -- x'],
      ['C-style block comment is not ABAP', 'SELECT * FROM scarr /* x */'],
      ['PROVIDED BY / provider syntax', 'SELECT * FROM i_view PROVIDED BY zcl=>meth'],
    ])('refuses %s', (_label, sql) => {
      expect(() => analyzeSqlDataSources(sql)).toThrow(SqlSourceAnalysisError);
    });

    it('refuses a source name that is not an exact technical name', () => {
      // Reported as a SQL-subset failure, not a lineage failure: the statement is the problem.
      expect(() => analyzeSqlDataSources('SELECT * FROM "scarr"')).toThrow(SqlSourceAnalysisError);
    });
  });

  it('bounds input size before parsing', () => {
    expect(() => analyzeSqlDataSources(`SELECT * FROM scarr ${' '.repeat(100_001)}`)).toThrow(/too long/i);
  });

  it('always throws SqlSourceAnalysisError so callers can map one stable code', () => {
    for (const sql of ['', 'SELECT * FROM scarr " c', 'SELECT SINGLE * FROM scarr', 'SELECT * FROM (x)']) {
      expect(() => analyzeSqlDataSources(sql)).toThrow(SqlSourceAnalysisError);
    }
  });
});
