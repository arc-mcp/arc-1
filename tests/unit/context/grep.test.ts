/**
 * Unit tests for the pure grepSource helper.
 */

import { describe, expect, it } from 'vitest';
import {
  grepSource,
  MAX_GREP_LINE_LENGTH,
  MAX_GREP_PATTERN_LENGTH,
  type MethodRange,
} from '../../../src/context/grep.js';

// ─── Fixtures ───────────────────────────────────────────────────────

const SOURCE = `REPORT zfoo.
DATA lv_count TYPE i.
START-OF-SELECTION.
  SELECT * FROM mara INTO TABLE @DATA(lt_mara).
  LOOP AT lt_mara INTO DATA(ls_mara).
    WRITE ls_mara-matnr.
  ENDLOOP.
  SELECT SINGLE maktx FROM makt INTO @DATA(lv_text).
  WRITE lv_text.`;

// A small class with two methods so we can test method annotation + multi-class labels.
const CLASS_METHODS: MethodRange[] = [
  { name: 'read', containingClass: 'lcl_dao', startLine: 11, endLine: 13 },
  { name: 'read_text', containingClass: 'lcl_dao', startLine: 14, endLine: 16 },
];

describe('grepSource', () => {
  it('returns only matching lines with a header and > marker', () => {
    const r = grepSource(SOURCE, 'LOOP');
    expect(r.invalidPattern).toBe(false);
    expect(r.matchCount).toBe(2); // LOOP AT + ENDLOOP
    expect(r.output).toContain('2 match(es) for /LOOP/i:');
    expect(r.output).toContain('>    5: ');
    expect(r.output).toContain('LOOP AT lt_mara');
  });

  it('shows context lines around a match without marking them', () => {
    const r = grepSource(SOURCE, 'START-OF-SELECTION');
    // Match on line 3; context ±3 should include lines 1..6.
    expect(r.output).toContain('    1: REPORT zfoo.');
    expect(r.output).toContain('>    3: START-OF-SELECTION.');
    expect(r.output).toContain('    6: '); // context line, no '>' marker
    expect(r.output).not.toContain('>    6: ');
  });

  it('uses 1-based line numbers', () => {
    const r = grepSource(SOURCE, 'REPORT zfoo');
    expect(r.output).toContain('>    1: REPORT zfoo.');
  });

  it('separates non-contiguous match blocks with --', () => {
    // WRITE on line 6 and line 9; with no context window they are distinct blocks.
    const r = grepSource(SOURCE, 'WRITE', { contextLines: 0 });
    expect(r.matchCount).toBe(2);
    expect(r.output).toContain('\n--\n');
  });

  it('returns a friendly message on zero matches (valid pattern)', () => {
    const r = grepSource(SOURCE, 'ZZZ_NO_SUCH_TOKEN');
    expect(r.matchCount).toBe(0);
    expect(r.invalidPattern).toBe(false);
    expect(r.output).toBe('No matches found for /ZZZ_NO_SUCH_TOKEN/i.');
  });

  it('is case-insensitive', () => {
    // lowercase pattern matches the uppercase "SELECT SINGLE" line (and only it).
    const r = grepSource(SOURCE, 'select single');
    expect(r.matchCount).toBe(1);
    expect(r.output).toContain('SELECT SINGLE maktx');
  });

  it('normalizes CRLF source', () => {
    const crlf = SOURCE.replace(/\n/g, '\r\n');
    const r = grepSource(crlf, 'LOOP');
    expect(r.matchCount).toBe(2);
    expect(r.output).not.toContain('\r');
  });

  it('retries a valid-but-zero-match metachar pattern as a literal', () => {
    // "@DATA(" is valid regex but the unescaped ( means zero regex matches here;
    // escaped literal "@DATA\(" matches the two SELECT ... INTO @DATA(...) lines.
    const r = grepSource(SOURCE, '@DATA(');
    expect(r.invalidPattern).toBe(false);
    expect(r.matchCount).toBe(2);
    expect(r.output).toContain('@DATA\\('); // header shows the effective (escaped) pattern
  });

  it('falls back to a literal search when the pattern is not valid regex but appears literally', () => {
    const src = 'CALL METHOD lo->read_entities( ).\nWRITE 1.';
    const r = grepSource(src, 'read_entities('); // unbalanced paren → invalid regex
    expect(r.invalidPattern).toBe(false);
    expect(r.matchCount).toBe(1);
    expect(r.output).toContain('read_entities(');
  });

  it('flags invalidPattern when a malformed regex also has no literal match', () => {
    const r = grepSource(SOURCE, 'nope(');
    expect(r.invalidPattern).toBe(true);
    expect(r.matchCount).toBe(0);
    expect(r.output).toContain('Invalid regex pattern');
  });

  it('rejects oversized patterns before compiling regex', () => {
    const r = grepSource(SOURCE, 'x'.repeat(MAX_GREP_PATTERN_LENGTH + 1));
    expect(r.invalidPattern).toBe(true);
    expect(r.output).toContain('pattern is too long');
  });

  it('rejects nested quantified groups that can cause catastrophic backtracking', () => {
    const repeatedChar = String.fromCharCode(97);
    const source = `${repeatedChar.repeat(30)}!`;
    const unsafePattern = `(${repeatedChar}+)+$`;
    const started = Date.now();
    const r = grepSource(source, unsafePattern);
    expect(Date.now() - started).toBeLessThan(50);
    expect(r.invalidPattern).toBe(true);
    expect(r.output).toContain('nested quantified groups');
  });

  it('rejects quantified alternation groups that can cause catastrophic backtracking', () => {
    const repeatedChar = String.fromCharCode(97);
    const source = `${repeatedChar.repeat(40)}!`;
    const unsafePattern = `^(${repeatedChar}|${repeatedChar}${repeatedChar})+$`;
    const started = Date.now();
    const r = grepSource(source, unsafePattern);
    expect(Date.now() - started).toBeLessThan(50);
    expect(r.invalidPattern).toBe(true);
    expect(r.output).toContain('quantified alternation groups');
  });

  it('still allows simple non-quantified alternation searches', () => {
    const r = grepSource(SOURCE, '\\b(?:SELECT|WRITE)\\b');
    expect(r.invalidPattern).toBe(false);
    expect(r.matchCount).toBe(4);
  });

  it('searches only the bounded line prefix while rendering the original source line', () => {
    const longLine = `${'x'.repeat(MAX_GREP_LINE_LENGTH)}TAIL`;
    expect(grepSource(longLine, 'TAIL').matchCount).toBe(0);

    const visiblePrefix = `HEAD${'x'.repeat(MAX_GREP_LINE_LENGTH)}`;
    const r = grepSource(visiblePrefix, 'HEAD');
    expect(r.matchCount).toBe(1);
    expect(r.output).toContain(visiblePrefix);
  });

  it('does not mutate the caller pattern argument', () => {
    const pattern = '@DATA(';
    grepSource(SOURCE, pattern);
    expect(pattern).toBe('@DATA('); // strings are immutable, but assert intent explicitly
  });

  it('truncates past maxMatches and reports the true total', () => {
    const many = Array.from({ length: 10 }, (_, i) => `line ${i} match`).join('\n');
    const r = grepSource(many, 'match', { maxMatches: 3, contextLines: 0 });
    expect(r.matchCount).toBe(10);
    expect(r.output).toContain('... showing first 3 of 10 matches. Narrow your pattern.');
  });

  it('annotates matches with the owning class=>method label', () => {
    const src = [
      'CLASS lcl_dao IMPLEMENTATION.', // 1
      '  METHOD setup.', //               2
      '  ENDMETHOD.', //                  3
      '', //                              4..10 padding
      '',
      '',
      '',
      '',
      '',
      '',
      '  METHOD read.', //               11
      '    SELECT * FROM mara.', //      12
      '  ENDMETHOD.', //                 13
      '  METHOD read_text.', //          14
      '    SELECT SINGLE maktx.', //     15
      '  ENDMETHOD.', //                 16
    ].join('\n');
    const r = grepSource(src, 'SELECT', { methods: CLASS_METHODS });
    expect(r.matchCount).toBe(2);
    expect(r.output).toContain('[lcl_dao=>read]');
    expect(r.output).toContain('[lcl_dao=>read_text]');
  });

  it('switches the method label across different containing classes', () => {
    const methods: MethodRange[] = [
      { name: 'test_a', containingClass: 'ltcl_one', startLine: 1, endLine: 2 },
      { name: 'test_b', containingClass: 'ltcl_two', startLine: 3, endLine: 4 },
    ];
    const src = 'MATCH one\nfiller\nMATCH two\nfiller';
    const r = grepSource(src, 'MATCH', { methods, contextLines: 0 });
    expect(r.output).toContain('[ltcl_one=>test_a]');
    expect(r.output).toContain('[ltcl_two=>test_b]');
  });

  it('falls back to a bare method name when no containingClass is present', () => {
    const methods: MethodRange[] = [{ name: 'do_it', startLine: 1, endLine: 1 }];
    const r = grepSource('CALL do_it.', 'do_it', { methods, contextLines: 0 });
    expect(r.output).toContain('[do_it]');
  });

  it('does not attribute between-method context lines to the preceding method', () => {
    const src = [
      'CLASS lcl IMPLEMENTATION.', // 1 (no method)
      '  METHOD a.', //              2
      '    do_match.', //           3 (match)
      '  ENDMETHOD.', //            4
      '  CONSTANTS c TYPE i.', //   5 (between methods — belongs to no method body)
      '  METHOD b.', //             6
      '  ENDMETHOD.', //            7
    ].join('\n');
    const methods: MethodRange[] = [
      { name: 'a', containingClass: 'lcl', startLine: 2, endLine: 4 },
      { name: 'b', containingClass: 'lcl', startLine: 6, endLine: 7 },
    ];
    // match on line 3; ±2 context reaches line 5 (CONSTANTS), which is outside method a.
    const r = grepSource(src, 'do_match', { methods, contextLines: 2 });
    expect(r.output).toContain('[lcl=>a]');
    const lines = r.output.split('\n');
    const constIdx = lines.findIndex((l) => l.includes('CONSTANTS'));
    expect(constIdx).toBeGreaterThan(-1);
    // the trailing context line must be detached from the method block by a separator,
    // not rendered directly under [lcl=>a] (which would mis-attribute it to method a)
    expect(lines[constIdx - 1]).toBe('--');
  });
});
