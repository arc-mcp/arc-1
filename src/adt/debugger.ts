/** Native ADT external-debugger operations. Sessions are owned by AdtClient. */
import type { AdtHttpClient } from './http.js';
import { escapeXmlAttr, findDeepNodes, parseXml } from './xml-parser.js';

const DEBUGGER = '/sap/bc/adt/debugger';
const BREAKPOINTS = `${DEBUGGER}/breakpoints`;

export type DebugStep = 'stepInto' | 'stepOver' | 'stepReturn' | 'stepContinue' | 'stepRunToLine' | 'stepJumpToLine';

export interface DebugBreakpoint {
  id?: string;
  kind: 'line' | 'statement' | 'exception' | 'message';
  uri?: string;
  line?: number;
  statement?: string;
  exception?: string;
  condition?: string;
  error?: string;
}

export function buildBreakpointXml(breakpoint: DebugBreakpoint, user: string, terminalId: string): string {
  let attrs: string;
  if (breakpoint.kind === 'line') {
    const uri = `${breakpoint.uri ?? ''}#start=${breakpoint.line ?? 0}`;
    attrs = `kind="line" enabled="true" adtcore:uri="${escapeXmlAttr(uri)}"`;
    if (breakpoint.condition) attrs += ` condition="${escapeXmlAttr(breakpoint.condition)}"`;
  } else if (breakpoint.kind === 'statement') {
    attrs = `kind="statement" enabled="true" statement="${escapeXmlAttr(breakpoint.statement ?? '')}"`;
  } else if (breakpoint.kind === 'exception') {
    attrs = `kind="exception" enabled="true" exceptionClass="${escapeXmlAttr(breakpoint.exception ?? '')}"`;
  } else {
    throw new Error(`Unsupported breakpoint kind: ${breakpoint.kind}`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?><dbg:breakpoints xmlns:dbg="http://www.sap.com/adt/debugger" xmlns:adtcore="http://www.sap.com/adt/core" debuggingMode="user" scope="external" requestUser="${escapeXmlAttr(user)}" terminalId="${escapeXmlAttr(terminalId)}" ideId="arc-1"><breakpoint ${attrs}/></dbg:breakpoints>`;
}

export async function addBreakpoint(
  http: AdtHttpClient,
  breakpoint: DebugBreakpoint,
  user: string,
  terminalId: string,
) {
  const response = await http.post(BREAKPOINTS, buildBreakpointXml(breakpoint, user, terminalId), 'application/xml', {
    Accept: 'application/xml',
  });
  return parseBreakpoints(response.body);
}

export async function listBreakpoints(http: AdtHttpClient, user: string, terminalId: string) {
  const query = new URLSearchParams({
    scope: 'external',
    debuggingMode: 'user',
    requestUser: user,
    terminalId,
    ideId: 'arc-1',
  });
  const response = await http.get(`${BREAKPOINTS}?${query}`, { Accept: 'application/xml' });
  return parseBreakpoints(response.body);
}

export async function deleteBreakpoint(
  http: AdtHttpClient,
  id: string,
  user: string,
  terminalId: string,
): Promise<void> {
  const query = new URLSearchParams({
    scope: 'external',
    debuggingMode: 'user',
    requestUser: user,
    terminalId,
    ideId: 'arc-1',
  });
  await http.delete(`${BREAKPOINTS}/${encodeURIComponent(id)}?${query}`);
}

export async function attachDebugger(
  http: AdtHttpClient,
  debuggeeId: string,
  user: string,
): Promise<Record<string, unknown>> {
  const query = new URLSearchParams({
    method: 'attach',
    debuggeeId,
    dynproDebugging: 'true',
    debuggingMode: 'user',
    requestUser: user,
  });
  return parseXml((await http.post(`${DEBUGGER}?${query}`, '', undefined, { Accept: 'application/xml' })).body);
}

/** Wait for a stopped external debuggee, then return its opaque ADT identifier. */
export async function listenDebugger(
  http: AdtHttpClient,
  user: string,
  terminalId: string,
  timeoutSeconds: number,
): Promise<{ debuggeeId?: string; raw: Record<string, unknown> }> {
  const query = new URLSearchParams({
    debuggingMode: 'user',
    requestUser: user,
    terminalId,
    ideId: 'arc-1',
    timeout: String(timeoutSeconds),
  });
  const response = await http.post(`${DEBUGGER}/listeners?${query}`, '', undefined, {
    Accept: 'application/vnd.sap.as+xml',
  });
  const raw = response.body.trim() ? parseXml(response.body) : {};
  const value = findDeepScalar(raw, 'DEBUGGEE_ID');
  return { ...(value.trim() ? { debuggeeId: value.trim() } : {}), raw };
}

export async function stepDebugger(
  http: AdtHttpClient,
  step: DebugStep,
  uri?: string,
): Promise<Record<string, unknown>> {
  const query = new URLSearchParams({ method: step });
  if (uri) query.set('uri', uri);
  return parseXml((await http.post(`${DEBUGGER}?${query}`, '', undefined, { Accept: 'application/xml' })).body);
}

export async function detachDebugger(http: AdtHttpClient): Promise<void> {
  await http.post(`${DEBUGGER}?method=terminateDebuggee`, '', undefined, { Accept: 'application/xml' });
}

export async function getDebuggerStack(http: AdtHttpClient): Promise<Record<string, unknown>> {
  return parseXml(
    (await http.get(`${DEBUGGER}/stack?method=getStack&emode=_&semanticURIs=true`, { Accept: 'application/xml' })).body,
  );
}

export async function getDebuggerVariables(http: AdtHttpClient, ids: string[]): Promise<Record<string, unknown>> {
  const rows = ids.map((id) => `<STPDA_ADT_VARIABLE><ID>${escapeXmlAttr(id)}</ID></STPDA_ADT_VARIABLE>`).join('');
  const body = `<?xml version="1.0" encoding="UTF-8"?><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DATA>${rows}</DATA></asx:values></asx:abap>`;
  return parseXml(
    (
      await http.post(
        `${DEBUGGER}?method=getVariables`,
        body,
        'application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.debugger.Variables',
        {
          Accept: 'application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.debugger.Variables',
        },
      )
    ).body,
  );
}

export function parseBreakpoints(xml: string): DebugBreakpoint[] {
  if (!xml.trim()) return [];
  const root = parseXml(xml);
  return findDeepNodes(root, 'breakpoint').map((node) => {
    const uri = String(node['@_uri'] ?? '');
    const line = uri.match(/#start=(\d+)/)?.[1];
    return {
      id: stringValue(node['@_id']),
      kind: String(node['@_kind'] ?? 'line') as DebugBreakpoint['kind'],
      uri: uri.replace(/#start=\d+$/, '') || undefined,
      line: line ? Number(line) : undefined,
      statement: stringValue(node['@_statement']),
      exception: stringValue(node['@_exceptionClass']),
      condition: stringValue(node['@_condition']),
      error: stringValue(node['@_errorMessage']),
    };
  });
}

function stringValue(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  return text || undefined;
}

/** The shared node finder intentionally returns only records; listener IDs are scalar leaf values. */
function findDeepScalar(value: unknown, key: string): string {
  if (!value || typeof value !== 'object') return '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findDeepScalar(item, key);
      if (found) return found;
    }
    return '';
  }
  const record = value as Record<string, unknown>;
  const direct = record[key];
  if (direct !== undefined && direct !== null && typeof direct !== 'object') return String(direct);
  for (const child of Object.values(record)) {
    const found = findDeepScalar(child, key);
    if (found) return found;
  }
  return '';
}
