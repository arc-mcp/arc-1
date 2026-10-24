import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { getDumpWithFeedFallback, parseDumpFeedEntry } from '../../../src/adt/dump-feed-detail.js';
import { AdtApiError, AdtResponseLimitError } from '../../../src/adt/errors.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { findDeepNodes, parseXml } from '../../../src/adt/xml-parser.js';

const FIXTURES_DIR = join(__dirname, '../../fixtures/xml');
// NW 7.50 feed: no self link to /runtime/dump/{id}, ids under /vit/ (SAP GUI), HTML summary per entry.
const FEED_750 = readFileSync(join(FIXTURES_DIR, 'dumps-feed-nw750.xml'), 'utf-8');
const DUMP_ID =
  '20261024092105vhcalnplci_NPL_00%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20DEVELOPER%20%20%20001%20%20%20%20%20%20%2012';
const EMPTY_FEED = '<atom:feed xmlns:atom="http://www.w3.org/2005/Atom"></atom:feed>';

const notFound = (path: string) => new AdtApiError('Not Found', 404, path, '<html>not found</html>');

/** Detail resource missing (7.50); the feed answers with `feeds` in order, repeating the last one. */
function http750(...feeds: Array<string | Error>): AdtHttpClient {
  const queue = [...feeds];
  return {
    get: vi.fn().mockImplementation((path: string) => {
      if (path.startsWith('/sap/bc/adt/runtime/dump/')) return Promise.reject(notFound(path));
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve({ statusCode: 200, headers: {}, body: next ?? EMPTY_FEED });
    }),
  } as unknown as AdtHttpClient;
}

const feedCalls = (http: AdtHttpClient) =>
  (http.get as ReturnType<typeof vi.fn>).mock.calls
    .map((call) => String(call[0]))
    .filter((path) => path.startsWith('/sap/bc/adt/runtime/dumps'));

// Newest first: [0] a dump during program generation, [1] a runtime error in a report.
const ENTRIES = findDeepNodes(parseXml(FEED_750), 'entry');

describe('parseDumpFeedEntry', () => {
  const detail = parseDumpFeedEntry(ENTRIES[1]!, DUMP_ID);

  it('rebuilds the summary chapters in SAP order with their own titles', () => {
    expect(detail.chapters.map((chapter) => [chapter.name, chapter.title])).toEqual([
      ['HEADER', 'Header Information'],
      ['WHATHAPPENED', 'What happened?'],
      ['ERROR', 'Error analysis'],
      ['TERMINATION', 'Information on where terminated'],
      ['SOURCE', 'Source Code Extract'],
      ['STACK', 'Active Calls/Events'],
    ]);
    expect(detail.origin).toBe('feed-summary');
    expect(detail.note).toContain('ST22');
  });

  it('takes the header fields from the entry and the summary', () => {
    expect(detail).toMatchObject({
      id: DUMP_ID,
      error: 'COMPUTE_INT_ZERODIVIDE',
      exception: 'CX_SY_ZERODIVIDE',
      program: 'ZARC1_E2E_DUMP',
      user: 'DEVELOPER',
      timestamp: '2026-10-24T07:21:05Z',
      terminationUri: '/sap/bc/adt/programs/programs/zarc1_e2e_dump/source/main#start=8',
    });
    expect(detail.sections.HEADER).toContain('Short Text: Division by zero.');
    expect(detail.sections.HEADER).toContain('Client: 001');
  });

  it('keeps line breaks and decodes the escaping of the text chapters', () => {
    expect(detail.sections.WHATHAPPENED).toBe(
      'Error in the ABAP application program.\n\nThe current ABAP program "ZARC1_E2E_DUMP" had to be terminated because it found a\nstatement that could not be executed.',
    );
    expect(detail.sections.ERROR).toContain('division by 0 <zero> was attempted.');
    expect(detail.sections.TERMINATION).toMatch(
      /termination point is in line 8 of {2}program or\ninclude "ZARC1_E2E_DUMP"\.$/,
    );
  });

  it('numbers the source extract and marks the termination line', () => {
    const lines = detail.sections.SOURCE!.split('\n');
    expect(lines[0]).toBe('          1 REPORT zarc1_e2e_dump.');
    expect(lines).toContain('          6 IF lv_zero < 1.');
    expect(lines).toContain('          7   " <intentional> & documented');
    expect(lines).toContain('>>>>>     8   lv_result = 1 / lv_zero.');
    expect(lines.filter((line) => line.startsWith('>>>>>'))).toHaveLength(1);
  });

  it('renders the active calls as a table', () => {
    expect(detail.sections.STACK).toBe(
      'No. | Event | Program | Include | Line\n1 | START-OF-SELECTION | ZARC1_E2E_DUMP | ZARC1_E2E_DUMP | 8',
    );
  });

  it('builds formatted text whose chapter lines point at the chapter titles', () => {
    const lines = detail.formattedText.split('\n');
    for (const chapter of detail.chapters) {
      expect(lines[chapter.line - 1]).toBe(chapter.title);
    }
  });

  it('leaves out an empty call list and a termination point that only SAP GUI can open', () => {
    const generation = parseDumpFeedEntry(ENTRIES[0]!, 'X');
    expect(generation.chapters.map((chapter) => chapter.name)).toEqual([
      'HEADER',
      'WHATHAPPENED',
      'ERROR',
      'TERMINATION',
      'SOURCE',
    ]);
    expect(generation.exception).toBe('');
    expect(generation.terminationUri).toBeUndefined();
    expect(generation.sections.TERMINATION).toContain('started as a background job.\n\nJob name....... ???');
    expect(generation.sections.SOURCE).toContain('>>>>>    12       value(RV_RESULT) type ABAP_BOOL .');
  });
});

describe('getDumpWithFeedFallback', () => {
  it('returns the detail resource unchanged where SAP serves it', async () => {
    const http = {
      get: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '<dump:dump error="E"/>' }),
    } as unknown as AdtHttpClient;
    const detail = await getDumpWithFeedFallback(http, unrestrictedSafetyConfig(), DUMP_ID);
    expect(detail.error).toBe('E');
    expect(detail.origin).toBeUndefined();
    expect(feedCalls(http)).toEqual([]);
  });

  it('answers a 404 from the dump feed entry, narrowed to the user and the id’s time', async () => {
    const http = http750(FEED_750);
    const detail = await getDumpWithFeedFallback(http, unrestrictedSafetyConfig(), DUMP_ID);

    expect(detail.origin).toBe('feed-summary');
    expect(detail.error).toBe('COMPUTE_INT_ZERODIVIDE');
    const [path] = feedCalls(http);
    const params = new URL(path!, 'https://sap.example').searchParams;
    expect(params.get('$top')).toBe('50');
    expect(params.get('$query')).toBe('and(equals(user,DEVELOPER))');
    // System time 09:21:05, any zone: 14 hours either way in UTC.
    expect(params.get('from')).toBe('20261023192105');
    expect(params.get('to')).toBe('20261024232105');
  });

  it.each([
    ['ST22 spacing', '20261024092105vhcalnplci_NPL_00               DEVELOPER   001       12'],
    ['collapsed spacing', '20261024092105vhcalnplci_NPL_00 DEVELOPER 001 12'],
    ['surrounding whitespace', `  ${DUMP_ID}  `],
  ])('matches the id regardless of %s', async (_label, id) => {
    const detail = await getDumpWithFeedFallback(http750(FEED_750), unrestrictedSafetyConfig(), id);
    expect(detail.program).toBe('ZARC1_E2E_DUMP');
    expect(detail.id).toBe(id);
  });

  it('pages down from the oldest entry when the first page is full', async () => {
    const filler = Array.from(
      { length: 50 },
      (_, i) =>
        `<atom:entry><atom:id>/sap/bc/adt/vit/runtime/dumps/20261024100000host%20DEVELOPER%20001%20${i}</atom:id><atom:published>2026-10-24T08:${String(59 - i).padStart(2, '0')}:00Z</atom:published></atom:entry>`,
    ).join('');
    const http = http750(`<atom:feed xmlns:atom="http://www.w3.org/2005/Atom">${filler}</atom:feed>`, FEED_750);

    const detail = await getDumpWithFeedFallback(http, unrestrictedSafetyConfig(), DUMP_ID);

    expect(detail.program).toBe('ZARC1_E2E_DUMP');
    const calls = feedCalls(http).map((path) => new URL(path, 'https://sap.example').searchParams);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.get('to')).toBe('20261024081000');
    expect(calls[1]!.get('from')).toBe(calls[0]!.get('from'));
  });

  it('keeps the 404 and explains the 24-hour feed when the feed does not list the dump', async () => {
    const http = http750(EMPTY_FEED);
    const err = await getDumpWithFeedFallback(http, unrestrictedSafetyConfig(), DUMP_ID).catch((e) => e);
    expect(err).toBeInstanceOf(AdtApiError);
    expect(err.statusCode).toBe(404);
    expect(err.extraHint).toContain('last 24 hours');
    expect(err.extraHint).toContain('ST22');
  });

  it('treats a lookup beyond its response bound as not listed', async () => {
    const http = http750(new AdtResponseLimitError(4 * 1024 * 1024, 5 * 1024 * 1024, 'dumps'));
    const err = await getDumpWithFeedFallback(http, unrestrictedSafetyConfig(), DUMP_ID).catch((e) => e);
    expect(err).toBeInstanceOf(AdtApiError);
    expect(err.statusCode).toBe(404);
    expect(err.extraHint).toContain('last 24 hours');
  });

  it('does not search the feed for ids that are no dump key', async () => {
    const http = http750(FEED_750);
    const err = await getDumpWithFeedFallback(http, unrestrictedSafetyConfig(), 'MISSING').catch((e) => e);
    expect(err.statusCode).toBe(404);
    expect(err.extraHint).toBeUndefined();
    expect(feedCalls(http)).toEqual([]);
  });

  it('passes other errors through without searching the feed', async () => {
    const forbidden = new AdtApiError('Forbidden', 403, '/sap/bc/adt/runtime/dump/x', '');
    const http = { get: vi.fn().mockRejectedValue(forbidden) } as unknown as AdtHttpClient;
    await expect(getDumpWithFeedFallback(http, unrestrictedSafetyConfig(), DUMP_ID)).rejects.toBe(forbidden);
    expect(feedCalls(http)).toEqual([]);
  });
});
