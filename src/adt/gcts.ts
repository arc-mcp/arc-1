/**
 * gCTS client helpers.
 *
 * gCTS uses JSON payloads under /sap/bc/cts_abapvcs/*.
 */

import { AdtApiError, AdtSafetyError, classifyGctsError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import type { PackageHierarchyResolver } from './package-hierarchy.js';
import { checkGit, checkOperation, checkPackage, OperationType, type SafetyConfig } from './safety.js';
import type {
  GctsBranch,
  GctsCloneResult,
  GctsCommit,
  GctsConfig,
  GctsObject,
  GctsRepo,
  GctsSystemInfo,
  GctsUserInfo,
} from './types.js';

const GCTS_BASE = '/sap/bc/cts_abapvcs';
const JSON_HEADERS = { Accept: 'application/json' };
const JSON_CONTENT_TYPE = 'application/json';

interface GctsConfigEntry {
  key: string;
  value: string;
}

export interface GctsCloneParams {
  rid?: string;
  name?: string;
  role?: string;
  type?: string;
  vSID?: string;
  url: string;
  package?: string;
  privateFlag?: boolean;
  config?: GctsConfigEntry[];
  user?: string;
  password?: string;
  token?: string;
}

export interface GctsCommitParams {
  message?: string;
  description?: string;
  objects?: GctsObject[];
}

export interface GctsCreateBranchParams {
  branch: string;
  isSymbolic?: boolean;
  isPeeled?: boolean;
  type?: string;
  package?: string;
}

function parseJson<T>(body: string): T {
  if (!body) return {} as T;
  return JSON.parse(body) as T;
}

function errorMessageFromPayload(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const record = payload as Record<string, unknown>;
  const log = Array.isArray(record.log) ? record.log : [];
  const errorLog = log.find(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      String((entry as Record<string, unknown>).severity ?? '').toUpperCase() === 'ERROR',
  ) as Record<string, unknown> | undefined;
  return typeof errorLog?.message === 'string' ? errorLog.message : undefined;
}

async function requestGcts(
  path: string,
  run: () => Promise<{ statusCode: number; headers: Record<string, string>; body: string }>,
): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof AdtApiError) {
      const classified = classifyGctsError(err.responseBody ?? '');
      const detail = classified.exception ?? classified.logMessage;
      if (detail) {
        throw new AdtApiError(detail, err.statusCode, err.path || path, err.responseBody);
      }
    }
    throw err;
  }
}

function withRepoCredentials(payload: Record<string, unknown>, user?: string, password?: string, token?: string) {
  const config = Array.isArray(payload.config) ? [...(payload.config as GctsConfigEntry[])] : [];
  if (user) config.push({ key: 'CLIENT_VCS_AUTH_USER', value: user });
  if (password) config.push({ key: 'CLIENT_VCS_AUTH_PWD', value: password });
  if (token) config.push({ key: 'CLIENT_VCS_AUTH_TOKEN', value: token });

  return {
    ...payload,
    ...(config.length > 0 ? { config } : {}),
  };
}

/** gCTS system status (/system). */
export async function getSystemInfo(http: AdtHttpClient, safety: SafetyConfig): Promise<GctsSystemInfo> {
  checkOperation(safety, OperationType.Read, 'GctsGetSystemInfo');
  const path = `${GCTS_BASE}/system`;
  const resp = await requestGcts(path, () => http.get(path, JSON_HEADERS));
  return parseJson<GctsSystemInfo>(resp.body);
}

/** gCTS user scopes (/user). */
export async function getUserInfo(http: AdtHttpClient, safety: SafetyConfig): Promise<GctsUserInfo> {
  checkOperation(safety, OperationType.Read, 'GctsGetUserInfo');
  const path = `${GCTS_BASE}/user`;
  const resp = await requestGcts(path, () => http.get(path, JSON_HEADERS));
  return parseJson<GctsUserInfo>(resp.body);
}

/** gCTS configuration schema (/config or /repository/{rid}/config). */
export async function getConfig(http: AdtHttpClient, safety: SafetyConfig, repoId?: string): Promise<GctsConfig[]> {
  checkOperation(safety, OperationType.Read, 'GctsGetConfig');
  const path = repoId ? `${GCTS_BASE}/repository/${encodeURIComponent(repoId)}/config` : `${GCTS_BASE}/config`;
  const resp = await requestGcts(path, () => http.get(path, JSON_HEADERS));
  const parsed = parseJson<unknown>(resp.body);

  if (Array.isArray(parsed)) return parsed as GctsConfig[];
  if (typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as Record<string, unknown>).result)) {
    return (parsed as { result: GctsConfig[] }).result;
  }
  return [];
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

  if (Array.isArray(parsed)) return parsed as GctsRepo[];
  if (typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as Record<string, unknown>).result)) {
    return (parsed as { result: GctsRepo[] }).result;
  }

  return [];
}

/** Clone/link a repository in gCTS. */
export async function cloneRepo(
  http: AdtHttpClient,
  safety: SafetyConfig,
  params: GctsCloneParams,
  resolver?: PackageHierarchyResolver | null,
): Promise<GctsCloneResult> {
  checkOperation(safety, OperationType.Create, 'GctsCloneRepo');
  checkGit(safety, 'clone');
  // When an allowlist is configured, the package is not optional: gCTS would
  // otherwise bind the repo to a server-derived default (possibly outside the
  // allowlist). Force the caller to declare the target package up-front.
  if (safety.allowedPackages.length > 0 && !params.package) {
    throw new AdtSafetyError(
      `GctsCloneRepo requires an explicit 'package' when allowedPackages is configured (allowed: ${JSON.stringify(safety.allowedPackages)})`,
    );
  }
  if (params.package) await checkPackage(safety, params.package, resolver);

  const path = `${GCTS_BASE}/repository`;
  const payload = withRepoCredentials(
    {
      rid: params.rid,
      name: params.name,
      role: params.role,
      type: params.type,
      vSID: params.vSID,
      url: params.url,
      package: params.package,
      privateFlag: params.privateFlag,
      config: params.config,
    },
    params.user,
    params.password,
    params.token,
  );

  const resp = await requestGcts(path, () => http.post(path, JSON.stringify(payload), JSON_CONTENT_TYPE, JSON_HEADERS));

  const parsed = parseJson<unknown>(resp.body);
  const logMessage = errorMessageFromPayload(parsed);
  if (logMessage) {
    throw new AdtApiError(logMessage, 500, path, resp.body);
  }
  return parsed as GctsCloneResult;
}

/** Pull latest changes or a specific commit. */
export async function pullRepo(
  http: AdtHttpClient,
  safety: SafetyConfig,
  repoId: string,
  commit?: string,
): Promise<Record<string, unknown>> {
  checkOperation(safety, OperationType.Update, 'GctsPullRepo');
  checkGit(safety, 'pull');

  const path = `${GCTS_BASE}/repository/${encodeURIComponent(repoId)}/pullByCommit`;
  const resp = await requestGcts(path, () =>
    http.post(path, JSON.stringify(commit ? { commit } : {}), JSON_CONTENT_TYPE, JSON_HEADERS),
  );
  const parsed = parseJson<Record<string, unknown>>(resp.body);
  const logMessage = errorMessageFromPayload(parsed);
  if (logMessage) {
    throw new AdtApiError(logMessage, 500, path, resp.body);
  }
  return parsed;
}

/** Commit staged gCTS changes. */
export async function commitRepo(
  http: AdtHttpClient,
  safety: SafetyConfig,
  repoId: string,
  params: GctsCommitParams,
): Promise<Record<string, unknown>> {
  checkOperation(safety, OperationType.Update, 'GctsCommitRepo');
  checkGit(safety, 'commit');

  const path = `${GCTS_BASE}/repository/${encodeURIComponent(repoId)}/commit`;
  const body = JSON.stringify({
    ...(params.message ? { message: params.message } : {}),
    ...(params.description ? { description: params.description } : {}),
    ...(params.objects ? { objects: params.objects } : {}),
  });

  const resp = await requestGcts(path, () => http.post(path, body, JSON_CONTENT_TYPE, JSON_HEADERS));
  const parsed = parseJson<Record<string, unknown>>(resp.body);
  const logMessage = errorMessageFromPayload(parsed);
  if (logMessage) {
    throw new AdtApiError(logMessage, 500, path, resp.body);
  }
  return parsed;
}

/** List branches for a repository. */
export async function listBranches(http: AdtHttpClient, safety: SafetyConfig, repoId: string): Promise<GctsBranch[]> {
  checkOperation(safety, OperationType.Read, 'GctsListBranches');
  const path = `${GCTS_BASE}/repository/${encodeURIComponent(repoId)}/branches`;
  const resp = await requestGcts(path, () => http.get(path, JSON_HEADERS));
  const parsed = parseJson<unknown>(resp.body);
  if (Array.isArray(parsed)) return parsed as GctsBranch[];
  if (typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as Record<string, unknown>).result)) {
    return (parsed as { result: GctsBranch[] }).result;
  }
  return [];
}

/** Create a branch in gCTS. */
export async function createBranch(
  http: AdtHttpClient,
  safety: SafetyConfig,
  repoId: string,
  params: GctsCreateBranchParams,
  resolver?: PackageHierarchyResolver | null,
): Promise<Record<string, unknown>> {
  checkOperation(safety, OperationType.Update, 'GctsCreateBranch');
  checkGit(safety, 'create_branch');
  if (params.package) await checkPackage(safety, params.package, resolver);

  const path = `${GCTS_BASE}/repository/${encodeURIComponent(repoId)}/branches`;
  const body = JSON.stringify({
    branch: params.branch,
    isSymbolic: params.isSymbolic ?? false,
    isPeeled: params.isPeeled ?? false,
    type: params.type ?? 'head',
  });

  const resp = await requestGcts(path, () => http.post(path, body, JSON_CONTENT_TYPE, JSON_HEADERS));
  return parseJson<Record<string, unknown>>(resp.body);
}

/** Switch branch in gCTS. */
export async function switchBranch(
  http: AdtHttpClient,
  safety: SafetyConfig,
  repoId: string,
  branch: string,
): Promise<Record<string, unknown>> {
  checkOperation(safety, OperationType.Update, 'GctsSwitchBranch');
  checkGit(safety, 'switch_branch');

  const path = `${GCTS_BASE}/repository/${encodeURIComponent(repoId)}/checkout/${encodeURIComponent(branch)}`;
  const resp = await requestGcts(path, () => http.post(path, JSON.stringify({}), JSON_CONTENT_TYPE, JSON_HEADERS));
  return parseJson<Record<string, unknown>>(resp.body);
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
  if (Array.isArray(parsed)) return parsed as GctsCommit[];
  if (typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as Record<string, unknown>).result)) {
    return (parsed as { result: GctsCommit[] }).result;
  }
  return [];
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
  if (Array.isArray(parsed)) return parsed as GctsObject[];
  if (typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as Record<string, unknown>).result)) {
    return (parsed as { result: GctsObject[] }).result;
  }
  return [];
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
  return parseJson<Record<string, unknown>>(resp.body);
}

/** Unlink/delete a gCTS repository. */
export async function deleteRepo(http: AdtHttpClient, safety: SafetyConfig, repoId: string): Promise<void> {
  checkOperation(safety, OperationType.Delete, 'GctsDeleteRepo');
  checkGit(safety, 'unlink');

  const path = `${GCTS_BASE}/repository/${encodeURIComponent(repoId)}`;
  await requestGcts(path, () => http.delete(path, JSON_HEADERS));
}
