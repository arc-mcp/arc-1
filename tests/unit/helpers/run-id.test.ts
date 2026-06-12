import { describe, expect, it } from 'vitest';
import { deriveRunId, RUN_ID } from '../../helpers/run-id.js';

describe('deriveRunId', () => {
  it('uses TEST_RUN_ID when set — uppercased, letters-only, capped at 4 chars', () => {
    expect(deriveRunId('AB')).toBe('AB');
    expect(deriveRunId('abcd')).toBe('ABCD');
    expect(deriveRunId('a-b_c.d')).toBe('ABCD'); // non-letters stripped, then capped
    expect(deriveRunId('ab12')).toBe('AB'); // digits stripped
    expect(deriveRunId('toolongvalue')).toBe('TOOL'); // capped at 4
  });

  it('falls back to a 2-letter token when env is empty/blank/digits-only', () => {
    for (const raw of [undefined, '', '   ', '!!!', '12']) {
      expect(deriveRunId(raw)).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('produces more than one distinct token across many fallback draws', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(deriveRunId(undefined));
    // 200 draws from 676 values — astronomically unlikely to be all identical.
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('RUN_ID', () => {
  it('is a short uppercase letters-only token', () => {
    expect(RUN_ID).toMatch(/^[A-Z]{2,4}$/);
  });
});
