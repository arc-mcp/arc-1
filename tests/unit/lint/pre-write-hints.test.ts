import { describe, expect, it } from 'vitest';
import { inspectTablSource } from '../../../src/lint/pre-write-hints.js';

describe('inspectTablSource — draft admin include hint', () => {
  it('emits a warning for bare include without %admin prefix', () => {
    const source = `define table z_test {
  key client : abap.clnt not null;
  key id : abap.char(10) not null;
  include sych_bdl_draft_admin_inc;
}`;
    const result = inspectTablSource(source);
    expect(result).toHaveLength(1);
    expect(result[0].rule).toBe('arc1-tabl-draft-admin-include');
    expect(result[0].severity).toBe('warning');
    expect(result[0].line).toBe(4);
    expect(result[0].column).toBe(3); // after 2 leading spaces
    expect(result[0].message).toContain('"%admin"');
    expect(result[0].message).toContain('ABENBDL_DRAFT_TABLE');
    expect(result[0].endLine).toBe(4);
    expect(result[0].endColumn).toBeGreaterThan(result[0].column);
  });

  it('does NOT warn when canonical %admin prefix is used', () => {
    const source = `define table z_test {
  key client : abap.clnt not null;
  "%admin" : include sych_bdl_draft_admin_inc;
}`;
    expect(inspectTablSource(source)).toHaveLength(0);
  });

  it('does NOT warn when canonical %admin uses extra whitespace', () => {
    const source = `define table z_test {
  "%admin"   :   include sych_bdl_draft_admin_inc;
}`;
    expect(inspectTablSource(source)).toHaveLength(0);
  });

  it('does NOT warn when canonical %admin spans multiple lines', () => {
    const source = `define table z_test {
  "%admin" :
    include sych_bdl_draft_admin_inc;
}`;
    expect(inspectTablSource(source)).toHaveLength(0);
  });

  it('warns for bare include in mixed case', () => {
    const source = `define table z_test {
  Include SYCH_BDL_DRAFT_ADMIN_INC;
}`;
    const result = inspectTablSource(source);
    expect(result).toHaveLength(1);
    expect(result[0].rule).toBe('arc1-tabl-draft-admin-include');
  });

  it('does NOT warn for canonical mixed-case admin', () => {
    const source = `define table z_test {
  "%admin" : Include SYCH_BDL_DRAFT_ADMIN_INC;
}`;
    expect(inspectTablSource(source)).toHaveLength(0);
  });

  it('returns empty for source without any draft include', () => {
    const source = `define table z_test {
  key client : abap.clnt not null;
  data : abap.char(10);
}`;
    expect(inspectTablSource(source)).toHaveLength(0);
  });

  it('emits two warnings for two bare includes', () => {
    const source = `define table z_test {
  include sych_bdl_draft_admin_inc;
  include sych_bdl_draft_admin_inc;
}`;
    const result = inspectTablSource(source);
    expect(result).toHaveLength(2);
    expect(result[0].line).toBe(2);
    expect(result[1].line).toBe(3);
  });

  it('emits one warning when one is bare and the other is canonical', () => {
    const source = `define table z_test {
  "%admin" : include sych_bdl_draft_admin_inc;
  include sych_bdl_draft_admin_inc;
}`;
    const result = inspectTablSource(source);
    expect(result).toHaveLength(1);
    expect(result[0].line).toBe(3);
  });

  it('does NOT warn when bare include is inside a // line comment', () => {
    const source = `define table z_test {
  key client : abap.clnt not null;
  // include sych_bdl_draft_admin_inc;
  "%admin" : include sych_bdl_draft_admin_inc;
}`;
    expect(inspectTablSource(source)).toHaveLength(0);
  });

  it('does NOT warn when bare include is inside a /* block comment */', () => {
    const source = `define table z_test {
  /* include sych_bdl_draft_admin_inc; */
  "%admin" : include sych_bdl_draft_admin_inc;
}`;
    expect(inspectTablSource(source)).toHaveLength(0);
  });

  it('returns empty for empty source', () => {
    expect(inspectTablSource('')).toHaveLength(0);
  });

  it('returns empty for whitespace-only source', () => {
    expect(inspectTablSource('   \n  \n   ')).toHaveLength(0);
  });
});
