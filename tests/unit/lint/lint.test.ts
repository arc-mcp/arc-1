import { Config, Version } from '@abaplint/core';
import { describe, expect, it } from 'vitest';
import { detectFilename, lintAbapSource, validateBeforeWrite } from '../../../src/lint/lint.js';

describe('ABAP Lint', () => {
  describe('lintAbapSource', () => {
    it('returns issues for code with problems', () => {
      const source = `REPORT ztest.
DATA lv_unused TYPE string.
WRITE: / 'Hello'.`;
      const results = lintAbapSource(source, 'ztest.prog.abap');
      // Should find at least some issues (naming, unused var, etc.)
      expect(Array.isArray(results)).toBe(true);
    });

    it('returns result objects with correct shape', () => {
      const source = "REPORT ztest.\nWRITE: / 'Hello'.";
      const results = lintAbapSource(source, 'ztest.prog.abap');
      for (const r of results) {
        expect(r).toHaveProperty('rule');
        expect(r).toHaveProperty('message');
        expect(r).toHaveProperty('line');
        expect(r).toHaveProperty('column');
        expect(r).toHaveProperty('severity');
        expect(['error', 'warning', 'info']).toContain(r.severity);
      }
    });

    it('handles empty source', () => {
      const results = lintAbapSource('', 'empty.prog.abap');
      expect(Array.isArray(results)).toBe(true);
    });

    it('handles class source', () => {
      const source = `CLASS zcl_test DEFINITION PUBLIC.
  PUBLIC SECTION.
    METHODS test_method.
ENDCLASS.

CLASS zcl_test IMPLEMENTATION.
  METHOD test_method.
  ENDMETHOD.
ENDCLASS.`;
      const results = lintAbapSource(source, 'zcl_test.clas.abap');
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('detectFilename', () => {
    it('detects REPORT as .prog.abap', () => {
      expect(detectFilename('REPORT ztest.', 'ZTEST')).toBe('ztest.prog.abap');
    });

    it('detects CLASS as .clas.abap', () => {
      expect(detectFilename('CLASS zcl_test DEFINITION.', 'ZCL_TEST')).toBe('zcl_test.clas.abap');
    });

    it('detects INTERFACE as .intf.abap', () => {
      expect(detectFilename('INTERFACE zif_test PUBLIC.', 'ZIF_TEST')).toBe('zif_test.intf.abap');
    });

    it('detects FUNCTION-POOL as .fugr.abap', () => {
      expect(detectFilename('FUNCTION-POOL zutils.', 'ZUTILS')).toBe('zutils.fugr.abap');
    });

    it('detects CDS (DEFINE VIEW) as .ddls.asddls', () => {
      expect(detectFilename('define view entity Z_TEST as select from mara', 'Z_TEST')).toBe('z_test.ddls.asddls');
    });

    it('detects CDS with annotation as .ddls.asddls', () => {
      expect(detectFilename('@AbapCatalog.viewEnhancementCategory: [#NONE]\ndefine view', 'Z_TEST')).toBe(
        'z_test.ddls.asddls',
      );
    });

    it('detects BDEF as .bdef.asbdef', () => {
      expect(detectFilename('managed implementation in class zbp_test', 'Z_TEST')).toBe('z_test.bdef.asbdef');
    });

    it('detects BDEF projection as .bdef.asbdef', () => {
      expect(detectFilename('projection;\ndefine behavior for ZC_TRAVEL', 'ZC_TRAVEL')).toBe('zc_travel.bdef.asbdef');
    });

    it('detects SRVD (define service) as .srvd.asrvd', () => {
      expect(
        detectFilename(
          "@EndUserText.label: 'My Service'\ndefine service ZSD_TRAVEL {\n  expose ZI_TRAVEL;\n}",
          'ZSD_TRAVEL',
        ),
      ).toBe('zsd_travel.srvd.asrvd');
    });

    it('detects SRVD without annotation as .srvd.asrvd', () => {
      expect(detectFilename('define service ZSD_TRAVEL {\n  expose ZI_TRAVEL;\n}', 'ZSD_TRAVEL')).toBe(
        'zsd_travel.srvd.asrvd',
      );
    });

    it('detects TABL (define table) as .tabl.astabl', () => {
      expect(
        detectFilename(
          "@EndUserText.label: 'Test'\n@AbapCatalog.tableCategory: #TRANSPARENT\ndefine table ztable {\n  key f1 : abap.char(10);\n}",
          'ZTABLE',
        ),
      ).toBe('ztable.tabl.astabl');
    });

    it('detects DDLX (annotate view) as .ddlx.asddlx', () => {
      expect(
        detectFilename(
          '@Metadata.layer: #CUSTOMER\nannotate view ZI_TRAVEL with {\n  @UI.lineItem: [{ position: 10 }]\n  TravelId;\n}',
          'ZI_TRAVEL',
        ),
      ).toBe('zi_travel.ddlx.asddlx');
    });

    it('detects DDLX (annotate entity) as .ddlx.asddlx', () => {
      expect(detectFilename('annotate entity ZI_TRAVEL with {\n  TravelId;\n}', 'ZI_TRAVEL')).toBe(
        'zi_travel.ddlx.asddlx',
      );
    });

    it('detects CDS root view as .ddls.asddls', () => {
      expect(detectFilename('define root view entity ZR_TRAVEL as select from ztravel { key id }', 'ZR_TRAVEL')).toBe(
        'zr_travel.ddls.asddls',
      );
    });

    it('defaults to .clas.abap for unknown', () => {
      expect(detectFilename('DATA lv_test TYPE string.', 'UNKNOWN')).toBe('unknown.clas.abap');
    });
  });

  describe('CDS Lint', () => {
    it('returns no cds_parser_error for valid CDS view', () => {
      const source = `define view entity ZI_TEST as select from ztable {
  key field1,
  field2
}`;
      const results = lintAbapSource(source, 'zi_test.ddls.asddls');
      const parserErrors = results.filter((r) => r.rule === 'cds_parser_error');
      expect(parserErrors).toHaveLength(0);
    });

    it('returns cds_parser_error for invalid CDS (missing comma)', () => {
      const source = `define view entity ZI_TEST as select from ztable {
  key field1
  field2
}`;
      const results = lintAbapSource(source, 'zi_test.ddls.asddls');
      const parserErrors = results.filter((r) => r.rule === 'cds_parser_error');
      expect(parserErrors.length).toBeGreaterThan(0);
      expect(parserErrors[0].severity).toBe('error');
    });

    it('returns cds_association_name for bad association name', () => {
      const source = `define view entity ZI_TEST as select from ztable
  association [0..*] to zi_other as BadName on BadName.id = ztable.id {
  key field1
}`;
      const results = lintAbapSource(source, 'zi_test.ddls.asddls');
      const nameErrors = results.filter((r) => r.rule === 'cds_association_name');
      expect(nameErrors.length).toBeGreaterThan(0);
      expect(nameErrors[0].message).toContain('underscore');
    });

    it('returns cds_field_order for associations before key fields', () => {
      const source = `define view entity ZI_TEST as select from ztable
  association [0..*] to zi_other as _Other on _Other.id = ztable.id {
  _Other,
  key field1
}`;
      const results = lintAbapSource(source, 'zi_test.ddls.asddls');
      const orderErrors = results.filter((r) => r.rule === 'cds_field_order');
      expect(orderErrors.length).toBeGreaterThan(0);
    });

    it('returns cds_legacy_view for view without entity keyword (Cloud version)', () => {
      const source = `@AbapCatalog.sqlViewName: 'ZSQL_TEST'
define view ZI_TEST as select from ztable {
  key field1
}`;
      // cds_legacy_view only fires with Cloud version (legacy views not supported on BTP)
      const cloudConfig = Config.getDefault(Version.Cloud);
      const results = lintAbapSource(source, 'zi_test.ddls.asddls', cloudConfig);
      const legacyErrors = results.filter((r) => r.rule === 'cds_legacy_view');
      expect(legacyErrors.length).toBeGreaterThan(0);
    });

    it('returns no issues for BDEF source (abaplint does not parse BDEF)', () => {
      const source = 'this is total garbage that abaplint silently ignores for BDEF';
      const results = lintAbapSource(source, 'zi_test.bdef.asbdef');
      expect(results).toHaveLength(0);
    });
  });

  describe('CDS validateBeforeWrite', () => {
    it('passes for valid CDS view', () => {
      const source = `define view entity ZI_TEST as select from ztable {
  key field1,
  field2
}`;
      const result = validateBeforeWrite(source, 'zi_test.ddls.asddls');
      expect(result.pass).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('fails for CDS view with syntax error', () => {
      const source = `define view entity ZI_TEST as select from ztable {
  key field1
  field2
}`;
      const result = validateBeforeWrite(source, 'zi_test.ddls.asddls');
      expect(result.pass).toBe(false);
      expect(result.errors.some((e) => e.rule === 'cds_parser_error')).toBe(true);
    });
  });

  describe('validateBeforeWrite — ARC-1 pre-write hints (TABL draft admin include)', () => {
    it('appends arc1-tabl-draft-admin-include warning for bare include in TABL source', () => {
      const source = `@EndUserText.label : 'Draft'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
@AbapCatalog.tableCategory : #TRANSPARENT
@AbapCatalog.deliveryClass : #A
@AbapCatalog.dataMaintenance : #ALLOWED
define table zdraft_t {
  key client : abap.clnt not null;
  key id : abap.char(10) not null;
  include sych_bdl_draft_admin_inc;
}`;
      const result = validateBeforeWrite(source, 'zdraft_t.tabl.astabl');
      // Hints are advisory — write still passes as long as abaplint has no errors
      expect(result.pass).toBe(true);
      const hints = result.warnings.filter((w) => w.rule === 'arc1-tabl-draft-admin-include');
      expect(hints).toHaveLength(1);
      expect(hints[0].severity).toBe('warning');
      expect(hints[0].message).toContain('"%admin"');
    });

    it('does NOT emit hint for canonical %admin form in TABL', () => {
      const source = `@EndUserText.label : 'Draft'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
@AbapCatalog.tableCategory : #TRANSPARENT
@AbapCatalog.deliveryClass : #A
@AbapCatalog.dataMaintenance : #ALLOWED
define table zdraft_t {
  key client : abap.clnt not null;
  key id : abap.char(10) not null;
  "%admin" : include sych_bdl_draft_admin_inc;
}`;
      const result = validateBeforeWrite(source, 'zdraft_t.tabl.astabl');
      const hints = result.warnings.filter((w) => w.rule === 'arc1-tabl-draft-admin-include');
      expect(hints).toHaveLength(0);
    });

    it('does NOT emit hint for TABL with no draft admin include', () => {
      const source = `@EndUserText.label : 'Test'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
@AbapCatalog.tableCategory : #TRANSPARENT
@AbapCatalog.deliveryClass : #A
@AbapCatalog.dataMaintenance : #ALLOWED
define table z_simple {
  key client : abap.clnt not null;
  key id : abap.char(10) not null;
  data : abap.char(255);
}`;
      const result = validateBeforeWrite(source, 'z_simple.tabl.astabl');
      const hints = result.warnings.filter((w) => w.rule === 'arc1-tabl-draft-admin-include');
      expect(hints).toHaveLength(0);
    });

    it('does NOT emit TABL hint when filename is non-TABL even if source contains the include text', () => {
      // ABAP source containing the literal include text in a comment.
      // Filename gating must prevent the TABL hint from firing on PROG/CLAS/etc.
      const source = `REPORT z_test.

* This program documents how to add include sych_bdl_draft_admin_inc; to a draft table.
WRITE: 'Hello'.`;
      const result = validateBeforeWrite(source, 'z_test.prog.abap');
      const hints = result.warnings.filter((w) => w.rule === 'arc1-tabl-draft-admin-include');
      expect(hints).toHaveLength(0);
    });
  });
});
