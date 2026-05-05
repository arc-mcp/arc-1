/**
 * Stateless OAuth Dynamic Client Registration store.
 *
 * MCP clients (Claude Desktop, Cursor, Copilot CLI…) register dynamically
 * via RFC 7591 and cache the returned `client_id` locally. With an
 * in-memory or local-disk store, every CF push / restart wipes the
 * server-side registry — the cached `client_id` then fails with
 * `invalid_client` and the user has to clear their MCP client's OAuth
 * cache to recover.
 *
 * This store eliminates the storage problem entirely. Each `client_id`
 * is a self-validating token: it carries the registration payload
 * (redirect_uris, grant_types, …) plus an HMAC-SHA256 signature derived
 * from a server-held key. `getClient` re-derives the payload by
 * verifying the signature; no persistence is needed. Any process with
 * the same signing key can validate any client_id ever issued.
 *
 * Tradeoffs vs the persisted in-memory store:
 *   + Survives `cf push`, `cf restart`, cell moves, multi-instance scale-out
 *   + No external dependency, no service binding, no native module
 *   - Per-client revocation is impossible (only TTL or full key rotation)
 *   - Rotating the signing key invalidates every outstanding registration
 *
 * The signing key is derived (via HKDF-style HMAC) from the XSUAA
 * `clientsecret`, so it's already as stable as the service binding —
 * service rebinding rotates both at once, which is the right boundary.
 */

import crypto from 'node:crypto';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import { logger } from './logger.js';

// ─── Constants ────────────────────────────────────────────────────────

/** All DCR-issued client_ids start with this prefix. */
const ID_PREFIX = 'arc1-';

/**
 * Domain-separation label bound into the HMAC key derivation. Bumping the
 * suffix ("v1" → "v2") invalidates every previously-issued client_id without
 * requiring a service-binding rotation, which is a useful escape hatch.
 */
const KDF_LABEL = 'arc1-dcr/v1';

/** Schema version of the JSON payload embedded in the signed client_id. */
const PAYLOAD_VERSION = 1;

/**
 * Truncated HMAC-SHA256 length in bytes. 16 bytes = 128 bits, which is well
 * above the practical forgery threshold for opaque IDs (NIST SP 800-107
 * acceptable for non-replayable identifiers).
 */
const SIG_BYTES = 16;

/**
 * Default lifetime of a DCR registration. Tunable via `ttlSeconds` so deployments
 * with stricter compromise-window requirements can shorten it. 30 days matches
 * typical OAuth refresh-token lifetimes — long enough that users don't see
 * spurious "re-authenticate" prompts during normal use.
 */
const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;

// Defaults applied when a registration omits these fields.
const DEFAULT_GRANT_TYPES = ['authorization_code', 'refresh_token'] as const;
const DEFAULT_RESPONSE_TYPES = ['code'] as const;
const DEFAULT_TOKEN_AUTH_METHOD = 'client_secret_post';

/**
 * Built-in redirect_uris for the pre-registered XSUAA client. These cover the
 * common MCP clients out of the box; additional URIs can be added at
 * `/authorize` time via `ensureRedirectUri()`. The list MUST also be registered
 * in `xs-security.json` — XSUAA is the authoritative validator for this client.
 */
const XSUAA_DEFAULT_REDIRECT_URIS = [
  'http://localhost:6274/oauth/callback', // MCP Inspector
  'http://localhost:3000/oauth/callback', // Local dev
  'https://claude.ai/api/mcp/auth_callback', // Claude Desktop
  'cursor://anysphere.cursor-retrieval/oauth/callback', // Cursor
  'vscode://vscode.microsoft-authentication/callback', // VS Code
] as const;

// ─── Payload Schema ───────────────────────────────────────────────────

/**
 * Compact JSON shape stored inside the signed `client_id`.
 *
 * Keys are intentionally short to keep the resulting URL-safe `client_id`
 * under a few hundred bytes — the id is sent in `/authorize` query strings
 * and `client_id` form fields, both of which can be capped by intermediaries.
 */
interface SignedPayload {
  v: number;
  iat: number; // issued-at, seconds since epoch
  ru: string[]; // redirect_uris
  gt?: string[]; // grant_types
  rt?: string[]; // response_types
  am?: string; // token_endpoint_auth_method
  cn?: string; // client_name
}

// ─── Public types ─────────────────────────────────────────────────────

export interface StatelessDcrClientStoreOptions {
  /**
   * How long an issued client_id remains valid, in seconds. After this
   * window `getClient()` returns undefined and clients re-register via
   * `/register`. Default: 30 days. Lower values bound the blast radius if
   * the signing key leaks; higher values reduce re-auth churn.
   */
  ttlSeconds?: number;

  /** Clock injection point for tests. Default: `Date.now`. */
  now?: () => number;
}

// ─── Default XSUAA client ─────────────────────────────────────────────

/**
 * Pre-registered XSUAA client config. MCP clients that hit the XSUAA
 * `clientid` directly (Manual mode in Copilot Studio, etc.) resolve through
 * this entry instead of going through DCR.
 */
function buildXsuaaDefaultClient(clientId: string, clientSecret: string): OAuthClientInformationFull {
  return {
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uris: [...XSUAA_DEFAULT_REDIRECT_URIS],
    grant_types: [...DEFAULT_GRANT_TYPES],
    response_types: [...DEFAULT_RESPONSE_TYPES],
    token_endpoint_auth_method: DEFAULT_TOKEN_AUTH_METHOD,
    client_name: 'ARC-1 XSUAA Default Client',
  };
}

// ─── Store ────────────────────────────────────────────────────────────

export class StatelessDcrClientStore implements OAuthRegisteredClientsStore {
  private readonly xsuaaClient: OAuthClientInformationFull;
  private readonly hmacKey: Buffer;
  private readonly ttlSeconds: number;
  private readonly now: () => number;

  constructor(
    xsuaaClientId: string,
    xsuaaClientSecret: string,
    signingSecret: string,
    options: StatelessDcrClientStoreOptions = {},
  ) {
    if (!signingSecret) {
      throw new Error('StatelessDcrClientStore requires a non-empty signingSecret');
    }
    // Derive a dedicated HMAC key so the raw service-binding secret is never
    // used directly to sign client_ids. The KDF_LABEL doubles as a domain
    // separator (see comment on the constant).
    this.hmacKey = crypto.createHmac('sha256', signingSecret).update(KDF_LABEL).digest();
    this.xsuaaClient = buildXsuaaDefaultClient(xsuaaClientId, xsuaaClientSecret);
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    this.now = options.now ?? (() => Date.now());
  }

  // ── OAuthRegisteredClientsStore implementation ──

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    if (clientId === this.xsuaaClient.client_id) {
      return this.xsuaaClient;
    }

    if (!clientId.startsWith(ID_PREFIX)) {
      this.emitLookupFailed(clientId, 'unknown_prefix');
      return undefined;
    }

    const decoded = this.decodeAndVerify(clientId);
    if (decoded.kind === 'error') {
      this.emitLookupFailed(clientId, decoded.reason);
      return undefined;
    }

    const ageSec = Math.floor(this.now() / 1000) - decoded.payload.iat;
    if (ageSec > this.ttlSeconds) {
      this.emitLookupFailed(clientId, 'expired');
      logger.debug('OAuth client expired (TTL)', { clientId, ageSec, ttlSeconds: this.ttlSeconds });
      return undefined;
    }

    return this.payloadToClientInfo(clientId, decoded.payload);
  }

  async registerClient(
    client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>,
  ): Promise<OAuthClientInformationFull> {
    if (client.redirect_uris) {
      for (const uri of client.redirect_uris) {
        validateRedirectUri(uri);
      }
    }

    const issuedAt = Math.floor(this.now() / 1000);
    const payload: SignedPayload = {
      v: PAYLOAD_VERSION,
      iat: issuedAt,
      ru: client.redirect_uris ?? [],
    };
    if (client.grant_types) payload.gt = client.grant_types;
    if (client.response_types) payload.rt = client.response_types;
    if (client.token_endpoint_auth_method) payload.am = client.token_endpoint_auth_method;
    if (client.client_name) payload.cn = client.client_name;

    const clientId = this.encode(payload);
    const clientSecret = this.deriveSecret(clientId);

    logger.debug('OAuth client registered (stateless)', {
      clientId,
      clientName: client.client_name,
      idBytes: clientId.length,
    });
    logger.emitAudit({
      timestamp: new Date().toISOString(),
      level: 'info',
      event: 'oauth_client_registered',
      registeredClientId: clientId,
      clientName: client.client_name,
      redirectUriCount: payload.ru.length,
      idBytes: clientId.length,
    });

    return {
      ...client,
      client_id: clientId,
      client_secret: clientSecret,
      client_id_issued_at: issuedAt,
    };
  }

  // ── SDK redirect_uri hook ──

  /**
   * Called by the MCP SDK before redirect_uri validation on `/authorize`.
   *
   * For the pre-registered XSUAA client we mutate the in-memory list (XSUAA
   * itself is the authoritative validator via `xs-security.json` wildcards,
   * so the SDK's local list is decorative). The mutation is replayed on
   * every `/authorize`, so it doesn't need to persist.
   *
   * For DCR (`arc1-…`) clients we are stateless by design: there's nothing
   * to mutate. The previous in-memory store implemented a percent-encoding
   * loose-match (BAS/Theia registers `?x=1` then authorizes with `%3Fx=1`).
   * Reproducing that statelessly would require either bundling every
   * encoding variant in the signed payload or keeping a per-process scratch
   * map, both of which undermine the "no state" goal. We accept the
   * regression: affected clients re-register on encoding-variant mismatch,
   * which is exactly what they did under the old store after every restart.
   */
  ensureRedirectUri(clientId: string, uri: string): void {
    if (clientId !== this.xsuaaClient.client_id) return;
    if (this.xsuaaClient.redirect_uris.includes(uri)) return;

    this.xsuaaClient.redirect_uris.push(uri);
    logger.debug('Dynamic redirect_uri registered for XSUAA client', { clientId, uri });
    logger.emitAudit({
      timestamp: new Date().toISOString(),
      level: 'info',
      event: 'oauth_redirect_uri_registered',
      registeredClientId: clientId,
      redirectUri: uri,
    });
  }

  // ── Internals: encode / decode / sign / verify ──

  private payloadToClientInfo(clientId: string, payload: SignedPayload): OAuthClientInformationFull {
    return {
      client_id: clientId,
      client_secret: this.deriveSecret(clientId),
      client_id_issued_at: payload.iat,
      redirect_uris: payload.ru,
      grant_types: payload.gt ?? [...DEFAULT_GRANT_TYPES],
      response_types: payload.rt ?? [...DEFAULT_RESPONSE_TYPES],
      token_endpoint_auth_method: payload.am ?? DEFAULT_TOKEN_AUTH_METHOD,
      client_name: payload.cn,
    };
  }

  private encode(payload: SignedPayload): string {
    const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sig = this.sign(payloadB64);
    return `${ID_PREFIX}${payloadB64}.${sig}`;
  }

  /**
   * Decode and verify a `client_id`. Returns either the parsed payload or a
   * structured failure reason — the caller emits the failure as an audit
   * event with the right reason code (so probing attempts are observable).
   */
  private decodeAndVerify(
    clientId: string,
  ):
    | { kind: 'ok'; payload: SignedPayload }
    | { kind: 'error'; reason: 'malformed' | 'bad_signature' | 'invalid_payload' } {
    const stripped = clientId.slice(ID_PREFIX.length);
    const dot = stripped.lastIndexOf('.');
    if (dot < 0) return { kind: 'error', reason: 'malformed' };

    const payloadB64 = stripped.slice(0, dot);
    const sigB64 = stripped.slice(dot + 1);

    if (!this.verifySignature(payloadB64, sigB64)) {
      return { kind: 'error', reason: 'bad_signature' };
    }

    const payload = parsePayload(payloadB64);
    if (!payload) return { kind: 'error', reason: 'invalid_payload' };

    return { kind: 'ok', payload };
  }

  private verifySignature(payloadB64: string, sigB64: string): boolean {
    const expected = Buffer.from(this.sign(payloadB64), 'base64url');
    const actual = Buffer.from(sigB64, 'base64url');
    if (actual.length !== expected.length || actual.length !== SIG_BYTES) return false;
    return crypto.timingSafeEqual(actual, expected);
  }

  private sign(payloadB64: string): string {
    const fullDigest = crypto.createHmac('sha256', this.hmacKey).update(payloadB64).digest();
    // Truncate to SIG_BYTES — see the comment on the constant for rationale.
    return fullDigest.subarray(0, SIG_BYTES).toString('base64url');
  }

  /**
   * The client_secret is derived deterministically from the client_id, so
   * any instance with the same signing key can validate it. This is the
   * core reason DCR survives container restarts and scales out horizontally
   * with no shared state.
   */
  private deriveSecret(clientId: string): string {
    return crypto.createHmac('sha256', this.hmacKey).update(`secret:${clientId}`).digest('base64url');
  }

  private emitLookupFailed(
    clientId: string,
    reason: 'unknown_prefix' | 'malformed' | 'bad_signature' | 'invalid_payload' | 'expired',
  ): void {
    logger.debug('OAuth client lookup failed', { clientId, reason });
    logger.emitAudit({
      timestamp: new Date().toISOString(),
      // 'expired' is normal-ish (TTL eviction); the rest are probing/forgery signals.
      level: reason === 'expired' ? 'info' : 'warn',
      event: 'oauth_client_lookup_failed',
      registeredClientId: clientId,
      reason,
    });
  }
}

// ─── Module-level helpers ─────────────────────────────────────────────

/**
 * Parse a base64url-encoded payload back into a typed `SignedPayload`. Returns
 * `undefined` on any failure (decode error, JSON parse error, schema mismatch).
 */
function parsePayload(payloadB64: string): SignedPayload | undefined {
  try {
    const json = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as SignedPayload;
    if (parsed.v !== PAYLOAD_VERSION) return undefined;
    if (typeof parsed.iat !== 'number' || !Array.isArray(parsed.ru)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

/**
 * Validate a redirect URI against the allowed scheme/host policy.
 *
 * Allowed: `https://*`, `http://` to localhost / 127.0.0.1 / [::1], and known
 * MCP-client custom schemes (`claude:`, `cursor:`, `vscode:`,
 * `vscode-insiders:`).
 *
 * Rejected: `javascript:`, `data:`, `file:`, `ftp:`, and any `http://` to
 * non-loopback hosts.
 */
export function validateRedirectUri(uri: string): void {
  const ALLOWED_CUSTOM_SCHEMES = ['claude:', 'cursor:', 'vscode:', 'vscode-insiders:'];
  const BLOCKED_SCHEMES = ['javascript:', 'data:', 'file:', 'ftp:'];

  for (const scheme of BLOCKED_SCHEMES) {
    if (uri.toLowerCase().startsWith(scheme)) {
      throw new Error(
        `Redirect URI rejected: '${scheme}' scheme is not allowed. Use https:// or a registered custom scheme.`,
      );
    }
  }

  for (const scheme of ALLOWED_CUSTOM_SCHEMES) {
    if (uri.toLowerCase().startsWith(scheme)) return;
  }

  try {
    const parsed = new URL(uri);
    if (parsed.protocol === 'https:') return;
    if (parsed.protocol === 'http:') {
      const host = parsed.hostname.toLowerCase();
      if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1') return;
      throw new Error(`Redirect URI rejected: http:// is only allowed for localhost/127.0.0.1. Got: '${uri}'`);
    }
    return;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Redirect URI rejected')) throw err;
    // URL parsing failed for some other reason (unknown protocol etc.) — allow.
  }
}
