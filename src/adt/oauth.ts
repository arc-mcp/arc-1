/**
 * OAuth 2.0 Authorization Code flow for BTP ABAP Environment.
 *
 * Implements the browser-based login flow used by Eclipse ADT and fr0ster/mcp-abap-adt:
 * 1. Parse BTP service key JSON (from file or env var)
 * 2. Start local callback server to receive authorization code
 * 3. Open browser to XSUAA authorization endpoint
 * 4. Exchange code for JWT access + refresh tokens
 * 5. Cache tokens, auto-refresh before expiry
 *
 * The resulting Bearer token is used with `Authorization: Bearer <token>`
 * on all ADT requests (replacing Basic Auth).
 *
 * Cross-platform: uses `open` (macOS), `xdg-open` (Linux), `rundll32` (Windows).
 */

import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import { logger } from '../server/logger.js';

// ─── Types ─────────────────────────────────────────────────────────

/** BTP ABAP service key structure (from BTP Cockpit) */
export interface BTPServiceKey {
  /** UAA (XSUAA) credentials for OAuth */
  uaa: {
    /** XSUAA base URL (e.g., "https://subdomain.authentication.eu10.hana.ondemand.com") */
    url: string;
    /** OAuth client ID */
    clientid: string;
    /** OAuth client secret */
    clientsecret: string;
  };
  /** ABAP system URL (e.g., "https://system-id.abap.eu10.hana.ondemand.com") */
  url: string;
  /** Optional: ABAP-specific section */
  abap?: {
    url?: string;
    sapClient?: string;
  };
  /** Optional: Binding metadata */
  binding?: {
    env?: string;
    type?: string;
  };
  /** Optional: Catalog info */
  catalogs?: Record<string, { path: string; type: string }>;
}

/** OAuth token response from XSUAA */
export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

/** Cached token state */
interface TokenCache {
  accessToken: string;
  refreshToken?: string;
  /** Absolute time when token expires (ms since epoch) */
  expiresAt: number;
}

// ─── Service Key Parsing ───────────────────────────────────────────

/**
 * Parse a BTP ABAP service key from JSON string.
 * Validates required fields.
 */
export function parseServiceKey(json: string): BTPServiceKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid service key JSON: failed to parse');
  }

  const key = parsed as Record<string, unknown>;

  if (!key.url || typeof key.url !== 'string') {
    throw new Error('Invalid service key: missing "url" field');
  }

  const uaa = key.uaa as Record<string, unknown> | undefined;
  if (!uaa || typeof uaa !== 'object') {
    throw new Error('Invalid service key: missing "uaa" section');
  }

  if (!uaa.url || typeof uaa.url !== 'string') {
    throw new Error('Invalid service key: missing "uaa.url" field');
  }
  if (!uaa.clientid || typeof uaa.clientid !== 'string') {
    throw new Error('Invalid service key: missing "uaa.clientid" field');
  }
  if (!uaa.clientsecret || typeof uaa.clientsecret !== 'string') {
    throw new Error('Invalid service key: missing "uaa.clientsecret" field');
  }

  return parsed as BTPServiceKey;
}

/**
 * Load service key from file path.
 */
export function loadServiceKeyFile(filePath: string): BTPServiceKey {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return parseServiceKey(content);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Invalid service key')) throw err;
    throw new Error(
      `Failed to read service key file '${filePath}': ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Resolve service key from environment variables.
 * Priority: SAP_BTP_SERVICE_KEY (inline JSON) > SAP_BTP_SERVICE_KEY_FILE (file path)
 */
export function resolveServiceKey(): BTPServiceKey | undefined {
  const inline = process.env.SAP_BTP_SERVICE_KEY;
  if (inline) {
    return parseServiceKey(inline);
  }

  const filePath = process.env.SAP_BTP_SERVICE_KEY_FILE;
  if (filePath) {
    return loadServiceKeyFile(filePath);
  }

  return undefined;
}

// ─── OAuth Token Exchange ──────────────────────────────────────────

/**
 * Exchange an authorization code for OAuth tokens.
 * @param codeVerifier PKCE code verifier (if PKCE was used in the authorize request)
 */
export async function exchangeCodeForToken(
  serviceKey: BTPServiceKey,
  code: string,
  redirectUri: string,
  codeVerifier?: string,
): Promise<OAuthTokenResponse> {
  const tokenUrl = `${serviceKey.uaa.url}/oauth/token`;

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: serviceKey.uaa.clientid,
  });

  if (codeVerifier) {
    params.set('code_verifier', codeVerifier);
  }

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${serviceKey.uaa.clientid}:${serviceKey.uaa.clientsecret}`).toString('base64')}`,
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OAuth token exchange failed (${response.status}): ${body.slice(0, 500)}`);
  }

  return (await response.json()) as OAuthTokenResponse;
}

/**
 * Refresh an OAuth access token using a refresh token.
 */
export async function refreshAccessToken(serviceKey: BTPServiceKey, refreshToken: string): Promise<OAuthTokenResponse> {
  const tokenUrl = `${serviceKey.uaa.url}/oauth/token`;

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${serviceKey.uaa.clientid}:${serviceKey.uaa.clientsecret}`).toString('base64')}`,
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OAuth token refresh failed (${response.status}): ${body.slice(0, 500)}`);
  }

  return (await response.json()) as OAuthTokenResponse;
}

// ─── Security Helpers ─────────────────────────────────────────────

/**
 * Generate a cryptographically random PKCE code verifier and S256 challenge.
 * Per RFC 7636: verifier is 43-128 chars, URL-safe; challenge is base64url(SHA-256(verifier)).
 */
export function generatePkce(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

/**
 * Generate a cryptographically random state parameter for OAuth CSRF protection.
 * Returns a 32-byte base64url-encoded string.
 */
export function generateState(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Escape HTML special characters to prevent XSS in callback responses.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** CSP header that blocks all active content in callback HTML responses. */
const CSP_HEADER = "default-src 'none'";

// ─── Browser Authorization Code Flow ───────────────────────────────

/**
 * Open a URL in the user's default browser.
 * Cross-platform: macOS (open), Linux (xdg-open), Windows (rundll32).
 * Uses execFile() with argument arrays to prevent shell injection.
 */
export async function openBrowser(url: string): Promise<void> {
  const { execFile } = await import('node:child_process');
  const { platform } = await import('node:os');

  const os = platform();

  return new Promise((resolve, reject) => {
    const cb = (err: Error | null) => {
      if (err) {
        reject(new Error(`Failed to open browser (${os}): ${err.message}`));
      } else {
        resolve();
      }
    };

    switch (os) {
      case 'darwin':
        execFile('open', [url], cb);
        break;
      case 'win32':
        // NOT `cmd /c start` — cmd re-parses `&` in the URL as a command separator and truncates
        // it (issue #549). rundll32 takes the URL as one argv arg with no shell re-parse.
        execFile('rundll32', ['url.dll,FileProtocolHandler', url], cb);
        break;
      default:
        execFile('xdg-open', [url], cb);
        break;
    }
  });
}

/**
 * Start a local HTTP server to receive the OAuth callback.
 * Binds to 127.0.0.1 only (loopback) per RFC 8252 Section 8.3.
 * Returns a promise that resolves with the authorization code.
 *
 * @param port Port to listen on (0 = auto-assign)
 * @param timeoutMs Maximum wait time for callback (default: 120s)
 * @param expectedState Expected state parameter for CSRF validation (required)
 */
export function startCallbackServer(
  port: number,
  timeoutMs = 120000,
  expectedState?: string,
): { promise: Promise<string>; server: HttpServer; getPort: () => number } {
  let resolvePromise: (code: string) => void;
  let rejectPromise: (err: Error) => void;

  const promise = new Promise<string>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  const cspHeaders = { 'Content-Type': 'text/html', 'Content-Security-Policy': CSP_HEADER };

  const server = createServer((req, res) => {
    if (!req.url?.startsWith('/callback')) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const url = new URL(req.url, `http://localhost:${port}`);
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    const callbackState = url.searchParams.get('state');

    // Validate state parameter (CSRF protection per RFC 9700 §4.7.1)
    if (expectedState && callbackState !== expectedState) {
      res.writeHead(400, cspHeaders);
      res.end('<html><body><h1>Error</h1><p>Invalid state parameter — possible CSRF attack.</p></body></html>');
      return;
    }

    if (error) {
      const errorDescription = url.searchParams.get('error_description') ?? error;
      res.writeHead(400, cspHeaders);
      res.end(
        `<html><body><h1>Authentication Failed</h1><p>${escapeHtml(errorDescription)}</p><p>You can close this window.</p></body></html>`,
      );
      rejectPromise(new Error(`OAuth authorization failed: ${errorDescription}`));
      server.close();
      return;
    }

    if (!code) {
      res.writeHead(400, cspHeaders);
      res.end('<html><body><h1>Error</h1><p>No authorization code received.</p></body></html>');
      return;
    }

    res.writeHead(200, cspHeaders);
    res.end(
      '<html><body><h1>Authentication Successful</h1><p>You can close this window and return to your MCP client.</p></body></html>',
    );
    resolvePromise(code);
    server.close();
  });

  // Bind to loopback only — prevents network-adjacent attackers from reaching the callback
  server.listen(port, '127.0.0.1');

  // Timeout handling
  const timer = setTimeout(() => {
    rejectPromise(new Error(`OAuth callback timed out after ${timeoutMs / 1000}s — no browser login received`));
    server.close();
  }, timeoutMs);

  // Clean up timer when server closes
  server.on('close', () => clearTimeout(timer));

  const getPort = (): number => {
    const addr = server.address();
    if (addr && typeof addr === 'object') {
      return addr.port;
    }
    return port;
  };

  return { promise, server, getPort };
}

/**
 * Perform the full browser-based Authorization Code flow.
 *
 * 1. Start local callback server
 * 2. Open browser to XSUAA authorize endpoint
 * 3. Wait for callback with authorization code
 * 4. Exchange code for tokens
 *
 * @param serviceKey BTP service key
 * @param callbackPort Port for callback server (0 = auto-assign)
 * @returns OAuth token response
 */
export async function performBrowserLogin(serviceKey: BTPServiceKey, callbackPort = 0): Promise<OAuthTokenResponse> {
  // Generate PKCE and state before starting the flow
  const { codeVerifier, codeChallenge } = generatePkce();
  const state = generateState();

  const { promise, server, getPort } = startCallbackServer(callbackPort, 120000, state);

  // Wait for server to be listening to get the actual port
  await new Promise<void>((resolve) => {
    if (server.listening) {
      resolve();
    } else {
      server.on('listening', resolve);
    }
  });

  const actualPort = getPort();
  const redirectUri = `http://localhost:${actualPort}/callback`;

  const authorizeUrl =
    `${serviceKey.uaa.url}/oauth/authorize` +
    `?response_type=code` +
    `&client_id=${encodeURIComponent(serviceKey.uaa.clientid)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}` +
    `&code_challenge=${encodeURIComponent(codeChallenge)}` +
    `&code_challenge_method=S256`;

  logger.info('Opening browser for SAP BTP authentication...', { port: actualPort });
  logger.info(`If browser doesn't open, visit: ${authorizeUrl}`);

  try {
    await openBrowser(authorizeUrl);
  } catch (_err) {
    // Browser failed to open — log the URL so user can copy-paste
    logger.warn('Could not open browser automatically. Please open this URL manually:', {
      url: authorizeUrl,
    });
  }

  // Wait for callback
  const code = await promise;

  // Exchange code for tokens (include PKCE verifier)
  const tokens = await exchangeCodeForToken(serviceKey, code, redirectUri, codeVerifier);

  logger.info('BTP ABAP authentication successful', {
    expiresIn: tokens.expires_in,
    hasRefreshToken: !!tokens.refresh_token,
  });

  return tokens;
}

// ─── Token Provider (BearerFetcher Pattern) ────────────────────────

/**
 * Create a bearer token provider function for the ADT HTTP client.
 *
 * The returned function handles:
 * - First call: triggers browser login
 * - Subsequent calls: returns cached token
 * - Token refresh: uses refresh token when access token expires
 * - Re-login: triggers browser login if refresh token also expires
 *
 * @param serviceKey BTP service key
 * @param callbackPort Port for OAuth callback (0 = auto-assign)
 * @returns Async function that returns a valid Bearer token
 */
export function createBearerTokenProvider(serviceKey: BTPServiceKey, callbackPort = 0): () => Promise<string> {
  let tokenCache: TokenCache | undefined;

  return async (): Promise<string> => {
    // If we have a cached token that's still valid (with 60s buffer), return it
    if (tokenCache && Date.now() < tokenCache.expiresAt - 60000) {
      return tokenCache.accessToken;
    }

    // Try refresh if we have a refresh token
    if (tokenCache?.refreshToken) {
      try {
        const refreshed = await refreshAccessToken(serviceKey, tokenCache.refreshToken);
        tokenCache = {
          accessToken: refreshed.access_token,
          refreshToken: refreshed.refresh_token ?? tokenCache.refreshToken,
          expiresAt: Date.now() + refreshed.expires_in * 1000,
        };
        logger.debug('OAuth token refreshed successfully');
        return tokenCache.accessToken;
      } catch (err) {
        logger.warn('OAuth token refresh failed, will re-authenticate via browser', {
          error: err instanceof Error ? err.message : String(err),
        });
        // Fall through to browser login
      }
    }

    // No token or refresh failed — do browser login
    const tokens = await performBrowserLogin(serviceKey, callbackPort);
    tokenCache = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    };

    return tokenCache.accessToken;
  };
}
