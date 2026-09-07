import { describe, expect, it } from 'vitest';
import { analyzeAbapSource, extractAbapReferences, SourceParseError } from './abap-extractor.js';
import { analyzeCdsSource, extractGraphObject } from './extractor.js';

const analyze = (source: string) => analyzeAbapSource(source, 'PROG', 'ZGRAPH');

describe('collector parse quality and reference namespaces', () => {
  it('extracts static Open SQL tables, joins and subqueries', () => {
    const result = analyze(`REPORT zgraph.
      SELECT * FROM zorders AS orders INNER JOIN /demo/items AS items ON items~id = orders~id
        WHERE orders~id IN ( SELECT id FROM zfilter ) INTO TABLE @DATA(rows).`);
    expect(result.status).toBe('parsed');
    expect(result.references.filter((ref) => ref.relation === 'reads_from').map((ref) => ref.name)).toEqual([
      'ZORDERS',
      '/DEMO/ITEMS',
      'ZFILTER',
    ]);
  });

  it('does not turn CTE aliases, SQL aliases or host internal tables into repository nodes', () => {
    const result = analyze(`REPORT zgraph.
      WITH +selection AS ( SELECT id FROM zorders ) SELECT * FROM +selection INTO TABLE @DATA(rows).
      SELECT * FROM @rows AS buffered INTO TABLE @DATA(result).`);
    expect(result.status).toBe('parsed');
    expect(result.references).toEqual([expect.objectContaining({ name: 'ZORDERS', relation: 'reads_from' })]);
  });

  it('records dynamic SQL/FMs as coverage gaps, not made-up static names', () => {
    const result = analyze(`REPORT zgraph.
      SELECT * FROM (table_name) INTO TABLE @DATA(rows).
      CALL FUNCTION function_name.
      CALL FUNCTION 'Z_REAL'.
      CALL FUNCTION \`/DEMO/REAL\`.
      " CALL FUNCTION 'Z_COMMENT'.
      DATA(text) = 'SELECT FROM Z_LITERAL'.`);
    expect(result.status).toBe('parsed');
    expect(result.dynamicTargets).toBe(2);
    expect(result.references).toEqual([
      expect.objectContaining({ name: 'Z_REAL', relation: 'function_call' }),
      expect.objectContaining({ name: '/DEMO/REAL', relation: 'function_call' }),
    ]);
  });

  it('filters declared local types while keeping their real DDIC dependency', () => {
    const result = analyze(`REPORT zgraph.
      TYPES local_type TYPE zglobal_type.
      DATA value TYPE local_type.`);
    expect(result.references.map((ref) => ref.name)).toEqual(['ZGLOBAL_TYPE']);
  });

  it('does not let a FORM-local type hide a global type used in another FORM', () => {
    const result = analyze(`REPORT zgraph.
      FORM first.
        TYPES local_only TYPE string.
        DATA x TYPE local_only.
      ENDFORM.
      FORM second.
        DATA x TYPE local_only.
      ENDFORM.`);
    expect(result.references).toEqual([{ line: 7, name: 'LOCAL_ONLY', relation: 'references' }]);
  });

  it('shares class type declarations with its implementation and excludes local classes/interfaces', () => {
    const result = analyzeAbapSource(
      `INTERFACE lif_local. ENDINTERFACE.
      CLASS lcl_helper DEFINITION. ENDCLASS.
      CLASS zgraph DEFINITION.
        PUBLIC SECTION.
          INTERFACES lif_local.
          TYPES item TYPE zddic.
          METHODS run.
      ENDCLASS.
      CLASS zgraph IMPLEMENTATION.
        METHOD run.
          DATA x TYPE item.
          DATA y TYPE REF TO lcl_helper.
          DATA z TYPE REF TO zcl_external.
        ENDMETHOD.
      ENDCLASS.`,
      'PROG',
      'ZGRAPH',
    );
    expect(result.status).toBe('parsed');
    expect(result.references.map((ref) => ref.name)).toEqual(['ZDDIC', 'ZCL_EXTERNAL']);
  });

  it('does not mistake a structure component name for a declared type', () => {
    const result = analyze(`REPORT zgraph.
      TYPES: BEGIN OF local_structure, external_type TYPE i, END OF local_structure.
      DATA x TYPE external_type.`);
    expect(result.status).toBe('parsed');
    expect(result.references.map((ref) => ref.name)).toEqual(['EXTERNAL_TYPE']);
  });

  it('keeps SQL and FM namespace matches even when a local type has the same name', () => {
    const result = analyze(`REPORT zgraph. TYPES zorders TYPE string.
      SELECT * FROM zorders INTO TABLE @DATA(rows). CALL FUNCTION 'ZORDERS'.`);
    expect(result.references.map((ref) => ref.relation)).toEqual(['reads_from', 'function_call']);
  });

  it('keeps a table/function with the same name as the program itself', () => {
    const result = analyze("REPORT zgraph. SELECT * FROM zgraph INTO TABLE @DATA(rows). CALL FUNCTION 'ZGRAPH'.");
    expect(result.references.map((ref) => ref.relation)).toEqual(['reads_from', 'function_call']);
  });

  it.each(['', '" comment only', 'NOT VALID ABAP ???', 'CLASS zgraph DEFINITION.'])(
    'rejects failed/empty source without returning authoritative empty references: %s',
    (source) => {
      expect(analyze(source).status).toBe('failed');
      expect(() => extractAbapReferences(source, 'PROG', 'ZGRAPH')).toThrow(SourceParseError);
    },
  );

  it('reports partially parsed source and never returns its subset as replacement evidence', () => {
    expect(analyze('REPORT zgraph. NOT_A_STATEMENT foo. DATA x TYPE zvalid.')).toMatchObject({
      status: 'partial',
      reasons: ['unknown_statement'],
      references: [],
    });
  });

  it('distinguishes syntactically valid zero-reference source', () => {
    expect(analyze('REPORT zgraph. DATA value TYPE string.')).toMatchObject({
      status: 'parsed',
      references: [],
      reasons: [],
    });
  });

  it('rejects unsupported CDS instead of erasing previous relationships', () => {
    expect(analyzeCdsSource('NOT VALID CDS', 'ZI_BAD').status).toBe('failed');
    expect(() =>
      extractGraphObject({ name: 'ZI_BAD', type: 'DDLS', systemKey: 'S', source: 'NOT VALID CDS' }, []),
    ).toThrow(SourceParseError);
    expect(analyzeCdsSource('define abstract entity ZI_EMPTY { key id : abap.int4; }', 'ZI_EMPTY')).toMatchObject({
      status: 'parsed',
      references: [],
    });
  });
});
