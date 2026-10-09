import { describe, expect, it } from 'vitest';
import { spliceMethod } from '../../../src/context/method-surgery.js';
import { validateBeforeWrite } from '../../../src/lint/lint.js';

const source = `CLASS zcl_spacing DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS first RETURNING VALUE(rv_name) TYPE string.
    METHODS second RETURNING VALUE(rv_count) TYPE i.
ENDCLASS.
CLASS zcl_spacing IMPLEMENTATION.
  METHOD first.
    DATA lt_names TYPE string_table.
    rv_name = VALUE #( lt_names[ 1 ] DEFAULT '').
  ENDMETHOD.
  METHOD second.
    rv_count = 1.
  ENDMETHOD.
ENDCLASS.`;
const options = { systemType: 'onprem' as const, abapRelease: '758' };
const filename = 'zcl_spacing.clas.abap';

describe('pre-write spacing findings (#954)', () => {
  it('warns without blocking a create or an unrelated method edit', () => {
    const edited = spliceMethod(source, 'ZCL_SPACING', 'second', '    rv_count = 2.');
    expect(edited.success).toBe(true);
    for (const text of [source, edited.newSource]) {
      const result = validateBeforeWrite(text, filename, options);
      expect(result.pass).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({ rule: 'parser_missing_space', severity: 'warning' }),
      );
    }
  });

  it('still blocks invalid ABAP in the same class', () => {
    const result = validateBeforeWrite(source.replace('rv_count = 1.', 'THIS IS INVALID ABAP.'), filename, options);
    expect(result.pass).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ rule: 'parser_error' }));
  });

  it('also warns for spacing SAP rejects; pre-write lint does not replace activation', () => {
    const result = validateBeforeWrite(
      source.replace('rv_count = 1.', "IF ('bar' = 'bar' ). ENDIF."),
      filename,
      options,
    );
    expect(result.pass).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ rule: 'parser_missing_space', severity: 'warning' }),
    );
  });

  it('honors an explicit administrator severity override', () => {
    const result = validateBeforeWrite(source, filename, {
      ...options,
      ruleOverrides: { parser_missing_space: { severity: 'Error' } },
    });
    expect(result.pass).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ rule: 'parser_missing_space' }));
  });
});
