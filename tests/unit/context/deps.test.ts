/**
 * Unit tests for AST-based ABAP dependency extraction.
 */

import { describe, expect, it } from 'vitest';
import { extractDependencies } from '../../../src/context/deps.js';

describe('extractDependencies', () => {
  // ─── TYPE REF TO ────────────────────────────────────────────────────

  it('extracts TYPE REF TO references', () => {
    const source = `CLASS zcl_test DEFINITION.
  PUBLIC SECTION.
    DATA mo_item TYPE REF TO zcl_item.
ENDCLASS.
CLASS zcl_test IMPLEMENTATION.
ENDCLASS.`;
    const deps = extractDependencies(source, 'zcl_test');
    expect(deps.some((d) => d.name.toUpperCase() === 'ZCL_ITEM')).toBe(true);
  });

  // ─── NEW (v7.40+) ──────────────────────────────────────────────────

  it('extracts NEW instantiation', () => {
    const source = `CLASS zcl_test DEFINITION.
  PUBLIC SECTION.
    METHODS run.
ENDCLASS.
CLASS zcl_test IMPLEMENTATION.
  METHOD run.
    DATA(lo) = NEW zcl_helper( ).
  ENDMETHOD.
ENDCLASS.`;
    const deps = extractDependencies(source, 'zcl_test');
    expect(deps.some((d) => d.name.toUpperCase() === 'ZCL_HELPER')).toBe(true);
  });

  // ─── Static call (=>) ──────────────────────────────────────────────

  it('extracts static method calls', () => {
    const source = `CLASS zcl_test DEFINITION.
  PUBLIC SECTION.
    METHODS run.
ENDCLASS.
CLASS zcl_test IMPLEMENTATION.
  METHOD run.
    zcl_factory=>create( ).
  ENDMETHOD.
ENDCLASS.`;
    const deps = extractDependencies(source, 'zcl_test');
    expect(deps.some((d) => d.name.toUpperCase() === 'ZCL_FACTORY')).toBe(true);
  });

  // ─── Interface use (~) ─────────────────────────────────────────────

  it('extracts INTERFACES statement', () => {
    const source = `CLASS zcl_test DEFINITION.
  PUBLIC SECTION.
    INTERFACES zif_order.
    INTERFACES zif_printable.
ENDCLASS.
CLASS zcl_test IMPLEMENTATION.
ENDCLASS.`;
    const deps = extractDependencies(source, 'zcl_test');
    const names = deps.map((d) => d.name.toUpperCase());
    expect(names).toContain('ZIF_ORDER');
    expect(names).toContain('ZIF_PRINTABLE');
    // Check kind
    const ifDep = deps.find((d) => d.name.toUpperCase() === 'ZIF_ORDER');
    expect(ifDep?.kind).toBe('interface');
  });

  // ─── INHERITING FROM ──────────────────────────────────────────────

  it('extracts INHERITING FROM', () => {
    const source = `CLASS zcl_child DEFINITION INHERITING FROM zcl_parent.
  PUBLIC SECTION.
ENDCLASS.
CLASS zcl_child IMPLEMENTATION.
ENDCLASS.`;
    const deps = extractDependencies(source, 'zcl_child');
    const parent = deps.find((d) => d.name.toUpperCase() === 'ZCL_PARENT');
    expect(parent).toBeDefined();
    expect(parent?.kind).toBe('inheritance');
  });

  // ─── CALL FUNCTION ────────────────────────────────────────────────

  it('extracts CALL FUNCTION', () => {
    const source = `CLASS zcl_test DEFINITION.
  PUBLIC SECTION.
    METHODS run.
ENDCLASS.
CLASS zcl_test IMPLEMENTATION.
  METHOD run.
    CALL FUNCTION 'Z_DELIVERY_FM'
      EXPORTING iv_id = '123'.
  ENDMETHOD.
ENDCLASS.`;
    const deps = extractDependencies(source, 'zcl_test');
    const fm = deps.find((d) => d.name.toUpperCase() === 'Z_DELIVERY_FM');
    expect(fm).toBeDefined();
    expect(fm?.kind).toBe('function_call');
  });

  // ─── CAST (v7.40+) ────────────────────────────────────────────────

  it('extracts CAST', () => {
    const source = `CLASS zcl_test DEFINITION.
  PUBLIC SECTION.
    METHODS run.
ENDCLASS.
CLASS zcl_test IMPLEMENTATION.
  METHOD run.
    DATA lo TYPE REF TO object.
    DATA(li) = CAST zif_handler( lo ).
  ENDMETHOD.
ENDCLASS.`;
    const deps = extractDependencies(source, 'zcl_test');
    expect(deps.some((d) => d.name.toUpperCase() === 'ZIF_HANDLER')).toBe(true);
  });

  // ─── RAISING / CATCH ──────────────────────────────────────────────

  it('extracts RAISING exception classes', () => {
    const source = `CLASS zcl_test DEFINITION.
  PUBLIC SECTION.
    METHODS run RAISING zcx_not_found.
ENDCLASS.
CLASS zcl_test IMPLEMENTATION.
  METHOD run.
  ENDMETHOD.
ENDCLASS.`;
    const deps = extractDependencies(source, 'zcl_test');
    expect(deps.some((d) => d.name.toUpperCase() === 'ZCX_NOT_FOUND')).toBe(true);
  });

  it('extracts CATCH exception classes', () => {
    const source = `CLASS zcl_test DEFINITION.
  PUBLIC SECTION.
    METHODS run.
ENDCLASS.
CLASS zcl_test IMPLEMENTATION.
  METHOD run.
    TRY.
      CATCH zcx_not_found zcx_general.
    ENDTRY.
  ENDMETHOD.
ENDCLASS.`;
    const deps = extractDependencies(source, 'zcl_test');
    const names = deps.map((d) => d.name.toUpperCase());
    expect(names).toContain('ZCX_NOT_FOUND');
    expect(names).toContain('ZCX_GENERAL');
  });

  // ─── Filtering ────────────────────────────────────────────────────

  it('filters built-in types', () => {
    const source = `CLASS zcl_test DEFINITION.
  PUBLIC SECTION.
    DATA mv_str TYPE string.
    DATA mv_int TYPE i.
    DATA mv_bool TYPE abap_bool.
ENDCLASS.
CLASS zcl_test IMPLEMENTATION.
ENDCLASS.`;
    const deps = extractDependencies(source, 'zcl_test');
    const names = deps.map((d) => d.name.toUpperCase());
    expect(names).not.toContain('STRING');
    expect(names).not.toContain('I');
    expect(names).not.toContain('ABAP_BOOL');
  });

  it('filters SAP standard objects', () => {
    const source = `CLASS zcl_test DEFINITION.
  PUBLIC SECTION.
    DATA mo TYPE REF TO cl_abap_typedescr.
    DATA mi TYPE REF TO if_abap_timer.
ENDCLASS.
CLASS zcl_test IMPLEMENTATION.
ENDCLASS.`;
    const deps = extractDependencies(source, 'zcl_test');
    const names = deps.map((d) => d.name.toUpperCase());
    expect(names).not.toContain('CL_ABAP_TYPEDESCR');
    expect(names).not.toContain('IF_ABAP_TIMER');
  });

  it('includes SAP standard when filtering disabled', () => {
    const source = `CLASS zcl_test DEFINITION.
  PUBLIC SECTION.
    DATA mo TYPE REF TO cl_abap_typedescr.
ENDCLASS.
CLASS zcl_test IMPLEMENTATION.
ENDCLASS.`;
    const deps = extractDependencies(source, 'zcl_test', false);
    expect(deps.some((d) => d.name.toUpperCase() === 'CL_ABAP_TYPEDESCR')).toBe(true);
  });

  it('filters self-references', () => {
    const source = `CLASS zcl_test DEFINITION.
  PUBLIC SECTION.
    DATA mo TYPE REF TO zcl_test.
ENDCLASS.
CLASS zcl_test IMPLEMENTATION.
ENDCLASS.`;
    const deps = extractDependencies(source, 'zcl_test');
    expect(deps.some((d) => d.name.toUpperCase() === 'ZCL_TEST')).toBe(false);
  });

  // ─── Deduplication ────────────────────────────────────────────────

  it('deduplicates by name', () => {
    const source = `CLASS zcl_test DEFINITION.
  PUBLIC SECTION.
    DATA mo TYPE REF TO zcl_item.
    DATA mo2 TYPE REF TO zcl_item.
    METHODS run IMPORTING io TYPE REF TO zcl_item.
ENDCLASS.
CLASS zcl_test IMPLEMENTATION.
  METHOD run.
  ENDMETHOD.
ENDCLASS.`;
    const deps = extractDependencies(source, 'zcl_test');
    const itemDeps = deps.filter((d) => d.name.toUpperCase() === 'ZCL_ITEM');
    expect(itemDeps).toHaveLength(1);
  });

  // ─── Sorting ──────────────────────────────────────────────────────

  it('sorts custom objects (Z*) before standard', () => {
    const source = `CLASS zcl_test DEFINITION.
  PUBLIC SECTION.
    DATA mo1 TYPE REF TO cl_rest_client.
    DATA mo2 TYPE REF TO zcl_helper.
ENDCLASS.
CLASS zcl_test IMPLEMENTATION.
ENDCLASS.`;
    // Disable SAP standard filtering to see both
    const deps = extractDependencies(source, 'zcl_test', false);
    const zcl = deps.findIndex((d) => d.name.toUpperCase() === 'ZCL_HELPER');
    const cl = deps.findIndex((d) => d.name.toUpperCase() === 'CL_REST_CLIENT');
    expect(zcl).toBeLessThan(cl);
  });

  // ─── Edge cases ───────────────────────────────────────────────────

  it('handles empty source', () => {
    const deps = extractDependencies('', 'zcl_test');
    expect(deps).toHaveLength(0);
  });

  it('handles interface source', () => {
    const source = `INTERFACE zif_test PUBLIC.
  METHODS run IMPORTING io TYPE REF TO zcl_item RAISING zcx_error.
ENDINTERFACE.`;
    const deps = extractDependencies(source, 'zif_test');
    const names = deps.map((d) => d.name.toUpperCase());
    expect(names).toContain('ZCL_ITEM');
    expect(names).toContain('ZCX_ERROR');
  });

  it('extracts multiple dependency types from a realistic class', () => {
    const source = `CLASS zcl_order DEFINITION PUBLIC INHERITING FROM zcl_base CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_order.
    INTERFACES zif_printable.
    DATA mo_item TYPE REF TO zcl_item.
    METHODS constructor IMPORTING iv_id TYPE string RAISING zcx_not_found.
    METHODS process RETURNING VALUE(rv_ok) TYPE abap_bool.
  PROTECTED SECTION.
    DATA mv_id TYPE string.
  PRIVATE SECTION.
    DATA mt_cache TYPE TABLE OF string.
ENDCLASS.
CLASS zcl_order IMPLEMENTATION.
  METHOD constructor.
    DATA lo_util TYPE REF TO zcl_util.
    zcl_factory=>create( ).
    CALL FUNCTION 'Z_DELIVERY_FM'
      EXPORTING iv_id = iv_id.
    TRY.
      CATCH zcx_not_found zcx_general.
    ENDTRY.
  ENDMETHOD.
  METHOD process.
    rv_ok = abap_true.
  ENDMETHOD.
ENDCLASS.`;
    const deps = extractDependencies(source, 'zcl_order');
    const names = deps.map((d) => d.name.toUpperCase());

    // Should find all these dependencies
    expect(names).toContain('ZCL_BASE'); // INHERITING FROM
    expect(names).toContain('ZIF_ORDER'); // INTERFACES
    expect(names).toContain('ZIF_PRINTABLE'); // INTERFACES
    expect(names).toContain('ZCL_ITEM'); // TYPE REF TO
    expect(names).toContain('ZCX_NOT_FOUND'); // RAISING / CATCH
    expect(names).toContain('ZCL_UTIL'); // TYPE REF TO
    expect(names).toContain('ZCL_FACTORY'); // Static call
    expect(names).toContain('Z_DELIVERY_FM'); // CALL FUNCTION
    expect(names).toContain('ZCX_GENERAL'); // CATCH

    // Should NOT contain built-ins or self
    expect(names).not.toContain('ZCL_ORDER');
    expect(names).not.toContain('STRING');
    expect(names).not.toContain('ABAP_BOOL');
  });

  it('extracts dependencies with line numbers', () => {
    const source = `CLASS zcl_test DEFINITION INHERITING FROM zcl_parent.
  PUBLIC SECTION.
    DATA mo TYPE REF TO zcl_item.
ENDCLASS.
CLASS zcl_test IMPLEMENTATION.
ENDCLASS.`;
    const deps = extractDependencies(source, 'zcl_test');
    for (const dep of deps) {
      expect(dep.line).toBeGreaterThan(0);
    }
  });

  // ─── Function module bodies ───────────────────────────────────────

  describe('function module bodies', () => {
    it('extracts dependencies when the signature is inside the FUNCTION statement', () => {
      // How ADT returns a function module's source/main.
      const source = [
        'FUNCTION z_demo_confirm',
        '  IMPORTING',
        "    VALUE(iv_mode) TYPE char1 DEFAULT 'X'",
        '  EXPORTING',
        '    VALUE(et_return) TYPE bapirettab.',
        '',
        '  zcl_demo_cleanup=>run( ).',
        "  CALL FUNCTION 'Z_DEMO_POST'.",
        'ENDFUNCTION.',
      ].join('\r\n');
      const names = extractDependencies(source, 'Z_DEMO_CONFIRM').map((d) => d.name.toUpperCase());
      expect(names).toContain('ZCL_DEMO_CLEANUP');
      expect(names).toContain('Z_DEMO_POST');
    });

    it('extracts dependencies after a classic header with parameter comments', () => {
      const source = `FUNCTION z_demo_save.
*"----------------------------------------------------------------------
*"*"Local Interface:
*"  IMPORTING
*"     VALUE(IV_ID) TYPE  CHAR10
*"----------------------------------------------------------------------
  DATA lo_store TYPE REF TO zcl_demo_store.
  lo_store = NEW #( ).
ENDFUNCTION.`;
      const names = extractDependencies(source, 'Z_DEMO_SAVE').map((d) => d.name.toUpperCase());
      expect(names).toContain('ZCL_DEMO_STORE');
    });

    it('extracts dependencies of a namespaced function module', () => {
      const source = [
        '"! Writes the log',
        'FUNCTION /demo/log_write.',
        '  /demo/cl_log=>flush( ).',
        'ENDFUNCTION.',
      ].join('\n');
      const names = extractDependencies(source, '/DEMO/LOG_WRITE').map((d) => d.name.toUpperCase());
      expect(names).toContain('/DEMO/CL_LOG');
    });
  });
});
