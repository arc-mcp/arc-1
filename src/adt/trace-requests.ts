/** Native abaptraces contract shared by the legacy diagnostics adapter and the pinned trace adapter. */
import { AdtApiError } from './errors.js';
import type { TracedObjectType, TracedProcessType } from './types.js';
import { escapeXmlAttr } from './xml-parser.js';

export const TRACE_BASE = '/sap/bc/adt/runtime/traces/abaptraces';

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
export const TRACE_PROCESS_OBJECTS: Record<TracedProcessType, TracedObjectType[]> = {
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
export function buildTraceParametersXml(p: { description: string; aggregate: boolean; sqlTrace: boolean }): string {
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

/** The second POST's native selection: who, which client and process, until when and with which parameters. */
export function buildTraceRequestQuery(p: {
  description: string;
  traceUser: string;
  client: string;
  processType: TracedProcessType;
  objectType: TracedObjectType;
  expires: string;
  maxExecutions: number;
  parametersId: string;
}): string {
  return new URLSearchParams({
    server: '*',
    description: p.description,
    traceUser: p.traceUser,
    traceClient: p.client,
    processType: TRACE_PROCESS_TYPE_URIS[p.processType],
    objectType: TRACE_OBJECT_TYPE_URIS[p.objectType],
    expires: p.expires,
    maximalExecutions: String(p.maxExecutions),
    parametersId: p.parametersId,
  }).toString();
}

export function traceProcessTypeUri(processType: TracedProcessType): string {
  return TRACE_PROCESS_TYPE_URIS[processType];
}

export function traceObjectTypeUri(objectType: TracedObjectType): string {
  return TRACE_OBJECT_TYPE_URIS[objectType];
}

// Normalize full-path, absolute-URL, or bare trace-request ids without creating an arbitrary DELETE primitive.
export function traceRequestPath(id: string): string {
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

export function decodeTraceRequestPath(path: string, originalId: string): string {
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
