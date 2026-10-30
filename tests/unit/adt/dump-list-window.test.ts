import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dayLimitedDumpListNote, feedUpdatedAt, hasDayLimitedDumpFeed } from '../../../src/adt/dump-list-window.js';

const feed750 = readFileSync(new URL('../../fixtures/xml/dumps-feed-nw750.xml', import.meta.url), 'utf8');
const CLOCK = new Date('2026-10-28T08:30:00Z');

afterEach(() => {
  vi.useRealTimers();
});

describe('hasDayLimitedDumpFeed', () => {
  it('applies to known releases below 7.53 only', () => {
    for (const release of ['731', '740', '750', '751', '752', '7.50'])
      expect(hasDayLimitedDumpFeed(release)).toBe(true);
    for (const release of ['753', '757', '758', '816']) expect(hasDayLimitedDumpFeed(release)).toBe(false);
  });

  it('never applies to an unknown release', () => {
    for (const release of [undefined, '', 'unknown']) expect(hasDayLimitedDumpFeed(release)).toBe(false);
  });
});

describe('feedUpdatedAt', () => {
  it("reads the feed's own atom:updated, not an entry's", () => {
    expect(feedUpdatedAt(feed750)?.toISOString()).toBe('2026-10-24T08:19:08.000Z');
    const entryOnly =
      '<atom:feed xmlns:atom="http://www.w3.org/2005/Atom"><atom:entry><atom:updated>2026-10-24T08:06:47Z</atom:updated></atom:entry></atom:feed>';
    expect(feedUpdatedAt(entryOnly)).toBeUndefined();
  });

  it('accepts an unprefixed feed and rejects an unreadable clock', () => {
    expect(feedUpdatedAt('<feed><updated>2026-10-28T08:30:00Z</updated></feed>')?.toISOString()).toBe(
      '2026-10-28T08:30:00.000Z',
    );
    expect(feedUpdatedAt('<feed><updated>not a time</updated></feed>')).toBeUndefined();
    expect(feedUpdatedAt('<feed></feed>')).toBeUndefined();
  });
});

describe('dayLimitedDumpListNote', () => {
  const base = { abapRelease: '750', feedClock: CLOCK, empty: false };

  it('notes a request without from, with the bound from SAP clock', () => {
    const note = dayLimitedDumpListNote(base);
    expect(note).toContain('SAP_BASIS 7.50');
    expect(note).toContain('since 2026-10-27T08:30:00Z)');
    expect(note).toContain('ST22');
    expect(note).not.toContain('approximately');
    expect(note).not.toContain('authorization');
  });

  it('notes a from before the window in every accepted format', () => {
    for (const from of ['2026-10-01T00:00:00Z', '20261001000000', '2026-10-01', '2026-10-27T09:00:00+02:00']) {
      expect(dayLimitedDumpListNote({ ...base, from })).toContain('since 2026-10-27T08:30:00Z');
    }
  });

  it('adds nothing when the requested range starts inside the window', () => {
    expect(dayLimitedDumpListNote({ ...base, from: '2026-10-27T08:30:00Z' })).toBeUndefined();
    expect(dayLimitedDumpListNote({ ...base, from: '20261028000000', empty: true })).toBeUndefined();
  });

  it('adds nothing on 7.53 and later or when the release is unknown', () => {
    expect(dayLimitedDumpListNote({ ...base, abapRelease: '758', empty: true })).toBeUndefined();
    expect(dayLimitedDumpListNote({ ...base, abapRelease: undefined, empty: true })).toBeUndefined();
  });

  it('says when the whole range lies before the window and when the list is empty', () => {
    const note = dayLimitedDumpListNote({ ...base, from: '2026-10-01', to: '2026-10-02', empty: true });
    expect(note).toContain('The requested range ends before that');
    expect(note).toContain('ST22 display authorization');
  });

  it("falls back to ARC-1's clock and says so", () => {
    vi.useFakeTimers();
    vi.setSystemTime(CLOCK);
    const note = dayLimitedDumpListNote({ abapRelease: '752', empty: false });
    expect(note).toContain('SAP_BASIS 7.52');
    expect(note).toContain('since 2026-10-27T08:30:00Z, approximately)');
  });
});
