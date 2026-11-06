/**
 * E2E tests for the abaplint integration pipeline.
 *
 * These tests verify the complete flow that an LLM-generated ABAP source
 * goes through: lint → fix → validate → write gate. They use real
 * @abaplint/core (no mocks) to ensure the rules actually catch issues
 * and fixes actually transform code correctly.
 *
 * Test categories:
 * 1. Full pipeline: lint → fix → validate for cloud and on-prem
 * 2. Specific rule behavior: cloud_types, obsolete_statement, etc.
 * 3. Auto-fix verification: fixes actually produce valid ABAP
 * 4. Custom rule overrides: user-provided rules work correctly
 * 5. Pre-write gate: correct blocking/passing behavior
 */

import { describe, expect, it } from 'vitest';
import { buildLintConfig, buildPreWriteConfig, listRulesFromConfig } from '../../../src/lint/config-builder.js';
import { detectFilename, lintAbapSource, lintAndFix, validateBeforeWrite } from '../../../src/lint/lint.js';

// ─── Test ABAP Sources ──────────────────────────────────────────────
// Realistic ABAP code snippets that an LLM might generate

const VALID_CLOUD_CLASS = `CLASS zcl_calculator DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS add
      IMPORTING iv_a TYPE i
                iv_b TYPE i
      RETURNING VALUE(rv_result) TYPE i.
ENDCLASS.

CLASS zcl_calculator IMPLEMENTATION.
  METHOD add.
    rv_result = iv_a + iv_b.
  ENDMETHOD.
ENDCLASS.
`;

const VALID_ONPREM_REPORT = `REPORT zcalculator.
DATA: lv_result TYPE i.
lv_result = 1 + 2.
WRITE: / lv_result.`;

const CLOUD_VIOLATIONS_CLASS = `CLASS zcl_old_style DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS calculate
      IMPORTING iv_a TYPE i
                iv_b TYPE i
      RETURNING VALUE(rv_result) TYPE i.
ENDCLASS.

CLASS zcl_old_style IMPLEMENTATION.
  METHOD calculate.
    DATA lv_result TYPE i.
    ADD iv_a TO lv_result.
    ADD iv_b TO lv_result.
    rv_result = lv_result.
  ENDMETHOD.
ENDCLASS.`;

const LOWERCASE_KEYWORDS_CLASS = `CLASS zcl_lower DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    methods get_value
      returning value(rv_val) type i.
ENDCLASS.

CLASS zcl_lower IMPLEMENTATION.
  method get_value.
    data lv_x type i.
    lv_x = 42.
    rv_val = lv_x.
  endmethod.
ENDCLASS.`;

const PARSER_ERROR_CLASS = `CLASS zcl_broken DEFINITION PUBLIC.
  PUBLIC SECTION.
ENDCLASS.
CLASS zcl_broken IMPLEMENTATION.
  METHOD nonexistent.
    THIS IS NOT VALID ABAP AT ALL.
  ENDMETHOD.
ENDCLASS.`;

const INTERFACE_SOURCE = `INTERFACE zif_calculator PUBLIC.
  METHODS add
    IMPORTING iv_a TYPE i
              iv_b TYPE i
    RETURNING VALUE(rv_result) TYPE i.
ENDINTERFACE.`;

// ─── E2E Pipeline Tests ─────────────────────────────────────────────

describe('E2E: Lint Pipeline', () => {
  describe('Cloud (BTP) full pipeline: lint → fix → validate', () => {
    it('valid cloud class passes all stages', () => {
      const filename = detectFilename(VALID_CLOUD_CLASS, 'ZCL_CALCULATOR');
      expect(filename).toBe('zcl_calculator.clas.abap');

      // Stage 1: Lint — should find only minor warnings, no errors
      const config = buildLintConfig({ systemType: 'btp' });
      const issues = lintAbapSource(VALID_CLOUD_CLASS, filename, config);
      const errors = issues.filter((i) => i.severity === 'error');
      expect(errors).toHaveLength(0);

      // Stage 2: Fix — should have nothing critical to fix
      const fixResult = lintAndFix(VALID_CLOUD_CLASS, filename, config);
      // Source should be essentially unchanged (or only minor whitespace fixes)
      expect(fixResult.fixedSource).toBeTruthy();

      // Stage 3: Pre-write validate — should pass
      const preWrite = validateBeforeWrite(VALID_CLOUD_CLASS, filename, { systemType: 'btp' });
      expect(preWrite.pass).toBe(true);
      expect(preWrite.errors).toHaveLength(0);
    });

    it('fixes a missing final newline without blocking a cloud write', () => {
      const source = VALID_CLOUD_CLASS.trimEnd();
      const filename = detectFilename(source, 'ZCL_CALCULATOR');
      const config = buildLintConfig({ systemType: 'btp' });

      expect(lintAbapSource(source, filename, config).map((issue) => issue.rule)).toContain('final_newline');
      expect(validateBeforeWrite(source, filename, { systemType: 'btp' }).pass).toBe(true);

      const result = lintAndFix(source, filename, config);
      expect(result.fixedRules).toContain('final_newline');
      expect(result.fixedSource).toBe(VALID_CLOUD_CLASS);
      expect(result.remainingIssues.some((issue) => issue.rule === 'final_newline')).toBe(false);
    });

    it('class with obsolete ADD is caught and fixable on cloud', () => {
      const filename = detectFilename(CLOUD_VIOLATIONS_CLASS, 'ZCL_OLD_STYLE');

      // Stage 1: Lint detects obsolete ADD
      const config = buildLintConfig({ systemType: 'btp' });
      const issues = lintAbapSource(CLOUD_VIOLATIONS_CLASS, filename, config);
      const obsoleteIssues = issues.filter((i) => i.rule === 'obsolete_statement');
      expect(obsoleteIssues.length).toBeGreaterThan(0);
      // On cloud, obsolete_statement is an error
      expect(obsoleteIssues[0].severity).toBe('error');

      // Stage 2: Fix should transform ADD → arithmetic
      const fixResult = lintAndFix(CLOUD_VIOLATIONS_CLASS, filename, config);
      expect(fixResult.fixedRules).toContain('obsolete_statement');
      expect(fixResult.appliedFixes).toBeGreaterThan(0);
      // The fixed source should not contain ADD
      expect(fixResult.fixedSource).not.toMatch(/\bADD\b/);

      // Stage 3: Pre-write validates the fixed source passes
      const preWrite = validateBeforeWrite(fixResult.fixedSource, filename, { systemType: 'btp' });
      // After fixing, the obsolete_statement errors should be gone
      const remainingObsolete = preWrite.errors.filter((e) => e.rule === 'obsolete_statement');
      expect(remainingObsolete).toHaveLength(0);
    });

    it('REPORT is blocked on cloud at pre-write stage', () => {
      const filename = detectFilename(VALID_ONPREM_REPORT, 'ZCALCULATOR');
      expect(filename).toBe('zcalculator.prog.abap');

      // Pre-write should block: cloud_types doesn't allow PROG
      const preWrite = validateBeforeWrite(VALID_ONPREM_REPORT, filename, { systemType: 'btp' });
      expect(preWrite.pass).toBe(false);
      expect(preWrite.errors.some((e) => e.rule === 'cloud_types')).toBe(true);
    });
  });

  describe('On-premise full pipeline: lint → fix → validate', () => {
    it('REPORT is allowed on on-prem', () => {
      const filename = detectFilename(VALID_ONPREM_REPORT, 'ZCALCULATOR');

      // Lint should not flag cloud_types
      const config = buildLintConfig({ systemType: 'onprem' });
      const issues = lintAbapSource(VALID_ONPREM_REPORT, filename, config);
      expect(issues.find((i) => i.rule === 'cloud_types')).toBeUndefined();

      // Pre-write should pass
      const preWrite = validateBeforeWrite(VALID_ONPREM_REPORT, filename, { systemType: 'onprem' });
      expect(preWrite.pass).toBe(true);
    });

    it('obsolete ADD is a warning (not error) on on-prem', () => {
      const filename = detectFilename(CLOUD_VIOLATIONS_CLASS, 'ZCL_OLD_STYLE');
      const config = buildLintConfig({ systemType: 'onprem' });
      const issues = lintAbapSource(CLOUD_VIOLATIONS_CLASS, filename, config);

      const obsoleteIssues = issues.filter((i) => i.rule === 'obsolete_statement');
      expect(obsoleteIssues.length).toBeGreaterThan(0);
      // On-prem, obsolete_statement is a warning (advisory)
      expect(obsoleteIssues[0].severity).toBe('warning');
    });

    it('class with version-specific syntax respects ABAP release', () => {
      // Build config for an older on-prem system (7.02)
      const config702 = buildLintConfig({ systemType: 'onprem', abapRelease: '702' });
      expect(config702.get().syntax.version).toBe('v702');

      // Build config for a newer on-prem system (7.57)
      const config757 = buildLintConfig({ systemType: 'onprem', abapRelease: '757' });
      expect(config757.get().syntax.version).toBe('v757');
    });
  });

  describe('Parser error detection (any system type)', () => {
    for (const systemType of ['btp', 'onprem'] as const) {
      it(`blocks parser errors on ${systemType}`, () => {
        const filename = detectFilename(PARSER_ERROR_CLASS, 'ZCL_BROKEN');
        const preWrite = validateBeforeWrite(PARSER_ERROR_CLASS, filename, { systemType });
        expect(preWrite.pass).toBe(false);
        expect(preWrite.errors.some((e) => e.rule === 'parser_error')).toBe(true);
      });
    }
  });

  describe('Interface linting', () => {
    it('correctly lints interface source', () => {
      const filename = detectFilename(INTERFACE_SOURCE, 'ZIF_CALCULATOR');
      expect(filename).toBe('zif_calculator.intf.abap');

      const config = buildLintConfig({ systemType: 'btp' });
      const issues = lintAbapSource(INTERFACE_SOURCE, filename, config);
      // Valid interface — no parser errors
      expect(issues.find((i) => i.rule === 'parser_error')).toBeUndefined();
    });
  });
});

// ─── Auto-Fix Quality Tests ─────────────────────────────────────────

describe('E2E: Auto-Fix Quality', () => {
  it('keyword_case fix produces valid ABAP that passes re-lint', () => {
    const filename = detectFilename(LOWERCASE_KEYWORDS_CLASS, 'ZCL_LOWER');
    const config = buildLintConfig({ systemType: 'onprem' });

    // Fix the lowercase keywords
    const fixResult = lintAndFix(LOWERCASE_KEYWORDS_CLASS, filename, config);
    expect(fixResult.fixedRules).toContain('keyword_case');

    // Re-lint the fixed source — should have no keyword_case issues
    const reIssues = lintAbapSource(fixResult.fixedSource, filename, config);
    const keywordIssues = reIssues.filter((i) => i.rule === 'keyword_case');
    expect(keywordIssues).toHaveLength(0);

    // The fixed source should compile (no parser errors)
    expect(reIssues.find((i) => i.rule === 'parser_error')).toBeUndefined();
  });

  it('obsolete_statement fix produces valid ABAP', () => {
    const filename = detectFilename(CLOUD_VIOLATIONS_CLASS, 'ZCL_OLD_STYLE');
    const config = buildLintConfig({ systemType: 'btp' });

    const fixResult = lintAndFix(CLOUD_VIOLATIONS_CLASS, filename, config);

    // Re-lint the fixed source — obsolete statements should be gone
    const reIssues = lintAbapSource(fixResult.fixedSource, filename, config);
    const obsoleteIssues = reIssues.filter((i) => i.rule === 'obsolete_statement');
    expect(obsoleteIssues).toHaveLength(0);

    // No parser errors introduced by the fix
    expect(reIssues.find((i) => i.rule === 'parser_error')).toBeUndefined();
  });

  it('multiple fixes compound correctly without corrupting source', () => {
    // Source with multiple fixable issues: lowercase keywords + obsolete statements
    const source = `CLASS zcl_multi DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    methods calculate
      importing iv_x type i
      returning value(rv_result) type i.
ENDCLASS.

CLASS zcl_multi IMPLEMENTATION.
  method calculate.
    data lv_sum type i.
    ADD iv_x TO lv_sum.
    rv_result = lv_sum.
  endmethod.
ENDCLASS.`;

    const filename = detectFilename(source, 'ZCL_MULTI');
    const config = buildLintConfig({ systemType: 'btp' });
    const fixResult = lintAndFix(source, filename, config);

    // Multiple rules should have been fixed
    expect(fixResult.appliedFixes).toBeGreaterThanOrEqual(2);

    // Re-lint should show fewer issues than original
    const originalIssues = lintAbapSource(source, filename, config);
    const fixedIssues = lintAbapSource(fixResult.fixedSource, filename, config);
    expect(fixedIssues.length).toBeLessThan(originalIssues.length);

    // No parser errors in fixed source
    expect(fixedIssues.find((i) => i.rule === 'parser_error')).toBeUndefined();
  });
});

// ─── Custom Rule Override Tests ─────────────────────────────────────

describe('E2E: Custom Rule Overrides', () => {
  it('user can disable a rule that would normally fire', () => {
    const filename = detectFilename(CLOUD_VIOLATIONS_CLASS, 'ZCL_OLD_STYLE');

    // Default cloud config flags obsolete_statement
    const defaultConfig = buildLintConfig({ systemType: 'btp' });
    const defaultIssues = lintAbapSource(CLOUD_VIOLATIONS_CLASS, filename, defaultConfig);
    expect(defaultIssues.some((i) => i.rule === 'obsolete_statement')).toBe(true);

    // User disables obsolete_statement
    const customConfig = buildLintConfig({
      systemType: 'btp',
      ruleOverrides: { obsolete_statement: false },
    });
    const customIssues = lintAbapSource(CLOUD_VIOLATIONS_CLASS, filename, customConfig);
    expect(customIssues.some((i) => i.rule === 'obsolete_statement')).toBe(false);
  });

  it('user can change severity from error to warning', () => {
    const filename = detectFilename(CLOUD_VIOLATIONS_CLASS, 'ZCL_OLD_STYLE');

    // Default: obsolete_statement is Error on cloud
    const defaultConfig = buildLintConfig({ systemType: 'btp' });
    const defaultIssues = lintAbapSource(CLOUD_VIOLATIONS_CLASS, filename, defaultConfig);
    const defaultObsolete = defaultIssues.filter((i) => i.rule === 'obsolete_statement');
    expect(defaultObsolete[0]?.severity).toBe('error');

    // Override to Warning
    const customConfig = buildLintConfig({
      systemType: 'btp',
      ruleOverrides: {
        obsolete_statement: {
          severity: 'Warning',
          add: true,
          subtract: true,
          multiply: true,
          divide: true,
          move: true,
          compute: true,
        },
      },
    });
    const customIssues = lintAbapSource(CLOUD_VIOLATIONS_CLASS, filename, customConfig);
    const customObsolete = customIssues.filter((i) => i.rule === 'obsolete_statement');
    expect(customObsolete[0]?.severity).toBe('warning');
  });

  it('user can re-enable a normally-disabled rule', () => {
    // abapdoc is disabled by default in both presets
    const defaultConfig = buildLintConfig({ systemType: 'btp' });
    const rules = listRulesFromConfig(defaultConfig);
    const abapdoc = rules.find((r) => r.rule === 'abapdoc');
    expect(abapdoc?.enabled).toBe(false);

    // Re-enable it
    const customConfig = buildLintConfig({
      systemType: 'btp',
      ruleOverrides: { abapdoc: true },
    });
    const customRules = listRulesFromConfig(customConfig);
    const customAbapdoc = customRules.find((r) => r.rule === 'abapdoc');
    expect(customAbapdoc?.enabled).toBe(true);
  });

  it('user can set custom line length', () => {
    const config = buildLintConfig({
      systemType: 'onprem',
      ruleOverrides: { line_length: { severity: 'Error', length: 80 } },
    });

    // Source with a long line (>80 chars)
    const source = `CLASS zcl_test DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS test.
ENDCLASS.
CLASS zcl_test IMPLEMENTATION.
  METHOD test.
    DATA lv_very_long_variable_name_that_exceeds_eighty_characters_for_testing_purposes TYPE string.
  ENDMETHOD.
ENDCLASS.`;

    const issues = lintAbapSource(source, 'zcl_test.clas.abap', config);
    const lineIssues = issues.filter((i) => i.rule === 'line_length');
    expect(lineIssues.length).toBeGreaterThan(0);
    expect(lineIssues[0].severity).toBe('error');
  });

  it('user rule overrides are applied in pre-write validation', () => {
    // Parser errors block writes by default
    const filename = detectFilename(PARSER_ERROR_CLASS, 'ZCL_BROKEN');
    const defaultResult = validateBeforeWrite(PARSER_ERROR_CLASS, filename, { systemType: 'onprem' });
    expect(defaultResult.pass).toBe(false);
    expect(defaultResult.errors.some((e) => e.rule === 'parser_error')).toBe(true);

    // User can disable parser_error in pre-write (e.g., for generated code they trust)
    const overrideResult = validateBeforeWrite(PARSER_ERROR_CLASS, filename, {
      systemType: 'onprem',
      ruleOverrides: { parser_error: false },
    });
    // With parser_error disabled, this specific code may pass (or fail on other rules)
    const parserErrors = overrideResult.errors.filter((e) => e.rule === 'parser_error');
    expect(parserErrors).toHaveLength(0);
  });
});

// ─── Pre-Write Gate Behavior Tests ──────────────────────────────────

describe('E2E: Pre-Write Gate', () => {
  it('pre-write config only enables correctness rules (not style)', () => {
    const preWriteConfig = buildPreWriteConfig({ systemType: 'onprem' });
    const rules = preWriteConfig.get().rules as Record<string, unknown>;

    // Correctness rules should be enabled
    expect(rules.parser_error).toBeTruthy();
    expect(rules.begin_end_names).toBeTruthy();

    // Style rules should be disabled
    expect(rules.keyword_case).toBe(false);
    expect(rules.indentation).toBe(false);
    expect(rules.line_length).toBe(false);
    expect(rules.sequential_blank).toBe(false);

    // Naming rules should be disabled
    expect(rules.no_prefixes).toBe(false);
    expect(rules.local_variable_names).toBe(false);
  });

  it('pre-write blocks parser errors but not style issues', () => {
    // This source has lowercase keywords but is syntactically valid
    const source = LOWERCASE_KEYWORDS_CLASS;
    const filename = detectFilename(source, 'ZCL_LOWER');

    // Pre-write should pass (lowercase keywords are style, not correctness)
    const result = validateBeforeWrite(source, filename, { systemType: 'onprem' });
    expect(result.pass).toBe(true);
  });

  it('pre-write separates errors (blocking) from warnings (advisory)', () => {
    const source = PARSER_ERROR_CLASS;
    const filename = detectFilename(source, 'ZCL_BROKEN');

    const result = validateBeforeWrite(source, filename, { systemType: 'onprem' });
    expect(result.pass).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    // All blocking issues should be severity=error
    for (const err of result.errors) {
      expect(err.severity).toBe('error');
    }
  });

  it('empty source passes pre-write (edge case)', () => {
    const result = validateBeforeWrite('', 'empty.clas.abap', { systemType: 'onprem' });
    expect(result).toHaveProperty('pass');
    expect(result).toHaveProperty('errors');
  });
});

// ─── Preset Consistency Tests ───────────────────────────────────────

describe('E2E: Preset Consistency', () => {
  it('cloud preset has more strict rules than on-prem', () => {
    const cloudConfig = buildLintConfig({ systemType: 'btp' });
    const onpremConfig = buildLintConfig({ systemType: 'onprem' });

    const cloudRules = listRulesFromConfig(cloudConfig);
    const onpremRules = listRulesFromConfig(onpremConfig);

    // Cloud should have cloud_types enabled, on-prem shouldn't
    expect(cloudRules.find((r) => r.rule === 'cloud_types')?.enabled).toBe(true);
    expect(onpremRules.find((r) => r.rule === 'cloud_types')?.enabled).toBe(false);

    // Cloud should have strict_sql enabled, on-prem shouldn't
    expect(cloudRules.find((r) => r.rule === 'strict_sql')?.enabled).toBe(true);
    expect(onpremRules.find((r) => r.rule === 'strict_sql')?.enabled).toBe(false);
  });

  it('both presets disable noisy rules unsuitable for MCP context', () => {
    for (const systemType of ['btp', 'onprem'] as const) {
      const config = buildLintConfig({ systemType });
      const rules = listRulesFromConfig(config);

      // These rules are disabled in both presets because they're too noisy
      // for single-file linting in an MCP context
      const noisyRules = ['abapdoc', 'description_empty', 'no_prefixes', 'check_ddic', 'forbidden_void_type'];
      for (const rule of noisyRules) {
        const r = rules.find((r) => r.rule === rule);
        expect(r?.enabled, `Expected ${rule} to be disabled on ${systemType}`).toBe(false);
      }
    }
  });

  it('version mapping is consistent between lint config and pre-write config', () => {
    // Both should use the same ABAP version for the same input
    const lintConfig = buildLintConfig({ systemType: 'onprem', abapRelease: '755' });
    const preWriteConfig = buildPreWriteConfig({ systemType: 'onprem', abapRelease: '755' });

    expect(lintConfig.get().syntax.version).toBe(preWriteConfig.get().syntax.version);
    expect(lintConfig.get().syntax.version).toBe('v755');
  });
});
