/**
 * ABAP debugger over ADT REST (`/sap/bc/adt/debugger/*`) — the building blocks of the one-shot
 * capture behind `SAPDiagnose action="debug"`.
 *
 * Contract (corroborated by abap-adt-api, vscode_abap_remote_fs and vibing-steampunk — see
 * docs/research/2026-10-22-abap-debugger-one-shot-capture.md):
 * - breakpoints and the listener are keyed by `debuggingMode=user` + `requestUser` + `terminalId` +
 *   `ideId`; `requestUser` MUST be the real SAP logon user (an empty one matches nothing);
 * - the listener is a long poll that answers with the stopped debuggee, or an empty body at timeout;
 * - attach → stack → variables → step → release must share ONE stateful session (`sap-contextid`)
 *   on the debuggee's application server, so `DebuggerSession` is constructed with the client
 *   `openSessionOnServer()` returns;
 * - every request is preceded by `checkDebug` (SAP_ALLOW_DEBUG + SAP_ALLOW_DATA_PREVIEW).
 *
 * Deliberately absent: variable writes (`setVariableValue`), `stepJumpToLine` and system debugging —
 * ARC-1 observes a run, it never changes what the program does. `stepRunToLine` is not needed: a
 * second breakpoint plus `stepContinue` reaches the same line.
 */

import { randomUUID } from 'node:crypto';
import { logger } from '../server/logger.js';
import { AdtApiError } from './errors.js';
import type { AdtHttpClient, AdtRequestOptions } from './http.js';
import { checkDebug, type SafetyConfig } from './safety.js';
import { SYSTEM_INFORMATION_ACCEPT, SYSTEM_INFORMATION_PATH } from './session-user.js';
import { escapeXmlAttr, parseXml } from './xml-parser.js';

const DEBUGGER_PATH = '/sap/bc/adt/debugger';
const BREAKPOINTS_PATH = '/sap/bc/adt/debugger/breakpoints';
const LISTENERS_PATH = '/sap/bc/adt/debugger/listeners';
const STACK_QUERY = 'method=getStack&emode=_&semanticURIs=true';
/** Extra HTTP budget on top of the server-side listener timeout before the client gives up. */
const LISTEN_HTTP_GRACE_SECONDS = 30;
const AS_XML = 'application/vnd.sap.as+xml';
const VARIABLES_CONTENT_TYPE = `${AS_XML};charset=UTF-8;dataname=com.sap.adt.debugger.Variables`;
const CHILD_VARIABLES_CONTENT_TYPE = `${AS_XML};charset=UTF-8;dataname=com.sap.adt.debugger.ChildVariables`;
const SUBTYPE_KEY = 'com.sap.adt.communicationFramework.subType';

type XmlNode = Record<string, unknown>;

function asNode(value: unknown): XmlNode | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as XmlNode) : undefined;
}

function asNodes(value: unknown): XmlNode[] {
  if (Array.isArray(value)) return value.map(asNode).filter((node): node is XmlNode => !!node);
  const node = asNode(value);
  return node ? [node] : [];
}

/** Text of an element or attribute. `parseXml` already decoded its entities — never decode again. */
function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const node = asNode(value);
  return node && node['#text'] !== undefined ? String(node['#text']) : '';
}

function attr(node: XmlNode, name: string): string {
  return text(node[`@_${name}`]);
}

function flag(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === 'x';
}

function toInt(value: string): number | undefined {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** The shared ADT XML boundary: entities decoded once, single repeated elements left unwrapped
 *  (every reader below goes through `asNodes`, which accepts one node or many). `exact` keeps the
 *  texts' leading and trailing blanks — a variable's value needs them. */
function parseDocument(xml: string, exact = false): XmlNode {
  return asNode(parseXml(xml, exact)) ?? {};
}

/** Children of `<asx:abap><asx:values><DATA>` — every debugger ABAP-XML envelope uses it (the shared
 *  parser always makes `DATA` an array). */
function abapData(xml: string, exact = false): XmlNode | undefined {
  return asNodes(asNode(asNode(parseDocument(xml, exact).abap)?.values)?.DATA)[0];
}

// ─── Identity ──────────────────────────────────────────────────────

/** The (requestUser, terminalId, ideId) triple every listener/breakpoint request carries. */
export interface DebugIdentity {
  /** SAP logon user, upper case — the only user ARC-1 ever debugs. */
  user: string;
  terminalId: string;
  ideId: string;
}

const randomId = (): string => randomUUID().replace(/-/g, '').toUpperCase();

/** A fresh identity per capture: a full breakpoint sync then only ever touches ARC-1's own set. */
export function createDebugIdentity(user: string): DebugIdentity {
  return { user: user.trim().toUpperCase(), terminalId: randomId(), ideId: randomId() };
}

function identityQuery(identity: DebugIdentity, extra: Record<string, string> = {}): string {
  return new URLSearchParams({
    debuggingMode: 'user',
    requestUser: identity.user,
    terminalId: identity.terminalId,
    ideId: identity.ideId,
    ...extra,
  }).toString();
}

// ─── Errors ────────────────────────────────────────────────────────

/** The parts of an ADT debugger exception document worth acting on. */
export interface DebuggerException {
  type?: string;
  /** `com.sap.adt.communicationFramework.subType`, e.g. debuggeeEnded, conflictDetected. */
  subType?: string;
  message?: string;
  conflictText?: string;
}

export function parseDebuggerException(xml: string | undefined): DebuggerException | undefined {
  if (!xml?.includes('exception')) return undefined;
  let exception: XmlNode | undefined;
  try {
    exception = asNode(parseDocument(xml).exception);
  } catch {
    return undefined;
  }
  if (!exception) return undefined;
  const properties = asNodes(asNode(exception.properties)?.entry);
  const property = (key: string): string | undefined => {
    const entry = properties.find((candidate) => attr(candidate, 'key') === key);
    const value = entry ? text(entry).trim() : '';
    return value || undefined;
  };
  const message = text(exception.localizedMessage).trim() || text(exception.message).trim();
  const type = attr(asNode(exception.type) ?? {}, 'id');
  return {
    ...(type ? { type } : {}),
    ...(property(SUBTYPE_KEY) ? { subType: property(SUBTYPE_KEY) } : {}),
    ...(message ? { message } : {}),
    ...(property('conflictText') ? { conflictText: property('conflictText') } : {}),
  };
}

/** The debugger subType carried by a failed ADT call, if SAP sent one. */
export function debuggerErrorSubType(err: unknown): string | undefined {
  return err instanceof AdtApiError ? parseDebuggerException(err.responseBody)?.subType : undefined;
}

/** SAP's human-readable sentence for a failed debugger call (falls back to the error message). */
export function debuggerErrorText(err: unknown): string {
  if (err instanceof AdtApiError) {
    const exception = parseDebuggerException(err.responseBody);
    const textual = exception?.conflictText ?? exception?.message;
    if (textual) return textual;
  }
  return err instanceof Error ? err.message : String(err);
}

export function isConflictSubType(subType: string | undefined): boolean {
  return subType === 'conflictDetected' || subType === 'conflictNotification';
}

/** The debuggee is gone or no longer attached — the release path treats both as "released". */
export function isEndedSubType(subType: string | undefined): boolean {
  return subType === 'debuggeeEnded' || subType === 'noSessionAttached';
}

// ─── Breakpoints ───────────────────────────────────────────────────

export type DebugBreakpointScope = 'external' | 'debugger';

export type DebugBreakpointSpec =
  | { kind: 'line'; clientId: string /** Source URI without fragment. */; uri: string; line: number }
  | { kind: 'exception'; clientId: string; exceptionClass: string };

export interface DebugBreakpointState {
  clientId: string;
  kind: string;
  /** Server-assigned id; absent when SAP refused the breakpoint. */
  id?: string;
  uri?: string;
  line?: number;
  exceptionClass?: string;
  /** SAP's refusal, e.g. "Cannot create a breakpoint at this position". */
  error?: string;
}

/** POST body that synchronizes this identity's breakpoint set (`syncScope full` → exactly `specs`). */
export function buildBreakpointsXml(
  identity: DebugIdentity,
  specs: readonly DebugBreakpointSpec[],
  scope: DebugBreakpointScope,
): string {
  const items = specs
    .map((spec) =>
      spec.kind === 'line'
        ? `<breakpoint xmlns:adtcore="http://www.sap.com/adt/core" kind="line" clientId="${escapeXmlAttr(spec.clientId)}" skipCount="0" adtcore:uri="${escapeXmlAttr(`${spec.uri}#start=${spec.line}`)}"/>`
        : `<breakpoint kind="exception" clientId="${escapeXmlAttr(spec.clientId)}" skipCount="0" exceptionClass="${escapeXmlAttr(spec.exceptionClass)}"/>`,
    )
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<dbg:breakpoints xmlns:dbg="http://www.sap.com/adt/debugger" scope="${scope}" debuggingMode="user"` +
    ` requestUser="${escapeXmlAttr(identity.user)}" terminalId="${escapeXmlAttr(identity.terminalId)}"` +
    ` ideId="${escapeXmlAttr(identity.ideId)}" systemDebugging="false" deactivated="false">` +
    `<syncScope mode="full"></syncScope>${items}</dbg:breakpoints>`
  );
}

export function parseBreakpointsResponse(xml: string): DebugBreakpointState[] {
  if (!xml.trim()) return [];
  const breakpoints = asNodes(asNode(parseDocument(xml).breakpoints)?.breakpoint);
  return breakpoints.map((node) => {
    const [uri, fragment] = attr(node, 'uri').split('#', 2);
    const line = fragment ? toInt(/start=(\d+)/.exec(fragment)?.[1] ?? '') : undefined;
    const id = attr(node, 'id');
    const error = attr(node, 'errorMessage');
    const exceptionClass = attr(node, 'exceptionClass');
    return {
      clientId: attr(node, 'clientId'),
      kind: attr(node, 'kind'),
      ...(id ? { id } : {}),
      ...(uri ? { uri } : {}),
      ...(line !== undefined ? { line } : {}),
      ...(exceptionClass ? { exceptionClass } : {}),
      ...(error ? { error } : {}),
    };
  });
}

/** Replace this identity's breakpoint set with `specs` (an empty list clears it). */
export async function syncBreakpoints(
  http: AdtHttpClient,
  safety: SafetyConfig,
  identity: DebugIdentity,
  specs: readonly DebugBreakpointSpec[],
  scope: DebugBreakpointScope = 'external',
  options?: AdtRequestOptions,
): Promise<DebugBreakpointState[]> {
  checkDebug(safety, 'DebuggerSetBreakpoints');
  const resp = await http.post(
    BREAKPOINTS_PATH,
    buildBreakpointsXml(identity, specs, scope),
    'application/xml',
    { Accept: 'application/xml' },
    options,
  );
  return parseBreakpointsResponse(resp.body);
}

export async function deleteBreakpoint(
  http: AdtHttpClient,
  safety: SafetyConfig,
  identity: DebugIdentity,
  id: string,
  scope: DebugBreakpointScope = 'external',
  options?: AdtRequestOptions,
): Promise<void> {
  checkDebug(safety, 'DebuggerDeleteBreakpoint');
  await http.delete(
    `${BREAKPOINTS_PATH}/${encodeURIComponent(id)}?${identityQuery(identity, { scope })}`,
    { Accept: 'application/xml' },
    options,
  );
}

// ─── Listener ──────────────────────────────────────────────────────

/** A debuggee stopped at a breakpoint and waiting for an attach (`STPDA_DEBUGGEE`). */
export interface Debuggee {
  id: string;
  user: string;
  program: string;
  include: string;
  line?: number;
  kind: string;
  attachImpossible: boolean;
  /** The application server the debuggee waits on (`INSTANCE_NAME`, the name `sap-contextid` carries). */
  instance?: string;
  uri?: string;
  objectType?: string;
  objectName?: string;
}

export function parseDebuggee(xml: string): Debuggee | undefined {
  if (!xml.trim()) return undefined;
  const node = asNodes(abapData(xml)?.STPDA_DEBUGGEE)[0];
  if (!node) return undefined;
  const field = (name: string): string => text(node[name]).trim();
  const id = field('DEBUGGEE_ID');
  if (!id) return undefined;
  const line = toInt(field('LINE_CURR'));
  return {
    id,
    user: field('DEBUGGEE_USER'),
    program: field('PRG_CURR'),
    include: field('INCL_CURR'),
    ...(line !== undefined ? { line } : {}),
    kind: field('DBGEE_KIND'),
    attachImpossible: flag(field('IS_ATTACH_IMPOSSIBLE')),
    ...(field('INSTANCE_NAME') ? { instance: field('INSTANCE_NAME') } : {}),
    ...(field('URI') ? { uri: field('URI') } : {}),
    ...(field('TYPE') ? { objectType: field('TYPE') } : {}),
    ...(field('NAME') ? { objectName: field('NAME') } : {}),
  };
}

export type DebugListenResult =
  | { status: 'caught'; debuggee: Debuggee }
  | { status: 'timeout' }
  | { status: 'conflict'; message: string };

/**
 * Is another IDE (Eclipse, VS Code, a second ARC-1 call) already listening for this user? Returns
 * SAP's conflict text, or undefined. A release without the conflict check answers 404/405 — the
 * listener's own `checkConflict=true` still protects that case.
 */
export async function findListenerConflict(
  http: AdtHttpClient,
  safety: SafetyConfig,
  identity: DebugIdentity,
  options?: AdtRequestOptions,
): Promise<string | undefined> {
  checkDebug(safety, 'DebuggerCheckListeners');
  try {
    const resp = await http.get(
      `${LISTENERS_PATH}?${identityQuery(identity, { checkConflict: 'true' })}`,
      { Accept: '*/*' },
      options,
    );
    const exception = parseDebuggerException(resp.body);
    if (isConflictSubType(exception?.subType)) return exception?.conflictText ?? exception?.message ?? 'conflict';
    return undefined;
  } catch (err) {
    if (isConflictSubType(debuggerErrorSubType(err))) return debuggerErrorText(err);
    if (err instanceof AdtApiError && [404, 405].includes(err.statusCode)) return undefined;
    throw err;
  }
}

/**
 * Long-poll until a debuggee of `identity.user` stops at a breakpoint, SAP reports a conflict, or the
 * server-side `timeoutSeconds` elapses (empty body). Run it on the STATELESS client: SAP keeps a
 * poll running until its timeout even after the client stops waiting, and a stateful session answers
 * one request at a time.
 */
export async function listenForDebuggee(
  http: AdtHttpClient,
  safety: SafetyConfig,
  identity: DebugIdentity,
  timeoutSeconds: number,
  options: AdtRequestOptions = {},
): Promise<DebugListenResult> {
  checkDebug(safety, 'DebuggerListen');
  const query = identityQuery(identity, {
    checkConflict: 'true',
    isNotifiedOnConflict: 'true',
    timeout: String(Math.max(1, Math.floor(timeoutSeconds))),
  });
  let body: string;
  try {
    const resp = await http.post(
      `${LISTENERS_PATH}?${query}`,
      undefined,
      undefined,
      { Accept: AS_XML },
      { fetchTimeoutMs: (timeoutSeconds + LISTEN_HTTP_GRACE_SECONDS) * 1000, ...options },
    );
    body = resp.body;
  } catch (err) {
    if (isConflictSubType(debuggerErrorSubType(err))) return { status: 'conflict', message: debuggerErrorText(err) };
    throw err;
  }
  if (!body.trim()) return { status: 'timeout' };
  const exception = parseDebuggerException(body);
  if (exception) {
    if (isConflictSubType(exception.subType)) {
      return { status: 'conflict', message: exception.conflictText ?? exception.message ?? 'conflict' };
    }
    throw new AdtApiError(exception.message ?? 'Debugger listener failed', 500, LISTENERS_PATH, body);
  }
  const debuggee = parseDebuggee(body);
  return debuggee ? { status: 'caught', debuggee } : { status: 'timeout' };
}

/**
 * Remove the user's listener registration. In user mode SAP keys it by user ALONE (IDE_ID = user,
 * TERMINAL_ID = '%_USER'), so a DELETE quoting our ids would match nothing and the registration would
 * swallow the next debuggee. Removing it also drops the user's external breakpoints (SAP behavior).
 */
export async function stopListener(
  http: AdtHttpClient,
  safety: SafetyConfig,
  user: string,
  options?: AdtRequestOptions,
): Promise<void> {
  checkDebug(safety, 'DebuggerStopListener');
  const query = new URLSearchParams({ debuggingMode: 'user', requestUser: user.toUpperCase() }).toString();
  await http.delete(`${LISTENERS_PATH}?${query}`, { Accept: '*/*' }, options);
}

// ─── The debuggee's server ─────────────────────────────────────────
//
// SAP attaches only from the debuggee's own application server: from any other it answers
// `invalidDebuggee` — although the debuggee reports `CAN_ADT_CROSS_SERVER=true` — and the refused attempt
// spoils the debuggee for every later one. Nothing addresses a server directly: a new stateful session
// is load-balanced, and its `sap-contextid` names where it landed. The balancer prefers the least-loaded
// server and a stopped debuggee loads its own, so once it waits, new sessions avoid it (live, BTP ABAP:
// 16 of 16, either way round). Sessions are therefore opened BEFORE the run (`openSessionsAhead`), and
// ARC-1's own trigger runs on one of them; probing after the stop is the fallback.

/** Before the run: a balanced pair of servers is seen twice within 3 probes, one server within 2. */
const MAX_AHEAD_PROBES = 6;
/** After the stop the balancer steers away from the debuggee's server, so more probes rarely help. */
const MAX_SERVER_PROBES = 8;

/** A new stateful session and the server SAP pinned it to — none when SAP does not say (≤ 7.50, other cookie shapes). */
async function probeSession(
  http: AdtHttpClient,
  options: AdtRequestOptions,
): Promise<{ session: AdtHttpClient; server?: string }> {
  const session = http.openStatefulSession();
  try {
    await session.get(
      SYSTEM_INFORMATION_PATH,
      { Accept: SYSTEM_INFORMATION_ACCEPT },
      { ...options, suppressNotFoundLog: true },
    );
  } catch (err) {
    if (err instanceof AdtApiError && [404, 405, 406, 501].includes(err.statusCode)) return { session };
    throw err;
  }
  const server = contextServer(session.sessionContextId);
  return { session, ...(server ? { server } : {}) };
}

export interface SessionsAhead {
  /** One idle stateful session per server seen, keyed upper-case: the attach session for a debuggee there. */
  byServer: Map<string, AdtHttpClient>;
  /** A second session on one of those servers: a trigger run on it stops where an attach session waits. */
  trigger?: AdtHttpClient;
}

/**
 * Stateful sessions opened before the run, while no debuggee loads a server: until two land on the same
 * server (that pair runs the trigger and attaches) or `maxProbes`. Empty when SAP names no server
 * (single server, older releases): then the attach goes wherever it lands, as before.
 */
export async function openSessionsAhead(
  http: AdtHttpClient,
  safety: SafetyConfig,
  options: AdtRequestOptions & { maxProbes?: number } = {},
): Promise<SessionsAhead> {
  checkDebug(safety, 'DebuggerOpenSession');
  const { maxProbes = MAX_AHEAD_PROBES, ...requestOptions } = options;
  const byServer = new Map<string, AdtHttpClient>();
  try {
    for (let probe = 0; probe < maxProbes; probe++) {
      const { session, server } = await probeSession(http, requestOptions);
      if (!server) {
        await endSession(session, safety, requestOptions);
        break;
      }
      if (byServer.has(server.toUpperCase())) {
        logger.debug('Debugger sessions opened ahead of the run', { servers: [...byServer.keys()], probes: probe + 1 });
        return { byServer, trigger: session };
      }
      byServer.set(server.toUpperCase(), session);
    }
  } catch (err) {
    for (const session of byServer.values()) await endSession(session, safety, requestOptions);
    throw err;
  }
  return { byServer };
}

export interface PinnedSession {
  http: AdtHttpClient;
  /** The server SAP pinned the session to; undefined when it did not say. */
  instance?: string;
  /** Sessions opened to find it (0 = none needed). */
  probes: number;
}

/**
 * Fallback after the stop: open sessions until one lands on the debuggee's server, ending the others;
 * after `maxProbes` misses the last one is returned (the attach then reports the miss). Without a
 * server to look for, or when SAP does not say where a session landed, the first session is used.
 */
export async function openSessionOnServer(
  http: AdtHttpClient,
  safety: SafetyConfig,
  instance: string | undefined,
  options: AdtRequestOptions & { maxProbes?: number } = {},
): Promise<PinnedSession> {
  checkDebug(safety, 'DebuggerOpenSession');
  const { maxProbes = MAX_SERVER_PROBES, ...requestOptions } = options;
  const wanted = instance?.trim().toUpperCase();
  if (!wanted) return { http: http.openStatefulSession(), probes: 0 };
  for (let probes = 1; ; probes++) {
    const { session, server } = await probeSession(http, requestOptions);
    if (!server || server.toUpperCase() === wanted || probes >= maxProbes) {
      logger.debug('Debugger session opened after the stop', { debuggeeServer: instance, landed: server, probes });
      return { http: session, ...(server ? { instance: server } : {}), probes };
    }
    await endSession(session, safety, requestOptions);
  }
}

/** The application server a session is pinned to, from its `sap-contextid` (`SID:ANON:<server>:<id>`). */
export function contextServer(contextId: string | undefined): string | undefined {
  if (!contextId) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(contextId);
  } catch {
    return undefined;
  }
  const parts = decoded.split(':');
  return parts.length >= 4 && parts[0] === 'SID' && parts[2] ? parts[2] : undefined;
}

/**
 * Best-effort: close a session from `openStatefulSession()` the way Eclipse ADT does
 * (`AdtHttpClient.endStatefulSession`: the dedicated close-session request on its context).
 */
export async function endSession(
  session: AdtHttpClient,
  safety: SafetyConfig,
  options: AdtRequestOptions = {},
): Promise<void> {
  checkDebug(safety, 'DebuggerEndSession');
  // Best-effort and never throws: a session SAP did not close only lives until its session timeout.
  await session.endStatefulSession(options);
}

// ─── Session documents ─────────────────────────────────────────────

export interface DebugAttachInfo {
  steppingPossible: boolean;
  postMortem: boolean;
  reachedBreakpoints: Array<{ id: string; kind: string }>;
}

export function parseAttachResponse(xml: string): DebugAttachInfo {
  const node = asNode(parseDocument(xml).attach) ?? {};
  return {
    steppingPossible: attr(node, 'isSteppingPossible') === '' ? true : flag(attr(node, 'isSteppingPossible')),
    postMortem: flag(attr(node, 'isPostMortem')),
    reachedBreakpoints: asNodes(asNode(node.reachedBreakpoints)?.breakpoint).map((bp) => ({
      id: attr(bp, 'id'),
      kind: attr(bp, 'kind'),
    })),
  };
}

export interface DebugStackFrame {
  position?: number;
  stackType: string;
  program: string;
  include: string;
  line?: number;
  eventType: string;
  eventName: string;
  systemProgram: boolean;
  uri?: string;
}

/** Stack entries in document order — the first entry is the frame the debuggee stopped in. */
export function parseStackResponse(xml: string): DebugStackFrame[] {
  const entries = asNodes(asNode(parseDocument(xml).stack)?.stackEntry);
  return entries.map((entry) => {
    const position = toInt(attr(entry, 'stackPosition'));
    const line = toInt(attr(entry, 'line'));
    const uri = attr(entry, 'uri');
    return {
      ...(position !== undefined ? { position } : {}),
      stackType: attr(entry, 'stackType'),
      program: attr(entry, 'programName'),
      include: attr(entry, 'includeName'),
      ...(line !== undefined ? { line } : {}),
      eventType: attr(entry, 'eventType'),
      eventName: attr(entry, 'eventName'),
      systemProgram: flag(attr(entry, 'systemProgram')),
      ...(uri ? { uri } : {}),
    };
  });
}

/** One `STPDA_ADT_VARIABLE` row. */
export interface DebugVariable {
  id: string;
  name: string;
  declaredType: string;
  actualType: string;
  /** simple | string | structure | table | objectref | dataref | class | object | boxref | … */
  metaType: string;
  technicalType: string;
  /** As SAP sent it, blanks included: a string's trailing blank is part of it (`CONV string( 124 )` = `'124 '`). */
  value: string;
  tableLines?: number;
  /** SAP truncated the value (IS_VALUE_INCOMPLETE). */
  incomplete: boolean;
}

export interface DebugVariableHierarchy {
  parentId: string;
  childId: string;
  childName: string;
}

function parseVariableNode(node: XmlNode): DebugVariable {
  const field = (name: string): string => text(node[name]);
  const tableLines = toInt(field('TABLE_LINES'));
  return {
    id: field('ID').trim(),
    name: field('NAME').trim(),
    declaredType: field('DECLARED_TYPE_NAME').trim(),
    actualType: field('ACTUAL_TYPE_NAME').trim(),
    metaType: field('META_TYPE').trim().toLowerCase(),
    technicalType: field('TECHNICAL_TYPE').trim(),
    value: field('VALUE'),
    ...(tableLines !== undefined ? { tableLines } : {}),
    incomplete: flag(field('IS_VALUE_INCOMPLETE')),
  };
}

export function parseVariablesResponse(xml: string): DebugVariable[] {
  if (!xml.trim()) return [];
  return asNodes(abapData(xml, true)?.STPDA_ADT_VARIABLE).map(parseVariableNode);
}

export function parseChildVariablesResponse(xml: string): {
  hierarchies: DebugVariableHierarchy[];
  variables: DebugVariable[];
} {
  if (!xml.trim()) return { hierarchies: [], variables: [] };
  const data = abapData(xml, true);
  const hierarchies = asNodes(asNode(data?.HIERARCHIES)?.STPDA_ADT_VARIABLE_HIERARCHY).map((node) => ({
    parentId: text(node.PARENT_ID).trim(),
    childId: text(node.CHILD_ID).trim(),
    childName: text(node.CHILD_NAME).trim(),
  }));
  const variables = asNodes(asNode(data?.VARIABLES)?.STPDA_ADT_VARIABLE).map(parseVariableNode);
  return { hierarchies, variables };
}

function asXmlEnvelope(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DATA>${inner}</DATA></asx:values></asx:abap>`;
}

export function buildVariablesXml(ids: readonly string[]): string {
  return asXmlEnvelope(
    ids.map((id) => `<STPDA_ADT_VARIABLE><ID>${escapeXmlAttr(id)}</ID></STPDA_ADT_VARIABLE>`).join(''),
  );
}

export function buildChildVariablesXml(parents: readonly string[]): string {
  const rows = parents
    .map(
      (parent) =>
        `<STPDA_ADT_VARIABLE_HIERARCHY><PARENT_ID>${escapeXmlAttr(parent)}</PARENT_ID></STPDA_ADT_VARIABLE_HIERARCHY>`,
    )
    .join('');
  return asXmlEnvelope(`<HIERARCHIES>${rows}</HIERARCHIES>`);
}

// ─── Stateful session ──────────────────────────────────────────────

export type DebugStepMethod = 'stepInto' | 'stepOver' | 'stepReturn' | 'stepContinue' | 'terminateDebuggee';

export type DebugStepResult =
  /** `reachedBreakpoints`: ids of the breakpoints the run stopped at, when SAP names them. */
  { status: 'stopped'; steppingPossible: boolean; reachedBreakpoints: string[] } | { status: 'ended'; reason: string };

export interface DebugReleaseResult {
  released: boolean;
  /** continue = the program ran on to its end; terminate = SAP aborted the debuggee's session. */
  via: 'continue' | 'terminate' | 'none';
  detail?: string;
}

/**
 * One attached debug session. Construct it with the client handed out by
 * `AdtHttpClient.withStatefulSession()` — the attach lives in an ABAP roll area that only the same
 * `sap-contextid` can reach again.
 */
export class DebuggerSession {
  private stackShape: 'unknown' | 'resource' | 'dispatcher' = 'unknown';

  constructor(
    private readonly http: AdtHttpClient,
    private readonly safety: SafetyConfig,
    readonly identity: DebugIdentity,
    private readonly options: AdtRequestOptions = {},
  ) {}

  async attach(debuggeeId: string): Promise<DebugAttachInfo> {
    checkDebug(this.safety, 'DebuggerAttach');
    const query = new URLSearchParams({
      method: 'attach',
      debuggeeId,
      dynproDebugging: 'true',
      debuggingMode: 'user',
      requestUser: this.identity.user,
    }).toString();
    const resp = await this.http.post(
      `${DEBUGGER_PATH}?${query}`,
      undefined,
      undefined,
      { Accept: '*/*' },
      this.options,
    );
    return parseAttachResponse(resp.body);
  }

  /**
   * The call stack. Newer releases serve `/debugger/stack`; 7.50 has no such resource (404) and
   * answers the same `getStack` on the dispatcher. The working shape is remembered per session.
   */
  async stack(): Promise<DebugStackFrame[]> {
    checkDebug(this.safety, 'DebuggerGetStack');
    if (this.stackShape !== 'dispatcher') {
      try {
        const resp = await this.http.get(
          `${DEBUGGER_PATH}/stack?${STACK_QUERY}`,
          { Accept: '*/*' },
          { ...this.options, suppressNotFoundLog: true },
        );
        this.stackShape = 'resource';
        return parseStackResponse(resp.body);
      } catch (err) {
        // A 404 after the resource already answered on this session is news about the session.
        if (!(err instanceof AdtApiError && err.statusCode === 404) || this.stackShape === 'resource') throw err;
      }
    }
    const resp = await this.http.post(
      `${DEBUGGER_PATH}?${STACK_QUERY}`,
      undefined,
      undefined,
      { Accept: '*/*' },
      this.options,
    );
    this.stackShape = 'dispatcher';
    return parseStackResponse(resp.body);
  }

  /** Read variables by expression (`LV_X`, `LS_S-COMP`, `LT_T[2]`, `ME->MV_A`, `SY-SUBRC`). */
  async variables(ids: readonly string[]): Promise<DebugVariable[]> {
    checkDebug(this.safety, 'DebuggerGetVariables');
    if (ids.length === 0) return [];
    const resp = await this.http.post(
      `${DEBUGGER_PATH}?method=getVariables`,
      buildVariablesXml(ids),
      VARIABLES_CONTENT_TYPE,
      { Accept: AS_XML },
      this.options,
    );
    return parseVariablesResponse(resp.body);
  }

  /** Children of one or more nodes of the variable tree (`@ROOT` → scopes, a structure → components). */
  async childVariables(
    parents: readonly string[],
  ): Promise<{ hierarchies: DebugVariableHierarchy[]; variables: DebugVariable[] }> {
    checkDebug(this.safety, 'DebuggerGetChildVariables');
    if (parents.length === 0) return { hierarchies: [], variables: [] };
    const resp = await this.http.post(
      `${DEBUGGER_PATH}?method=getChildVariables`,
      buildChildVariablesXml(parents),
      CHILD_VARIABLES_CONTENT_TYPE,
      { Accept: AS_XML },
      this.options,
    );
    return parseChildVariablesResponse(resp.body);
  }

  /** One debugger step. A debuggee that finished (or is gone) reports `ended`, never throws. */
  async step(method: DebugStepMethod): Promise<DebugStepResult> {
    checkDebug(this.safety, 'DebuggerStep');
    try {
      const resp = await this.http.post(
        `${DEBUGGER_PATH}?method=${method}`,
        undefined,
        undefined,
        { Accept: '*/*' },
        this.options,
      );
      const exception = parseDebuggerException(resp.body);
      if (exception && isEndedSubType(exception.subType)) return { status: 'ended', reason: exception.subType ?? '' };
      const node = asNode(parseDocument(resp.body).step) ?? {};
      const stepping = attr(node, 'isSteppingPossible');
      return {
        status: 'stopped',
        steppingPossible: stepping === '' ? true : flag(stepping),
        reachedBreakpoints: asNodes(asNode(node.reachedBreakpoints)?.breakpoint)
          .map((bp) => attr(bp, 'id'))
          .filter(Boolean),
      };
    } catch (err) {
      const subType = debuggerErrorSubType(err);
      if (isEndedSubType(subType)) return { status: 'ended', reason: subType ?? '' };
      throw err;
    }
  }

  /**
   * Stop this run from stopping at one breakpoint again: delete its session copy (the external one
   * is gone since the attach), as vscode_abap_remote_fs does for an attached thread.
   */
  async removeBreakpoint(id: string): Promise<void> {
    await deleteBreakpoint(this.http, this.safety, this.identity, id, 'debugger', this.options);
  }

  /**
   * Let the debuggee run on: drop the session copies of ARC-1's breakpoints, then `stepContinue`
   * until SAP reports the debuggee ended. `method=detach` is unknown on 7.58, so continue is the
   * release; `terminateDebuggee` (aborts the caller's request) is the last resort only.
   */
  async release(breakpointIds: readonly string[], maxContinues = 3): Promise<DebugReleaseResult> {
    try {
      await syncBreakpoints(this.http, this.safety, this.identity, [], 'debugger', this.options);
    } catch {
      for (const id of breakpointIds) {
        try {
          await deleteBreakpoint(this.http, this.safety, this.identity, id, 'debugger', this.options);
        } catch {
          // best-effort: a stale session copy can only cost one extra continue below
        }
      }
    }
    let lastFailure = 'the debuggee kept stopping';
    for (let attempt = 0; attempt < maxContinues; attempt++) {
      try {
        const outcome = await this.step('stepContinue');
        if (outcome.status === 'ended') return { released: true, via: 'continue' };
      } catch (err) {
        lastFailure = `stepContinue failed: ${debuggerErrorText(err)}`;
        break;
      }
    }
    try {
      await this.step('terminateDebuggee');
      return { released: true, via: 'terminate', detail: lastFailure };
    } catch (err) {
      return {
        released: false,
        via: 'none',
        detail: `${lastFailure}; terminateDebuggee failed: ${debuggerErrorText(err)}`,
      };
    }
  }
}
