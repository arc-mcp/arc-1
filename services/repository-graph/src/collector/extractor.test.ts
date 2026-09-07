import { describe, expect, it } from 'vitest';
import { extractAbapReferences, extractCdsReferences } from './extractor.js';

describe('metadata graph extraction', () => {
  it('recognizes CDS parent and word-cardinality targets, not syntax keywords', () => {
    const result = extractCdsReferences(`define view entity ZI_CHILD as select from ztab
      association to parent ZI_PARENT as _Parent on _Parent.id = ztab.id
      association of many to exact one /DMO/I_AGENCY as _Agency on _Agency.id = ztab.id
      association to one ZI_OTHER as _Other on _Other.id = ztab.id
      { key ztab.id }`);
    expect(result.filter((item) => item.relation === 'associates_to').map((item) => item.name)).toEqual([
      'ZI_PARENT',
      '/DMO/I_AGENCY',
      'ZI_OTHER',
    ]);
  });

  it('masks CDS literals/comments in lexical order and preserves evidence line numbers', () => {
    const result = extractCdsReferences(`/* header\n+      second line */
      @EndUserText.label: 'https://example.test /* label */'
      define view entity ZI_TEST as select from zreal
      { key id, 'it''s // select from zfake' as label }`);
    expect(result).toEqual([{ name: 'ZREAL', relation: 'reads_from', line: 4 }]);
  });
  it('preserves typed ABAP relationships and SAP standard targets', () => {
    const source = `CLASS zcl_child DEFINITION INHERITING FROM zcl_parent.
  PUBLIC SECTION.
    INTERFACES zif_reader.
ENDCLASS.
CLASS zcl_child IMPLEMENTATION.
  METHOD run.
    cl_abap_context_info=>get_system_date( ).
    zcl_factory=>create( ).
    CALL FUNCTION 'Z_EXTRACT_FM'.
    " zcl_comment_canary=>never( ).
    DATA(text) = 'ZCL_LITERAL_CANARY=>NEVER( ) ARC_SOURCE_CANARY_SECRET'.
  ENDMETHOD.
ENDCLASS.`;
    const result = extractAbapReferences(source, 'CLAS', 'ZCL_CHILD');
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'ZCL_PARENT',
          relation: 'inherits_from',
        }),
        expect.objectContaining({ name: 'ZIF_READER', relation: 'implements' }),
        expect.objectContaining({
          name: 'CL_ABAP_CONTEXT_INFO',
          relation: 'static_call',
        }),
        expect.objectContaining({
          name: 'ZCL_FACTORY',
          relation: 'static_call',
        }),
        expect.objectContaining({
          name: 'Z_EXTRACT_FM',
          relation: 'function_call',
        }),
      ]),
    );
    expect(result.some((edge) => edge.name.includes('CANARY'))).toBe(false);
  });

  it('keeps different CDS relation kinds and ignores source canaries', () => {
    const source = `define root view entity ZI_EXTRACT as select from ztab_extract
      inner join ztab_item on ztab_item.id = ztab_extract.id
      association [0..1] to ZI_CUSTOMER as _Customer on _Customer.id = ztab_extract.customer
      composition [0..*] of ZI_CHILD as _Children
      // association to ZI_COMMENT_CANARY as _Never
      { key ztab_extract.id, 'ARC_SOURCE_CANARY_SECRET' as Marker }`;
    const result = extractCdsReferences(source);
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'ZTAB_EXTRACT',
          relation: 'reads_from',
        }),
        expect.objectContaining({ name: 'ZTAB_ITEM', relation: 'reads_from' }),
        expect.objectContaining({
          name: 'ZI_CUSTOMER',
          relation: 'associates_to',
        }),
        expect.objectContaining({ name: 'ZI_CHILD', relation: 'composes' }),
      ]),
    );
    expect(result.some((edge) => edge.name.includes('CANARY'))).toBe(false);
  });
});
