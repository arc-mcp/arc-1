/**
 * gCTS client helpers.
 *
 * gCTS uses JSON payloads under /sap/bc/cts_abapvcs/*.
 */

import { AdtApiError, AdtSafetyError, classifyGctsError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import { checkGit, checkOperation, OperationType, type OperationTypeCode, type SafetyConfig } from './safety.js';
import type {
  GctsBranch,
  GctsCommit,
  GctsConfig,
  GctsObject,
  GctsRepo,
  GctsSystemInfo,
  GctsUserInfo,
} from './types.js';

const GCTS_BASE = '/sap/bc/cts_abapvcs';
const JSON_HEADERS = { Accept: 'application/json' };
const GCTS_MUTATION_QUARANTINE =
  'gCTS mutations are unavailable until ARC-1 implements staged VCS_NO_IMPORT fetch, affected-object inventory, authorization preflight, explicit deploy, terminal confirmation, and rollback. No gCTS mutation was sent.';
const GCTS_REDACTION_LIMIT_MARKER = '[TRUNCATED: redaction budget exceeded]';
const GCTS_REDACTION_MAX_DEPTH = 16;
// gCTS list/config payloads are legitimately wide. Keep the defensive traversal cap well above
// ordinary API responses so redaction never turns a successful list into partial data.
const GCTS_REDACTION_MAX_ENTRIES = 10_000;
const GCTS_REDACTION_MAX_STRING_LENGTH = 4_096;
const GCTS_REDACTION_STRING_PREFIX_LENGTH = 2_000;

const GIT_SECRET_FRAGMENTS = [
  'password',
  'passwd',
  'passphrase',
  'pwd',
  'token',
  'secret',
  'auth_pwd',
  'auth_user',
  'auth_token',
  'authpwd',
  'authuser',
  'authtoken',
  'authorization',
  'apikey',
  'api_key',
  'credential',
  'accesskey',
  'access_key',
  'privatekey',
  'private_key',
  'sshkey',
  'ssh_key',
  'signature',
  'cookie',
  'session',
  'sessionid',
  'jsessionid',
  'sapsessionid',
];

function parseJson<T>(body: string): T {
  if (!body.trim()) throw new Error('gCTS returned an empty response where JSON was required.');
  try {
    return JSON.parse(body) as T;
  } catch {
    // JSON.parse includes a prefix of the response in its SyntaxError on current Node releases.
    // Never let response-derived credentials escape through MCP/CLI error formatting.
    throw new Error('gCTS returned invalid JSON. Check the endpoint and installed gCTS version.');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeSafeUnicodeEscapes(value: string): string {
  return value.replace(/\\{1,8}u([0-9a-f]{4})/gi, (encoded, hex: string) => {
    const decoded = String.fromCharCode(Number.parseInt(hex, 16));
    return /^[a-z0-9_.-]$/i.test(decoded) ? decoded : encoded;
  });
}

function isGitSecretKey(key: string): boolean {
  const normalized = normalizeSafeUnicodeEscapes(key)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return GIT_SECRET_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

function isCredentialQueryKey(key: string): boolean {
  const normalized = normalizeSafeUnicodeEscapes(key).toLowerCase();
  return normalized === 'auth' || normalized.includes('authorization') || isGitSecretKey(normalized);
}

function redactCredentialAssignments(value: string): string {
  return value
    .replace(
      /\bauthorization\s*([:=])\s*(?:bearer|basic)\s+(?:\\{1,64}"[^"]*\\{1,64}"|\\{1,64}'[^']*\\{1,64}'|"[^"]*"|'[^']*'|[^\s,;&<>"']+)/gi,
      'authorization$1[REDACTED]',
    )
    .replace(
      /\b(bearer|basic)\s+(?:\\{1,64}"[^"]*\\{1,64}"|\\{1,64}'[^']*\\{1,64}'|"[^"]*"|'[^']*'|[^\s,;&<>"']+)/gi,
      '$1 [REDACTED]',
    )
    .replace(
      /\b(password|passwd|passphrase|pwd|token|secret|api[_-]?key|authorization|credential|access[_-]?key|private[_-]?key|ssh[_-]?key|signature|cookie|jsessionid|sap[_-]?sessionid|sessionid|session|(?:client[_-]?vcs[_-]?)?auth[_-]?(?:pwd|user|token)|remote[_-]?(?:password|user|token))(?:(?:\\{1,64})?["'])?\s*([:=])\s*(?:(?:bearer|basic)\s+)?(?:\\{1,64}"[^"]*\\{1,64}"|\\{1,64}'[^']*\\{1,64}'|"[^"]*"|'[^']*'|[^\s,;&<>"']+)/gi,
      '$1$2[REDACTED]',
    );
}

function normalizeEscapedUrlSlashes(value: string): string {
  return normalizeSafeUnicodeEscapes(value.replace(/\\{1,8}\//g, '/'));
}

function boundGctsString(value: string, originalLength = value.length): string {
  if (value.length <= GCTS_REDACTION_MAX_STRING_LENGTH && originalLength <= GCTS_REDACTION_MAX_STRING_LENGTH) {
    return value;
  }
  return `${value.slice(0, GCTS_REDACTION_STRING_PREFIX_LENGTH)}... [truncated ${originalLength} chars]`;
}

function gctsStringInput(value: string): string {
  return value.length <= GCTS_REDACTION_MAX_STRING_LENGTH ? value : value.slice(0, GCTS_REDACTION_MAX_STRING_LENGTH);
}

function redactUrlAssignments(value: string): string {
  return redactCredentialAssignments(value).replace(
    /(^|[&;])([^=&;]+)(?:=([^&;]*))?/g,
    (part, separator: string, rawKey: string) => {
      let decodedKey = rawKey;
      try {
        decodedKey = decodeURIComponent(rawKey.replace(/\+/g, ' '));
      } catch {
        // Keep the raw key for the sensitivity check.
      }
      return isCredentialQueryKey(decodedKey) ? `${separator}[REDACTED]=[REDACTED]` : part;
    },
  );
}

function redactUrl(value: string): string {
  const normalizedValue = normalizeEscapedUrlSlashes(gctsStringInput(value));
  try {
    const parsed = new URL(normalizedValue);
    parsed.username = '';
    parsed.password = '';
    parsed.pathname = redactCredentialAssignments(parsed.pathname);
    if (parsed.search) parsed.search = `?${redactUrlAssignments(parsed.search.slice(1))}`;
    if (parsed.hash) parsed.hash = `#${redactUrlAssignments(parsed.hash.slice(1))}`;
    return parsed.toString();
  } catch {
    const withoutUserinfo = normalizedValue.replace(/^([a-z][a-z\d+.-]*:\/\/)[^/@\s]+@/i, '$1[REDACTED]@');
    const fragmentStart = withoutUserinfo.indexOf('#');
    const beforeFragment = fragmentStart >= 0 ? withoutUserinfo.slice(0, fragmentStart) : withoutUserinfo;
    const fragment = fragmentStart >= 0 ? withoutUserinfo.slice(fragmentStart + 1) : undefined;
    const queryStart = beforeFragment.indexOf('?');
    const path = queryStart >= 0 ? beforeFragment.slice(0, queryStart) : beforeFragment;
    const query = queryStart >= 0 ? beforeFragment.slice(queryStart + 1) : undefined;
    return `${redactCredentialAssignments(path)}${query === undefined ? '' : `?${redactUrlAssignments(query)}`}${
      fragment === undefined ? '' : `#${redactUrlAssignments(fragment)}`
    }`;
  }
}

function redactUrlsInText(value: string): string {
  const redacted = redactCredentialAssignments(normalizeEscapedUrlSlashes(gctsStringInput(value))).replace(
    /https?:\/\/[^\s<>"']+/gi,
    (candidate) => {
      const trailing = candidate.match(/[),.;]+$/)?.[0] ?? '';
      const core = trailing ? candidate.slice(0, -trailing.length) : candidate;
      return `${redactUrl(core)}${trailing}`;
    },
  );
  return boundGctsString(redacted, value.length);
}

function redactedOutputKey(entryKey: string, target: Record<string, unknown>): string {
  const boundedInput = gctsStringInput(entryKey);
  const sanitized = isCredentialQueryKey(boundedInput)
    ? '[REDACTED sensitive key]'
    : boundGctsString(redactUrlsInText(boundedInput), entryKey.length);
  if (!Object.hasOwn(target, sanitized)) return sanitized;

  // Different attacker-controlled names can collapse to the same redacted key. Preserve every
  // value without reintroducing either original key or an unbounded suffix.
  let collision = 2;
  while (Object.hasOwn(target, `[REDACTED duplicate key ${collision}]`)) collision += 1;
  return `[REDACTED duplicate key ${collision}]`;
}

function setRedactedEntry(target: Record<string, unknown>, entryKey: string, value: unknown): void {
  Object.defineProperty(target, redactedOutputKey(entryKey, target), {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

/** Remove credential-bearing gCTS config and URL values before they can reach tool output. */
function redactGctsValueWithinBudget<T>(
  value: T,
  key: string,
  state: { remainingEntries: number; seen: WeakSet<object> },
  depth: number,
): T {
  if (depth > GCTS_REDACTION_MAX_DEPTH || state.remainingEntries <= 0) return GCTS_REDACTION_LIMIT_MARKER as T;
  state.remainingEntries -= 1;
  if (isGitSecretKey(key)) return '[REDACTED]' as T;
  if (typeof value === 'string') {
    const redacted =
      key.toLowerCase().includes('url') || key.toLowerCase().includes('uri')
        ? redactUrl(value)
        : redactUrlsInText(value);
    return boundGctsString(redacted, value.length) as T;
  }
  if (Array.isArray(value)) {
    if (state.seen.has(value)) return GCTS_REDACTION_LIMIT_MARKER as T;
    state.seen.add(value);
    const result: unknown[] = [];
    for (const entry of value) {
      if (state.remainingEntries <= 0) {
        result.push(GCTS_REDACTION_LIMIT_MARKER);
        break;
      }
      result.push(redactGctsValueWithinBudget(entry, key, state, depth + 1));
    }
    return result as T;
  }
  if (!isRecord(value)) return value;
  if (state.seen.has(value)) return GCTS_REDACTION_LIMIT_MARKER as T;
  state.seen.add(value);

  const configKey = String(value.ckey ?? value.key ?? '').trim();
  const sensitiveConfigEntry = isGitSecretKey(configKey);
  const redacted: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (state.remainingEntries <= 0) {
      setRedactedEntry(redacted, '__truncated__', GCTS_REDACTION_LIMIT_MARKER);
      break;
    }
    let redactedValue: unknown;
    if (sensitiveConfigEntry && ['value', 'defaultvalue', 'currentvalue', 'example'].includes(entryKey.toLowerCase())) {
      redactedValue = '[REDACTED]';
    } else {
      redactedValue = redactGctsValueWithinBudget(entryValue, entryKey, state, depth + 1);
    }
    setRedactedEntry(redacted, entryKey, redactedValue);
  }
  return redacted as T;
}

export function redactGctsValue<T>(value: T, key = ''): T {
  return redactGctsValueWithinBudget(
    value,
    key,
    { remainingEntries: GCTS_REDACTION_MAX_ENTRIES, seen: new WeakSet() },
    0,
  );
}

function redactGctsText(value: string): string {
  try {
    return JSON.stringify(redactGctsValue(JSON.parse(value) as unknown));
  } catch {
    return redactUrlsInText(value);
  }
}

function redactGctsResponseBody(value: string): string {
  if (!value) return '';
  try {
    return JSON.stringify(redactGctsValue(JSON.parse(value) as unknown));
  } catch {
    return `[REDACTED invalid/non-JSON gCTS response ${value.length} chars]`;
  }
}

function requireArrayWrapper<T>(payload: unknown, wrapper: string, operation: string): T[] {
  if (isRecord(payload) && Array.isArray(payload[wrapper])) return payload[wrapper] as T[];
  throw new Error(`gCTS ${operation} returned an unexpected response shape; expected {${wrapper}:[...]}.`);
}

function requireObjectWrapper<T>(payload: unknown, wrapper: string, operation: string): T {
  if (isRecord(payload) && isRecord(payload[wrapper])) return payload as T;
  throw new Error(`gCTS ${operation} returned an unexpected response shape; expected {${wrapper}:{...}}.`);
}

export const GCTS_QUARANTINED_MUTATIONS = {
  clone: [OperationType.Create, 'GctsCloneRepo'],
  pull: [OperationType.Update, 'GctsPullRepo'],
  create_branch: [OperationType.Create, 'GctsCreateBranch'],
  switch_branch: [OperationType.Update, 'GctsSwitchBranch'],
  unlink: [OperationType.Delete, 'GctsDeleteRepo'],
} as const satisfies Record<string, readonly [OperationTypeCode, string]>;

export type GctsQuarantinedMutation = keyof typeof GCTS_QUARANTINED_MUTATIONS;

/** Fail closed before dispatch while gCTS mutations lack transactional postconditions. */
export function enforceGctsMutationQuarantine(safety: SafetyConfig, action: string): void {
  const mutation = GCTS_QUARANTINED_MUTATIONS[action as GctsQuarantinedMutation];
  if (!mutation) return;
  const [opType, operation] = mutation;
  checkOperation(safety, opType, operation);
  checkGit(safety, action);
  throw new AdtSafetyError(`${operation}: ${GCTS_MUTATION_QUARANTINE}`);
}

function errorMessageFromPayload(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const record = payload as Record<string, unknown>;
  const log = Array.isArray(record.log) ? record.log : [];
  const errorLog = log.find(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      String((entry as Record<string, unknown>).severity ?? '')
        .trim()
        .toUpperCase() === 'ERROR',
  ) as Record<string, unknown> | undefined;
  return typeof errorLog?.message === 'string' ? errorLog.message : undefined;
}

async function requestGcts(
  path: string,
  run: () => Promise<{ statusCode: number; headers: Record<string, string>; body: string }>,
): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  try {
    const response = await run();
    if (response.body) {
      try {
        const payload = JSON.parse(response.body) as unknown;
        const logMessage = errorMessageFromPayload(payload);
        if (logMessage) {
          throw new AdtApiError(redactGctsText(logMessage), 500, path, JSON.stringify(redactGctsValue(payload)));
        }
      } catch (err) {
        if (err instanceof AdtApiError) throw err;
        // The endpoint-specific parser below owns non-JSON/invalid-JSON diagnostics.
      }
    }
    return response;
  } catch (err) {
    if (err instanceof AdtApiError) {
      const rawBody = err.responseBody ?? '';
      const classified = classifyGctsError(rawBody);
      const safeBody = redactGctsResponseBody(rawBody);
      const detail =
        classified.exception ??
        classified.logMessage ??
        (rawBody ? 'gCTS request failed with an invalid or unclassified response.' : err.message);
      throw new AdtApiError(redactGctsText(detail), err.statusCode, redactUrlsInText(err.path || path), safeBody);
    }
    throw err;
  }
}

/** gCTS system status (/system). */
export async function getSystemInfo(http: AdtHttpClient, safety: SafetyConfig): Promise<GctsSystemInfo> {
  checkOperation(safety, OperationType.Read, 'GctsGetSystemInfo');
  const path = `${GCTS_BASE}/system`;
  const resp = await requestGcts(path, () => http.get(path, JSON_HEADERS));
  return redactGctsValue(requireObjectWrapper<GctsSystemInfo>(parseJson<unknown>(resp.body), 'result', 'system info'));
}

/** gCTS user scopes (/user). */
export async function getUserInfo(http: AdtHttpClient, safety: SafetyConfig): Promise<GctsUserInfo> {
  checkOperation(safety, OperationType.Read, 'GctsGetUserInfo');
  const path = `${GCTS_BASE}/user`;
  const resp = await requestGcts(path, () => http.get(path, JSON_HEADERS));
  return redactGctsValue(requireObjectWrapper<GctsUserInfo>(parseJson<unknown>(resp.body), 'user', 'user info'));
}

/** gCTS configuration schema (/config or /repository/{rid}/config). */
export async function getConfig(http: AdtHttpClient, safety: SafetyConfig, repoId?: string): Promise<GctsConfig[]> {
  checkOperation(safety, OperationType.Read, 'GctsGetConfig');
  const path = repoId ? `${GCTS_BASE}/repository/${encodeURIComponent(repoId)}/config` : `${GCTS_BASE}/config`;
  const resp = await requestGcts(path, () => http.get(path, JSON_HEADERS));
  const parsed = parseJson<unknown>(resp.body);
  return redactGctsValue(requireArrayWrapper<GctsConfig>(parsed, 'config', 'config'));
}

/** List gCTS repositories. Returns [] for empty-object response shape. */
export async function listRepos(http: AdtHttpClient, safety: SafetyConfig): Promise<GctsRepo[]> {
  checkOperation(safety, OperationType.Read, 'GctsListRepos');
  const path = `${GCTS_BASE}/repository`;
  const resp = await requestGcts(path, () => http.get(path, JSON_HEADERS));
  const parsed = parseJson<unknown>(resp.body);

  // Live systems return {} for empty repository state, not [] or {result:[]}
  if (typeof parsed === 'object' && parsed !== null && Object.keys(parsed as Record<string, unknown>).length === 0) {
    return [];
  }

  if (Array.isArray(parsed)) return redactGctsValue(parsed as GctsRepo[]);
  if (isRecord(parsed) && Array.isArray(parsed.result)) return redactGctsValue(parsed.result as GctsRepo[]);
  if (isRecord(parsed) && Array.isArray(parsed.repositories)) {
    return redactGctsValue(parsed.repositories as GctsRepo[]);
  }

  throw new Error('gCTS repository list returned an unexpected response shape.');
}

/** List branches for a repository. */
export async function listBranches(http: AdtHttpClient, safety: SafetyConfig, repoId: string): Promise<GctsBranch[]> {
  checkOperation(safety, OperationType.Read, 'GctsListBranches');
  const path = `${GCTS_BASE}/repository/${encodeURIComponent(repoId)}/branches`;
  const resp = await requestGcts(path, () => http.get(path, JSON_HEADERS));
  const parsed = parseJson<unknown>(resp.body);
  return redactGctsValue(requireArrayWrapper<GctsBranch>(parsed, 'branches', 'branches'));
}

/** Commit history for a repository. */
export async function getCommitHistory(
  http: AdtHttpClient,
  safety: SafetyConfig,
  repoId: string,
  limit = 20,
): Promise<GctsCommit[]> {
  checkOperation(safety, OperationType.Read, 'GctsGetCommitHistory');
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : 20;
  const path = `${GCTS_BASE}/repository/${encodeURIComponent(repoId)}/getCommit?limit=${encodeURIComponent(String(safeLimit))}`;
  const resp = await requestGcts(path, () => http.get(path, JSON_HEADERS));
  const parsed = parseJson<unknown>(resp.body);
  const commits = requireArrayWrapper<GctsCommit>(parsed, 'commits', 'commit history');
  return redactGctsValue(
    commits.map((commit) => ({
      ...commit,
      ...(commit.id && !commit.commit ? { commit: commit.id } : {}),
      ...(commit.authorMail && !commit.email ? { email: commit.authorMail } : {}),
    })),
  );
}

/** List repository objects tracked by gCTS. */
export async function listRepoObjects(
  http: AdtHttpClient,
  safety: SafetyConfig,
  repoId: string,
): Promise<GctsObject[]> {
  checkOperation(safety, OperationType.Read, 'GctsListRepoObjects');
  const path = `${GCTS_BASE}/repository/${encodeURIComponent(repoId)}/objects`;
  const resp = await requestGcts(path, () => http.get(path, JSON_HEADERS));
  const parsed = parseJson<unknown>(resp.body);
  if (isRecord(parsed) && Array.isArray(parsed.objects)) return redactGctsValue(parsed.objects as GctsObject[]);
  if (isRecord(parsed) && Array.isArray(parsed.result)) return redactGctsValue(parsed.result as GctsObject[]);
  throw new Error('gCTS repository objects returned an unexpected response shape.');
}

/** Read transport history for repository linkage diagnostics. */
export async function getTransportHistory(
  http: AdtHttpClient,
  safety: SafetyConfig,
  repoId: string,
): Promise<Record<string, unknown>> {
  checkOperation(safety, OperationType.Read, 'GctsGetTransportHistory');
  const path = `${GCTS_BASE}/repository/history/${encodeURIComponent(repoId)}`;
  const resp = await requestGcts(path, () => http.get(path, JSON_HEADERS));
  return redactGctsValue(parseJson<Record<string, unknown>>(resp.body));
}
