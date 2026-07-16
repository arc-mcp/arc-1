/**
 * Unit tests for the pure readLineRange helper.
 */

import { describe, expect, it } from 'vitest';
import { readLineRange } from '../../../src/context/line-range.js';

const SOURCE = `REPORT zfoo.
DATA lv_count TYPE i.
START-OF-SELECTION.
  SELECT * FROM mara INTO TABLE @DATA(lt_mara).
  LOOP AT lt_mara INTO DATA(ls_mara).
    WRITE ls_mara-matnr.
  ENDLOOP.
  SELECT SINGLE maktx FROM makt INTO @DATA(lv_text).
  WRITE lv_text.`;

describe('readLineRange', () => {
  it('returns the requested lines with a header and 1-based numbering', () => {
    const r = readLineRange(SOURCE, 3, 5);
    expect(r.invalidRange).toBe(false);
    expect(r.output).toContain('Lines 3-5 of 9 total:');
    expect(r.output).toContain('    3: START-OF-SELECTION.');
    expect(r.output).toContain('    4:   SELECT * FROM mara INTO TABLE @DATA(lt_mara).');
    expect(r.output).toContain('    5:   LOOP AT lt_mara INTO DATA(ls_mara).');
    expect(r.output).not.toContain('    2:');
    expect(r.output).not.toContain('    6:');
  });

  it('supports a single-line range', () => {
    const r = readLineRange(SOURCE, 1, 1);
    expect(r.invalidRange).toBe(false);
    expect(r.output).toContain('Lines 1-1 of 9 total:');
    expect(r.output).toContain('    1: REPORT zfoo.');
  });

  it('clamps lineEnd past the end of the source and notes the clamp', () => {
    const r = readLineRange(SOURCE, 8, 100);
    expect(r.invalidRange).toBe(false);
    expect(r.output).toContain('Lines 8-9 of 9 total (lineEnd clamped to 9, the last line):');
    expect(r.output).toContain('    9:   WRITE lv_text.');
  });

  it('normalizes CRLF source', () => {
    const crlf = SOURCE.replace(/\n/g, '\r\n');
    const r = readLineRange(crlf, 1, 2);
    expect(r.invalidRange).toBe(false);
    expect(r.output).toContain('    1: REPORT zfoo.');
    expect(r.output).toContain('    2: DATA lv_count TYPE i.');
  });

  it('rejects lineStart < 1', () => {
    const r = readLineRange(SOURCE, 0, 3);
    expect(r.invalidRange).toBe(true);
    expect(r.output).toMatch(/lineStart must be >= 1/);
  });

  it('rejects lineStart > lineEnd', () => {
    const r = readLineRange(SOURCE, 5, 3);
    expect(r.invalidRange).toBe(true);
    expect(r.output).toMatch(/lineStart \(5\) must be <= lineEnd \(3\)/);
  });

  it('rejects lineStart past the end of the source', () => {
    const r = readLineRange(SOURCE, 50, 60);
    expect(r.invalidRange).toBe(true);
    expect(r.output).toMatch(/lineStart \(50\) is past the end of the source \(9 line\(s\)\)/);
  });

  it('rejects non-integer inputs', () => {
    const r = readLineRange(SOURCE, 1.5, 3);
    expect(r.invalidRange).toBe(true);
    expect(r.output).toMatch(/must be integers/);
  });
});
