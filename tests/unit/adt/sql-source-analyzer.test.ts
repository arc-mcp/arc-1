import { describe, expect, it } from 'vitest';

import {
  analyzeSqlDataSources,
  normalizeDataSourceName,
  SqlSourceAnalysisError,
} from '../../../src/adt/sql-source-analyzer.js';

describe('analyzeSqlDataSources', () => {
  it.each([
    ['SELECT * FROM scarr', ['SCARR']],
    ['select carrid from /dmo/i_flight', ['/DMO/I_FLIGHT']],
    ['SELECT * FROM scarr AS a INNER JOIN spfli AS b ON a~carrid = b~carrid', ['SCARR', 'SPFLI']],
    ['SELECT * FROM scarr UNION SELECT * FROM spfli', ['SCARR', 'SPFLI']],
    ['SELECT * FROM scarr WHERE carrid IN ( SELECT carrid FROM spfli )', ['SCARR', 'SPFLI']],
    ['WITH +carrier AS ( SELECT * FROM scarr ) SELECT * FROM +carrier', ['SCARR']],
    ["SELECT * FROM scarr WHERE carrname = '@literal'", ['SCARR']],
    ["SELECT * FROM scarr WHERE carrname = 'a.b;c'", ['SCARR']],
  ])('extracts every static source from %s', (sql, expected) => {
    expect(analyzeSqlDataSources(sql)).toEqual(expected);
  });

  it.each([
    ['empty SQL', ''],
    ['dynamic source', 'SELECT * FROM (lv_table)'],
    ['host variable', 'SELECT * FROM scarr WHERE carrid = @lv_carrid'],
    ['host method expression', 'SELECT * FROM scarr WHERE carrid = @( zcl_demo=>value( ) )'],
    ['privileged access', 'SELECT * FROM i_view WITH PRIVILEGED ACCESS'],
    ['client override', 'SELECT * FROM scarr USING CLIENT @lv_client'],
    ['secondary connection', 'SELECT * FROM scarr CONNECTION (lv_conn)'],
    ['association path', 'SELECT * FROM I_VIEW\\_ASSOC'],
    ['caller target', 'SELECT * FROM scarr INTO TABLE @DATA(rows)'],
    ['two statements', 'SELECT * FROM scarr. SELECT * FROM spfli'],
    ['DML tail', 'SELECT * FROM scarr. DELETE FROM spfli'],
    ['semicolon tail', 'SELECT * FROM scarr; DELETE FROM spfli'],
    ['non-select', 'DELETE FROM scarr'],
    ['malformed select', 'SELECT * scarr'],
  ])('fails closed for %s', (_label, sql) => {
    expect(() => analyzeSqlDataSources(sql)).toThrow(SqlSourceAnalysisError);
  });

  it('bounds input size before parsing', () => {
    expect(() => analyzeSqlDataSources(`SELECT * FROM scarr ${' '.repeat(100_001)}`)).toThrow(/too long/i);
  });

  it.each(['/', '$', '___'])('rejects punctuation-only technical name %j', (name) => {
    expect(() => normalizeDataSourceName(name)).toThrow(SqlSourceAnalysisError);
  });
});
