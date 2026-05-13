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

import type { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import cors from 'cors';
import type { Request, Response } from 'express';
import express from 'express';
import helmet from 'helmet';
import { expandScopes } from '../authz/policy.js';
import { API_KEY_PROFILES } from './config.js';
import { logger } from './logger.js';
import { VERSION } from './server.js';
import type { ServerConfig } from './types.js';
import type { XsuaaCredentials } from './xsuaa.js';

// ─── API Key Matching Helper ─────────────────────────────────────────

/**
 * Match a token against configured API keys (multi-key with profiles).
 * Returns the matched entry's profile and scopes, or undefined if no match.
 */
function matchApiKey(
  token: string,
  config: ServerConfig,
): { profile: string; scopes: string[]; clientId: string } | undefined {
  // Multi-key: each API key has a named profile that maps to a scope set + partial SafetyConfig
  if (config.apiKeys) {
    for (const entry of config.apiKeys) {
      if (token === entry.key) {
        const profile = API_KEY_PROFILES[entry.profile];
        if (!profile) {
          // Should have been caught at config parse; defense in depth
          return undefined;
        }
        const scopes = expandScopes(profile.scopes);
        return { profile: entry.profile, scopes, clientId: `api-key:${entry.profile}` };
      }
    }
  }
  return undefined;
}

// ─── JWKS / JWT types (lazy-loaded from jose) ────────────────────────

let joseModule: typeof import('jose') | null = null;
let jwksClient: ReturnType<typeof import('jose').createRemoteJWKSet> | null = null;

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
        allowedHeaders: ['Content-Type', 'Authorization', 'mcp-session-id'],
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
 * Create an Express handler that processes MCP requests.
 * Each request gets a fresh Server + Transport pair.
 */
function createMcpHandler(serverFactory: () => McpServer) {
  return async (req: Request, res: Response) => {
    logger.debug('MCP handler invoked', {
      method: req.method,
      contentType: req.headers['content-type'],
      hasBody: !!req.body,
      bodyMethod: req.body?.method,
      bodyId: req.body?.id,
    });
    try {
      const server = serverFactory();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // Stateless mode
      });
      await server.connect(transport);
      // IMPORTANT: Pass req.body as pre-parsed body (3rd argument).
      // express.json() middleware (line 91) consumes the raw request stream.
      // Without this, the MCP SDK's transport tries to re-read the stream,
      // gets nothing, and returns "Parse error: Invalid JSON" (-32700).
      // The SDK explicitly supports this pattern — see their docs/comments
      // in StreamableHTTPServerTransport.handleRequest().
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      logger.error('MCP request error', { error: err instanceof Error ? err.message : String(err) });
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  };
}

/**
 * Start the HTTP Streamable server.
 */
export async function startHttpServer(
  serverFactory: () => McpServer,
  config: ServerConfig,
  xsuaaCredentials?: XsuaaCredentials,
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
  // One operator-facing knob (`ARC1_AUTH_RATE_LIMIT`, default 20/min/IP) controls all
  // OAuth endpoints uniformly. `/mcp` gets `max(value × 30, 600)/min/IP` so legitimate
  // batched tool-call traffic isn't choked while pre-bearer-auth probing is still gated.
  // Per-endpoint differentiation lives here, not in env, so the operator surface stays tiny.
  // See docs_page/rate-limiting.md (Layer 1) and ADR-0004.
  //
  // Implementation note: the limiter is mounted DIRECTLY via createAuthRateLimiter →
  // express-rate-limit. The disabled path skips the mount entirely rather than going
  // through a noop indirection — this keeps the dataflow `rateLimit({...}) → app.use`
  // direct and makes CodeQL's `js/missing-rate-limiting` query close cleanly.
  const { createAuthRateLimiter, isCopilotJsonRpc } = await import('./auth-rate-limit.js');
  const rateLimitEnabled = config.authRateLimit > 0;
  const mcpRatePerMinute = rateLimitEnabled ? Math.max(config.authRateLimit * 30, 600) : 0;
  logger.info('Auth rate limiting', {
    perMinute: config.authRateLimit,
    mcpPerMinute: mcpRatePerMinute,
    endpoints: rateLimitEnabled ? ['/register', '/authorize', '/token', '/revoke', '/mcp'] : [],
    disabled: !rateLimitEnabled,
  });

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  const mcpHandler = createMcpHandler(serverFactory);

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
    res.json({ status: 'ok', version: VERSION, startedAt, pid: process.pid });
  });

  // ─── XSUAA OAuth Proxy Mode ──────────────────────────────
  if (config.xsuaaAuth && xsuaaCredentials) {
    const { mcpAuthRouter } = await import('@modelcontextprotocol/sdk/server/auth/router.js');
    const { requireBearerAuth } = await import('@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js');
    const { createXsuaaOAuthProvider, createChainedTokenVerifier, createXsuaaTokenVerifier } = await import(
      './xsuaa.js'
    );
    const { getAppUrl } = await import('../adt/btp.js');

    // Determine app URL for OAuth metadata
    const appUrl = getAppUrl() ?? `http://${bindHost}:${port}`;

    // Create XSUAA provider + chained verifier
    const { provider, clientStore } = createXsuaaOAuthProvider(xsuaaCredentials, appUrl, {
      dcrTtlSeconds: config.oauthDcrTtlSeconds,
      dcrSigningSecret: config.dcrSigningSecret,
    });
    const xsuaaVerifier = createXsuaaTokenVerifier(xsuaaCredentials);
    const oidcVerifier = config.oidcIssuer ? await createOidcVerifier(config) : undefined;
    const chainedVerifier = createChainedTokenVerifier(config, xsuaaVerifier, oidcVerifier);

    // Include resourceMetadataUrl so the 401 WWW-Authenticate header contains the PRM URL.
    // Copilot Studio (and other PRM-aware clients) use this to discover the OAuth endpoints.
    const resourceMetadataUrl = `${appUrl}/.well-known/oauth-protected-resource/mcp`;
    const bearerAuth = requireBearerAuth({
      verifier: { verifyAccessToken: chainedVerifier },
      resourceMetadataUrl,
    });

    // ─── Layer 1: per-IP rate limiters on OAuth endpoints + /mcp ────────
    // Mounted BEFORE the auth router so spammed credentials are rejected before any
    // crypto / DB work. Discovery endpoints (/.well-known/*) are intentionally NOT
    // rate-limited — they're cheap, cacheable, and legitimate clients hit them on
    // every reconnect. See docs_page/rate-limiting.md.
    //
    // Every `app.use(path, …)` here receives a fresh `rateLimit({...})` middleware
    // DIRECTLY. No conditional dispatchers, no helper wrappers. CodeQL's
    // `js/missing-rate-limiting` query only recognises that exact pattern; going
    // through an inline arrow function with branch-based delegation makes it
    // re-open the alert (verified — see PR #276 review history).
    //
    // Copilot Studio quirk: that client POSTs MCP JSON-RPC bodies to `/authorize`
    // (see routing handler below). To stop those tool calls being choked at the
    // low OAuth cap, we mount TWO limiters on `/authorize`:
    //   1. OAuth cap, with `skip` returning true for Copilot JSON-RPC traffic.
    //   2. /mcp cap, with `skip` returning true for everything BUT Copilot JSON-RPC.
    // Each request hits one bucket — the OAuth bucket for real OAuth flows, the
    // higher /mcp bucket for Copilot. The `isCopilotJsonRpc` predicate is shared
    // with auth-rate-limit.ts so the two mounts can never drift.
    //
    // Trade-off: the /authorize-JSON-RPC bucket is a separate store from the
    // direct /mcp bucket. An attacker alternating routes effectively gets
    // `mcpCap + mcpCap = 2 × mcpCap`/min/IP. At default config that's still
    // 1200/min, well below abuse thresholds. Sharing the store would require
    // injecting a custom MemoryStore into both `rateLimit({...})` calls — not
    // worth the complexity for a 2× headroom on an already loose cap.
    if (rateLimitEnabled) {
      app.use('/register', createAuthRateLimiter('/register', config.authRateLimit));
      // /authorize OAuth limiter — skips Copilot Studio MCP JSON-RPC traffic.
      app.use('/authorize', createAuthRateLimiter('/authorize', config.authRateLimit, { skip: isCopilotJsonRpc }));
      // /authorize MCP limiter — only applies to Copilot Studio JSON-RPC; uses /mcp cap.
      app.use('/authorize', createAuthRateLimiter('/mcp', mcpRatePerMinute, { skip: (req) => !isCopilotJsonRpc(req) }));
      app.use('/token', createAuthRateLimiter('/token', config.authRateLimit));
      app.use('/revoke', createAuthRateLimiter('/revoke', config.authRateLimit));
    }

    // ─── OAuth authorize normalization + Copilot Studio MCP workaround ──
    // Copilot Studio sends MCP JSON-RPC requests to /authorize instead of
    // /mcp after completing the OAuth flow. When we detect a JSON-RPC body
    // (has "jsonrpc" field) on POST /authorize, we bypass the OAuth handler
    // and route directly to bearerAuth + mcpHandler.
    //
    // For normal OAuth requests, merge query params into body as fallback
    // (some clients send POST /authorize with params in query string).
    app.use('/authorize', (req, res, next) => {
      // Detect MCP JSON-RPC on /authorize (Copilot Studio quirk)
      if (req.method === 'POST' && req.body?.jsonrpc) {
        logger.info('MCP JSON-RPC on /authorize, routing to MCP handler', {
          rpcMethod: req.body.method,
          id: req.body.id,
          userAgent: req.headers['user-agent']?.slice(0, 60),
        });
        // Run bearerAuth, then mcpHandler — skip the OAuth authorize handler
        bearerAuth(req, res, (err?: unknown) => {
          if (err) {
            next(err);
            return;
          }
          mcpHandler(req, res);
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
    const parsedAppUrl = new URL(appUrl);
    const basePath = parsedAppUrl.pathname.replace(/\/$/, ''); // '' for root, '/arc1' otherwise
    const fullBase = `${parsedAppUrl.origin}${basePath}`; // 'https://api/arc1' or 'https://api'
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

    // Layer 1: rate-limit /mcp BEFORE bearer auth so anonymous probing is gated.
    // Direct `app.use(path, rateLimit({...}))` mount — no helper indirection —
    // so CodeQL's `js/missing-rate-limiting` query sees the dataflow cleanly.
    if (rateLimitEnabled) {
      app.use('/mcp', createAuthRateLimiter('/mcp', mcpRatePerMinute));
    }
    // Protected MCP endpoint with chained token verification
    app.all('/mcp', bearerAuth, mcpHandler);

    logger.info('XSUAA OAuth proxy enabled', {
      xsappname: xsuaaCredentials.xsappname,
      appUrl,
    });
  } else {
    // ─── Standard Auth Mode (API key / OIDC) ─────────────────
    if (config.oidcIssuer) {
      await initJwks(config.oidcIssuer);
    }

    // Layer 1 on /mcp also applies outside XSUAA mode — API-key / OIDC / no-auth
    // deployments get the same anonymous-probing protection. OAuth endpoints don't
    // exist in non-XSUAA mode so only /mcp needs mounting here.
    if (rateLimitEnabled) {
      app.use('/mcp', createAuthRateLimiter('/mcp', mcpRatePerMinute));
    }

    if (config.apiKeys || config.oidcIssuer) {
      // Use requireBearerAuth so that authInfo is populated on the MCP request context.
      // This enables scope enforcement, per-request safety, and principal propagation.
      const { requireBearerAuth } = await import('@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js');
      const verifier = createStandardVerifier(config);
      const bearerAuth = requireBearerAuth({ verifier: { verifyAccessToken: verifier } });
      app.all('/mcp', bearerAuth, mcpHandler);
    } else {
      // No auth configured — open access
      app.all('/mcp', mcpHandler);
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
      mcp: `http://${bindHost}:${port}/mcp`,
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

// ─── Standard Mode Verifier ─────────────────────────────────────────

/**
 * Create a token verifier for standard auth mode (API key + OIDC).
 * Returns AuthInfo so the MCP SDK populates extra.authInfo on the request,
 * enabling scope enforcement, per-request safety, and principal propagation.
 */
function createStandardVerifier(
  config: ServerConfig,
): (token: string) => Promise<import('@modelcontextprotocol/sdk/server/auth/types.js').AuthInfo> {
  return async (token: string) => {
    // Lazy-import SDK error classes so bearerAuth maps them to 401/403
    const { InvalidTokenError } = await import('@modelcontextprotocol/sdk/server/auth/errors.js');

    // API key: match against multi-key map or single key
    const apiKeyMatch = matchApiKey(token, config);
    if (apiKeyMatch) {
      // expiresAt is required by requireBearerAuth — use far-future expiry for static keys
      const ONE_YEAR_SECS = 365 * 24 * 60 * 60;
      return {
        token,
        clientId: apiKeyMatch.clientId,
        scopes: apiKeyMatch.scopes,
        expiresAt: Math.floor(Date.now() / 1000) + ONE_YEAR_SECS,
      };
    }

    // OIDC: validate JWT and extract scopes
    if (config.oidcIssuer) {
      try {
        if (!joseModule || !jwksClient) {
          await initJwks(config.oidcIssuer);
        }
        if (!joseModule || !jwksClient) {
          throw new Error('OIDC not initialized — check SAP_OIDC_ISSUER configuration');
        }
        const { payload } = await joseModule.jwtVerify(token, jwksClient, {
          issuer: config.oidcIssuer,
          audience: config.oidcAudience,
          requiredClaims: ['exp'],
          ...(config.oidcClockTolerance != null ? { clockTolerance: config.oidcClockTolerance } : {}),
        });

        logger.debug('Standard OIDC JWT validated', { sub: payload.sub, iss: payload.iss });

        const scopes = extractOidcScopes(payload);

        return {
          token,
          clientId: (payload.azp as string) ?? (payload.sub as string) ?? 'oidc-user',
          scopes,
          expiresAt: payload.exp,
          extra: { sub: payload.sub, iss: payload.iss },
        };
      } catch (err) {
        // Wrap JWT validation errors as InvalidTokenError so bearerAuth returns 401
        if (err instanceof InvalidTokenError) throw err;
        throw new InvalidTokenError((err as Error).message ?? 'Invalid token');
      }
    }

    throw new InvalidTokenError('Authentication failed: invalid token');
  };
}

// ─── OIDC Verifier Factory ───────────────────────────────────────────

/**
 * Create an Entra ID / OIDC token verifier using jose.
 * Returns a function compatible with the chained verifier.
 */
async function createOidcVerifier(
  config: ServerConfig,
): Promise<(token: string) => Promise<import('@modelcontextprotocol/sdk/server/auth/types.js').AuthInfo>> {
  await initJwks(config.oidcIssuer!);

  return async (token: string) => {
    if (!joseModule || !jwksClient) {
      throw new Error('OIDC not initialized');
    }
    const { payload } = await joseModule.jwtVerify(token, jwksClient, {
      issuer: config.oidcIssuer,
      audience: config.oidcAudience,
      requiredClaims: ['exp'],
      ...(config.oidcClockTolerance != null ? { clockTolerance: config.oidcClockTolerance } : {}),
    });

    logger.debug('OIDC JWT validated', { sub: payload.sub, iss: payload.iss });

    const scopes = extractOidcScopes(payload);

    return {
      token,
      clientId: (payload.azp as string) ?? (payload.sub as string) ?? 'oidc-user',
      scopes,
      expiresAt: payload.exp,
      extra: { sub: payload.sub, iss: payload.iss },
    };
  };
}

// ─── OIDC Scope Extraction ──────────────────────────────────────────

const KNOWN_SCOPES = ['read', 'write', 'data', 'sql', 'transports', 'git', 'admin'];

/**
 * Extract scopes from an OIDC JWT payload.
 *
 * Tries `scope` (space-separated string, standard OIDC) then `scp` (array, Azure AD style).
 * Filters to known scopes, applies implied scope expansion, and falls back to read-only
 * when no scope claims are present (safe default for providers that don't emit scopes).
 */
export function extractOidcScopes(payload: Record<string, unknown>): string[] {
  let rawScopes: string[] | undefined;

  // Standard OIDC: space-separated string
  if (typeof payload.scope === 'string') {
    rawScopes = payload.scope.split(' ').filter((s) => s.length > 0);
  }
  // Azure AD / Entra: `scp` as space-delimited string (delegated tokens) or array (app tokens)
  else if (typeof payload.scp === 'string') {
    rawScopes = payload.scp.split(' ').filter((s) => s.length > 0);
  } else if (Array.isArray(payload.scp)) {
    rawScopes = (payload.scp as string[]).filter((s) => typeof s === 'string' && s.length > 0);
  }

  // No scope claims at all → read-only (safe default)
  if (rawScopes === undefined) {
    logger.warn(
      'OIDC JWT has no scope/scp claims — granting read-only access. ' +
        'Configure scope claims in your OIDC provider to grant write/data/sql access.',
    );
    return ['read'];
  }

  // Filter to known scopes
  const filtered = rawScopes.filter((s) => KNOWN_SCOPES.includes(s));

  // If scopes were present but none are known, grant minimum read access
  if (filtered.length === 0) {
    logger.warn('OIDC JWT has scope claims but none match known scopes — granting read-only', { rawScopes });
    return ['read'];
  }

  return expandScopes(filtered);
}

/**
 * Initialize JWKS client from OIDC discovery.
 */
async function initJwks(issuer: string): Promise<void> {
  if (joseModule && jwksClient) return;

  try {
    if (!joseModule) {
      joseModule = await import('jose');
    }
    const jwksUri = new URL('.well-known/openid-configuration', issuer.endsWith('/') ? issuer : `${issuer}/`);
    const discoveryResp = await fetch(jwksUri.toString());
    const discovery = (await discoveryResp.json()) as { jwks_uri: string };

    if (!discovery.jwks_uri) {
      throw new Error(`No jwks_uri in OIDC discovery response from ${jwksUri}`);
    }

    jwksClient = joseModule.createRemoteJWKSet(new URL(discovery.jwks_uri));
    logger.info('OIDC JWKS initialized', { issuer, jwksUri: discovery.jwks_uri });
  } catch (err) {
    logger.error('Failed to initialize OIDC JWKS', {
      issuer,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
