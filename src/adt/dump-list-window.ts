/**
 * The 24-hour window of the older ADT dump feed (SAP_BASIS below 7.53).
 *
 * Below 7.53, `/runtime/dumps` is served by `CL_SABP_RABAX_ADT_RES_DUMPS`; 7.53 and later use
 * `CL_RABAX_ADT_RES_DUMPS`. The correction instructions of SAP Notes 2780910, 3253331 and 3781408
 * name these classes per release. The older handler raises the requested `from` to its clock minus
 * 24 hours (`compute_timestamp_from`, read on 7.50 SP02 and SP23); the newer one to its clock minus
 * 2000 days (read on 7.58). The feed itself carries no sign of the cut: its `self` link holds the
 * request or the newest dump, and `atom:updated` is the server's clock. So the list gets a note from
 * the detected release, and an unknown release gets none.
 */

import { normalizeFeedTimestamp, sapStampToDate } from './diagnostics.js';
import { parseReleaseNumber } from './release.js';

/** The first release whose dump feed is served by `CL_RABAX_ADT_RES_DUMPS`. */
export const FULL_DUMP_FEED_MIN_RELEASE = 753;

const DAY_MS = 24 * 60 * 60 * 1000;

/** True only for a known release below 7.53; an unknown release never gets the note. */
export function hasDayLimitedDumpFeed(abapRelease?: string): boolean {
  const release = parseReleaseNumber(abapRelease);
  return release !== undefined && release < FULL_DUMP_FEED_MIN_RELEASE;
}

/** SAP's clock from the feed's own `atom:updated`, which precedes the first entry. */
export function feedUpdatedAt(xml: string): Date | undefined {
  const head = xml.split(/<(?:[\w-]+:)?entry[\s>]/, 1)[0] ?? '';
  const value = head.match(/<(?:[\w-]+:)?updated>\s*([^<\s]+)\s*<\//)?.[1];
  const date = value ? new Date(value) : undefined;
  return date && !Number.isNaN(date.getTime()) ? date : undefined;
}

export interface DumpListWindowInput {
  abapRelease?: string;
  /** The request's bounds as given; `listDumps` has already validated them. */
  from?: string;
  to?: string;
  /** `feedUpdatedAt` of the first page; ARC-1's clock stands in when SAP sent none. */
  feedClock?: Date;
  empty: boolean;
}

/** The note for a list the older feed may have cut, or undefined when nothing was cut. */
export function dayLimitedDumpListNote(input: DumpListWindowInput): string | undefined {
  if (!hasDayLimitedDumpFeed(input.abapRelease)) return undefined;
  const start = new Date((input.feedClock ?? new Date()).getTime() - DAY_MS);
  const from = boundAsDate(input.from, 'from');
  if (from && from.getTime() >= start.getTime()) return undefined;

  const release = parseReleaseNumber(input.abapRelease) as number;
  const since = start.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const clock = input.feedClock ? '' : ', approximately';
  const parts = [
    `Hint: On SAP_BASIS ${Math.floor(release / 100)}.${String(release % 100).padStart(2, '0')} the ADT dump feed only ` +
      `lists the last 24 hours (since ${since}${clock}); older dumps are missing here even when from asks for them. ` +
      'Open them in ST22.',
  ];
  const to = boundAsDate(input.to, 'to');
  if (to && to.getTime() < start.getTime())
    parts.push('The requested range ends before that, so none of it is listed.');
  if (input.empty) parts.push('An empty list can also mean the user lacks ST22 display authorization.');
  return parts.join(' ');
}

function boundAsDate(value: string | undefined, field: string): Date | undefined {
  const stamp = normalizeFeedTimestamp(value, field);
  return stamp ? sapStampToDate(stamp) : undefined;
}
