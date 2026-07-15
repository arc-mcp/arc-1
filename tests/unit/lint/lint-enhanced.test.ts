import { Config } from '@abaplint/core';
import { describe, expect, it } from 'vitest';
import { buildLintConfig } from '../../../src/lint/config-builder.js';
import { lintAbapSource, lintAndFix, validateBeforeWrite } from '../../../src/lint/lint.js';

describe('Enhanced ABAP Lint', () => {
  describe('lintAbapSource with custom config', () => {
    it('uses cloud config to detect cloud violations', () => {
      const source = "REPORT ztest.\nWRITE: / 'Hello'.";
      const config = buildLintConfig({ systemType: 'btp' });
      const issues = lintAbapSource(source, 'ztest.prog.abap', config);

      // Should flag cloud_types violation (REPORT not allowed in cloud)
      const cloudIssue = issues.find((i) => i.rule === 'cloud_types');
      expect(cloudIssue).toBeDefined();
      expect(cloudIssue!.severity).toBe('error');
    });

    it('does not flag cloud_types on on-prem', () => {
      const source = "REPORT ztest.\nWRITE: / 'Hello'.";
      const config = buildLintConfig({ systemType: 'onprem' });
      const issues = lintAbapSource(source, 'ztest.prog.abap', config);

      const cloudIssue = issues.find((i) => i.rule === 'cloud_types');
      expect(cloudIssue).toBeUndefined();
    });
  });

  describe('lintAndFix', () => {
    it('fixes keyword case issues', () => {
      const source = `CLASS zcl_test DEFINITION PUBLIC.
  PUBLIC SECTION.
    METHODS test.
ENDCLASS.
CLASS zcl_test IMPLEMENTATION.
  METHOD test.
    data lv_test type i.
    lv_test = 1.
  ENDMETHOD.
ENDCLASS.`;
      const config = buildLintConfig({ systemType: 'onprem' });
      const result = lintAndFix(source, 'zcl_test.clas.abap', config);

      // Should have applied at least one fix (keyword case)
      expect(result.appliedFixes).toBeGreaterThan(0);
      expect(result.fixedRules).toContain('keyword_case');
      // Fixed source should have uppercase keywords
      expect(result.fixedSource).toContain('DATA');
      expect(result.fixedSource).toContain('TYPE');
    });

    it('returns remaining issues after fixes', () => {
      const source = `CLASS zcl_test DEFINITION PUBLIC.
  PUBLIC SECTION.
    METHODS test.
ENDCLASS.
CLASS zcl_test IMPLEMENTATION.
  METHOD test.
    data lv_test type i.
  ENDMETHOD.
ENDCLASS.`;
      const config = buildLintConfig({ systemType: 'onprem' });
      const result = lintAndFix(source, 'zcl_test.clas.abap', config);

      expect(Array.isArray(result.remainingIssues)).toBe(true);
      // Each remaining issue should have proper shape
      for (const issue of result.remainingIssues) {
        expect(issue).toHaveProperty('rule');
        expect(issue).toHaveProperty('message');
        expect(issue).toHaveProperty('severity');
      }
    });

    it('handles code with no fixable issues', () => {
      const source = `CLASS zcl_test DEFINITION PUBLIC.
  PUBLIC SECTION.
    METHODS test.
ENDCLASS.
CLASS zcl_test IMPLEMENTATION.
  METHOD test.
    DATA lv_test TYPE i.
    lv_test = 1.
  ENDMETHOD.
ENDCLASS.`;
      const config = buildLintConfig({ systemType: 'onprem' });
      const result = lintAndFix(source, 'zcl_test.clas.abap', config);

      // Source should be unchanged or only have minor fixes
      expect(result.fixedSource).toBeDefined();
    });

    it('returns original source when empty', () => {
      const result = lintAndFix('', 'empty.prog.abap');
      expect(result.fixedSource).toBe('');
      expect(result.appliedFixes).toBe(0);
    });
  });

  describe('validateBeforeWrite', () => {
    it('passes valid class code on on-prem', () => {
      const source = `CLASS zcl_test DEFINITION PUBLIC.
  PUBLIC SECTION.
    METHODS test.
ENDCLASS.
CLASS zcl_test IMPLEMENTATION.
  METHOD test.
    DATA lv_x TYPE i.
    lv_x = 1.
  ENDMETHOD.
ENDCLASS.`;
      const result = validateBeforeWrite(source, 'zcl_test.clas.abap', { systemType: 'onprem' });
      expect(result.pass).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('blocks cloud_types violation on BTP', () => {
      const source = "REPORT ztest.\nWRITE: / 'Hello'.";
      const result = validateBeforeWrite(source, 'ztest.prog.abap', { systemType: 'btp' });
      expect(result.pass).toBe(false);
      expect(result.errors.some((e) => e.rule === 'cloud_types')).toBe(true);
    });

    it('allows REPORT on on-prem', () => {
      const source = "REPORT ztest.\nWRITE: / 'Hello'.";
      const result = validateBeforeWrite(source, 'ztest.prog.abap', { systemType: 'onprem' });
      // cloud_types should not be in errors
      expect(result.errors.some((e) => e.rule === 'cloud_types')).toBe(false);
    });

    it('blocks parser errors on any system', () => {
      const source = `CLASS zcl_test DEFINITION PUBLIC.
  PUBLIC SECTION.
ENDCLASS.
CLASS zcl_test IMPLEMENTATION.
  METHOD nonexistent.
    THIS IS NOT VALID ABAP.
  ENDMETHOD.
ENDCLASS.`;
      const result = validateBeforeWrite(source, 'zcl_test.clas.abap', { systemType: 'onprem' });
      expect(result.pass).toBe(false);
      expect(result.errors.some((e) => e.rule === 'parser_error')).toBe(true);
    });

    it('blocks obsolete ADD statement on BTP', () => {
      const source = `CLASS zcl_test DEFINITION PUBLIC.
  PUBLIC SECTION.
    METHODS test.
ENDCLASS.
CLASS zcl_test IMPLEMENTATION.
  METHOD test.
    DATA lv_x TYPE i.
    ADD 1 TO lv_x.
  ENDMETHOD.
ENDCLASS.`;
      const result = validateBeforeWrite(source, 'zcl_test.clas.abap', { systemType: 'btp' });
      // Should flag obsolete ADD statement
      const hasObsolete = result.errors.some((e) => e.rule === 'obsolete_statement');
      expect(hasObsolete).toBe(true);
    });

    it('handles empty source gracefully', () => {
      const result = validateBeforeWrite('', 'empty.clas.abap', { systemType: 'onprem' });
      // Empty source should not crash
      expect(result).toHaveProperty('pass');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('warnings');
    });
  });

  describe('buildLintConfig version resolution', () => {
    it('returns Config with Cloud version for BTP', () => {
      const config = buildLintConfig({ systemType: 'btp' });
      expect(config).toBeInstanceOf(Config);
      expect(config.get().syntax.version).toEqual({ release: 'Newest', language: 'Cloud' });
    });

    it('returns Config with mapped version for on-prem release', () => {
      const config = buildLintConfig({ systemType: 'onprem', abapRelease: '756' });
      expect(config).toBeInstanceOf(Config);
      expect(config.get().syntax.version).toBe('v756');
    });

    it('returns Config with v702 fallback when no options given', () => {
      const config = buildLintConfig();
      expect(config).toBeInstanceOf(Config);
      expect(config.get().syntax.version).toBe('v702');
    });
  });
});
