import { Config } from '@abaplint/core';
import { describe, expect, it, vi } from 'vitest';
import { buildLintConfig, buildPreWriteConfig, listRulesFromConfig } from '../../../src/lint/config-builder.js';

describe('Config Builder', () => {
  describe('buildLintConfig', () => {
    it('returns a valid Config with no options', () => {
      const config = buildLintConfig();
      expect(config).toBeInstanceOf(Config);
      expect(Object.keys(config.get().rules).length).toBeGreaterThan(0);
    });

    it('uses Cloud version for BTP system type', () => {
      const config = buildLintConfig({ systemType: 'btp' });
      expect(config.get().syntax.version).toEqual({ release: 'Newest', language: 'Cloud' });
    });

    it('uses mapped version for on-prem with release', () => {
      const config = buildLintConfig({ systemType: 'onprem', abapRelease: '757' });
      expect(config.get().syntax.version).toBe('v757');
    });

    it('uses v758 for S/4HANA 2023 release override', () => {
      const config = buildLintConfig({ systemType: 'onprem', abapRelease: '758' });
      expect(config.get().syntax.version).toBe('v758');
    });

    it('falls back to v702 for on-prem without release', () => {
      const config = buildLintConfig({ systemType: 'onprem' });
      expect(config.get().syntax.version).toBe('v702');
    });

    it('enables cloud_types for BTP', () => {
      const config = buildLintConfig({ systemType: 'btp' });
      const rules = config.get().rules as Record<string, unknown>;
      expect(rules.cloud_types).toBeTruthy();
      expect((rules.cloud_types as Record<string, unknown>).severity).toBe('Error');
    });

    it('disables cloud_types for on-prem', () => {
      const config = buildLintConfig({ systemType: 'onprem' });
      const rules = config.get().rules as Record<string, unknown>;
      expect(rules.cloud_types).toBe(false);
    });

    it('enables strict_sql for BTP', () => {
      const config = buildLintConfig({ systemType: 'btp' });
      const rules = config.get().rules as Record<string, unknown>;
      expect(rules.strict_sql).toBeTruthy();
    });

    it('disables strict_sql for on-prem', () => {
      const config = buildLintConfig({ systemType: 'onprem' });
      const rules = config.get().rules as Record<string, unknown>;
      expect(rules.strict_sql).toBe(false);
    });

    it('disables noisy rules (abapdoc, description_empty, no_prefixes)', () => {
      for (const systemType of ['btp', 'onprem'] as const) {
        const config = buildLintConfig({ systemType });
        const rules = config.get().rules as Record<string, unknown>;
        expect(rules.abapdoc).toBe(false);
        expect(rules.description_empty).toBe(false);
        expect(rules.no_prefixes).toBe(false);
      }
    });

    it('applies rule overrides on top of preset', () => {
      const config = buildLintConfig({
        systemType: 'btp',
        ruleOverrides: {
          line_length: { severity: 'Error', length: 200 },
          abapdoc: true, // Re-enable a disabled rule
        },
      });
      const rules = config.get().rules as Record<string, unknown>;
      expect((rules.line_length as Record<string, unknown>).length).toBe(200);
      expect(rules.abapdoc).toBeTruthy();
    });

    it('can disable rules via overrides', () => {
      const config = buildLintConfig({
        systemType: 'btp',
        ruleOverrides: {
          cloud_types: false,
        },
      });
      const rules = config.get().rules as Record<string, unknown>;
      expect(rules.cloud_types).toBe(false);
    });
  });

  describe('graceful degradation on bad config file', () => {
    it('returns valid config when configFile does not exist', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const config = buildLintConfig({
        systemType: 'onprem',
        configFile: '/nonexistent/path/abaplint.jsonc',
      });
      // Should still return a usable config (falls back to preset)
      expect(config).toBeInstanceOf(Config);
      expect(Object.keys(config.get().rules).length).toBeGreaterThan(0);
      // Should warn on stderr
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('Could not load abaplint config'));
      spy.mockRestore();
    });

    it('returns valid config when configFile contains invalid JSON', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      // Use a file that exists but isn't JSON (e.g., package.json's parent dir)
      const config = buildLintConfig({
        systemType: 'btp',
        configFile: '/dev/null', // exists but empty → JSON.parse('') throws
      });
      expect(config).toBeInstanceOf(Config);
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('Could not load abaplint config'));
      spy.mockRestore();
    });
  });

  describe('buildPreWriteConfig', () => {
    it('only enables correctness rules', () => {
      const config = buildPreWriteConfig({ systemType: 'onprem' });
      const rules = config.get().rules as Record<string, unknown>;

      // Correctness rules should be enabled
      expect(rules.parser_error).toBeTruthy();
      expect(rules.begin_end_names).toBeTruthy();
      expect(rules.unreachable_code).toBeTruthy();

      // Style rules should be disabled
      expect(rules.keyword_case).toBe(false);
      expect(rules.line_length).toBe(false);
      expect(rules.indentation).toBe(false);
    });

    it('adds cloud-specific rules for BTP', () => {
      const config = buildPreWriteConfig({ systemType: 'btp' });
      const rules = config.get().rules as Record<string, unknown>;

      expect(rules.cloud_types).toBeTruthy();
      expect(rules.strict_sql).toBeTruthy();
      expect(rules.sql_escape_host_variables).toBeTruthy();
      expect(rules.obsolete_statement).toBeTruthy();
    });

    it('does not include cloud rules for on-prem', () => {
      const config = buildPreWriteConfig({ systemType: 'onprem' });
      const rules = config.get().rules as Record<string, unknown>;

      expect(rules.cloud_types).toBe(false);
      expect(rules.strict_sql).toBe(false);
    });

    it('includes cds_parser_error for all system types', () => {
      for (const systemType of ['btp', 'onprem'] as const) {
        const config = buildPreWriteConfig({ systemType });
        const rules = config.get().rules as Record<string, unknown>;
        expect(rules.cds_parser_error).toBeTruthy();
        expect((rules.cds_parser_error as Record<string, unknown>).severity).toBe('Error');
      }
    });

    it('uses v758 for S/4HANA 2023 release override', () => {
      const config = buildPreWriteConfig({ systemType: 'onprem', abapRelease: '758' });
      expect(config.get().syntax.version).toBe('v758');
    });
  });

  describe('CDS rules in presets', () => {
    it('enables cds_parser_error as Error for both presets', () => {
      for (const systemType of ['btp', 'onprem'] as const) {
        const config = buildLintConfig({ systemType });
        const rules = config.get().rules as Record<string, unknown>;
        expect(rules.cds_parser_error).toBeTruthy();
        expect((rules.cds_parser_error as Record<string, unknown>).severity).toBe('Error');
      }
    });

    it('disables cds_naming for both presets', () => {
      for (const systemType of ['btp', 'onprem'] as const) {
        const config = buildLintConfig({ systemType });
        const rules = config.get().rules as Record<string, unknown>;
        expect(rules.cds_naming).toBe(false);
      }
    });

    it('sets cds_legacy_view as Error on BTP, Warning on on-prem', () => {
      const btpConfig = buildLintConfig({ systemType: 'btp' });
      const btpRules = btpConfig.get().rules as Record<string, unknown>;
      expect((btpRules.cds_legacy_view as Record<string, unknown>).severity).toBe('Error');

      const onpremConfig = buildLintConfig({ systemType: 'onprem' });
      const onpremRules = onpremConfig.get().rules as Record<string, unknown>;
      expect((onpremRules.cds_legacy_view as Record<string, unknown>).severity).toBe('Warning');
    });

    it('sets CDS style rules as Warning for both presets', () => {
      for (const systemType of ['btp', 'onprem'] as const) {
        const config = buildLintConfig({ systemType });
        const rules = config.get().rules as Record<string, unknown>;
        for (const rule of ['cds_association_name', 'cds_comment_style', 'cds_field_order']) {
          expect(rules[rule]).toBeTruthy();
          expect((rules[rule] as Record<string, unknown>).severity).toBe('Warning');
        }
      }
    });
  });

  describe('listRulesFromConfig', () => {
    it('lists all rules with enabled/disabled status', () => {
      const config = buildLintConfig({ systemType: 'btp' });
      const rules = listRulesFromConfig(config);

      expect(rules.length).toBeGreaterThan(0);

      const enabled = rules.filter((r) => r.enabled);
      const disabled = rules.filter((r) => !r.enabled);
      expect(enabled.length).toBeGreaterThan(0);
      expect(disabled.length).toBeGreaterThan(0);

      // Check structure
      for (const r of rules) {
        expect(r).toHaveProperty('rule');
        expect(r).toHaveProperty('enabled');
        if (r.enabled) {
          expect(r).toHaveProperty('severity');
        }
      }
    });

    it('shows correct severity for configured rules', () => {
      const config = buildLintConfig({ systemType: 'btp' });
      const rules = listRulesFromConfig(config);

      const cloudTypes = rules.find((r) => r.rule === 'cloud_types');
      expect(cloudTypes?.enabled).toBe(true);
      expect(cloudTypes?.severity).toBe('Error');

      const lineLength = rules.find((r) => r.rule === 'line_length');
      expect(lineLength?.enabled).toBe(true);
      expect(lineLength?.severity).toBe('Warning');
    });
  });
});
