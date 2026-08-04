import { describe, expect, it } from 'vitest';
import { unifiedDiff } from '../../../src/adt/source-diff.js';

describe('unifiedDiff', () => {
  it('reports identical for byte-equal sources', () => {
    const r = unifiedDiff('a\nb\nc\n', 'a\nb\nc\n', 'old', 'new');
    expect(r.identical).toBe(true);
    expect(r.diff).toBe('');
    expect(r.added).toBe(0);
    expect(r.removed).toBe(0);
  });

  it('treats CRLF vs LF as identical (line-ending normalization)', () => {
    const r = unifiedDiff('a\r\nb\r\n', 'a\nb\n', 'old', 'new');
    expect(r.identical).toBe(true);
    expect(r.diff).toBe('');
  });

  it('counts added and removed lines on a change', () => {
    const r = unifiedDiff('one\ntwo\nthree\n', 'one\nTWO\nthree\nfour\n', 'old', 'new');
    expect(r.identical).toBe(false);
    expect(r.diff).toContain('@@');
    expect(r.removed).toBe(1); // -two
    expect(r.added).toBe(2); // +TWO, +four
    expect(r.diff).toContain('-two');
    expect(r.diff).toContain('+TWO');
    expect(r.diff).toContain('+four');
  });

  it('handles pure addition', () => {
    const r = unifiedDiff('a\n', 'a\nb\n', 'old', 'new');
    expect(r.identical).toBe(false);
    expect(r.added).toBe(1);
    expect(r.removed).toBe(0);
  });

  it('handles pure deletion', () => {
    const r = unifiedDiff('a\nb\n', 'a\n', 'old', 'new');
    expect(r.identical).toBe(false);
    expect(r.added).toBe(0);
    expect(r.removed).toBe(1);
  });

  it('puts the labels in the patch header (so from/to are visible)', () => {
    const r = unifiedDiff('a\n', 'b\n', 'ZCL_X (active)', 'ZCL_X (inactive)');
    expect(r.diff).toContain('ZCL_X (active)');
    expect(r.diff).toContain('ZCL_X (inactive)');
  });
});

describe('unifiedDiff — ignoreCosmetics (review diffs)', () => {
  it('is off by default, so SAPRead action="diff" stays byte-exact like SAP', () => {
    expect(unifiedDiff('a  \n', 'a\n', 'old', 'new').identical).toBe(false);
  });

  it('hides a trailing-whitespace-only change', () => {
    const r = unifiedDiff('WRITE x.  \nWRITE y.\n', 'WRITE x.\nWRITE y.\n', 'old', 'new', 3, true);
    expect(r.identical).toBe(true);
    expect(r.diff).toBe('');
  });

  it('hides a missing trailing newline', () => {
    expect(unifiedDiff('WRITE x.', 'WRITE x.\n', 'old', 'new', 3, true).identical).toBe(true);
  });

  it('still reports a real change when cosmetics are ignored', () => {
    const r = unifiedDiff('WRITE x.  \n', 'WRITE z.\n', 'old', 'new', 3, true);
    expect(r.identical).toBe(false);
    expect(r.added).toBe(1);
    expect(r.removed).toBe(1);
  });
});

describe('unifiedDiff — counting', () => {
  it('counts deleted lines that themselves start with -- (ABAP/CDS comment marker)', () => {
    const before = '-- Interface view for X\n-- second comment\ndefine view entity Z as select from t { key a }\n';
    const after = 'define view entity Z as select from t { key a }\n';
    const r = unifiedDiff(before, after, 'old', 'new');
    expect(r.removed).toBe(2);
    expect(r.added).toBe(0);
  });

  it('counts added lines that themselves start with ++', () => {
    const r = unifiedDiff('a\n', 'a\n++weird\n', 'old', 'new');
    expect(r.added).toBe(1);
  });

  it('flags a whitespace-only change instead of calling it identical', () => {
    const r = unifiedDiff('WRITE x.  \n', 'WRITE x.\n', 'o', 'n', 3, true);
    expect(r.identical).toBe(true);
    expect(r.cosmeticOnly).toBe(true);
  });

  it('does not flag cosmeticOnly when the sources are truly equal', () => {
    expect(unifiedDiff('SAME\n', 'SAME\n', 'o', 'n', 3, true).cosmeticOnly).toBeUndefined();
  });
});
