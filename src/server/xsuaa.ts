/**
 * XSUAA OAuth proxy for MCP-native clients.
 *
 * Enables Claude Desktop, Cursor, VS Code, and MCP Inspector to authenticate
 * via BTP XSUAA using the MCP specification's OAuth discovery (RFC 8414).
 *
 * Uses the MCP SDK's ProxyOAuthServerProvider to delegate the OAuth flow
 * to XSUAA, and @sap/xssec for SAP-specific JWT validation.
 *
 * Design decisions:
 *
 * 1. @sap/xssec for token validation (not jose):
 *    - SAP-specific x5t thumbprint and proof-of-possession validation
 *    - Proper XSUAA audience format handling
 *    - Offline validation with automatic JWKS caching
 *    - checkLocalScope() for scope enforcement
 *
 * 2. Stateless DCR client store (StatelessDcrClientStore):
 *    - MCP clients (Claude Desktop, Cursor) register dynamically via RFC 7591
 *    - client_ids are HMAC-signed by the XSUAA clientsecret, so they
 *      survive restarts / pushes / cell moves without any backing store
 *    - XSUAA clientId is pre-registered as the default client
 *
 * 3. Chained token verifier:
 *    - Tries XSUAA → Entra ID OIDC → API key in order
 *    - All three auth modes coexist on the same /mcp endpoint
 */

import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { ProxyOAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import { XsuaaService } from '@sap/xssec';
import { expandScopes } from '../authz/policy.js';
import { API_KEY_PROFILES } from './config.js';
import { logger } from './logger.js';
import { OAuthStateCodec } from './oauth-state.js';
import { StatelessDcrClientStore } from './stateless-client-store.js';

// ─── Types ───────────────────────────────────────────────────────────

/** OAuth token endpoint response shape */
interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

/** XSUAA credentials from VCAP_SERVICES */
export interface XsuaaCredentials {
  url: string;
  clientid: string;
  clientsecret: string;
  xsappname: string;
  uaadomain: string;
  verificationkey?: string;
}

// ─── XSUAA Token Verifier ────────────────────────────────────────────

/**
 * Verify a JWT token using @sap/xssec.
 *
 * Creates a security context from the token using the XSUAA service,
 * then maps it to the MCP SDK's AuthInfo format.
 */
export function createXsuaaTokenVerifier(credentials: XsuaaCredentials): (token: string) => Promise<AuthInfo> {
  const xsuaaService = new XsuaaService({
    clientid: credentials.clientid,
    clientsecret: credentials.clientsecret,
    url: credentials.url,
    xsappname: credentials.xsappname,
    uaadomain: credentials.uaadomain,
  });

  return async (token: string): Promise<AuthInfo> => {
    logger.debug('XSUAA token verification: creating security context');
    const securityContext = await xsuaaService.createSecurityContext(token, { jwt: token });

    // Extract scopes (remove xsappname prefix for local scope names)
    const grantedScopes: string[] = [];
    // The token contains scopes like "arc1-mcp!b12345.read"
    // checkLocalScope strips the prefix for us
    for (const scope of ['read', 'write', 'data', 'sql', 'transports', 'git', 'admin']) {
      if (securityContext.checkLocalScope(scope)) {
        grantedScopes.push(scope);
      }
    }
    // Apply implied scope expansion: admin→all, write→read, sql→data
    const expandedScopes = expandScopes(grantedScopes);

    const expiresAt = securityContext.token?.payload?.exp;

    const authInfo = {
      token,
      clientId: securityContext.getClientId(),
      scopes: expandedScopes,
      expiresAt: typeof expiresAt === 'number' ? expiresAt : undefined,
      extra: {
        userName: securityContext.getLogonName?.() ?? undefined,
        email: securityContext.getEmail?.() ?? undefined,
      },
    };
    logger.debug('XSUAA token verified', {
      clientId: authInfo.clientId,
      scopes: expandedScopes,
      userName: authInfo.extra.userName,
      email: authInfo.extra.email,
    });
    return authInfo;
  };
}

// ─── API Key Matching Helper ─────────────────────────────────────────

/**
 * Match a token against configured API keys (multi-key or single).
 * Used by both the chained verifier (XSUAA mode) and standard verifier.
 */
function matchApiKeyFromConfig(
  config: { apiKeys?: Array<{ key: string; profile: string }> },
  token: string,
): { scopes: string[]; clientId: string } | undefined {
  if (config.apiKeys) {
    for (const entry of config.apiKeys) {
      if (token === entry.key) {
        const profile = API_KEY_PROFILES[entry.profile];
        if (!profile) return undefined;
        const scopes = expandScopes(profile.scopes);
        return { scopes, clientId: `api-key:${entry.profile}` };
      }
    }
  }
  return undefined;
}

// ─── Chained Token Verifier ──────────────────────────────────────────

/**
 * OIDC/UAA scopes that must NOT be prefixed with the app's xsappname. They are
 * reserved/global in XSUAA, so qualifying them (e.g. `openid` →
 * `arc1-mcp!t498139.openid`) produces an invalid scope that XSUAA rejects.
 */
export const RESERVED_OAUTH_SCOPES = new Set(['openid', 'profile', 'email', 'offline_access']);

/**
 * Qualify short MCP scope names (`read`, `write`, `admin`, …) with the XSUAA
 * xsappname prefix XSUAA requires (it rejects a bare `admin`). Scopes that are
 * already qualified (contain a `.`, e.g. `uaa.user`) or are reserved OIDC scopes
 * ({@link RESERVED_OAUTH_SCOPES}) pass through untouched. Empty entries (Copilot
 * Studio sends `scope=""` → `[""]`) are dropped.
 */
export function qualifyXsuaaScopes(scopes: string[], xsappname: string): string[] {
  return scopes
    .filter((s) => s.length > 0)
    .map((s) => (s.includes('.') || RESERVED_OAUTH_SCOPES.has(s) ? s : `${xsappname}.${s}`));
}

/**
 * Create a token verifier that chains multiple auth methods.
 *
 * Tries in order:
 * 1. XSUAA (@sap/xssec) — if XSUAA credentials are available
 * 2. Entra ID OIDC (jose) — if SAP_OIDC_ISSUER is configured
 * 3. API Key — if ARC1_API_KEYS is configured
 */
export function createChainedTokenVerifier(
  config: {
    apiKeys?: Array<{ key: string; profile: string }>;
    oidcIssuer?: string;
    oidcAudience?: string;
  },
  xsuaaVerifier?: (token: string) => Promise<AuthInfo>,
  oidcVerifier?: (token: string) => Promise<AuthInfo>,
): (token: string) => Promise<AuthInfo> {
  return async (token: string): Promise<AuthInfo> => {
    const tokenPreview = `${token.slice(0, 20)}...${token.slice(-10)}`;
    logger.debug('Chained token verifier: starting', { tokenPreview });

    // 1. Try XSUAA
    if (xsuaaVerifier) {
      try {
        const result = await xsuaaVerifier(token);
        logger.debug('Chained token verifier: XSUAA succeeded', {
          clientId: result.clientId,
          scopes: result.scopes,
          user: result.extra?.email || result.extra?.userName,
        });
        return result;
      } catch (err) {
        logger.debug('Chained token verifier: XSUAA failed, trying next', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 2. Try Entra ID OIDC
    if (oidcVerifier) {
      try {
        const result = await oidcVerifier(token);
        logger.debug('Chained token verifier: OIDC succeeded', {
          clientId: result.clientId,
          scopes: result.scopes,
        });
        return result;
      } catch (err) {
        logger.debug('Chained token verifier: OIDC failed, trying next', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 3. Try API key (multi-key with profiles)
    const apiKeyMatch = matchApiKeyFromConfig(config, token);
    if (apiKeyMatch) {
      logger.debug('Chained token verifier: API key matched', { clientId: apiKeyMatch.clientId });
      return {
        token,
        clientId: apiKeyMatch.clientId,
        scopes: apiKeyMatch.scopes,
        // MCP SDK's requireBearerAuth requires expiresAt — set to 1 year
        expiresAt: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
        extra: {},
      };
    }

    logger.debug('Chained token verifier: all methods failed', { tokenPreview });
    throw new InvalidTokenError('Token validation failed: not a valid XSUAA, OIDC, or API key token');
  };
}

// ─── OAuth Provider Factory ──────────────────────────────────────────

/**
 * Create a ProxyOAuthServerProvider that proxies OAuth to XSUAA.
 */
/**
 * XSUAA-proxying OAuth provider.
 *
 * Extends ProxyOAuthServerProvider to replace the MCP client's local client_id
 * with the XSUAA service binding client_id when forwarding to XSUAA.
 *
 * Problem: MCP clients register via DCR and get a local client_id (e.g., "arc1-f63afbab").
 * But XSUAA only knows about its own client_id ("sb-arc1-mcp!t498139").
 * The standard ProxyOAuthServerProvider forwards the local client_id to XSUAA, which rejects it.
 *
 * Solution: Override authorize() to swap the client_id and use a custom fetch() for
 * the token exchange to inject the XSUAA credentials.
 */
class XsuaaProxyOAuthProvider extends ProxyOAuthServerProvider {
  private xsuaaClientId: string;
  private xsuaaClientSecret: string;
  private xsuaaTokenUrl: string;
  private xsuaaAuthUrl: string;
  private xsuaaXsappname: string;
  private _localClientStore: StatelessDcrClientStore;
  /** ARC-1's own callback URL, sent to XSUAA as the redirect_uri so ARC-1
   *  sits in the return path and can re-encode the client's `state`
   *  correctly (issue #214 — XSUAA emits literal `+`). */
  private callbackUrl: string;
  /** Signs/verifies the opaque, URL-safe state token sent to XSUAA. */
  private stateCodec: OAuthStateCodec;

  constructor(
    credentials: XsuaaCredentials,
    verifier: (token: string) => Promise<AuthInfo>,
    localClientStore: StatelessDcrClientStore,
    callbackUrl: string,
    stateCodec: OAuthStateCodec,
  ) {
    const authUrl = `${credentials.url}/oauth/authorize`;
    const tokenUrl = `${credentials.url}/oauth/token`;

    super({
      endpoints: {
        authorizationUrl: authUrl,
        tokenUrl: tokenUrl,
        revocationUrl: `${credentials.url}/oauth/revoke`,
      },
      verifyAccessToken: verifier,
      getClient: (clientId: string) => localClientStore.getClient(clientId),
    });

    this.xsuaaClientId = credentials.clientid;
    this.xsuaaClientSecret = credentials.clientsecret;
    this.xsuaaTokenUrl = tokenUrl;
    this.xsuaaAuthUrl = authUrl;
    this.xsuaaXsappname = credentials.xsappname;
    this._localClientStore = localClientStore;
    this.callbackUrl = callbackUrl;
    this.stateCodec = stateCodec;
    this.skipLocalPkceValidation = true;
  }

  /**
   * Override clientsStore to expose registerClient for DCR.
   * The MCP SDK checks this to decide whether to advertise
   * registration_endpoint in OAuth metadata and handle POST /register.
   */
  override get clientsStore() {
    return this._localClientStore;
  }

  /**
   * Override authorize to replace the MCP client's local client_id
   * with the XSUAA service binding client_id.
   */
  override async authorize(
    _client: OAuthClientInformationFull,
    params: {
      state?: string;
      scopes?: string[];
      codeChallenge: string;
      redirectUri: string;
      resource?: URL;
    },
    res: { redirect(url: string): void },
  ): Promise<void> {
    // ── Callback proxy (issue #214) ──────────────────────────────────
    // Instead of sending XSUAA the client's redirect_uri and the client's
    // raw `state`, we send XSUAA ARC-1's OWN /oauth/callback and an opaque,
    // URL-safe state token that carries the client's real redirect_uri +
    // state. XSUAA then redirects back to ARC-1 (not the client), and the
    // /oauth/callback route re-emits the client's ORIGINAL state with proper
    // `%2B` encoding. This sidesteps XSUAA's bug of echoing a literal `+`
    // for any state containing `+` (standard base64 states hit this ~50% of
    // the time; VS Code surfaces it as "State does not match").
    //
    // The token is base64url (no `+`/`/`), so XSUAA has nothing to mangle on
    // the round trip and Express's `+`→space decode is a no-op on it.
    //
    // WORKAROUND removal condition + upstream tracking (XSUAA root cause,
    // arc-1#214, vscode#314715) are documented at the top of oauth-state.ts.
    const arc1State = this.stateCodec.encode({
      clientState: params.state,
      clientRedirectUri: params.redirectUri,
      clientId: _client.client_id,
    });

    const targetUrl = new URL(this.xsuaaAuthUrl);
    const searchParams = new URLSearchParams({
      client_id: this.xsuaaClientId, // Use XSUAA client, not local DCR client
      response_type: 'code',
      redirect_uri: this.callbackUrl, // ARC-1's callback, not the client's
      code_challenge: params.codeChallenge, // client's PKCE challenge, forwarded as-is
      code_challenge_method: 'S256',
      state: arc1State,
    });

    if (params.scopes?.length) {
      // Qualify short MCP scopes (read, write, admin) with the xsappname prefix
      // XSUAA requires, while leaving reserved OIDC scopes (openid, …) alone.
      const qualifiedScopes = qualifyXsuaaScopes(params.scopes, this.xsuaaXsappname);
      if (qualifiedScopes.length > 0) {
        searchParams.set('scope', qualifiedScopes.join(' '));
      }
    }
    if (params.resource) searchParams.set('resource', params.resource.toString());

    targetUrl.search = searchParams.toString();

    logger.debug('XSUAA authorize redirect (callback proxy)', {
      xsuaaClient: this.xsuaaClientId,
      clientRedirectUri: params.redirectUri,
      callbackUrl: this.callbackUrl,
    });

    res.redirect(targetUrl.toString());
  }

  /**
   * Override exchangeAuthorizationCode to use XSUAA credentials
   * instead of the local DCR client credentials.
   */
  override async exchangeAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
    codeVerifier?: string,
    _redirectUri?: string,
  ) {
    logger.debug('XSUAA token exchange: authorization_code', {
      hasCodeVerifier: !!codeVerifier,
    });
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code: authorizationCode,
      client_id: this.xsuaaClientId,
      client_secret: this.xsuaaClientSecret,
    });
    if (codeVerifier) params.set('code_verifier', codeVerifier);
    // OAuth requires the token-exchange redirect_uri to match the one sent at
    // authorize time. Since the callback proxy sent XSUAA ARC-1's own
    // /oauth/callback (not the client's redirect_uri), the exchange must use
    // the same value. The client's redirect_uri (_redirectUri) is irrelevant
    // to XSUAA here — XSUAA only ever saw ARC-1's callback.
    params.set('redirect_uri', this.callbackUrl);

    const response = await fetch(this.xsuaaTokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      logger.error('XSUAA token exchange failed', { status: response.status, body: text.slice(0, 200) });
      throw new Error(`XSUAA token exchange failed: ${response.status}`);
    }

    const data = (await response.json()) as TokenResponse;
    logger.debug('XSUAA token exchange: success', {
      tokenType: data.token_type,
      expiresIn: data.expires_in,
      hasRefreshToken: !!data.refresh_token,
      scope: data.scope,
    });
    return {
      access_token: data.access_token,
      token_type: data.token_type ?? 'bearer',
      expires_in: data.expires_in,
      refresh_token: data.refresh_token,
      scope: data.scope,
    };
  }

  /**
   * Override exchangeRefreshToken to use XSUAA credentials.
   */
  override async exchangeRefreshToken(_client: OAuthClientInformationFull, refreshToken: string, _scopes?: string[]) {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.xsuaaClientId,
      client_secret: this.xsuaaClientSecret,
    });

    const response = await fetch(this.xsuaaTokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      throw new Error(`XSUAA refresh token exchange failed: ${response.status}`);
    }

    const data = (await response.json()) as TokenResponse;
    return {
      access_token: data.access_token,
      token_type: data.token_type ?? 'bearer',
      expires_in: data.expires_in,
      refresh_token: data.refresh_token,
      scope: data.scope,
    };
  }

  /**
   * Override revokeToken to use XSUAA service credentials consistently.
   * Without this override, the base class would attempt revocation with
   * the local client credentials, which don't match the XSUAA binding.
   *
   * Declared as a property (arrow function) to match the base class declaration.
   */
  override revokeToken = async (
    _client: OAuthClientInformationFull,
    request: { token: string; token_type_hint?: string },
  ): Promise<void> => {
    const revokeUrl = this.xsuaaTokenUrl.replace('/oauth/token', '/oauth/revoke');

    const params = new URLSearchParams({ token: request.token });
    if (request.token_type_hint) {
      params.set('token_type_hint', request.token_type_hint);
    }

    try {
      const response = await fetch(revokeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${this.xsuaaClientId}:${this.xsuaaClientSecret}`).toString('base64')}`,
        },
        body: params.toString(),
      });

      if (!response.ok) {
        logger.warn('XSUAA token revocation failed', { status: response.status, url: revokeUrl });
      } else {
        logger.debug('XSUAA token revoked successfully');
      }
    } catch (err) {
      logger.warn('XSUAA token revocation error', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
}

export interface CreateXsuaaOAuthProviderOptions {
  /** Lifetime of issued DCR client_ids in seconds. Falls back to the store's
   *  built-in default (30 days) when omitted. `0` disables expiration. */
  dcrTtlSeconds?: number;
  /**
   * Optional dedicated secret for HMAC-signing DCR client_ids. When set, the
   * DCR signing key derives from this secret instead of the XSUAA
   * `clientsecret`. Use this to keep cached client_ids valid across
   * `cf deploy` (which recreates the XSUAA binding and rotates its
   * clientsecret). Omit to fall back to the XSUAA clientsecret (legacy
   * behavior).
   */
  dcrSigningSecret?: string;
  /**
   * ARC-1's own OAuth callback URL (e.g. `https://app.../oauth/callback`),
   * sent to XSUAA as the redirect_uri so ARC-1 sits in the return path and
   * can fix XSUAA's `+`-in-state encoding bug (issue #214). Must be
   * absolute and match an xs-security.json `redirect-uris` pattern. When
   * omitted, falls back to `${appUrl}/oauth/callback`.
   */
  callbackUrl?: string;
}

export function createXsuaaOAuthProvider(
  credentials: XsuaaCredentials,
  appUrl: string,
  options: CreateXsuaaOAuthProviderOptions = {},
): { provider: ProxyOAuthServerProvider; clientStore: StatelessDcrClientStore; stateCodec: OAuthStateCodec } {
  // The signing secret defaults to the XSUAA `clientsecret`, which is the
  // trust anchor for "this server can mint client_ids". The downside: MTA
  // `cf deploy` recreates the service binding and rotates the clientsecret
  // — every redeploy invalidates every cached client_id. To opt out, pass a
  // dedicated secret via `dcrSigningSecret` (typically `ARC1_DCR_SIGNING_SECRET`
  // set with `cf set-env`, which survives `cf deploy`). Re-setting it
  // doubles as the explicit revocation knob.
  //
  // Empty / whitespace-only input falls back to the XSUAA `clientsecret`
  // (legacy mode) with a warning instead of crashing — `??` only falls back
  // on null/undefined, so an empty env var would otherwise reach the store
  // constructor's non-empty guard and kill startup. Compute the
  // dcrSigningSource label from the effective secret, not the raw input, so
  // it accurately reflects what's actually in use.
  const trimmedDcrSecret = options.dcrSigningSecret?.trim();
  let dcrSigningSecret: string;
  let dcrSigningSource: 'env' | 'xsuaa';
  if (trimmedDcrSecret) {
    dcrSigningSecret = trimmedDcrSecret;
    dcrSigningSource = 'env';
  } else {
    if (options.dcrSigningSecret !== undefined) {
      logger.warn(
        'ARC1_DCR_SIGNING_SECRET was set but is empty or whitespace-only — falling back to XSUAA clientsecret. Set a real secret with `openssl rand -base64 48` or unset the env var.',
      );
    }
    dcrSigningSecret = credentials.clientsecret;
    dcrSigningSource = 'xsuaa';
  }

  const clientStore = new StatelessDcrClientStore(credentials.clientid, credentials.clientsecret, dcrSigningSecret, {
    ttlSeconds: options.dcrTtlSeconds,
  });
  const verifier = createXsuaaTokenVerifier(credentials);

  // The state codec reuses the same resolved signing secret as DCR (distinct
  // KDF label inside OAuthStateCodec keeps the two key spaces separate), so it
  // inherits the same "survives cf deploy" property when ARC1_DCR_SIGNING_SECRET
  // is set. State tokens are short-lived (single OAuth flow), so the codec uses
  // its own built-in TTL rather than the DCR TTL.
  const stateCodec = new OAuthStateCodec(dcrSigningSecret);

  const callbackUrl = options.callbackUrl ?? `${appUrl.replace(/\/$/, '')}/oauth/callback`;

  const provider = new XsuaaProxyOAuthProvider(credentials, verifier, clientStore, callbackUrl, stateCodec);

  logger.info('XSUAA OAuth provider created (stateless DCR + callback proxy)', {
    xsappname: credentials.xsappname,
    authorizationUrl: `${credentials.url}/oauth/authorize`,
    appUrl,
    callbackUrl,
    dcrTtlSeconds: options.dcrTtlSeconds,
    dcrSigningSource,
  });
  if (dcrSigningSource === 'env') {
    logger.info(
      'DCR signing key uses dedicated ARC1_DCR_SIGNING_SECRET — cached client_ids survive cf deploys that rotate the XSUAA clientsecret.',
    );
  }
  if (options.dcrTtlSeconds !== undefined && options.dcrTtlSeconds <= 0) {
    logger.info(
      'DCR client_id TTL is disabled (ARC1_OAUTH_DCR_TTL_SECONDS=0) — registrations never expire by time; revocation is via ARC1_DCR_SIGNING_SECRET rotation.',
    );
  }

  return { provider, clientStore, stateCodec };
}
