/**
 * SAPDiagnose action="debug" — one-shot ABAP debugger capture.
 *
 * ARC-1 is stateless HTTP, and a stopped debuggee holds a work process plus the request that ran it,
 * so the whole debugger loop completes inside ONE tool call (the same reasoning as "ADT locks never
 * cross an MCP round-trip"): arm breakpoints → long-poll the listener on the stateless client → run
 * the trigger → attach on one stateful session, opened on the debuggee's application server (SAP
 * attaches from no other) → follow that ONE run from stop to stop (read, step, `stepContinue`) →
 * release → always remove ARC-1's breakpoints and the listener. The model gets snapshots of one run,
 * never a remote control.
 * See docs/research/2026-10-22-abap-debugger-one-shot-capture.md.
 */

import { setTimeout as sleep } from 'node:timers/promises';
import type { AdtClient } from '../adt/client.js';
import {
  contextServer,
  createDebugIdentity,
  type DebugBreakpointSpec,
  type DebugBreakpointState,
  type Debuggee,
  DebuggerSession,
  type DebugIdentity,
  type DebugListenResult,
  type DebugReleaseResult,
  type DebugStackFrame,
  type DebugStepMethod,
  type DebugVariable,
  debuggerErrorSubType,
  debuggerErrorText,
  deleteBreakpoint,
  endSession,
  findListenerConflict,
  listenForDebuggee,
  openSessionOnServer,
  openSessionsAhead,
  type PinnedSession,
  type SessionsAhead,
  stopListener,
  syncBreakpoints,
} from '../adt/debugger.js';
import { runUnitTests } from '../adt/devtools.js';
import { assertODataPerfUrl } from '../adt/diagnostics.js';
import { AdtApiError } from '../adt/errors.js';
import { mapSapReleaseToAbaplintVersion } from '../adt/features.js';
import type { AdtHttpClient } from '../adt/http.js';
import { checkDebug, checkOperation, OperationType } from '../adt/safety.js';
import { getSessionUser, isPlausibleSapUser } from '../adt/session-user.js';
import { extractMethod } from '../context/method-surgery.js';
import { getCachedFeatures } from './feature-cache.js';
import { detectLocalHandlerInclude, normalizeObjectType, objectUrlForType } from './object-types.js';
import { errorResult, type ToolResult, textResult, toolJson } from './shared.js';

const DEFAULT_TIMEOUT_SECONDS = 60;
/** `line`: SAP refuses lines without a statement, so probe the next few lines too. */
const LINE_PROBE = 5;
/** `method`: probe from the METHOD statement to the first line SAP accepts. */
const METHOD_PROBE = 16;
const MAX_FRAME_VARIABLES = 60;
const MAX_EXPANDED_STRUCTURES = 20;
const MAX_EXPANDED_TABLES = 5;
const MAX_COMPONENTS = 30;
const MAX_TABLE_ROWS = 5;
const MAX_VALUE_CHARS = 500;
const MAX_STACK_FRAMES = 15;
/** Stops recorded in one run (all breakpoints, all hits) and steps across them: what one result can
 *  carry, and how long a suspended run is held. Hitting either ends the capture, not the program. */
const MAX_STOPS = 10;
const MAX_TOTAL_STEPS = 40;
/** Attach + reads + steps + continues once the debuggee is caught. */
const INSPECTION_BUDGET_MS = 120_000;
/** Own budget for the release, so an exhausted inspection can never leave a debuggee suspended. */
const RELEASE_BUDGET_MS = 60_000;
/** Opening the sessions ahead of the run (a few cheap requests). */
const AHEAD_BUDGET_MS = 20_000;
const CLASS_INCLUDES = new Set(['implementations', 'testclasses']);

const timings = {
  /** Head start for the long poll: SAP must register the listener before the trigger reaches the line. */
  armDelayMs: 1500,
  /** How long the capture still waits for the trigger's own answer after the release. */
  triggerSettleMs: 30_000,
  /** A further step or `stepContinue` starts only with this much of the inspection budget left. */
  continueMarginMs: 15_000,
};

/** Override the capture's fixed delays and margins in unit tests. */
export function setDebugTimingsForTests(overrides: Partial<typeof timings>): void {
  Object.assign(timings, overrides);
}

/** Captures in flight in this process, by SAP user: one at a time per user, `maxParallelCaptures` in all. */
const activeCaptures = new Set<string>();

class DebugInputError extends Error {}

type DebugTrigger = 'unittest' | 'http' | 'none';
type StepMode = 'over' | 'into' | 'out';

const STEP_METHODS: Record<StepMode, DebugStepMethod> = { over: 'stepOver', into: 'stepInto', out: 'stepReturn' };

/** One line or method breakpoint. */
interface BreakpointLocation {
  type: string;
  name: string;
  line?: number;
  method?: string;
  include?: string;
  /** How many times it may stop the run (a loop). */
  hits: number;
}

interface DebugRequest {
  type: string;
  name: string;
  /** The top-level line first, then `breakpoints`: all armed for the same run. */
  locations: BreakpointLocation[];
  exceptionClass?: string;
  trigger: DebugTrigger;
  triggerName?: string;
  url?: string;
  variables: string[];
  /** Steps after each stop. */
  steps: number;
  stepMode: StepMode;
  timeoutSeconds: number;
}

const trimmed = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/** A line/method breakpoint from the top-level `line` or a `breakpoints` item (type/name default to the top level). */
function readLocation(raw: Record<string, unknown>, type: string, name: string): BreakpointLocation | undefined {
  const line = typeof raw.line === 'number' ? raw.line : undefined;
  const method = trimmed(raw.method);
  if (line === undefined && method === undefined) return undefined;
  const include = trimmed(raw.include)?.toLowerCase();
  const ownType = trimmed(raw.type);
  return {
    type: ownType ? normalizeObjectType(ownType) : type,
    name: (trimmed(raw.name) ?? name).toUpperCase(),
    ...(line !== undefined ? { line } : {}),
    ...(method ? { method } : {}),
    ...(include ? { include } : {}),
    hits: typeof raw.hits === 'number' ? raw.hits : 1,
  };
}

function readRequest(args: Record<string, unknown>, type: string, name: string): DebugRequest {
  const str = (key: string): string | undefined => trimmed(args[key]);
  const variables = Array.isArray(args.variables)
    ? (args.variables as unknown[]).map((v) => String(v).trim().toUpperCase()).filter(Boolean)
    : [];
  const top = name.trim().toUpperCase();
  const extra = Array.isArray(args.breakpoints) ? (args.breakpoints as unknown[]) : [];
  const locations = [args, ...extra].flatMap((raw) => {
    const location =
      raw && typeof raw === 'object' ? readLocation(raw as Record<string, unknown>, type, top) : undefined;
    return location ? [location] : [];
  });
  return {
    type,
    name: top,
    locations,
    ...(str('exceptionClass') ? { exceptionClass: str('exceptionClass')?.toUpperCase() } : {}),
    trigger: (str('trigger') as DebugTrigger | undefined) ?? 'unittest',
    ...(str('triggerName') ? { triggerName: str('triggerName')?.toUpperCase() } : {}),
    ...(str('url') ? { url: str('url') } : {}),
    variables: [...new Set(variables)],
    steps: typeof args.steps === 'number' ? args.steps : 0,
    stepMode: (str('stepMode') as StepMode | undefined) ?? 'over',
    timeoutSeconds: typeof args.timeoutSeconds === 'number' ? args.timeoutSeconds : DEFAULT_TIMEOUT_SECONDS,
  };
}

/**
 * The SAP user to debug: the session's own logon user, never a caller-supplied one. SAP names it
 * first, inside this very session (systeminformation): under principal propagation that is the
 * MCP user's own propagated SAP user. Where the release lacks that resource (SAP_BASIS 7.50 and
 * older) only identities that ARE the logon user count: SAP_USER behind Basic auth or operator
 * cookies, or the internal user a cloud create taught ARC-1, never a JWT display name. An empty or
 * wrong `requestUser` makes SAP's listener match nothing (or someone else), so unknown means refuse.
 */
export async function resolveDebugUser(client: AdtClient): Promise<string | undefined> {
  const fromSap = await getSessionUser(client.http, client.safety);
  if (fromSap) return fromSap;
  const known = ((client.usernameIsLogonUser ? client.username : '') || client.getInternalUser() || '')
    .trim()
    .toUpperCase();
  return isPlausibleSapUser(known) ? known : undefined;
}

/** A capture holds up to two SAP request slots (listener or inspection, plus the trigger), so at most
 *  a quarter of ARC1_MAX_CONCURRENT captures run at once: debugging never takes more than half of
 *  the slots every MCP user of the instance shares. */
export function maxParallelCaptures(slots: number): number {
  return Math.max(1, Math.floor(slots / 4));
}

// ─── Breakpoint location ───────────────────────────────────────────

interface LineTarget {
  /** Source URI the breakpoint fragment `#start=<line>` is appended to. */
  uri: string;
  /** Lines to probe in order. */
  candidates: number[];
  label: string;
}

/** A resolved location and how many times it may stop the run. */
type StopTarget = LineTarget & { hits: number };

function lineRange(from: number, to: number): number[] {
  const lines: number[] = [];
  for (let line = Math.max(1, from); line <= Math.max(from, to); line++) lines.push(line);
  return lines;
}

async function resolveFunctionGroup(client: AdtClient, name: string): Promise<string> {
  const group = await client.resolveFunctionGroup(name);
  if (!group) {
    throw new DebugInputError(
      `Cannot resolve the function group of ${name}. Check the name with SAPSearch("${name}").`,
    );
  }
  return group;
}

async function resolveLineTarget(client: AdtClient, location: BreakpointLocation): Promise<LineTarget> {
  const { type, name, method } = location;
  const encoded = encodeURIComponent(name.toLowerCase());
  if (type === 'CLAS') {
    const include = location.include ?? (method ? detectLocalHandlerInclude(method) : undefined);
    if (include && !CLASS_INCLUDES.has(include)) {
      throw new DebugInputError(`include must be "implementations" or "testclasses" (got "${include}").`);
    }
    const base = `/sap/bc/adt/oo/classes/${encoded}`;
    const uri = include ? `${base}/includes/${include}` : `${base}/source/main`;
    const where = include ? `include "${include}"` : 'the main source';
    if (method !== undefined) {
      // Breakpoints apply to the ACTIVE code — resolve the method against it, never a draft.
      const source = include
        ? (await client.getClassInclude(name, include, { version: 'active' })).source
        : (await client.getClass(name, undefined, { version: 'active' })).source;
      const release = getCachedFeatures()?.abapRelease;
      const found = extractMethod(source, name, method, release ? mapSapReleaseToAbaplintVersion(release) : undefined);
      if (!found.success) {
        throw new DebugInputError(
          `${found.error ?? `Method "${method}" not found.`} Searched ${where} of ${name}; give the breakpoint an include for local classes.`,
        );
      }
      return {
        uri,
        candidates: lineRange(found.startLine, Math.min(found.endLine, found.startLine + METHOD_PROBE - 1)),
        label: `CLAS ${name} method ${method}`,
      };
    }
    const line = location.line as number;
    return {
      uri,
      candidates: lineRange(line, line + LINE_PROBE - 1),
      label: `CLAS ${name} ${where} line ${line}`,
    };
  }
  if (method !== undefined) throw new DebugInputError('method is only supported for type="CLAS"; use line.');
  const line = location.line as number;
  if (type === 'PROG') {
    return {
      uri: `/sap/bc/adt/programs/programs/${encoded}/source/main`,
      candidates: lineRange(line, line + LINE_PROBE - 1),
      label: `PROG ${name} line ${line}`,
    };
  }
  if (type === 'FUNC') {
    const group = await resolveFunctionGroup(client, name);
    return {
      uri: `/sap/bc/adt/functions/groups/${encodeURIComponent(group.toLowerCase())}/fmodules/${encoded}/source/main`,
      candidates: lineRange(line, line + LINE_PROBE - 1),
      label: `FUNC ${name} line ${line}`,
    };
  }
  throw new DebugInputError(`Line breakpoints support type CLAS, PROG or FUNC (got "${type || '(none)'}").`);
}

// ─── Trigger ───────────────────────────────────────────────────────

type TriggerPlan =
  | { kind: 'unittest'; objectUrl: string; label: string }
  | { kind: 'http'; url: string; label: string }
  | { kind: 'none'; label: string };

type TriggerOutcome = { status: 'completed'; result: Record<string, unknown> } | { status: 'failed'; error: string };

/** The ABAP Unit object type of `name` — exact repository match on CLAS, PROG or FUGR. */
async function resolveUnitTestObjectType(client: AdtClient, name: string): Promise<string> {
  const matches = (await client.searchObject(name, 20))
    .filter((result) => result.objectName.toUpperCase() === name)
    .map((result) => result.objectType.split('/')[0] ?? '')
    .filter((type) => ['CLAS', 'PROG', 'FUGR'].includes(type));
  const types = [...new Set(matches)];
  if (types.length === 1) return types[0] as string;
  throw new DebugInputError(
    types.length === 0
      ? `triggerName ${name} is not a class, program or function group this system knows.`
      : `triggerName ${name} is ambiguous (${types.join(', ')}).`,
  );
}

async function planTrigger(client: AdtClient, req: DebugRequest): Promise<TriggerPlan> {
  if (req.trigger === 'none') return { kind: 'none', label: 'none (run it yourself as the same SAP user)' };
  if (req.trigger === 'http') {
    if (!req.url) throw new DebugInputError('trigger="http" needs url (a host-relative OData path).');
    try {
      assertODataPerfUrl(req.url);
    } catch {
      throw new DebugInputError(
        'trigger="http" url must be a host-relative OData path on the connected system — "/sap/opu/odata4/…" or "/sap/opu/odata/sap/<SRV>/…"; absolute URLs and other paths are rejected.',
      );
    }
    checkOperation(client.safety, OperationType.Query, 'DebugTriggerHttp');
    return { kind: 'http', url: req.url, label: `GET ${req.url}` };
  }
  // Without a top-level object, the first breakpoint's object runs its unit tests.
  const object = req.type && req.name ? { type: req.type, name: req.name } : req.locations[0];
  let name = req.triggerName ?? object?.name;
  let type = req.triggerName ? await resolveUnitTestObjectType(client, req.triggerName) : object?.type;
  if (!type || !name) {
    throw new DebugInputError(
      'trigger="unittest" needs the unit-test object: triggerName (a CLAS, PROG or FUGR), or a CLAS/PROG/FUNC breakpoint object.',
    );
  }
  if (type === 'FUNC') {
    name = await resolveFunctionGroup(client, name);
    type = 'FUGR';
  }
  if (!['CLAS', 'PROG', 'FUGR'].includes(type)) {
    throw new DebugInputError(`trigger="unittest" runs ABAP Unit for CLAS, PROG or FUGR (got "${type}").`);
  }
  return { kind: 'unittest', objectUrl: objectUrlForType(type, name), label: `ABAP Unit ${type} ${name}` };
}

interface RunningTrigger {
  settled: Promise<TriggerOutcome>;
}

/** `session`: pinned ahead of the run — the unit tests, and so the debuggee, run on its server. */
function startTrigger(
  client: AdtClient,
  plan: TriggerPlan,
  fetchTimeoutMs: number,
  session?: AdtHttpClient,
): RunningTrigger | undefined {
  const options = { fetchTimeoutMs };
  let run: Promise<Record<string, unknown>>;
  if (plan.kind === 'unittest') {
    run = runUnitTests(session ?? client.http, client.safety, plan.objectUrl, { requestOptions: options }).then(
      (result) => ({
        outcome: result.outcome,
        ...result.summary,
      }),
    );
  } else if (plan.kind === 'http') {
    run = client.http
      .get(plan.url, undefined, options)
      .then((resp) => ({ statusCode: resp.statusCode, responseBytes: Buffer.byteLength(resp.body ?? '') }));
  } else {
    return undefined;
  }
  return {
    settled: run.then(
      (result): TriggerOutcome => ({ status: 'completed', result }),
      (err): TriggerOutcome => ({ status: 'failed', error: err instanceof Error ? err.message : String(err) }),
    ),
  };
}

// ─── Breakpoints ───────────────────────────────────────────────────

/** A breakpoint armed for the run, as each stop is matched against it. */
interface ArmedBreakpoint {
  /** Server id, shared by the external breakpoint and its debug-session copy. */
  id: string;
  label: string;
  kind: 'line' | 'exception';
  /** Line breakpoints: lower-cased source URI + the line SAP armed — how a stop is recognised on the stack. */
  uri?: string;
  line?: number;
  /** Stops it may make before it is retired from the run. */
  maxHits: number;
  /** Its entry in the breakpoints report. */
  reportIndex: number;
}

interface ArmedBreakpoints {
  /** Server ids of every breakpoint ARC-1 left armed — the cleanup list. */
  ids: string[];
  armed: ArmedBreakpoint[];
  report: Array<Record<string, unknown>>;
}

/** `target`: the location's position in the request — two locations may probe the same line numbers. */
const lineClientId = (target: number, line: number): string => `arc1-${target}-line-${line}`;
const EXCEPTION_CLIENT_ID = 'arc1-exception';

const isLineState = (state: DebugBreakpointState): boolean =>
  state.clientId !== EXCEPTION_CLIENT_ID && state.kind !== 'exception';

/**
 * SAP's answer for candidate `line` of target `index`: by the clientId it echoes, else by position —
 * the line alone when only one target was probed (`soleTarget`), as before several were possible.
 */
function stateFor(
  states: DebugBreakpointState[],
  index: number,
  target: LineTarget,
  line: number,
  soleTarget: boolean,
): DebugBreakpointState | undefined {
  return states.find(
    (state) =>
      isLineState(state) &&
      (state.clientId === lineClientId(index, line) ||
        (state.line === line && (soleTarget || (state.uri ?? '').toLowerCase() === target.uri.toLowerCase()))),
  );
}

/** First candidate SAP armed, with the line SAP reports (it may move a breakpoint to the next statement). */
function acceptedLine(
  target: LineTarget,
  index: number,
  states: DebugBreakpointState[],
  soleTarget: boolean,
): { requested: number; line: number } | undefined {
  for (const requested of target.candidates) {
    const state = stateFor(states, index, target, requested, soleTarget);
    if (state?.id) return { requested, line: state.line ?? requested };
  }
  return undefined;
}

/**
 * Arm every line target on the first candidate SAP accepts (one probe POST carrying all candidates,
 * then a second sync keeping one line per target — two targets on the same line arm it once) plus
 * the optional exception breakpoint.
 */
async function armBreakpoints(
  client: AdtClient,
  identity: DebugIdentity,
  targets: readonly StopTarget[],
  exceptionClass: string | undefined,
  armedIds: string[],
): Promise<ArmedBreakpoints> {
  const exceptionSpec: DebugBreakpointSpec[] = exceptionClass
    ? [{ kind: 'exception', clientId: EXCEPTION_CLIENT_ID, exceptionClass }]
    : [];
  const lineSpec = (index: number, line: number): DebugBreakpointSpec => ({
    kind: 'line',
    clientId: lineClientId(index, line),
    uri: targets[index]?.uri ?? '',
    line,
  });
  const remember = (states: DebugBreakpointState[]): DebugBreakpointState[] => {
    armedIds.splice(0, armedIds.length, ...states.flatMap((state) => (state.id ? [state.id] : [])));
    return states;
  };

  const probe = remember(
    await syncBreakpoints(client.http, client.safety, identity, [
      ...targets.flatMap((target, index) => target.candidates.map((line) => lineSpec(index, line))),
      ...exceptionSpec,
    ]),
  );
  const sole = targets.length === 1;
  const accepted = targets.map((target, index) => acceptedLine(target, index, probe, sole));
  const positionKey = (index: number, line: number): string => `${targets[index]?.uri.toLowerCase()}#${line}`;
  /** Position → the first target that armed it. */
  const owner = new Map<string, number>();
  accepted.forEach((hit, index) => {
    if (hit && !owner.has(positionKey(index, hit.line))) owner.set(positionKey(index, hit.line), index);
  });
  let states = probe;
  // The probe may have armed several candidate lines per target — keep exactly one each.
  if (probe.filter((state) => state.id && isLineState(state)).length > owner.size) {
    states = remember(
      await syncBreakpoints(client.http, client.safety, identity, [
        ...[...owner.values()].map((index) => lineSpec(index, accepted[index]?.requested ?? 0)),
        ...exceptionSpec,
      ]),
    );
  }

  const armed: ArmedBreakpoint[] = [];
  const report: Array<Record<string, unknown>> = [];
  targets.forEach((target, index) => {
    const hit = accepted[index];
    const first = hit ? owner.get(positionKey(index, hit.line)) : undefined;
    const state = hit && first === index ? stateFor(states, index, target, hit.requested, sole) : undefined;
    if (hit && first !== undefined && first !== index) {
      report.push({ kind: 'line', location: target.label, status: 'duplicate', of: targets[first]?.label });
    } else if (hit && state?.id) {
      const line = state.line ?? hit.line;
      armed.push({
        id: state.id,
        label: target.label,
        kind: 'line',
        uri: target.uri.toLowerCase(),
        line,
        maxHits: target.hits,
        reportIndex: report.length,
      });
      report.push({ kind: 'line', location: target.label, status: 'set', line, uri: `${target.uri}#start=${line}` });
    } else {
      const refusal = target.candidates
        .map((line) => stateFor(probe, index, target, line, sole)?.error)
        .find((error) => error);
      report.push({
        kind: 'line',
        location: target.label,
        status: 'refused',
        error: state?.error ?? refusal ?? 'SAP did not accept a breakpoint there',
        triedLines: target.candidates,
      });
    }
  });
  if (exceptionClass) {
    const state = states.find(
      (candidate) => candidate.clientId === EXCEPTION_CLIENT_ID || candidate.kind === 'exception',
    );
    if (state?.id) {
      armed.push({
        id: state.id,
        label: `exception ${exceptionClass}`,
        kind: 'exception',
        maxHits: 1,
        reportIndex: report.length,
      });
    }
    report.push(
      state?.id
        ? { kind: 'exception', exceptionClass, status: 'set' }
        : { kind: 'exception', exceptionClass, status: 'refused', error: state?.error ?? 'not accepted by SAP' },
    );
  }
  return { ids: [...armedIds], armed, report };
}

async function disarm(client: AdtClient, identity: DebugIdentity, ids: readonly string[], warnings: string[]) {
  let failed = false;
  for (const id of ids) {
    try {
      await deleteBreakpoint(client.http, client.safety, identity, id);
    } catch {
      failed = true;
    }
  }
  if (!failed) return;
  try {
    await syncBreakpoints(client.http, client.safety, identity, []);
  } catch (err) {
    warnings.push(
      `Could not remove ARC-1's external breakpoints: ${debuggerErrorText(err)} (they expire with the SAP user's debugging session).`,
    );
  }
}

// ─── Inspection ────────────────────────────────────────────────────

interface CapturedVariable {
  name: string;
  scope?: string;
  type?: string;
  kind: string;
  value?: string;
  truncated?: true;
  lines?: number;
  rows?: unknown[];
  components?: Record<string, string>;
  error?: string;
}

function clip(value: string): { value: string; truncated?: true } {
  return value.length > MAX_VALUE_CHARS ? { value: value.slice(0, MAX_VALUE_CHARS), truncated: true } : { value };
}

/** A string keeps its blanks — they count (`CONV string( 124 )` is `'124 '`, `strlen` 4); other kinds lose SAP's padding. */
function shownValue(variable: DebugVariable): string {
  return variable.metaType === 'string' ? variable.value : variable.value.trim();
}

/** One-line rendering for structure components, table rows and step values. */
function compactValue(variable: DebugVariable): string {
  if (variable.metaType === 'table') return `table[${variable.tableLines ?? 0}]`;
  if (variable.metaType === 'structure') return 'structure';
  return clip(shownValue(variable)).value;
}

function describeVariable(variable: DebugVariable, scope?: string): CapturedVariable {
  const type = variable.declaredType || variable.actualType || variable.technicalType;
  const base: CapturedVariable = {
    name: variable.name || variable.id,
    ...(scope ? { scope } : {}),
    ...(type ? { type } : {}),
    kind: variable.metaType || 'unknown',
  };
  if (variable.metaType === 'table') return { ...base, lines: variable.tableLines ?? 0 };
  if (variable.metaType === 'structure') return base;
  const clipped = clip(shownValue(variable));
  return { ...base, value: clipped.value, ...(clipped.truncated || variable.incomplete ? { truncated: true } : {}) };
}

/** Group child-variable rows by the parent each was requested for. */
function childrenByParent(
  response: Awaited<ReturnType<DebuggerSession['childVariables']>>,
): Map<string, DebugVariable[]> {
  const byId = new Map(response.variables.map((variable) => [variable.id, variable]));
  const grouped = new Map<string, DebugVariable[]>();
  for (const row of response.hierarchies) {
    const child = byId.get(row.childId);
    if (!child) continue;
    const list = grouped.get(row.parentId) ?? [];
    list.push(child);
    grouped.set(row.parentId, list);
  }
  return grouped;
}

function componentsOf(children: DebugVariable[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const child of (children ?? []).slice(0, MAX_COMPONENTS)) out[child.name || child.id] = compactValue(child);
  return out;
}

/** Expand structures one level and the first rows of tables — two batched requests, never per variable. */
async function expand(session: DebuggerSession, pairs: Array<{ variable: DebugVariable; out: CapturedVariable }>) {
  const structures = pairs.filter((pair) => pair.variable.metaType === 'structure').slice(0, MAX_EXPANDED_STRUCTURES);
  const tables = pairs
    .filter((pair) => pair.variable.metaType === 'table' && (pair.variable.tableLines ?? 0) > 0)
    .slice(0, MAX_EXPANDED_TABLES);
  if (structures.length > 0) {
    const grouped = childrenByParent(await session.childVariables(structures.map((pair) => pair.variable.id)));
    for (const pair of structures) pair.out.components = componentsOf(grouped.get(pair.variable.id));
  }
  if (tables.length === 0) return;
  const rowIds = tables.flatMap((pair) => {
    const base = pair.variable.id.replace(/\[\]$/, '');
    const count = Math.min(pair.variable.tableLines ?? 0, MAX_TABLE_ROWS);
    return Array.from({ length: count }, (_, index) => `${base}[${index + 1}]`);
  });
  const rows = await session.variables(rowIds);
  const rowById = new Map(rows.map((row) => [row.id.toUpperCase(), row]));
  const structuredRows = rows.filter((row) => row.metaType === 'structure');
  const rowComponents =
    structuredRows.length > 0
      ? childrenByParent(await session.childVariables(structuredRows.map((row) => row.id)))
      : undefined;
  for (const pair of tables) {
    const base = pair.variable.id.replace(/\[\]$/, '');
    const count = Math.min(pair.variable.tableLines ?? 0, MAX_TABLE_ROWS);
    pair.out.rows = Array.from({ length: count }, (_, index) => {
      const row = rowById.get(`${base}[${index + 1}]`.toUpperCase());
      if (!row) return null;
      return row.metaType === 'structure' ? componentsOf(rowComponents?.get(row.id)) : compactValue(row);
    });
  }
}

/** A requested name SAP did not return: the frame read has no such variable. */
const NOT_VISIBLE = 'not visible in the stopped frame';

async function readNamedVariables(session: DebuggerSession, names: readonly string[]): Promise<CapturedVariable[]> {
  let found: DebugVariable[] = [];
  const failures = new Map<string, string>();
  try {
    found = await session.variables(names);
  } catch {
    // One unknown expression can fail the whole batch — retry one by one to say which.
    for (const name of names) {
      try {
        found.push(...(await session.variables([name])));
      } catch (err) {
        failures.set(name, debuggerErrorText(err));
      }
    }
  }
  const pairs: Array<{ variable: DebugVariable; out: CapturedVariable }> = [];
  // SAP echoes the expression as ID; a 1:1 answer can also be matched by position.
  const byPosition = found.length === names.length && failures.size === 0;
  const result = names.map((name, index): CapturedVariable => {
    const variable =
      found.find((candidate) => candidate.id.toUpperCase() === name || candidate.name.toUpperCase() === name) ??
      (byPosition ? found[index] : undefined);
    if (!variable) return { name, kind: 'unknown', error: failures.get(name) ?? NOT_VISIBLE };
    const out = { ...describeVariable(variable), name };
    pairs.push({ variable, out });
    return out;
  });
  await expand(session, pairs);
  return result;
}

/**
 * The stopped frame's variables. Releases differ in what `@ROOT` holds (research dossier §3.4): real
 * variable rows directly, or scope nodes (pseudo ids like `@…`, or children without a variable row
 * of their own) whose children are the variables. Both are read; scopes in one batched request.
 */
async function readFrameVariables(session: DebuggerSession, warnings: string[]): Promise<CapturedVariable[]> {
  const root = await session.childVariables(['@ROOT']);
  const rootVariableIds = new Set(root.variables.map((variable) => variable.id));
  const scopes = root.hierarchies.filter(
    (row) =>
      row.parentId === '@ROOT' && row.childId && (row.childId.startsWith('@') || !rootVariableIds.has(row.childId)),
  );
  const scopeName = new Map(scopes.map((row) => [row.childId, row.childName || row.childId]));
  const rows: Array<{ variable: DebugVariable; scope?: string }> = root.variables
    .filter((variable) => !variable.id.startsWith('@') && !scopeName.has(variable.id))
    .map((variable) => ({ variable }));
  if (scopes.length > 0) {
    const grouped = childrenByParent(await session.childVariables(scopes.map((row) => row.childId)));
    for (const [parentId, children] of grouped) {
      for (const variable of children) rows.push({ variable, scope: scopeName.get(parentId) });
    }
  }
  if (rows.length > MAX_FRAME_VARIABLES) {
    warnings.push(
      `The frame has ${rows.length} variables; the first ${MAX_FRAME_VARIABLES} are shown. Name the ones you need in "variables" to read them in full.`,
    );
  }
  const pairs = rows.slice(0, MAX_FRAME_VARIABLES).map(({ variable, scope }) => ({
    variable,
    out: describeVariable(variable, scope),
  }));
  // Locals: one level of structure components; table rows only when a table is named explicitly.
  await expand(
    session,
    pairs.filter((pair) => pair.variable.metaType === 'structure'),
  );
  return pairs.map((pair) => pair.out);
}

/** A frame's position numbered like SAPRead: its URI's line. Without a URI, the line within `include`. */
function describeFrame(frame: DebugStackFrame): Record<string, unknown> {
  const procedure = [frame.eventType, frame.eventName].filter(Boolean).join(' ');
  const position = frame.uri ? sourcePosition(frame.uri) : undefined;
  const line = position?.line ?? frame.line;
  return {
    ...(procedure ? { procedure } : {}),
    program: frame.program,
    ...(!position && frame.include && frame.include !== frame.program ? { include: frame.include } : {}),
    ...(line !== undefined ? { line } : {}),
    ...(frame.uri ? { uri: frame.uri } : {}),
  };
}

/** Where the debuggee waited, numbered like the stops (its URI's line); without a URI, the line within `include`. */
function debuggeePosition(debuggee: Debuggee): Record<string, unknown> {
  const line = debuggee.uri ? sourcePosition(debuggee.uri)?.line : undefined;
  if (line !== undefined) return { line, uri: debuggee.uri };
  return { include: debuggee.include, ...(debuggee.line !== undefined ? { includeLine: debuggee.line } : {}) };
}

/** The frames worth showing: customer code (system frames counted), at most MAX_STACK_FRAMES. */
function describeStack(stack: DebugStackFrame[]): Record<string, unknown> {
  const visible = stack.filter((frame) => !frame.systemProgram);
  return {
    ...(stack.length > 0 ? { stack: visible.slice(0, MAX_STACK_FRAMES).map(describeFrame) } : {}),
    ...(stack.length > visible.length ? { hiddenSystemFrames: stack.length - visible.length } : {}),
  };
}

/** `/sap/bc/adt/…/source/main#start=9,4` → lower-cased path + line. */
function sourcePosition(uri: string): { uri: string; line: number } | undefined {
  const [path, fragment] = uri.split('#', 2);
  const line = Number(/start=(\d+)/.exec(fragment ?? '')?.[1]);
  return path && Number.isInteger(line) ? { uri: path.toLowerCase(), line } : undefined;
}

/** The armed breakpoint SAP names in `reached`, else the line breakpoint at the top frame's position. */
function armedAt(
  armed: readonly ArmedBreakpoint[],
  reached: readonly string[],
  top: DebugStackFrame | undefined,
): ArmedBreakpoint | undefined {
  for (const id of reached) {
    const named = armed.find((bp) => bp.id === id);
    if (named) return named;
  }
  const position = top?.uri ? sourcePosition(top.uri) : undefined;
  return position
    ? armed.find((bp) => bp.kind === 'line' && bp.uri === position.uri && bp.line === position.line)
    : undefined;
}

/**
 * The breakpoint a stop belongs to: `armedAt`, else the only one armed. Undefined = unknown (a
 * `BREAK-POINT` statement, or SAP said nothing usable).
 */
function breakpointAt(
  armed: readonly ArmedBreakpoint[],
  reached: readonly string[],
  top: DebugStackFrame | undefined,
): ArmedBreakpoint | undefined {
  return armedAt(armed, reached, top) ?? (armed.length === 1 ? armed[0] : undefined);
}

/** The frame the top entry runs in, with the stack depth: a step that changes it entered a call or returned. */
function frameKey(stack: readonly DebugStackFrame[]): string {
  const [top] = stack;
  return top ? [stack.length, top.program, top.include, top.eventType, top.eventName].join('|') : '';
}

type FrameMove = 'entered' | 'returned' | 'changed';

function frameMove(from: readonly DebugStackFrame[], to: readonly DebugStackFrame[]): FrameMove | undefined {
  if (frameKey(from) === frameKey(to)) return undefined;
  if (to.length > from.length) return 'entered';
  return to.length < from.length ? 'returned' : 'changed';
}

const FRAME_MOVE_WARNING =
  'A step with "frame" moved to another method (entered = into a call, returned = back to the caller): its values are read there, so a variable of the same name is a different variable.';

/** A watched variable after a step, as at a stop: its text, a structure's components, or a table's line count and first rows. */
function stepValue(variable: CapturedVariable): string | Record<string, unknown> {
  if (variable.kind === 'structure') return variable.components ?? {};
  if (variable.kind === 'table') {
    const lines = variable.lines ?? 0;
    return variable.rows ? { lines, rows: variable.rows } : `table[${lines}]`;
  }
  return variable.value ?? '';
}

/**
 * The watched variables after a step. A structure or table equal to the previous step's (same frame)
 * reads `unchanged`. A name SAP refuses is left out of the frame's later reads (`refused`), so one
 * bad expression cannot fail every step's batch.
 */
async function readStepValues(
  session: DebuggerSession,
  names: readonly string[],
  refused: Map<string, string>,
  previous: Map<string, string>,
): Promise<Record<string, unknown>> {
  const read = await readNamedVariables(
    session,
    names.filter((name) => !refused.has(name)),
  );
  const values: Record<string, unknown> = {};
  const notVisible: string[] = [];
  for (const variable of read) {
    if (variable.error === NOT_VISIBLE) notVisible.push(variable.name);
    else if (variable.error) refused.set(variable.name, variable.error);
    else {
      const value = stepValue(variable);
      const rendered = typeof value === 'string' ? undefined : JSON.stringify(value);
      values[variable.name] = rendered !== undefined && previous.get(variable.name) === rendered ? 'unchanged' : value;
      if (rendered !== undefined) previous.set(variable.name, rendered);
    }
  }
  return {
    ...(Object.keys(values).length > 0 ? { values } : {}),
    ...(notVisible.length > 0 ? { notVisible } : {}),
    ...(refused.size > 0 ? { errors: Object.fromEntries(refused) } : {}),
  };
}

interface Inspection {
  attached: boolean;
  stops: Array<Record<string, unknown>>;
  /** Stops per armed breakpoint id. */
  hits: Map<string, number>;
  release?: DebugReleaseResult;
  error?: string;
}

interface StepRun {
  steps: Array<Record<string, unknown>>;
  /** The program finished during the steps. */
  ended: boolean;
  steppingPossible: boolean;
  /** A step ran into an armed breakpoint: the run stands at it (`stack`), and the next stop records it. */
  reached?: { id: string; stack: DebugStackFrame[] };
  /** The inspection budget ran low: the capture stops following the run. */
  outOfTime?: true;
}

/** The armed breakpoint a step stopped at (`move`: how the step changed frame), if any. */
type StepReach = (
  reached: readonly string[],
  top: DebugStackFrame | undefined,
  move: FrameMove | undefined,
) => ArmedBreakpoint | undefined;

/**
 * `count` steps of `req.stepMode` from the stop's frame. After each step every requested variable is
 * read again — one not visible at the stop too, as a step can enter the method that declares it. A
 * step that runs into an armed breakpoint (`reach`) ends the steps: the next stop records it.
 */
async function runSteps(
  session: DebuggerSession,
  req: DebugRequest,
  count: number,
  from: { stack: DebugStackFrame[]; refused: Map<string, string> },
  reach: StepReach,
  deadline: number,
  warnings: string[],
): Promise<StepRun> {
  const steps: Array<Record<string, unknown>> = [];
  let frame = from.stack;
  const refused = new Map(from.refused);
  let previous = new Map<string, string>();
  for (let index = 1; index <= count; index++) {
    if (deadline - Date.now() < timings.continueMarginMs) {
      warnings.push(
        `The ${INSPECTION_BUDGET_MS / 1000}s inspection budget ran low after ${index - 1} step(s) of a stop; the rest of the run went on without stopping.`,
      );
      return { steps, ended: false, steppingPossible: true, outOfTime: true };
    }
    const outcome = await session.step(STEP_METHODS[req.stepMode]);
    if (outcome.status === 'ended') {
      steps.push({ step: index, ended: true });
      return { steps, ended: true, steppingPossible: false };
    }
    const stack = await session.stack();
    const move = frameMove(frame, stack);
    const entry: Record<string, unknown> = {
      step: index,
      ...(stack[0] ? describeFrame(stack[0]) : {}),
      ...(move ? { frame: move } : {}),
    };
    steps.push(entry);
    const bp = reach(outcome.reachedBreakpoints, stack[0], move);
    if (bp) {
      entry.breakpoint = bp.label;
      return { steps, ended: false, steppingPossible: outcome.steppingPossible, reached: { id: bp.id, stack } };
    }
    if (move) {
      frame = stack;
      refused.clear();
      previous = new Map();
    }
    if (req.variables.length > 0) {
      if (move) warnings.push(FRAME_MOVE_WARNING);
      try {
        Object.assign(entry, await readStepValues(session, req.variables, refused, previous));
      } catch (err) {
        entry.valuesError = debuggerErrorText(err);
      }
    }
    if (!outcome.steppingPossible) {
      warnings.push(`SAP reports stepping is no longer possible after step ${index}.`);
      return { steps, ended: false, steppingPossible: false };
    }
  }
  return { steps, ended: false, steppingPossible: true };
}

/**
 * Follow ONE run from stop to stop: record each stop (position, the call stack on a breakpoint's
 * first stop, variables, steps), retire a breakpoint from the run once it stopped it `maxHits` times,
 * then `stepContinue` to the next stop — or, when a step ran into a breakpoint, record that stop
 * where the run already stands. Ends when no armed breakpoint is left, the program ends, or a cap is
 * reached — the release then lets the rest of the run go on without stopping.
 */
async function collectStops(
  session: DebuggerSession,
  req: DebugRequest,
  armed: readonly ArmedBreakpoint[],
  first: { reachedBreakpoints: string[]; steppingPossible: boolean; single: boolean },
  inspection: Inspection,
  deadline: number,
  warnings: string[],
): Promise<void> {
  const remaining = new Set(armed.map((bp) => bp.id));
  const stackShown = new Set<string>();
  let { reachedBreakpoints, steppingPossible } = first;
  /** The stack a step already read where it ran into a breakpoint: the next stop's. */
  let reachedStack: DebugStackFrame[] | undefined;
  let stepsLeft = MAX_TOTAL_STEPS;
  // Back in a caller the top frame stands on the call it returned from, already passed: only SAP's word counts.
  const reach: StepReach = (reached, top, move) =>
    armedAt(
      armed.filter((bp) => remaining.has(bp.id)),
      reached,
      move === 'returned' ? undefined : top,
    );
  for (;;) {
    const stack = reachedStack ?? (await session.stack());
    reachedStack = undefined;
    const at = breakpointAt(armed, reachedBreakpoints, stack[0]);
    const hits = at ? (inspection.hits.get(at.id) ?? 0) + 1 : 0;
    if (at) inspection.hits.set(at.id, hits);
    const stop: Record<string, unknown> = {
      stop: inspection.stops.length + 1,
      ...(at ? { at: at.label } : {}),
      ...(at && at.maxHits > 1 ? { hit: hits } : {}),
      ...(stack[0] ? { stoppedAt: describeFrame(stack[0]) } : {}),
      // The call stack once per breakpoint: a loop's later stops would only repeat it.
      ...(!at || !stackShown.has(at.id) ? describeStack(stack) : {}),
    };
    if (at) stackShown.add(at.id);
    inspection.stops.push(stop);
    const willStep = req.steps > 0 && steppingPossible && stepsLeft > 0;
    // A post-mortem session is inspection only: nothing to follow, nothing to retire.
    let following = !first.single;
    // Retire a breakpoint that made its hits before the steps, so neither they nor the run stop there again.
    if (following && at && hits >= at.maxHits && remaining.delete(at.id) && (remaining.size > 0 || willStep)) {
      try {
        await session.removeBreakpoint(at.id);
      } catch (err) {
        warnings.push(
          `Could not keep ${at.label} from stopping the run again (${debuggerErrorText(err)}); no further stops were recorded.`,
        );
        following = false;
      }
    }
    const variables =
      req.variables.length > 0
        ? await readNamedVariables(session, req.variables)
        : await readFrameVariables(session, warnings);
    stop.variables = variables;
    let run: StepRun | undefined;
    if (req.steps > 0) {
      if (!steppingPossible) {
        warnings.push(`SAP reports stepping is not possible at stop ${stop.stop}; its steps were skipped.`);
      } else if (stepsLeft <= 0) {
        warnings.push(`A capture records at most ${MAX_TOTAL_STEPS} steps; stop ${stop.stop} has none.`);
      } else {
        const refused = new Map(
          variables.flatMap((variable) =>
            variable.error && variable.error !== NOT_VISIBLE ? [[variable.name, variable.error] as const] : [],
          ),
        );
        run = await runSteps(
          session,
          req,
          Math.min(req.steps, stepsLeft),
          { stack, refused },
          reach,
          deadline,
          warnings,
        );
        stepsLeft -= run.steps.length;
        if (run.steps.length > 0) stop.steps = run.steps;
        if (run.ended) {
          inspection.release = { released: true, via: 'continue' };
          return;
        }
        if (run.outOfTime || (!run.reached && !run.steppingPossible)) return;
      }
    }
    if (!following) return;
    if (!run?.reached && remaining.size === 0) return;
    if (inspection.stops.length >= MAX_STOPS) {
      warnings.push(`A capture records at most ${MAX_STOPS} stops; the rest of the run went on without stopping.`);
      return;
    }
    if (deadline - Date.now() < timings.continueMarginMs) {
      warnings.push(
        `The ${INSPECTION_BUDGET_MS / 1000}s inspection budget ran out after ${inspection.stops.length} stop(s); the rest of the run went on without stopping.`,
      );
      return;
    }
    if (run?.reached) {
      // A step ran into the next stop: the run already stands there.
      reachedBreakpoints = [run.reached.id];
      reachedStack = run.reached.stack;
      steppingPossible = run.steppingPossible;
      continue;
    }
    const next = await session.step('stepContinue');
    if (next.status === 'ended') {
      inspection.release = { released: true, via: 'continue' };
      return;
    }
    ({ reachedBreakpoints, steppingPossible } = next);
  }
}

/**
 * A refusal SAP answered leaves nothing attached — a 4xx, or its "cannot attach" exception
 * (`invalidDebuggee`, sent as a 500); a transport failure leaves the state unknown.
 */
function attachDefinitelyFailed(err: unknown): boolean {
  if (!(err instanceof AdtApiError)) return false;
  return (err.statusCode >= 400 && err.statusCode < 500) || debuggerErrorSubType(err) === 'invalidDebuggee';
}

async function inspect(
  client: AdtClient,
  identity: DebugIdentity,
  debuggee: Debuggee,
  req: DebugRequest,
  armed: ArmedBreakpoints,
  onAttached: () => Promise<void>,
  warnings: string[],
  ready: AdtHttpClient | undefined,
): Promise<Inspection> {
  const inspection: Inspection = { attached: false, stops: [], hits: new Map() };
  if (debuggee.attachImpossible) {
    if (ready) await endSession(ready, client.safety, { deadline: Date.now() + RELEASE_BUDGET_MS });
    return {
      ...inspection,
      error:
        'SAP reports this debuggee cannot be attached (IS_ATTACH_IMPOSSIBLE), e.g. it runs on another application server.',
    };
  }
  const deadline = Date.now() + INSPECTION_BUDGET_MS;
  let pinned: PinnedSession;
  try {
    pinned = ready
      ? { http: ready, instance: debuggee.instance, probes: 0 }
      : await openSessionOnServer(client.http, client.safety, debuggee.instance, { deadline });
  } catch (err) {
    return { ...inspection, error: `Could not open a debugger session: ${debuggerErrorText(err)}` };
  }
  const sessionHttp = pinned.http;
  const session = new DebuggerSession(sessionHttp, client.safety, identity, { deadline });
  let attachState: 'none' | 'attached' | 'unknown' = 'unknown';
  try {
    const attach = await session.attach(debuggee.id);
    attachState = 'attached';
    inspection.attached = true;
    if (attach.postMortem) warnings.push('SAP attached a post-mortem (short dump) session — inspection only.');
    await onAttached();
    await collectStops(
      session,
      req,
      armed.armed,
      {
        reachedBreakpoints: attach.reachedBreakpoints.map((bp) => bp.id).filter(Boolean),
        steppingPossible: attach.steppingPossible,
        single: attach.postMortem,
      },
      inspection,
      deadline,
      warnings,
    );
  } catch (err) {
    if (attachState === 'unknown' && attachDefinitelyFailed(err)) attachState = 'none';
    const subType = debuggerErrorSubType(err);
    inspection.error = `${debuggerErrorText(err)}${subType ? ` (${subType})` : ''}`;
    if (subType === 'noSessionAttached') {
      inspection.error +=
        ' — the attach did not survive into the next request. Releases below 7.51 need the stateful-session support ADT writes also need (see issue #293).';
    }
    const elsewhere =
      pinned.instance && debuggee.instance && pinned.instance.toUpperCase() !== debuggee.instance.toUpperCase();
    if (subType === 'invalidDebuggee' && elsewhere) {
      inspection.error += ` — SAP attaches only from the debuggee's application server (${debuggee.instance}), and none of ${pinned.probes} new sessions landed there (the last on ${pinned.instance}): while a debuggee waits, SAP's load balancer sends new sessions elsewhere. Retry the capture.`;
    }
  } finally {
    // A run that already ended needs no release.
    if (attachState !== 'none' && !inspection.release) {
      const releaser = new DebuggerSession(sessionHttp, client.safety, identity, {
        deadline: Date.now() + RELEASE_BUDGET_MS,
      });
      inspection.release = await releaser.release(armed.ids);
    }
    // A debuggee that could not be released keeps its debugger session; any other ends here.
    if (attachState === 'none' || inspection.release?.released) {
      await endSession(sessionHttp, client.safety, { deadline: Date.now() + RELEASE_BUDGET_MS });
    }
  }
  return inspection;
}

// ─── Capture ───────────────────────────────────────────────────────

type ListenSettled = DebugListenResult | { status: 'error'; error: unknown };

function notHitHint(req: DebugRequest, user: string, triggerFinished: boolean, triggerFailed: boolean): string {
  if (triggerFailed) {
    return req.trigger === 'http'
      ? 'The trigger request itself failed (trigger.error), so nothing ran to the breakpoint. Make that call work on its own first — SAPDiagnose action="odata_perf" with the same url shows its status. A service published moments ago can answer 403 "blocked by UCON" for a few minutes (seen on the BTP ABAP Environment).'
      : 'The trigger itself failed (trigger.error), so nothing ran to the breakpoint. Make it run on its own first (SAPDiagnose action="unittest").';
  }
  const race =
    ' If the line is certainly executed, retry once: the run may have reached it before SAP registered the listener. Right after an activation, wait about a minute first: with several application servers, the new version may not yet have reached the one that ran the code.';
  if (triggerFinished && req.trigger === 'unittest') {
    return `The unit tests finished without reaching the breakpoint — check that a harmless test covers this code (SAPDiagnose action="unittest" coverage=true lists methodsBelowFull), or use trigger="http" / trigger="none".${race}`;
  }
  if (triggerFinished) return `The trigger finished without reaching the breakpoint.${race}`;
  return `Nothing stopped within ${req.timeoutSeconds}s. With trigger="none", run the code as SAP user ${user} (the same user) while the capture waits — e.g. open the Fiori app or run the report — and retry.`;
}

/**
 * Sessions opened before the run (see `openSessionsAhead`). Only ARC-1's unit-test trigger can run on
 * one; for the others the pair's second session is ended at once. A failure only costs the pinning.
 */
async function openAhead(client: AdtClient, plan: TriggerPlan, warnings: string[]): Promise<SessionsAhead> {
  let ahead: SessionsAhead;
  try {
    ahead = await openSessionsAhead(client.http, client.safety, { deadline: Date.now() + AHEAD_BUDGET_MS });
  } catch (err) {
    warnings.push(
      `Could not open debugger sessions ahead of the run (${debuggerErrorText(err)}); the attach looks for the debuggee's server after the stop instead.`,
    );
    return { byServer: new Map() };
  }
  if (ahead.trigger && plan.kind !== 'unittest') {
    await endSession(ahead.trigger, client.safety, { deadline: Date.now() + AHEAD_BUDGET_MS });
    return { byServer: ahead.byServer };
  }
  return ahead;
}

async function runCapture(client: AdtClient, req: DebugRequest, user: string): Promise<ToolResult> {
  const identity = createDebugIdentity(user);
  const warnings: string[] = [];
  // Everything that can fail on input is resolved BEFORE any debugger state exists on SAP.
  const targets: StopTarget[] = [];
  for (const location of req.locations) {
    targets.push({ ...(await resolveLineTarget(client, location)), hits: location.hits });
  }
  if (targets.length === 0 && !req.exceptionClass) {
    throw new DebugInputError(
      'Give a breakpoint: breakpoints (line or CLAS method each), line (with type + name), and/or exceptionClass.',
    );
  }
  const plan = await planTrigger(client, req);

  const conflict = await findListenerConflict(client.http, client.safety, identity);
  if (conflict) {
    return errorResult(
      `Another debugger is already listening for SAP user ${user}: ${conflict}. ARC-1 never takes over an active debug session (Eclipse, VS Code or another capture) — stop that session first.`,
    );
  }

  const armedIds: string[] = [];
  let ahead: SessionsAhead = { byServer: new Map() };
  let attachedFrom: AdtHttpClient | undefined;
  let listenerStarted = false;
  let externalCleared = false;
  let tornDown = false;
  let running: RunningTrigger | undefined;
  const listenAbort = new AbortController();
  const clearExternal = async () => {
    if (externalCleared) return;
    externalCleared = true;
    await disarm(client, identity, armedIds, warnings);
  };
  // Idempotent: runs before the result is built (so its warnings are reported) and again in finally.
  const teardown = async () => {
    if (tornDown) return;
    tornDown = true;
    listenAbort.abort();
    await clearExternal();
    for (const session of ahead.byServer.values()) {
      if (session !== attachedFrom)
        await endSession(session, client.safety, { deadline: Date.now() + RELEASE_BUDGET_MS });
    }
    if (!listenerStarted) return;
    try {
      await stopListener(client.http, client.safety, identity.user);
    } catch (err) {
      warnings.push(`Could not remove the debugger listener for ${identity.user}: ${debuggerErrorText(err)}.`);
    }
  };
  const settleTrigger = async (): Promise<Record<string, unknown> | undefined> => {
    if (!running) return undefined;
    const settled = await Promise.race([running.settled, sleep(timings.triggerSettleMs).then(() => undefined)]);
    // The trigger's session ends with its run; a run still going keeps it until SAP's session timeout.
    if (settled && ahead.trigger)
      await endSession(ahead.trigger, client.safety, { deadline: Date.now() + RELEASE_BUDGET_MS });
    return settled ?? { status: 'running', note: 'still running when the capture returned' };
  };

  try {
    const armed = await armBreakpoints(client, identity, targets, req.exceptionClass, armedIds);
    if (armed.ids.length === 0) {
      return errorResult(
        toolJson({ hit: false, error: 'SAP refused every breakpoint — nothing was armed.', breakpoints: armed.report }),
      );
    }

    ahead = await openAhead(client, plan, warnings);
    listenerStarted = true;
    const listen: Promise<ListenSettled> = listenForDebuggee(client.http, client.safety, identity, req.timeoutSeconds, {
      signal: listenAbort.signal,
    }).catch((error: unknown) => ({ status: 'error' as const, error }));

    if (plan.kind !== 'none') {
      await sleep(timings.armDelayMs);
      running = startTrigger(
        client,
        plan,
        req.timeoutSeconds * 1000 + INSPECTION_BUDGET_MS + RELEASE_BUDGET_MS,
        ahead.trigger,
      );
    }
    const first = await Promise.race([
      listen.then((outcome) => ({ source: 'listener' as const, outcome })),
      ...(running ? [running.settled.then((outcome) => ({ source: 'trigger' as const, outcome }))] : []),
    ]);
    // A suspended run cannot finish: a trigger that settles first ran without stopping — end the poll.
    const triggerFinished = first.source === 'trigger';
    if (triggerFinished) listenAbort.abort();
    const outcome: ListenSettled = first.source === 'listener' ? first.outcome : await listen;
    // Where ARC-1's own run went (pinned ahead of it): the server the debuggee stops on.
    const triggerServer = running && ahead.trigger ? contextServer(ahead.trigger.sessionContextId) : undefined;
    const base = {
      user,
      breakpoints: armed.report,
      trigger: { kind: plan.kind, target: plan.label, ...(triggerServer ? { server: triggerServer } : {}) },
    };

    if (outcome.status !== 'caught') {
      await teardown();
      const triggerOutcome = await settleTrigger();
      const triggerFailure =
        first.source === 'trigger' && first.outcome.status === 'failed' ? first.outcome : undefined;
      const reason =
        outcome.status === 'conflict'
          ? `conflict: ${outcome.message}`
          : triggerFailure
            ? `trigger failed: ${triggerFailure.error}`
            : triggerFinished
              ? 'trigger finished without reaching the breakpoint'
              : outcome.status === 'error'
                ? `listener failed: ${debuggerErrorText(outcome.error)}`
                : 'timeout';
      return textResult(
        toolJson({
          hit: false,
          reason,
          ...base,
          trigger: { ...base.trigger, ...(triggerOutcome ?? {}) },
          ...(warnings.length > 0 ? { warnings } : {}),
          hint: notHitHint(req, user, triggerFinished, triggerFailure !== undefined),
        }),
      );
    }

    const { debuggee } = outcome;
    attachedFrom = debuggee.instance ? ahead.byServer.get(debuggee.instance.toUpperCase()) : undefined;
    const inspection = await inspect(client, identity, debuggee, req, armed, clearExternal, warnings, attachedFrom);
    await teardown();
    const triggerOutcome = await settleTrigger();
    if (inspection.release && !inspection.release.released) {
      warnings.push(
        `The debuggee could not be released (${inspection.release.detail ?? 'unknown'}); it stays suspended until SAP's debugger timeout ends its session.`,
      );
    }
    // How often each breakpoint stopped the run (0 = the run never reached it while ARC-1 followed it).
    const breakpoints = armed.report.map((entry) => ({ ...entry }));
    if (inspection.attached) {
      for (const bp of armed.armed) {
        const entry = breakpoints[bp.reportIndex];
        if (entry) entry.hits = inspection.hits.get(bp.id) ?? 0;
      }
    }
    return textResult(
      toolJson({
        hit: true,
        ...base,
        breakpoints,
        debuggee: {
          user: debuggee.user,
          program: debuggee.program,
          ...debuggeePosition(debuggee),
          ...(debuggee.kind ? { kind: debuggee.kind } : {}),
          ...(debuggee.instance ? { server: debuggee.instance } : {}),
        },
        attached: inspection.attached,
        ...(inspection.stops.length > 0 ? { stops: inspection.stops } : {}),
        ...(inspection.release ? { release: inspection.release } : {}),
        ...(inspection.error ? { error: inspection.error } : {}),
        trigger: { ...base.trigger, ...(triggerOutcome ?? {}) },
        // One warning per kind: every stop of a big frame would repeat the same one.
        ...(warnings.length > 0 ? { warnings: [...new Set(warnings)] } : {}),
      }),
    );
  } finally {
    await teardown();
  }
}

/** Entry point for SAPDiagnose action="debug". */
export async function handleDebugCapture(
  client: AdtClient,
  args: Record<string, unknown>,
  type: string,
  name: string,
): Promise<ToolResult> {
  checkDebug(client.safety, 'DebugCapture');
  const semaphore = client.http.semaphore;
  if (semaphore && semaphore.max < 2) {
    return errorResult(
      `A debug capture holds one SAP request open (the listener) while the trigger runs, so it needs ARC1_MAX_CONCURRENT >= 2 (currently ${semaphore.max}).`,
    );
  }
  const user = await resolveDebugUser(client);
  if (!user) {
    return errorResult(
      "Cannot tell which SAP user this session runs as, and SAP's debugger needs that logon user (requestUser) to catch anything. SAP did not name it (/sap/bc/adt/core/http/systeminformation is missing on SAP_BASIS 7.50 and older); there, only SAP_USER with Basic or cookie auth identifies it — under principal propagation ARC-1 refuses rather than guess from the token.",
    );
  }
  // From here to activeCaptures.add() nothing awaits, so the checks and the claim are atomic.
  if (activeCaptures.has(user)) {
    return errorResult(
      `A debug capture for SAP user ${user} is already running on this ARC-1 instance — wait for it to finish.`,
    );
  }
  const limit = semaphore ? maxParallelCaptures(semaphore.max) : Number.POSITIVE_INFINITY;
  if (activeCaptures.size >= limit) {
    return errorResult(
      `Debugging is at its limit on this ARC-1 instance (${activeCaptures.size} capture(s) running; at most ${limit}, a quarter of ARC1_MAX_CONCURRENT=${semaphore?.max}, so debugging never holds more than half of the SAP request slots everyone shares) — retry when one finishes.`,
    );
  }
  activeCaptures.add(user);
  try {
    return await runCapture(client, readRequest(args, type, name), user);
  } catch (err) {
    if (err instanceof DebugInputError) return errorResult(err.message);
    throw err;
  } finally {
    activeCaptures.delete(user);
  }
}
