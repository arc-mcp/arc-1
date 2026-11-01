/**
 * Unit tests for method-level surgery.
 */

import { describe, expect, it } from 'vitest';
import { extractMethod, formatMethodListing, listMethods, spliceMethod } from '../../../src/context/method-surgery.js';

// ─── Test Fixtures ──────────────────────────────────────────────────

const SIMPLE_CLASS = `CLASS zcl_order DEFINITION PUBLIC.
  PUBLIC SECTION.
    METHODS get_id RETURNING VALUE(rv_id) TYPE string.
    METHODS process RETURNING VALUE(rv_ok) TYPE abap_bool.
  PROTECTED SECTION.
    METHODS helper.
  PRIVATE SECTION.
    METHODS _init.
ENDCLASS.
CLASS zcl_order IMPLEMENTATION.
  METHOD get_id.
    rv_id = mv_id.
  ENDMETHOD.
  METHOD process.
    DATA lv_result TYPE abap_bool.
    lv_result = abap_true.
    rv_ok = lv_result.
  ENDMETHOD.
  METHOD helper.
    " internal helper
  ENDMETHOD.
  METHOD _init.
    mv_id = 'default'.
  ENDMETHOD.
ENDCLASS.`;

const INTERFACE_CLASS = `CLASS zcl_impl DEFINITION PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_order.
    METHODS run.
ENDCLASS.
CLASS zcl_impl IMPLEMENTATION.
  METHOD zif_order~create.
    rv_id = 'new'.
  ENDMETHOD.
  METHOD zif_order~delete.
    " delete logic
  ENDMETHOD.
  METHOD run.
    " main logic
  ENDMETHOD.
ENDCLASS.`;

const REDEFINITION_CLASS = `CLASS zcl_child DEFINITION PUBLIC INHERITING FROM zcl_parent.
  PUBLIC SECTION.
    METHODS run REDEFINITION.
    METHODS get_name RETURNING VALUE(rv) TYPE string.
ENDCLASS.
CLASS zcl_child IMPLEMENTATION.
  METHOD run.
    super->run( ).
    " child logic
  ENDMETHOD.
  METHOD get_name.
    rv = 'child'.
  ENDMETHOD.
ENDCLASS.`;

const EMPTY_BODY_CLASS = `CLASS zcl_stub DEFINITION PUBLIC.
  PUBLIC SECTION.
    METHODS noop.
ENDCLASS.
CLASS zcl_stub IMPLEMENTATION.
  METHOD noop.
  ENDMETHOD.
ENDCLASS.`;

// ─── listMethods Tests ──────────────────────────────────────────────

describe('listMethods', () => {
  it('lists methods with correct visibility', () => {
    const result = listMethods(SIMPLE_CLASS, 'zcl_order');
    expect(result.success).toBe(true);
    expect(result.methods.length).toBe(4);

    const names = result.methods.map((m) => m.name.toUpperCase());
    expect(names).toContain('GET_ID');
    expect(names).toContain('PROCESS');
    expect(names).toContain('HELPER');
    expect(names).toContain('_INIT');

    // Visibility
    const getId = result.methods.find((m) => m.name.toUpperCase() === 'GET_ID');
    expect(getId?.visibility).toBe('public');

    const helper = result.methods.find((m) => m.name.toUpperCase() === 'HELPER');
    expect(helper?.visibility).toBe('protected');

    const init = result.methods.find((m) => m.name.toUpperCase() === '_INIT');
    expect(init?.visibility).toBe('private');
  });

  it('extracts method signatures', () => {
    const result = listMethods(SIMPLE_CLASS, 'zcl_order');
    const getId = result.methods.find((m) => m.name.toUpperCase() === 'GET_ID');
    expect(getId?.signature).toContain('RETURNING');
    expect(getId?.signature).toContain('rv_id');
    expect(getId?.signature).toContain('string');
  });

  it('returns valid line ranges', () => {
    const result = listMethods(SIMPLE_CLASS, 'zcl_order');
    for (const method of result.methods) {
      expect(method.startLine).toBeGreaterThan(0);
      expect(method.endLine).toBeGreaterThanOrEqual(method.startLine);
    }
  });

  it('detects interface methods', () => {
    const result = listMethods(INTERFACE_CLASS, 'zcl_impl');
    expect(result.success).toBe(true);

    const ifMethods = result.methods.filter((m) => m.isInterfaceMethod);
    expect(ifMethods.length).toBeGreaterThanOrEqual(2);

    const create = result.methods.find((m) => m.name.toUpperCase().includes('CREATE'));
    expect(create?.isInterfaceMethod).toBe(true);
  });

  it('detects REDEFINITION keyword', () => {
    const result = listMethods(REDEFINITION_CLASS, 'zcl_child');
    expect(result.success).toBe(true);

    const run = result.methods.find((m) => m.name.toUpperCase() === 'RUN');
    expect(run?.isRedefinition).toBe(true);

    const getName = result.methods.find((m) => m.name.toUpperCase() === 'GET_NAME');
    expect(getName?.isRedefinition).toBe(false);
  });

  it('handles empty class', () => {
    const source = `CLASS zcl_empty DEFINITION PUBLIC.
  PUBLIC SECTION.
ENDCLASS.
CLASS zcl_empty IMPLEMENTATION.
ENDCLASS.`;
    const result = listMethods(source, 'zcl_empty');
    expect(result.success).toBe(true);
    expect(result.methods.length).toBe(0);
  });

  it('sorts methods: public > protected > private', () => {
    const result = listMethods(SIMPLE_CLASS, 'zcl_order');
    const visibilities = result.methods.map((m) => m.visibility);
    const publicIdx = visibilities.indexOf('public');
    const protectedIdx = visibilities.indexOf('protected');
    const privateIdx = visibilities.indexOf('private');

    if (publicIdx >= 0 && protectedIdx >= 0) expect(publicIdx).toBeLessThan(protectedIdx);
    if (protectedIdx >= 0 && privateIdx >= 0) expect(protectedIdx).toBeLessThan(privateIdx);
  });

  it('handles namespaced class names', () => {
    const source = `CLASS /dmo/cl_flight DEFINITION PUBLIC.
  PUBLIC SECTION.
    METHODS get_flight RETURNING VALUE(rv) TYPE string.
ENDCLASS.
CLASS /dmo/cl_flight IMPLEMENTATION.
  METHOD get_flight.
    rv = 'LH123'.
  ENDMETHOD.
ENDCLASS.`;
    const result = listMethods(source, '/DMO/CL_FLIGHT');
    expect(result.success).toBe(true);
    expect(result.methods.length).toBe(1);
  });
});

// ─── extractMethod Tests ────────────────────────────────────────────

describe('extractMethod', () => {
  it('extracts a method by exact name', () => {
    const result = extractMethod(SIMPLE_CLASS, 'zcl_order', 'get_id');
    expect(result.success).toBe(true);
    expect(result.methodSource).toContain('METHOD get_id');
    expect(result.methodSource).toContain('ENDMETHOD');
    expect(result.bodySource).toContain('rv_id = mv_id');
  });

  it('extracts interface method by full name', () => {
    const result = extractMethod(INTERFACE_CLASS, 'zcl_impl', 'zif_order~create');
    expect(result.success).toBe(true);
    expect(result.methodSource).toContain('METHOD zif_order~create');
    expect(result.bodySource).toContain("rv_id = 'new'");
  });

  it('extracts interface method by short name (fuzzy match)', () => {
    const result = extractMethod(INTERFACE_CLASS, 'zcl_impl', 'create');
    expect(result.success).toBe(true);
    expect(result.methodName.toUpperCase()).toContain('CREATE');
    expect(result.bodySource).toContain("rv_id = 'new'");
  });

  it('reports ambiguity for multiple interface matches', () => {
    // Both interfaces have same method name "process"
    const source = `CLASS zcl_test DEFINITION PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_a.
    INTERFACES zif_b.
ENDCLASS.
CLASS zcl_test IMPLEMENTATION.
  METHOD zif_a~process.
    " a logic
  ENDMETHOD.
  METHOD zif_b~process.
    " b logic
  ENDMETHOD.
ENDCLASS.`;
    const result = extractMethod(source, 'zcl_test', 'process');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Ambiguous');
  });

  it('returns error when method not found', () => {
    const result = extractMethod(SIMPLE_CLASS, 'zcl_order', 'nonexistent');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
    expect(result.error).toContain('method="*"'); // Explicit inventory follow-up instead of an unbounded list
  });

  it('matches case-insensitively', () => {
    const result = extractMethod(SIMPLE_CLASS, 'zcl_order', 'GET_ID');
    expect(result.success).toBe(true);
    expect(result.bodySource).toContain('rv_id');
  });

  it('handles multi-line method body', () => {
    const result = extractMethod(SIMPLE_CLASS, 'zcl_order', 'process');
    expect(result.success).toBe(true);
    expect(result.bodySource).toContain('lv_result');
    expect(result.bodySource).toContain('abap_true');
    expect(result.bodySource).toContain('rv_ok');
    // Body should have 3 content lines
    const bodyLines = result.bodySource.split('\n').filter((l) => l.trim().length > 0);
    expect(bodyLines.length).toBe(3);
  });

  it('handles empty method body', () => {
    const result = extractMethod(EMPTY_BODY_CLASS, 'zcl_stub', 'noop');
    expect(result.success).toBe(true);
    expect(result.bodySource.trim()).toBe('');
    expect(result.methodSource).toContain('METHOD noop');
    expect(result.methodSource).toContain('ENDMETHOD');
  });

  it('returns correct line numbers', () => {
    const result = extractMethod(SIMPLE_CLASS, 'zcl_order', 'get_id');
    expect(result.success).toBe(true);
    expect(result.startLine).toBeGreaterThan(0);
    expect(result.endLine).toBeGreaterThan(result.startLine);

    // Verify the lines match the source
    const lines = SIMPLE_CLASS.split('\n');
    expect(lines[result.startLine - 1]).toContain('METHOD get_id');
    expect(lines[result.endLine - 1]).toContain('ENDMETHOD');
  });
});

// ─── spliceMethod Tests ─────────────────────────────────────────────

describe('spliceMethod', () => {
  it('replaces a method body', () => {
    const result = spliceMethod(SIMPLE_CLASS, 'zcl_order', 'get_id', "    rv_id = 'new_value'.");
    expect(result.success).toBe(true);
    expect(result.newSource).toContain("'new_value'");
    expect(result.newSource).not.toContain('rv_id = mv_id');
    // Other methods should remain
    expect(result.newSource).toContain('METHOD process');
    expect(result.newSource).toContain('METHOD helper');
    expect(result.newSource).toContain('METHOD _init');
  });

  it('preserves all other methods unchanged', () => {
    const result = spliceMethod(SIMPLE_CLASS, 'zcl_order', 'get_id', "    rv_id = 'changed'.");
    expect(result.success).toBe(true);

    // Verify other method bodies are untouched
    expect(result.newSource).toContain('lv_result = abap_true');
    expect(result.newSource).toContain("mv_id = 'default'");
    expect(result.newSource).toContain('internal helper');
  });

  it('accepts body-only input (wraps with METHOD/ENDMETHOD)', () => {
    const result = spliceMethod(SIMPLE_CLASS, 'zcl_order', 'get_id', "    rv_id = 'wrapped'.");
    expect(result.success).toBe(true);
    expect(result.newMethodSource).toContain('METHOD get_id');
    expect(result.newMethodSource).toContain('ENDMETHOD');
    expect(result.newMethodSource).toContain("'wrapped'");
  });

  it('accepts full METHOD...ENDMETHOD block', () => {
    const fullBlock = `METHOD get_id.\n    rv_id = 'full_block'.\n  ENDMETHOD.`;
    const result = spliceMethod(SIMPLE_CLASS, 'zcl_order', 'get_id', fullBlock);
    expect(result.success).toBe(true);
    expect(result.newSource).toContain("'full_block'");
  });

  it('handles interface method in splice', () => {
    const result = spliceMethod(INTERFACE_CLASS, 'zcl_impl', 'zif_order~create', "    rv_id = 'spliced'.");
    expect(result.success).toBe(true);
    expect(result.newSource).toContain("'spliced'");
    // Original create body should be gone
    expect(result.newSource).not.toContain("rv_id = 'new'");
    // Other methods should remain
    expect(result.newSource).toContain('METHOD run');
  });

  it('returns error when method not found', () => {
    const result = spliceMethod(SIMPLE_CLASS, 'zcl_order', 'nonexistent', 'body');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('returns old method source for verification', () => {
    const result = spliceMethod(SIMPLE_CLASS, 'zcl_order', 'get_id', "    rv_id = 'new'.");
    expect(result.success).toBe(true);
    expect(result.oldMethodSource).toContain('METHOD get_id');
    expect(result.oldMethodSource).toContain('rv_id = mv_id');
    expect(result.oldMethodSource).toContain('ENDMETHOD');
  });
});

// ─── formatMethodListing Tests ──────────────────────────────────────

describe('formatMethodListing', () => {
  it('formats listing with visibility sections', () => {
    const listing = listMethods(SIMPLE_CLASS, 'zcl_order');
    const output = formatMethodListing(listing);

    expect(output).toContain('zcl_order');
    expect(output).toContain('4 methods');
    expect(output).toContain('PUBLIC:');
    expect(output).toContain('PROTECTED:');
    expect(output).toContain('PRIVATE:');
    expect(output).toContain('get_id');
  });

  it('shows interface and redefinition flags', () => {
    const listing = listMethods(INTERFACE_CLASS, 'zcl_impl');
    const output = formatMethodListing(listing);
    expect(output).toContain('[interface]');
  });

  it('handles empty class', () => {
    const source = `CLASS zcl_empty DEFINITION PUBLIC.
  PUBLIC SECTION.
ENDCLASS.
CLASS zcl_empty IMPLEMENTATION.
ENDCLASS.`;
    const listing = listMethods(source, 'zcl_empty');
    const output = formatMethodListing(listing);
    expect(output).toContain('0 methods');
  });
});

// ─── Local-handler classes inside CCDEF/CCIMP (PR-D) ────────────────

/**
 * Realistic CCIMP-only source: no global DEFINITION, two local handler
 * classes, each with its own method names. Modeled after the actual CCIMP
 * fetched from ZBP_DM_PROJECT on a4h (S/4HANA 2023) on 2026-05-10.
 */
const CCIMP_SINGLE_LHC = `*"* use this source file for the definition and implementation of
*"* local helper classes, interface definitions and type
*"* declarations
CLASS lhc_project IMPLEMENTATION.

  METHOD get_instance_authorizations.
    READ ENTITIES OF zr_dm_project IN LOCAL MODE
      ENTITY Project FIELDS ( ProjectId )
        WITH CORRESPONDING #( keys )
      RESULT DATA(projects).
    result = VALUE #( ).
  ENDMETHOD.

  METHOD approve_project.
    " original body
    DATA(x) = 1.
  ENDMETHOD.

ENDCLASS.`;

/**
 * Two distinct local classes both declaring a method with the same bare
 * name — exercises the cross-class ambiguity guard and qualified-name
 * disambiguation.
 */
const CCIMP_MULTI_LHC = `CLASS lhc_project IMPLEMENTATION.
  METHOD approve_project.
    " body in lhc_project
    WRITE 'project'.
  ENDMETHOD.
ENDCLASS.

CLASS lhc_task IMPLEMENTATION.
  METHOD approve_project.
    " body in lhc_task
    WRITE 'task'.
  ENDMETHOD.
  METHOD complete_task.
    WRITE 'done'.
  ENDMETHOD.
ENDCLASS.`;

/**
 * Local class that itself implements an interface — proves a global-style
 * `zif_X~method` lookup still works alongside the new qualified-class lookup
 * without one intercepting the other.
 */
const CCIMP_LHC_WITH_INTERFACE = `CLASS lhc_x IMPLEMENTATION.
  METHOD foo.
    WRITE 'foo'.
  ENDMETHOD.
  METHOD zif_order~create.
    rv_id = 'new'.
  ENDMETHOD.
ENDCLASS.`;

describe('listMethods — local handler classes (CCIMP)', () => {
  it('captures containingClass for each method in a single-class CCIMP', () => {
    const result = listMethods(CCIMP_SINGLE_LHC, 'ZBP_DM_PROJECT');
    expect(result.success).toBe(true);
    expect(result.methods.length).toBe(2);
    for (const m of result.methods) {
      expect(m.containingClass?.toLowerCase()).toBe('lhc_project');
    }
  });

  it('captures distinct containingClass values across multiple local classes', () => {
    const result = listMethods(CCIMP_MULTI_LHC, 'ZBP_DM_PROJECT');
    expect(result.success).toBe(true);
    const byClass = new Map<string, string[]>();
    for (const m of result.methods) {
      const key = (m.containingClass ?? '').toLowerCase();
      if (!byClass.has(key)) byClass.set(key, []);
      byClass.get(key)!.push(m.name.toLowerCase());
    }
    expect(byClass.get('lhc_project')).toEqual(['approve_project']);
    // lhc_task has both approve_project and complete_task (alphabetical from sort)
    const taskMethods = byClass.get('lhc_task') ?? [];
    expect(taskMethods.sort()).toEqual(['approve_project', 'complete_task']);
  });
});

describe('extractMethod — qualified <localclass>~<method> lookup', () => {
  it('resolves lhc_project~approve_project to the right block', () => {
    const result = extractMethod(CCIMP_MULTI_LHC, 'ZBP_DM_PROJECT', 'lhc_project~approve_project');
    expect(result.success).toBe(true);
    expect(result.methodSource).toContain("WRITE 'project'");
    expect(result.methodSource).not.toContain("WRITE 'task'");
  });

  it('resolves lhc_task~approve_project to the second class', () => {
    const result = extractMethod(CCIMP_MULTI_LHC, 'ZBP_DM_PROJECT', 'lhc_task~approve_project');
    expect(result.success).toBe(true);
    expect(result.methodSource).toContain("WRITE 'task'");
    expect(result.methodSource).not.toContain("WRITE 'project'");
  });

  it('resolves the bare name when only one local class defines it', () => {
    const result = extractMethod(CCIMP_SINGLE_LHC, 'ZBP_DM_PROJECT', 'approve_project');
    expect(result.success).toBe(true);
    expect(result.methodName).toBe('approve_project');
  });

  it('errors when a bare name is ambiguous across local classes', () => {
    const result = extractMethod(CCIMP_MULTI_LHC, 'ZBP_DM_PROJECT', 'approve_project');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/ambiguous/i);
    expect(result.error).toContain('lhc_project');
    expect(result.error).toContain('lhc_task');
    expect(result.error).toContain('lhc_project~approve_project');
  });

  it('handles mixed case in qualified specifiers', () => {
    const result = extractMethod(CCIMP_MULTI_LHC, 'ZBP_DM_PROJECT', 'lhc_PROJECT~Approve_Project');
    expect(result.success).toBe(true);
    expect(result.methodSource).toContain("WRITE 'project'");
  });

  it('does NOT intercept global-interface methods (zif_X~create regression)', () => {
    // Existing test fixture INTERFACE_CLASS has zif_order~create stored as `m.name === 'zif_order~create'`.
    // Step 2 (exact match) must catch it — step 3 (qualified) must NOT fire and look up
    // m.containingClass === 'zif_order' (which doesn't exist).
    const result = extractMethod(INTERFACE_CLASS, 'zcl_impl', 'zif_order~create');
    expect(result.success).toBe(true);
    expect(result.methodSource).toContain("rv_id = 'new'");
  });

  it('disambiguates lhc_x~foo (qualified) vs zif_order~create (interface impl) in same CCIMP', () => {
    // CCIMP_LHC_WITH_INTERFACE has CLASS lhc_x with both METHOD foo and METHOD zif_order~create.
    const fooResult = extractMethod(CCIMP_LHC_WITH_INTERFACE, 'ZBP_X', 'lhc_x~foo');
    expect(fooResult.success).toBe(true);
    expect(fooResult.methodSource).toContain("WRITE 'foo'");

    const interfaceResult = extractMethod(CCIMP_LHC_WITH_INTERFACE, 'ZBP_X', 'zif_order~create');
    expect(interfaceResult.success).toBe(true);
    expect(interfaceResult.methodSource).toContain("rv_id = 'new'");
  });

  it('reports unknown qualified names with available-methods hint that includes class prefix', () => {
    const result = extractMethod(CCIMP_MULTI_LHC, 'ZBP_DM_PROJECT', 'lhc_typo~approve_project');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
    // Error should include qualified candidates so the LLM can fix the typo
    expect(result.error).toMatch(/lhc_project~approve_project|lhc_task~approve_project/);
  });
});

describe('spliceMethod — qualified specifier on CCIMP source', () => {
  it('splices into the right local class when both have the same bare method name', () => {
    const result = spliceMethod(
      CCIMP_MULTI_LHC,
      'ZBP_DM_PROJECT',
      'lhc_project~approve_project',
      "    \" rewritten body\n    WRITE 'rewritten'.",
    );
    expect(result.success).toBe(true);
    // Project class got the new body
    expect(result.newSource).toContain("WRITE 'rewritten'");
    expect(result.newSource).not.toContain("WRITE 'project'");
    // Task class is untouched — its approve_project still says 'task'
    expect(result.newSource).toContain("WRITE 'task'");
    expect(result.newSource).toContain("WRITE 'done'");
  });

  it('preserves the rest of the CCIMP after splice', () => {
    const result = spliceMethod(CCIMP_SINGLE_LHC, 'ZBP_DM_PROJECT', 'lhc_project~approve_project', '    DATA(y) = 99.');
    expect(result.success).toBe(true);
    expect(result.newSource).toContain('CLASS lhc_project IMPLEMENTATION.');
    expect(result.newSource).toContain('METHOD get_instance_authorizations');
    expect(result.newSource).toContain('DATA(y) = 99.');
    expect(result.newSource).not.toContain('DATA(x) = 1.');
    expect(result.newSource).toContain('ENDCLASS.');
  });
});

const duplicateInterfaceMethods = `CLASS lcl_a IMPLEMENTATION.
 METHOD lif_x~run.
  DATA(value) = 1.
 ENDMETHOD.
ENDCLASS.
CLASS lcl_b IMPLEMENTATION.
 METHOD lif_x~run.
  DATA(value) = 2.
 ENDMETHOD.
ENDCLASS.`;
it('refuses an interface-qualified name shared by different local classes', () => {
  const result = spliceMethod(duplicateInterfaceMethods, 'ZCL_OWNER', 'lif_x~run', ' DATA(value) = 3.');
  expect(result.success).toBe(false);
  expect(result.error).toContain('Ambiguous');
  expect(result.error).toContain('lcl_a~lif_x~run');
});
it('uses the containing class plus interface-qualified name to edit only the selected body', () => {
  const result = spliceMethod(duplicateInterfaceMethods, 'ZCL_OWNER', 'lcl_b~lif_x~run', '  DATA(value) = 3.');
  expect(result.success, result.error).toBe(true);
  expect(result.newSource).toBe(duplicateInterfaceMethods.replace('DATA(value) = 2.', 'DATA(value) = 3.'));
});

it('refuses duplicate exact method bodies even when the containing class is identical', () => {
  const duplicate = duplicateInterfaceMethods.replace('CLASS lcl_b IMPLEMENTATION.', 'CLASS lcl_a IMPLEMENTATION.');
  expect(spliceMethod(duplicate, 'ZCL_OWNER', 'lif_x~run', ' DATA(value) = 3.').success).toBe(false);
});
