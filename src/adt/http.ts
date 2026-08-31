/**
 * ADT HTTP Transport for ARC-1.
 *
 * Handles all HTTP communication with SAP ADT REST API:
 * - CSRF token lifecycle (fetch, cache, refresh on 403)
 * - Cookie-based and Basic auth
 * - Stateful sessions (lock → modify → unlock must share session)
 * - Automatic retry on session expiry
 *
 * Design decisions:
 *
 * 1. CSRF token fetch uses HEAD /sap/bc/adt/core/discovery with "X-CSRF-Token: fetch".
 *    HEAD is ~5s vs ~56s for GET on slow systems (learned from Go version benchmarks).
 *
 * 2. Modifying requests (POST/PUT/DELETE/PATCH) auto-include CSRF token.
 *    On 403, token is refreshed and request is retried once.
 *    (Pattern from both abap-adt-api and fr0ster implementations.)
 *
 * 3. Stateful sessions use "X-sap-adt-sessiontype: stateful" header.
 *    Lock/modify/unlock must use the same session cookies.
 *    withStatefulSession() ensures session isolation.
 *
 * 4. sap-client and sap-language are added to every request as query params.
 *    This is an SAP convention, not ADT-specific.
 *
 * 5. Uses native fetch() with undici dispatchers for proxy and TLS configuration.
 *    No external HTTP dependencies — undici ships with Node.js 22+.
 */

import type { BTPProxyConfig } from '@arc-mcp/xsuaa-auth/btp';
import { Agent, Client, type Dispatcher, fetch as undiciFetch } from 'undici';
import { getCurrentContext } from '../server/context.js';
import { logger } from '../server/logger.js';
import { traceHeaders } from '../server/trace-context.js';
import { resolveCookies } from './cookies.js';
import { resolveAcceptType, resolveContentType } from './discovery.js';
import { AdtApiError, AdtNetworkError } from './errors.js';
import {
  type AdtRequestOptions,
  awaitWithinRequestBudget,
  requestBudgetSignal,
  requestSignal,
  sleepWithinRequestBudget,
  throwIfRequestCancelled,
} from './http-deadline.js';
import { prepareDataPreviewWireBody } from './http-wire-body.js';
import type { Semaphore } from './semaphore.js';

export type { AdtRequestOptions } from './http-deadline.js';

/**
 * Opt-in wire-level debug logging.
 *
 * When ARC1_LOG_HTTP_DEBUG=true, every completed HTTP call to SAP ADT attaches
 * its request body, request headers, response body, and response headers to
 * the audit event. Sensitive headers are redacted here, bodies are truncated at
 * 64KB, and the central audit logger redacts payload bodies again before any sink
 * write. Intended for ad-hoc debugging of content negotiation, CSRF, and
 * activation preaudit response sizes — not for production.
 */
const HTTP_DEBUG_BODY_LIMIT = 65536;
const HTTP_DEBUG_REDACT_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-csrf-token',
  'sap-connectivity-authentication',
  'proxy-authorization',
  'password', // abapGit bridge credential header (base64 is not encryption)
]);

function redactDebugHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = HTTP_DEBUG_REDACT_HEADERS.has(k.toLowerCase()) ? '[REDACTED]' : v;
  }
  return out;
}

function responseHeadersToObject(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((v, k) => {
    out[k] = HTTP_DEBUG_REDACT_HEADERS.has(k.toLowerCase()) ? '[REDACTED]' : v;
  });
  return out;
}

function truncateBody(body: string | undefined): string | undefined {
  if (body === undefined) return undefined;
  if (body.length <= HTTP_DEBUG_BODY_LIMIT) return body;
  return `${body.slice(0, HTTP_DEBUG_BODY_LIMIT)}\n…[truncated ${body.length - HTTP_DEBUG_BODY_LIMIT} chars]`;
}

/** Build the optional debug-only audit fields (empty object when not enabled). */
function buildHttpDebugFields(
  reqHeaders: Record<string, string>,
  reqBody: string | undefined,
  respHeaders: Headers,
  respBody: string,
): Partial<{
  requestBody: string;
  requestHeaders: Record<string, string>;
  responseBody: string;
  responseHeaders: Record<string, string>;
}> {
  if (process.env.ARC1_LOG_HTTP_DEBUG !== 'true') return {};
  return {
    requestHeaders: redactDebugHeaders(reqHeaders),
    requestBody: truncateBody(reqBody),
    responseHeaders: responseHeadersToObject(respHeaders),
    responseBody: truncateBody(respBody),
  };
}

/** Session type for ADT requests */
export type SessionType = 'stateful' | 'stateless' | undefined;

/** Configuration for the ADT HTTP client */
export interface AdtHttpConfig {
  baseUrl: string;
  username?: string;
  password?: string;
  client?: string;
  language?: string;
  insecure?: boolean;
  /** Gzip non-empty data-preview POST bodies for approved WAF compatibility. */
  gzipDataPreviewBody?: boolean;
  cookies?: Record<string, string>;
  /** Path to cookie file — enables hot-reload on stale auth */
  cookieFile?: string;
  /** Inline cookie string — stored for config awareness (no hot-reload) */
  cookieString?: string;
  sessionType?: SessionType;
  /** BTP Connectivity proxy (Cloud Connector) */
  btpProxy?: BTPProxyConfig;
  /**
   * Per-user SAP-Connectivity-Authentication header value.
   * Set when using BTP Cloud Connector principal propagation.
   * Contains a SAML assertion with the user's identity.
   * When set, this header is sent on EVERY request to the connectivity proxy,
   * which forwards it to the Cloud Connector for user mapping.
   */
  sapConnectivityAuth?: string;
  /** PP Option 1: jwt-bearer exchanged token replacing Proxy-Authorization */
  ppProxyAuth?: string;
  /**
   * Bearer token provider for BTP ABAP Environment (OAuth 2.0).
   * When set, replaces Basic Auth with `Authorization: Bearer <token>`.
   * The function handles token lifecycle (caching, refresh, re-login).
   * Used for direct BTP ABAP connections via service key.
   */
  bearerTokenProvider?: () => Promise<string>;
  /**
   * Per-user SAMLAssertion Authorization header value (e.g. "SAML2.0 <assertion>") from the BTP
   * Destination Service. When set, sent verbatim as `Authorization` + `x-sap-security-session: create`.
   * Used for S/4HANA Public Cloud developer extensibility (the same destination flow BAS uses).
   */
  samlAuthorization?: string;
  /** Opt-in: disable SAML redirect via X-SAP-SAML2 header + saml2 query param */
  disableSaml?: boolean;
  /** Retry one final 401 after resetting session state. Defaults to true. */
  retryUnauthorized?: boolean;
  /** Secret-free hook invoked for the final 401 returned to the caller. */
  onUnauthorized?: (context: { path: string; statusCode: 401 }) => void;
  /** Optional concurrency limiter shared across requests */
  semaphore?: Semaphore;
}

/** Response from an ADT HTTP request */
export interface AdtResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

interface AuthenticationAttemptState {
  rejected: boolean;
  tail: Promise<void>;
}

/**
 * ADT HTTP Client — handles CSRF tokens, sessions, and authentication.
 *
 * Not a generic HTTP client: it's purpose-built for SAP ADT REST API conventions.
 */
export class AdtHttpClient {
  private discoveryMap: Map<string, string[]> = new Map();
  private negotiatedHeaders: Map<string, { accept?: string; contentType?: string }> = new Map();
  private csrfToken = '';
  private dispatcher: Dispatcher | undefined;
  private longOperationDispatcher: Dispatcher | undefined;
  private config: AdtHttpConfig;
  /**
   * Cookie jar — stores Set-Cookie headers from responses and sends them back.
   *
   * SAP ties CSRF tokens to session cookies (SAP_SESSIONID_*).
   * Without cookie persistence, CSRF-protected requests (POST/PUT/DELETE) fail with 403.
   * This was the root cause of integration test failures: token was fetched via HEAD,
   * but the subsequent POST didn't include the session cookie, so SAP rejected it.
   *
   * Design: simple Map<name, value> — we don't need full cookie jar semantics
   * (domain, path, expiry) because all requests go to the same SAP host.
   */
  private cookieJar: Map<string, string> = new Map();
  /** Guard to prevent infinite retry loops for DB connection errors */
  private dbRetryInProgress = false;
  /** Set after a 401 clears stale cookies — triggers file reload on the next request */
  private cookiesCleared = false;
  /** Shared by stateful clones so one rejected Basic credential cannot fan out internally. */
  private readonly authenticationAttemptState: AuthenticationAttemptState;
  constructor(config: AdtHttpConfig, authenticationAttemptState?: AuthenticationAttemptState) {
    this.config = config;
    this.authenticationAttemptState = authenticationAttemptState ?? { rejected: false, tail: Promise.resolve() };

    // Set up undici dispatcher for TLS configuration (non-proxy mode only).
    // Proxy requests use a dedicated Client connected to the connectivity proxy
    // (see doProxyRequest()) — undici 8.x ProxyAgent always uses CONNECT tunneling,
    // which BTP's connectivity proxy doesn't support (HTTP 405).
    if (!config.btpProxy && config.insecure) {
      this.dispatcher = new Agent({ connect: { rejectUnauthorized: false }, headersTimeout: 0, bodyTimeout: 0 });
    }
  }

  /** Inject startup discovery data used for proactive MIME negotiation. */
  setDiscoveryMap(map: Map<string, string[]>): void {
    this.discoveryMap = map;
  }

  /** True once ADT discovery has been loaded — lets callers distinguish "capability absent" from "unknown". */
  hasDiscoveryData(): boolean {
    return this.discoveryMap.size > 0;
  }

  /** The Accept media type ADT discovery advertises for a collection path, or undefined. Used for capability gating. */
  discoveryAcceptFor(path: string): string | undefined {
    return resolveAcceptType(this.discoveryMap, path);
  }

  /** Read-only access to the SAP-bound concurrency Semaphore (Layer 3).
   *  Returns the shared server-wide instance when `AdtClientConfig.adtSemaphore` was provided,
   *  the private fallback when only `maxConcurrent` was set, or `undefined` when neither was. */
  get semaphore(): Semaphore | undefined {
    return this.config.semaphore;
  }

  /** GET request */
  async get(path: string, headers?: Record<string, string>, options?: AdtRequestOptions): Promise<AdtResponse> {
    return this.request('GET', path, undefined, undefined, headers, options);
  }

  /** HEAD request — lightweight probe, no response body */
  async head(path: string, headers?: Record<string, string>, options?: AdtRequestOptions): Promise<AdtResponse> {
    return this.request('HEAD', path, undefined, undefined, headers, options);
  }

  /** POST request (includes CSRF token) */
  async post(
    path: string,
    body?: string,
    contentType?: string,
    headers?: Record<string, string>,
    options?: AdtRequestOptions,
  ): Promise<AdtResponse> {
    return this.request('POST', path, body, contentType, headers, options);
  }

  /** PUT request (includes CSRF token) */
  async put(
    path: string,
    body: string,
    contentType?: string,
    headers?: Record<string, string>,
    options?: AdtRequestOptions,
  ): Promise<AdtResponse> {
    return this.request('PUT', path, body, contentType, headers, options);
  }

  /** DELETE request (includes CSRF token) */
  async delete(path: string, headers?: Record<string, string>, options?: AdtRequestOptions): Promise<AdtResponse> {
    return this.request('DELETE', path, undefined, undefined, headers, options);
  }

  /**
   * Execute a function within an isolated stateful session.
   * Ensures lock/modify/unlock share the same SAP session cookies.
   *
   * Creates a new client instance with stateful session header,
   * shares CSRF token with the main client.
   */
  async withStatefulSession<T>(fn: (client: AdtHttpClient) => Promise<T>): Promise<T> {
    const sessionConfig: AdtHttpConfig = {
      ...this.config,
      sessionType: 'stateful',
    };
    const sessionClient = new AdtHttpClient(sessionConfig, this.authenticationAttemptState);
    // Share CSRF token and cookies so we don't need to re-fetch
    sessionClient.csrfToken = this.csrfToken;
    sessionClient.cookieJar = new Map(this.cookieJar);
    sessionClient.discoveryMap = this.discoveryMap;
    sessionClient.negotiatedHeaders = new Map(this.negotiatedHeaders);
    return fn(sessionClient);
  }

  /** Core request method — wraps requestInner with optional concurrency limiter */
  private async request(
    method: string,
    path: string,
    body?: string,
    contentType?: string,
    extraHeaders?: Record<string, string>,
    options?: AdtRequestOptions,
  ): Promise<AdtResponse> {
    throwIfRequestCancelled(options);
    const execute = async () => {
      try {
        if (this.config.semaphore) {
          return await this.config.semaphore.run(
            () => this.requestInner(method, path, body, contentType, extraHeaders, options),
            requestBudgetSignal(options),
          );
        }
        return await this.requestInner(method, path, body, contentType, extraHeaders, options);
      } catch (error) {
        if (error instanceof AdtApiError || error instanceof AdtNetworkError) throw error;
        if (!options?.signal && options?.deadline === undefined) throw error;
        const cause = error instanceof Error ? error : new Error(String(error));
        throw new AdtNetworkError(cause.message, cause);
      }
    };

    // Shared Basic clients disable 401 retries. Serialize their internal HTTP fan-out as well:
    // feature probes and compound handlers can otherwise start several requests with the same
    // expired password before the first 401 is observed. Once rejected, later requests on this
    // per-call client fail locally and never contact SAP.
    if (this.config.retryUnauthorized === false) {
      return this.runSerializedAuthenticationAttempt(path, execute, options);
    }
    return execute();
  }

  private async runSerializedAuthenticationAttempt<T>(
    path: string,
    execute: () => Promise<T>,
    options?: AdtRequestOptions,
  ): Promise<T> {
    const previous = this.authenticationAttemptState.tail;
    let release!: () => void;
    this.authenticationAttemptState.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    let turnStarted = false;
    try {
      await awaitWithinRequestBudget(previous, options);
      turnStarted = true;
      if (this.authenticationAttemptState.rejected) {
        throw new AdtApiError('Shared Basic authentication was already rejected for this request.', 401, path);
      }
      return await execute();
    } finally {
      if (turnStarted) release();
      else void previous.then(release, release);
    }
  }

  /** Inner request method — CSRF, retries, content negotiation */
  private async requestInner(
    method: string,
    path: string,
    body?: string,
    contentType?: string,
    extraHeaders?: Record<string, string>,
    options?: AdtRequestOptions,
  ): Promise<AdtResponse> {
    throwIfRequestCancelled(options);
    // Auto-fetch CSRF token for modifying requests
    if (isModifyingMethod(method) && !this.csrfToken) {
      await this.fetchCsrfToken(options);
    }

    const headers: Record<string, string> = { Accept: '*/*' };
    const negotiationKey = this.normalizeHeaderCacheKey(path);

    if (!extraHeaders?.Accept) {
      const cached = this.resolveNegotiatedHeaders(negotiationKey);
      if (cached?.accept) {
        headers.Accept = cached.accept;
      } else {
        const discoveredAccept = resolveAcceptType(this.discoveryMap, path);
        if (discoveredAccept) {
          headers.Accept = discoveredAccept;
        }
      }
    }

    if (isModifyingMethod(method) && contentType === undefined && !extraHeaders?.['Content-Type']) {
      const cached = this.resolveNegotiatedHeaders(negotiationKey);
      if (cached?.contentType) {
        headers['Content-Type'] = cached.contentType;
      } else {
        const discoveredContentType = resolveContentType(this.discoveryMap, path);
        if (discoveredContentType) {
          headers['Content-Type'] = discoveredContentType;
        }
      }
    }

    Object.assign(headers, extraHeaders);

    if (this.config.disableSaml) {
      headers['X-SAP-SAML2'] = 'disabled';
    }

    if (this.config.sessionType === 'stateful') {
      headers['X-sap-adt-sessiontype'] = 'stateful';
    }

    if (contentType) {
      headers['Content-Type'] = contentType;
    }

    // Keep `body` as the logical plaintext for debug audit fields; only `wireBody` is sent.
    const wireBody = prepareDataPreviewWireBody(this.config.gzipDataPreviewBody === true, method, path, body, headers);

    // Auth: Bearer token (BTP ABAP) or Basic Auth (on-premise)
    this.applyAuthHeader(headers);
    if (this.config.bearerTokenProvider) {
      throwIfRequestCancelled(options);
      const token = await awaitWithinRequestBudget(this.config.bearerTokenProvider(), options);
      headers.Authorization = `Bearer ${token}`;
    }

    // Lazy cookie reload: if cookies were cleared on a previous 401,
    // re-read the cookie file before this request.
    if (this.cookiesCleared && this.isCookieAuthMode()) {
      this.reloadCookiesFromSource();
    }

    // Read the CSRF token together with the cookie header below — SAP binds the token to the
    // session cookie, and a concurrent fetchCsrfToken() can replace both across the bearer
    // await above; a torn pair 403s. The retry paths below already read them adjacently.
    if (isModifyingMethod(method)) {
      headers['X-CSRF-Token'] = this.csrfToken;
    }

    // Build cookie header from config cookies + cookie jar, with the jar winning
    // on a name collision (see composeCookieHeader — issue #293).
    const cookieHeader = this.composeCookieHeader();
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }

    // BTP Connectivity proxy: Proxy-Authorization is handled in doProxyRequest().
    // Not set here because the proxy uses standard HTTP proxy protocol (not CONNECT).

    // Principal Propagation via SAP-Connectivity-Authentication header (Option 2).
    // Contains the ORIGINAL user JWT (not exchanged). The Cloud Connector reads
    // this header, extracts the user identity (email), generates a short-lived
    // X.509 certificate (CN=<email>), and injects it as SSL_CLIENT_CERT when
    // connecting to SAP's HTTPS port. SAP CERTRULE maps the cert to a SAP user.
    // See: https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/configure-principal-propagation-via-user-exchange-token
    if (this.config.sapConnectivityAuth && !this.config.ppProxyAuth) {
      headers['SAP-Connectivity-Authentication'] = this.config.sapConnectivityAuth;
    }

    const url = this.buildUrl(path);
    const httpStart = Date.now();

    // Per-request guards to prevent infinite retry loops
    let negotiationRetried = false;
    let authRetried = false;
    let retried429 = false;

    try {
      let response = await this.doFetch(url, method, headers, wireBody, options);
      let responseBody = await response.text();

      // Persist any Set-Cookie headers from the response
      this.storeCookies(response);

      // Detect broken DB connection on the assigned work process.
      // SAP's ICM routes all requests with the same session cookie to the same
      // work process. If that WP has a broken HANA connection, every request fails
      // with "database connection is not open". Fix: clear the session to force
      // ICM to assign a different work process on retry.
      if (response.status === 500 && this.isDbConnectionError(responseBody) && !this.dbRetryInProgress) {
        this.dbRetryInProgress = true;
        try {
          logger.emitAudit({
            timestamp: new Date().toISOString(),
            level: 'warn',
            event: 'http_request',
            method,
            path,
            statusCode: response.status,
            durationMs: Date.now() - httpStart,
            errorBody: 'DB connection broken — resetting session and retrying',
          });

          // Clear session to get a different work process
          this.resetSession();

          // Re-fetch CSRF token (needed for modifying requests, harmless for reads)
          if (isModifyingMethod(method)) {
            await this.fetchCsrfToken(options);
            headers['X-CSRF-Token'] = this.csrfToken;
          }

          // Rebuild cookie header from fresh jar
          const freshCookieParts: string[] = [];
          for (const [k, v] of this.cookieJar) {
            freshCookieParts.push(`${k}=${v}`);
          }
          if (freshCookieParts.length > 0) {
            headers.Cookie = freshCookieParts.join('; ');
          } else {
            delete headers.Cookie;
          }

          const retryResp = await this.doFetch(url, method, headers, wireBody, options);
          const retryBody = await retryResp.text();
          this.storeCookies(retryResp);
          const retryResult = this.handleResponse(retryResp.status, retryResp.headers, retryBody, path);

          logger.emitAudit({
            timestamp: new Date().toISOString(),
            level: 'info',
            event: 'http_request',
            method,
            path,
            statusCode: retryResp.status,
            durationMs: Date.now() - httpStart,
            errorBody: 'DB connection retry succeeded',
          });

          return retryResult;
        } finally {
          this.dbRetryInProgress = false;
        }
      }

      // Handle 503 Service Unavailable — ICM thread/MPI exhaustion or WP overload.
      // Retry ALL methods: a 503 means ICM rejected the request before it reached a work
      // process, so the operation never executed — retrying is safe even for POST/PUT/DELETE.
      // Retry happens INSIDE the semaphore slot to avoid increasing load on an overloaded system.
      // Honors RFC 7231 Retry-After header when present; falls back to 1-2 s jitter otherwise.
      if (response.status === 503) {
        const { delayMs: jitterMs, source } = parseRetryAfter(
          response.headers.get('retry-after'),
          1000 + Math.random() * 1000,
        );
        logger.emitAudit({
          timestamp: new Date().toISOString(),
          level: 'warn',
          event: 'http_request',
          method,
          path,
          statusCode: 503,
          durationMs: Date.now() - httpStart,
          errorBody: `503 Service Unavailable — retrying in ${Math.round(jitterMs)}ms (${source})`,
        });

        await sleepWithinRequestBudget(jitterMs, options);

        const retryResp = await this.doFetch(url, method, headers, wireBody, options);
        const retryBody = await retryResp.text();
        this.storeCookies(retryResp);

        logger.emitAudit({
          timestamp: new Date().toISOString(),
          level: retryResp.status === 503 ? 'warn' : 'info',
          event: 'http_request',
          method,
          path,
          statusCode: retryResp.status,
          durationMs: Date.now() - httpStart,
          errorBody: `503 retry completed (${retryResp.status})`,
        });

        return this.handleResponse(retryResp.status, retryResp.headers, retryBody, path);
      }

      // Handle 429 Too Many Requests — emitted by SAP Web Dispatcher, BTP API
      // Management, or any upstream gateway throttling us. Like 503, the request did
      // not reach a SAP work process, so retrying ALL methods is safe (gateway-level
      // rejection, never partial execution). Honors RFC 7231 Retry-After when present;
      // falls back to 1-2 s jitter. Single retry only — per-request `retried429` guard
      // prevents loops. If the upstream is still throttling on the second attempt, we
      // surface the 429 to the caller for them to back off at the agent/LLM layer.
      if (response.status === 429 && !retried429) {
        retried429 = true;
        const { delayMs: jitterMs, source } = parseRetryAfter(
          response.headers.get('retry-after'),
          1000 + Math.random() * 1000,
        );
        logger.emitAudit({
          timestamp: new Date().toISOString(),
          level: 'warn',
          event: 'http_request',
          method,
          path,
          statusCode: 429,
          durationMs: Date.now() - httpStart,
          errorBody: `429 Too Many Requests — retrying in ${Math.round(jitterMs)}ms (${source})`,
        });

        await sleepWithinRequestBudget(jitterMs, options);

        const retryResp = await this.doFetch(url, method, headers, wireBody, options);
        const retryBody = await retryResp.text();
        this.storeCookies(retryResp);

        logger.emitAudit({
          timestamp: new Date().toISOString(),
          level: retryResp.status === 429 ? 'warn' : 'info',
          event: 'http_request',
          method,
          path,
          statusCode: retryResp.status,
          durationMs: Date.now() - httpStart,
          errorBody: `429 retry completed (${retryResp.status})`,
        });

        return this.handleResponse(retryResp.status, retryResp.headers, retryBody, path);
      }

      // Handle 401 session timeout — reset session and retry once.
      // Uses per-request guard (not instance-level) so concurrent requests each get their own retry.
      // On success, reassigns response/responseBody and falls through to downstream handlers
      // (403 CSRF, 406/415 negotiation) so combined-failure recovery works.
      if (response.status === 401 && !authRetried && this.config.retryUnauthorized !== false) {
        authRetried = true;

        logger.emitAudit({
          timestamp: new Date().toISOString(),
          level: 'warn',
          event: 'http_request',
          method,
          path,
          statusCode: 401,
          durationMs: Date.now() - httpStart,
          errorBody: '401 session expired — resetting session and retrying',
        });

        // Clear session to force fresh authentication
        this.resetSession();

        // Pick up an out-of-band rotated cookie file so the call that observes the
        // expiry can recover; the lazy `cookiesCleared` reload stays the fallback.
        // `cookieFile`, not `isCookieAuthMode()` — cookieString has nothing to re-read,
        // and reloadCookiesFromSource keeps config.cookies on a missing/empty file, so
        // the retry still replays the ticket we have.
        if (this.config.cookieFile) this.reloadCookiesFromSource();

        // Re-apply auth credentials
        this.applyAuthHeader(headers);
        if (this.config.bearerTokenProvider) {
          throwIfRequestCancelled(options);
          const token = await awaitWithinRequestBudget(this.config.bearerTokenProvider(), options);
          headers.Authorization = `Bearer ${token}`;
        }

        // Re-fetch CSRF token for modifying requests
        if (isModifyingMethod(method)) {
          await this.fetchCsrfToken(options);
          headers['X-CSRF-Token'] = this.csrfToken;
        }

        // Rebuild cookie header from config cookies + fresh jar (jar wins).
        const refreshedCookieHeader = this.composeCookieHeader();
        if (refreshedCookieHeader) {
          headers.Cookie = refreshedCookieHeader;
        } else {
          delete headers.Cookie;
        }

        response = await this.doFetch(url, method, headers, wireBody, options);
        responseBody = await response.text();
        this.storeCookies(response);

        logger.emitAudit({
          timestamp: new Date().toISOString(),
          level: 'info',
          event: 'http_request',
          method,
          path,
          statusCode: response.status,
          durationMs: Date.now() - httpStart,
          errorBody: '401 session retry completed',
        });

        if (response.status === 401 && this.isCookieAuthMode()) {
          this.clearCookiesAndMark();
          logger.warn(
            'Cookie auth: 401 persisted after retry — clearing stale cookies. ' +
              'Run `arc1-cli extract-cookies` to get fresh cookies; the next SAP call will reload them automatically.',
          );
        }
        // Fall through to downstream handlers (403/406/415/normal)
      }

      // Handle CSRF token refresh on 403 (modifying requests only)
      if (response.status === 403 && isModifyingMethod(method)) {
        await this.fetchCsrfToken(options);
        headers['X-CSRF-Token'] = this.csrfToken;
        // Update cookie header after CSRF fetch may have set new cookies. Use the
        // merged builder (jar wins) so auth cookies in config.cookies (e.g.
        // MYSAPSSO2) are preserved while the refreshed session id from the jar wins.
        const csrfRefreshedCookieHeader = this.composeCookieHeader();
        if (csrfRefreshedCookieHeader) {
          headers.Cookie = csrfRefreshedCookieHeader;
        }
        const retryResponse = await this.doFetch(url, method, headers, wireBody, options);
        const retryBody = await retryResponse.text();
        this.storeCookies(retryResponse);
        const result = this.handleResponse(retryResponse.status, retryResponse.headers, retryBody, path);

        logger.emitAudit({
          timestamp: new Date().toISOString(),
          level: 'info',
          event: 'http_request',
          method,
          path,
          statusCode: retryResponse.status,
          durationMs: Date.now() - httpStart,
        });

        return result;
      }

      // Handle 406/415 content negotiation failure — retry once with fallback headers
      if ((response.status === 406 || response.status === 415) && !negotiationRetried) {
        negotiationRetried = true;
        const fallbackHeaders = { ...headers };

        let headersChanged = false;

        if (response.status === 406) {
          // Server rejected our Accept header — try fallback
          const inferred = inferAcceptFromError(responseBody);
          if (inferred && inferred !== fallbackHeaders.Accept) {
            fallbackHeaders.Accept = inferred;
            headersChanged = true;
          } else if (
            fallbackHeaders.Accept &&
            fallbackHeaders.Accept !== '*/*' &&
            fallbackHeaders.Accept !== 'application/xml'
          ) {
            // Fall back to generic XML first
            fallbackHeaders.Accept = 'application/xml';
            headersChanged = true;
          } else if (fallbackHeaders.Accept === 'application/xml') {
            // application/xml was already rejected — fall back to wildcard
            fallbackHeaders.Accept = '*/*';
            headersChanged = true;
          }
          // If Accept is already */* and no inferred type, no useful fallback — skip retry
        } else {
          // 415: Server rejected our Content-Type — try fallbacks:
          // 1. Specific type → application/xml (common for vendor-type mismatches)
          // 2. application/xml → application/* (DDL-based endpoints reject the literal
          //    type but accept the wildcard, matching how ADT Eclipse sends requests)
          if (contentType && contentType !== 'application/xml' && contentType !== 'application/*') {
            fallbackHeaders['Content-Type'] = 'application/xml';
            headersChanged = true;
          } else if (contentType === 'application/xml') {
            fallbackHeaders['Content-Type'] = 'application/*';
            headersChanged = true;
          }
          // If Content-Type is already application/* or absent, no useful fallback — skip retry
        }

        if (headersChanged) {
          const retryAccept = fallbackHeaders.Accept;
          const retryContentType = fallbackHeaders['Content-Type'];

          logger.emitAudit({
            timestamp: new Date().toISOString(),
            level: 'warn',
            event: 'http_request',
            method,
            path,
            statusCode: response.status,
            durationMs: Date.now() - httpStart,
            errorBody: `Content negotiation ${response.status} — retrying with fallback headers`,
          });

          const retryResp = await this.doFetch(url, method, fallbackHeaders, wireBody, options);
          const retryBody = await retryResp.text();
          this.storeCookies(retryResp);

          // Store CSRF token from retry response
          const retryToken = retryResp.headers.get('x-csrf-token');
          if (retryToken && retryToken !== 'Required') {
            this.csrfToken = retryToken;
          }

          const retryResult = this.handleResponse(retryResp.status, retryResp.headers, retryBody, path);

          const currentContentType = contentType ?? headers['Content-Type'];
          const negotiated: { accept?: string; contentType?: string } = {};
          if (retryAccept !== headers.Accept) {
            negotiated.accept = retryAccept;
          }
          if (retryContentType !== currentContentType) {
            negotiated.contentType = retryContentType;
          }
          if (negotiated.accept || negotiated.contentType) {
            this.negotiatedHeaders.set(negotiationKey, negotiated);
          }

          logger.emitAudit({
            timestamp: new Date().toISOString(),
            level: 'info',
            event: 'http_request',
            method,
            path,
            statusCode: retryResp.status,
            durationMs: Date.now() - httpStart,
            errorBody: `Content negotiation retry succeeded (${response.status} → ${retryResp.status})`,
          });

          return retryResult;
        }
        // No meaningful header change — fall through to normal error handling
      }

      // Store CSRF token from response
      const responseToken = response.headers.get('x-csrf-token');
      if (responseToken && responseToken !== 'Required') {
        this.csrfToken = responseToken;
      }

      const result = this.handleResponse(response.status, response.headers, responseBody, path);

      logger.emitAudit({
        timestamp: new Date().toISOString(),
        level: 'debug',
        event: 'http_request',
        method,
        path,
        statusCode: response.status,
        durationMs: Date.now() - httpStart,
        ...buildHttpDebugFields(headers, body, response.headers, responseBody),
      });

      return result;
    } catch (err) {
      // Log failed HTTP requests
      const durationMs = Date.now() - httpStart;
      if (err instanceof AdtApiError) {
        // Probe calls expect misses (feature absent / intentional 400); their outcome is
        // reported at a higher layer, so the raw failure is debug-level noise. suppressNotFoundLog
        // stays 404-only for its callers (optional class includes etc.).
        const isProbeMiss = options?.probe === true;
        const isSuppressedNotFound = options?.suppressNotFoundLog === true && err.statusCode === 404;
        // Authentication and authorization bodies can contain technical usernames,
        // SAP security details, or echoed login material. They are never useful in
        // the general audit stream and must stay out even when HTTP debug is enabled.
        const suppressAuthBody = err.statusCode === 401 || err.statusCode === 403;
        const level = isProbeMiss || isSuppressedNotFound ? 'debug' : 'warn';
        logger.emitAudit({
          timestamp: new Date().toISOString(),
          level,
          event: 'http_request',
          method,
          path,
          statusCode: err.statusCode,
          durationMs,
          errorBody: suppressAuthBody ? undefined : err.responseBody?.slice(0, 200),
          ...(process.env.ARC1_LOG_HTTP_DEBUG === 'true'
            ? {
                requestHeaders: redactDebugHeaders(headers),
                requestBody: truncateBody(body),
                responseBody: suppressAuthBody
                  ? '[suppressed authentication response]'
                  : truncateBody(err.responseBody),
              }
            : {}),
        });
        throw err;
      }

      if (err instanceof AdtNetworkError) throw err;

      const message = err instanceof Error ? err.message : String(err);
      throw new AdtNetworkError(message, err instanceof Error ? err : undefined);
    }
  }

  private normalizeHeaderCacheKey(path: string): string {
    const withoutHash = path.split('#')[0] ?? path;
    const withoutQuery = withoutHash.split('?')[0] ?? withoutHash;
    if (!withoutQuery) return '/';
    return withoutQuery.endsWith('/') && withoutQuery.length > 1 ? withoutQuery.slice(0, -1) : withoutQuery;
  }

  private resolveNegotiatedHeaders(path: string): { accept?: string; contentType?: string } | undefined {
    let matched: { accept?: string; contentType?: string } | undefined;
    let matchedPathLength = -1;

    for (const [prefix, headers] of this.negotiatedHeaders.entries()) {
      const isExact = path === prefix;
      const isChild = path.startsWith(`${prefix}/`);
      if (!isExact && !isChild) continue;
      if (prefix.length > matchedPathLength) {
        matched = headers;
        matchedPathLength = prefix.length;
      }
    }

    return matched;
  }

  private notifyUnauthorized(path: string): void {
    if (this.config.retryUnauthorized === false) {
      this.authenticationAttemptState.rejected = true;
    }
    try {
      this.config.onUnauthorized?.({ path, statusCode: 401 });
    } catch {
      // Authentication-state observers must never replace the SAP error.
    }
  }

  /** Handle response: throw on error status, return normalized response */
  private handleResponse(status: number, headers: Headers, body: string, path: string): AdtResponse {
    const contentType = headers.get('content-type')?.toLowerCase();
    const isCoreDiscovery = path.split('?', 1)[0] === '/sap/bc/adt/core/discovery';
    if (
      status === 200 &&
      path.startsWith('/sap/bc/adt/') &&
      (contentType?.startsWith('text/html') || isCoreDiscovery) &&
      looksLikeLoginPage(body)
    ) {
      if (this.isCookieAuthMode()) {
        this.clearCookiesAndMark();
      }
      this.notifyUnauthorized(path);
      throw new AdtApiError(
        'ADT call returned HTML login page — authentication required. If using cookies, they may have expired. If using Basic auth, credentials may be invalid or not authorized for ADT (S_ADT_RES missing). If on an SSO-only system, try SAP_DISABLE_SAML=true or see docs/enterprise-auth.md. Re-run arc-1 after fixing.',
        401,
        path,
        body.slice(0, 500),
      );
    }

    if (status >= 400) {
      if (status === 401) {
        this.notifyUnauthorized(path);
      }
      throw new AdtApiError(body.slice(0, 500), status, path, body);
    }

    // Flatten headers to Record<string, string>
    const flatHeaders: Record<string, string> = {};
    for (const [key, value] of headers.entries()) {
      flatHeaders[key] = value;
    }

    return {
      statusCode: status,
      headers: flatHeaders,
      body,
    };
  }

  /**
   * Fetch CSRF token from SAP.
   * Uses HEAD /sap/bc/adt/core/discovery for speed.
   */
  async fetchCsrfToken(options?: AdtRequestOptions): Promise<void> {
    throwIfRequestCancelled(options);
    const url = this.buildUrl('/sap/bc/adt/core/discovery');
    const headers: Record<string, string> = {
      'X-CSRF-Token': 'fetch',
      Accept: '*/*',
    };

    if (this.config.sessionType === 'stateful') {
      headers['X-sap-adt-sessiontype'] = 'stateful';
    }

    if (this.config.disableSaml) {
      headers['X-SAP-SAML2'] = 'disabled';
    }

    // Auth: Bearer token (BTP ABAP) or Basic Auth (on-premise)
    this.applyAuthHeader(headers);
    if (this.config.bearerTokenProvider) {
      throwIfRequestCancelled(options);
      const token = await awaitWithinRequestBudget(this.config.bearerTokenProvider(), options);
      headers.Authorization = `Bearer ${token}`;
    }

    // Principal Propagation via SAP-Connectivity-Authentication header (Option 2).
    // Must be included on the CSRF fetch too — otherwise the Cloud Connector
    // establishes a session without user identity, and the CSRF token ends up
    // bound to a different session than the subsequent write request.
    if (this.config.sapConnectivityAuth && !this.config.ppProxyAuth) {
      headers['SAP-Connectivity-Authentication'] = this.config.sapConnectivityAuth;
    }

    // Lazy cookie reload (same guard as request()) — re-read cookie file
    // before CSRF fetch so a hot-reloaded cookie is used immediately.
    if (this.cookiesCleared && this.isCookieAuthMode()) {
      this.reloadCookiesFromSource();
    }

    // Include existing cookies (config + jar, jar wins) so the session is maintained.
    const cookieHeader = this.composeCookieHeader();
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }

    try {
      let response = await this.doFetch(url, 'HEAD', headers, undefined, options);

      // Retry once on 503 — ICM may be temporarily overloaded (thread/MPI exhaustion)
      if (response.status === 503) {
        const jitterMs = 1000 + Math.random() * 1000;
        logger.emitAudit({
          timestamp: new Date().toISOString(),
          level: 'warn',
          event: 'http_request',
          method: 'HEAD',
          path: '/sap/bc/adt/core/discovery',
          statusCode: 503,
          durationMs: 0,
          errorBody: `CSRF fetch got 503 — retrying in ${Math.round(jitterMs)}ms`,
        });
        await sleepWithinRequestBudget(jitterMs, options);
        response = await this.doFetch(url, 'HEAD', headers, undefined, options);
      }

      // Preserve any session established by HEAD before deciding whether GET is needed.
      // The fallback request must use the same SAP session as the eventual write.
      this.storeCookies(response);

      const headToken = response.headers.get('x-csrf-token');
      const headSucceededWithoutToken = response.ok && (!headToken || headToken.toLowerCase() === 'required');

      // Some systems reject HEAD with 403; others accept it but omit the token. In both
      // cases retry with GET, which is the broadly supported CSRF bootstrap method and
      // also exposes a real authentication failure instead of a misleading HTTP 200 error.
      if (response.status === 403 || headSucceededWithoutToken) {
        const fallbackCookieHeader = this.composeCookieHeader();
        if (fallbackCookieHeader) {
          headers.Cookie = fallbackCookieHeader;
        } else {
          delete headers.Cookie;
        }
        logger.emitAudit({
          timestamp: new Date().toISOString(),
          level: response.status === 403 ? 'warn' : 'debug',
          event: 'http_request',
          method: 'HEAD',
          path: '/sap/bc/adt/core/discovery',
          statusCode: response.status,
          durationMs: 0,
          errorBody:
            response.status === 403
              ? 'CSRF HEAD returned 403 — retrying with GET (S/4HANA Public Cloud compat)'
              : 'CSRF HEAD returned no usable token — retrying with GET',
        });
        response = await this.doFetch(url, 'GET', headers, undefined, options);
      }

      // Store cookies from the final CSRF response — critical for session correlation.
      this.storeCookies(response);

      const token = response.headers.get('x-csrf-token');
      if (!token || token === 'Required') {
        if (response.status === 401) {
          if (this.isCookieAuthMode()) {
            this.clearCookiesAndMark();
          }
          this.notifyUnauthorized('/sap/bc/adt/core/discovery');
          throw new AdtApiError(
            `Authentication failed (401) using sap-client=${this.config.client ?? '100'}. Check SAP_CLIENT, SAP_USER, and SAP_PASSWORD.`,
            401,
            '/sap/bc/adt/core/discovery',
          );
        }
        if (response.status === 403) {
          throw new AdtApiError(
            `Access forbidden (403) using sap-client=${this.config.client ?? '100'}. Check user authorizations.`,
            403,
            '/sap/bc/adt/core/discovery',
          );
        }
        throw new AdtApiError(
          `No CSRF token in response (HTTP ${response.status})`,
          response.status,
          '/sap/bc/adt/core/discovery',
        );
      }

      this.csrfToken = token;
    } catch (err) {
      if (err instanceof AdtApiError || err instanceof AdtNetworkError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new AdtNetworkError(`CSRF token fetch failed: ${message}`, err instanceof Error ? err : undefined);
    }
  }

  /**
   * Detect "database connection is not open" error from SAP.
   * This happens when a work process loses its HANA DB connection.
   * SAP returns a 500 with this message in the body (plain text or XML).
   */
  private isDbConnectionError(body: string): boolean {
    return body.toLowerCase().includes('database connection is not open');
  }

  private isCookieAuthMode(): boolean {
    return !!(this.config.cookieFile || this.config.cookieString);
  }

  /**
   * Mark stale cookies for hot-reload on the next request.
   *
   * Clears EVERY in-memory copy of the failed session: `config.cookies` (the
   * static set seeded from cookieFile/cookieString at construction), `cookieJar`
   * (cookies harvested from prior responses, including the 401/HTML-login
   * response that just triggered this call), and `csrfToken` (bound to the
   * dead session).
   *
   * Without clearing the jar, the next request's cookie-header build path
   * (`config.cookies` + `cookieJar`) would re-emit the stale Set-Cookie values
   * harvested from the failed response — overriding the fresh `config.cookies`
   * we'll repopulate via `reloadCookiesFromSource()`. The jar therefore must
   * not survive the reload boundary.
   *
   * Called from THREE paths: persistent 401 in `request()` retry, HTML-login
   * fallback in `handleResponse()`, and CSRF 401 in `fetchCsrfToken()`. Also
   * exposed publicly via `markCookiesStale()` so the startup auth preflight
   * can propagate "the cookies you started the process with are dead" state
   * to the long-lived runtime client.
   */
  private clearCookiesAndMark(): void {
    this.config.cookies = {};
    this.cookieJar.clear();
    this.csrfToken = '';
    this.cookiesCleared = true;
  }

  /**
   * Public hook so `runStartupAuthPreflight` (which uses a throwaway client)
   * can mark the long-lived runtime client as having stale cookies. Without
   * this propagation, the runtime client ignores the preflight 401 and the
   * first real tool call repeats the failure before lazy reload kicks in.
   * Caller is expected to be in cookie-auth mode; the method is a no-op
   * otherwise.
   */
  markCookiesStale(): void {
    if (!this.isCookieAuthMode()) return;
    this.clearCookiesAndMark();
  }

  /**
   * Re-read cookies from the original source (file or string).
   * Called lazily on the NEXT request after a 401 cleared stale cookies.
   */
  private reloadCookiesFromSource(): void {
    this.cookiesCleared = false;
    if (!this.config.cookieFile && this.config.cookieString) {
      logger.warn('SAP_COOKIE_STRING cannot be refreshed without restart. Use SAP_COOKIE_FILE for automatic reload.');
      return;
    }
    try {
      const fresh = resolveCookies(this.config.cookieFile, this.config.cookieString);
      if (fresh && Object.keys(fresh).length > 0) {
        this.config.cookies = fresh;
        logger.info('Reloaded cookies from file', { cookieCount: Object.keys(fresh).length });
      } else {
        logger.warn('Cookie reload returned empty result');
      }
    } catch (err) {
      logger.warn('Failed to reload cookies from source', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Reset HTTP session state to force SAP's ICM to assign a new work process.
   * Clears session cookies and CSRF token so the next request gets a fresh session.
   */
  private resetSession(): void {
    this.cookieJar.clear();
    this.csrfToken = '';
  }

  /**
   * Build the `Cookie` request header by merging the static `config.cookies`
   * (seeded from SAP_COOKIE_FILE / SAP_COOKIE_STRING) with the live `cookieJar`
   * (server-assigned via Set-Cookie). On a name collision the jar wins, because
   * its value is the current server-assigned one.
   *
   * This matters most for the ephemeral stateful-session id
   * `SAP_SESSIONID_<SID>_<CLNT>`: a cookie file extracted from a browser carries
   * a stale copy, and a stateful LOCK opens a fresh session that re-sets it. The
   * pre-fix builders concatenated both (`config` then `jar`), emitting two
   * same-named cookies; SAP's ICM honors the first (stale) one, so the follow-up
   * PUT bound to the wrong session and the enqueue lock was invisible —
   * surfacing as `423 ... is not locked (invalid lock handle)`. See issue #293.
   *
   * Auth cookies that the server never re-sets (e.g. `MYSAPSSO2`) live only in
   * `config.cookies` and survive untouched. Returns undefined when empty.
   */
  private composeCookieHeader(): string | undefined {
    const merged = new Map<string, string>();
    if (this.config.cookies) {
      for (const [name, value] of Object.entries(this.config.cookies)) {
        merged.set(name, value);
      }
    }
    for (const [name, value] of this.cookieJar) {
      merged.set(name, value);
    }
    if (merged.size === 0) return undefined;
    return Array.from(merged, ([name, value]) => `${name}=${value}`).join('; ');
  }

  private storeCookies(response: Response): void {
    const setCookieHeaders = response.headers.getSetCookie();
    if (!setCookieHeaders || setCookieHeaders.length === 0) return;

    for (const cookie of setCookieHeaders) {
      // Set-Cookie: name=value; Path=/; HttpOnly; ...
      const nameValue = cookie.split(';')[0];
      if (!nameValue) continue;
      const eqIdx = nameValue.indexOf('=');
      if (eqIdx <= 0) continue;
      const name = nameValue.substring(0, eqIdx).trim();
      const value = nameValue.substring(eqIdx + 1).trim();
      this.cookieJar.set(name, value);
    }
  }

  /** Build full URL with sap-client and sap-language query params */
  private buildUrl(path: string): string {
    const base = this.config.baseUrl.replace(/\/$/, '');
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(base + normalizedPath);

    if (this.config.client) {
      url.searchParams.set('sap-client', this.config.client);
    }
    if (this.config.language) {
      url.searchParams.set('sap-language', this.config.language);
    }
    if (this.config.disableSaml) {
      url.searchParams.set('saml2', 'disabled');
    }

    return url.toString();
  }

  /** Apply Basic Auth header if username/password are configured (and no bearer provider) */
  private applyAuthHeader(headers: Record<string, string>): void {
    // Principal Propagation via SAMLAssertion (e.g. S/4HANA Public Cloud developer extensibility —
    // the same destination flow BAS uses). The BTP Destination Service returns a ready-to-use
    // Authorization value (the SAML assertion); send it verbatim plus `x-sap-security-session: create`
    // so SAP establishes a session and returns cookies the jar reuses (mirrors @sap-cloud-sdk's
    // SAMLAssertion handling). Mutually exclusive with the other per-user auth modes below.
    if (this.config.samlAuthorization) {
      headers.Authorization = this.config.samlAuthorization;
      headers['x-sap-security-session'] = 'create';
      return;
    }
    if (
      this.config.username &&
      this.config.password &&
      !this.config.bearerTokenProvider &&
      !this.config.sapConnectivityAuth &&
      !this.config.ppProxyAuth
    ) {
      headers.Authorization = `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`;
    }
  }

  /**
   * Execute a fetch request with the configured dispatcher and timeout.
   *
   * For BTP Connectivity proxy: uses doProxyRequest() which sends standard
   * HTTP proxy requests via undici.Client. This is necessary because undici 8.x
   * ProxyAgent always uses HTTP CONNECT tunneling, but the BTP connectivity
   * proxy only supports standard HTTP proxy protocol (returns 405 on CONNECT).
   *
   * For non-proxy: uses undici's own fetch rather than the global fetch because
   * Node 22's built-in fetch embeds an older undici version whose dispatcher
   * interface is incompatible with npm undici@8 Agent/ProxyAgent instances.
   */
  private async doFetch(
    url: string,
    method: string,
    headers: Record<string, string>,
    body?: string | Buffer,
    options?: AdtRequestOptions,
  ): Promise<Response> {
    throwIfRequestCancelled(options);
    // Forward the caller's W3C trace context to SAP so one trace spans agent → ARC-1 → SAP.
    // Empty unless the MCP client sent a valid `traceparent`; ARC-1 never originates a trace.
    // Injected here because doFetch is the single outbound choke point (the proxy branch below
    // spreads these headers too).
    const outbound = { ...headers, ...traceHeaders(getCurrentContext()) };

    if (this.config.btpProxy) {
      return this.doProxyRequest(url, method, outbound, body, options);
    }
    // Let the explicit operation budget override undici's 300-second header timeout.
    const dispatcher =
      this.dispatcher ??
      (options?.fetchTimeoutMs === undefined
        ? undefined
        : (this.longOperationDispatcher ??= new Agent({ headersTimeout: 0, bodyTimeout: 0 })));
    return undiciFetch(url, {
      method,
      headers: outbound,
      body,
      signal: requestSignal(options),
      ...(dispatcher ? { dispatcher } : {}),
    }) as Promise<Response>;
  }

  /**
   * Execute an HTTP request through the BTP connectivity proxy using standard
   * HTTP proxy protocol (RFC 7230).
   *
   * Standard HTTP proxying sends the full URL as the request path:
   *   GET http://target:port/path HTTP/1.1
   *   Host: target:port
   *   Proxy-Authorization: Bearer <token>
   *
   * This is different from CONNECT tunneling (which undici 8.x ProxyAgent uses).
   * The BTP connectivity proxy (Cloud Connector) only supports standard proxying
   * for HTTP targets, returning 405 Method Not Allowed for CONNECT requests.
   *
   * Uses undici.Client connected to the proxy host. The Client sends requests
   * to the proxy, and by setting the `path` to the full target URL, the proxy
   * forwards it to the Cloud Connector → on-premise SAP system.
   */
  private async doProxyRequest(
    url: string,
    method: string,
    headers: Record<string, string>,
    body?: string | Buffer,
    options?: AdtRequestOptions,
  ): Promise<Response> {
    const proxy = this.config.btpProxy!;
    const proxyOrigin = `${proxy.protocol}://${proxy.host}:${proxy.port}`;

    let proxyAuth: string;
    throwIfRequestCancelled(options);
    if (this.config.ppProxyAuth) {
      proxyAuth = this.config.ppProxyAuth;
    } else {
      const proxyToken = await awaitWithinRequestBudget(proxy.getProxyToken(), options);
      proxyAuth = `Bearer ${proxyToken}`;
    }

    const targetUrl = new URL(url);
    const hostHeader = targetUrl.port ? `${targetUrl.hostname}:${targetUrl.port}` : targetUrl.hostname;

    // Merge proxy headers with request headers
    const proxyHeaders: Record<string, string> = {
      ...headers,
      Host: hostHeader,
      'Proxy-Authorization': proxyAuth,
    };

    // Cloud Connector Location ID — required when multiple Cloud Connectors
    // are connected to the same subaccount with different Location IDs.
    if (proxy.locationId) {
      proxyHeaders['SAP-Connectivity-SCC-Location_ID'] = proxy.locationId;
    }

    const clientOptions = options?.fetchTimeoutMs === undefined ? undefined : { headersTimeout: 0, bodyTimeout: 0 };
    const client = new Client(proxyOrigin, clientOptions);
    try {
      const resp = await client.request({
        method: method as Dispatcher.HttpMethod,
        // Full URL as path — standard HTTP proxy protocol
        path: url,
        headers: proxyHeaders,
        body: body ?? undefined,
        signal: requestSignal(options),
      });

      // Convert undici response to a Response-like object that matches
      // what fetch() returns, so the rest of AdtHttpClient works unchanged.
      const responseBody = await resp.body.text();
      const responseHeaders = new Headers();
      for (const [key, value] of Object.entries(resp.headers)) {
        if (value !== undefined) {
          const vals = Array.isArray(value) ? value : [String(value)];
          for (const v of vals) {
            responseHeaders.append(key, v);
          }
        }
      }

      // Statuses 204/205/304 are "null body status" per the Fetch spec — the
      // Response constructor throws if given a non-null body (and `.text()`
      // yields '' not null). Pass null so a 304 from a conditional GET (ETag
      // revalidation) survives the proxy path instead of crashing the write
      // (e.g. edit_method's read-before-write through the Cloud Connector).
      // (1xx informational statuses are null-body too, but never surface here:
      // undici's Client doesn't return them as a final status and ADT never emits them.)
      const isNullBodyStatus = resp.statusCode === 204 || resp.statusCode === 205 || resp.statusCode === 304;
      return new Response(isNullBodyStatus ? null : responseBody, {
        status: resp.statusCode,
        headers: responseHeaders,
      });
    } finally {
      await client.close();
    }
  }
}

/** HTTP methods that modify server state and require CSRF token */
function isModifyingMethod(method: string): boolean {
  return ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method.toUpperCase());
}

/**
 * Parse RFC 7231 `Retry-After` header into a delay in milliseconds.
 *
 * Accepts both forms allowed by the spec:
 * - delta-seconds (e.g. `"5"`)
 * - HTTP-date (e.g. `"Wed, 12 May 2026 14:30:00 GMT"`)
 *
 * On missing, NaN, malformed, past-date, or negative input, falls back to `fallbackMs`.
 * Always clamps to `[0, 60_000]` ms so a misbehaving gateway can't stall us indefinitely
 * and a too-small/past value can't degenerate into a hot retry loop.
 *
 * Returns `{ delayMs, source }` — `source: 'header' | 'fallback'` lets audit events
 * record whether the delay came from the server or from our jitter floor (useful for
 * capacity tuning).
 */
export function parseRetryAfter(
  header: string | null | undefined,
  fallbackMs: number,
): { delayMs: number; source: 'header' | 'fallback' } {
  const clamp = (ms: number): number => Math.max(0, Math.min(60_000, ms));
  if (header == null || header === '') {
    return { delayMs: clamp(fallbackMs), source: 'fallback' };
  }
  const trimmed = header.trim();
  // delta-seconds form: integer (and only digits, optionally signed)
  if (/^-?\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    if (Number.isFinite(seconds)) {
      return { delayMs: clamp(seconds * 1000), source: 'header' };
    }
    return { delayMs: clamp(fallbackMs), source: 'fallback' };
  }
  // HTTP-date form
  const epochMs = Date.parse(trimmed);
  if (Number.isFinite(epochMs)) {
    return { delayMs: clamp(epochMs - Date.now()), source: 'header' };
  }
  return { delayMs: clamp(fallbackMs), source: 'fallback' };
}

/**
 * Try to extract an accepted media type from a SAP 406 error response body.
 *
 * SAP sometimes includes the expected media type in error text, e.g.:
 *   "...expected application/vnd.sap.adt.transportorganizertree.v1+xml..."
 * Returns the extracted media type or undefined if none found.
 */
function inferAcceptFromError(body: string): string | undefined {
  const match = body.match(/application\/[\w.+-]+(?:\/[\w.+-]+)?/);
  return match?.[0];
}

/**
 * Distinguish a real SAP logon page from a legitimate HTML response payload.
 *
 * SAP logon pages are full HTML documents that begin with `<!DOCTYPE` / `<html>`
 * or embed a recognizable logon form. Several ADT endpoints (e.g. gateway
 * error log detail at `/sap/bc/adt/gw/errorlog/{type}/{tx}`, dump summaries,
 * dump formatted output) legitimately return HTML *fragments* that start with
 * `<h4>`, `<table>`, `<div>`, etc. — those must not be treated as login
 * redirects.
 */
function looksLikeLoginPage(body: string): boolean {
  if (!body) return false;
  const trimmed = body.trimStart().slice(0, 2048);
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('<!doctype html') || lower.startsWith('<html')) return true;
  // Classic SAP logon form markers (SICF logon / Fiori logon).
  if (/sap-system-login|logonform|sap-ui-bootstrap|sapsystemlogin|sap-logon/i.test(trimmed)) return true;
  return false;
}
