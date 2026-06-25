/**
 * Runtime diagnostics for SAP ADT.
 *
 * - Short dumps (ST22): list and read ABAP runtime errors
 * - ABAP traces: list/analyze recorded profiler traces, and arm/list/cancel trace requests
 *
 * Most operations are read-only (GET); arming and cancelling a trace request mutate server state and
 * go through OperationType.Update. Follows the same pure-function pattern as devtools.ts.
 */

import { createHash } from 'node:crypto';
import { AdtApiError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import type {
  DumpChapter,
  DumpDetail,
  DumpEntry,
  GatewayCallStackEntry,
  GatewayErrorDetail,
  GatewayErrorEntry,
  GatewayExceptionInfo,
  GatewayServiceInfo,
  GatewaySourceLine,
  ObjectStateResult,
  ObjectStateSection,
  ObjectStateSourceVersion,
  SystemMessageEntry,
  TraceDbAccess,
  TracedObjectType,
  TracedProcessType,
  TraceEntry,
  TraceHitlistEntry,
  TraceRequest,
  TraceRequestCreateOptions,
  TraceStatement,
} from './types.js';
import { escapeXmlAttr, findDeepNodes, parseXml } from './xml-parser.js';

// ─── Short Dumps ────────────────────────────────────────────────────

const DEFAULT_DUMP_MAX_RESULTS = 50;
const DEFAULT_SYSTEM_MESSAGE_MAX_RESULTS = 50;
const DEFAULT_GATEWAY_ERROR_MAX_RESULTS = 50;
const MAX_RESULTS_CAP = 200;

export interface ListDumpsOptions {
  /** Filter by SAP user (uppercase) */
  user?: string;
  /** Maximum number of dumps to return (default 50) */
  maxResults?: number;
}

interface FeedQueryOptions {
  user?: string;
  maxResults?: number;
  from?: string;
  to?: string;
}

export interface ListSystemMessagesOptions extends FeedQueryOptions {}

export interface ListGatewayErrorsOptions extends FeedQueryOptions {}

export interface ObjectStateSectionInput {
  section: string;
  uri: string;
  /** Treat missing endpoints as unavailable instead of failing the whole diagnostic */
  optional?: boolean;
}

export interface GetObjectStateOptions {
  type: string;
  name: string;
  sections: ObjectStateSectionInput[];
}

/**
 * Compare active and inactive source versions for one ADT object.
 *
 * ARC-1 uses this as a compact diagnostic for activation mysteries where
 * SAPRead "looks right" but the activator still sees stale or divergent
 * source includes. The result intentionally returns hashes and byte counts,
 * not full source, so the diagnostic stays cheap and safe to paste into chat.
 */
export async function getObjectState(
  http: AdtHttpClient,
  safety: SafetyConfig,
  options: GetObjectStateOptions,
): Promise<ObjectStateResult> {
  checkOperation(safety, OperationType.Read, 'GetObjectState');

  const sections = await Promise.all(
    options.sections.map(async (input): Promise<ObjectStateSection> => {
      const [active, inactive] = await Promise.all([
        readObjectStateVersion(http, input.uri, 'active', input.optional),
        readObjectStateVersion(http, input.uri, 'inactive', input.optional),
      ]);

      return {
        section: input.section,
        uri: input.uri,
        active,
        inactive,
        divergent: sourceVersionsDiverge(active, inactive),
      };
    }),
  );

  return {
    type: options.type,
    name: options.name,
    checkedAt: new Date().toISOString(),
    hasInactiveDivergence: sections.some((section) => section.divergent),
    sections,
  };
}

async function readObjectStateVersion(
  http: AdtHttpClient,
  uri: string,
  version: 'active' | 'inactive',
  optional = false,
): Promise<ObjectStateSourceVersion> {
  const versionedUri = appendQueryParam(uri, 'version', version);
  try {
    const resp = await http.get(versionedUri, {
      Accept: 'text/plain, */*;q=0.8',
    });
    return {
      available: true,
      statusCode: resp.statusCode,
      etag: resp.headers.etag,
      byteLength: Buffer.byteLength(resp.body, 'utf8'),
      sha256: createHash('sha256').update(resp.body, 'utf8').digest('hex'),
    };
  } catch (err) {
    if (optional && err instanceof AdtApiError && err.statusCode === 404) {
      return {
        available: false,
        statusCode: 404,
      };
    }
    throw err;
  }
}

function sourceVersionsDiverge(active: ObjectStateSourceVersion, inactive: ObjectStateSourceVersion): boolean {
  if (active.available !== inactive.available) return true;
  if (!active.available || !inactive.available) return false;
  return active.sha256 !== inactive.sha256;
}

function appendQueryParam(path: string, key: string, value: string): string {
  const [baseAndQuery, fragment] = path.split('#', 2);
  const [base, query = ''] = (baseAndQuery ?? path).split('?', 2);
  const params = new URLSearchParams(query);
  params.set(key, value);
  const queryString = params.toString();
  return `${base}${queryString ? `?${queryString}` : ''}${fragment ? `#${fragment}` : ''}`;
}

/**
 * List ABAP short dumps (ST22 equivalent).
 *
 * Endpoint: GET /sap/bc/adt/runtime/dumps
 * Returns an Atom feed with dump entries.
 */
export async function listDumps(
  http: AdtHttpClient,
  safety: SafetyConfig,
  options?: ListDumpsOptions,
): Promise<DumpEntry[]> {
  checkOperation(safety, OperationType.Read, 'ListDumps');

  const queryString = buildFeedQueryString(options, DEFAULT_DUMP_MAX_RESULTS, 'user');
  const resp = await http.get(`/sap/bc/adt/runtime/dumps${queryString}`, {
    Accept: 'application/atom+xml;type=feed',
  });

  return parseDumpList(resp.body);
}

/**
 * Get full dump detail including formatted text.
 *
 * Makes two requests:
 * 1. XML metadata (chapters, links, attributes)
 * 2. Formatted plain text (full dump content)
 *
 * The dump ID from `listDumps` already arrives URL-encoded (the SAP feed
 * encodes spaces in the server/user/client/dump-number suffix as `%20`).
 * When a caller passes a raw ID (e.g. copied from ST22 with literal
 * whitespace), we encode it ourselves so the path stays valid. The
 * detail payload keeps the caller's original ID for round-tripping.
 */
export async function getDump(http: AdtHttpClient, safety: SafetyConfig, dumpId: string): Promise<DumpDetail> {
  checkOperation(safety, OperationType.Read, 'GetDump');

  const safeId = normalizeAdtPathSegment(dumpId);

  // Fetch XML metadata and formatted text in parallel
  const [xmlResp, textResp] = await Promise.all([
    http.get(`/sap/bc/adt/runtime/dump/${safeId}`, {
      Accept: 'application/vnd.sap.adt.runtime.dump.v1+xml',
    }),
    http.get(`/sap/bc/adt/runtime/dump/${safeId}/formatted`, {
      Accept: 'text/plain',
    }),
  ]);

  return parseDumpDetail(xmlResp.body, textResp.body, dumpId);
}

/**
 * Idempotently URL-encode a dump ID. If the value already contains a `%`
 * sequence we treat it as already-encoded (the listing endpoint emits
 * `%20` for spaces); otherwise we encode it once. Trims surrounding
 * whitespace which would otherwise be encoded as `%20` and break lookup.
 */
function normalizeAdtPathSegment(value: string): string {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  return trimmed.includes('%') ? trimmed : encodeURIComponent(trimmed);
}

// ─── System Messages + Gateway Errors ──────────────────────────────

/**
 * List SM02 system messages.
 *
 * Endpoint: GET /sap/bc/adt/runtime/systemmessages
 * Returns an Atom feed with system message entries.
 */
export async function listSystemMessages(
  http: AdtHttpClient,
  safety: SafetyConfig,
  options?: ListSystemMessagesOptions,
): Promise<SystemMessageEntry[]> {
  checkOperation(safety, OperationType.Read, 'ListSystemMessages');

  const queryString = buildFeedQueryString(options, DEFAULT_SYSTEM_MESSAGE_MAX_RESULTS, 'user');
  const resp = await http.get(`/sap/bc/adt/runtime/systemmessages${queryString}`, {
    Accept: 'application/atom+xml;type=feed',
  });

  return parseSystemMessages(resp.body);
}

/**
 * List SAP Gateway error log entries (/IWFND/ERROR_LOG).
 *
 * Endpoint: GET /sap/bc/adt/gw/errorlog
 * Returns an Atom feed with gateway error entries.
 */
export async function listGatewayErrors(
  http: AdtHttpClient,
  safety: SafetyConfig,
  options?: ListGatewayErrorsOptions,
): Promise<GatewayErrorEntry[]> {
  checkOperation(safety, OperationType.Read, 'ListGatewayErrors');

  const queryString = buildFeedQueryString(options, DEFAULT_GATEWAY_ERROR_MAX_RESULTS, 'username');
  const resp = await http.get(`/sap/bc/adt/gw/errorlog${queryString}`, {
    Accept: 'application/atom+xml;type=feed',
  });

  return parseGatewayErrors(resp.body);
}

/**
 * Read one gateway error detail payload.
 *
 * The ADT /sap/bc/adt/gw/errorlog/{type}/{id} endpoint returns an HTML
 * fragment (not XML), so the parser extracts tabular values from known
 * section anchors (#HEADER, #SERVICE, #CONTEXT, #SOURCE, #STACK).
 *
 * Supports either:
 * - full/relative ADT detail URL from a feed entry,
 * - id of the form "{errorType}/{transactionId}" (as emitted by the feed), or
 * - transaction id + errorType parameters.
 */
export async function getGatewayErrorDetail(
  http: AdtHttpClient,
  safety: SafetyConfig,
  params: { detailUrl?: string; id?: string; errorType?: string },
): Promise<GatewayErrorDetail> {
  checkOperation(safety, OperationType.Read, 'GetGatewayErrorDetail');

  const path = resolveGatewayErrorDetailPath(params);
  const resp = await http.get(path, {
    Accept: 'text/html, application/xhtml+xml, application/xml;q=0.5',
  });

  return parseGatewayErrorDetail(resp.body);
}

// ─── ABAP Traces ────────────────────────────────────────────────────

/**
 * List ABAP profiler trace files.
 *
 * Endpoint: GET /sap/bc/adt/runtime/traces/abaptraces
 * Returns an Atom feed with trace entries.
 */
export async function listTraces(http: AdtHttpClient, safety: SafetyConfig): Promise<TraceEntry[]> {
  checkOperation(safety, OperationType.Read, 'ListTraces');

  const resp = await http.get('/sap/bc/adt/runtime/traces/abaptraces', {
    Accept: 'application/atom+xml;type=feed',
  });

  return parseTraceList(resp.body);
}

/**
 * Get trace hitlist (execution hot spots).
 *
 * Returns the most expensive procedures sorted by gross time.
 */
export async function getTraceHitlist(
  http: AdtHttpClient,
  safety: SafetyConfig,
  traceId: string,
): Promise<TraceHitlistEntry[]> {
  checkOperation(safety, OperationType.Read, 'GetTraceHitlist');

  const safeTraceId = normalizeAdtPathSegment(traceId);
  const resp = await http.get(`/sap/bc/adt/runtime/traces/abaptraces/${safeTraceId}/hitlist`, {
    Accept: 'application/xml',
  });

  return parseTraceHitlist(resp.body);
}

/**
 * Get trace call tree (statements).
 *
 * Returns the hierarchical call tree with timing data.
 */
export async function getTraceStatements(
  http: AdtHttpClient,
  safety: SafetyConfig,
  traceId: string,
): Promise<TraceStatement[]> {
  checkOperation(safety, OperationType.Read, 'GetTraceStatements');

  const safeTraceId = normalizeAdtPathSegment(traceId);
  const resp = await http.get(`/sap/bc/adt/runtime/traces/abaptraces/${safeTraceId}/statements`, {
    Accept: 'application/xml',
  });

  return parseTraceStatements(resp.body);
}

/**
 * Get trace database accesses.
 *
 * Returns table access statistics (which tables, how many times, buffered vs not).
 */
export async function getTraceDbAccesses(
  http: AdtHttpClient,
  safety: SafetyConfig,
  traceId: string,
): Promise<TraceDbAccess[]> {
  checkOperation(safety, OperationType.Read, 'GetTraceDbAccesses');

  const safeTraceId = normalizeAdtPathSegment(traceId);
  const resp = await http.get(`/sap/bc/adt/runtime/traces/abaptraces/${safeTraceId}/dbAccesses`, {
    Accept: 'application/xml',
  });

  return parseTraceDbAccesses(resp.body);
}

// ─── ABAP Trace Requests (arm a profiler trace, then read it back) ───

const TRACE_BASE = '/sap/bc/adt/runtime/traces/abaptraces';

const TRACE_PROCESS_TYPE_URIS: Record<TracedProcessType, string> = {
  any: `${TRACE_BASE}/processtypes/any`,
  http: `${TRACE_BASE}/processtypes/http`,
  dialog: `${TRACE_BASE}/processtypes/dialog`,
  batch: `${TRACE_BASE}/processtypes/batch`,
  rfc: `${TRACE_BASE}/processtypes/rfc`,
};

const TRACE_OBJECT_TYPE_URIS: Record<TracedObjectType, string> = {
  any: `${TRACE_BASE}/objecttypes/any`,
  url: `${TRACE_BASE}/objecttypes/url`,
  transaction: `${TRACE_BASE}/objecttypes/transaction`,
  report: `${TRACE_BASE}/objecttypes/report`,
  functionModule: `${TRACE_BASE}/objecttypes/functionmodule`,
};

/** Object types valid per process type; the first entry is the sensible default. */
const TRACE_PROCESS_OBJECTS: Record<TracedProcessType, TracedObjectType[]> = {
  any: ['any', 'url', 'transaction', 'report', 'functionModule'],
  http: ['url'],
  dialog: ['transaction', 'report'],
  batch: ['report'],
  rfc: ['functionModule'],
};

/**
 * Build the trc:parameters body. Procedural units stay on (hitlist/statements); SQL/aggregate per opts.
 * allDbEvents follows sqlTrace: without it the `dbAccesses` analysis comes back EMPTY (only kernel summary
 * rows) — live-verified — so the whole point of the trace (which tables/joins were hit) is lost.
 */
function buildTraceParametersXml(p: { description: string; aggregate: boolean; sqlTrace: boolean }): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<trc:parameters xmlns:trc="http://www.sap.com/adt/runtime/traces/abaptraces">
  <trc:allMiscAbapStatements value="false"/>
  <trc:allProceduralUnits value="true"/>
  <trc:allInternalTableEvents value="false"/>
  <trc:allDynproEvents value="false"/>
  <trc:description value="${escapeXmlAttr(p.description)}"/>
  <trc:aggregate value="${p.aggregate}"/>
  <trc:explicitOnOff value="false"/>
  <trc:withRfcTracing value="false"/>
  <trc:allSystemKernelEvents value="false"/>
  <trc:sqlTrace value="${p.sqlTrace}"/>
  <trc:allDbEvents value="${p.sqlTrace}"/>
  <trc:maxSizeForTraceFile value="100"/>
  <trc:maxTimeForTracing value="600"/>
</trc:parameters>`;
}

/**
 * Arm a profiler trace request. The next execution matching {traceUser, processType, objectType} is
 * recorded; read it back later via listTraces + the analysis sub-resources (dbAccesses needs sqlTrace).
 * Two ADT POSTs: parameters (capture flags → parametersId in Location) then requests (when/who).
 */
export async function createTraceRequest(
  http: AdtHttpClient,
  safety: SafetyConfig,
  connectedUser: string,
  client: string,
  opts: TraceRequestCreateOptions = {},
): Promise<TraceRequest> {
  checkOperation(safety, OperationType.Update, 'CreateTraceRequest');

  const processType: TracedProcessType = opts.processType ?? 'http';
  const validObjects = TRACE_PROCESS_OBJECTS[processType];
  const objectType: TracedObjectType = opts.objectType ?? validObjects[0]!;
  if (!validObjects.includes(objectType)) {
    throw new AdtApiError(
      `Invalid objectType "${objectType}" for processType "${processType}". Valid: ${validObjects.join(', ')}.`,
      400,
      `${TRACE_BASE}/requests`,
    );
  }

  const traceUser = (opts.traceUser ?? connectedUser).toUpperCase();
  const sqlTrace = opts.sqlTrace !== false; // default true
  const aggregate = opts.aggregate !== false; // default true
  const maxExecutions = Math.max(1, Math.floor(opts.maxExecutions ?? 1));
  const expiresHours = opts.expiresHours ?? 24;
  if (!Number.isFinite(expiresHours) || expiresHours <= 0) {
    throw new AdtApiError('expiresHours must be a positive number of hours.', 400, `${TRACE_BASE}/requests`);
  }
  const expires = new Date(Date.now() + expiresHours * 3_600_000).toISOString().replace(/\.\d+Z$/, 'Z');
  const description = opts.description ?? `arc-1 ${processType}/${objectType} trace`;

  // 1) capture parameters → parametersId (Location header)
  const paramsResp = await http.post(
    `${TRACE_BASE}/parameters`,
    buildTraceParametersXml({ description, aggregate, sqlTrace }),
    'application/xml',
  );
  const parametersId = paramsResp.headers.location;
  if (!parametersId) {
    throw new AdtApiError(
      'Trace parameters POST returned no Location header (parametersId).',
      paramsResp.statusCode,
      `${TRACE_BASE}/parameters`,
      paramsResp.body,
    );
  }

  // 2) create the request (when/who)
  const qs = new URLSearchParams({
    server: '*',
    description,
    traceUser,
    traceClient: client,
    processType: TRACE_PROCESS_TYPE_URIS[processType],
    objectType: TRACE_OBJECT_TYPE_URIS[objectType],
    expires,
    maximalExecutions: String(maxExecutions),
    parametersId,
  }).toString();
  const resp = await http.post(`${TRACE_BASE}/requests?${qs}`, '', 'application/xml');
  const created = parseTraceRequestFeed(resp.body)[0];
  if (!created?.id) {
    throw new AdtApiError(
      'Trace request POST returned no usable request entry (missing id).',
      resp.statusCode,
      `${TRACE_BASE}/requests`,
      resp.body,
    );
  }
  return created;
}

/** List armed trace requests for a user (read-only). */
export async function listTraceRequests(
  http: AdtHttpClient,
  safety: SafetyConfig,
  user: string,
): Promise<TraceRequest[]> {
  checkOperation(safety, OperationType.Read, 'ListTraceRequests');
  const resp = await http.get(`${TRACE_BASE}/requests?user=${encodeURIComponent(user.toUpperCase())}`, {
    Accept: 'application/atom+xml;type=feed',
  });
  return parseTraceRequestFeed(resp.body);
}

/** Cancel (delete) an armed trace request by id (the full ADT path from a request entry). */
export async function deleteTraceRequest(http: AdtHttpClient, safety: SafetyConfig, id: string): Promise<void> {
  checkOperation(safety, OperationType.Update, 'DeleteTraceRequest');
  await http.delete(traceRequestPath(id));
}

// Normalize full-path, absolute-URL, or bare trace-request ids without creating an arbitrary DELETE primitive.
function traceRequestPath(id: string): string {
  const prefix = `${TRACE_BASE}/requests/`;
  const trimmed = String(id ?? '').trim();
  if (!trimmed) throw new AdtApiError('Refusing to cancel an empty trace-request id.', 400, prefix);
  if (trimmed.includes('\\'))
    throw new AdtApiError(`Refusing to cancel "${id}": malformed trace-request id.`, 400, trimmed);
  const isAbsoluteUrl = /^https?:\/\//i.test(trimmed);
  let raw = '';
  try {
    if (isAbsoluteUrl) new URL(trimmed);
    raw = isAbsoluteUrl
      ? (trimmed.match(/^https?:\/\/[^/?#]*(\/[^?#]*)?/i)?.[1] ?? '/')
      : trimmed.startsWith('/')
        ? trimmed
        : `${prefix}${trimmed}`;
  } catch {
    throw new AdtApiError(`Refusing to cancel "${id}": malformed trace-request id.`, 400, trimmed);
  }

  const decoded = decodeTraceRequestPath(raw, id);
  const tail = decoded.startsWith(prefix) ? decoded.slice(prefix.length) : '';
  if (!tail || tail !== tail.trim() || /[\\/?#\s]/.test(tail) || tail === '.' || tail === '..') {
    throw new AdtApiError(
      `Refusing to cancel "${id}": not an abaptraces trace-request id (expected ${prefix}<id>).`,
      400,
      decoded,
    );
  }
  return raw;
}

function decodeTraceRequestPath(path: string, originalId: string): string {
  let decoded = path;
  for (let i = 0; i < 5; i++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) return decoded;
      decoded = next;
    } catch {
      throw new AdtApiError(`Refusing to cancel "${originalId}": malformed trace-request id.`, 400, decoded);
    }
  }
  throw new AdtApiError(`Refusing to cancel "${originalId}": over-encoded trace-request id.`, 400, decoded);
}

/** Pick the value of a node that repeats per role (admin/trace); prefer `trace`, else the first. */
function pickTraceRole(node: unknown, valueKey: '#text' | 'name'): string | undefined {
  const arr = toRecordArray(node);
  const match = arr.find((n) => n['@_role'] === 'trace') ?? arr[0];
  const value = match?.[valueKey];
  return value != null ? String(value) : undefined;
}

/**
 * Parse the abaptraces/requests atom feed into TraceRequest[] (used for both list + create responses).
 * Request id = the `<atom:id>` element (full ADT path with URL-encoded commas) → passed verbatim to DELETE.
 */
export function parseTraceRequestFeed(xml: string): TraceRequest[] {
  if (!xml || xml.trim().length === 0) return [];
  const parsed = parseXml(xml);
  const entries = findDeepNodes(parsed, 'entry');
  return entries.map((entry) => {
    const ext = (entry.extendedData ?? {}) as Record<string, unknown>;
    const executions = (ext.executions ?? {}) as Record<string, unknown>;
    const processType = (ext.processType ?? {}) as Record<string, unknown>;
    const object = (ext.object ?? {}) as Record<string, unknown>;
    const content = (entry.content ?? {}) as Record<string, unknown>;

    const req: TraceRequest = {
      id: String(entry.id ?? content['@_src'] ?? ''),
      title: String(entry.title ?? ext.description ?? ''),
    };
    const user = pickTraceRole(entry.author, 'name');
    if (user) req.user = user;
    const client = pickTraceRole(ext.client, '#text');
    if (client) req.client = client;
    if (ext.expires != null) req.expires = String(ext.expires);
    if (processType['@_processTypeId'] != null) req.processType = String(processType['@_processTypeId']);
    if (object['@_objectTypeId'] != null) req.objectType = String(object['@_objectTypeId']);
    const maximal = Number(executions['@_maximal']);
    if (Number.isFinite(maximal)) req.maxExecutions = maximal;
    const completed = Number(executions['@_completed']);
    if (Number.isFinite(completed)) req.completedExecutions = completed;
    if (ext.host != null) req.host = String(ext.host);
    return req;
  });
}

// ─── Parsers ────────────────────────────────────────────────────────

/**
 * Parse dump listing Atom feed.
 *
 * Robust against localized category labels and missing self links.
 */
export function parseDumpList(xml: string): DumpEntry[] {
  const parsed = parseXml(xml);
  const entryNodes = findDeepNodes(parsed, 'entry');

  return entryNodes
    .map((entry) => {
      const author = toRecordArray(entry.author)[0];
      const user = String(author?.name ?? '');

      const categories = toRecordArray(entry.category);
      const { error, program } = parseDumpCategories(categories);

      const timestamp = String(entry.published ?? entry.updated ?? '');
      const id = extractDumpId(entry);

      return { id, timestamp, user, error, program };
    })
    .filter((entry) => entry.id.length > 0);
}

/**
 * Parse dump detail XML metadata + formatted text.
 *
 * The XML response has attributes on the root dump:dump element:
 * - error, author, exception, terminatedProgram, datetime
 *
 * And dump:chapter elements with name, title, category attributes.
 */
export function parseDumpDetail(xml: string, formattedText: string, dumpId: string): DumpDetail {
  const parsed = parseXml(xml);
  const dumps = findDeepNodes(parsed, 'dump');
  const root = dumps[0] ?? {};

  const error = String(root['@_error'] ?? '');
  const exception = String(root['@_exception'] ?? '');
  const program = String(root['@_terminatedProgram'] ?? '');
  const user = String(root['@_author'] ?? '');
  const timestamp = String(root['@_datetime'] ?? '');

  // Find termination link by relation attribute (scope to dump root, not full document)
  const links = findDeepNodes(root, 'link');
  const termLink = links.find(
    (l) => String(l['@_relation'] ?? '') === 'http://www.sap.com/adt/relations/runtime/dump/termination',
  );
  const terminationUri = termLink ? String(termLink['@_uri'] ?? '') || undefined : undefined;

  // Extract chapters (scope to dump root, not full document)
  const chapterNodes = findDeepNodes(root, 'chapter');
  const chapters: DumpChapter[] = chapterNodes.map((ch) => ({
    name: String(ch['@_name'] ?? ''),
    title: String(ch['@_title'] ?? ''),
    category: String(ch['@_category'] ?? ''),
    line: safePositiveInt(ch['@_line']),
    chapterOrder: safePositiveInt(ch['@_chapterOrder']),
    categoryOrder: safePositiveInt(ch['@_categoryOrder']),
  }));
  const sections = splitDumpSections(formattedText, chapters);

  return {
    id: dumpId,
    error,
    exception,
    program,
    user,
    timestamp,
    chapters,
    formattedText,
    sections,
    terminationUri,
  };
}

/**
 * Parse system message feed.
 */
export function parseSystemMessages(xml: string): SystemMessageEntry[] {
  const parsed = parseXml(xml);
  const entryNodes = findDeepNodes(parsed, 'entry');

  return entryNodes
    .map((entry) => {
      const links = toRecordArray(entry.link);
      const selfHref = extractSelfLinkHref(links);
      const categories = toRecordArray(entry.category);
      const severity = String(categories[0]?.['@_term'] ?? '');

      const contentNode = toRecordArray(entry.content)[0];
      const summaryNode = toRecordArray(entry.summary)[0];

      return {
        id: String(entry.id ?? ''),
        title: String(entry.title ?? ''),
        text: String(contentNode?.['#text'] ?? summaryNode?.['#text'] ?? entry.summary ?? ''),
        severity,
        validFrom: String(entry['@_validFrom'] ?? entry.validFrom ?? entry.updated ?? entry.published ?? ''),
        validTo: String(entry['@_validTo'] ?? entry.validTo ?? ''),
        createdBy: String(toRecordArray(entry.author)[0]?.name ?? ''),
        timestamp: String(entry.updated ?? entry.published ?? ''),
        detailUrl: selfHref || undefined,
      };
    })
    .filter((entry) => entry.id.length > 0 || entry.title.length > 0 || entry.text.length > 0);
}

/**
 * Parse gateway error log feed.
 *
 * Real ADT feed entries encode the error class + transaction id in
 * <atom:id>ErrorClass/transactionId</atom:id>, the full label in
 * <atom:title>Type: short text</atom:title>, and the structured payload in
 * the <atom:summary type="html"> HTML blob (same content the detail
 * endpoint returns). No <atom:category> or <atom:link rel="self"> is
 * emitted, so the parser derives the detail URL from the atom:id and
 * extracts header fields from the summary HTML when available.
 */
export function parseGatewayErrors(xml: string): GatewayErrorEntry[] {
  const parsed = parseXml(xml);
  const entryNodes = findDeepNodes(parsed, 'entry');

  return entryNodes
    .map((entry) => {
      const atomId = String(entry.id ?? '');
      const rawTitle = String(entry.title ?? '').trim();
      const summaryHtml = extractEntrySummaryHtml(entry);
      const { errorType: idErrorType, transactionId: idTransactionId } = splitGatewayAtomId(atomId);

      const links = toRecordArray(entry.link);
      const selfHref = extractSelfLinkHref(links);

      // Legacy / forward-compat: some feeds may expose <atom:category term="Frontend Error"/>
      const categoryTerm = String(toRecordArray(entry.category)[0]?.['@_term'] ?? '').trim();

      // Multi-source derivation so one missing field does not lose everything.
      const summaryType = extractHtmlHeaderValue(summaryHtml, 'Type');
      const titleType = rawTitle.includes(':') ? rawTitle.slice(0, rawTitle.indexOf(':')).trim() : '';
      const typeFromId = splitCamelCase(idErrorType);
      const type = summaryType || categoryTerm || titleType || typeFromId;

      const summaryShortText = extractHtmlHeaderValue(summaryHtml, 'Short Text');
      const titleShortText = rawTitle.includes(':') ? rawTitle.slice(rawTitle.indexOf(':') + 1).trim() : rawTitle;
      const shortText = summaryShortText || titleShortText;

      const summaryTransactionId = extractTransactionIdFromHtml(summaryHtml);
      const transactionId = summaryTransactionId || idTransactionId || extractTailId(atomId);

      const detailUrl =
        selfHref ||
        (idErrorType && idTransactionId
          ? `/sap/bc/adt/gw/errorlog/${encodeURIComponent(idErrorType)}/${encodeURIComponent(idTransactionId)}`
          : '');

      return {
        type,
        shortText,
        transactionId,
        dateTime: String(entry.updated ?? entry.published ?? ''),
        username: String(toRecordArray(entry.author)[0]?.name ?? ''),
        detailUrl,
        package:
          getOptionalString(entry, ['@_package', 'package']) ??
          (extractHtmlHeaderValue(summaryHtml, 'Package') || undefined),
        applicationComponent:
          getOptionalString(entry, ['@_applicationComponent', 'applicationComponent']) ??
          (extractHtmlHeaderValue(summaryHtml, 'Application Component') || undefined),
        client:
          getOptionalString(entry, ['@_client', 'client']) ??
          (extractHtmlHeaderValue(summaryHtml, 'Client') || undefined),
        requestKind:
          getOptionalString(entry, ['@_requestKind', 'requestKind']) ??
          (extractHtmlHeaderValue(summaryHtml, 'Request Kind') || undefined),
      };
    })
    .filter((entry) => entry.transactionId.length > 0 || entry.detailUrl.length > 0);
}

/**
 * Parse gateway error detail payload.
 *
 * Accepts either the legacy XML envelope (with <errorEntry>) if the backend
 * ever returns one, or the HTML fragment that the real /sap/bc/adt/gw/errorlog
 * endpoint returns. Missing sections fall back to empty values rather than
 * throwing, so callers can still surface partial data to the LLM.
 */
export function parseGatewayErrorDetail(payload: string): GatewayErrorDetail {
  const trimmed = (payload ?? '').trim();
  const looksLikeXmlEnvelope = trimmed.startsWith('<?xml') || /<errorEntry[\s>]/.test(trimmed);

  if (looksLikeXmlEnvelope) {
    const xmlResult = parseGatewayErrorDetailXml(trimmed);
    if (xmlResult) return xmlResult;
  }

  return parseGatewayErrorDetailHtml(trimmed);
}

function parseGatewayErrorDetailXml(xml: string): GatewayErrorDetail | undefined {
  try {
    const parsed = parseXml(xml);
    const errorNode = findDeepNodes(parsed, 'errorEntry')[0];
    if (!errorNode) return undefined;

    const callStackEntries = parseGatewayCallStack(errorNode);
    const sourceLines = parseGatewaySourceLines(errorNode);
    const exceptions = parseGatewayExceptions(errorNode);

    const serviceInfoNode = toRecordArray(errorNode.serviceInfo)[0];
    const errorContextNode = toRecordArray(errorNode.errorContext)[0];
    const sourceCodeNode = toRecordArray(errorNode.sourceCode)[0];

    const serviceInfo: GatewayServiceInfo = {
      namespace: String(serviceInfoNode?.['@_namespace'] ?? ''),
      serviceName: String(serviceInfoNode?.['@_serviceName'] ?? ''),
      serviceVersion: String(serviceInfoNode?.['@_serviceVersion'] ?? ''),
      groupId: String(serviceInfoNode?.['@_groupId'] ?? ''),
      serviceRepository: String(serviceInfoNode?.['@_serviceRepository'] ?? ''),
      destination: String(serviceInfoNode?.['@_destination'] ?? ''),
    };

    return {
      type: String(errorNode['@_type'] ?? ''),
      shortText: String(errorNode.shortText ?? ''),
      transactionId: String(errorNode.transactionId ?? ''),
      package: String(errorNode.package ?? ''),
      applicationComponent: String(errorNode.applicationComponent ?? ''),
      dateTime: String(errorNode.dateTime ?? ''),
      username: String(errorNode.username ?? ''),
      client: String(errorNode.client ?? ''),
      requestKind: String(errorNode.requestKind ?? ''),
      serviceInfo,
      errorContext: {
        errorInfo: String(errorContextNode?.errorInfo ?? ''),
        resolution: {},
        exceptions,
      },
      sourceCode: {
        lines: sourceLines,
        errorLine: safePositiveInt(sourceCodeNode?.['@_errorLine']),
      },
      callStack: callStackEntries,
    };
  } catch {
    return undefined;
  }
}

function parseGatewayErrorDetailHtml(html: string): GatewayErrorDetail {
  const header = extractHtmlSection(html, 'HEADER');
  const service = extractHtmlSection(html, 'SERVICE');
  const context = extractHtmlSection(html, 'CONTEXT');
  const source = extractHtmlSection(html, 'SOURCE');
  const stack = extractHtmlSection(html, 'STACK');

  const resolution: Record<string, string> = {};
  const sapNote = extractHtmlHeaderValue(context, 'SAP_NOTE');
  if (sapNote) resolution.sapNote = sapNote;
  const sapNoteLink = extractHtmlHeaderValue(context, 'LINK_TO_SAP_NOTE');
  if (sapNoteLink) resolution.linkToSapNote = sapNoteLink;

  return {
    type: extractHtmlHeaderValue(header, 'Type'),
    shortText: extractHtmlHeaderValue(header, 'Short Text'),
    transactionId: extractTransactionIdFromHtml(header),
    package: extractHtmlHeaderValue(header, 'Package'),
    applicationComponent: extractHtmlHeaderValue(header, 'Application Component'),
    dateTime: extractHtmlHeaderValue(header, 'Date/Time'),
    username: extractHtmlHeaderValue(header, 'Username'),
    client: extractHtmlHeaderValue(header, 'Client'),
    requestKind: extractHtmlHeaderValue(header, 'Request Kind'),
    serviceInfo: {
      namespace: extractHtmlHeaderValue(service, 'Service Namespace'),
      serviceName: extractHtmlHeaderValue(service, 'Service Name'),
      serviceVersion: extractHtmlHeaderValue(service, 'Service Version'),
      groupId: extractHtmlHeaderValue(service, 'Group ID'),
      serviceRepository: extractHtmlHeaderValue(service, 'Service Repository'),
      destination: extractHtmlHeaderValue(service, 'Destination'),
    },
    errorContext: {
      errorInfo: extractHtmlHeaderValue(context, 'ERROR_INFO'),
      resolution,
      exceptions: extractGatewayExceptionsFromHtml(context),
    },
    sourceCode: extractGatewaySourceFromHtml(source),
    callStack: extractGatewayCallStackFromHtml(stack),
  };
}

/**
 * Parse trace listing Atom feed.
 *
 * Trace entries may contain extended attributes in a trc: namespace.
 */
export function parseTraceList(xml: string): TraceEntry[] {
  const parsed = parseXml(xml);
  const entryNodes = findDeepNodes(parsed, 'entry');

  return entryNodes
    .map((entry) => {
      const title = String(entry.title ?? '');
      const timestamp = String(entry.updated ?? entry.published ?? '');

      // Extract trace ID from self link href
      const links = Array.isArray(entry.link) ? entry.link : entry.link ? [entry.link] : [];
      const selfLink = (links as Array<Record<string, unknown>>).find((l) => String(l['@_rel'] ?? '') === 'self');
      const href = String(selfLink?.['@_href'] ?? '');
      const traceMatch = href.match(/\/sap\/bc\/adt\/runtime\/traces\/abaptraces\/([^"]*)/);
      const id = traceMatch?.[1] || '';

      // Extended trace data (namespace-prefixed attributes are stripped by removeNSPrefix)
      const state = entry['@_state'] != null ? String(entry['@_state']) : undefined;
      const objectName = entry['@_objectName'] != null ? String(entry['@_objectName']) : undefined;
      const runtimeStr = entry['@_runtime'] != null ? String(entry['@_runtime']) : undefined;

      return { id, title, timestamp, state, objectName, runtime: runtimeStr ? Number(runtimeStr) : undefined };
    })
    .filter((e) => e.id || e.title);
}

/**
 * Parse trace hitlist XML.
 *
 * Hitlist entries contain procedure names and timing data.
 */
export function parseTraceHitlist(xml: string): TraceHitlistEntry[] {
  const parsed = parseXml(xml);
  const nodes = findDeepNodes(parsed, 'hitListEntry');

  return nodes.map((node) => ({
    callingProgram: String(node['@_callingProgram'] ?? ''),
    calledProgram: String(node['@_calledProgram'] ?? ''),
    hitCount: Number(node['@_hitCount'] ?? 0),
    grossTime: Number(node['@_grossTime'] ?? 0),
    netTime: Number(node['@_traceEventNetTime'] ?? node['@_netTime'] ?? 0),
  }));
}

/**
 * Parse trace statements (call tree) XML.
 */
export function parseTraceStatements(xml: string): TraceStatement[] {
  const parsed = parseXml(xml);
  // Try both tag names: traceStatement and statement
  let nodes = findDeepNodes(parsed, 'traceStatement');
  if (nodes.length === 0) {
    nodes = findDeepNodes(parsed, 'statement');
  }

  return nodes
    .filter((node) => node['@_callLevel'] != null)
    .map((node) => ({
      callLevel: Number(node['@_callLevel'] ?? 0),
      hitCount: Number(node['@_hitCount'] ?? 0),
      isProceduralUnit: String(node['@_isProceduralUnit'] ?? '') === 'true',
      grossTime: Number(node['@_grossTime'] ?? 0),
      description: String(node['@_description'] ?? node['@_name'] ?? ''),
    }));
}

/**
 * Parse trace database accesses XML.
 */
export function parseTraceDbAccesses(xml: string): TraceDbAccess[] {
  const parsed = parseXml(xml);
  // Try both tag names: dbAccess and access
  let nodes = findDeepNodes(parsed, 'dbAccess');
  if (nodes.length === 0) {
    nodes = findDeepNodes(parsed, 'access');
  }

  return nodes
    .filter((node) => node['@_tableName'] != null)
    .map((node) => ({
      tableName: String(node['@_tableName'] ?? ''),
      statement: String(node['@_statement'] ?? ''),
      type: String(node['@_type'] ?? ''),
      totalCount: Number(node['@_totalCount'] ?? 0),
      bufferedCount: Number(node['@_bufferedCount'] ?? 0),
      accessTime: Number(node['@_accessTime'] ?? 0),
    }));
}

// ─── OData performance probe (sap-statistics) ───────────────────────

export interface ODataPerfResult {
  url: string;
  statusCode: number;
  wallClockMs: number;
  /** Parsed `sap-statistics` header — variable field set; `gwappdb` (when present) is DB time. */
  statistics: Record<string, number>;
  fesrecMicros?: number;
  responseBytes: number;
  verdict: { bound: 'db' | 'app' | 'framework' | 'auth' | 'unknown'; note: string };
}

/** Parse the `sap-statistics` header (`k=v,k=v,…`) into a numeric map. Tolerates missing/extra fields. */
export function parseSapStatistics(header: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pair of header.split(',')) {
    const idx = pair.indexOf('=');
    if (idx <= 0) continue;
    const key = pair.slice(0, idx).trim();
    const val = Number(pair.slice(idx + 1).trim());
    if (key && Number.isFinite(val)) out[key] = val;
  }
  return out;
}

/** Route to the dominant time component so the LLM picks the right deeper signal. */
export function verdictFromStatistics(m: Record<string, number>): ODataPerfResult['verdict'] {
  const total = m.gwtotal ?? m.total ?? 0;
  if (total <= 0) {
    return {
      bound: 'unknown',
      note: 'No Gateway timing in sap-statistics — ensure the URL is an OData/Gateway service on the SAP host ARC-1 connects to.',
    };
  }
  const db = m.gwappdb ?? 0;
  const candidates: Array<[ODataPerfResult['verdict']['bound'], number, string]> = [
    [
      'db',
      db,
      'DB-bound: the CDS/SQL query dominates. Inspect the generated SQL with SAPDiagnose(action="cds_sql"), measure it with SAPQuery (queryExecutionTime), or arm an ST05 SQL trace.',
    ],
    [
      'app',
      Math.max((m.gwapp ?? 0) - db, 0),
      'ABAP/SADL-bound: application logic dominates (not the DB). Arm an ABAP profiler trace (SAPDiagnose action="traces") and read its hitlist for the hot path.',
    ],
    [
      // gwfw (GW framework) and gwhub (GW hub processing) both measure framework time; older
      // releases (e.g. NW 7.50) report only gwhub, so take whichever is present.
      'framework',
      Math.max(m.gwfw ?? 0, m.gwhub ?? 0),
      'Gateway-framework-bound: likely metadata/first-call (cold-cache) cost. Re-probe to compare warm vs cold.',
    ],
    ['auth', m.icfauth ?? 0, 'Auth-bound: ICF/DCL authorization overhead dominates.'],
  ];
  candidates.sort((a, b) => b[1] - a[1]);
  const [bound, top, note] = candidates[0];
  // Gateway reported a total but no component is > 0 (the release didn't break it down) — don't
  // guess "db". Report the total as undifferentiated Gateway time and point to the deeper traces.
  if (top <= 0) {
    return {
      bound: 'unknown',
      note: `Gateway total ${total}ms, but sap-statistics didn't break it into components on this release (no gwappdb/gwapp/gwfw). Treat it as Gateway processing; arm an ST05 SQL trace or ABAP profiler trace (SAPDiagnose action="traces") for the breakdown.`,
    };
  }
  return { bound, note };
}

/**
 * GET an OData URL with `?sap-statistics=true` + a wall-clock timer → server-side timing split + verdict.
 * Security: `url` must be a host-relative path on the configured SAP system (no absolute URLs / SSRF).
 */
export async function probeODataPerformance(
  http: AdtHttpClient,
  safety: SafetyConfig,
  url: string,
): Promise<ODataPerfResult> {
  checkOperation(safety, OperationType.Query, 'ProbeODataPerformance');
  assertODataPerfUrl(url);
  const withStat = url.includes('?') ? `${url}&sap-statistics=true` : `${url}?sap-statistics=true`;
  const t0 = Date.now();
  const resp = await http.get(withStat);
  const wallClockMs = Date.now() - t0;
  const statistics = parseSapStatistics(resp.headers['sap-statistics'] ?? '');
  const fesrec = Number(resp.headers['sap-perf-fesrec']);
  return {
    url: withStat,
    statusCode: resp.statusCode,
    wallClockMs,
    statistics,
    fesrecMicros: Number.isFinite(fesrec) ? fesrec : undefined,
    responseBytes: Buffer.byteLength(resp.body ?? ''),
    verdict: verdictFromStatistics(statistics),
  };
}

function assertODataPerfUrl(url: string): void {
  const rawPath = url.split(/[?#]/, 1)[0] ?? '';
  let parsed: URL;
  try {
    parsed = new URL(url, 'https://arc1.invalid');
  } catch {
    throw invalidODataPerfUrl();
  }

  if (
    url.length > 4096 ||
    !url.startsWith('/') ||
    url.startsWith('//') ||
    url.includes('://') ||
    url.includes('\\') ||
    url.includes('#') ||
    /(?:^|\/)(?:\.|%2e)(?:\/|$)/i.test(rawPath) ||
    /(?:^|\/)(?:\.|%2e){2}(?:\/|$)/i.test(rawPath) ||
    /%5c/i.test(rawPath) ||
    parsed.origin !== 'https://arc1.invalid' ||
    !isODataPath(parsed.pathname)
  ) {
    throw invalidODataPerfUrl();
  }
}

function isODataPath(pathname: string): boolean {
  return (
    pathname === '/sap/opu/odata' ||
    pathname.startsWith('/sap/opu/odata/') ||
    pathname === '/sap/opu/odata4' ||
    pathname.startsWith('/sap/opu/odata4/')
  );
}

function invalidODataPerfUrl(): Error {
  return new Error(
    'odata_perf url must be a host-relative OData path on the configured SAP system (e.g. "/sap/opu/odata4/.../Entity?$filter=..."); absolute URLs and non-OData SAP paths are not allowed.',
  );
}

// ─── CDS Show-SQL (createstatements) ────────────────────────────────

export interface CdsCreateStatement {
  name?: string;
  type?: string;
  state?: string;
  sql: string;
}
export interface CdsCreateStatements {
  name: string;
  statements: CdsCreateStatement[];
}

function nodeText(value: unknown): string {
  // `statement` is an ARRAY_TAG in the XML parser, so a single <ddl:statement> arrives as [text].
  if (Array.isArray(value)) return value.map(nodeText).join('\n');
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return String((value as Record<string, unknown>)['#text'] ?? '');
  return '';
}

/** Parse the `ddl:createStatements` response → the native SQL each CDS view compiles to. */
export function parseCdsCreateStatements(xml: string, fallbackName = ''): CdsCreateStatements {
  const parsed = parseXml(xml);
  const sourceNodes = findDeepNodes(parsed, 'source');
  const name =
    sourceNodes.length > 0 && sourceNodes[0]['@_name'] != null ? String(sourceNodes[0]['@_name']) : fallbackName;
  const statements = findDeepNodes(parsed, 'createStatement')
    .map((node) => ({
      name: node['@_name'] != null ? String(node['@_name']) : undefined,
      type: node['@_type'] != null ? String(node['@_type']) : undefined,
      state: node['@_state'] != null ? String(node['@_state']) : undefined,
      sql: nodeText(node.statement).trim(),
    }))
    .filter((s) => s.sql.length > 0);
  return { name, statements };
}

/**
 * Return the native SQL `CREATE VIEW` statements a CDS view (DDLS) generates.
 * POST-only + CSRF (auto-managed) + a dedicated Accept type. May 404/405 on releases without the
 * modern CDS DDL stack (e.g. NW 7.50) — let that surface so the caller learns the feature is absent.
 */
export async function getCdsCreateStatements(
  http: AdtHttpClient,
  safety: SafetyConfig,
  name: string,
): Promise<CdsCreateStatements> {
  checkOperation(safety, OperationType.Read, 'GetCdsCreateStatements');
  const resp = await http.post(`/sap/bc/adt/ddic/ddl/createstatements/${encodeURIComponent(name)}`, '', undefined, {
    Accept: 'application/vnd.sap.adt.ddl.createStatements+xml',
  });
  return parseCdsCreateStatements(resp.body, name);
}

// ─── Helpers ────────────────────────────────────────────────────────

function buildFeedQueryString(
  options: FeedQueryOptions | undefined,
  defaultMaxResults: number,
  userAttribute: string,
): string {
  const params: string[] = [];
  const maxResults = clampMaxResults(options?.maxResults, defaultMaxResults);
  params.push(`$top=${maxResults}`);

  const user = String(options?.user ?? '').trim();
  if (user) {
    params.push(`$query=${encodeURIComponent(`and(equals(${userAttribute},${user}))`)}`);
  }

  const from = String(options?.from ?? '').trim();
  if (from) params.push(`from=${encodeURIComponent(from)}`);
  const to = String(options?.to ?? '').trim();
  if (to) params.push(`to=${encodeURIComponent(to)}`);

  return params.length > 0 ? `?${params.join('&')}` : '';
}

function clampMaxResults(maxResults: number | undefined, fallback: number): number {
  if (!Number.isFinite(maxResults)) return fallback;
  return Math.max(1, Math.min(MAX_RESULTS_CAP, Math.trunc(maxResults!)));
}

function toRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object');
  }
  if (value && typeof value === 'object') return [value as Record<string, unknown>];
  return [];
}

function safePositiveInt(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

function normalizeLabel(label: string): string {
  return label.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseDumpCategories(categories: Array<Record<string, unknown>>): { error: string; program: string } {
  const normalized = categories
    .map((category) => ({
      term: String(category['@_term'] ?? ''),
      label: normalizeLabel(String(category['@_label'] ?? '')),
    }))
    .filter((entry) => entry.term.length > 0);

  if (normalized.length === 0) return { error: '', program: '' };

  const errorByLabel = normalized.find(
    (entry) =>
      entry.label.includes('runtime error') || (entry.label.includes('error') && !entry.label.includes('program')),
  )?.term;
  const programByLabel = normalized.find((entry) => entry.label.includes('program'))?.term;

  const fallbackError = normalized[0]?.term ?? '';
  const fallbackProgram = normalized[1]?.term ?? normalized.find((entry) => entry.term !== fallbackError)?.term ?? '';

  return {
    error: errorByLabel ?? fallbackError,
    program: programByLabel ?? fallbackProgram,
  };
}

function extractSelfLinkHref(links: Array<Record<string, unknown>>): string {
  const selfLink = links.find((link) => String(link['@_rel'] ?? '') === 'self');
  return String(selfLink?.['@_href'] ?? links[0]?.['@_href'] ?? '');
}

function extractDumpId(entry: Record<string, unknown>): string {
  const links = toRecordArray(entry.link);
  const selfHref = extractSelfLinkHref(links);
  const fromLink = extractIdFromPath(selfHref, ['/runtime/dump/']);
  if (fromLink) return fromLink;

  const atomId = String(entry.id ?? '');
  const fromAtomId = extractIdFromPath(atomId, ['/runtime/dump/', '/runtime/dumps/']);
  if (fromAtomId) return fromAtomId;

  const serialized = JSON.stringify(entry);
  const fallback = serialized.match(/\/runtime\/dumps?\/([^"\\\s<]+)/)?.[1] ?? '';
  return fallback.trim();
}

function extractIdFromPath(rawPath: string, markers: string[]): string {
  const path = normalizeAdtPath(rawPath, false);
  if (!path) return '';

  for (const marker of markers) {
    const idx = path.indexOf(marker);
    if (idx >= 0) {
      const start = idx + marker.length;
      const tail = path.slice(start);
      const id = tail.split(/[/?#]/)[0] ?? '';
      if (id.trim()) return id.trim();
    }
  }
  return '';
}

function extractTailId(value: string): string {
  const normalized = normalizeAdtPath(value, false);
  if (!normalized) return value;
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? value;
}

function splitDumpSections(formattedText: string, chapters: DumpChapter[]): Record<string, string> {
  if (!formattedText) return {};

  const lines = formattedText.split(/\r?\n/);
  const sortable = chapters
    .filter((chapter) => chapter.line > 0)
    .sort((a, b) => {
      if (a.line !== b.line) return a.line - b.line;
      if (a.chapterOrder !== b.chapterOrder) return a.chapterOrder - b.chapterOrder;
      return a.name.localeCompare(b.name);
    });

  if (sortable.length === 0) return {};

  const sections: Record<string, string> = {};
  for (let i = 0; i < sortable.length; i++) {
    const chapter = sortable[i]!;
    const next = sortable[i + 1];
    const startLine = Math.max(0, chapter.line - 1);
    const endLine = next?.line ? Math.max(startLine, next.line - 1) : lines.length;
    const rawSection = lines.slice(startLine, endLine).join('\n').trim();
    const normalized = shouldNormalizeWrappedLines(chapter) ? joinWrappedLines(rawSection) : rawSection;
    const sectionId = chapter.name || `section_${i + 1}`;
    sections[sectionId] = normalized;
  }

  return sections;
}

function shouldNormalizeWrappedLines(chapter: DumpChapter): boolean {
  const title = normalizeLabel(chapter.title);
  return (
    title.includes('source code') ||
    title.includes('active calls') ||
    title.includes('call stack') ||
    title.includes('kernel')
  );
}

function joinWrappedLines(text: string): string {
  if (!text.includes('\\')) return text;

  const lines = text.split('\n');
  const result: string[] = [];

  for (const line of lines) {
    if (result.length > 0 && result[result.length - 1]!.endsWith('\\')) {
      const prev = result[result.length - 1]!;
      result[result.length - 1] = `${prev.slice(0, -1)}${line.trimStart()}`;
      continue;
    }
    result.push(line);
  }

  return result.join('\n');
}

function getOptionalString(entry: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = entry[key];
    if (value != null && String(value).trim().length > 0) {
      return String(value);
    }
  }
  return undefined;
}

function parseGatewayCallStack(root: Record<string, unknown>): GatewayCallStackEntry[] {
  const callStackNode = toRecordArray(root.callStack)[0];
  const entries = toRecordArray(callStackNode?.entry);

  return entries.map((entry, index) => ({
    number: safePositiveInt(entry['@_number']) || index + 1,
    event: String(entry['@_event'] ?? ''),
    program: String(entry['@_program'] ?? ''),
    name: String(entry['@_name'] ?? ''),
    line: safePositiveInt(entry['@_line']),
  }));
}

function parseGatewaySourceLines(root: Record<string, unknown>): GatewaySourceLine[] {
  const sourceCodeNode = toRecordArray(root.sourceCode)[0];
  const lines = toRecordArray(sourceCodeNode?.line);

  return lines.map((line, index) => ({
    number: safePositiveInt(line['@_number']) || index + 1,
    content: typeof line['#text'] === 'string' ? line['#text'] : String(line ?? ''),
    isError: String(line['@_isError'] ?? '').toLowerCase() === 'true',
  }));
}

function parseGatewayExceptions(root: Record<string, unknown>): GatewayExceptionInfo[] {
  const errorContextNode = toRecordArray(root.errorContext)[0];
  const exceptionsNode = toRecordArray(errorContextNode?.exceptions)[0];
  const exceptions = toRecordArray(exceptionsNode?.exception);

  return exceptions.map((entry) => ({
    type: String(entry['@_type'] ?? ''),
    text: String(entry['#text'] ?? ''),
    raiseLocation: String(entry['@_raiseLocation'] ?? ''),
  }));
}

function resolveGatewayErrorDetailPath(params: { detailUrl?: string; id?: string; errorType?: string }): string {
  const detailUrl = String(params.detailUrl ?? '').trim();
  if (detailUrl) {
    return normalizeAdtPath(detailUrl, true);
  }

  const id = String(params.id ?? '').trim();
  if (!id) {
    throw new Error('Gateway error detail requires either "detailUrl" or "id" with "errorType".');
  }

  if (id.includes('/sap/bc/adt/')) {
    return normalizeAdtPath(id, true);
  }

  // Feed atom:id is emitted as "{errorType}/{transactionId}" — accept that form directly.
  if (id.includes('/') && !params.errorType) {
    const [derivedType, ...rest] = id.split('/');
    const derivedId = rest.join('/');
    if (derivedType && derivedId) {
      return `/sap/bc/adt/gw/errorlog/${encodeURIComponent(decodeUriComponentSafe(derivedType))}/${encodeURIComponent(decodeUriComponentSafe(derivedId))}`;
    }
  }

  const errorType = String(params.errorType ?? '').trim();
  if (!errorType) {
    throw new Error('Gateway error detail by transaction ID requires "errorType".');
  }

  // Feed returns display form "Frontend Error" (with space) in atom:title, but the
  // detail URL path expects the compact identifier form "FrontendError". Strip
  // whitespace to allow callers to pass either shape.
  const normalizedType = errorType.replace(/\s+/g, '');

  return `/sap/bc/adt/gw/errorlog/${encodeURIComponent(normalizedType)}/${encodeURIComponent(decodeUriComponentSafe(id))}`;
}

function normalizeAdtPath(rawPath: string, requireAdtPrefix: boolean): string {
  if (!rawPath) return '';
  const trimmed = rawPath.trim();

  let normalized = trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      normalized = `${url.pathname}${url.search}`;
    } catch {
      normalized = trimmed;
    }
  }

  if (/^adt:\/\//i.test(normalized)) {
    const marker = normalized.indexOf('/sap/bc/adt/');
    if (marker >= 0) {
      normalized = normalized.slice(marker);
    }
  }

  if (!normalized.startsWith('/') && normalized.includes('/sap/bc/adt/')) {
    normalized = normalized.slice(normalized.indexOf('/sap/bc/adt/'));
  }

  if (requireAdtPrefix && !normalized.startsWith('/sap/bc/adt/')) {
    throw new Error(`Unsupported ADT detail URL: ${rawPath}`);
  }

  return normalized;
}

// ─── Gateway HTML helpers ──────────────────────────────────────────
//
// The gateway error log detail endpoint returns an HTML fragment built
// from known section anchors. We extract tabular values with regex rather
// than a full HTML parser to keep the dependency surface small and stay
// resilient to whitespace/attribute variations across releases.

function splitGatewayAtomId(atomId: string): { errorType: string; transactionId: string } {
  const cleaned = decodeHtmlEntities(String(atomId ?? '')).trim();
  if (!cleaned) return { errorType: '', transactionId: '' };

  const marker = '/sap/bc/adt/gw/errorlog/';
  if (cleaned.includes(marker)) {
    const tail = cleaned.slice(cleaned.indexOf(marker) + marker.length);
    const [errorType, ...rest] = tail.split('/');
    return {
      errorType: decodeUriComponentSafe(errorType ?? ''),
      transactionId: decodeUriComponentSafe(rest.join('/') ?? ''),
    };
  }

  const slashIdx = cleaned.indexOf('/');
  if (slashIdx >= 0) {
    return {
      errorType: decodeUriComponentSafe(cleaned.slice(0, slashIdx)),
      transactionId: decodeUriComponentSafe(cleaned.slice(slashIdx + 1)),
    };
  }
  return { errorType: '', transactionId: decodeUriComponentSafe(cleaned) };
}

function splitCamelCase(value: string): string {
  if (!value) return '';
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractEntrySummaryHtml(entry: Record<string, unknown>): string {
  const summary = entry.summary;
  if (summary == null) return '';
  if (typeof summary === 'string') return decodeHtmlEntities(summary);

  const summaryNode = toRecordArray(summary)[0];
  if (!summaryNode) return '';
  const text = summaryNode['#text'];
  if (typeof text === 'string' && text.length > 0) return decodeHtmlEntities(text);
  return decodeHtmlEntities(String(summaryNode ?? ''));
}

function extractHtmlSection(html: string, anchorId: string): string {
  if (!html) return '';
  const startRe = new RegExp(`<h4[^>]*id="${escapeRegex(anchorId)}"[^>]*>`, 'i');
  const start = html.search(startRe);
  if (start < 0) return '';
  const rest = html.slice(start);
  const nextH4 = rest.slice(1).search(/<h4[\s>]/i);
  return nextH4 > 0 ? rest.slice(0, nextH4 + 1) : rest;
}

function extractHtmlHeaderValue(html: string, label: string): string {
  if (!html || !label) return '';
  const labelPattern = escapeRegex(label).replace(/_/g, '[_\\s]?');
  const re = new RegExp(
    `<b[^>]*>\\s*(?:&nbsp;|\\s)*${labelPattern}\\s*</b>\\s*</td>\\s*<td[^>]*>([\\s\\S]*?)</td>`,
    'i',
  );
  const match = html.match(re);
  if (!match?.[1]) return '';
  return sanitizeHtmlCellValue(match[1]);
}

function extractTransactionIdFromHtml(html: string): string {
  const raw = extractHtmlHeaderValue(html, 'Transaction ID');
  if (!raw) return '';
  // Strip the "(Replay in GW Client)" link/suffix that SAP appends.
  const firstToken = raw.split(/\s+/).find((part) => /^[A-Za-z0-9]{16,}$/.test(part));
  return firstToken ?? raw;
}

function extractGatewayExceptionsFromHtml(contextHtml: string): GatewayExceptionInfo[] {
  if (!contextHtml) return [];
  const exceptionsIdx = contextHtml.search(/–\s*Exceptions\s*<\/b>/i);
  const attributesIdx = contextHtml.search(/–\s*Attributes\s*<\/b>/i);
  if (exceptionsIdx < 0) return [];
  const slice = contextHtml.slice(exceptionsIdx, attributesIdx > exceptionsIdx ? attributesIdx : contextHtml.length);

  const exceptions: GatewayExceptionInfo[] = [];
  const exceptionBlockRe = /<b[^>]*>[^<]*–\s*(\/?[^\s<]+)\s*<\/b>/g;
  let match: RegExpExecArray | null;
  while ((match = exceptionBlockRe.exec(slice)) !== null) {
    const name = (match[1] ?? '').trim();
    if (!name || /^Exceptions$/i.test(name)) continue;
    const afterIdx = match.index + match[0].length;
    const block = slice.slice(afterIdx, afterIdx + 2500);
    const text = extractHtmlHeaderValue(block, 'Text');
    exceptions.push({ type: name, text, raiseLocation: '' });
  }
  return exceptions;
}

function extractGatewaySourceFromHtml(sourceHtml: string): { lines: GatewaySourceLine[]; errorLine: number } {
  if (!sourceHtml) return { lines: [], errorLine: 0 };

  // Line numbers and current-line markers sit in the first <td id="sourcetablecolumn">.
  const columnMatches = Array.from(sourceHtml.matchAll(/<td[^>]*id="sourcetablecolumn"[^>]*>([\s\S]*?)<\/td>/gi));
  const numberHtml = columnMatches[0]?.[1] ?? '';
  const lineNumberMatches = Array.from(
    numberHtml.matchAll(/<span[^>]*class="linenumber[^"]*"[^>]*>([\s\S]*?)<\/span>/gi),
  );
  const numbers: Array<number | null> = lineNumberMatches.map((m) => {
    const value = stripHtmlTags(m[1] ?? '').trim();
    return /^\d+$/.test(value) ? Number(value) : null;
  });

  // Line source cells sit in the second <td id="sourcetablecolumn">.
  const sourceCellHtml = columnMatches[1]?.[1] ?? '';
  const lineDivs = Array.from(sourceCellHtml.matchAll(/<div[^>]*class="sourceline([^"]*)"[^>]*>([\s\S]*?)<\/div>/gi));

  const lines: GatewaySourceLine[] = [];
  let errorLine = 0;
  let fallback = 1;

  for (let i = 0; i < lineDivs.length; i++) {
    const match = lineDivs[i]!;
    const classes = (match[1] ?? '').trim();
    const isError = /\bhighlight\b/i.test(classes);
    const raw = stripHtmlTags(match[2] ?? '');
    const content = decodeHtmlEntities(raw).replace(/\s+$/, '');
    const assignedNumber = numbers[i];
    const resolvedNumber = typeof assignedNumber === 'number' && assignedNumber > 0 ? assignedNumber : fallback;
    fallback = resolvedNumber + 1;
    lines.push({ number: resolvedNumber, content, isError });
    if (isError && errorLine === 0) errorLine = resolvedNumber;
  }

  return { lines, errorLine };
}

function extractGatewayCallStackFromHtml(stackHtml: string): GatewayCallStackEntry[] {
  if (!stackHtml) return [];
  const tableMatch = stackHtml.match(/<table[\s\S]*?<\/table>/i);
  if (!tableMatch) return [];
  const tableHtml = tableMatch[0];
  const rowMatches = Array.from(tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi));

  const entries: GatewayCallStackEntry[] = [];
  for (const row of rowMatches) {
    const cells = Array.from(row[1]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((m) => m[1] ?? '');
    if (cells.length < 5) continue;
    const numberValue = Number(stripHtmlTags(cells[0]!).replace(/\D+/g, '').trim());
    if (!Number.isFinite(numberValue) || numberValue <= 0) continue;

    entries.push({
      number: numberValue,
      event: decodeHtmlEntities(stripHtmlTags(cells[1]!)).trim(),
      program: decodeHtmlEntities(stripHtmlTags(cells[2]!)).trim(),
      name: decodeHtmlEntities(stripHtmlTags(cells[3]!)).trim(),
      line: safePositiveInt(stripHtmlTags(cells[4]!).replace(/\D+/g, '')),
    });
  }
  return entries;
}

function sanitizeHtmlCellValue(raw: string): string {
  let value = stripHtmlTags(raw);
  value = decodeHtmlEntities(value);
  return value.replace(/\s+/g, ' ').trim();
}

// Loop until stable so adversarial nested input (e.g. `<<script>script>`) is fully
// stripped — single-pass regex would leave `<script>` behind. Closes CodeQL alert
// `js/incomplete-multi-character-sanitization` (alert #6).
export function stripHtmlTags(html: string): string {
  let result = String(html ?? '');
  let prev: string;
  do {
    prev = result;
    result = result.replace(/<[^>]*>/g, '');
  } while (result !== prev);
  return result;
}

// `&amp;` is decoded LAST so chained entities like `&amp;lt;` resolve to `&lt;`
// (the literal four-char text) rather than `<`. Closes CodeQL alert
// `js/double-escaping` (alert #7).
export function decodeHtmlEntities(text: string): string {
  return String(text ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&ndash;/gi, '–')
    .replace(/&mdash;/gi, '—')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/gi, '&');
}

function decodeUriComponentSafe(value: string): string {
  if (!value?.includes('%')) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
