/**
 * HTTP Streamable transport for ARC-1.
 *
 * Provides an Express HTTP server that:
 * - Serves MCP Streamable HTTP protocol on /mcp
 * - Health check endpoint on /health
 * - API key authentication via Bearer token
 * - OIDC/JWT validation via JWKS discovery (Entra ID, etc.)
 * - XSUAA OAuth proxy for MCP-native clients (Claude Desktop, Cursor)
 *
 * When XSUAA auth is enabled, the MCP SDK's mcpAuthRouter installs standard
 * OAuth endpoints (authorize, token, register, revoke, discovery metadata).
 *
 * Design decisions:
 *
 * 1. Express is used because the MCP SDK's auth infrastructure (mcpAuthRouter,
 *    requireBearerAuth) requires Express. Express 5.x is already a transitive
 *    dependency of the MCP SDK.
 *
 * 2. Per-request server pattern: each MCP request gets a fresh Server + Transport.
 *    This avoids "already connected" errors from concurrent clients.
 *
 * 3. Auth is checked BEFORE creating the MCP transport to avoid wasting resources.
 *
 * 4. Health endpoint is always unauthenticated — needed for CF health checks.
 */

import type { ApiKeyEntry, XsuaaCredentials } from '@arc-mcp/xsuaa-auth';
import type { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import cors from 'cors';
import type { Request, Response } from 'express';
import express from 'express';
import helmet from 'helmet';
import { expandScopes, hasRequiredScope } from '../authz/policy.js';
import { API_KEY_PROFILES } from './config.js';
import type { DestinationRegistry, TargetDescriptor } from './destination-registry.js';
import { authLibLogger, logger } from './logger.js';
import {
  PINNED_MCP_PATH_PATTERN,
  PINNED_RESOURCE_METADATA_PATH_PATTERN,
  targetFromPinnedMcpPath,
} from './multi-target-identity.js';
import {
  buildXsuaaSessionRefreshUrl,
  createOAuthLoggedOutHandler,
  OAUTH_LOGGED_OUT_PATH,
  withInvalidScopeSessionRecovery,
} from './oauth-session-recovery.js';
import { VERSION } from './server.js';
import type { ServerConfig } from './types.js';
import { mountUiRoutes, type UiServerDeps } from './ui.js';

// ─── API Key Entry Mapping ───────────────────────────────────────────

/**
 * Map ARC-1's `config.apiKeys` (`{key, profile}[]`) to the package's
 * `ApiKeyEntry[]` (`{key, scopes, clientId}`) so the package's constant-time
 * api-key verifier resolves them identically to ARC-1's previous profile-based
 * matching:
 *   - scopes come from `API_KEY_PROFILES[profile]` after `expandScopes`,
 *   - clientId is `api-key:<profile>` (same audit/identity string as before).
 * Entries whose profile is unknown are dropped (defense in depth — profiles are
 * already validated at config-parse time). Used by BOTH XSUAA and standard mode.
 */
function toApiKeyEntries(config: ServerConfig): ApiKeyEntry[] {
  if (!config.apiKeys) return [];
  const entries: ApiKeyEntry[] = [];
  for (const entry of config.apiKeys) {
    const profile = API_KEY_PROFILES[entry.profile];
    if (!profile) continue;
    entries.push({ key: entry.key, scopes: expandScopes(profile.scopes), clientId: `api-key:${entry.profile}` });
  }
  return entries;
}

// ─── Security Middleware (helmet + opt-in CORS) ──────────────────────

/**
 * Apply security headers (helmet) and opt-in CORS to an Express app.
 *
 * helmet runs unconditionally — every response (including /health, /mcp,
 * OAuth endpoints) gets HSTS, CSP, X-Frame-Options, etc. Native MCP clients
 * ignore these; they exist to harden the server when a browser ever reaches
 * it.
 *
 * COOP is **disabled** explicitly because Microsoft Copilot Studio (and any
 * other connector platform that uses popup-based OAuth) breaks when the
 * /authorize response sets any non-default COOP. The popup completes the
 * flow server-side, but the parent window's `window.open()` reference is
 * nulled by COOP isolation — Copilot Studio sees this as "consent pop-up
 * window has been closed unexpectedly". ARC-1 renders no JS UI that would
 * benefit from cross-origin isolation, so dropping COOP costs nothing.
 *
 * CORS is OFF by default (empty `allowedOrigins`). When enabled it uses
 * `credentials: true` plus exact-origin reflection — disallowed origins are
 * silently dropped by the browser and surfaced server-side as `cors_rejected`
 * audit events.
 *
 * Exported for unit tests; also called from `startHttpServer` below.
 */
export function applySecurityMiddleware(app: express.Application, allowedOrigins: string[]): void {
  const hasCorsOrigins = allowedOrigins.length > 0;
  app.use(
    helmet({
      // COOP is disabled — see function docstring for rationale (Copilot Studio
      // popup-based OAuth requires no COOP on /authorize).
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: hasCorsOrigins ? { policy: 'cross-origin' as const } : undefined,
      // useDefaults keeps every other helmet directive intact (frame-ancestors
      // 'self', object-src 'none', base-uri 'self', form-action 'self',
      // upgrade-insecure-requests, …); we only relax style-src for any inline
      // styles that browser-facing UIs may need.
      contentSecurityPolicy: hasCorsOrigins
        ? {
            useDefaults: true,
            directives: {
              'style-src': ["'self'", "'unsafe-inline'"],
            },
          }
        : undefined,
    }),
  );

  if (hasCorsOrigins) {
    const allowed = new Set(allowedOrigins);
    app.use(
      cors({
        origin: (origin, callback) => {
          if (!origin) {
            // Same-origin requests, server-to-server, curl: no Origin header.
            // Pass through without echoing CORS headers.
            callback(null, false);
            return;
          }
          callback(null, allowed.has(origin));
        },
        methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
        // mcp-protocol-version: sent by every SDK client on post-initialize requests (spec 2025-06-18+).
        // last-event-id: sent on SSE reconnects (fetch-based, so preflighted). 2026-07-28 headers
        // (Mcp-Method/Mcp-Name/Mcp-Param-*) deliberately absent — v2 clients default to legacy mode,
        // and Mcp-Param-* is dynamically named (can't be allow-listed under credentials). ADR-0006.
        allowedHeaders: ['Content-Type', 'Authorization', 'mcp-session-id', 'mcp-protocol-version', 'last-event-id'],
        exposedHeaders: ['mcp-session-id'],
        credentials: true,
      }),
    );
    // Audit hook for blocked origins. Re-checks the origin against the
    // allowlist and emits cors_rejected when it didn't match. Browsers drop
    // the response either way; this gives us a server-side signal for triage.
    app.use((req, _res, next) => {
      const origin = req.headers.origin;
      if (typeof origin === 'string' && origin.length > 0 && !allowed.has(origin)) {
        logger.emitAudit({
          timestamp: new Date().toISOString(),
          level: 'warn',
          event: 'cors_rejected',
          origin,
          method: req.method,
          path: req.path,
        });
      }
      next();
    });
    logger.info('CORS enabled', { origins: allowedOrigins });
  }
}

// ─── MCP Request Handler ─────────────────────────────────────────────

/**
 * Serve one MCP request with a fresh Server + Transport pair.
 *
 * IMPORTANT: Passes req.body as pre-parsed body (3rd argument).
 * express.json() middleware consumes the raw request stream. Without this,
 * the MCP SDK's transport tries to re-read the stream, gets nothing, and
 * returns "Parse error: Invalid JSON" (-32700). The SDK explicitly supports
 * this pattern — see their docs/comments in
 * StreamableHTTPServerTransport.handleRequest().
 */
async function serveMcpRequest(serverFactory: () => McpServer, req: Request, res: Response): Promise<void> {
  try {
    const server = serverFactory();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    logger.error('MCP request error', { error: err instanceof Error ? err.message : String(err) });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

/**
 * Create an Express handler that processes MCP requests.
 * Each request gets a fresh Server + Transport pair.
 * Exported for the era-contract regression tests (tests/unit/server/mcp-era-contract.test.ts).
 */
export function createMcpHandler(serverFactory: () => McpServer) {
  return async (req: Request, res: Response) => {
    logger.debug('MCP handler invoked', {
      method: req.method,
      contentType: req.headers['content-type'],
      hasBody: !!req.body,
      bodyMethod: req.body?.method,
      bodyId: req.body?.id,
    });
    await serveMcpRequest(serverFactory, req, res);
  };
}

// ─── Destination-discovered multi-target routing ────────────────────

export interface MultiTargetRouting {
  registry: DestinationRegistry;
  aggregateFactory: () => McpServer;
  createPinnedServer: (target: TargetDescriptor) => McpServer;
}

export function createPinnedTargetMcpHandler(multi: MultiTargetRouting) {
  return async (req: Request, res: Response) => {
    if (!multi.registry.available) {
      res.status(503).json({ error: 'Multi-target registry unavailable' });
      return;
    }
    const targetId = targetFromPinnedMcpPath(req.path);
    const target = targetId ? multi.registry.get(targetId) : undefined;
    if (!target) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    logger.debug('MCP handler invoked (pinned target)', {
      target: target.target,
      method: req.method,
      bodyMethod: req.body?.method,
      bodyId: req.body?.id,
    });
    await serveMcpRequest(() => multi.createPinnedServer(target), req, res);
  };
}

export function createAggregateMcpHandler(multi: MultiTargetRouting) {
  return async (req: Request, res: Response) => {
    // Keep the aggregate MCP transport reachable when discovery fails so an
    // administrator can call SAPTargets and inspect secret-safe diagnostics.
    // Other tool calls return a structured registry-unavailable result.
    await serveMcpRequest(multi.aggregateFactory, req, res);
  };
}

export function resolveMcpHttpRateLimit(config: Pick<ServerConfig, 'authRateLimit' | 'mcpHttpRateLimit'>): number {
  if (config.mcpHttpRateLimit !== undefined) return config.mcpHttpRateLimit;
  // OAuth and MCP traffic are separate edge buckets. Disabling only the OAuth
  // bucket must not also remove MCP protection; ARC1_MCP_HTTP_RATE_LIMIT=0 is
  // the explicit opt-out for MCP traffic.
  return Math.max(config.authRateLimit * 30, 600);
}

export function multiTargetHealthStatus(registry: DestinationRegistry): 'ready' | 'error' {
  // Zero targets and individually quarantined destinations are valid snapshots.
  // Only a registry-wide failure makes multi-target routing unavailable.
  return registry.available ? 'ready' : 'error';
}

export const MULTI_TARGET_SCOPES_SUPPORTED = Object.freeze(['read', 'data', 'sql', 'admin']);

/**
 * Start the HTTP Streamable server.
 */
export async function startHttpServer(
  serverFactory: (() => McpServer) | undefined,
  config: ServerConfig,
  xsuaaCredentials?: XsuaaCredentials,
  uiDeps?: UiServerDeps,
  multiTargets?: MultiTargetRouting,
): Promise<void> {
  const [host, portStr] = config.httpAddr.split(':');
  const port = Number.parseInt(portStr || '8080', 10);
  const bindHost = host || '0.0.0.0';

  const app = express();
  // Trust first proxy (CF gorouter) — required for express-rate-limit
  // and correct client IP detection behind CF's reverse proxy.
  app.set('trust proxy', 1);

  applySecurityMiddleware(app, config.allowedOrigins);

  // ─── Layer 1: HTTP-edge rate limiter helper ──────────────────────────
  // `ARC1_AUTH_RATE_LIMIT` (default 20/min/IP) controls OAuth endpoints uniformly.
  // MCP traffic derives `max(value × 30, 600)/min/IP` unless the operator sets the
  // independent `ARC1_MCP_HTTP_RATE_LIMIT`; this keeps pre-bearer probing gated even
  // when OAuth limiting is delegated to an upstream proxy.
  // See docs_page/rate-limiting.md (Layer 1) and ADR-0004.
  //
  // Implementation note: the limiter is mounted DIRECTLY via createAuthRateLimiter →
  // express-rate-limit. The disabled path skips the mount entirely rather than going
  // through a noop indirection — this keeps the dataflow `rateLimit({...}) → app.use`
  // direct and makes CodeQL's `js/missing-rate-limiting` query close cleanly.
  const { createAuthRateLimiter, isCopilotJsonRpc, isMcpHttpTraffic } = await import('./auth-rate-limit.js');
  const authRateLimitEnabled = config.authRateLimit > 0;
  const mcpRatePerMinute = resolveMcpHttpRateLimit(config);
  const mcpRateLimitEnabled = mcpRatePerMinute > 0;
  logger.info('Auth rate limiting', {
    perMinute: config.authRateLimit,
    mcpPerMinute: mcpRatePerMinute,
    endpoints: [
      ...(authRateLimitEnabled ? ['/register', '/authorize', '/token', '/revoke'] : []),
      ...(mcpRateLimitEnabled ? ['/mcp'] : []),
    ],
    disabled: !authRateLimitEnabled && !mcpRateLimitEnabled,
  });

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  if (mcpRateLimitEnabled) {
    // One middleware instance means one MemoryStore and therefore one per-IP
    // bucket across single-target, pinned, aggregate, and Copilot routes.
    // Mount after body parsing so the Copilot JSON-RPC predicate can inspect
    // `req.body`, but before every authentication and route handler.
    app.use(createAuthRateLimiter('/mcp', mcpRatePerMinute, { skip: (req) => !isMcpHttpTraffic(req) }));
  }
  const mcpHandler = serverFactory ? createMcpHandler(serverFactory) : undefined;
  const pinnedMcpHandler = multiTargets ? createPinnedTargetMcpHandler(multiTargets) : undefined;
  const aggregateMcpHandler = multiTargets ? createAggregateMcpHandler(multiTargets) : undefined;
  const hasAdminApiKey = config.apiKeys?.some((entry) => entry.profile === 'admin') ?? false;
  if (uiDeps && !(hasAdminApiKey || config.oidcIssuer || (config.xsuaaAuth && xsuaaCredentials))) {
    throw new Error('ARC1_UI=web requires an admin API key, OIDC, or XSUAA HTTP authentication.');
  }

  // ─── Global Request Logger ──────────────────────────────────
  // Log every inbound request for debugging OAuth/MCP flows.
  app.use((req, _res, next) => {
    logger.debug('HTTP request', {
      method: req.method,
      path: req.path,
      contentType: req.headers['content-type'],
      userAgent: req.headers['user-agent']?.slice(0, 80),
      hasAuth: !!req.headers.authorization,
      ip: req.ip,
    });
    next();
  });

  // ─── Health Check (always unauthenticated) ───────────────
  // Returns version + startedAt + pid so deploy scripts and tests can verify
  // they're talking to the CORRECT process (not a zombie from a previous deploy).
  const startedAt = new Date().toISOString();
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      version: VERSION,
      startedAt,
      pid: process.pid,
      ...(multiTargets
        ? { components: { multiTarget: { status: multiTargetHealthStatus(multiTargets.registry) } } }
        : {}),
    });
  });

  // ─── XSUAA OAuth Proxy Mode ──────────────────────────────
  if (config.xsuaaAuth && xsuaaCredentials) {
    const { mcpAuthRouter } = await import('@modelcontextprotocol/sdk/server/auth/router.js');
    const { requireBearerAuth } = await import('@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js');
    const {
      createXsuaaOAuthProvider,
      createChainedTokenVerifier,
      createXsuaaTokenVerifier,
      createOidcVerifier,
      createOAuthCallbackHandler,
    } = await import('@arc-mcp/xsuaa-auth');
    const { getAppUrl } = await import('./app-url.js');

    // Determine app URL for OAuth metadata
    const appUrl = getAppUrl() ?? `http://${bindHost}:${port}`;

    // Compute the prefix-aware public base once, up front — it's needed both
    // for the callback URL (below) and the metadata override (further down).
    // When ARC-1 is fronted by SAP API Management with a base path (e.g.
    // /arc1), endpoints must be advertised at that prefix even though the
    // Express routes live at the root (the proxy strips the prefix).
    const oauthParsedAppUrl = new URL(appUrl);
    const oauthBasePath = oauthParsedAppUrl.pathname.replace(/\/$/, ''); // '' for root, '/arc1' otherwise
    const oauthFullBase = `${oauthParsedAppUrl.origin}${oauthBasePath}`;
    // ARC-1's own OAuth callback (issue #214 callback proxy). Public, prefix-aware
    // URL sent to XSUAA as redirect_uri; the Express route is mounted at the root
    // `/oauth/callback` below since the proxy strips the prefix before forwarding.
    const oauthCallbackUrl = `${oauthFullBase}/oauth/callback`;
    const oauthLoggedOutUrl = `${oauthFullBase}${OAUTH_LOGGED_OUT_PATH}`;
    const xsuaaSessionRefreshUrl = buildXsuaaSessionRefreshUrl(xsuaaCredentials, oauthLoggedOutUrl);

    // Create XSUAA provider + chained verifier.
    //
    // The package defaults its client_id prefix + KDF labels to `mcp-*`. ARC-1
    // MUST override them to the historical `arc1-*` values so client_ids and
    // OAuth-state tokens minted by previous ARC-1 releases keep validating
    // (the signing-key derivation folds in the KDF label, and the prefix gates
    // `getClient`). These three strings are part of ARC-1's on-the-wire
    // contract — do not change them.
    const { provider, clientStore, stateCodec } = createXsuaaOAuthProvider(xsuaaCredentials, appUrl, {
      clientIdPrefix: 'arc1-',
      dcrKdfLabel: 'arc1-dcr/v1',
      stateKdfLabel: 'arc1-oauth-state/v1',
      dcrTtlSeconds: config.oauthDcrTtlSeconds,
      dcrSigningSecret: config.dcrSigningSecret,
      callbackUrl: oauthCallbackUrl,
      logger: authLibLogger,
    });
    // Inject ARC-1's scope-expansion policy + logger so the verifier emits the
    // same expanded AuthInfo.scopes ARC-1 produced before the extraction.
    const xsuaaVerifier = createXsuaaTokenVerifier(xsuaaCredentials, { expandScopes, logger: authLibLogger });
    // OIDC verifier comes from the package (hardened: pinned `algorithms`
    // allowlist, no `sub` in debug logs). `buildPackageOidcVerifier` threads
    // ARC-1's historical contract (accepted scopes, `expandScopes`, the
    // `['read']` fallback, clock tolerance). Construction is SYNC — the package
    // lazy-imports jose + memoizes the JWKS on first verify.
    const oidcVerifier = config.oidcIssuer ? buildPackageOidcVerifier(config, createOidcVerifier) : undefined;
    const chainedVerifier = createChainedTokenVerifier(
      { apiKeys: toApiKeyEntries(config) },
      xsuaaVerifier,
      oidcVerifier,
      { expandScopes, logger: authLibLogger },
    );

    // Include resourceMetadataUrl so the 401 WWW-Authenticate header contains the PRM URL.
    // Copilot Studio (and other PRM-aware clients) use this to discover the OAuth endpoints.
    const resourceMetadataUrl = `${appUrl}/.well-known/oauth-protected-resource/mcp`;
    const bearerAuth = requireBearerAuth({
      verifier: { verifyAccessToken: chainedVerifier },
      resourceMetadataUrl,
    });
    // Multi-target routes accept XSUAA identities only. Define this once and
    // reuse it for explicit routes and the Copilot `/authorize` compatibility
    // alias so multi mode cannot fall back to API-key/OIDC or a single target.
    const multiBearerAuth: express.RequestHandler | undefined =
      multiTargets && pinnedMcpHandler && aggregateMcpHandler
        ? (req, res, next) => {
            // `app.use('/authorize', ...)` temporarily trims req.path to `/`.
            // originalUrl preserves the public route, so the Copilot alias can
            // advertise the aggregate PRM instead of a non-existent root PRM.
            const originalPath = req.originalUrl?.split('?', 1)[0] || req.path;
            const lowerPath = originalPath.toLowerCase();
            const resourcePath = lowerPath === '/authorize' ? '/multi/mcp' : originalPath;
            const multiResourceMetadataUrl = `${oauthFullBase}/.well-known/oauth-protected-resource${resourcePath}`;
            const authenticate = requireBearerAuth({
              verifier: { verifyAccessToken: xsuaaVerifier },
              resourceMetadataUrl: multiResourceMetadataUrl,
            });
            authenticate(req, res, (error) => {
              if (error) {
                next(error);
                return;
              }
              // Keep route membership behind the global read scope without putting
              // `scope=read` in the initial 401 challenge. MCP clients can therefore
              // request the four mutation-free scopes advertised by the route PRM;
              // XSUAA still grants only the subset assigned to the authenticated user.
              if (!req.auth || !hasRequiredScope(req.auth.scopes, 'read')) {
                res
                  .set(
                    'WWW-Authenticate',
                    `Bearer error="insufficient_scope", error_description="Insufficient scope", scope="read", resource_metadata="${multiResourceMetadataUrl}"`,
                  )
                  .status(403)
                  .json({ error: 'insufficient_scope', error_description: 'Insufficient scope' });
                return;
              }
              next();
            });
          }
        : undefined;
    if (uiDeps) {
      const uiBearerAuth = requireBearerAuth({
        verifier: { verifyAccessToken: chainedVerifier },
        requiredScopes: ['admin'],
        resourceMetadataUrl,
      });
      mountUiRoutes(app, uiDeps, uiBearerAuth);
    }

    // ─── Layer 1: per-IP rate limiters on OAuth endpoints + /mcp ────────
    // Mounted BEFORE the auth router so spammed credentials are rejected before any
    // crypto / DB work. Discovery endpoints (/.well-known/*) are intentionally NOT
    // rate-limited — they're cheap, cacheable, and legitimate clients hit them on
    // every reconnect. See docs_page/rate-limiting.md.
    //
    // Every OAuth `app.use(path, …)` here receives a fresh `rateLimit({...})` middleware
    // DIRECTLY. No conditional dispatchers, no helper wrappers. CodeQL's
    // `js/missing-rate-limiting` query only recognises that exact pattern; going
    // through an inline arrow function with branch-based delegation makes it
    // re-open the alert (verified — see PR #276 review history).
    //
    // Copilot Studio JSON-RPC on `/authorize` skips the low OAuth bucket. The
    // root-mounted MCP limiter above counts it in the same higher-cap bucket as
    // every other MCP endpoint style.
    if (authRateLimitEnabled) {
      app.use('/register', createAuthRateLimiter('/register', config.authRateLimit));
      // /authorize OAuth limiter — skips Copilot Studio MCP JSON-RPC traffic.
      app.use('/authorize', createAuthRateLimiter('/authorize', config.authRateLimit, { skip: isCopilotJsonRpc }));
      app.use('/token', createAuthRateLimiter('/token', config.authRateLimit));
      app.use('/revoke', createAuthRateLimiter('/revoke', config.authRateLimit));
      // /oauth/callback is unauthenticated and does an HMAC verify per hit —
      // rate-limit it like the other OAuth endpoints to gate token-probing.
      app.use('/oauth/callback', createAuthRateLimiter('/oauth/callback', config.authRateLimit));
    }
    // ─── OAuth authorize normalization + Copilot Studio MCP workaround ──
    // Copilot Studio sends MCP JSON-RPC requests to /authorize instead of
    // /mcp after completing the OAuth flow. When we detect a JSON-RPC body
    // (has "jsonrpc" field) on POST /authorize, we bypass the OAuth handler
    // and route directly to the applicable bearer verifier + MCP handler.
    //
    // For normal OAuth requests, merge query params into body as fallback
    // (some clients send POST /authorize with params in query string).
    app.use('/authorize', (req, res, next) => {
      // Detect MCP JSON-RPC on /authorize (Copilot Studio quirk). Reuses the
      // exact same predicate as the rate-limit skip()s above — the two MUST
      // agree, otherwise a request that one path treats as Copilot and the
      // other treats as OAuth slips through the wrong rate-limit bucket.
      if (isCopilotJsonRpc(req)) {
        logger.info('MCP JSON-RPC on /authorize, routing to MCP handler', {
          rpcMethod: req.body.method,
          id: req.body.id,
          userAgent: req.headers['user-agent']?.slice(0, 60),
        });
        // The compatibility alias is necessarily target-ambiguous. Whenever
        // multi-target mode is enabled, resolve it to the mutation-free
        // aggregate route and its XSUAA-only verifier, even if a separately
        // configured (and potentially writable) single-target /mcp coexists.
        // Only a single-target-only deployment may use the chained verifier.
        const useAggregateAlias = !!(aggregateMcpHandler && multiBearerAuth);
        const authorizeBearerAuth = useAggregateAlias ? multiBearerAuth : bearerAuth;
        authorizeBearerAuth(req, res, (err?: unknown) => {
          if (err) {
            next(err);
            return;
          }
          const handler = useAggregateAlias ? aggregateMcpHandler : mcpHandler;
          if (!handler) {
            res.status(404).json({ error: 'Not found' });
            return;
          }
          handler(req, res);
        });
        return;
      }

      logger.debug('OAuth authorize request', {
        method: req.method,
        contentType: req.headers['content-type'],
        hasBody: !!req.body,
        bodyKeys: req.body ? Object.keys(req.body) : [],
        queryKeys: Object.keys(req.query),
      });
      if (req.method === 'POST' && req.query.client_id && !req.body?.client_id) {
        req.body = { ...req.query, ...(req.body || {}) };
        logger.debug('OAuth authorize: merged query params into body', {
          client_id: req.body.client_id,
        });
      }

      // Auto-register redirect_uri for the pre-registered XSUAA client.
      // The MCP SDK requires exact redirect_uri matching, but XSUAA itself
      // validates redirect URIs against xs-security.json wildcard patterns.
      // For clients like Copilot Studio that use Manual OAuth config with the
      // XSUAA client_id, we dynamically add their redirect_uri to pass the
      // SDK's exact-match check — XSUAA remains the authoritative validator.
      const params = req.method === 'POST' ? req.body : req.query;
      const redirectUri = params?.redirect_uri;
      const clientId = params?.client_id;
      if (clientId && redirectUri && typeof redirectUri === 'string') {
        clientStore.ensureRedirectUri(clientId, redirectUri);
      }

      next();
    });

    // ─── OAuth callback proxy (issue #214) ─────────────────────────
    // XSUAA echoes a literal `+` (not `%2B`) in the `state` it appends to the
    // redirect URL. base64 `state` values (e.g. VS Code's
    // `randomBytes(16).toString('base64')`) contain `+` ~50% of the time; the
    // receiving client parses the callback query with form-urlencoded
    // semantics (`+`→space), so the round-tripped `state` no longer matches
    // and login fails with "State does not match".
    //
    // ARC-1 cannot change what XSUAA emits, so the provider's authorize()
    // sends XSUAA ARC-1's own /oauth/callback + an opaque base64url state
    // token (immune to the `+` bug). XSUAA redirects HERE; we decode the token
    // to recover the client's ORIGINAL redirect_uri + state, then redirect to
    // the client re-emitting the state via URLSearchParams, which encodes `+`
    // as `%2B` so the client parses it back correctly.
    //
    // Mounted at the root path; the public (prefix-aware) form was sent to
    // XSUAA as oauthCallbackUrl. A strip-prefix proxy maps the public path
    // back to this root route. Handler is extracted (exported) so the
    // state-round-trip contract is unit-testable without a live XSUAA.
    app.get(OAUTH_LOGGED_OUT_PATH, createOAuthLoggedOutHandler());
    app.get(
      '/oauth/callback',
      withInvalidScopeSessionRecovery(
        createOAuthCallbackHandler(stateCodec, clientStore, { logger: authLibLogger }),
        xsuaaSessionRefreshUrl,
      ),
    );

    // ─── Path-prefix-aware OAuth metadata override ────────────────
    // The MCP SDK's `mcpAuthRouter` builds endpoint URLs with
    // `new URL("/authorize", baseUrl).href`, which strips any path component
    // from baseUrl ("https://api/arc1" → "https://api/authorize"). When arc-1
    // is fronted by SAP API Management with a base path like /arc1, that
    // produces metadata pointing at the wrong URL — clients then call
    // `https://api/authorize` directly and bypass (or 404 on) the proxy.
    //
    // Override: if appUrl has a non-root path, mount custom GET handlers for
    // both well-known endpoints BEFORE the SDK router so they win the route
    // match. The handlers emit prefix-aware absolute URLs. The actual OAuth
    // endpoints (/authorize, /token, /register, /revoke) stay at the root of
    // arc-1's Express app — the proxy strips its base path before forwarding,
    // so they resolve correctly without further changes.
    // Reuse the prefix-aware base computed once near the top of this block.
    const basePath = oauthBasePath;
    const fullBase = oauthFullBase;
    const scopesSupported = ['read', 'write', 'data', 'sql', 'transports', 'git', 'admin'];

    if (basePath) {
      const customAuthMetadata = {
        issuer: `${fullBase}/`,
        authorization_endpoint: `${fullBase}/authorize`,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint: `${fullBase}/token`,
        token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        scopes_supported: scopesSupported,
        revocation_endpoint: `${fullBase}/revoke`,
        revocation_endpoint_auth_methods_supported: ['client_secret_post'],
        registration_endpoint: `${fullBase}/register`,
      };
      const customResourceMetadata = {
        resource: `${fullBase}/mcp`,
        authorization_servers: [`${fullBase}/`],
        scopes_supported: scopesSupported,
        resource_name: 'ARC-1 SAP MCP Server',
      };

      app.get('/.well-known/oauth-authorization-server', (_req, res) => {
        res.json(customAuthMetadata);
      });
      // Serve PRM at BOTH the root path (where MCP clients look by default after
      // a strip-prefix proxy hop) and at the prefixed path the SDK would have
      // used — defensive in case some clients don't strip.
      app.get('/.well-known/oauth-protected-resource/mcp', (_req, res) => {
        res.json(customResourceMetadata);
      });
      app.get(`/.well-known/oauth-protected-resource${basePath}/mcp`, (_req, res) => {
        res.json(customResourceMetadata);
      });

      logger.info('OAuth metadata override active (path-prefix mode)', {
        publicUrl: fullBase,
        basePath,
      });
    }

    // Registry-independent multi-target PRM routes must precede the SDK router.
    // Syntactically valid unknown targets intentionally receive the same metadata as known ones.
    if (multiTargets && pinnedMcpHandler && aggregateMcpHandler) {
      app.get(/^\/\.well-known\/oauth-protected-resource\/multi\/mcp$/, (_req, res) => {
        res.json({
          resource: `${oauthFullBase}/multi/mcp`,
          authorization_servers: [`${oauthFullBase}/`],
          scopes_supported: MULTI_TARGET_SCOPES_SUPPORTED,
          resource_name: 'ARC-1 SAP MCP Server (multi-target)',
        });
      });
      app.get(PINNED_RESOURCE_METADATA_PATH_PATTERN, (req, res) => {
        const match = req.path.match(PINNED_RESOURCE_METADATA_PATH_PATTERN);
        res.json({
          resource: `${oauthFullBase}/${match?.[1]}/${match?.[2]}/mcp`,
          authorization_servers: [`${oauthFullBase}/`],
          scopes_supported: MULTI_TARGET_SCOPES_SUPPORTED,
          resource_name: 'ARC-1 SAP MCP Server (pinned target)',
        });
      });
    }

    // Install MCP SDK auth router at root (OAuth endpoints + DCR).
    // For root-path deployments (no basePath) the SDK's metadata is correct
    // as-is and serves both well-known endpoints. For prefix deployments the
    // custom handlers above shadow the SDK's metadata routes; the SDK still
    // serves /authorize, /token, /register, /revoke at root which is what we
    // want.
    app.use(
      mcpAuthRouter({
        provider,
        issuerUrl: new URL(appUrl),
        baseUrl: new URL(appUrl),
        resourceServerUrl: new URL(`${appUrl}/mcp`),
        scopesSupported,
        resourceName: 'ARC-1 SAP MCP Server',
      }),
    );

    if (multiTargets && pinnedMcpHandler && aggregateMcpHandler && multiBearerAuth) {
      app.all(/^\/multi\/mcp$/, multiBearerAuth, aggregateMcpHandler);
      app.all(PINNED_MCP_PATH_PATTERN, multiBearerAuth, pinnedMcpHandler);
    }

    // Protected MCP endpoint with chained token verification
    if (mcpHandler) app.all('/mcp', bearerAuth, mcpHandler);

    logger.info('XSUAA OAuth proxy enabled', {
      xsappname: xsuaaCredentials.xsappname,
      appUrl,
    });
  } else {
    // ─── Standard Auth Mode (API key / OIDC) ─────────────────
    // No JWKS pre-warm needed: the package's OIDC verifier lazy-imports jose and
    // memoizes the remote JWKS on the first verify (and retries on a transient
    // discovery failure instead of caching the rejection).

    if (config.apiKeys || config.oidcIssuer) {
      // Use requireBearerAuth so that authInfo is populated on the MCP request context.
      // This enables scope enforcement, per-request safety, and principal propagation.
      const { requireBearerAuth } = await import('@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js');
      const verifier = await createStandardVerifier(config);
      const bearerAuth = requireBearerAuth({ verifier: { verifyAccessToken: verifier } });
      if (uiDeps) {
        const uiBearerAuth = requireBearerAuth({
          verifier: { verifyAccessToken: verifier },
          requiredScopes: ['admin'],
        });
        mountUiRoutes(app, uiDeps, uiBearerAuth);
      }
      if (mcpHandler) app.all('/mcp', bearerAuth, mcpHandler);
    } else {
      // No auth configured — open access
      if (mcpHandler) app.all('/mcp', mcpHandler);
    }
  }

  // ─── 404 for anything else ─────────────────────────────────
  app.use((req, res) => {
    logger.debug('404 Not Found', { method: req.method, path: req.path, url: req.originalUrl });
    res.status(404).json({ error: 'Not found. Use /mcp for MCP protocol, /health for health check.' });
  });

  // ─── Start listening ───────────────────────────────────────
  const httpServer = app.listen(port, bindHost, () => {
    let authMode = 'NONE (open)';
    if (config.xsuaaAuth && xsuaaCredentials) authMode = 'XSUAA OAuth proxy';
    else if (config.apiKeys && config.oidcIssuer) authMode = 'API keys + OIDC';
    else if (config.apiKeys) authMode = `API keys (${config.apiKeys.length} keys)`;
    else if (config.oidcIssuer) authMode = 'OIDC';

    logger.info('ARC-1 HTTP server started', {
      addr: `${bindHost}:${port}`,
      health: `http://${bindHost}:${port}/health`,
      mcp: serverFactory ? `http://${bindHost}:${port}/mcp` : undefined,
      multi: multiTargets ? `http://${bindHost}:${port}/multi/mcp` : undefined,
      ui: uiDeps ? `http://${bindHost}:${port}/ui/` : undefined,
      auth: authMode,
    });
  });

  // Catch port-in-use and other bind errors so the process exits with a clear message
  // instead of silently dying without any output.
  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(
        `Port ${port} is already in use — stop the existing process or change the port via ARC1_PORT (e.g. ARC1_PORT=8081) or ARC1_HTTP_ADDR`,
        { port, code: err.code },
      );
    } else {
      logger.error('HTTP server failed to start', { error: err.message, code: err.code });
    }
    process.exit(1);
  });
}

// ─── OIDC Verifier (package-backed) ─────────────────────────────────

/**
 * ARC-1's recognised scope names — the `acceptedScopes` allowlist threaded into
 * the package's OIDC verifier so non-ARC-1 claims (e.g. Entra's `User.Read`) are
 * filtered out, exactly as ARC-1's removed inline `extractOidcScopes` did.
 */
const KNOWN_SCOPES = ['read', 'write', 'data', 'sql', 'transports', 'git', 'admin'];

/**
 * Build the package's OIDC verifier from `ServerConfig`, threading ARC-1's
 * historical contract so adopting it changes nothing observable except the two
 * intended hardening wins (pinned `algorithms` allowlist + no `sub` in the debug
 * log — both live inside the package now):
 *   - `acceptedScopes = KNOWN_SCOPES` (same filter as the old inline code),
 *   - `expandScopes` = ARC-1's policy expander (implied scopes: write⊇read, …),
 *   - `fallbackScopes: ['read']` = ARC-1's legacy default — a verified token with
 *     no scope claims, OR scope claims none of which are accepted, grants `['read']`
 *     (the package defaults this to `[]`; ARC-1 opts back into read-only),
 *   - `scopeClaim` left default (`'scope'`, preferred over `scp`),
 *   - `clockToleranceSec` only when `config.oidcClockTolerance` is set.
 *
 * `config.oidcAudience` is optional in ARC-1 and was historically forwarded to
 * jose verbatim (jose treats `undefined` as "skip the audience check"); the
 * package forwards it the same way, so we pass it through unchanged. The package
 * signature types `audience` as `string`; the cast preserves the
 * undefined-passthrough without an empty-string audience that would force a
 * (failing) audience check. `config.oidcIssuer` is asserted non-null — every
 * call site is gated on `config.oidcIssuer`.
 *
 * Construction is synchronous: the package lazy-imports jose and memoizes the
 * remote JWKS on the first verify.
 */
function buildPackageOidcVerifier(
  config: ServerConfig,
  createOidcVerifier: typeof import('@arc-mcp/xsuaa-auth').createOidcVerifier,
): import('@arc-mcp/xsuaa-auth').Verifier {
  return createOidcVerifier(config.oidcIssuer as string, config.oidcAudience as string, {
    acceptedScopes: KNOWN_SCOPES,
    expandScopes,
    fallbackScopes: ['read'],
    ...(config.oidcClockTolerance != null ? { clockToleranceSec: config.oidcClockTolerance } : {}),
    logger: authLibLogger,
  });
}

// ─── Standard Mode Verifier ─────────────────────────────────────────

/**
 * Create a token verifier for standard auth mode (API key + OIDC).
 *
 * Built entirely from the `@arc-mcp/xsuaa-auth` package's chained verifier
 * (constant-time api-key compare + hardened OIDC), mirroring how XSUAA mode wires
 * its chain — minus the XSUAA verifier, which standard mode doesn't have. The
 * chain order is XSUAA → OIDC → api-key; with no XSUAA verifier that collapses to
 * OIDC → api-key, which is order-immaterial here (token types are disjoint) and
 * preserves the previous behavior (api-key matched first only mattered because
 * the two paths never overlap). Returns `AuthInfo` so the MCP SDK populates
 * `extra.authInfo` on the request context, enabling scope enforcement,
 * per-request safety, and principal propagation.
 *
 * Async because the package is dynamic-imported (lazy, consistent with the rest
 * of this module); the returned verifier itself is the package's sync-built
 * chained verifier.
 */
export async function createStandardVerifier(config: ServerConfig): Promise<import('@arc-mcp/xsuaa-auth').Verifier> {
  const { createChainedTokenVerifier, createOidcVerifier } = await import('@arc-mcp/xsuaa-auth');
  const oidcVerifier = config.oidcIssuer ? buildPackageOidcVerifier(config, createOidcVerifier) : undefined;
  return createChainedTokenVerifier({ apiKeys: toApiKeyEntries(config) }, undefined, oidcVerifier, {
    expandScopes,
    logger: authLibLogger,
  });
}
