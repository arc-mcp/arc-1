/**
 * Dump detail where SAP has no ADT dump-detail resource (SAP_BASIS 7.50).
 *
 * On 7.50 the ADT router for dumps (CL_SABP_RABAX_ADT_RES_APP) attaches only the feed at
 * `/runtime/dumps`; a feed entry's id points at SAP GUI integration
 * (`/sap/bc/adt/vit/runtime/dumps/{id}`), so `/runtime/dump/{id}` answers 404. Each entry still
 * carries an HTML summary with the chapters ST22 opens with — header, what happened, error
 * analysis, termination point, source extract and active calls — so a 404 on the detail is
 * answered from the dump's feed entry. That feed only reaches back 24 hours on 7.50: its handler
 * raises `from` to now minus 24 hours.
 */

import { getCurrentContext } from '../server/context.js';
import { DataResponseBudget } from './data-result-context.js';
import {
  buildFeedQueryString,
  decodeHtmlEntities,
  decodeUriComponentSafe,
  extractDumpId,
  extractEntrySummaryHtml,
  extractGatewayCallStackFromHtml,
  extractGatewaySourceFromHtml,
  extractHtmlSection,
  getDump,
  parseDumpCategories,
  sanitizeHtmlCellValue,
  sapStampToDate,
  stripHtmlTags,
  toSapStamp,
} from './diagnostics.js';
import { AdtApiError, AdtResponseLimitError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import type { DumpChapter, DumpDetail } from './types.js';
import { findDeepNodes, parseXml, toRecordArray } from './xml-parser.js';

/** Chapter anchors of SAP's summary, in its order. The titles are SAP's, in the logon language. */
const SUMMARY_CHAPTERS = ['HEADER', 'WHATHAPPENED', 'ERROR', 'TERMINATION', 'SOURCE', 'STACK'];

const FEED_PAGE_SIZE = 50;
const MAX_FEED_PAGES = 4;
const FEED_RESPONSE_LIMIT_BYTES = 4 * 1024 * 1024;
/** The id carries SAP system time while the feed bounds are UTC; 14 hours either way covers every zone. */
const ZONE_SPREAD_MS = 14 * 3_600_000;

const FEED_SUMMARY_NOTE =
  'SAP has no ADT dump-detail resource on this system (SAP_BASIS 7.50); this is the summary from its dump feed. ' +
  'Variable values, system fields and the other ST22 chapters are only in ST22.';

const NOT_IN_FEED_HINT =
  'Hint: The dump feed does not list this dump either. On SAP_BASIS 7.50, which has no ADT dump-detail resource, ' +
  'ADT shows dumps only through that feed and only for the last 24 hours; open older dumps in ST22. ' +
  'On other releases the dump may have been deleted; list dumps again for a current id.';

/**
 * Read a dump's detail. Where SAP answers the detail resource with 404, the detail is rebuilt
 * from the dump's feed entry; the 404 stands, with a hint, when the feed does not list the dump.
 */
export async function getDumpWithFeedFallback(
  http: AdtHttpClient,
  safety: SafetyConfig,
  dumpId: string,
): Promise<DumpDetail> {
  try {
    return await getDump(http, safety, dumpId);
  } catch (err) {
    if (!(err instanceof AdtApiError) || err.statusCode !== 404) throw err;
    const wanted = normalizeDumpId(dumpId);
    if (!/^\d{14}\S/.test(wanted)) throw err;
    const detail = await findDumpInFeed(http, safety, dumpId, wanted);
    if (detail) return detail;
    err.extraHint = err.extraHint ? `${err.extraHint}\n${NOT_IN_FEED_HINT}` : NOT_IN_FEED_HINT;
    throw err;
  }
}

/** Feed ids are percent-encoded and padded, ST22 shows spaces: compare the fields, not the padding. */
function normalizeDumpId(id: string): string {
  return decodeUriComponentSafe(String(id ?? '').trim())
    .trim()
    .replace(/\s+/g, ' ');
}

async function findDumpInFeed(
  http: AdtHttpClient,
  safety: SafetyConfig,
  dumpId: string,
  wanted: string,
): Promise<DumpDetail | undefined> {
  checkOperation(safety, OperationType.Read, 'ListDumps');
  const stamp = sapStampToDate(wanted.slice(0, 14)).getTime();
  if (Number.isNaN(stamp)) return undefined;

  // The id is date, time and host, then user, client and number. The user narrows the feed
  // whenever it stands apart; a host that fills its 32 characters runs into the user.
  const fields = wanted.split(' ');
  const user = fields.length === 4 ? fields[1] : undefined;
  const from = toSapStamp(new Date(stamp - ZONE_SPREAD_MS));
  let to = toSapStamp(new Date(stamp + ZONE_SPREAD_MS));
  const request = {
    signal: getCurrentContext()?.signal,
    responseBudget: new DataResponseBudget(FEED_RESPONSE_LIMIT_BYTES, 'dumps'),
  };

  for (let page = 0; page < MAX_FEED_PAGES; page++) {
    const query = buildFeedQueryString({ user, from, to, maxResults: FEED_PAGE_SIZE }, FEED_PAGE_SIZE, 'user');
    let body: string;
    try {
      const resp = await http.get(
        `/sap/bc/adt/runtime/dumps${query}`,
        { Accept: 'application/atom+xml;type=feed' },
        request,
      );
      body = resp.body;
    } catch (err) {
      // The lookup is bounded; a dump beyond the bound counts as not listed.
      if (err instanceof AdtResponseLimitError) return undefined;
      throw err;
    }

    const entries = findDeepNodes(parseXml(body), 'entry');
    const match = entries.find((entry) => normalizeDumpId(extractDumpId(entry)) === wanted);
    if (match) return parseDumpFeedEntry(match, dumpId);
    if (entries.length < FEED_PAGE_SIZE) return undefined;

    // Newest first: continue from the oldest entry seen. The bound is inclusive, so it repeats once.
    const oldest = Date.parse(String(entries.at(-1)?.published ?? entries.at(-1)?.updated ?? ''));
    if (Number.isNaN(oldest) || toSapStamp(new Date(oldest)) === to) return undefined;
    to = toSapStamp(new Date(oldest));
  }
  return undefined;
}

/** Build a dump detail from a feed entry's HTML summary (the SAP_BASIS 7.50 layout). */
export function parseDumpFeedEntry(entry: Record<string, unknown>, dumpId: string): DumpDetail {
  const html = extractEntrySummaryHtml(entry);
  const { error, program } = parseDumpCategories(toRecordArray(entry.category));
  const chapters: DumpChapter[] = [];
  const sections: Record<string, string> = {};
  const lines: string[] = [];
  let exception = '';

  for (const name of SUMMARY_CHAPTERS) {
    const chapterHtml = extractHtmlSection(html, name);
    const heading = chapterHtml.match(/^<h4[^>]*>([\s\S]*?)<\/h4>/i);
    if (!heading) continue;
    const body = chapterHtml.slice(heading[0].length);

    let content: string;
    if (name === 'HEADER') {
      const rows = summaryHeaderRows(body);
      exception =
        rows.find((row) => /exception/i.test(row.label))?.value ??
        rows.find((row) => /^(?:\/\w+\/)?\w*CX_\w+$/i.test(row.value))?.value ??
        '';
      content = rows.map((row) => `${row.label}: ${row.value}`).join('\n');
    } else if (name === 'SOURCE') {
      content = extractGatewaySourceFromHtml(body)
        .lines.map((line) => `${line.isError ? '>>>>>' : '     '} ${String(line.number).padStart(5)} ${line.content}`)
        .join('\n');
    } else if (name === 'STACK') {
      const calls = extractGatewayCallStackFromHtml(body);
      content = calls.length
        ? ['No. | Event | Program | Include | Line']
            .concat(
              calls.map((call) => `${call.number} | ${call.event} | ${call.program} | ${call.name} | ${call.line}`),
            )
            .join('\n')
        : '';
    } else {
      content = summaryText(body);
    }
    if (!content) continue;

    const title = sanitizeHtmlCellValue(heading[1] ?? '') || name;
    chapters.push({
      name,
      title,
      category: '',
      line: lines.length + 1,
      chapterOrder: chapters.length + 1,
      categoryOrder: 0,
    });
    sections[name] = content;
    lines.push(title, '', ...content.split('\n'), '');
  }

  return {
    id: dumpId,
    error,
    exception,
    program,
    user: String(toRecordArray(entry.author)[0]?.name ?? ''),
    timestamp: String(entry.published ?? entry.updated ?? ''),
    chapters,
    formattedText: lines.join('\n').trimEnd(),
    sections,
    terminationUri: summaryTerminationUri(html),
    origin: 'feed-summary',
    note: FEED_SUMMARY_NOTE,
  };
}

function summaryHeaderRows(html: string): Array<{ label: string; value: string }> {
  const rows = html.matchAll(/<tr[^>]*>\s*<td[^>]*>\s*<b[^>]*>([\s\S]*?)<\/b>\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi);
  return Array.from(rows, (row) => ({
    label: sanitizeHtmlCellValue(row[1] ?? ''),
    value: sanitizeHtmlCellValue(row[2] ?? ''),
  })).filter((row) => row.label && row.value);
}

/** SAP escapes < and > in these chapters and turns line breaks into <br>. */
function summaryText(html: string): string {
  return decodeHtmlEntities(stripHtmlTags(html.replace(/<br\s*\/?>/gi, '\n')))
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The "where terminated" link above the first chapter: an adt:// URI into the terminated include. */
function summaryTerminationUri(html: string): string | undefined {
  const firstChapter = html.search(/<h4[\s>]/i);
  const links = firstChapter >= 0 ? html.slice(0, firstChapter) : html;
  for (const match of links.matchAll(/href="adt:\/\/[^"/]*(\/sap\/bc\/adt\/[^"]*)"/gi)) {
    const uri = decodeHtmlEntities(match[1] ?? '');
    if (!uri.includes('/vit/')) return uri;
  }
  return undefined;
}
