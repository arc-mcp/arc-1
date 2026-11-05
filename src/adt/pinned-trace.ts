/**
 * Native profiler-request and ST05 adapters for pinned PP routes. Trace resources have no repository
 * owner: package lists never authorize them, and the mapped SAP user's native authorization decides.
 * A profiler request names one exact SAP user and the route's client; ST05 is an application-server
 * state that can cover other clients, so this adapter never claims client or own-user isolation.
 */
import { XMLValidator } from 'fast-xml-parser';
import { DataResponseBudget } from './data-result-context.js';
import {
  parseSqlTraceState,
  parseTraceRequestFeed,
  type SqlTraceInstance,
  ST05_STATE_CONTENT_TYPE,
  ST05_STATE_URL,
} from './diagnostics.js';
import { AdtApiError, AdtSafetyError, hasControlCharacter, isDefiniteNativeRejection } from './errors.js';
import type { AdtHttpClient, AdtRequestOptions, AdtResponse } from './http.js';
import { throwIfRequestCancelled } from './http-deadline.js';
import { assertMutationContext, type PinnedMutationContext } from './mutation-context.js';
import { mutationHttp } from './mutation-http.js';
import { strongEtag } from './pinned-formatter.js';
import { st05NativeState } from './pinned-st05-state.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import {
  buildTraceParametersXml,
  buildTraceRequestQuery,
  decodeTraceRequestPath,
  TRACE_BASE,
  TRACE_PROCESS_OBJECTS,
  traceObjectTypeUri,
  traceProcessTypeUri,
  traceRequestPath,
} from './trace-requests.js';
import type { TracedObjectType, TracedProcessType, TraceRequest } from './types.js';
import { escapeXmlAttr, findDeepNodes, parseXml } from './xml-parser.js';

export const PINNED_TRACE_MAX_EXECUTIONS = 100;
export const PINNED_TRACE_MAX_EXPIRY_HOURS = 24;
const MAX_DESCRIPTION = 120;
// One exact XUBNAME. Wildcards, patterns and IdP e-mail names never reach a native filter.
const EXACT_SAP_USER = /^[A-Z0-9][A-Z0-9_.@&-]{0,11}$/;
const TRACE_STATE_NAMESPACE = 'http://www.sap.com/adt/tools/performance/tracestate';
const REQUEST_FEED_LIMIT = 1024 * 1024;
const ST05_DOCUMENT_LIMIT = 256 * 1024;
// Live 758 evidence: an http request armed for the connected user is consumed by that user's next ADT call.
const CONSUMED_BY_OWN_HTTP: readonly TracedProcessType[] = ['http', 'any'];

function exactSapUser(value: unknown, field: string): string {
  const user = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!EXACT_SAP_USER.test(user))
    throw new AdtSafetyError(
      `${field} must be one exact SAP user name of at most 12 characters; wildcards, patterns and IdP e-mail names are refused.`,
    );
  return user;
}

export interface PinnedTraceStartPlan {
  traceUser: string;
  processType: TracedProcessType;
  objectType: TracedObjectType;
  maxExecutions: number;
  expiresHours: number;
  sqlTrace: boolean;
  aggregate: boolean;
  description: string;
}

/** Pure input contract shared by capability admission and the adapter, on Zod-normalized values. */
export function parsePinnedTraceStart(args: Record<string, unknown>): PinnedTraceStartPlan {
  const traceUser = exactSapUser(args.traceUser, 'traceUser');
  const processType = (args.processType ?? 'http') as TracedProcessType;
  if (typeof processType !== 'string' || !Object.hasOwn(TRACE_PROCESS_OBJECTS, processType))
    throw new AdtSafetyError('Unsupported trace processType.');
  const valid = TRACE_PROCESS_OBJECTS[processType];
  const objectType = (args.objectType ?? valid[0]) as TracedObjectType;
  if (!valid.includes(objectType))
    throw new AdtSafetyError(`objectType must be one of ${valid.join(', ')} for processType ${processType}.`);
  const maxExecutions = args.maxExecutions ?? 1;
  if (typeof maxExecutions !== 'number' || !Number.isInteger(maxExecutions))
    throw new AdtSafetyError('maxExecutions must be an integer.');
  if (maxExecutions < 1 || maxExecutions > PINNED_TRACE_MAX_EXECUTIONS)
    throw new AdtSafetyError(`maxExecutions must be between 1 and ${PINNED_TRACE_MAX_EXECUTIONS}.`);
  const expiresHours = args.expiresHours ?? PINNED_TRACE_MAX_EXPIRY_HOURS;
  if (typeof expiresHours !== 'number' || !(expiresHours > 0) || expiresHours > PINNED_TRACE_MAX_EXPIRY_HOURS)
    throw new AdtSafetyError(`expiresHours must be greater than 0 and at most ${PINNED_TRACE_MAX_EXPIRY_HOURS}.`);
  for (const field of ['sqlTrace', 'aggregate'] as const)
    if (args[field] !== undefined && typeof args[field] !== 'boolean')
      throw new AdtSafetyError(`${field} must be a boolean.`);
  const description = args.description ?? `arc-1 ${processType}/${objectType} trace`;
  if (typeof description !== 'string' || description.length > MAX_DESCRIPTION || hasControlCharacter(description))
    throw new AdtSafetyError(`description must be one line of at most ${MAX_DESCRIPTION} characters.`);
  return {
    traceUser,
    processType,
    objectType,
    maxExecutions,
    expiresHours,
    sqlTrace: args.sqlTrace !== false,
    aggregate: args.aggregate !== false,
    description,
  };
}

export function parsePinnedTraceCancel(args: Record<string, unknown>): { id: string; traceUser: string } {
  const traceUser = exactSapUser(args.traceUser, 'traceUser');
  if (typeof args.id !== 'string' || /^[a-z][a-z0-9+.-]*:/i.test(args.id.trim()))
    throw new AdtSafetyError('id must be the native request path or id returned by trace_start or trace_requests.');
  try {
    traceRequestPath(args.id);
  } catch (error) {
    throw new AdtSafetyError(error instanceof Error ? error.message : 'Malformed trace-request id.');
  }
  return { id: args.id.trim(), traceUser };
}

/** Omitted or blank never inherits an empty ST05 filter; allUsers stays closed until its native encoding is proven. */
export function parsePinnedSqlTrace(args: Record<string, unknown>): { sqlOn: boolean; user?: string } {
  if (typeof args.sqlOn !== 'boolean') throw new AdtSafetyError('sqlOn must be a boolean.');
  if (args.allUsers !== undefined) {
    if (args.user !== undefined) throw new AdtSafetyError('user and allUsers are mutually exclusive.');
    throw new AdtSafetyError('An all-users ST05 filter is refused until its native representation is qualified.');
  }
  if (!args.sqlOn) {
    if (args.user !== undefined)
      throw new AdtSafetyError('Disarming uses native inactive defaults; an explicit user filter requires sqlOn=true.');
    return { sqlOn: false };
  }
  return { sqlOn: true, user: exactSapUser(args.user, 'user') };
}

function readOptions(limit: number, family: string): AdtRequestOptions {
  return { responseBudget: new DataResponseBudget(limit, family, true) };
}

function failureMessage(error: unknown, fallback: string): string {
  return error instanceof AdtSafetyError ? error.message : fallback;
}

function pinnedContext(safety: SafetyConfig, context: PinnedMutationContext): void {
  assertMutationContext(safety, context);
  if (context.mode !== 'pinned-pp') throw new AdtSafetyError('A pinned mutation context is required.');
}

interface VerifiedRequest extends TraceRequest {
  /** Native `admin` role: who armed it. A second identity's evidence distinguishes it from the traced user. */
  actingUser?: string;
}

/** The legacy parser falls back to any role; here only the explicit native role is evidence for a subject. */
export function requestFeed(xml: string): VerifiedRequest[] {
  const roleValue = (node: unknown, role: string, key: string): string | undefined => {
    const matches = (Array.isArray(node) ? node : node ? [node] : []).filter(
      (entry): entry is Record<string, unknown> =>
        !!entry && typeof entry === 'object' && (entry as Record<string, unknown>)['@_role'] === role,
    );
    const value = matches.length === 1 ? matches[0][key] : undefined;
    return value === undefined || value === null ? undefined : String(value).trim();
  };
  const legacy = parseTraceRequestFeed(xml);
  const entries = findDeepNodes(parseXml(xml), 'entry');
  return legacy.map((request, index) => {
    const entry = entries[index];
    const ext = (entry.extendedData ?? {}) as Record<string, unknown>;
    return {
      ...request,
      user: roleValue(entry.author, 'trace', 'name'),
      client: roleValue(ext.client, 'trace', '#text'),
      actingUser: roleValue(entry.author, 'admin', 'name'),
    };
  });
}

function canonicalRequestTail(id: string): string {
  try {
    return decodeTraceRequestPath(traceRequestPath(id), id).slice(`${TRACE_BASE}/requests/`.length);
  } catch {
    throw new AdtSafetyError('The trace-request id is malformed.');
  }
}

function listRequests(scoped: AdtHttpClient, user: string): Promise<AdtResponse> {
  return scoped.get(
    `${TRACE_BASE}/requests?user=${encodeURIComponent(user)}`,
    { Accept: 'application/atom+xml;type=feed' },
    readOptions(REQUEST_FEED_LIMIT, 'trace-requests'),
  );
}

function parametersLocation(location: string | undefined): string {
  const prefix = `${TRACE_BASE}/parameters/`;
  if (location?.startsWith(prefix) && /^[A-Za-z0-9_%-]+$/.test(location.slice(prefix.length))) return location;
  throw new AdtSafetyError('The native parameters response has no usable parameters location.');
}

export interface PinnedTraceStartOutcome {
  ok: boolean;
  state:
    | 'unchanged'
    | 'parameters-rejected'
    | 'parameters-unconfirmed'
    | 'parameters-orphaned'
    | 'request-unconfirmed'
    | 'armed-unverified'
    | 'armed';
  phase: 'validation' | 'parameters' | 'request' | 'verification' | 'readback';
  retryable: false;
  /** Native selection: all application servers, one exact client and one exact SAP user. */
  scope: { resource: 'profiler-request'; server: '*'; traceClient?: string; traceUser?: string };
  parametersId?: string;
  requestOutcome?: 'not-sent' | 'rejected';
  request?: VerifiedRequest;
  mismatches?: string[];
  readback?: 'confirmed' | 'skipped-would-consume-trace' | 'unavailable' | 'not-listed';
  statusCode?: number;
  message?: string;
  next?: string;
}

function requestMismatches(
  request: VerifiedRequest,
  plan: PinnedTraceStartPlan,
  client: string,
  expires: number,
): string[] {
  const mismatches: string[] = [];
  if (request.user !== plan.traceUser) mismatches.push('traceUser');
  if (request.client !== client) mismatches.push('traceClient');
  if (request.maxExecutions !== plan.maxExecutions) mismatches.push('maxExecutions');
  if (request.processType !== traceProcessTypeUri(plan.processType)) mismatches.push('processType');
  if (request.objectType !== traceObjectTypeUri(plan.objectType)) mismatches.push('objectType');
  const nativeExpiry = Date.parse(request.expires ?? '');
  if (!Number.isFinite(nativeExpiry) || nativeExpiry > expires + 60_000) mismatches.push('expires');
  return mismatches;
}

/** Two native POSTs, each submitted once. A failed second POST does not roll back the first. */
export async function startPinnedProfilerTrace(
  http: AdtHttpClient,
  safety: SafetyConfig,
  context: PinnedMutationContext,
  client: string,
  input: Record<string, unknown>,
): Promise<PinnedTraceStartOutcome> {
  const outcome: PinnedTraceStartOutcome = {
    ok: false,
    state: 'unchanged',
    phase: 'validation',
    retryable: false,
    scope: { resource: 'profiler-request', server: '*' },
  };
  try {
    pinnedContext(safety, context);
    checkOperation(safety, OperationType.Update, 'CreateTraceRequest');
    const plan = parsePinnedTraceStart(input);
    if (!/^\d{3}$/.test(client)) throw new AdtSafetyError('The pinned route has no usable SAP client.');
    outcome.scope = { ...outcome.scope, traceClient: client, traceUser: plan.traceUser };
    const scoped = mutationHttp(http, safety, context);
    outcome.phase = 'parameters';
    throwIfRequestCancelled(context.requestPolicy);
    outcome.state = 'parameters-unconfirmed';
    const parameters = await scoped.post(
      `${TRACE_BASE}/parameters`,
      buildTraceParametersXml(plan),
      'application/xml',
      undefined,
      readOptions(REQUEST_FEED_LIMIT, 'trace-parameters'),
    );
    const parametersId = parametersLocation(parameters.headers.location);
    outcome.parametersId = parametersId;
    outcome.state = 'parameters-orphaned';
    outcome.requestOutcome = 'not-sent';
    outcome.phase = 'request';
    throwIfRequestCancelled(context.requestPolicy);
    checkOperation(safety, OperationType.Update, 'CreateTraceRequest');
    const expires = Date.now() + plan.expiresHours * 3_600_000;
    const query = buildTraceRequestQuery({
      ...plan,
      client,
      expires: new Date(expires).toISOString().replace(/\.\d+Z$/, 'Z'),
      parametersId,
    });
    outcome.state = 'request-unconfirmed';
    outcome.requestOutcome = undefined;
    const response = await scoped.post(
      `${TRACE_BASE}/requests?${query}`,
      '',
      'application/xml',
      undefined,
      readOptions(REQUEST_FEED_LIMIT, 'trace-requests'),
    );
    outcome.phase = 'verification';
    const entries = requestFeed(response.body);
    if (entries.length !== 1 || !entries[0].id)
      throw new AdtSafetyError('The native request response did not identify exactly one request.');
    const request = entries[0];
    canonicalRequestTail(request.id);
    outcome.request = request;
    // A request exists from here on; an unexpected subject is reported, never auto-cancelled or retried.
    outcome.state = 'armed-unverified';
    outcome.mismatches = requestMismatches(request, plan, client, expires);
    if (outcome.mismatches.length) throw new AdtSafetyError('The native request differs from the requested selection.');
    delete outcome.mismatches;
    outcome.phase = 'readback';
    if (
      CONSUMED_BY_OWN_HTTP.includes(plan.processType) &&
      (!request.actingUser || request.actingUser === plan.traceUser)
    ) {
      outcome.readback = 'skipped-would-consume-trace';
    } else {
      outcome.readback = 'unavailable';
      throwIfRequestCancelled(context.requestPolicy);
      const listed = requestFeed((await listRequests(scoped, plan.traceUser)).body);
      const tail = canonicalRequestTail(request.id);
      outcome.readback = listed.some((entry) => canonicalRequestTail(entry.id) === tail) ? 'confirmed' : 'not-listed';
      if (outcome.readback !== 'confirmed') throw new AdtSafetyError('The native request listing omits this request.');
    }
    outcome.ok = true;
    outcome.state = 'armed';
    outcome.next = `Reproduce the workload promptly as ${plan.traceUser}: every matching call by that SAP user consumes an execution, including other ARC-1 calls on this connection. Then read SAPDiagnose(action="traces"). The request stays armed until its executions or expiry are used; stop it with action="trace_cancel".`;
    return outcome;
  } catch (error) {
    if (error instanceof AdtApiError) outcome.statusCode = error.statusCode;
    if (isDefiniteNativeRejection(error) && outcome.phase === 'parameters') outcome.state = 'parameters-rejected';
    if (isDefiniteNativeRejection(error) && outcome.phase === 'request') {
      outcome.state = 'parameters-orphaned';
      outcome.requestOutcome = 'rejected';
    }
    outcome.message = failureMessage(
      error,
      outcome.state === 'unchanged'
        ? 'No trace request was submitted.'
        : 'The trace outcome is not confirmed. Inspect action="trace_requests" with this traceUser before deciding the next action; nothing was retried.',
    );
    return outcome;
  }
}

export interface PinnedTraceCancelOutcome {
  ok: boolean;
  state: 'unchanged' | 'cancel-rejected' | 'cancel-unconfirmed' | 'cancelled';
  phase: 'validation' | 'read' | 'write' | 'readback';
  retryable: false;
  scope: { resource: 'profiler-request'; traceClient?: string; traceUser?: string };
  request?: VerifiedRequest;
  statusCode?: number;
  message?: string;
}

/** DELETE targets only the native entry listed for this exact user and client, never the caller's raw string. */
export async function cancelPinnedProfilerTrace(
  http: AdtHttpClient,
  safety: SafetyConfig,
  context: PinnedMutationContext,
  client: string,
  input: Record<string, unknown>,
): Promise<PinnedTraceCancelOutcome> {
  const outcome: PinnedTraceCancelOutcome = {
    ok: false,
    state: 'unchanged',
    phase: 'validation',
    retryable: false,
    scope: { resource: 'profiler-request' },
  };
  try {
    pinnedContext(safety, context);
    checkOperation(safety, OperationType.Update, 'DeleteTraceRequest');
    const { id, traceUser } = parsePinnedTraceCancel(input);
    outcome.scope = { ...outcome.scope, traceClient: client, traceUser };
    const scoped = mutationHttp(http, safety, context);
    outcome.phase = 'read';
    throwIfRequestCancelled(context.requestPolicy);
    const tail = canonicalRequestTail(id);
    const listed = requestFeed((await listRequests(scoped, traceUser)).body).filter(
      (entry) => canonicalRequestTail(entry.id) === tail,
    );
    if (listed.length !== 1)
      throw new AdtSafetyError('This request is not listed for that SAP user; nothing was sent.');
    const request = listed[0];
    if (request.user !== traceUser || request.client !== client)
      throw new AdtSafetyError('The native request belongs to another SAP user or client; nothing was sent.');
    outcome.request = request;
    checkOperation(safety, OperationType.Update, 'DeleteTraceRequest');
    throwIfRequestCancelled(context.requestPolicy);
    outcome.phase = 'write';
    outcome.state = 'cancel-unconfirmed';
    await scoped.delete(traceRequestPath(request.id));
    outcome.phase = 'readback';
    throwIfRequestCancelled(context.requestPolicy);
    const remaining = requestFeed((await listRequests(scoped, traceUser)).body);
    if (remaining.some((entry) => canonicalRequestTail(entry.id) === tail))
      throw new AdtSafetyError('The native request listing still contains this request.');
    outcome.ok = true;
    outcome.state = 'cancelled';
    return outcome;
  } catch (error) {
    if (error instanceof AdtApiError) outcome.statusCode = error.statusCode;
    if (isDefiniteNativeRejection(error) && outcome.phase === 'write') outcome.state = 'cancel-rejected';
    outcome.message = failureMessage(
      error,
      outcome.state === 'unchanged'
        ? 'No trace cancellation was submitted.'
        : 'The cancellation is not confirmed. Inspect action="trace_requests" with this traceUser; nothing was retried.',
    );
    return outcome;
  }
}

function count(pattern: RegExp, text: string): number {
  return text.match(pattern)?.length ?? 0;
}

const SQL_ON = /<ts:sqlOn>(?:true|false)<\/ts:sqlOn>/g;
const TRACE_USER = /<ts:traceUser\/>|<ts:traceUser>[^<]*<\/ts:traceUser>/g;

/** Unknown document shapes refuse: a skipped traceUser edit would arm an unfiltered trace. */
export function st05Document(response: AdtResponse) {
  const mime = response.headers['content-type']?.split(';')[0].trim().toLowerCase();
  if (mime !== ST05_STATE_CONTENT_TYPE)
    throw new AdtSafetyError('The native ST05 endpoint did not return the qualified v1 representation.');
  const body = response.body;
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(body) || XMLValidator.validate(body) !== true)
    throw new AdtSafetyError('Unknown native ST05 state XML.');
  const root = body.match(/<ts:traceStateInstanceTable\b[^>]*>/)?.[0] ?? '';
  const nodes = findDeepNodes(parseXml(body), 'traceStateInstance');
  const instances = parseSqlTraceState(body);
  const shaped = nodes.every(
    (node) =>
      Object.hasOwn((node.traceTypes ?? {}) as object, 'sqlOn') &&
      Object.hasOwn((node.traceFilter ?? {}) as object, 'traceUser'),
  );
  if (
    !root.includes(`xmlns:ts="${TRACE_STATE_NAMESPACE}"`) ||
    !instances.length ||
    !shaped ||
    new Set(instances.map((instance) => instance.instance)).size !== instances.length ||
    instances.some((instance) => !instance.instance) ||
    count(SQL_ON, body) !== instances.length ||
    count(TRACE_USER, body) !== instances.length
  )
    throw new AdtSafetyError('Unknown native ST05 state XML.');
  const native = st05NativeState(body);
  if (
    native.identities.length !== instances.length ||
    native.identities.some(
      (value, index) =>
        value.instance !== instances[index].instance ||
        value.sqlOn !== instances[index].traceTypes.sql ||
        value.user !== (instances[index].filter.user ?? ''),
    )
  )
    throw new AdtSafetyError('Unknown native ST05 state XML.');
  return { body, instances, ...native };
}

export interface PinnedSqlTraceOutcome {
  ok: boolean;
  state: 'unchanged' | 'updated' | 'update-rejected' | 'update-unconfirmed';
  phase: 'validation' | 'read' | 'write' | 'readback';
  retryable: false;
  /** Native ST05 state spans application-server instances and other clients. */
  scope: { resource: 'st05-application-server-instances'; clientIsolated: false; ownUserOnly: false };
  concurrency?: 'strong-etag' | 'native-unconditional';
  before?: SqlTraceInstance[];
  after?: SqlTraceInstance[];
  statusCode?: number;
  message?: string;
  next?: string;
}

function appliedEverywhere(instances: SqlTraceInstance[], plan: { sqlOn: boolean; user?: string }): boolean {
  return instances.every(
    (instance) =>
      instance.traceTypes.sql === plan.sqlOn && (plan.user === undefined || instance.filter.user === plan.user),
  );
}

function sameInstances(left: SqlTraceInstance[], right: SqlTraceInstance[]): boolean {
  const names = (list: SqlTraceInstance[]) =>
    list
      .map((instance) => instance.instance)
      .sort()
      .join('\n');
  return names(left) === names(right);
}

/** Targeted native edit. OFF resets qualified filter/properties; writes never clear another active trace type. */
export async function setPinnedSqlTraceState(
  http: AdtHttpClient,
  safety: SafetyConfig,
  context: PinnedMutationContext,
  input: Record<string, unknown>,
): Promise<PinnedSqlTraceOutcome> {
  const outcome: PinnedSqlTraceOutcome = {
    ok: false,
    state: 'unchanged',
    phase: 'validation',
    retryable: false,
    scope: { resource: 'st05-application-server-instances', clientIsolated: false, ownUserOnly: false },
  };
  try {
    pinnedContext(safety, context);
    checkOperation(safety, OperationType.Update, 'SetSqlTraceState');
    const plan = parsePinnedSqlTrace(input);
    const scoped = mutationHttp(http, safety, context);
    const options = () => readOptions(ST05_DOCUMENT_LIMIT, 'st05-state');
    outcome.phase = 'read';
    throwIfRequestCancelled(context.requestPolicy);
    const response = await scoped.get(ST05_STATE_URL, { Accept: ST05_STATE_CONTENT_TYPE }, options());
    const current = st05Document(response);
    const etag = strongEtag(response, 'ST05');
    outcome.concurrency = etag ? 'strong-etag' : 'native-unconditional';
    outcome.before = current.instances;
    if (appliedEverywhere(current.instances, plan)) {
      outcome.ok = true;
      outcome.after = current.instances;
      return outcome;
    }
    if (
      plan.sqlOn &&
      current.instances.some(
        (instance) => Object.values(instance.traceTypes).some(Boolean) && instance.filter.user !== plan.user,
      )
    )
      throw new AdtSafetyError(
        'An active ST05 trace uses another filter that this change would replace. Inspect sql_trace_state; disarming it is a separate explicit decision.',
      );
    if (current.identities.some((instance) => instance.otherOn))
      throw new AdtSafetyError(
        'The native ST05 PUT clears non-SQL trace types; an active non-SQL trace prevents this write.',
      );
    const expectedUnrelated = plan.sqlOn ? current.unrelated : current.offUnrelated();
    let body = current.body.replace(SQL_ON, () => `<ts:sqlOn>${plan.sqlOn}</ts:sqlOn>`);
    if (plan.user !== undefined)
      body = body.replace(TRACE_USER, () => `<ts:traceUser>${escapeXmlAttr(plan.user as string)}</ts:traceUser>`);
    // Validate the complete outgoing document before the one allowed submission.
    const prepared = st05Document({ ...response, body });
    if (prepared.unrelated !== current.unrelated || !appliedEverywhere(prepared.instances, plan))
      throw new AdtSafetyError('The prepared ST05 state differs outside the requested fields; nothing was submitted.');
    checkOperation(safety, OperationType.Update, 'SetSqlTraceState');
    throwIfRequestCancelled(context.requestPolicy);
    outcome.phase = 'write';
    outcome.state = 'update-unconfirmed';
    await scoped.put(ST05_STATE_URL, body, ST05_STATE_CONTENT_TYPE, etag ? { 'If-Match': etag } : undefined, options());
    outcome.phase = 'readback';
    throwIfRequestCancelled(context.requestPolicy);
    const readback = st05Document(await scoped.get(ST05_STATE_URL, { Accept: ST05_STATE_CONTENT_TYPE }, options()));
    outcome.after = readback.instances;
    if (!sameInstances(current.instances, readback.instances) || !appliedEverywhere(readback.instances, plan))
      throw new AdtSafetyError('Native ST05 read-back does not show the requested state on every instance.');
    if (
      readback.unrelated !== expectedUnrelated ||
      (!plan.sqlOn && readback.identities.some((instance) => instance.user !== ''))
    )
      throw new AdtSafetyError('Unrelated native ST05 fields changed during the update.');
    outcome.ok = true;
    outcome.state = 'updated';
    outcome.next = plan.sqlOn
      ? 'ST05 stays armed after this call on every listed instance. Reproduce the workload, read SAPDiagnose(action="sql_trace_directory"), then disarm with sqlOn=false.'
      : 'SQL trace is off on every listed instance. Native filters and non-stack properties have their inactive defaults; other fields were verified.';
    return outcome;
  } catch (error) {
    if (error instanceof AdtApiError) outcome.statusCode = error.statusCode;
    if (isDefiniteNativeRejection(error) && outcome.phase === 'write') outcome.state = 'update-rejected';
    const detail = failureMessage(error, '');
    outcome.message = [
      outcome.state === 'unchanged'
        ? 'No ST05 change was submitted.'
        : outcome.state === 'update-rejected'
          ? 'SAP rejected the ST05 change; nothing was retried.'
          : 'The ST05 submission outcome is not confirmed. Read action="sql_trace_state" before deciding the next action; nothing was retried.',
      detail,
    ]
      .filter(Boolean)
      .join(' ');
    return outcome;
  }
}
