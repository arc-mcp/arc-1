/**
 * MCP Server for ARC-1.
 *
 * Creates and starts the MCP server with 12 intent-based tools.
 * Supports two transports:
 * - stdio (default): for local MCP clients (Claude Desktop, Claude Code, Cursor)
 * - http-streamable: for remote/containerized deployments
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { BTPConfig, BTPProxyConfig } from '../adt/btp.js';
import { AdtClient } from '../adt/client.js';
import type { AdtClientConfig } from '../adt/config.js';
import { resolveCookies } from '../adt/cookies.js';
import { AdtApiError } from '../adt/errors.js';
import { deriveUserSafety, deriveUserSafetyFromProfile } from '../adt/safety.js';
import { getActionPolicy, hasRequiredScope } from '../authz/policy.js';
import type { Cache } from '../cache/cache.js';
import { CachingLayer } from '../cache/caching-layer.js';
import { MemoryCache } from '../cache/memory.js';
import {
  getCachedDiscovery,
  getCachedFeatures,
  handleToolCall,
  setCachedDiscovery,
  setCachedFeatures,
} from '../handlers/intent.js';
import { getToolDefinitions, type ToolDefinition } from '../handlers/tools.js';
import { API_KEY_PROFILES } from './config.js';
import { isActionDenied } from './deny-actions.js';
import { initLogger, logger } from './logger.js';
import { FileSink } from './sinks/file.js';
import type { ServerConfig } from './types.js';

/** ARC-1 version */
export const VERSION = '0.9.2'; // x-release-please-version

/**
 * Prune a tool's action OR type enum (or both) based on the user's scopes and
 * the server's denyActions list. Uses ACTION_POLICY as the single source of truth.
 *
 * - For action-bearing tools (SAPWrite, SAPManage, SAPLint, SAPTransport, SAPGit, ...):
 *   filter the `action` enum to entries the user can actually invoke.
 * - For SAPRead (which uses `type` not `action`): filter the `type` enum. The key one is
 *   TABLE_CONTENTS, which requires the `data` scope — a read-scoped user sees SAPRead
 *   without TABLE_CONTENTS in the type enum.
 */
function pruneToolByPolicy(tool: ToolDefinition, scopes: string[], denyActions: string[]): ToolDefinition {
  const schema = tool.inputSchema as Record<string, unknown>;
  const properties = (schema.properties as Record<string, unknown> | undefined) ?? {};

  // Determine which enum this tool uses: SAPRead uses `type`; others use `action`.
  const enumField = tool.name === 'SAPRead' ? 'type' : 'action';
  const enumDef = (properties[enumField] as Record<string, unknown> | undefined) ?? {};
  const enumValues = Array.isArray(enumDef.enum) ? enumDef.enum.map(String) : null;

  if (!enumValues) return tool; // no pruning needed

  const filtered = enumValues.filter((value) => {
    const policy = getActionPolicy(tool.name, value);
    if (!policy) return true; // unknown action/type — let it through and fail at runtime
    if (!hasRequiredScope(scopes, policy.scope)) return false;
    if (isActionDenied(tool.name, value, denyActions)) return false;
    return true;
  });

  return {
    ...tool,
    inputSchema: {
      ...schema,
      properties: {
        ...properties,
        [enumField]: {
          ...enumDef,
          enum: filtered,
        },
      },
    },
  };
}

function hasNonEmptyActionOrTypeEnum(tool: ToolDefinition): boolean {
  const schema = tool.inputSchema as Record<string, unknown>;
  const properties = (schema.properties as Record<string, unknown> | undefined) ?? {};
  const enumField = tool.name === 'SAPRead' ? 'type' : 'action';
  const enumDef = (properties[enumField] as Record<string, unknown> | undefined) ?? {};
  if (!Array.isArray(enumDef.enum)) return true;
  return enumDef.enum.length > 0;
}

/**
 * Filter tools by user scope + server deny list.
 *
 * Tools are included when the user has the tool-level scope, OR when any action/type
 * in the tool has a scope the user satisfies (in which case the enum is pruned to
 * just those action/types). After pruning, tools with empty action/type enums are
 * removed entirely.
 */
export function filterToolsByAuthScope(
  tools: ToolDefinition[],
  scopes: string[],
  denyActions: string[] = [],
): ToolDefinition[] {
  return tools
    .filter((tool) => {
      // Tool-level visibility: if the whole tool is tool-level-denied, hide it.
      if (isActionDenied(tool.name, undefined, denyActions)) return false;
      // Must have scope for at least the tool-level default — otherwise no chance any action succeeds.
      const toolPolicy = getActionPolicy(tool.name);
      if (toolPolicy && !hasRequiredScope(scopes, toolPolicy.scope)) {
        // Still allow if any specific action has a scope the user HAS (e.g., SAPManage default='write'
        // but flp_list_* have scope='read' — a read user should see SAPManage with pruned actions).
        const schema = tool.inputSchema as Record<string, unknown>;
        const properties = (schema.properties as Record<string, unknown> | undefined) ?? {};
        const enumField = tool.name === 'SAPRead' ? 'type' : 'action';
        const enumDef = (properties[enumField] as Record<string, unknown> | undefined) ?? {};
        const enumValues = Array.isArray(enumDef.enum) ? enumDef.enum.map(String) : null;
        if (!enumValues) return false;
        const anyAllowed = enumValues.some((v) => {
          const p = getActionPolicy(tool.name, v);
          return p && hasRequiredScope(scopes, p.scope) && !isActionDenied(tool.name, v, denyActions);
        });
        if (!anyAllowed) return false;
      }
      return true;
    })
    .map((tool) => pruneToolByPolicy(tool, scopes, denyActions))
    .filter(hasNonEmptyActionOrTypeEnum);
}

export function logAuthSummary(config: ServerConfig): void {
  const mcpMethods: string[] = [];
  if (config.apiKeys?.length) mcpMethods.push('api-keys');
  if (config.oidcIssuer && config.oidcAudience) mcpMethods.push('oidc');
  if (config.xsuaaAuth) mcpMethods.push('xsuaa');
  if (mcpMethods.length === 0) mcpMethods.push('none');

  const hasCookie = !!(config.cookieFile || config.cookieString);
  const hasBearer = !!(config.btpServiceKey || config.btpServiceKeyFile);
  const hasDestination = !!process.env.SAP_BTP_DESTINATION;
  const hasBasic = !!(config.username && config.password);

  let sapMethod = 'none';
  if (config.ppEnabled) {
    if (hasDestination) sapMethod = 'destination+pp';
    else if (hasCookie) sapMethod = 'cookie+pp';
    else sapMethod = 'pp';
  } else if (hasBearer) {
    sapMethod = 'bearer';
  } else if (hasDestination) {
    sapMethod = 'destination';
  } else if (hasBasic && hasCookie) {
    sapMethod = 'basic+cookie';
  } else if (hasCookie) {
    sapMethod = 'cookie';
  } else if (hasBasic) {
    sapMethod = 'basic';
  }

  const scope = config.ppEnabled ? 'per-user' : 'shared';
  const samlSuffix = config.disableSaml2 ? ' disable-saml=on' : '';
  logger.info(`auth: MCP=[${mcpMethods.join(',')}] SAP=${sapMethod} (${scope})${samlSuffix}`);
}

/** Build the base ADT client config (without per-user auth) */
// When perUser=true, strips shared credentials (username/password/cookies)
// so per-user PP clients never inherit admin auth.
export function buildAdtConfig(
  config: ServerConfig,
  btpProxy?: BTPProxyConfig,
  bearerTokenProvider?: () => Promise<string>,
  opts?: { perUser?: boolean },
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
async function createPerUserClient(
  config: ServerConfig,
  btpConfig: BTPConfig,
  btpProxy: BTPProxyConfig | undefined,
  userJwt: string,
): Promise<AdtClient> {
  const { lookupDestinationWithUserToken } = await import('../adt/btp.js');
  // Use SAP_BTP_PP_DESTINATION if set, otherwise fall back to SAP_BTP_DESTINATION.
  // This enables a dual-destination approach:
  // - SAP_BTP_DESTINATION = BasicAuth destination (shared client, startup resolution)
  // - SAP_BTP_PP_DESTINATION = PrincipalPropagation destination (per-user, runtime)
  const destName = process.env.SAP_BTP_PP_DESTINATION ?? process.env.SAP_BTP_DESTINATION;
  if (!destName) {
    throw new Error('SAP_BTP_PP_DESTINATION or SAP_BTP_DESTINATION is required for principal propagation');
  }

  const { destination, authTokens } = await lookupDestinationWithUserToken(btpConfig, destName, userJwt);

  // Build an effective proxy that uses the PP destination's Location ID, not the
  // startup destination's. In dual-destination setups, SAP_BTP_DESTINATION and
  // SAP_BTP_PP_DESTINATION may point to different Cloud Connectors (different
  // Location IDs). If we blindly reuse the startup proxy, PP requests route to
  // the wrong SCC instance — causing 401/403/404 errors that are hard to debug.
  const effectiveProxy =
    btpProxy && destination.CloudConnectorLocationId !== undefined
      ? { ...btpProxy, locationId: destination.CloudConnectorLocationId }
      : btpProxy;

  const adtConfig = buildAdtConfig(config, effectiveProxy, undefined, { perUser: true });
  // Override URL from destination (in case it differs from startup-resolved URL)
  adtConfig.baseUrl = destination.URL;
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

  if (authTokens.ppProxyAuth) {
    // Option 1: exchanged token replaces Proxy-Authorization
    adtConfig.ppProxyAuth = authTokens.ppProxyAuth;
    adtConfig.username = displayUsername;
    adtConfig.password = undefined;
  } else if (authTokens.sapConnectivityAuth) {
    // Option 2: SAML assertion from Destination Service
    adtConfig.sapConnectivityAuth = authTokens.sapConnectivityAuth;
    adtConfig.username = displayUsername;
    adtConfig.password = undefined;
  } else if (authTokens.bearerToken) {
    // TODO: Bearer token auth for OAuth2SAMLBearerAssertion destinations
    // This would replace basic auth with Bearer token
    logger.warn('Bearer token auth from destination not yet implemented — falling back to basic auth');
  } else {
    // No per-user auth token received.
    throw new Error(
      `Principal propagation failed for destination '${destName}': ` +
        'no SAP-Connectivity-Authentication header, Bearer token, or jwt-bearer exchange token returned. ' +
        'Check Cloud Connector status, destination configuration, and user JWT validity.',
    );
  }

  return new AdtClient(adtConfig);
}

/**
 * Run a one-time feature probe against the SAP system using the shared/default client.
 * Returns a promise that resolves once probe results are stored in cachedFeatures.
 * In PP mode (when btpConfig is available for per-user client creation), auth failures
 * (401/403) on textSearch are treated as "unknown" so the tool schema doesn't hide
 * source_code from users who might have authorization.  Without btpConfig, PP cannot
 * create per-user clients, so shared-client auth failures are definitive.
 */
export function runStartupProbe(
  config: ServerConfig,
  btpProxy?: BTPProxyConfig,
  bearerTokenProvider?: () => Promise<string>,
  btpConfig?: BTPConfig,
): Promise<void> {
  const client = new AdtClient(buildAdtConfig(config, btpProxy, bearerTokenProvider));
  return (async () => {
    try {
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
      if (config.ppEnabled && btpConfig && features.textSearch && !features.textSearch.available) {
        const reason = features.textSearch.reason ?? '';
        if (reason.includes('authorization') || reason.includes('401') || reason.includes('403')) {
          features.textSearch = undefined;
        }
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
          logger.info(
            `Authorization probe: transport access is not available — ${ap.transportReason ?? 'unknown reason'}`,
          );
        }
      }
      setCachedFeatures(features);
      setCachedDiscovery(features.discoveryMap ?? new Map());
    } catch {
      setCachedDiscovery(new Map());
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
    const client = new AdtClient(buildAdtConfig(config, btpProxy, bearerTokenProvider));
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

/**
 * Create the MCP server with registered tool handlers.
 * @param config Server configuration
 * @param btpProxy Optional BTP connectivity proxy config (resolved at startup)
 * @param btpConfig Optional BTP service config (for per-user destination lookup)
 * @param bearerTokenProvider Optional OAuth bearer token provider (BTP ABAP Environment)
 * @param cachingLayer Optional object cache layer
 * @param startupProbePromise Promise from runStartupProbe() — ListTools waits on this
 * @param startupAuthPreflightPromise Promise from runStartupAuthPreflight() — CallTool blocks on auth failure in shared mode
 */
export function createServer(
  config: ServerConfig,
  btpProxy?: BTPProxyConfig,
  btpConfig?: BTPConfig,
  bearerTokenProvider?: () => Promise<string>,
  cachingLayer?: CachingLayer,
  startupProbePromise?: Promise<void>,
  startupAuthPreflightPromise?: Promise<StartupAuthPreflightResult>,
): Server {
  const server = new Server({ name: 'arc-1', version: VERSION }, { capabilities: { tools: {} } });

  // Create default ADT client (shared, uses startup-time credentials or OAuth bearer)
  const defaultClient = new AdtClient(buildAdtConfig(config, btpProxy, bearerTokenProvider));

  // Cookie-auth preflight propagation: when startup preflight returned a non-blocking
  // 401 in SAP_COOKIE_FILE mode, the throwaway preflight client marked itself stale —
  // but the long-lived defaultClient was constructed independently with cookies read at
  // startup and is unaware. Without explicit propagation, the first real tool call would
  // re-emit the same stale cookies and hit 401 again before the lazy reload triggers,
  // wasting one round-trip per startup-stale-cookie cycle. We propagate the stale state
  // once on first tool call — idempotent flag keeps later calls O(1).
  let preflightStalePropagated = false;

  // Register tool listing — filtered by user's scopes when auth is active
  server.setRequestHandler(ListToolsRequestSchema, async (_request, extra) => {
    // Wait for the startup probe (if provided), but with a timeout so a slow/unreachable
    // SAP system doesn't stall the MCP connection setup. If the probe doesn't finish in
    // time, fall back to the default tool set (textSearch unknown = show source_code).
    if (startupProbePromise) {
      await Promise.race([startupProbePromise, new Promise((resolve) => setTimeout(resolve, 10_000))]);
    }
    const features = getCachedFeatures();
    let tools = getToolDefinitions(config, features?.textSearch?.available, features);

    // When authenticated, only show tools the user has scopes for
    if (extra.authInfo) {
      tools = filterToolsByAuthScope(tools, extra.authInfo.scopes);
    }

    return { tools };
  });

  // Register tool call handler — passes authInfo for scope enforcement + audit logging
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const toolName = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    if (startupAuthPreflightPromise) {
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
        defaultClient.http.markCookiesStale();
        preflightStalePropagated = true;
      }
    }

    // Principal propagation: create per-user ADT client if enabled and user JWT available.
    // Only attempt PP when the token is a JWT (3 dot-separated parts), not a plain API key.
    let client = defaultClient;
    let isPerUserClient = false;
    const token = extra.authInfo?.token;
    const isJwt = token && token.split('.').length === 3;
    if (config.ppEnabled && btpConfig && isJwt) {
      const ppUser = (extra.authInfo?.extra?.userName ?? extra.authInfo?.clientId) as string | undefined;
      const ppDest = process.env.SAP_BTP_PP_DESTINATION ?? process.env.SAP_BTP_DESTINATION ?? '';
      try {
        client = await createPerUserClient(config, btpConfig, btpProxy, token);
        isPerUserClient = true;
        logger.emitAudit({
          timestamp: new Date().toISOString(),
          level: 'info',
          event: 'auth_pp_created',
          user: ppUser,
          destination: ppDest,
          success: true,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.emitAudit({
          timestamp: new Date().toISOString(),
          level: 'error',
          event: 'auth_pp_created',
          user: ppUser,
          destination: ppDest,
          success: false,
          errorMessage: errMsg,
        });
        if (config.ppStrict) {
          // Strict mode: PP failure is a hard error — never fall back to shared client.
          // This ensures every request runs with the authenticated user's identity.
          return {
            content: [
              {
                type: 'text' as const,
                text: `Principal propagation failed (SAP_PP_STRICT=true): ${errMsg}`,
              },
            ],
            isError: true,
          } as Record<string, unknown>;
        }
        // Fall back to shared client (service account)
      }
    } else if (config.ppStrict && config.ppEnabled && !isJwt) {
      // Strict mode with non-JWT token (e.g., API key) — reject
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

    // Inject startup discovery MIME map (shared for default and per-user clients).
    client.http.setDiscoveryMap(getCachedDiscovery());

    // Per-request safety: merge server ceiling with per-user policy.
    //   - API-key path: clientId starts with "api-key:<profile>" — intersect server with profile's partial SafetyConfig.
    //   - XSUAA/OIDC path: derive from scopes only (server ceiling, scopes can only tighten).
    // API-key intersection is stricter — profile can narrow allowedPackages / feature flags
    // that scopes alone cannot (scopes don't encode allowedPackages, etc.).
    let effectiveClient = client;
    if (extra.authInfo?.clientId?.startsWith('api-key:')) {
      const profileName = extra.authInfo.clientId.slice('api-key:'.length);
      const profile = API_KEY_PROFILES[profileName];
      if (profile) {
        const effectiveSafety = deriveUserSafetyFromProfile(client.safety, profile.safety);
        effectiveClient = client.withSafety(effectiveSafety);
      }
    } else if (extra.authInfo?.scopes) {
      const effectiveSafety = deriveUserSafety(client.safety, extra.authInfo.scopes);
      effectiveClient = client.withSafety(effectiveSafety);
    }
    effectiveClient.http.setDiscoveryMap(getCachedDiscovery());

    const result = await handleToolCall(
      effectiveClient,
      config,
      toolName,
      args,
      extra.authInfo,
      server,
      cachingLayer,
      isPerUserClient,
    );
    return { ...result } as Record<string, unknown>;
  });

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
async function createCachingLayer(config: ServerConfig): Promise<CachingLayer | undefined> {
  const mode = config.cacheMode;

  if (mode === 'none') return undefined;

  let cache: Cache;
  if (mode === 'sqlite' || (mode === 'auto' && config.transport === 'http-streamable')) {
    // Persistent cache for http-streamable / Docker — load dynamically
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
    // Memory cache for stdio (default)
    cache = new MemoryCache();
  }

  return new CachingLayer(cache);
}

/**
 * Create and start the MCP server.
 */
export async function createAndStartServer(
  config: ServerConfig,
  sources?: Record<string, import('./types.js').ConfigSource>,
): Promise<Server> {
  initLogger(config.logFormat, config.verbose);
  logAuthSummary(config);

  // Effective-policy log + contradiction warnings (Task 8 observability).
  // Sources is optional for test callers — defaults to 'default' for all fields.
  const effectiveSources = sources ?? {};
  const { logEffectivePolicy, detectContradictions, logContradictions } = await import('./effective-policy-log.js');
  logEffectivePolicy(config, effectiveSources, logger);
  logContradictions(detectContradictions(config), logger);

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
  const hasBtpConnection = !!(config.btpServiceKey || config.btpServiceKeyFile || process.env.SAP_BTP_DESTINATION);
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

  // Resolve BTP Destination if configured (overrides SAP_URL/USER/PASSWORD)
  let btpProxy: BTPProxyConfig | undefined;
  let btpConfig: BTPConfig | undefined;
  const btpDestination = process.env.SAP_BTP_DESTINATION;
  if (btpDestination) {
    const { resolveBTPDestination, parseVCAPServices } = await import('../adt/btp.js');
    const resolved = await resolveBTPDestination(btpDestination);
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
      url: resolved.url,
      user: resolved.username,
      hasProxy: !!btpProxy,
      ppEnabled: config.ppEnabled,
    });
  }

  // ─── Cache Setup ───────────────────────────────────────────────────
  const cachingLayer = await createCachingLayer(config);
  if (cachingLayer) {
    const stats = cachingLayer.stats();
    logger.info('Object cache enabled', {
      mode: config.cacheMode,
      sources: stats.sourceCount,
      depGraphs: stats.contractCount,
      edges: stats.edgeCount,
    });
  }

  // Run warmup if configured (before starting transport so it completes before serving)
  if (config.cacheWarmup && cachingLayer && config.url) {
    try {
      const { runWarmup } = await import('../cache/warmup.js');
      const warmupClient = new AdtClient(buildAdtConfig(config, btpProxy, bearerTokenProvider));
      const result = await runWarmup(
        warmupClient,
        cachingLayer,
        config.cacheWarmupPackages || undefined,
        config.systemType,
      );
      logger.info('Cache warmup completed', {
        objects: result.totalObjects,
        fetched: result.fetched,
        skipped: result.skipped,
        failed: result.failed,
        edges: result.edgesCreated,
        durationMs: result.durationMs,
      });
    } catch (err) {
      logger.warn('Cache warmup failed — continuing without warm cache', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Run feature probe once at startup — shared across all requests (stdio and HTTP).
  // First run startup auth preflight in shared mode. If it blocks (401/403), skip feature probe
  // to avoid firing many failing requests with invalid technical credentials.
  const startupAuthPreflightPromise = runStartupAuthPreflight(config, btpProxy, bearerTokenProvider);
  const startupProbePromise = (async () => {
    const authPreflight = await startupAuthPreflightPromise;
    if (authPreflight.blocking) {
      setCachedFeatures(undefined);
      setCachedDiscovery(new Map());
      return;
    }
    await runStartupProbe(config, btpProxy, bearerTokenProvider, btpConfig);
  })();

  const server = createServer(
    config,
    btpProxy,
    btpConfig,
    bearerTokenProvider,
    cachingLayer,
    startupProbePromise,
    startupAuthPreflightPromise,
  );

  // Shutdown hook for SQLite cache cleanup (guard against double-close from multiple signals).
  // IMPORTANT: registering a SIGINT/SIGTERM listener suppresses Node's default exit behavior,
  // so we must call process.exit() explicitly after cleanup — otherwise Ctrl+C hangs the process.
  if (cachingLayer) {
    let cacheClosed = false;
    const cleanup = (signal: string) => {
      if (cacheClosed) return;
      cacheClosed = true;
      try {
        cachingLayer.cache.close();
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
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info('ARC-1 MCP server running on stdio');
  } else {
    // HTTP Streamable transport — for containerized/BTP deployments
    // Pass the factory function so HTTP server can create fresh server+transport
    // per request. This is required because MCP SDK's Server can only connect
    // to one transport at a time, and clients like Copilot Studio send
    // concurrent requests.
    // Load XSUAA credentials if XSUAA auth is enabled
    let xsuaaCredentials: import('./xsuaa.js').XsuaaCredentials | undefined;
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
      }
    }

    const { startHttpServer } = await import('./http.js');
    await startHttpServer(
      () =>
        createServer(
          config,
          btpProxy,
          btpConfig,
          bearerTokenProvider,
          cachingLayer,
          startupProbePromise,
          startupAuthPreflightPromise,
        ),
      config,
      xsuaaCredentials,
    );
  }

  return server;
}
