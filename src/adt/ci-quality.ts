/**
 * Headless BTP CI quality client for Communication Arrangements
 * `SAP_COM_0901` (ATC Checkstyle) and `SAP_COM_0735` (AUnit JUnit).
 *
 * Distinct from the IDE ADT surfaces in `devtools.ts` (`runAtcCheck` /
 * `runUnitTests`). CSRF is fetched from the dummy-run UUID of the CI API —
 * never from `/sap/bc/adt/core/discovery`. Location/href values are
 * same-origin validated before follow-up GETs.
 */

import { logger } from '../server/logger.js';
import {
  type AtcCiFinding,
  type AtcCiSeverity,
  type AtcCiSummary,
  type AunitCiSummary,
  type AunitCiTest,
  atcFindingsFail,
  aunitResultsFail,
  buildAtcCiRunParametersXml,
  buildAunitCiRunXml,
  type CiObjectSet,
  normalizeCiObjectSet,
  parseAtcCheckstyle,
  parseAtcCiRunStatus,
  parseAunitCiRunStatus,
  parseAunitJunit,
} from './ci-quality-xml.js';
import { AdtApiError } from './errors.js';
import type { AdtHttpClient, AdtResponse } from './http.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';

export const ATC_CI_DUMMY_RUN_ID = '00000000000000000000000000000000';
export const ATC_CI_RUNS_PATH = '/sap/bc/adt/api/atc/runs';
export const ATC_CI_LOCATION_PREFIX = '/sap/bc/adt/api/atc/';
export const AUNIT_CI_RUNS_PATH = '/sap/bc/adt/api/abapunit/runs';
export const AUNIT_CI_LOCATION_PREFIX = '/sap/bc/adt/api/abapunit/';

export const ATC_CI_ACCEPT_RUN = 'application/vnd.sap.atc.run.v1+xml';
export const ATC_CI_CONTENT_TYPE_RUN = 'application/vnd.sap.atc.run.parameters.v1+xml; charset=utf-8;';
export const ATC_CI_ACCEPT_CHECKSTYLE = 'application/vnd.sap.atc.checkstyle.v1+xml';
export const AUNIT_CI_ACCEPT_STATUS = 'application/vnd.sap.adt.api.abapunit.run-status.v1+xml';
export const AUNIT_CI_CONTENT_TYPE_RUN = 'application/vnd.sap.adt.api.abapunit.run.v1+xml; charset=utf-8;';
export const AUNIT_CI_ACCEPT_JUNIT = 'application/vnd.sap.adt.api.junit.run-result.v1+xml';

export const ATC_CI_POLL_INTERVAL_MS = 5_000;
export const AUNIT_CI_POLL_INTERVAL_MS = 10_000;
export const CI_POLL_TIMEOUT_DEFAULT_SECONDS = 600;
export const CI_POLL_TIMEOUT_MIN_SECONDS = 30;
export const CI_POLL_TIMEOUT_MAX_SECONDS = 1_800;

export interface CiQualityClock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export interface CiQualityRunBaseOptions {
  origin: string;
  objectSet: CiObjectSet;
  timeoutSeconds?: number;
  signal?: AbortSignal;
  clock?: CiQualityClock;
}

export interface RunAtcCiOptions extends CiQualityRunBaseOptions {
  variant?: string;
  configuration?: string;
  failOnSeverity?: AtcCiSeverity;
}

export interface RunAunitCiOptions extends CiQualityRunBaseOptions {
  title?: string;
  context?: string;
  ownTests?: boolean;
  foreignTests?: boolean;
  harmless?: boolean;
  dangerous?: boolean;
  critical?: boolean;
  short?: boolean;
  medium?: boolean;
  long?: boolean;
  measurements?: string;
  evaluateResults?: boolean;
}

export interface AtcCiResult {
  status: 'completed';
  durationMs: number;
  fail: boolean;
  summary: AtcCiSummary;
  findings: AtcCiFinding[];
  reportXml: string;
}

export interface AunitCiResult {
  status: 'completed';
  durationMs: number;
  fail: boolean;
  summary: AunitCiSummary;
  tests: AunitCiTest[];
  reportXml: string;
}

const defaultClock: CiQualityClock = {
  now: () => Date.now(),
  sleep: sleepMs,
};

export async function runAtcCiCheck(
  http: AdtHttpClient,
  safety: SafetyConfig,
  options: RunAtcCiOptions,
): Promise<AtcCiResult> {
  checkOperation(safety, OperationType.Read, 'RunAtcCiCheck');
  throwIfAborted(options.signal);
  const objectSet = normalizeCiObjectSet(options.objectSet);
  const origin = resolveOrigin(options.origin);
  const clock = options.clock ?? defaultClock;
  const timeoutSeconds = clampTimeoutSeconds(options.timeoutSeconds);
  const started = clock.now();
  const dummyPath = `${ATC_CI_RUNS_PATH}/${ATC_CI_DUMMY_RUN_ID}`;

  const csrfToken = await fetchCiCsrfToken(http, dummyPath, ATC_CI_ACCEPT_RUN);
  const body = buildAtcCiRunParametersXml(objectSet, {
    variant: options.variant,
    configuration: options.configuration,
  });
  logger.debug('ATC CI run starting', {
    path: `${ATC_CI_RUNS_PATH}?clientWait=false`,
    packageCount: objectSet.packages.length,
    packageTreeCount: objectSet.packageTrees.length,
    softwareComponentCount: objectSet.softwareComponents.length,
  });
  const startResp = await http.post(`${ATC_CI_RUNS_PATH}?clientWait=false`, body, ATC_CI_CONTENT_TYPE_RUN, {
    Accept: ATC_CI_ACCEPT_RUN,
  });
  const pollPath = resolveCiApiLocation(headerValue(startResp.headers, 'location'), origin, ATC_CI_LOCATION_PREFIX);
  const statusDoc = await pollCiRun({
    http,
    pollPath,
    accept: ATC_CI_ACCEPT_RUN,
    origin,
    locationPrefix: ATC_CI_LOCATION_PREFIX,
    intervalMs: ATC_CI_POLL_INTERVAL_MS,
    timeoutSeconds,
    clock,
    signal: options.signal,
    parseStatus: parseAtcCiRunStatus,
    isRunning: isAtcCiRunning,
    isCompleted: (status) => status === 'Completed',
    kind: 'ATC',
  });
  const resultPath = resolveCiApiLocation(statusDoc.resultHref ?? '', origin, ATC_CI_LOCATION_PREFIX);
  const resultResp = await http.get(resultPath, resultHeaders(ATC_CI_ACCEPT_CHECKSTYLE, csrfToken));
  const { findings, summary } = parseAtcCheckstyle(resultResp.body);
  const failOnSeverity = options.failOnSeverity ?? 'error';
  return {
    status: 'completed',
    durationMs: Math.max(0, clock.now() - started),
    fail: atcFindingsFail(findings, failOnSeverity),
    summary,
    findings,
    reportXml: resultResp.body,
  };
}

export async function runAunitCiCheck(
  http: AdtHttpClient,
  safety: SafetyConfig,
  options: RunAunitCiOptions,
): Promise<AunitCiResult> {
  checkOperation(safety, OperationType.Test, 'RunAunitCiCheck');
  throwIfAborted(options.signal);
  const objectSet = normalizeCiObjectSet(options.objectSet);
  const origin = resolveOrigin(options.origin);
  const clock = options.clock ?? defaultClock;
  const timeoutSeconds = clampTimeoutSeconds(options.timeoutSeconds);
  const started = clock.now();
  const dummyPath = `${AUNIT_CI_RUNS_PATH}/${ATC_CI_DUMMY_RUN_ID}`;

  const csrfToken = await fetchCiCsrfToken(http, dummyPath, AUNIT_CI_ACCEPT_STATUS);
  const body = buildAunitCiRunXml(objectSet, options);
  logger.debug('AUnit CI run starting', {
    path: AUNIT_CI_RUNS_PATH,
    packageCount: objectSet.packages.length,
    packageTreeCount: objectSet.packageTrees.length,
    softwareComponentCount: objectSet.softwareComponents.length,
  });
  const startResp = await http.post(AUNIT_CI_RUNS_PATH, body, AUNIT_CI_CONTENT_TYPE_RUN, {
    Accept: AUNIT_CI_ACCEPT_STATUS,
  });
  const pollPath = resolveCiApiLocation(headerValue(startResp.headers, 'location'), origin, AUNIT_CI_LOCATION_PREFIX);
  const statusDoc = await pollCiRun({
    http,
    pollPath,
    accept: AUNIT_CI_ACCEPT_STATUS,
    origin,
    locationPrefix: AUNIT_CI_LOCATION_PREFIX,
    intervalMs: AUNIT_CI_POLL_INTERVAL_MS,
    timeoutSeconds,
    clock,
    signal: options.signal,
    parseStatus: parseAunitCiRunStatus,
    isRunning: isAunitCiRunning,
    isCompleted: (status) => {
      const normalized = status.trim().toUpperCase();
      return normalized === 'COMPLETED' || normalized === 'FINISHED';
    },
    kind: 'AUnit',
  });
  const resultPath = resolveCiApiLocation(statusDoc.resultHref ?? '', origin, AUNIT_CI_LOCATION_PREFIX);
  const resultResp = await http.get(resultPath, resultHeaders(AUNIT_CI_ACCEPT_JUNIT, csrfToken));
  const { tests, summary } = parseAunitJunit(resultResp.body);
  return {
    status: 'completed',
    durationMs: Math.max(0, clock.now() - started),
    fail: aunitResultsFail(summary, options.evaluateResults ?? true),
    summary,
    tests,
    reportXml: resultResp.body,
  };
}

export function clampTimeoutSeconds(value: number | undefined): number {
  const raw = value == null || !Number.isFinite(value) ? CI_POLL_TIMEOUT_DEFAULT_SECONDS : Math.trunc(value);
  return Math.min(CI_POLL_TIMEOUT_MAX_SECONDS, Math.max(CI_POLL_TIMEOUT_MIN_SECONDS, raw));
}

export function resolveCiApiLocation(value: string, origin: string, allowedPrefix: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new AdtApiError('CI quality run returned an empty Location or result href.', 400, '');
  }
  if (trimmed.includes('\\') || trimmed.includes('..')) {
    throw new AdtApiError('CI quality Location must not contain parent-path segments or backslashes.', 400, '');
  }

  let resolved: URL;
  try {
    resolved = new URL(trimmed, `${origin}/`);
  } catch {
    throw new AdtApiError('CI quality Location is not a valid URL.', 400, '');
  }
  if (resolved.username || resolved.password) {
    throw new AdtApiError('CI quality Location must not contain userinfo.', 400, '');
  }

  const originUrl = new URL(origin);
  if (resolved.protocol !== originUrl.protocol || resolved.host !== originUrl.host) {
    throw new AdtApiError('CI quality Location must stay on the configured SAP origin.', 400, '');
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(resolved.pathname);
  } catch {
    throw new AdtApiError('CI quality Location path is not decodable.', 400, '');
  }
  if (decodedPath.includes('\\') || decodedPath.split('/').includes('..')) {
    throw new AdtApiError('CI quality Location must not contain parent-path segments.', 400, '');
  }
  if (!decodedPath.startsWith(allowedPrefix)) {
    throw new AdtApiError(`CI quality Location must start with ${allowedPrefix}.`, 400, '');
  }
  return `${resolved.pathname}${resolved.search}`;
}

export function resolveOrigin(origin: string): string {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new AdtApiError('CI quality origin is not a valid URL.', 400, '');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new AdtApiError('CI quality origin must be an http(s) URL.', 400, '');
  }
  if (url.username || url.password) {
    throw new AdtApiError('CI quality origin must not contain userinfo.', 400, '');
  }
  return url.origin;
}

export async function sleepMs(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function fetchCiCsrfToken(http: AdtHttpClient, dummyPath: string, accept: string): Promise<string | undefined> {
  try {
    const resp = await http.get(
      dummyPath,
      { 'X-CSRF-Token': 'fetch', Accept: accept },
      { suppressNotFoundLog: true, probe: true },
    );
    const token = headerValue(resp.headers, 'x-csrf-token');
    return token && token.toLowerCase() !== 'required' ? token : undefined;
  } catch (err) {
    if (err instanceof AdtApiError && (err.statusCode === 404 || err.statusCode === 405)) {
      logger.debug('CI CSRF probe returned an expected miss', { path: dummyPath, statusCode: err.statusCode });
      return undefined;
    }
    throw err;
  }
}

async function pollCiRun(args: {
  http: AdtHttpClient;
  pollPath: string;
  accept: string;
  origin: string;
  locationPrefix: string;
  intervalMs: number;
  timeoutSeconds: number;
  clock: CiQualityClock;
  signal?: AbortSignal;
  parseStatus: (xml: string) => { status: string; resultHref?: string };
  isRunning: (status: string) => boolean;
  isCompleted: (status: string) => boolean;
  kind: 'ATC' | 'AUnit';
}): Promise<{ status: string; resultHref?: string }> {
  const deadline = args.clock.now() + args.timeoutSeconds * 1000;
  let first = true;
  for (;;) {
    throwIfAborted(args.signal);
    if (args.clock.now() >= deadline) {
      throw new AdtApiError(`${args.kind} CI run timed out after ${args.timeoutSeconds}s`, 504, args.pollPath);
    }
    if (!first) await args.clock.sleep(args.intervalMs, args.signal);
    first = false;

    const resp = await args.http.get(args.pollPath, { Accept: args.accept });
    const doc = args.parseStatus(resp.body);
    const status = doc.status.trim();
    logger.debug(`${args.kind} CI poll`, { path: args.pollPath, status });

    if (args.isCompleted(status)) {
      if (!doc.resultHref) {
        throw new AdtApiError(`${args.kind} CI run completed without a result href.`, 500, args.pollPath);
      }
      return {
        status,
        resultHref: resolveCiApiLocation(doc.resultHref, args.origin, args.locationPrefix),
      };
    }
    if (status.toLowerCase() === 'aborted') {
      throw new AdtApiError(`${args.kind} run was aborted`, 500, args.pollPath);
    }
    if (!status) {
      throw new AdtApiError(`${args.kind} CI run returned an empty status.`, 500, args.pollPath);
    }
    if (status === 'Not Created') {
      throw new AdtApiError(`${args.kind} CI run was not created.`, 500, args.pollPath);
    }
    if (!args.isRunning(status)) {
      throw new AdtApiError(`${args.kind} CI run returned unexpected status "${status}".`, 500, args.pollPath);
    }
  }
}

function isAtcCiRunning(status: string): boolean {
  return status === 'Running' || status === 'Not Yet Started';
}

function isAunitCiRunning(status: string): boolean {
  const normalized = status.trim().toUpperCase();
  if (!normalized) return false;
  if (normalized === 'COMPLETED' || normalized === 'FINISHED') return false;
  if (normalized === 'ABORTED' || normalized === 'NOT CREATED') return false;
  return true;
}

function resultHeaders(accept: string, csrfToken: string | undefined): Record<string, string> {
  if (!csrfToken) return { Accept: accept };
  return { Accept: accept, 'X-CSRF-Token': csrfToken };
}

function headerValue(headers: AdtResponse['headers'] | undefined, name: string): string {
  if (!headers) return '';
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value;
  }
  return '';
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw abortError();
}

function abortError(): AdtApiError {
  return new AdtApiError('CI quality run was aborted', 408, '');
}
