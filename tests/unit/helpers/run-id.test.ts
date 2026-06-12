import { describe, expect, it } from 'vitest';
import { deriveRunId, RUN_ID, RUN_ID_ALPHA } from '../../helpers/run-id.js';

describe('deriveRunId', () => {
  it('uses TEST_RUN_ID when set — uppercased, alnum-only, capped at 4 chars', () => {
    expect(deriveRunId('AB')).toBe('AB');
    expect(deriveRunId('ab12')).toBe('AB12');
    expect(deriveRunId('a-b_c.d')).toBe('ABCD'); // non-alnum stripped, then capped
    expect(deriveRunId('toolongvalue')).toBe('TOOL'); // capped at 4
  });

  it('falls back to a 2-char alphanumeric token when env is empty/blank/non-alnum', () => {
    for (const raw of [undefined, '', '   ', '!!!']) {
      expect(deriveRunId(raw)).toMatch(/^[A-Z0-9]{2}$/);
    }
  });

  it('produces more than one distinct token across many fallback draws', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(deriveRunId(undefined));
    // 200 draws from 1296 values — astronomically unlikely to be all identical.
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('RUN_ID / RUN_ID_ALPHA', () => {
  it('RUN_ID is a short uppercase alphanumeric token', () => {
    expect(RUN_ID).toMatch(/^[A-Z0-9]{2,4}$/);
  });

  it('RUN_ID_ALPHA is letters-only and the same length as RUN_ID', () => {
    expect(RUN_ID_ALPHA).toMatch(/^[A-Z]{2,4}$/);
    expect(RUN_ID_ALPHA.length).toBe(RUN_ID.length);
  });
});
