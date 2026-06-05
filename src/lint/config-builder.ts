/**
 * abaplint configuration builder for ARC-1.
 *
 * Builds an @abaplint/core Config by layering:
 * 1. Base: Default config for the detected ABAP version
 * 2. Preset: Cloud or on-prem rule overrides (disable noisy rules, set severities)
 * 3. User: Custom rule overrides from config file or tool args
 *
 * This replaces the hardcoded `Config.getDefault(Version.v702)` with
 * a system-aware, customizable configuration.
 *
 * Architecture note: We start from abaplint's full default config (181 rules)
 * and selectively disable/adjust rules rather than building from scratch.
 * This ensures we benefit from new rules added in abaplint updates while
 * keeping our curated severity levels and disabled-rule list.
 *
 * The cloud vs on-prem distinction is primarily about:
 * - syntax.version: Cloud vs v702-v758 (controls which ABAP syntax is valid)
 * - cloud_types rule: blocks PROG/FORM/etc. that don't exist in BTP
 * - strict_sql rule: enforces strict Open SQL (cloud requirement)
 * - obsolete_statement severity: Error on cloud (won't compile), Warning on-prem (advisory)
 */

import { readFileSync } from 'node:fs';
import { Config, Version } from '@abaplint/core';
import { isBeyondAbaplintCeiling, mapSapReleaseToAbaplintVersion } from '../adt/features.js';
import type { SystemType } from '../adt/types.js';
import { CLOUD_DISABLED_RULES, CLOUD_ERROR_RULES, CLOUD_WARNING_RULES } from './presets/cloud.js';
import { ONPREM_DISABLED_RULES, ONPREM_ERROR_RULES, ONPREM_WARNING_RULES } from './presets/onprem.js';

/** Rule override: true to enable with defaults, false to disable, or object with config */
export type RuleOverrides = Record<string, boolean | Record<string, unknown>>;

/** Options for building an abaplint config */
export interface LintConfigOptions {
  /** SAP system type: 'btp' or 'onprem' */
  systemType?: SystemType;
  /** SAP_BASIS release string (e.g., "757") */
  abapRelease?: string;
  /** Path to custom abaplint.jsonc config file */
  configFile?: string;
  /** Inline rule overrides (from tool call args) */
  ruleOverrides?: RuleOverrides;
}

/**
 * Build an abaplint Config from system metadata and user overrides.
 *
 * Resolution order (each layer overrides the previous):
 * 1. Default config for the ABAP version
 * 2. System preset (cloud or on-prem) — disables noisy rules, sets severities
 * 3. User config file (if provided)
 * 4. Inline rule overrides (if provided)
 */
export function buildLintConfig(options: LintConfigOptions = {}): Config {
  const version = resolveVersion(options);
  const base = Config.getDefault(version);
  const raw = JSON.parse(JSON.stringify(base.get())) as Record<string, unknown>;

  // Apply system preset
  const preset = options.systemType === 'btp' ? 'cloud' : 'onprem';
  applyPreset(raw, preset);

  // On releases newer than abaplint's grammar (e.g. SAP_BASIS 816), abaplint cannot parse
  // legitimate new syntax and reports false-positive parse errors. Demote them to warnings so
  // standalone lint doesn't mislabel valid new-syntax source as broken (matches buildPreWriteConfig).
  // Applied before user config/overrides so an explicit user severity still wins.
  if (isBeyondAbaplintCeiling(options.abapRelease)) {
    applyRuleOverrides(raw, {
      parser_error: { severity: 'Warning' },
      cds_parser_error: { severity: 'Warning' },
    });
  }

  // Apply user config file (if provided)
  if (options.configFile) {
    applyConfigFile(raw, options.configFile);
  }

  // Apply inline rule overrides (from tool args)
  if (options.ruleOverrides) {
    applyRuleOverrides(raw, options.ruleOverrides);
  }

  return new Config(JSON.stringify(raw));
}

/**
 * Build a "pre-write" config — a strict subset of rules that should
 * block writes when they fail. Only includes correctness rules,
 * not style/formatting.
 */
export function buildPreWriteConfig(options: LintConfigOptions = {}): Config {
  const version = resolveVersion(options);
  const base = Config.getDefault(version);
  const raw = JSON.parse(JSON.stringify(base.get())) as Record<string, unknown>;
  const rules = raw.rules as Record<string, unknown>;

  // Disable ALL rules first
  for (const key of Object.keys(rules)) {
    rules[key] = false;
  }

  // On releases newer than abaplint's parser grammar (e.g. ABAP Platform 2025 = 816),
  // abaplint cannot parse legitimate new syntax (CDS `define table entity`,
  // `READ TABLE ... WHERE`, RAP keywords, ...) and emits false-positive parse errors.
  // Demote them to non-blocking warnings so the write proceeds (SAP-side activation is the
  // definitive syntax check). Genuine parse errors on supported releases still block.
  const parserSeverity: 'Error' | 'Warning' = isBeyondAbaplintCeiling(options.abapRelease) ? 'Warning' : 'Error';

  // Enable only pre-write blocking rules
  const preWriteRules: RuleOverrides = {
    parser_error: { severity: parserSeverity },
    parser_missing_space: { severity: 'Error' },
    begin_end_names: { severity: 'Error' },
    unreachable_code: { severity: 'Error' },
    identical_conditions: { severity: 'Error' },
    // CDS syntax errors (catches missing commas, wrong keywords, invalid DDL constructs)
    cds_parser_error: { severity: parserSeverity },
  };

  // Add cloud-specific blocking rules
  if (options.systemType === 'btp') {
    preWriteRules.cloud_types = { severity: 'Error' };
    preWriteRules.strict_sql = { severity: 'Error' };
    preWriteRules.sql_escape_host_variables = { severity: 'Error' };
    preWriteRules.obsolete_statement = {
      severity: 'Error',
      refresh: true,
      compute: true,
      add: true,
      subtract: true,
      multiply: true,
      divide: true,
      move: true,
      formDefinition: true,
      formImplementation: true,
    };
  }

  // Apply pre-write defaults first, then user overrides on top.
  // This lets users customize pre-write behavior (e.g., disable a rule
  // they know produces false positives in their codebase).
  applyRuleOverrides(raw, preWriteRules);

  if (options.configFile) {
    applyConfigFile(raw, options.configFile);
  }
  if (options.ruleOverrides) {
    applyRuleOverrides(raw, options.ruleOverrides);
  }

  return new Config(JSON.stringify(raw));
}

/** Resolve the abaplint Version from options */
function resolveVersion(options: LintConfigOptions): Version {
  if (options.systemType === 'btp') return Version.Cloud;
  if (options.abapRelease) return mapSapReleaseToAbaplintVersion(options.abapRelease);
  return Version.v702; // Conservative default
}

/** Apply a preset (cloud or onprem) to the raw config */
function applyPreset(raw: Record<string, unknown>, preset: 'cloud' | 'onprem'): void {
  const rules = raw.rules as Record<string, unknown>;
  const disabledRules = preset === 'cloud' ? CLOUD_DISABLED_RULES : ONPREM_DISABLED_RULES;
  const errorRules = preset === 'cloud' ? CLOUD_ERROR_RULES : ONPREM_ERROR_RULES;
  const warningRules = preset === 'cloud' ? CLOUD_WARNING_RULES : ONPREM_WARNING_RULES;

  // Disable noisy rules
  for (const rule of disabledRules) {
    rules[rule] = false;
  }

  // Apply error rules
  for (const [rule, config] of Object.entries(errorRules)) {
    rules[rule] = config;
  }

  // Apply warning rules
  for (const [rule, config] of Object.entries(warningRules)) {
    rules[rule] = config;
  }
}

/** Apply overrides from a user config file */
function applyConfigFile(raw: Record<string, unknown>, configFile: string): void {
  try {
    const content = readFileSync(configFile, 'utf-8');
    // Strip JSONC comments (// and /* */). This naive regex doesn't handle
    // "//" inside string values, but abaplint configs don't use string values
    // containing "//", so this is safe in practice.
    const stripped = content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const userConfig = JSON.parse(stripped) as Record<string, unknown>;

    // Merge rules
    if (userConfig.rules && typeof userConfig.rules === 'object') {
      applyRuleOverrides(raw, userConfig.rules as RuleOverrides);
    }

    // Merge syntax settings
    if (userConfig.syntax && typeof userConfig.syntax === 'object') {
      raw.syntax = { ...(raw.syntax as Record<string, unknown>), ...(userConfig.syntax as Record<string, unknown>) };
    }
  } catch (err) {
    // Log warning but don't crash — lint should degrade gracefully
    // if the config file is missing or malformed
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[arc-1] Warning: Could not load abaplint config "${configFile}": ${msg}`);
  }
}

/** Apply rule overrides to the raw config */
function applyRuleOverrides(raw: Record<string, unknown>, overrides: RuleOverrides): void {
  const rules = raw.rules as Record<string, unknown>;
  for (const [rule, config] of Object.entries(overrides)) {
    if (config === false) {
      rules[rule] = false;
    } else if (config === true) {
      // Enable with defaults (don't override existing config)
      if (!rules[rule]) {
        rules[rule] = { severity: 'Error' };
      }
    } else {
      rules[rule] = config;
    }
  }
}

/** List all available rules with their current config from a Config object */
export function listRulesFromConfig(config: Config): Array<{ rule: string; enabled: boolean; severity?: string }> {
  const rules = config.get().rules as Record<string, unknown>;
  return Object.entries(rules).map(([rule, cfg]) => {
    if (cfg === false || cfg === undefined) {
      return { rule, enabled: false };
    }
    const severity =
      typeof cfg === 'object' && cfg !== null ? ((cfg as Record<string, unknown>).severity as string) : 'Error';
    return { rule, enabled: true, severity: severity ?? 'Error' };
  });
}
