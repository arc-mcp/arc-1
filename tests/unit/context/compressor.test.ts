/**
 * Unit tests for the context compression orchestrator.
 */

import { describe, expect, it, vi } from 'vitest';
import type { AdtClient } from '../../../src/adt/client.js';
import { compressCdsContext, compressContext, inferObjectType } from '../../../src/context/compressor.js';

/** Create a mock AdtClient */
function mockClient(sources: Record<string, string>): AdtClient {
  return {
    getClass: vi.fn(async (name: string) => {
      const src = sources[name.toUpperCase()];
      if (!src) throw new Error(`Class ${name} not found`);
      return src;
    }),
    getInterface: vi.fn(async (name: string) => {
      const src = sources[name.toUpperCase()];
      if (!src) throw new Error(`Interface ${name} not found`);
      return src;
    }),
    getProgram: vi.fn(async (name: string) => {
      const src = sources[name.toUpperCase()];
      if (!src) throw new Error(`Program ${name} not found`);
      return src;
    }),
    getFunction: vi.fn(async (_group: string, name: string) => {
      const src = sources[name.toUpperCase()];
      if (!src) throw new Error(`Function ${name} not found`);
      return src;
    }),
    searchObject: vi.fn(async () => []),
    http: {},
    safety: {},
  } as unknown as AdtClient;
}

describe('compressContext', () => {
  it('compresses class with dependencies', async () => {
    const mainSource = `CLASS zcl_order DEFINITION PUBLIC.
  PUBLIC SECTION.
    DATA mo_item TYPE REF TO zcl_item.
    INTERFACES zif_order.
ENDCLASS.
CLASS zcl_order IMPLEMENTATION.
ENDCLASS.`;

    const itemSource = `CLASS zcl_item DEFINITION PUBLIC.
  PUBLIC SECTION.
    METHODS get_price RETURNING VALUE(rv) TYPE p.
  PROTECTED SECTION.
    DATA mv_secret TYPE string.
ENDCLASS.
CLASS zcl_item IMPLEMENTATION.
  METHOD get_price. rv = 10. ENDMETHOD.
ENDCLASS.`;

    const intfSource = `INTERFACE zif_order PUBLIC.
  METHODS create.
  METHODS delete.
ENDINTERFACE.`;

    const client = mockClient({
      ZCL_ITEM: itemSource,
      ZIF_ORDER: intfSource,
    });

    const result = await compressContext(client, mainSource, 'zcl_order', 'CLAS');

    expect(result.depsResolved).toBeGreaterThanOrEqual(2);
    expect(result.output).toContain('zcl_item');
    expect(result.output).toContain('zif_order');
    // Contract should have public methods only
    expect(result.output).toContain('get_price');
    expect(result.output).not.toContain('mv_secret');
    // Interface should be fully included
    expect(result.output).toContain('create');
    expect(result.output).toContain('delete');
  });

  it('respects maxDeps limit', async () => {
    const mainSource = `CLASS zcl_test DEFINITION PUBLIC.
  PUBLIC SECTION.
    DATA m1 TYPE REF TO zcl_dep1.
    DATA m2 TYPE REF TO zcl_dep2.
    DATA m3 TYPE REF TO zcl_dep3.
ENDCLASS.
CLASS zcl_test IMPLEMENTATION.
ENDCLASS.`;

    const depSource = (name: string) => `CLASS ${name} DEFINITION PUBLIC.
  PUBLIC SECTION.
    METHODS run.
ENDCLASS.
CLASS ${name} IMPLEMENTATION.
  METHOD run. ENDMETHOD.
ENDCLASS.`;

    const client = mockClient({
      ZCL_DEP1: depSource('zcl_dep1'),
      ZCL_DEP2: depSource('zcl_dep2'),
      ZCL_DEP3: depSource('zcl_dep3'),
    });

    const result = await compressContext(client, mainSource, 'zcl_test', 'CLAS', 2);

    // Should resolve at most 2
    expect(result.depsResolved).toBeLessThanOrEqual(2);
  });

  it('handles fetch failures gracefully', async () => {
    const mainSource = `CLASS zcl_test DEFINITION PUBLIC.
  PUBLIC SECTION.
    DATA mo TYPE REF TO zcl_missing.
    DATA mi TYPE REF TO zcl_ok.
ENDCLASS.
CLASS zcl_test IMPLEMENTATION.
ENDCLASS.`;

    const client = mockClient({
      ZCL_OK: `CLASS zcl_ok DEFINITION PUBLIC.
  PUBLIC SECTION.
    METHODS run.
ENDCLASS.
CLASS zcl_ok IMPLEMENTATION.
  METHOD run. ENDMETHOD.
ENDCLASS.`,
    });

    const result = await compressContext(client, mainSource, 'zcl_test', 'CLAS');

    // One should succeed, one should fail
    expect(result.depsResolved).toBeGreaterThanOrEqual(1);
    expect(result.depsFailed).toBeGreaterThanOrEqual(1);
    expect(result.output).toContain('Failed dependencies');
    expect(result.output).toContain('zcl_missing');
  });

  it('formats output with stats line', async () => {
    const mainSource = `CLASS zcl_test DEFINITION PUBLIC.
  PUBLIC SECTION.
    DATA mo TYPE REF TO zcl_dep.
ENDCLASS.
CLASS zcl_test IMPLEMENTATION.
ENDCLASS.`;

    const client = mockClient({
      ZCL_DEP: `CLASS zcl_dep DEFINITION PUBLIC.
  PUBLIC SECTION.
    METHODS run.
ENDCLASS.
CLASS zcl_dep IMPLEMENTATION.
  METHOD run. ENDMETHOD.
ENDCLASS.`,
    });

    const result = await compressContext(client, mainSource, 'zcl_test', 'CLAS');

    expect(result.output).toContain('=== Dependency context for zcl_test');
    expect(result.output).toContain('Stats:');
    expect(result.output).toContain('resolved');
  });

  it('returns empty output for source with no dependencies', async () => {
    const mainSource = `CLASS zcl_standalone DEFINITION PUBLIC.
  PUBLIC SECTION.
    METHODS run.
ENDCLASS.
CLASS zcl_standalone IMPLEMENTATION.
  METHOD run. ENDMETHOD.
ENDCLASS.`;

    const client = mockClient({});

    const result = await compressContext(client, mainSource, 'zcl_standalone', 'CLAS');
    expect(result.depsFound).toBe(0);
    expect(result.depsResolved).toBe(0);
  });

  it('handles depth=2 resolving transitive dependencies', async () => {
    const mainSource = `CLASS zcl_a DEFINITION PUBLIC.
  PUBLIC SECTION.
    DATA mo TYPE REF TO zcl_b.
ENDCLASS.
CLASS zcl_a IMPLEMENTATION.
ENDCLASS.`;

    const bSource = `CLASS zcl_b DEFINITION PUBLIC.
  PUBLIC SECTION.
    DATA mo TYPE REF TO zcl_c.
    METHODS run.
ENDCLASS.
CLASS zcl_b IMPLEMENTATION.
  METHOD run. ENDMETHOD.
ENDCLASS.`;

    const cSource = `CLASS zcl_c DEFINITION PUBLIC.
  PUBLIC SECTION.
    METHODS deep_method.
ENDCLASS.
CLASS zcl_c IMPLEMENTATION.
  METHOD deep_method. ENDMETHOD.
ENDCLASS.`;

    const client = mockClient({
      ZCL_B: bSource,
      ZCL_C: cSource,
    });

    // depth=1: only zcl_b
    const shallow = await compressContext(client, mainSource, 'zcl_a', 'CLAS', 20, 1);
    expect(shallow.output).toContain('zcl_b');
    expect(shallow.output).not.toContain('deep_method');

    // depth=2: zcl_b + zcl_c
    const deep = await compressContext(client, mainSource, 'zcl_a', 'CLAS', 20, 2);
    expect(deep.output).toContain('zcl_b');
    expect(deep.output).toContain('zcl_c');
    expect(deep.output).toContain('deep_method');
  });

  it('detects cycles and does not loop infinitely', async () => {
    const aSource = `CLASS zcl_a DEFINITION PUBLIC.
  PUBLIC SECTION.
    DATA mo TYPE REF TO zcl_b.
ENDCLASS.
CLASS zcl_a IMPLEMENTATION.
ENDCLASS.`;

    const bSource = `CLASS zcl_b DEFINITION PUBLIC.
  PUBLIC SECTION.
    DATA mo TYPE REF TO zcl_a.
    METHODS run.
ENDCLASS.
CLASS zcl_b IMPLEMENTATION.
  METHOD run. ENDMETHOD.
ENDCLASS.`;

    const client = mockClient({
      ZCL_A: aSource,
      ZCL_B: bSource,
    });

    // Should not hang — cycle detection prevents infinite recursion
    const result = await compressContext(client, aSource, 'zcl_a', 'CLAS', 20, 3);
    expect(result.depsResolved).toBeGreaterThanOrEqual(1);
    // zcl_a is in the seen set from the start, so zcl_b's reference to zcl_a is skipped
    expect(result.output).toContain('zcl_b');
  });
});

describe('inferObjectType', () => {
  it('infers INTF from interface dependency kind', () => {
    expect(inferObjectType({ name: 'ZIF_ORDER', kind: 'interface', line: 1 })).toBe('INTF');
  });

  it('infers FUNC from function_call kind', () => {
    expect(inferObjectType({ name: 'Z_DELIVERY_FM', kind: 'function_call', line: 1 })).toBe('FUNC');
  });

  it('infers INTF from ZIF_ naming convention', () => {
    expect(inferObjectType({ name: 'ZIF_TEST', kind: 'type_ref', line: 1 })).toBe('INTF');
  });

  it('infers INTF from IF_ naming convention', () => {
    expect(inferObjectType({ name: 'IF_SERIALIZABLE', kind: 'type_ref', line: 1 })).toBe('INTF');
  });

  it('infers CLAS from ZCL_ naming convention', () => {
    expect(inferObjectType({ name: 'ZCL_ORDER', kind: 'type_ref', line: 1 })).toBe('CLAS');
  });

  it('infers CLAS from CX_ exception naming', () => {
    expect(inferObjectType({ name: 'ZCX_NOT_FOUND', kind: 'exception', line: 1 })).toBe('CLAS');
  });

  it('infers INTF from namespaced interface', () => {
    expect(inferObjectType({ name: '/DMO/IF_FLIGHT', kind: 'type_ref', line: 1 })).toBe('INTF');
  });

  it('infers CLAS from namespaced class', () => {
    expect(inferObjectType({ name: '/DMO/CL_FLIGHT', kind: 'type_ref', line: 1 })).toBe('CLAS');
  });

  it('defaults to CLAS for unknown names', () => {
    expect(inferObjectType({ name: 'SOME_OBJECT', kind: 'type_ref', line: 1 })).toBe('CLAS');
  });
});

// ─── CDS Context ──────────────────────────────────────────────────

/** Create a mock AdtClient for CDS context tests */
function mockCdsClient(sources: {
  ddls?: Record<string, string>;
  tables?: Record<string, string>;
  structures?: Record<string, string>;
}): AdtClient {
  return {
    getDdls: vi.fn(async (name: string) => {
      const src = sources.ddls?.[name.toUpperCase()];
      if (!src) throw new Error(`DDLS ${name} not found`);
      return src;
    }),
    // Model B: getTabl unifies transparent tables and structures (TADIR R3TR TABL).
    // The mock checks both `tables` and `structures` lookup tables in turn.
    getTabl: vi.fn(async (name: string) => {
      const upper = name.toUpperCase();
      const src = sources.tables?.[upper] ?? sources.structures?.[upper];
      if (!src) throw new Error(`TABL ${name} not found`);
      return src;
    }),
    // Kept for backward compatibility with any tests that still use the
    // low-level methods directly.
    getTable: vi.fn(async (name: string) => {
      const src = sources.tables?.[name.toUpperCase()];
      if (!src) throw new Error(`Table ${name} not found`);
      return src;
    }),
    getStructure: vi.fn(async (name: string) => {
      const src = sources.structures?.[name.toUpperCase()];
      if (!src) throw new Error(`Structure ${name} not found`);
      return src;
    }),
    http: {},
    safety: {},
  } as unknown as AdtClient;
}

describe('compressCdsContext', () => {
  it('resolves table dependency from CDS view', async () => {
    const ddlSource = `define view entity ZI_ORDER as select from zsalesorder { key order_id }`;
    const client = mockCdsClient({
      tables: {
        ZSALESORDER: `@EndUserText.label : 'Sales Order'\ndefine table zsalesorder {\n  key order_id : numc10;\n  customer : char10;\n}`,
      },
    });

    const result = await compressCdsContext(client, ddlSource, 'ZI_ORDER');

    expect(result.depsResolved).toBe(1);
    expect(result.output).toContain('zsalesorder');
    expect(result.output).toContain('table');
    expect(result.output).toContain('CDS dependency context for ZI_ORDER');
  });

  it('resolves CDS view dependency (tries getDdls first)', async () => {
    const ddlSource = `
define view entity ZC_ORDER as projection on ZI_ORDER { key OrderId }`;
    const client = mockCdsClient({
      ddls: {
        ZI_ORDER: `define view entity ZI_ORDER as select from zsalesorder { key order_id as OrderId }`,
      },
    });

    const result = await compressCdsContext(client, ddlSource, 'ZC_ORDER');

    expect(result.depsResolved).toBe(1);
    expect(result.output).toContain('ZI_ORDER');
    expect(result.output).toContain('ddls');
  });

  it('handles failed dependencies gracefully', async () => {
    const ddlSource = `
define view entity ZI_TEST as select from ztable
  association [0..*] to ZI_MISSING as _Missing on _Missing.Id = $projection.Id
{ key field1, _Missing }`;
    const client = mockCdsClient({
      tables: { ZTABLE: 'define table ztable { key field1 : char10; }' },
    });

    const result = await compressCdsContext(client, ddlSource, 'ZI_TEST');

    expect(result.depsResolved).toBeGreaterThanOrEqual(1);
    expect(result.depsFailed).toBeGreaterThanOrEqual(1);
    expect(result.output).toContain('Failed dependencies');
    expect(result.output).toContain('ZI_MISSING');
  });

  it('respects maxDeps limit', async () => {
    const ddlSource = `
define view entity ZI_TEST as select from ztable1
  inner join ztable2 on ztable1.id = ztable2.id
  inner join ztable3 on ztable1.id = ztable3.id
{ key ztable1.id }`;
    const client = mockCdsClient({
      tables: {
        ZTABLE1: 'define table ztable1 { key id : char10; }',
        ZTABLE2: 'define table ztable2 { key id : char10; }',
        ZTABLE3: 'define table ztable3 { key id : char10; }',
      },
    });

    const result = await compressCdsContext(client, ddlSource, 'ZI_TEST', 2);

    expect(result.depsResolved).toBeLessThanOrEqual(2);
  });

  it('handles depth=2 resolving transitive CDS dependencies', async () => {
    const ddlSourceA = `define view entity ZC_A as projection on ZI_B { key Id }`;
    const ddlSourceB = `define view entity ZI_B as select from ztable { key id as Id }`;
    const client = mockCdsClient({
      ddls: {
        ZI_B: ddlSourceB,
      },
      tables: {
        ZTABLE: 'define table ztable { key id : char10; }',
      },
    });

    // depth=1: only ZI_B resolved as a dependency (ztable not resolved as its own dep)
    const shallow = await compressCdsContext(client, ddlSourceA, 'ZC_A', 20, 1);
    expect(shallow.output).toContain('ZI_B');
    expect(shallow.depsResolved).toBe(1);

    // depth=2: ZI_B + ztable (transitive dep from ZI_B's DDL)
    const deep = await compressCdsContext(client, ddlSourceA, 'ZC_A', 20, 2);
    expect(deep.output).toContain('ZI_B');
    expect(deep.output).toContain('* --- ztable');
    expect(deep.depsResolved).toBe(2);
  });

  it('detects cycles and does not loop infinitely', async () => {
    const ddlSourceA = `define view entity ZI_A as select from ZI_B { key id }`;
    const ddlSourceB = `define view entity ZI_B as select from ZI_A { key id }`;
    const client = mockCdsClient({
      ddls: {
        ZI_A: ddlSourceA,
        ZI_B: ddlSourceB,
      },
    });

    const result = await compressCdsContext(client, ddlSourceA, 'ZI_A', 20, 3);
    expect(result.depsResolved).toBeGreaterThanOrEqual(1);
    expect(result.output).toContain('ZI_B');
  });

  it('formats output with stats line', async () => {
    const ddlSource = `define view entity ZI_TEST as select from ztable { key field1 }`;
    const client = mockCdsClient({
      tables: { ZTABLE: 'define table ztable { key field1 : char10; }' },
    });

    const result = await compressCdsContext(client, ddlSource, 'ZI_TEST');

    expect(result.output).toContain('CDS dependency context for ZI_TEST');
    expect(result.output).toContain('Stats:');
    expect(result.output).toContain('resolved');
    expect(result.objectType).toBe('DDLS');
  });
});
