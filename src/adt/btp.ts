/**
 * BTP Destination Service integration for ARC-1.
 *
 * When running on SAP BTP Cloud Foundry, this module:
 * 1. Parses VCAP_SERVICES to extract service binding credentials
 * 2. Fetches SAP connection details from the BTP Destination Service
 * 3. Configures an HTTP proxy through the Cloud Connector (Connectivity Service)
 *
 * Startup path (lookupDestination, resolveBTPDestination) uses direct fetch
 * to the Destination Service API. Per-user principal propagation path
 * (lookupDestinationWithUserToken) uses SAP Cloud SDK's getDestination()
 * for automatic token management and per-user caching.
 *
 * Token caching: Connectivity proxy tokens are cached and refreshed 60 seconds
 * before expiry. Per-user destination tokens are cached by the SDK.
 */

import {
  type DestinationAuthToken,
  getDestination,
  type Destination as SdkDestination,
} from '@sap-cloud-sdk/connectivity';
import { logger } from '../server/logger.js';

// ─── Types ───────────────────────────────────────────────────────────

/** BTP service binding credentials parsed from VCAP_SERVICES */
export interface BTPConfig {
  // XSUAA
  xsuaaUrl: string;
  xsuaaClientId: string;
  xsuaaSecret: string;

  // Destination Service
  destinationUrl: string;
  destinationClientId: string;
  destinationSecret: string;
  destinationTokenUrl: string;

  // Connectivity Service (Cloud Connector proxy)
  connectivityProxyHost: string;
  connectivityProxyPort: string;
  connectivityClientId: string;
  connectivitySecret: string;
  connectivityTokenUrl: string;
}

/** Resolved destination from BTP Destination Service */
export interface Destination {
  Name: string;
  URL: string;
  Authentication: string;
  ProxyType: string;
  User: string;
  Password: string;
  'sap-client'?: string;
  /** Cloud Connector Location ID — used to route to the correct SCC instance */
  CloudConnectorLocationId?: string;
}

/** Proxy configuration for undici ProxyAgent — used by AdtHttpClient */
export interface BTPProxyConfig {
  host: string;
  port: number;
  protocol: string;
  /** Returns a fresh connectivity proxy JWT token (cached, auto-refreshed) */
  getProxyToken: () => Promise<string>;
  /** Cloud Connector Location ID — sent as SAP-Connectivity-SCC-Location_ID header */
  locationId?: string;
}

// ─── VCAP Parsing ────────────────────────────────────────────────────

interface VCAPBinding {
  name: string;
  credentials: Record<string, unknown>;
}

interface VCAPServices {
  xsuaa?: VCAPBinding[];
  destination?: VCAPBinding[];
  connectivity?: VCAPBinding[];
}

/**
 * Parse VCAP_SERVICES environment variable to extract BTP service credentials.
 * Returns null if not running on BTP (VCAP_SERVICES not set).
 */
export function parseVCAPServices(): BTPConfig | null {
  const vcapJson = process.env.VCAP_SERVICES;
  if (!vcapJson) return null;

  const vcap: VCAPServices = JSON.parse(vcapJson);
  const config: BTPConfig = {
    xsuaaUrl: '',
    xsuaaClientId: '',
    xsuaaSecret: '',
    destinationUrl: '',
    destinationClientId: '',
    destinationSecret: '',
    destinationTokenUrl: '',
    connectivityProxyHost: '',
    connectivityProxyPort: '',
    connectivityClientId: '',
    connectivitySecret: '',
    connectivityTokenUrl: '',
  };

  // XSUAA binding
  if (vcap.xsuaa?.[0]?.credentials) {
    const c = vcap.xsuaa[0].credentials;
    config.xsuaaUrl = (c.url as string) || '';
    config.xsuaaClientId = (c.clientid as string) || '';
    config.xsuaaSecret = (c.clientsecret as string) || '';
  }

  // Destination binding
  if (vcap.destination?.[0]?.credentials) {
    const c = vcap.destination[0].credentials;
    config.destinationUrl = (c.uri as string) || (c.url as string) || '';
    config.destinationClientId = (c.clientid as string) || '';
    config.destinationSecret = (c.clientsecret as string) || '';
    config.destinationTokenUrl = (c.token_service_url as string) || '';
    // Fallback: construct from URL
    if (!config.destinationTokenUrl && c.url) {
      config.destinationTokenUrl = `${(c.url as string).replace(/\/$/, '')}/oauth/token`;
    }
  }

  // Connectivity binding
  if (vcap.connectivity?.[0]?.credentials) {
    const c = vcap.connectivity[0].credentials;
    config.connectivityProxyHost = (c.onpremise_proxy_host as string) || '';
    config.connectivityProxyPort = (c.onpremise_proxy_http_port as string) || '';
    config.connectivityClientId = (c.clientid as string) || '';
    config.connectivitySecret = (c.clientsecret as string) || '';
    config.connectivityTokenUrl = (c.token_service_url as string) || '';
    // Fallback + ensure /oauth/token suffix
    if (!config.connectivityTokenUrl && c.url) {
      config.connectivityTokenUrl = `${(c.url as string).replace(/\/$/, '')}/oauth/token`;
    } else if (config.connectivityTokenUrl && !config.connectivityTokenUrl.endsWith('/oauth/token')) {
      config.connectivityTokenUrl = `${config.connectivityTokenUrl.replace(/\/$/, '')}/oauth/token`;
    }
  }

  logger.info('BTP VCAP_SERVICES parsed', {
    hasXsuaa: !!config.xsuaaUrl,
    hasDestination: !!config.destinationUrl,
    hasConnectivity: !!config.connectivityProxyHost,
  });

  return config;
}

// ─── Destination Service ─────────────────────────────────────────────

/**
 * Fetch an OAuth2 client_credentials token.
 * Used for both Destination Service and Connectivity Service tokens.
 */
async function fetchClientCredentialsToken(
  tokenUrl: string,
  clientId: string,
  clientSecret: string,
): Promise<{ accessToken: string; expiresIn: number }> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });

  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Token endpoint returned HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }

  const data = (await resp.json()) as { access_token: string; expires_in: number };
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

/**
 * Look up a destination from the BTP Destination Service.
 * Returns SAP URL, credentials, and proxy type.
 */
export async function lookupDestination(btpConfig: BTPConfig, destinationName: string): Promise<Destination> {
  // Get token for Destination Service API
  const tokenUrl = btpConfig.destinationTokenUrl || `${btpConfig.xsuaaUrl}/oauth/token`;
  const { accessToken } = await fetchClientCredentialsToken(
    tokenUrl,
    btpConfig.destinationClientId,
    btpConfig.destinationSecret,
  );

  // Call Destination Service
  const destUrl = `${btpConfig.destinationUrl.replace(/\/$/, '')}/destination-configuration/v1/destinations/${encodeURIComponent(destinationName)}`;
  const resp = await fetch(destUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Destination Service returned HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }

  const data = (await resp.json()) as { destinationConfiguration: Destination };

  logger.info('BTP destination resolved', {
    name: data.destinationConfiguration.Name,
    url: data.destinationConfiguration.URL,
    auth: data.destinationConfiguration.Authentication,
    proxyType: data.destinationConfiguration.ProxyType,
    locationId: data.destinationConfiguration.CloudConnectorLocationId,
  });

  return data.destinationConfiguration;
}

// ─── Connectivity Proxy ──────────────────────────────────────────────

/**
 * Create a proxy configuration for routing through the Cloud Connector.
 *
 * Returns a BTPProxyConfig with a token getter that caches the connectivity
 * JWT and auto-refreshes it 60 seconds before expiry.
 */
export function createConnectivityProxy(btpConfig: BTPConfig, locationId?: string): BTPProxyConfig | null {
  if (!btpConfig.connectivityProxyHost) return null;

  let cachedToken = '';
  let expiresAt = 0;

  return {
    host: btpConfig.connectivityProxyHost,
    port: Number.parseInt(btpConfig.connectivityProxyPort || '20003', 10),
    protocol: 'http',
    locationId,
    getProxyToken: async () => {
      // Return cached token if still valid (60s buffer)
      if (cachedToken && Date.now() < expiresAt) {
        return cachedToken;
      }

      const { accessToken, expiresIn } = await fetchClientCredentialsToken(
        btpConfig.connectivityTokenUrl,
        btpConfig.connectivityClientId,
        btpConfig.connectivitySecret,
      );

      cachedToken = accessToken;
      expiresAt = Date.now() + (expiresIn - 60) * 1000;
      return cachedToken;
    },
  };
}

// ─── Per-User Destination (Principal Propagation) ────────────────────

/**
 * Per-user authentication tokens returned by Destination Service
 * when called with X-User-Token header.
 *
 * For PrincipalPropagation destinations, the Destination Service
 * generates a SAML assertion containing the user identity and returns
 * it as the SAP-Connectivity-Authentication header value.
 */
export interface PerUserAuthTokens {
  /** SAP-Connectivity-Authentication header value (SAML assertion for Cloud Connector) */
  sapConnectivityAuth?: string;
  /** Any Bearer token returned by the Destination Service */
  bearerToken?: string;
  /** PP Option 1: jwt-bearer exchanged token for Proxy-Authorization (recommended approach) */
  ppProxyAuth?: string;
}

/**
 * Look up a destination with the user's JWT token for principal propagation.
 *
 * Uses SAP Cloud SDK's `getDestination()` to resolve the destination with per-user
 * JWT. The SDK handles service token acquisition, X-User-Token header injection,
 * and per-user destination caching.
 *
 * This is the key API for per-user SAP authentication:
 * 1. Caller passes the user's JWT (from XSUAA/OIDC)
 * 2. SDK calls the Destination Service with X-User-Token header
 * 3. For PrincipalPropagation destinations: returns SAP-Connectivity-Authentication header
 * 4. For OAuth2SAMLBearerAssertion destinations: returns a Bearer token
 *
 * Includes a jwt-bearer fallback (Option 2) when the Destination Service returns
 * no auth tokens — uses direct fetch to the Connectivity Service token URL.
 *
 * @param btpConfig - BTP service credentials (needed for jwt-bearer fallback only)
 */
export async function lookupDestinationWithUserToken(
  btpConfig: BTPConfig,
  destinationName: string,
  userJwt: string,
): Promise<{ destination: Destination; authTokens: PerUserAuthTokens }> {
  // Log JWT claims for PP debugging (decode payload without verification)
  try {
    const parts = userJwt.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      logger.debug('PP user JWT claims', {
        destination: destinationName,
        grantType: payload.grant_type,
        sub: payload.sub,
        email: payload.email,
        userUuid: payload.user_uuid,
        zid: payload.zid,
        iss: payload.iss,
        aud: Array.isArray(payload.aud) ? payload.aud.join(',') : payload.aud,
        azp: payload.azp,
        scope: payload.scope?.join?.(' ') ?? payload.scope,
        origin: payload.origin,
        exp: payload.exp,
      });
    }
  } catch {
    logger.debug('PP user JWT: failed to decode claims');
  }

  // Use SAP Cloud SDK to resolve the destination with per-user JWT.
  // The SDK handles: service token acquisition, X-User-Token header,
  // and per-user destination caching (keyed by destinationName + jwt).
  const sdkDest: SdkDestination | null = await getDestination({
    destinationName,
    jwt: userJwt,
    useCache: true,
  });

  if (!sdkDest) {
    throw new Error(`Destination Service (per-user) returned no destination for '${destinationName}'`);
  }

  // Map SDK Destination → ARC-1 Destination type
  const dest: Destination = {
    Name: sdkDest.name ?? destinationName,
    URL: sdkDest.url ?? '',
    Authentication: sdkDest.authentication ?? '',
    ProxyType: sdkDest.proxyType ?? '',
    User: sdkDest.username ?? '',
    Password: sdkDest.password ?? '',
    'sap-client': sdkDest.sapClient ?? undefined,
    CloudConnectorLocationId: sdkDest.cloudConnectorLocationId ?? undefined,
  };

  const tokens: PerUserAuthTokens = {};
  const sdkAuthTokens: DestinationAuthToken[] | null | undefined = sdkDest.authTokens;

  // Log raw auth response for PP debugging.
  // Field names avoid "token" substring to prevent logger redaction.
  const rawEntries = sdkAuthTokens?.map((t) => ({
    entryType: t.type,
    httpHeaderKey: t.http_header?.key,
    hasValue: !!t.value,
    hasHttpHeaderValue: !!t.http_header?.value,
    entryError: t.error,
  }));
  logger.debug('Destination Service PP response', {
    destination: destinationName,
    authentication: dest.Authentication,
    proxyType: dest.ProxyType,
    url: dest.URL,
    ppEntryCount: sdkAuthTokens?.length ?? 0,
    ppEntries: rawEntries ?? 'NONE',
  });

  // Extract auth tokens from the SDK response
  if (sdkAuthTokens) {
    for (const token of sdkAuthTokens) {
      if (token.error) {
        logger.error('Destination Service auth token error', {
          destination: destinationName,
          tokenType: token.type,
          error: token.error,
        });
        throw new Error(`Destination Service auth token error for '${destinationName}': ${token.error}`);
      }

      // SAP-Connectivity-Authentication header (used by Cloud Connector for PP)
      if (token.http_header?.key === 'SAP-Connectivity-Authentication') {
        tokens.sapConnectivityAuth = token.http_header.value;
        logger.debug('PP: SAP-Connectivity-Authentication header extracted', {
          destination: destinationName,
          headerValueLength: token.http_header.value.length,
        });
      }

      // Bearer token (used for OAuth2SAMLBearerAssertion destinations)
      if (token.type === 'Bearer') {
        tokens.bearerToken = token.value;
      }
    }
  } else {
    logger.warn('Destination Service returned no authTokens — trying jwt-bearer exchange fallback', {
      destination: destinationName,
      authentication: dest.Authentication,
    });
  }

  // ─── PP jwt-bearer fallback (Option 2) ─────────────────────────────
  //
  // Background: The BTP Destination Service SHOULD return authTokens containing
  // the SAP-Connectivity-Authentication header for PrincipalPropagation destinations.
  // In practice, it often returns NO authTokens (empty response). This is a known
  // issue — the Destination Service simply omits the field.
  //
  // Workaround: We perform a jwt-bearer token exchange with the Connectivity
  // Service's XSUAA to verify the user JWT is valid. If the exchange succeeds,
  // we send the ORIGINAL user JWT as SAP-Connectivity-Authentication (Option 2
  // per SAP docs page 211). The Cloud Connector extracts the user identity from
  // this header and generates the X.509 certificate.
  //
  // Why Option 2 and not Option 1?
  // - Option 1 sends the EXCHANGED token as Proxy-Authorization
  // - The CC couldn't extract the principal from the exchanged token
  //   (CC trace: "no principal available, injecting empty certificate")
  // - Option 2 sends the ORIGINAL user JWT as SAP-Connectivity-Authentication
  //   + regular connectivity proxy token as Proxy-Authorization
  // - The CC successfully extracts the user email from the original JWT
  //
  // Reference: SAP BTP Connectivity docs page 209-213
  // https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/configure-principal-propagation-via-user-exchange-token
  if (!tokens.sapConnectivityAuth && dest.Authentication === 'PrincipalPropagation' && btpConfig.connectivityClientId) {
    logger.info('PP jwt-bearer exchange: attempting direct exchange with Connectivity Service', {
      destination: destinationName,
      connectivityUrl: btpConfig.connectivityTokenUrl,
    });

    try {
      // Exchange user JWT via jwt-bearer grant type with Connectivity Service credentials.
      // This validates the user JWT and proves we have a legitimate user token.
      // The exchange itself isn't used for auth — we use the original JWT instead.
      const exchangeResp = await fetch(btpConfig.connectivityTokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          client_id: btpConfig.connectivityClientId,
          client_secret: btpConfig.connectivitySecret,
          assertion: userJwt,
          token_format: 'jwt',
          response_type: 'token',
        }).toString(),
      });

      if (exchangeResp.ok) {
        await exchangeResp.json(); // consume response body

        // Option 2: Send the ORIGINAL user JWT as SAP-Connectivity-Authentication.
        // The CC reads this header, extracts the user identity (email), and generates
        // a short-lived X.509 certificate with CN=${email}. The regular connectivity
        // proxy token (from btpProxy.getProxyToken()) is sent as Proxy-Authorization.
        tokens.sapConnectivityAuth = `Bearer ${userJwt}`;

        logger.info('PP: using Option 2 (SAP-Connectivity-Authentication with original JWT)', {
          destination: destinationName,
        });
      } else {
        const errText = await exchangeResp.text();
        logger.error('PP jwt-bearer exchange: failed', {
          destination: destinationName,
          status: exchangeResp.status,
          error: errText.slice(0, 300),
        });
      }
    } catch (err) {
      logger.error('PP jwt-bearer exchange: error', {
        destination: destinationName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('BTP destination resolved (per-user)', {
    name: dest.Name,
    url: dest.URL,
    auth: dest.Authentication,
    hasConnectivityAuth: !!tokens.sapConnectivityAuth,
    hasBearer: !!tokens.bearerToken,
  });

  return { destination: dest, authTokens: tokens };
}

// ─── Top-Level Resolver ──────────────────────────────────────────────

/**
 * Resolve BTP destination and connectivity proxy.
 * Called on startup when SAP_BTP_DESTINATION env var is set.
 *
 * Returns the resolved SAP connection config to override defaults.
 */
export async function resolveBTPDestination(destinationName: string): Promise<{
  url: string;
  username: string;
  password: string;
  client: string;
  proxy: BTPProxyConfig | null;
}> {
  const btpConfig = parseVCAPServices();
  if (!btpConfig) {
    throw new Error('SAP_BTP_DESTINATION is set but VCAP_SERVICES is not available. Are you running on BTP CF?');
  }

  // Use direct fetch for startup — works with BasicAuth destinations without JWT.
  // The SDK's getDestination() fails for PrincipalPropagation destinations at startup
  // because there's no user JWT available yet.
  const dest = await lookupDestination(btpConfig, destinationName);
  const proxy =
    dest.ProxyType === 'OnPremise' ? createConnectivityProxy(btpConfig, dest.CloudConnectorLocationId) : null;

  return {
    url: dest.URL,
    username: dest.User,
    password: dest.Password,
    client: dest['sap-client'] || '100',
    proxy,
  };
}

/**
 * Get the app's public URL.
 *
 * Priority:
 *   1. ARC1_PUBLIC_URL env var — set this when the app is reached through a
 *      reverse proxy on a different hostname (e.g. SAP Integration Suite API
 *      Management). The value flows into every absolute URL the OAuth metadata
 *      endpoints emit (issuer, authorize, token, register, revoke, resource).
 *      May include a base-path component (e.g. https://api.example.com/arc1) —
 *      the path is preserved verbatim.
 *   2. VCAP_APPLICATION.application_uris[0] — set automatically by CF, points
 *      to the app's CF route.
 *   3. undefined — caller falls back to bind-host:port.
 *
 * The trailing slash, if present, is stripped so callers can do `${url}/path`
 * consistently.
 */
export function getAppUrl(): string | undefined {
  const override = process.env.ARC1_PUBLIC_URL?.trim();
  if (override) {
    return override.replace(/\/$/, '');
  }

  const vcapApp = process.env.VCAP_APPLICATION;
  if (!vcapApp) return undefined;

  try {
    const app = JSON.parse(vcapApp);
    const uris = app.application_uris ?? app.uris;
    if (Array.isArray(uris) && uris.length > 0) {
      return `https://${uris[0]}`;
    }
  } catch {
    // Not valid JSON
  }
  return undefined;
}
