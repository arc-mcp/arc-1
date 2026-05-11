/**
 * ABAP Lint wrapper using @abaplint/core.
 *
 * In the Go version, we had a custom port of the abaplint lexer (1,700 LOC).
 * Now that we're in TypeScript, we use @abaplint/core directly — it's the
 * original implementation, maintained by the abaplint author.
 *
 * This gives us the full lexer + parser + linter with 100+ rules,
 * instead of our Go port's 8 rules and 48 token types.
 *
 * Enhanced with:
 * - Version-aware config (cloud vs on-prem presets)
 * - Auto-fix support via abaplint quickfix API
 * - Pre-write validation (blocks writes on hard errors)
 */

import { Config, Edits, MemoryFile, Registry, Version } from '@abaplint/core';
import { buildPreWriteConfig, type LintConfigOptions } from './config-builder.js';
import { inspectTablSource } from './pre-write-hints.js';

/** Lint result from @abaplint/core */
export interface LintResult {
  rule: string;
  message: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  severity: 'error' | 'warning' | 'info';
}

/** Result of lint-and-fix operation */
export interface LintFixResult {
  /** Source code after applying all available fixes */
  fixedSource: string;
  /** Number of fixes applied */
  appliedFixes: number;
  /** Rules that were auto-fixed */
  fixedRules: string[];
  /** Issues remaining after fixes */
  remainingIssues: LintResult[];
}

/** Result of pre-write validation */
export interface PreWriteResult {
  /** Whether the write should proceed */
  pass: boolean;
  /** Errors that block the write */
  errors: LintResult[];
  /** Warnings (advisory, don't block) */
  warnings: LintResult[];
}

/** Default abaplint configuration for ARC-1 (legacy, used as fallback) */
const DEFAULT_CONFIG = Config.getDefault(Version.v702);

/**
 * Lint ABAP source code using @abaplint/core.
 *
 * @param source - ABAP source code
 * @param filename - Filename with appropriate extension (.prog.abap, .clas.abap, etc.)
 * @param config - Optional abaplint configuration (defaults to standard ABAP rules)
 */
export function lintAbapSource(source: string, filename: string, config?: Config): LintResult[] {
  const reg = new Registry(config ?? DEFAULT_CONFIG);
  reg.addFile(new MemoryFile(filename, source));
  reg.parse();

  return reg.findIssues().map((issue) => ({
    rule: issue.getKey(),
    message: issue.getMessage(),
    line: issue.getStart().getRow(),
    column: issue.getStart().getCol(),
    endLine: issue.getEnd().getRow(),
    endColumn: issue.getEnd().getCol(),
    severity: mapSeverity(issue.getSeverity()),
  }));
}

/**
 * Lint ABAP source and auto-fix all fixable issues.
 *
 * Uses abaplint's quickfix API (getDefaultFix + applyEditSingle) to
 * iteratively apply fixes. Returns the cleaned source and remaining issues.
 *
 * Inspired by ABAP cleaner's "clean at a keystroke" approach, but using
 * abaplint's native fix system.
 */
export function lintAndFix(source: string, filename: string, config?: Config): LintFixResult {
  const cfg = config ?? DEFAULT_CONFIG;
  const reg = new Registry(cfg);
  reg.addFile(new MemoryFile(filename, source));
  reg.parse();

  const fixedRules: string[] = [];
  let appliedFixes = 0;

  // Iterative fix loop — apply one fix at a time, re-parse, repeat
  // Limit iterations to prevent infinite loops from conflicting fixes
  const MAX_ITERATIONS = 50;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const issues = reg.findIssues();
    let fixApplied = false;

    for (const issue of issues) {
      const fix = issue.getDefaultFix();
      if (fix) {
        Edits.applyEditSingle(reg, fix);
        reg.parse();
        appliedFixes++;
        if (!fixedRules.includes(issue.getKey())) {
          fixedRules.push(issue.getKey());
        }
        fixApplied = true;
        break; // Re-parse and re-scan after each fix
      }
    }

    if (!fixApplied) break;
  }

  // Get remaining issues after all fixes
  const remainingIssues = reg.findIssues().map((issue) => ({
    rule: issue.getKey(),
    message: issue.getMessage(),
    line: issue.getStart().getRow(),
    column: issue.getStart().getCol(),
    endLine: issue.getEnd().getRow(),
    endColumn: issue.getEnd().getCol(),
    severity: mapSeverity(issue.getSeverity()),
  }));

  const file = reg.getFileByName(filename);
  const fixedSource = file ? file.getRaw() : source;

  return { fixedSource, appliedFixes, fixedRules, remainingIssues };
}

/**
 * Validate ABAP source before writing to SAP system.
 *
 * Uses a strict subset of rules focused on correctness (not style).
 * Errors block the write; warnings are advisory.
 */
export function validateBeforeWrite(
  source: string,
  filename: string,
  configOptions?: LintConfigOptions,
): PreWriteResult {
  const config = buildPreWriteConfig(configOptions ?? {});
  const issues = lintAbapSource(source, filename, config);

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  // ARC-1-native pre-write semantic hints (filename-gated; advisory only).
  // See `src/lint/pre-write-hints.ts` for the per-type inspection functions.
  if (filename.endsWith('.tabl.astabl')) {
    warnings.push(...inspectTablSource(source));
  }

  return {
    pass: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Auto-detect the correct filename for ABAP source based on content.
 * abaplint uses the file extension to determine the object type.
 */
export function detectFilename(source: string, objectName: string): string {
  // Strip leading comment lines ("! doc comments, * comments) and blank lines to find the first keyword
  const stripped = source.replace(/^(\s*(["*!].*)?[\r\n]*)*/m, '');
  const upper = stripped.toUpperCase().trimStart();
  const name = objectName.toLowerCase();

  // ABAP types — check first keyword
  if (upper.startsWith('CLASS')) return `${name}.clas.abap`;
  if (upper.startsWith('INTERFACE')) return `${name}.intf.abap`;
  if (upper.startsWith('FUNCTION-POOL') || upper.startsWith('FUNCTION')) return `${name}.fugr.abap`;
  if (upper.startsWith('REPORT') || upper.startsWith('PROGRAM')) return `${name}.prog.abap`;

  // CDS/DDL types — check the first structural keyword (may be preceded by annotations)
  // Strip leading annotations (@...\n) to find the actual define/annotate keyword
  const afterAnnotations = upper.replace(/^(\s*@[^\n]*\n)*/m, '').trimStart();
  if (afterAnnotations.startsWith('DEFINE TABLE')) return `${name}.tabl.astabl`;
  if (afterAnnotations.startsWith('DEFINE SERVICE')) return `${name}.srvd.asrvd`;
  if (afterAnnotations.startsWith('ANNOTATE VIEW') || afterAnnotations.startsWith('ANNOTATE ENTITY'))
    return `${name}.ddlx.asddlx`;
  if (afterAnnotations.startsWith('DEFINE VIEW') || afterAnnotations.startsWith('DEFINE ROOT VIEW'))
    return `${name}.ddls.asddls`;
  // Fallback: source starts with @ but keyword not matched — assume CDS view (most common)
  if (upper.startsWith('@')) return `${name}.ddls.asddls`;

  // BDEF types — behavior definitions
  if (
    upper.startsWith('MANAGED') ||
    upper.startsWith('UNMANAGED') ||
    upper.startsWith('ABSTRACT') ||
    upper.startsWith('PROJECTION;') ||
    upper.startsWith('PROJECTION\n') ||
    upper.startsWith('PROJECTION\r') ||
    upper.startsWith('PROJECTION ')
  )
    return `${name}.bdef.asbdef`;

  // Default to class (enables most rules)
  return `${name}.clas.abap`;
}

/** Map abaplint severity to our severity levels */
function mapSeverity(severity: { toString(): string }): 'error' | 'warning' | 'info' {
  const s = severity.toString().toLowerCase();
  if (s === 'error') return 'error';
  if (s === 'warning') return 'warning';
  return 'info';
}
