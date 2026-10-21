import { XMLValidator } from 'fast-xml-parser';
import type { RevisionInfo, RevisionListResult } from './types.js';
import { parseXml, toRecordArray } from './xml-parser.js';

const TRANSPORT_RELS = new Set([
  'http://www.sap.com/adt/relations/transport/request', // live shape (a4h 758)
  'http://www.sap.com/adt/relations/transports', // legacy — kept for older releases
]);

/** CTS request/task id: 3-char system + K/T/… + 6 alphanumerics, e.g. A4HK906291. */
const CTS_ID_RE = /^[A-Z0-9]{3}[A-Z][A-Z0-9]{6}$/;

/** Fixed local explanation, safe to expose even when SAP diagnostics are hidden. */
export class RevisionHistoryError extends Error {
  constructor() {
    super('Invalid or unexpected revision history response; this is not an empty history.');
  }
}

/** Decode a URI component, returning the raw value rather than throwing on a malformed `%` escape. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * CTS request id of a revision, from its transport link.
 *
 * `adtcore:name` carries the id; `@_title` is the transport DESCRIPTION (only used as a last
 * resort, for releases that put the id there). The href tail is accepted ONLY when it looks
 * like a CTS id — ADT also emits hrefs ending in `reference?obj_name=…`, and returning
 * `"reference"` for every revision would silently break attribution everywhere.
 * Evidence: docs/plans/2026-08-03-transport-diff.md §1.
 */
function revisionTransportId(links: Record<string, unknown>[]): string {
  for (const link of links) {
    if (!TRANSPORT_RELS.has(String(link['@_rel'] ?? ''))) continue;
    const name = String(link['@_name'] ?? '').trim();
    if (name) return name;
    const tail = safeDecode(
      String(link['@_href'] ?? '')
        .split('/')
        .pop()
        ?.split('?')[0] ?? '',
    )
      .trim()
      .toUpperCase();
    if (CTS_ID_RE.test(tail)) return tail;
    // `@_title`/`@_version` are last resorts for older releases that put the id there; both
    // go through the shape guard, so a description can never be mistaken for a transport.
    for (const attr of ['@_title', '@_version'] as const) {
      const value = String(link[attr] ?? '')
        .trim()
        .toUpperCase();
      if (CTS_ID_RE.test(value)) return value;
    }
  }
  return '';
}

/** Parse source revision history feed from /source/main/versions */
export function parseRevisionFeed(xml: string): RevisionListResult {
  if (!xml.trim()) throw new RevisionHistoryError();

  try {
    if (XMLValidator.validate(xml) !== true) throw new Error('Invalid revision history XML.');
    const parsed = parseXml(xml);
    if (!Object.hasOwn(parsed, 'feed')) throw new Error('Expected a revision Atom feed.');
    if (parsed.feed !== '' && (!parsed.feed || typeof parsed.feed !== 'object' || Array.isArray(parsed.feed)))
      throw new Error('Unexpected revision feed content.');
    const feed = (parsed.feed ?? {}) as Record<string, unknown>;
    const title = String(feed.title ?? '');
    const match = title.match(/^Version List of (\S+) \(([A-Z]+)\)/);
    const object = {
      name: String(match?.[1] ?? ''),
      type: String(match?.[2] ?? ''),
    };

    const revisions: RevisionInfo[] = [];
    const rawEntries = feed.entry === undefined ? [] : Array.isArray(feed.entry) ? feed.entry : [feed.entry];
    if (rawEntries.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry)))
      throw new Error('Unexpected revision entry.');
    const entries = toRecordArray(feed.entry);
    for (const entry of entries) {
      const authorNode = toRecordArray(entry.author)[0] ?? {};
      const contentNode = toRecordArray(entry.content)[0] ?? {};
      if (!contentNode['@_src']) throw new Error('Revision entry is missing its content reference.');
      const links = toRecordArray(entry.link);
      const transport = revisionTransportId(links);
      const versionTitle = String(entry.title ?? '');

      revisions.push({
        id: String(entry.id ?? ''),
        author: String(authorNode.name ?? ''),
        timestamp: String(entry.updated ?? ''),
        ...(versionTitle ? { versionTitle } : {}),
        ...(transport ? { transport } : {}),
        uri: String(contentNode['@_src'] ?? ''),
      });
    }
    const next = toRecordArray(feed.link).find((link) => link['@_rel'] === 'next');
    return { object, revisions, ...(next ? { historyComplete: false } : {}) };
  } catch {
    throw new RevisionHistoryError();
  }
}
