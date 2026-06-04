import { describe, expect, it } from 'vitest';
import {
  isPreStatefulRelease,
  parseReleaseNumber,
  STATEFUL_SESSION_MIN_RELEASE,
  shouldWarnPreStatefulRelease,
} from '../../../src/adt/release.js';

describe('parseReleaseNumber', () => {
  it('parses dotless 3-digit SAP_BASIS codes', () => {
    expect(parseReleaseNumber('700')).toBe(700);
    expect(parseReleaseNumber('740')).toBe(740);
    expect(parseReleaseNumber('750')).toBe(750);
    expect(parseReleaseNumber('751')).toBe(751);
    expect(parseReleaseNumber('758')).toBe(758);
  });

  it('parses the 8xx ABAP Platform scheme (816 = ABAP Platform 2025) and orders it above 758', () => {
    // SAP renumbered from 75x (758 = S/4HANA 2023) straight to 8.16 (S/4HANA 2025);
    // 759–815 were consumed by quarterly S/4HANA Cloud Public Edition. Plain numeric
    // comparison keeps the ordering correct — no special-casing needed.
    expect(parseReleaseNumber('816')).toBe(816);
    expect(parseReleaseNumber('816')!).toBeGreaterThan(parseReleaseNumber('758')!);
  });

  it('strips non-digits (dotted / whitespace forms)', () => {
    expect(parseReleaseNumber('7.50')).toBe(750);
    expect(parseReleaseNumber(' 750 ')).toBe(750);
  });

  it('returns undefined for empty/undefined/non-numeric input', () => {
    expect(parseReleaseNumber(undefined)).toBeUndefined();
    expect(parseReleaseNumber('')).toBeUndefined();
    expect(parseReleaseNumber('abc')).toBeUndefined();
  });

  it('places the 7.51 boundary correctly', () => {
    expect(parseReleaseNumber('750')!).toBeLessThan(STATEFUL_SESSION_MIN_RELEASE);
    expect(parseReleaseNumber('751')!).toBeGreaterThanOrEqual(STATEFUL_SESSION_MIN_RELEASE);
  });
});

describe('isPreStatefulRelease', () => {
  it('is true below 7.51', () => {
    expect(isPreStatefulRelease('700')).toBe(true);
    expect(isPreStatefulRelease('750')).toBe(true);
  });

  it('is false at/above 7.51', () => {
    expect(isPreStatefulRelease('751')).toBe(false);
    expect(isPreStatefulRelease('758')).toBe(false);
    // ABAP Platform 2025 (816) is post-stateful — the 423 lock-handle workaround must not apply.
    expect(isPreStatefulRelease('816')).toBe(false);
  });

  it('is false when the release is unknown', () => {
    expect(isPreStatefulRelease(undefined)).toBe(false);
    expect(isPreStatefulRelease('')).toBe(false);
  });
});

describe('shouldWarnPreStatefulRelease', () => {
  it('warns only when writes are enabled AND release < 7.51', () => {
    expect(shouldWarnPreStatefulRelease(true, '750')).toBe(true);
    expect(shouldWarnPreStatefulRelease(true, '700')).toBe(true);
  });

  it('does not warn at/above 7.51', () => {
    expect(shouldWarnPreStatefulRelease(true, '758')).toBe(false);
    expect(shouldWarnPreStatefulRelease(true, '751')).toBe(false);
    // ABAP Platform 2025 (816): writes enabled but post-stateful → no pre-7.51 warning.
    expect(shouldWarnPreStatefulRelease(true, '816')).toBe(false);
  });

  it('does not warn when writes are disabled', () => {
    expect(shouldWarnPreStatefulRelease(false, '750')).toBe(false);
  });

  it('does not warn when the release is unknown (no false alarms)', () => {
    expect(shouldWarnPreStatefulRelease(true, undefined)).toBe(false);
  });
});
