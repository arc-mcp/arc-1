/**
 * MCP Server for ARC-1.
 *
 * Creates and starts the MCP server with 12 intent-based tools.
 * Supports two transports:
 * - stdio (default): for local MCP clients (Claude Desktop, Claude Code, Cursor)
 * - http-streamable: for remote/containerized deployments
 */

import { type ApiKeyEntry, createApiKeyVerifier, type Verifier } from '@arc-mcp/xsuaa-auth';
import type { BTPConfig, BTPProxyConfig, Destination, PerUserAuthTokens } from '@arc-mcp/xsuaa-auth/btp';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, type Implementation, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { AdtClient } from '../adt/client.js';
import type { AdtClientConfig } from '../adt/config.js';
import { resolveCookies } from '../adt/cookies.js';
import { AdtApiError } from '../adt/errors.js';
import { shouldWarnPreStatefulRelease } from '../adt/release.js';
import { deriveUserSafety, deriveUserSafetyFromProfile } from '../adt/safety.js';
import { Semaphore } from '../adt/semaphore.js';
import { hasRequiredScope } from '../authz/policy.js';
import type { Cache } from '../cache/cache.js';
import { CachingLayer } from '../cache/caching-layer.js';
import { MemoryCache } from '../cache/memory.js';
import { getToolRegistry, handleToolCall } from '../handlers/dispatch.js';
import {
  getCachedDiscovery,
  getCachedFeatures,
  setCachedDiscovery,
  setCachedFeatures,
} from '../handlers/feature-cache.js';
import type { ToolResult } from '../handlers/shared.js';
import { getToolDefinitions, type ToolDefinition, type ToolDefinitionOptions } from '../handlers/tools.js';
import { logAuthSummary } from './auth-summary.js';
import { API_KEY_PROFILES } from './config.js';
import { generateRequestId } from './context.js';
import { isActionDenied } from './deny-actions.js';
import { canonicalDestinationUrl, opaqueDestinationValue } from './destination-discovery.js';
import {
  DestinationRegistry,
  duplicateSingleTargetIds,
  sharedBasicSingleTargetConflicts,
  type TargetDescriptor,
  targetConnectionFingerprint,
} from './destination-registry.js';
import { authLibLogger, initLogger, logger } from './logger.js';
import { createMcpRateLimiter, type McpRateLimiter } from './mcp-rate-limit.js';
import { handleSharedBasicCall } from './multi-target-basic-auth.js';
import {
  RuntimeDestinationLevelError,
  resolveRuntimeSubaccountPpDestination,
} from './multi-target-destination-runtime.js';
import { ensureMultiTargetFeatureProbe, hasAuthorizationLimitedFeatureEvidence } from './multi-target-feature-state.js';
import {
  buildAggregateToolSurfaceConfig,
  buildMultiTargetConfig,
  TargetConfigChangedError,
  validateTargetDrift,
} from './multi-target-runtime.js';
import {
  buildMultiTargetServerInstructions,
  type MultiTargetErrorBuilder,
  type MultiTargetServerOptions,
  prepareMultiTargetCall,
  structuredToolError,
} from './multi-target-server.js';
import { MultiTargetSharedAuthState } from './multi-target-shared-auth-state.js';
import { injectTargetSchema, multiTargetToolDefinitions, sapTargetsDefinition } from './multi-target-tools.js';
import { loadPlugins } from './plugin-loader.js';
import { FileSink } from './sinks/file.js';
import { filterToolsByAuthScope } from './tool-auth.js';
import type { ServerConfig } from './types.js';
import { startLocalUiServer, type UiServerDeps } from './ui.js';
import { UiLogBufferSink } from './ui-log-buffer.js';

/** ARC-1 version */
export const VERSION = '1.0.0'; // x-release-please-version

// Soft warning for an unusually large served tools/list. It is re-sent on every conversation (a
// recurring token + latency cost), and some MCP clients cap tool-list size. CI's
// check-tool-schema-budget guards the built-in surface, but plugin (Custom_*) tools are added at
// runtime and invisible to CI — so warn once at serve time if the live list crosses the threshold.
const TOOLS_LIST_SOFT_WARN_BYTES = 60_000;
let warnedLargeToolsList = false;

/**
 * Resolve API-key provenance from the configured secret, not from AuthInfo.clientId.
 * XSUAA/OIDC also populate clientId, so a claim such as `azp=api-key:viewer` must
 * never make a JWT take the shared API-key path. This is a second, timing-safe
 * provenance check after the upstream verifier has already authenticated the token.
 */
function createConfiguredApiKeyVerifier(config: ServerConfig): Verifier | undefined {
  const entries: ApiKeyEntry[] = [];
  for (const entry of config.apiKeys ?? []) {
    if (!API_KEY_PROFILES[entry.profile]) continue;
    entries.push({ key: entry.key, clientId: `api-key:${entry.profile}` });
  }
  return entries.length > 0 ? createApiKeyVerifier(entries) : undefined;
}

async function configuredApiKeyProfile(verifier: Verifier | undefined, token: unknown): Promise<string | undefined> {
  if (!verifier || typeof token !== 'string') return undefined;
  try {
    const authInfo = await verifier(token);
    return authInfo.clientId?.startsWith('api-key:') ? authInfo.clientId.slice('api-key:'.length) : undefined;
  } catch {
    return undefined;
  }
}

function warnIfToolsListTooLarge(tools: ToolDefinition[]): void {
  if (warnedLargeToolsList) return;
  const bytes = Buffer.byteLength(JSON.stringify({ tools }), 'utf8');
  if (bytes <= TOOLS_LIST_SOFT_WARN_BYTES) return;
  warnedLargeToolsList = true;
  logger.warn(
    'Large tools/list payload — this adds tokens to every request, and some MCP clients cap tool-list size ' +
      '(tools may then fail to load). Consider ARC1_TOOL_MODE=hyperfocused, or reduce the surface (fewer enabled write/data/SQL/git scopes or plugins).',
    { bytes, tools: tools.length },
  );
}

function schemaNullableClientInfo(client?: Implementation): { clientName: string; clientVersion: string } {
  return {
    clientName: client?.name ?? 'unknown',
    clientVersion: client?.version ?? 'unknown',
  };
}

export function resolveNullableOptionals(config: ServerConfig, client?: Implementation): boolean {
  if (config.schemaNullableOptionals === 'on') return true;
  if (config.schemaNullableOptionals === 'off') return false;
  logger.debug('schema nullable optionals auto mode resolved to off', schemaNullableClientInfo(client));
  return false;
}

export function getToolDefinitionOptions(config: ServerConfig, client?: Implementation): ToolDefinitionOptions {
  return { nullableOptionals: resolveNullableOptionals(config, client) };
}

export function getConfiguredToolDefinitions(
  config: ServerConfig,
  textSearchAvailable?: boolean,
  resolvedFeatures?: Parameters<typeof getToolDefinitions>[2],
  client?: Implementation,
): ToolDefinition[] {
  return getToolDefinitions(config, textSearchAvailable, resolvedFeatures, getToolDefinitionOptions(config, client));
}

export { logAuthSummary } from './auth-summary.js';
export { filterToolsByAuthScope } from './tool-auth.js';

/** True only when bare /mcp can actually dispatch through resolved shared destination credentials. */
export function canUseSharedSingleTargetCredentials(
  config: Pick<ServerConfig, 'apiKeys' | 'ppEnabled' | 'ppStrict' | 'ppStrictExplicit'>,
  username: string | undefined,
  password: string | undefined,
): boolean {
  const nonJwtSharedCallAllowed = (config.apiKeys?.length ?? 0) > 0 && !(config.ppStrictExplicit && config.ppStrict);
  return !!(username && password) && (!config.ppEnabled || nonJwtSharedCallAllowed);
}

export interface SingleTargetOverlapState {
  readonly usesSharedBasic: boolean;
  readonly connectionFingerprint?: string;
}

/**
 * Describe the final bare-/mcp SAP connection for multi-target overlap checks.
 *
 * This runs after service-key/destination resolution so legacy SAP_URL credentials
 * and resolved BTP destinations follow the same physical-connection comparison.
 */
export function resolveSingleTargetOverlapState(
  config: Pick<
    ServerConfig,
    'apiKeys' | 'client' | 'password' | 'ppEnabled' | 'ppStrict' | 'ppStrictExplicit' | 'url' | 'username'
  >,
  proxy: Pick<BTPProxyConfig, 'locationId'> | undefined,
  hasBearerTokenProvider: boolean,
): SingleTargetOverlapState {
  const canonicalUrl = canonicalDestinationUrl(config.url);
  const connectionFingerprint = canonicalUrl
    ? targetConnectionFingerprint({
        urlFingerprint: opaqueDestinationValue(canonicalUrl),
        client: config.client,
        cloudConnectorLocationIdFingerprint: proxy?.locationId ? opaqueDestinationValue(proxy.locationId) : undefined,
      })
    : undefined;
  return Object.freeze({
    usesSharedBasic:
      !hasBearerTokenProvider && canUseSharedSingleTargetCredentials(config, config.username, config.password),
    ...(connectionFingerprint ? { connectionFingerprint } : {}),
  });
}

/** Build the base ADT client config (without per-user auth) */
// When perUser=true, strips shared credentials (username/password/cookies)
// so per-user PP clients never inherit admin auth.
//
// adtSemaphore (Layer 3): when provided, the constructed AdtClient shares this single
// server-wide semaphore with every other client built from this server. This is what
// makes ARC1_MAX_CONCURRENT a true server-wide cap rather than per-client.
export function buildAdtConfig(
  config: ServerConfig,
  btpProxy?: BTPProxyConfig,
  bearerTokenProvider?: () => Promise<string>,
  opts?: { perUser?: boolean },
  adtSemaphore?: Semaphore,
): Partial<AdtClientConfig> {
  const adtConfig: Partial<AdtClientConfig> = {
    baseUrl: config.url,
    client: config.client,
    language: config.language,
    insecure: config.insecure,
    disableSaml: config.disableSaml2,
    btpProxy,
    bearerTokenProvider,
    maxConcurrent: config.maxConcurrent,
    adtSemaphore,
    safety: {
      allowWrites: config.allowWrites,
      allowDataPreview: config.allowDataPreview,
      allowFreeSQL: config.allowFreeSQL,
      allowTransportWrites: config.allowTransportWrites,
      allowGitWrites: config.allowGitWrites,
      allowedPackages: config.allowedPackages,
      allowedTransports: config.allowedTransports,
      denyActions: config.denyActions,
    },
  };

  if (!opts?.perUser) {
    const cookies = resolveCookies(config.cookieFile, config.cookieString);
    adtConfig.username = config.username;
    adtConfig.password = config.password;
    if (cookies) {
      adtConfig.cookies = cookies;
    }
    adtConfig.cookieFile = config.cookieFile;
    adtConfig.cookieString = config.cookieString;
  }

  return adtConfig;
}

/**
 * Pick the Cloud Connector proxy for a per-user (principal-propagation) request.
 * Exported for unit testing.
 *
 * Only on-premise destinations tunnel through the Cloud Connector proxy. Internet
 * destinations (e.g. S/4HANA Public Cloud with SAMLAssertion) must connect directly —
 * returning a proxy here would wrongly route them through the SCC, since http.ts
 * proxies whenever btpProxy is set.
 *
 * For on-prem, the PP destination's own CloudConnectorLocationId overrides the startup
 * proxy's: dual-destination setups (SAP_BTP_DESTINATION vs SAP_BTP_PP_DESTINATION) may
 * point at different Cloud Connectors, and reusing the startup Location ID would route PP
 * requests to the wrong SCC (hard-to-debug 401/403/404).
 */
export function selectPerUserProxy(
  destination: Pick<Destination, 'ProxyType' | 'CloudConnectorLocationId'>,
  btpProxy: BTPProxyConfig | undefined,
): BTPProxyConfig | undefined {
  if (destination.ProxyType !== 'OnPremise' || !btpProxy) {
    return undefined;
  }
  return destination.CloudConnectorLocationId !== undefined
    ? { ...btpProxy, locationId: destination.CloudConnectorLocationId }
    : btpProxy;
}

/**
 * Create a per-user ADT client for principal propagation.
 *
 * Called per MCP request when ppEnabled=true and user JWT is available.
 * Looks up the BTP Destination with X-User-Token header to get per-user
 * auth tokens, then creates an ADT client that sends the
 * SAP-Connectivity-Authentication header with every request.
 *
 * The Cloud Connector uses this header to generate an X.509 cert
 * mapped to the SAP user via CERTRULE.
 */
/** Historical single-target dual-destination resolution. */
export function resolvePpDestinationName(config: ServerConfig): string | undefined {
  if (config.destinationName) {
    return config.destinationName;
  }
  return process.env.SAP_BTP_PP_DESTINATION || process.env.SAP_BTP_DESTINATION;
}

async function createPerUserClient(
  config: ServerConfig,
  btpConfig: BTPConfig,
  btpProxy: BTPProxyConfig | undefined,
  userJwt: string,
  adtSemaphore?: Semaphore,
  multiTarget?: { target: TargetDescriptor; instanceConfig: ServerConfig },
): Promise<AdtClient> {
  const { createConnectivityProxy, lookupDestinationWithUserToken } = await import('@arc-mcp/xsuaa-auth/btp');
  const destName = resolvePpDestinationName(config);
  if (!destName) {
    throw new Error('SAP_BTP_PP_DESTINATION or SAP_BTP_DESTINATION is required for principal propagation');
  }

  let destination: Destination;
  let authTokens: PerUserAuthTokens;
  try {
    ({ destination, authTokens } = multiTarget
      ? await resolveRuntimeSubaccountPpDestination(btpConfig, destName, userJwt)
      : await lookupDestinationWithUserToken(btpConfig, destName, userJwt, authLibLogger));
  } catch (error) {
    if (multiTarget && error instanceof RuntimeDestinationLevelError) {
      throw new TargetConfigChangedError(multiTarget.target.target, error.message);
    }
    throw error;
  }

  let resolvedUrl = destination.URL;
  if (multiTarget) {
    const drift = validateTargetDrift(destination, multiTarget.target, multiTarget.instanceConfig);
    if (!drift.ok) throw new TargetConfigChangedError(multiTarget.target.target, drift.message);
    resolvedUrl = drift.url;
  }

  const effectiveProxy = multiTarget
    ? (createConnectivityProxy(btpConfig, destination.CloudConnectorLocationId, authLibLogger) ?? undefined)
    : selectPerUserProxy(destination, btpProxy);

  const adtConfig = buildAdtConfig(config, effectiveProxy, undefined, { perUser: true }, adtSemaphore);
  // Override URL from destination (in case it differs from startup-resolved URL)
  adtConfig.baseUrl = resolvedUrl;
  // Set per-user auth for principal propagation.
  // Option 1 (Recommended): jwt-bearer exchanged token → Proxy-Authorization
  // Option 2 (Backward compat): SAML assertion → SAP-Connectivity-Authentication
  // Preserve the username for display only (e.g. SAPRead SYSTEM) by extracting it from the JWT.
  // Safety: the JWT signature was already verified by the OIDC middleware in http.ts —
  // we're just reading a claim from an already-trusted token. This value is never used
  // for auth or access control; the actual SAP identity comes from the SAML assertion.
  let displayUsername: string | undefined;
  try {
    const payload = JSON.parse(Buffer.from(userJwt.split('.')[1], 'base64url').toString());
    displayUsername = payload.user_name ?? payload.email ?? undefined;
  } catch {
    displayUsername = undefined;
  }

  applyPerUserAuthTokens(adtConfig, authTokens, displayUsername, destName);

  return new AdtClient(adtConfig);
}

/**
 * Map per-user auth tokens from the BTP Destination Service onto an AdtClientConfig.
 * Mutates and returns `adtConfig`. Exported for unit testing.
 *
 * Precedence (most-specific first):
 *  1. ppProxyAuth         — Option 1: jwt-bearer exchanged token → Proxy-Authorization (Cloud Connector)
 *  2. sapConnectivityAuth — Option 2: SAML assertion → SAP-Connectivity-Authentication (Cloud Connector)
 *  3. bearerToken         — OAuth2UserTokenExchange / OAuth2SAMLBearerAssertion: a user-context Bearer
 *                           token minted at the target's XSUAA → `Authorization: Bearer` (cloud-to-cloud,
 *                           e.g. a BTP ABAP Environment over the Internet — no Cloud Connector / proxy).
 *
 * Throws when none is present (PP could not produce a usable per-user credential).
 *
 * In every success branch the SAP password is cleared and `username` is set to a display-only
 * value — it is never used for auth or access control; the real SAP identity rides in the
 * chosen token/assertion.
 */
export function applyPerUserAuthTokens(
  adtConfig: Partial<AdtClientConfig>,
  authTokens: PerUserAuthTokens,
  displayUsername: string | undefined,
  destName: string,
): Partial<AdtClientConfig> {
  if (authTokens.ppProxyAuth) {
    adtConfig.ppProxyAuth = authTokens.ppProxyAuth;
  } else if (authTokens.sapConnectivityAuth) {
    adtConfig.sapConnectivityAuth = authTokens.sapConnectivityAuth;
  } else if (authTokens.bearerToken) {
    // createPerUserClient runs per request and the Cloud SDK caches the exchanged token per
    // user (TTL-bounded), so a provider returning the already-resolved token is fresh for the
    // request's lifetime.
    const bearer = authTokens.bearerToken;
    adtConfig.bearerTokenProvider = async () => bearer;
    logger.debug('PP: using destination-exchanged Bearer token (OAuth2UserTokenExchange)', {
      destination: destName,
    });
  } else if (authTokens.samlAssertionAuthorization) {
    // SAMLAssertion (e.g. S/4HANA Public Cloud developer extensibility — same flow BAS uses):
    // the Destination Service returns a ready-to-use Authorization header value (the assertion);
    // http.ts sends it verbatim as Authorization + `x-sap-security-session: create`.
    adtConfig.samlAuthorization = authTokens.samlAssertionAuthorization;
    logger.debug('PP: using SAMLAssertion Authorization header', { destination: destName });
  } else {
    // No per-user auth token received.
    throw new Error(
      `Principal propagation failed for destination '${destName}': ` +
        'no SAP-Connectivity-Authentication header, Bearer token, SAML assertion, or jwt-bearer exchange token returned. ' +
        'Check Cloud Connector status, destination configuration, and user JWT validity.',
    );
  }
  adtConfig.username = displayUsername;
  adtConfig.password = undefined;
  return adtConfig;
}

/**
 * Run a one-time feature probe against the SAP system using the shared/default client.
 * Returns a promise that resolves once probe results are stored in cachedFeatures.
 * In PP mode (when btpConfig is available for per-user client creation), auth failures
 * (401/403) on textSearch are treated as "unknown" so the tool schema doesn't hide
 * source_code from users who might have authorization. A shared Basic target is the narrow
 * exception: every caller uses the same reviewed SAP identity, so authorization-limited
 * evidence is definitive for that credential generation and may be cached.
 */
async function probeClientFeatures(
  config: ServerConfig,
  client: AdtClient,
  btpConfig?: BTPConfig,
  cacheAuthorizationLimitedEvidence = false,
): Promise<void> {
  const { defaultFeatureConfig } = await import('../adt/config.js');
  const { probeFeatures } = await import('../adt/features.js');
  const fc = defaultFeatureConfig();
  fc.hana = config.featureHana as 'auto' | 'on' | 'off';
  fc.abapGit = config.featureAbapGit as 'auto' | 'on' | 'off';
  fc.gcts = config.featureGcts as 'auto' | 'on' | 'off';
  fc.rap = config.featureRap as 'auto' | 'on' | 'off';
  fc.amdp = config.featureAmdp as 'auto' | 'on' | 'off';
  fc.ui5 = config.featureUi5 as 'auto' | 'on' | 'off';
  fc.transport = config.featureTransport as 'auto' | 'on' | 'off';
  fc.ui5repo = config.featureUi5Repo as 'auto' | 'on' | 'off';
  fc.flp = config.featureFlp as 'auto' | 'on' | 'off';
  const features = await probeFeatures(client.http, fc, config.systemType);
  if (
    !cacheAuthorizationLimitedEvidence &&
    config.ppEnabled &&
    btpConfig &&
    features.textSearch &&
    !features.textSearch.available
  ) {
    const reason = features.textSearch.reason ?? '';
    if (reason.includes('authorization') || reason.includes('401') || reason.includes('403')) {
      features.textSearch = undefined;
    }
  }
  if (config.targetId && !cacheAuthorizationLimitedEvidence && hasAuthorizationLimitedFeatureEvidence(features)) {
    throw new Error(
      'Multi-target feature evidence remains unknown because one or more probes were authorization-limited.',
    );
  }
  // Log authorization probe results
  if (features.authProbe) {
    const ap = features.authProbe;
    if (ap.searchAccess) {
      logger.info('Authorization probe: object search access is available');
    } else {
      logger.warn(`Authorization probe: object search access denied — ${ap.searchReason ?? 'unknown reason'}`);
    }
    if (ap.transportAccess) {
      logger.info('Authorization probe: transport access is available');
    } else {
      logger.info(`Authorization probe: transport access is not available — ${ap.transportReason ?? 'unknown reason'}`);
    }
  }
  const featureKey = config.targetId ?? config.destinationName;
  setCachedFeatures(features, featureKey);
  // Proactive warning: on SAP_BASIS < 7.51 the ADT REST handler does not honor the
  // stateful-session header over HTTP, so object writes fail with 423 "invalid lock
  // handle" until the abapfs_extensions enhancement is installed. Warn at startup —
  // before the first cryptic 423 — but only when writes are enabled (issue #293).
  if (shouldWarnPreStatefulRelease(config.allowWrites, features.abapRelease)) {
    logger.warn(
      `SAP_BASIS ${features.abapRelease} is below 7.51 and does not natively honor stateful ADT ` +
        'HTTP sessions — object writes will fail with 423 "invalid lock handle" UNLESS the ' +
        'abapfs_extensions enhancement is installed on the SAP system ' +
        '(https://github.com/marcellourbani/abapfs_extensions). If writes already work, this is ' +
        'installed and you can ignore this. See docs/sap-trial-setup.md (423 troubleshooting).',
    );
  }
  setCachedDiscovery(features.discoveryMap ?? new Map(), featureKey);
}

export function runStartupProbe(
  config: ServerConfig,
  btpProxy?: BTPProxyConfig,
  bearerTokenProvider?: () => Promise<string>,
  btpConfig?: BTPConfig,
  adtSemaphore?: Semaphore,
): Promise<void> {
  const client = new AdtClient(buildAdtConfig(config, btpProxy, bearerTokenProvider, undefined, adtSemaphore));
  return (async () => {
    try {
      await probeClientFeatures(config, client, btpConfig);
    } catch {
      setCachedDiscovery(new Map(), config.targetId ?? config.destinationName);
      // Probe failed (e.g., SAP system unreachable) — continue with default tool set
    }
  })();
}

export interface StartupAuthPreflightResult {
  status: 'ok' | 'failed' | 'inconclusive' | 'skipped';
  /** When true, shared-client SAP tool calls must be blocked to prevent repeated auth failures. */
  blocking: boolean;
  endpoint: string;
  checkedAt: string;
  statusCode?: number;
  reason: string;
}

const STARTUP_AUTH_ENDPOINT = '/sap/bc/adt/core/discovery';

function buildStartupAuthFailureReason(statusCode: number, config: ServerConfig): string {
  if (statusCode === 401) {
    // Only SAP_COOKIE_FILE supports hot-reload: the file is re-read on the next request.
    // SAP_COOKIE_STRING is a static env var read once at process start — it cannot
    // change in the running process, so we must not promise "no restart needed".
    if (config.cookieFile) {
      return (
        'Authentication failed (401) during startup auth preflight. ' +
        'Your SAP cookies have expired. Re-extract them with `arc1-cli extract-cookies` — no restart needed, the next SAP call will reload them automatically.'
      );
    }
    if (config.cookieString) {
      return (
        'Authentication failed (401) during startup auth preflight. ' +
        'SAP_COOKIE_STRING is a static value and cannot be hot-reloaded. ' +
        'Restart ARC-1 with a refreshed SAP_COOKIE_STRING, or switch to SAP_COOKIE_FILE for automatic reload on the next request.'
      );
    }
    return (
      'Authentication failed (401) during startup auth preflight. ' +
      'Check SAP_USER/SAP_PASSWORD/SAP_CLIENT (or destination/service-key credentials), then restart ARC-1.'
    );
  }
  if (statusCode === 403) {
    return (
      'Access forbidden (403) during startup auth preflight. ' +
      'The configured SAP user lacks ADT authorization (for example S_ADT_RES). ' +
      'Fix authorizations, then restart ARC-1.'
    );
  }
  return `Startup auth preflight failed with HTTP ${statusCode}.`;
}

/**
 * Run a startup auth preflight for shared-credential mode.
 *
 * Goal: detect invalid technical/shared credentials once at startup and avoid
 * repeated failed SAP requests from the first LLM tool call onward.
 *
 * Behavior:
 * - Never throws (server must stay up)
 * - PP mode and no-URL mode are skipped (non-blocking)
 * - 401/403 are blocking failures
 * - Network/other failures are inconclusive (non-blocking)
 */
export async function runStartupAuthPreflight(
  config: ServerConfig,
  btpProxy?: BTPProxyConfig,
  bearerTokenProvider?: () => Promise<string>,
  adtSemaphore?: Semaphore,
): Promise<StartupAuthPreflightResult> {
  const checkedAt = new Date().toISOString();
  const endpoint = STARTUP_AUTH_ENDPOINT;

  if (config.ppEnabled) {
    const reason = 'Skipped startup auth preflight: principal propagation mode is enabled (per-user auth at runtime).';
    logger.info(reason);
    return { status: 'skipped', blocking: false, endpoint, checkedAt, reason };
  }

  if (!config.url) {
    const reason = 'Skipped startup auth preflight: SAP_URL is not configured.';
    logger.info(reason);
    return { status: 'skipped', blocking: false, endpoint, checkedAt, reason };
  }

  try {
    const client = new AdtClient(buildAdtConfig(config, btpProxy, bearerTokenProvider, undefined, adtSemaphore));
    await client.http.get(endpoint);
    const reason = 'Startup auth preflight succeeded for shared SAP credentials.';
    logger.info(reason, { endpoint });
    return { status: 'ok', blocking: false, endpoint, checkedAt, reason };
  } catch (err) {
    if (err instanceof AdtApiError && (err.statusCode === 401 || err.statusCode === 403)) {
      const reason = buildStartupAuthFailureReason(err.statusCode, config);
      // Non-blocking downgrade only applies to cookieFile mode — that's the path
      // the runtime client can actually recover from via the lazy reload. cookieString
      // is static; downgrading there would just defer the same failure to the first
      // tool call without giving the operator a way to fix it without restart.
      if (config.cookieFile && err.statusCode === 401) {
        logger.warn(`${reason} (non-blocking: runtime cookie reload will retry)`, { endpoint, statusCode: 401 });
        return { status: 'inconclusive', blocking: false, endpoint, checkedAt, statusCode: 401, reason };
      }
      logger.warn(reason, { endpoint, statusCode: err.statusCode });
      return {
        status: 'failed',
        blocking: true,
        endpoint,
        checkedAt,
        statusCode: err.statusCode,
        reason,
      };
    }

    const detail = err instanceof Error ? err.message : String(err);
    const reason =
      'Startup auth preflight was inconclusive (non-auth failure). ' +
      'Continuing and letting runtime requests handle connectivity diagnostics.';
    logger.warn(reason, { endpoint, error: detail });
    return { status: 'inconclusive', blocking: false, endpoint, checkedAt, reason };
  }
}

export function formatStartupAuthPreflightToolError(preflight: StartupAuthPreflightResult): string {
  const code = preflight.statusCode ? ` (HTTP ${preflight.statusCode})` : '';
  return (
    `Startup authentication preflight failed${code}. ` +
    'ARC-1 is blocking shared SAP tool calls to avoid repeated failed logins and possible user lockout.\n\n' +
    `${preflight.reason}\n` +
    `Preflight endpoint: ${preflight.endpoint}\n` +
    `Checked at: ${preflight.checkedAt}`
  );
}

/** Sent in the MCP initialize response. Clients that defer tool loading (Claude Code enables tool
 *  search by default) use this to decide whether to look for ARC-1's tools at all, so it names the
 *  domain first. Keep under 2 KB — Claude Code truncates server instructions silently. */
const SERVER_INSTRUCTIONS = [
  'ARC-1 gives this SAP ABAP system a read/write interface over SAP ADT: ABAP source (classes,',
  'programs, function modules, includes), CDS/RAP artifacts (DDLS, BDEF, SRVD, SRVB), DDIC objects',
  '(tables, domains, data elements), transports, abapGit/gCTS, ATC and ABAP Unit, SQL/table data,',
  'and syntax/activation. Reach for it for any question about ABAP objects, CDS views, transport',
  'requests, or dumps/traces on this system.',
  '',
  'Token-cheap paths, in order — a bare full read is the expensive last resort:',
  '- Understanding an object: SAPContext(action="deps") returns compressed contracts, not source',
  '  (measured 14-264x smaller than SAPRead on the same class).',
  '- One method: SAPRead(type="CLAS", method="name"). Survey signatures: method="*".',
  '- Finding a string: SAPRead(grep="pattern") instead of reading the whole object.',
  '- Blast radius of a CDS change: SAPContext(action="impact").',
  'Where-used, usages, impact and transport lists are paged: they report a complete "total"/summary',
  'alongside a capped page — trust that count, not the page length. Other list actions are unpaged.',
  '',
  'One SAP system per instance: there is no system/destination selector, by design.',
].join('\n');

export interface CreateServerOptions {
  btpProxy?: BTPProxyConfig;
  btpConfig?: BTPConfig;
  bearerTokenProvider?: () => Promise<string>;
  cachingLayer?: CachingLayer;
  startupProbePromise?: Promise<void>;
  startupAuthPreflightPromise?: Promise<StartupAuthPreflightResult>;
  adtSemaphore?: Semaphore;
  mcpRateLimiter?: McpRateLimiter;
  multiTarget?: MultiTargetServerOptions;
}

export function createServer(config: ServerConfig, options: CreateServerOptions = {}): Server {
  const {
    btpProxy,
    btpConfig,
    bearerTokenProvider,
    cachingLayer,
    startupProbePromise,
    startupAuthPreflightPromise,
    adtSemaphore,
    mcpRateLimiter,
    multiTarget,
  } = options;
  const server = new Server(
    { name: config.serverName, version: VERSION },
    {
      capabilities: { tools: { listChanged: true } },
      instructions: multiTarget ? buildMultiTargetServerInstructions(multiTarget) : SERVER_INSTRUCTIONS,
    },
  );
  const apiKeyProvenanceVerifier = createConfiguredApiKeyVerifier(config);

  // Create default ADT client (shared, uses startup-time credentials or OAuth bearer).
  // Passes the shared server-wide semaphore so per-user PP clients (created at request
  // time) share the same Layer 3 concurrency cap.
  const defaultClient = multiTarget
    ? undefined
    : new AdtClient(buildAdtConfig(config, btpProxy, bearerTokenProvider, undefined, adtSemaphore));

  // Cookie-auth preflight propagation: when startup preflight returned a non-blocking
  // 401 in SAP_COOKIE_FILE mode, the throwaway preflight client marked itself stale —
  // but the long-lived defaultClient was constructed independently with cookies read at
  // startup and is unaware. Without explicit propagation, the first real tool call would
  // re-emit the same stale cookies and hit 401 again before the lazy reload triggers,
  // wasting one round-trip per startup-stale-cookie cycle. We propagate the stale state
  // once on first tool call — idempotent flag keeps later calls O(1).
  let preflightStalePropagated = false;
  let schemaNullableAutoClientInfoLogged = false;

  // Register tool listing — filtered by user's scopes when auth is active
  server.setRequestHandler(ListToolsRequestSchema, async (_request, extra) => {
    // Never wait for the startup probe here. tools/list is protocol handshake, not SAP work:
    // clients cancel it on their own schedule (Cline at ~5s) and a probe against a real system
    // can outlast that, which used to leave the client with zero tools. Answer from whatever is
    // cached now — unknown features yield a SUPERSET of the probed surface, never a subset, so
    // nothing is ever missing — and let tools/list_changed deliver the narrowed list below.
    const featureKey = config.targetId ?? config.destinationName;
    // Multi-target schemas are immutable process contracts. User-backed feature probes may
    // improve runtime errors, but must never rewrite another user's tools/list response.
    const features = multiTarget ? undefined : getCachedFeatures(featureKey);
    const clientVersion = server.getClientVersion();
    if (config.schemaNullableOptionals === 'auto' && !schemaNullableAutoClientInfoLogged) {
      schemaNullableAutoClientInfoLogged = true;
      logger.info('schema nullable optionals auto mode clientInfo', {
        ...schemaNullableClientInfo(clientVersion),
        resolvedNullableOptionals: false,
      });
    }
    let tools = getConfiguredToolDefinitions(config, features?.textSearch?.available, features, clientVersion);

    if (multiTarget) {
      tools =
        !multiTarget.registry.available ||
        (multiTarget.mode === 'aggregate' && multiTarget.registry.targets.length === 0)
          ? []
          : multiTargetToolDefinitions(tools, config);
      if (multiTarget.mode === 'aggregate') {
        if (tools.length > 0) tools = tools.map((tool) => injectTargetSchema(tool, multiTarget.registry.targets));
        const isAdmin = extra.authInfo ? hasRequiredScope(extra.authInfo.scopes, 'admin') : false;
        if (multiTarget.registry.targets.length > 1 || isAdmin) tools.push(sapTargetsDefinition());
      }
    }

    // When authenticated, only show tools the user has scopes for
    if (extra.authInfo) {
      tools = filterToolsByAuthScope(tools, extra.authInfo.scopes, config.denyActions);
    }

    // FEAT-61: append plugin (Custom_*) tools, gated identically to built-ins (deny-list + scope +
    // `availableOn` system-type visibility). Hyperfocused mode is out of scope for plugins (spec §10),
    // so its single `SAP` tool is the only surface there.
    if (!multiTarget && config.toolMode !== 'hyperfocused') {
      const systemType = features?.systemType;
      for (const entry of getToolRegistry().list()) {
        if (entry.source !== 'plugin' || !entry.listing) continue;
        if (isActionDenied(entry.name, undefined, config.denyActions)) continue;
        if (extra.authInfo && !hasRequiredScope(extra.authInfo.scopes, entry.policy.scope)) continue;
        // Only filter when the system type is KNOWN and the tool declares a non-matching target.
        if (entry.availableOn && entry.availableOn !== 'all' && systemType && entry.availableOn !== systemType) {
          continue;
        }
        tools.push({
          name: entry.name,
          description: entry.listing.description,
          inputSchema: entry.listing.inputSchema,
        });
      }
    }

    warnIfToolsListTooLarge(tools);
    return { tools };
  });

  // Register tool call handler — passes authInfo for scope enforcement + audit logging
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const requestId = generateRequestId();
    const toolName = request.params.name;
    const rawArgs = (request.params.arguments ?? {}) as Record<string, unknown>;
    let args = rawArgs;
    let activeConfig = config;
    let selectedTarget: TargetDescriptor | undefined;
    let multiTargetMcpRateLimitConsumed = false;
    let multiError: MultiTargetErrorBuilder = (code, message, details = {}) =>
      structuredToolError(code, message, details);

    if (multiTarget) {
      const prepared = await prepareMultiTargetCall({
        options: multiTarget,
        toolName,
        rawArgs,
        requestId,
        authInfo: extra.authInfo,
        mcpRateLimiter,
      });
      if (prepared.handled) return prepared.result;
      args = prepared.args;
      activeConfig = prepared.activeConfig;
      selectedTarget = prepared.selectedTarget;
      multiError = prepared.error;
      multiTargetMcpRateLimitConsumed = prepared.mcpRateLimitConsumed;
    }

    if (startupAuthPreflightPromise && !multiTarget) {
      const startupAuth = await startupAuthPreflightPromise;
      if (startupAuth.blocking) {
        return {
          content: [
            {
              type: 'text' as const,
              text: formatStartupAuthPreflightToolError(startupAuth),
            },
          ],
          isError: true,
        } as Record<string, unknown>;
      }
      // Non-blocking 401 from cookie-auth preflight → mark the runtime client's cookies
      // stale so its first call goes straight to the lazy reload path instead of repeating
      // the failure. Fires once per process; subsequent calls early-return.
      if (!preflightStalePropagated && startupAuth.status === 'inconclusive' && startupAuth.statusCode === 401) {
        defaultClient?.http.markCookiesStale();
        preflightStalePropagated = true;
      }
    }

    // Principal propagation: create per-user ADT client if enabled and user JWT available.
    // Resolve API-key provenance from the configured secret before checking JWT shape,
    // so dotted API keys remain supported without trusting the cross-verifier clientId field.
    let client = defaultClient;
    let isPerUserClient = false;
    const token = extra.authInfo?.token;
    const apiKeyProfile = await configuredApiKeyProfile(apiKeyProvenanceVerifier, token);
    const isApiKey = apiKeyProfile !== undefined;
    const isJwt = !isApiKey && typeof token === 'string' && token.split('.').length === 3;

    const dispatchWithClient = async (
      resolvedClient: AdtClient,
      perUserClient: boolean,
      postDispatchResult?: () => ToolResult | undefined,
    ) => {
      if (multiTarget && btpConfig) {
        try {
          const targetKey = activeConfig.targetId;
          const cacheAuthorizationLimitedEvidence = selectedTarget?.authentication === 'BasicAuthentication';
          await ensureMultiTargetFeatureProbe(
            targetKey,
            !!targetKey && !!getCachedFeatures(targetKey),
            () => probeClientFeatures(activeConfig, resolvedClient, btpConfig, cacheAuthorizationLimitedEvidence),
            () => setCachedFeatures(undefined, targetKey),
          );
        } catch {
          // Feature evidence stays unknown. The requested operation still gets one direct attempt.
        }
      }

      const featureKey = activeConfig.targetId ?? activeConfig.destinationName;
      resolvedClient.http.setDiscoveryMap(getCachedDiscovery(featureKey));

      let effectiveClient = resolvedClient;
      if (apiKeyProfile) {
        const profile = API_KEY_PROFILES[apiKeyProfile];
        if (profile) {
          const effectiveSafety = deriveUserSafetyFromProfile(resolvedClient.safety, profile.safety);
          effectiveClient = resolvedClient.withSafety(effectiveSafety);
        }
      } else if (extra.authInfo?.scopes) {
        const effectiveSafety = deriveUserSafety(resolvedClient.safety, extra.authInfo.scopes);
        effectiveClient = resolvedClient.withSafety(effectiveSafety);
      }
      effectiveClient.http.setDiscoveryMap(getCachedDiscovery(featureKey));

      const result = await handleToolCall(
        effectiveClient,
        activeConfig,
        toolName,
        args,
        extra.authInfo,
        server,
        multiTarget ? undefined : cachingLayer,
        perUserClient,
        multiTargetMcpRateLimitConsumed ? undefined : mcpRateLimiter,
        requestId,
        postDispatchResult,
      );
      return { ...result } as Record<string, unknown>;
    };

    if (selectedTarget?.authentication === 'BasicAuthentication') {
      return handleSharedBasicCall({
        isJwt,
        btpConfig,
        sharedAuthState: multiTarget?.sharedAuthState,
        instanceConfig: multiTarget?.instanceConfig ?? activeConfig,
        target: selectedTarget,
        requestId,
        user: (extra.authInfo?.extra?.userName ?? extra.authInfo?.clientId) as string | undefined,
        clientId: extra.authInfo?.clientId,
        toolName,
        multiError,
        buildClientConfig: (proxy) => buildAdtConfig(activeConfig, proxy, undefined, undefined, adtSemaphore),
        dispatch: (basicClient, postDispatchResult) => dispatchWithClient(basicClient, false, postDispatchResult),
      });
    }

    if (activeConfig.ppEnabled && isJwt) {
      const ppUser = (extra.authInfo?.extra?.userName ?? extra.authInfo?.clientId) as string | undefined;
      const ppDest = resolvePpDestinationName(activeConfig) ?? '';
      if (!btpConfig) {
        const errMsg = 'BTP runtime configuration is unavailable for principal propagation';
        logger.emitAudit({
          timestamp: new Date().toISOString(),
          level: 'error',
          event: 'auth_pp_created',
          requestId,
          user: ppUser,
          destination: activeConfig.targetId ? undefined : ppDest,
          target: activeConfig.targetId,
          identity: activeConfig.targetId ? 'per-user' : undefined,
          success: false,
          errorMessage: errMsg,
        });
        if (multiTarget) {
          return multiError(
            'PP_SETUP_FAILED',
            `Principal propagation for ${selectedTarget?.target ?? 'the selected target'} cannot start because BTP runtime configuration is unavailable. Fix the service bindings, then try again now.`,
            { retryable: true },
            'pp_exchange_failed',
          );
        }
        return {
          content: [{ type: 'text' as const, text: `Principal propagation failed: ${errMsg}` }],
          isError: true,
        } as Record<string, unknown>;
      }
      try {
        client = await createPerUserClient(
          activeConfig,
          btpConfig,
          btpProxy,
          token,
          adtSemaphore,
          selectedTarget
            ? { target: selectedTarget, instanceConfig: multiTarget?.instanceConfig ?? config }
            : undefined,
        );
        isPerUserClient = true;
        logger.emitAudit({
          timestamp: new Date().toISOString(),
          level: 'info',
          event: 'auth_pp_created',
          requestId,
          user: ppUser,
          destination: activeConfig.targetId ? undefined : ppDest,
          target: activeConfig.targetId,
          identity: activeConfig.targetId ? 'per-user' : undefined,
          success: true,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.emitAudit({
          timestamp: new Date().toISOString(),
          level: 'error',
          event: 'auth_pp_created',
          requestId,
          user: ppUser,
          destination: activeConfig.targetId ? undefined : ppDest,
          target: activeConfig.targetId,
          identity: activeConfig.targetId ? 'per-user' : undefined,
          success: false,
          errorMessage: errMsg,
        });
        // A JWT-authenticated request must never change SAP identity after a PP error.
        // Non-JWT API-key requests still use the shared client through the branch below.
        if (multiTarget) {
          const changed = err instanceof TargetConfigChangedError;
          return multiError(
            changed ? 'TARGET_CONFIG_CHANGED' : 'PP_SETUP_FAILED',
            changed
              ? err.message
              : `Principal propagation for ${selectedTarget?.target ?? 'the selected target'} failed. Check the user mapping and destination/Cloud Connector setup, then ask the client to try again now.`,
            { retryable: !changed },
            changed ? undefined : 'pp_exchange_failed',
          );
        }
        return {
          content: [{ type: 'text' as const, text: `Principal propagation failed: ${errMsg}` }],
          isError: true,
        } as Record<string, unknown>;
      }
    } else if (activeConfig.ppStrictExplicit && activeConfig.ppStrict && activeConfig.ppEnabled && !isJwt) {
      // Strict mode with non-JWT token (e.g., API key) — reject
      if (multiTarget) {
        return multiError(
          'PP_SETUP_FAILED',
          'Multi-target routes require an XSUAA JWT for strict principal propagation. Sign in with XSUAA and try again.',
          { retryable: true },
          'pp_exchange_failed',
        );
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Principal propagation requires a JWT token (SAP_PP_STRICT=true). API key authentication is not supported in strict PP mode.',
          },
        ],
        isError: true,
      } as Record<string, unknown>;
    }

    if (!client) {
      return multiTarget
        ? multiError(
            'PP_SETUP_FAILED',
            'A per-user SAP client could not be created. Fix principal propagation, then try again now.',
            { retryable: true },
            'pp_exchange_failed',
          )
        : structuredToolError('PP_SETUP_FAILED', 'A per-user SAP client could not be created.', { retryable: true });
    }

    return dispatchWithClient(client, isPerUserClient);
  });

  // Discovery finished after we already answered tools/list with the unprobed superset — tell the
  // client so it can re-fetch and drop what this system does not actually have. stdio only: the
  // HTTP transport builds a fresh Server per request (see serveMcpRequest), so no instance outlives
  // a request to deliver this, and none needs to — by then the probe is cached and the first
  // tools/list of every request is already the narrowed list.
  if (startupProbePromise && !multiTarget && config.transport === 'stdio') {
    startupProbePromise
      .then(() => server.sendToolListChanged())
      .catch((err) => {
        // Best-effort: a client that never connected (or disconnected) must not crash startup.
        logger.debug('Skipped tools/list_changed notification after startup probe', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }

  return server;
}

/**
 * Create a CachingLayer based on config.
 * Returns undefined if caching is disabled.
 *
 * SqliteCache is loaded dynamically so that better-sqlite3 (a native module)
 * is only required when actually used. This allows the server to start in
 * memory-cache or no-cache mode even when better-sqlite3 is not installed
 * (e.g. cross-platform deploys where native binaries were compiled elsewhere).
 */
export async function createCachingLayer(config: ServerConfig): Promise<CachingLayer | undefined> {
  const mode = config.cacheMode;

  if (mode === 'none') return undefined;

  let cache: Cache;
  if (mode === 'sqlite') {
    logger.warn(
      'ARC1_CACHE=sqlite stores SAP source in plaintext at rest; use ARC1_CACHE=memory/none or encrypted storage for IP-sensitive landscapes.',
    );
    // Persistent cache is explicit opt-in because SQLite stores full source bodies.
    try {
      const { SqliteCache } = await import('../cache/sqlite.js');
      cache = new SqliteCache(config.cacheFile);
    } catch (err) {
      logger.warn('SQLite cache unavailable (better-sqlite3 not loaded) — falling back to memory cache', {
        error: err instanceof Error ? err.message : String(err),
      });
      cache = new MemoryCache();
    }
  } else {
    // Memory cache for auto/default and explicit memory mode. Avoids source-at-rest by default.
    cache = new MemoryCache();
  }

  const maxActivityEntries = config.uiMode === 'off' ? 0 : undefined;
  return new CachingLayer(cache, maxActivityEntries);
}

/**
 * Create and start the MCP server.
 */
export async function createAndStartServer(
  config: ServerConfig,
  sources?: Record<string, import('./types.js').ConfigSource>,
): Promise<Server> {
  initLogger(config.logFormat, config.verbose);
  const startedAt = new Date().toISOString();
  const uiLogBuffer = config.uiMode !== 'off' ? new UiLogBufferSink() : undefined;
  if (uiLogBuffer) {
    logger.addSink(uiLogBuffer);
  }
  logAuthSummary(config);

  // Effective-policy log + contradiction warnings (Task 8 observability).
  // Sources is optional for test callers — defaults to 'default' for all fields.
  const effectiveSources = sources ?? {};
  const { logEffectivePolicy, detectContradictions, logContradictions } = await import('./effective-policy-log.js');
  logEffectivePolicy(config, effectiveSources, logger);
  logContradictions(detectContradictions(config), logger);

  // FEAT-61: load extension plugins (Custom_* tools) into the shared registry before serving.
  // Fail-fast: a malformed plugin or name collision throws here and refuses server start.
  if (config.plugins?.length) {
    await loadPlugins(config.plugins, getToolRegistry());
  }

  // Add file sink if configured
  if (config.logFile) {
    logger.addSink(new FileSink(config.logFile));
    logger.info('File logging enabled', { logFile: config.logFile });
  }

  // Add BTP Audit Log sink if auditlog service is bound (auto-detected from VCAP_SERVICES)
  try {
    const { BTPAuditLogSink, parseBTPAuditLogConfig } = await import('./sinks/btp-auditlog.js');
    const auditLogConfig = parseBTPAuditLogConfig();
    if (auditLogConfig) {
      logger.addSink(new BTPAuditLogSink(auditLogConfig));
      logger.info('BTP Audit Log sink enabled', { url: auditLogConfig.url });
    }
  } catch (err) {
    logger.warn('BTP Audit Log sink initialization failed (optional)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Emit structured server_start audit event
  logger.emitAudit({
    timestamp: new Date().toISOString(),
    level: 'info',
    event: 'server_start',
    version: VERSION,
    transport: config.transport,
    allowWrites: config.allowWrites,
    url: config.url || '(not configured)',
    pid: process.pid,
  });

  logger.info('ARC-1 starting', {
    version: VERSION,
    transport: config.transport,
    url: config.url || '(not configured)',
    allowWrites: config.allowWrites,
  });

  // Pre-flight: warn clearly when no SAP connection is configured so users know
  // why all feature probes will fail (rather than seeing cryptic network errors).
  const hasBtpConnection = !!(
    config.btpServiceKey ||
    config.btpServiceKeyFile ||
    process.env.SAP_BTP_DESTINATION ||
    config.multiTargetEndpoints
  );
  if (!config.url && !hasBtpConnection) {
    logger.warn(
      'SAP_URL is not configured — no SAP system connection available. ' +
        'Copy .env.example to .env and set SAP_URL, SAP_USER, SAP_PASSWORD (or configure SAP_BTP_DESTINATION / SAP_BTP_SERVICE_KEY_FILE).',
    );
  }

  // Resolve BTP ABAP Environment direct connection (service key + OAuth)
  let bearerTokenProvider: (() => Promise<string>) | undefined;
  if (config.btpServiceKey || config.btpServiceKeyFile) {
    const { resolveServiceKey, createBearerTokenProvider } = await import('../adt/oauth.js');

    // Temporarily set env vars so resolveServiceKey picks them up
    if (config.btpServiceKey) process.env.SAP_BTP_SERVICE_KEY = config.btpServiceKey;
    if (config.btpServiceKeyFile) process.env.SAP_BTP_SERVICE_KEY_FILE = config.btpServiceKeyFile;

    const serviceKey = resolveServiceKey();
    if (!serviceKey) {
      throw new Error(
        'BTP service key configured but could not be resolved — check SAP_BTP_SERVICE_KEY or SAP_BTP_SERVICE_KEY_FILE',
      );
    }

    // Override URL from service key (abap.url takes precedence over url)
    config.url = serviceKey.abap?.url ?? serviceKey.url;
    // Override client from service key if available
    if (serviceKey.abap?.sapClient) {
      config.client = serviceKey.abap.sapClient;
    }

    bearerTokenProvider = createBearerTokenProvider(serviceKey, config.btpOAuthCallbackPort);

    logger.info('BTP ABAP Environment configured (service key)', {
      url: config.url,
      uaaUrl: serviceKey.uaa.url,
      callbackPort: config.btpOAuthCallbackPort || 'auto',
    });
  }

  // Resolve the optional single-target destination. It remains independent from discovered targets.
  let btpProxy: BTPProxyConfig | undefined;
  let btpConfig: BTPConfig | undefined;
  const btpDestination = process.env.SAP_BTP_DESTINATION;
  if (btpDestination) {
    const { resolveBTPDestination, parseVCAPServices } = await import('@arc-mcp/xsuaa-auth/btp');
    const resolved = await resolveBTPDestination(btpDestination, authLibLogger);
    config.url = resolved.url;
    config.username = resolved.username;
    config.password = resolved.password;
    config.client = resolved.client;
    btpProxy = resolved.proxy ?? undefined;

    // Keep btpConfig for per-user destination lookup (principal propagation)
    if (config.ppEnabled) {
      btpConfig = parseVCAPServices() ?? undefined;
      logger.info('Principal propagation enabled', {
        destination: btpDestination,
        hasBtpConfig: !!btpConfig,
      });
    }

    logger.info('BTP destination resolved', {
      destination: btpDestination,
      hasUrl: !!resolved.url,
      hasSharedCredentials: !!(resolved.username && resolved.password),
      hasProxy: !!btpProxy,
      ppEnabled: config.ppEnabled,
    });
  }

  const singleTargetOverlap = resolveSingleTargetOverlapState(config, btpProxy, !!bearerTokenProvider);
  const singleTargetConnectionFingerprint = singleTargetOverlap.connectionFingerprint;
  const singleTargetUsesSharedBasic = singleTargetOverlap.usesSharedBasic;

  // Destination-discovered multi-target snapshot. Discovery failure degrades only the new routes.
  let registry: DestinationRegistry | undefined;
  if (config.multiTargetEndpoints) {
    const { parseVCAPServices } = await import('@arc-mcp/xsuaa-auth/btp');
    btpConfig ??= parseVCAPServices() ?? undefined;
    if (
      !btpConfig?.destinationUrl ||
      !btpConfig.destinationClientId ||
      !btpConfig.destinationSecret ||
      !btpConfig.connectivityProxyHost ||
      !btpConfig.connectivityClientId
    ) {
      throw new Error(
        'ARC1_MULTI_TARGET_ENDPOINTS=true requires Destination and Connectivity service bindings in VCAP_SERVICES.',
      );
    }
    try {
      const { discoverDestinations } = await import('./destination-discovery.js');
      registry = DestinationRegistry.fromDiscovery(await discoverDestinations(btpConfig), config);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Destination discovery failed.';
      registry = DestinationRegistry.unavailable({ code: 'REGISTRY_DISCOVERY_ERROR', message });
      logger.error('Multi-target destination discovery failed', { error: message });
    }
    logger.info('Multi-target registry loaded', {
      available: registry.available,
      targets: registry.targets.length,
      quarantined: registry.diagnostics.filter((entry) => entry.status === 'quarantined').length,
      disabled: registry.diagnostics.filter((entry) => entry.status === 'disabled').length,
      revision: registry.revision,
      failure: registry.failure?.code,
    });
    const duplicateSingleTargets = duplicateSingleTargetIds(
      registry,
      [btpDestination, process.env.SAP_BTP_PP_DESTINATION],
      singleTargetConnectionFingerprint,
    );
    const duplicateSharedBasicTargets = sharedBasicSingleTargetConflicts(
      registry,
      // Only SAP_BTP_DESTINATION can supply the bare /mcp shared credentials.
      // SAP_BTP_PP_DESTINATION belongs exclusively to the JWT PP path and may
      // legitimately name a discovered target without creating a shared-identity overlap.
      btpDestination,
      singleTargetConnectionFingerprint,
      singleTargetUsesSharedBasic,
    );
    if (duplicateSharedBasicTargets.length > 0) {
      throw new Error(
        `A shared Basic SAP connection cannot be exposed through both /mcp and multi-target routes in v1 (${duplicateSharedBasicTargets.join(', ')}). Remove one exposure and restart ARC-1.`,
      );
    }
    if (duplicateSingleTargets.length > 0) {
      logger.warn(
        'The single-target /mcp connection is also exposed by discovered multi-target routes. Both remain active, but their policies can differ; verify that this duplicate exposure is intentional.',
        { targets: duplicateSingleTargets },
      );
    }
    if (config.multiTargetAllowBasicAuth) {
      logger.warn(
        'Experimental multi-target Basic authentication is enabled: Basic targets use a shared SAP identity, ' +
          'are visible to all read-scoped users, remain mutation-free, and require exactly one CF app instance.',
      );
    }
  }

  // One process-wide guard shared by every fresh pinned and aggregate MCP Server.
  // HTTP creates a Server per request, so constructing this inside createServer()
  // would defeat lockout protection across requests and endpoint styles.
  const sharedAuthState = config.multiTargetEndpoints ? new MultiTargetSharedAuthState() : undefined;

  // ─── Layer 3: shared SAP-bound Semaphore (server-wide cap) ────────
  // One Semaphore for the whole process. Threaded into the shared startup client AND
  // every per-user PP client built at request time, so ARC1_MAX_CONCURRENT is a true
  // server-wide ceiling rather than a per-client one (the latter would multiply the cap
  // by the number of active PP users — see ADR-0004).
  const adtSemaphore = new Semaphore(config.maxConcurrent);
  logger.info('SAP semaphore', { maxConcurrent: config.maxConcurrent, scope: 'server-wide' });

  // ─── Layer 2: per-user MCP tool-call rate limiter ─────────────────
  // Applied inside handleToolCall. Stdio (no authInfo) is exempt — there's no user
  // identity to key on. When rateLimit=0 the factory returns a no-op stub.
  // See docs_page/rate-limiting.md.
  const mcpRateLimiter = createMcpRateLimiter(config.rateLimit);
  logger.info('MCP rate limiting', {
    perMinute: config.rateLimit,
    disabled: config.rateLimit === 0,
  });

  // ─── Cache Setup ───────────────────────────────────────────────────
  const cachingLayer = await createCachingLayer(config);
  if (cachingLayer) {
    const stats = cachingLayer.stats();
    logger.info('Object cache enabled', {
      mode: config.cacheMode,
      sources: stats.sourceCount,
      depGraphs: stats.contractCount,
    });
  }

  // Run feature probe once at startup — shared across all requests (stdio and HTTP).
  // First run startup auth preflight in shared mode. If it blocks (401/403), skip feature probe
  // to avoid firing many failing requests with invalid technical credentials.
  const hasSingleTarget = !!(config.url || btpDestination || bearerTokenProvider);
  const shouldStartSingleTarget = !config.multiTargetEndpoints || hasSingleTarget;
  const startupAuthPreflightPromise = shouldStartSingleTarget
    ? runStartupAuthPreflight(config, btpProxy, bearerTokenProvider, adtSemaphore)
    : Promise.resolve<StartupAuthPreflightResult>({
        status: 'skipped',
        blocking: false,
        endpoint: STARTUP_AUTH_ENDPOINT,
        checkedAt: new Date().toISOString(),
        reason: 'No single-target /mcp connection is configured.',
      });
  const startupProbePromise = shouldStartSingleTarget
    ? (async () => {
        const authPreflight = await startupAuthPreflightPromise;
        if (authPreflight.blocking) {
          setCachedFeatures(undefined);
          setCachedDiscovery(new Map());
          return;
        }
        await runStartupProbe(config, btpProxy, bearerTokenProvider, btpConfig, adtSemaphore);
      })()
    : Promise.resolve();

  const buildDefaultServer = () =>
    createServer(config, {
      btpProxy,
      btpConfig,
      bearerTokenProvider,
      cachingLayer,
      startupProbePromise,
      startupAuthPreflightPromise,
      adtSemaphore,
      mcpRateLimiter,
    });
  const aggregateConfig = registry ? buildAggregateToolSurfaceConfig(config, registry.targets) : undefined;
  const buildAggregateServer =
    registry && aggregateConfig && btpConfig
      ? () =>
          createServer(aggregateConfig, {
            btpConfig,
            adtSemaphore,
            mcpRateLimiter,
            multiTarget: { mode: 'aggregate', registry, instanceConfig: config, sharedAuthState },
          })
      : undefined;
  const serveSingleTargetEndpoint = shouldStartSingleTarget;
  const server = serveSingleTargetEndpoint ? buildDefaultServer() : (buildAggregateServer?.() ?? buildDefaultServer());

  const uiDeps: UiServerDeps | undefined =
    config.uiMode !== 'off'
      ? {
          config,
          sources: effectiveSources,
          version: VERSION,
          startedAt,
          cachingLayer,
          logBuffer: uiLogBuffer,
          getFeatures: () => getCachedFeatures(),
        }
      : undefined;

  // Shutdown hook for SQLite cache cleanup (guard against double-close from multiple signals).
  // IMPORTANT: registering a SIGINT/SIGTERM listener suppresses Node's default exit behavior,
  // so we must call process.exit() explicitly after cleanup — otherwise Ctrl+C hangs the process.
  if (cachingLayer) {
    let cacheClosed = false;
    const cleanup = (signal: string) => {
      if (cacheClosed) return;
      cacheClosed = true;
      try {
        cachingLayer?.cache.close();
      } catch {
        // Ignore close errors during shutdown
      }
      logger.info(`ARC-1 shutting down (${signal})`);
      process.exit(0);
    };
    process.on('SIGTERM', () => cleanup('SIGTERM'));
    process.on('SIGINT', () => cleanup('SIGINT'));
  } else {
    // No cache — still log clean shutdown on explicit signals so operators see it in logs.
    process.on('SIGTERM', () => {
      logger.info('ARC-1 shutting down (SIGTERM)');
      process.exit(0);
    });
    process.on('SIGINT', () => {
      logger.info('ARC-1 shutting down (SIGINT)');
      process.exit(0);
    });
  }

  if (config.transport === 'stdio') {
    if (uiDeps && config.uiMode === 'local') {
      await startLocalUiServer(uiDeps);
    }
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info('ARC-1 MCP server running on stdio');
  } else {
    if (uiDeps && config.uiMode === 'local') {
      await startLocalUiServer(uiDeps);
    }
    // HTTP Streamable transport — for containerized/BTP deployments
    // Pass the factory function so HTTP server can create fresh server+transport
    // per request. This is required because MCP SDK's Server can only connect
    // to one transport at a time, and clients like Copilot Studio send
    // concurrent requests.
    // Load XSUAA credentials if XSUAA auth is enabled
    let xsuaaCredentials: import('@arc-mcp/xsuaa-auth').XsuaaCredentials | undefined;
    if (config.xsuaaAuth) {
      try {
        const xsenv = await import('@sap/xsenv');
        const services = xsenv.getServices({ uaa: { tag: 'xsuaa' } });
        const uaa = services.uaa as Record<string, string>;
        xsuaaCredentials = {
          url: uaa.url,
          clientid: uaa.clientid,
          clientsecret: uaa.clientsecret,
          xsappname: uaa.xsappname,
          uaadomain: uaa.uaadomain,
        };
        logger.info('XSUAA credentials loaded', {
          xsappname: xsuaaCredentials.xsappname,
          url: xsuaaCredentials.url,
        });
      } catch (err) {
        logger.error('Failed to load XSUAA credentials — XSUAA auth will not work', {
          error: err instanceof Error ? err.message : String(err),
        });
        if (config.multiTargetEndpoints) {
          throw new Error('ARC1_MULTI_TARGET_ENDPOINTS=true requires a valid bound XSUAA service.');
        }
      }
    }

    const { startHttpServer } = await import('./http.js');
    const multiTargets =
      registry && btpConfig && buildAggregateServer
        ? {
            registry,
            aggregateFactory: buildAggregateServer,
            createPinnedServer: (target: TargetDescriptor) => {
              const targetConfig = buildMultiTargetConfig(config, target);
              return createServer(targetConfig, {
                btpConfig,
                adtSemaphore,
                mcpRateLimiter,
                multiTarget: { mode: 'pinned', registry, instanceConfig: config, target, sharedAuthState },
              });
            },
          }
        : undefined;
    await startHttpServer(
      serveSingleTargetEndpoint ? buildDefaultServer : undefined,
      config,
      xsuaaCredentials,
      config.uiMode === 'web' ? uiDeps : undefined,
      multiTargets,
    );
  }

  return server;
}
