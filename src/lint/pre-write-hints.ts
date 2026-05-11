/**
 * ARC-1-native pre-write semantic hints.
 *
 * These hints inspect source code for known anti-patterns that lie outside the
 * scope of `@abaplint/core` rules — typically RAP/CDS conventions where the SAP
 * standard pattern matters at a *layer above* TABL/CDS syntax (e.g. a draft
 * table activates fine but breaks BDEF binding because of a non-canonical
 * include shape).
 *
 * Each hint is a pure function: `(source: string) => LintResult[]`. Hints
 * always emit `severity: 'warning'` — they are advisory and never block writes.
 * Call sites filename-gate the hints (e.g. only run `inspectTablSource` when
 * the filename ends with `.tabl.astabl`) so other object types are unaffected.
 *
 * Adding a new hint:
 *   1. Add an `inspect<Type>Source(source: string): LintResult[]` function here.
 *   2. Wire the call into `validateBeforeWrite` in `./lint.ts`, gated on the
 *      appropriate filename suffix.
 *   3. Cover the hint with unit tests in `tests/unit/lint/pre-write-hints.test.ts`.
 */

import type { LintResult } from './lint.js';

export type { LintResult } from './lint.js';

/** Matches every occurrence of `include sych_bdl_draft_admin_inc` (case-insensitive). */
const DRAFT_ADMIN_INC_REGEX = /\binclude\s+sych_bdl_draft_admin_inc\b/gi;

/**
 * Matches the canonical named-include prefix `"%admin" :` immediately preceding
 * an include keyword. Used as a "look-back" check on the segment between the
 * statement separator (`;`, `{`, `}`) and the matched include.
 */
const CANONICAL_PREFIX_REGEX = /"%admin"\s*:\s*$/i;

const TABL_DRAFT_ADMIN_RULE = 'arc1-tabl-draft-admin-include';

const TABL_DRAFT_ADMIN_MESSAGE =
  'Draft admin include should use the canonical named form ' +
  '`"%admin" : include sych_bdl_draft_admin_inc;` ' +
  '— see ABAP keyword doc ABENBDL_DRAFT_TABLE ' +
  '(https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/ABENBDL_DRAFT_TABLE.html). ' +
  'SAP standard draft tables (e.g. BOTD_TAB_ROOT_D) all use the named form; ' +
  'the bare include activates at TABL level on most releases but breaks BDEF ' +
  'binding for some draft scenarios.';

/**
 * Inspect a TABL source for known anti-patterns and return non-blocking warnings.
 *
 * Currently checks:
 *
 * - **Draft admin include without canonical name** (rule
 *   `arc1-tabl-draft-admin-include`): `include sych_bdl_draft_admin_inc` is used
 *   without the SAP-canonical `"%admin"` named-substructure prefix. The bare
 *   form activates at TABL level on most releases but is non-canonical per the
 *   ABAP keyword doc `ABENBDL_DRAFT_TABLE` and breaks BDEF binding for some
 *   draft scenarios. SAP standard draft tables (e.g. `BOTD_TAB_ROOT_D`) all
 *   use the named form.
 *
 * The function is pure (no I/O, no async). CDS line (`//`) and block
 * (slash-star block) comments are stripped before scanning so commented-out
 * code does not trigger false positives.
 *
 * @param source - TABL CDS source code
 * @returns Array of `LintResult` warnings (always `severity: 'warning'`); empty
 *          if the source uses canonical patterns or has no draft admin include.
 */
export function inspectTablSource(source: string): LintResult[] {
  const stripped = stripCdsComments(source);
  const warnings: LintResult[] = [];

  DRAFT_ADMIN_INC_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DRAFT_ADMIN_INC_REGEX.exec(stripped)) !== null) {
    const matchStart = match.index;
    if (isCanonicalContext(stripped, matchStart)) {
      continue;
    }
    const { line, column } = positionAt(stripped, matchStart);
    warnings.push({
      rule: TABL_DRAFT_ADMIN_RULE,
      message: TABL_DRAFT_ADMIN_MESSAGE,
      line,
      column,
      endLine: line,
      endColumn: column + match[0].length,
      severity: 'warning',
    });
  }

  return warnings;
}

/**
 * Strip CDS-style comments (`//` line, slash-star block block) so hint scans
 * don't false-positive on commented-out code. Preserves source length and line
 * count (comments are replaced with whitespace) so positions of remaining
 * tokens are unchanged.
 */
function stripCdsComments(source: string): string {
  let result = '';
  let i = 0;
  while (i < source.length) {
    if (source[i] === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') {
        result += ' ';
        i++;
      }
    } else if (source[i] === '/' && source[i + 1] === '*') {
      // Block comment — preserve newlines, blank everything else
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        result += source[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < source.length) {
        result += '  ';
        i += 2;
      }
    } else {
      result += source[i];
      i++;
    }
  }
  return result;
}

/**
 * Look back from `matchIndex` to the start of the current statement (previous
 * `;`, `{`, or `}`) and check whether that segment ends with `"%admin" :` —
 * the canonical named-include prefix. Handles single-line and multi-line
 * `"%admin" :` ... `include` shapes uniformly.
 */
function isCanonicalContext(source: string, matchIndex: number): boolean {
  let stmtStart = 0;
  for (let i = matchIndex - 1; i >= 0; i--) {
    const ch = source[i];
    if (ch === ';' || ch === '{' || ch === '}') {
      stmtStart = i + 1;
      break;
    }
  }
  const stmtBefore = source.substring(stmtStart, matchIndex);
  return CANONICAL_PREFIX_REGEX.test(stmtBefore);
}

/** Convert a 0-based string index to 1-based `(line, column)` coordinates. */
function positionAt(source: string, index: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source[i] === '\n') {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: index - lineStart + 1 };
}
