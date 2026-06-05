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
 * Default TTL is 30 days (matches typical refresh-token lifetimes). Setting
 * `ttlSeconds` to `0` or a negative value disables expiration — recommended
 * when MCP clients don't auto-re-register on `invalid_client` (Copilot CLI,
 * Cursor) and a finite TTL just produces periodic outages without security
 * gain. In that mode, forced revocation goes through full key rotation
 * (rotate the signing secret or bump `KDF_LABEL` from `arc1-dcr/v1` → `v2`).
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
 * Default lifetime of a DCR registration. 30 days matches typical OAuth
 * refresh-token lifetimes and provides a conservative compromise window.
 * Set `ttlSeconds` to `0` (or any non-positive value) to disable expiration
 * — recommended for environments where MCP clients don't auto-re-register
 * on `invalid_client` (Copilot CLI, Cursor) and a finite TTL produces
 * periodic outages. Forced revocation in that case goes through full key
 * rotation (rotate the signing secret or bump `KDF_LABEL`).
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

/**
 * Redirect-URI allowlist for the pre-registered XSUAA default client — a vendored
 * mirror of `oauth2-configuration.redirect-uris` in `xs-security.json`.
 *
 * ── Why ARC-1 must enforce this (not just XSUAA) ──
 * The issue-#214 callback proxy (see `oauth-state.ts`) sends XSUAA ARC-1's OWN
 * `/oauth/callback` as the redirect_uri and carries the client's real
 * redirect_uri inside the signed state. XSUAA therefore no longer validates the
 * client's redirect_uri — ARC-1 does. Without an allowlist, `ensureRedirectUri`
 * would auto-trust ANY redirect_uri supplied at `/authorize` for the shared
 * default client, letting an attacker steer a victim's authorization code to
 * their own URI (security audit 2026-06, follow-up to PR #352).
 *
 * ── Why vendored, not read from xs-security.json ──
 * `xs-security.json` is consumed by XSUAA at service-creation time and is NOT
 * shipped with the running app (excluded by `.cfignore`, the npm `files`
 * allowlist, and the Dockerfile), and the service binding does not expose the
 * patterns — so ARC-1 cannot read them at runtime. To prevent drift,
 * `tests/unit/server/stateless-client-store.test.ts` asserts this list stays
 * equal to `xs-security.json`. Keep the two in sync when adding a client.
 *
 * Glob semantics (xs-security.json): `*` matches within a single host/path
 * segment (never `/`), `**` matches across segments.
 */
export const XSUAA_REDIRECT_URI_PATTERNS = [
  'http://localhost:*/**',
  'https://*.hana.ondemand.com/**',
  'https://*.applicationstudio.cloud.sap/**',
  'https://claude.ai/api/mcp/auth_callback',
  'https://callback.mistral.ai/v1/integrations_auth/oauth2_callback',
  'cursor://anysphere.cursor-retrieval/**',
  'cursor://anysphere.cursor-mcp/**',
  'vscode://vscode.microsoft-authentication/**',
  'https://global.consent.azure-apim.net/redirect/**',
] as const;

/** Translate one xs-security.json redirect-uri glob into an anchored,
 *  case-insensitive RegExp. `**` → `.*` (crosses `/`); `*` → `[^/]*` (within a
 *  segment); every other character is matched literally. The trailing `/` and
 *  anchoring mean a host-label `*` (e.g. `*.hana.ondemand.com`) cannot be widened
 *  to a different registrable domain. */
function redirectPatternToRegExp(pattern: string): RegExp {
  // Split on the wildcard tokens, keeping them (the capturing group keeps the
  // delimiters in the result array). `**` is tried before `*`, so it tokenizes
  // as a single token.
  const body = pattern
    .split(/(\*\*|\*)/)
    .map((segment) => {
      if (segment === '**') return '.*'; // crosses path separators
      if (segment === '*') return '[^/]*'; // within a single segment (never `/`)
      return segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&'); // escape literal regex metachars
    })
    .join('');
  return new RegExp(`^${body}$`, 'i');
}

const XSUAA_REDIRECT_URI_REGEXPS = XSUAA_REDIRECT_URI_PATTERNS.map(redirectPatternToRegExp);

/**
 * Is `uri` an allowed redirect target for the pre-registered XSUAA default
 * client? True iff it matches an `XSUAA_REDIRECT_URI_PATTERNS` entry. Stateless,
 * so it gives the same answer on every instance — used both to gate dynamic
 * registration (`ensureRedirectUri`) and to validate the redirect target at
 * `/oauth/callback` (`checkRedirectUri`).
 *
 * SECURITY — parse before matching: the value matched here is later re-parsed
 * with `new URL()` and used as the 302 target that carries the OAuth `code`, so
 * the glob decision MUST agree with how the URL actually parses. The patterns
 * are string globs; a `*` sitting in the PORT position (the localhost pattern)
 * would otherwise let a URL-userinfo segment ride inside the same-segment
 * wildcard — `http://localhost:x@evil.com/cb` matches the `localhost:[^slash]`
 * port glob yet `new URL(...).host === 'evil.com'`, steering a victim's code to an
 * attacker host. So we reject anything that doesn't parse, and reject any
 * userinfo (`user[:pass]@`) — that `@` is the only construct that can relocate
 * the authority past a same-segment wildcard, and no legitimate OAuth
 * redirect_uri carries credentials. After this guard, a glob match implies the
 * parsed host is the literal host in the pattern.
 */
export function matchesXsuaaRedirectPattern(uri: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }
  if (parsed.username !== '' || parsed.password !== '') return false;
  return XSUAA_REDIRECT_URI_REGEXPS.some((re) => re.test(uri));
}

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
   * window `getClient()` returns undefined and clients are forced to
   * re-register via `/register`. Default: 30 days. Set to `0` (or any
   * non-positive value) to disable expiration — registrations then stay
   * valid until the signing key rotates.
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
    // Defense-in-depth: warn (don't throw) on weak signing secrets. NIST
    // SP 800-131A r2 sets 112 bits / 14 bytes as the HMAC floor; 128 bits /
    // 16 bytes is the conservative consensus across production OAuth servers
    // (Keycloak documents 14 chars, Okta requires 32 for client_secret_jwt,
    // Hydra accepts 6 silently). ARC-1's legacy default (XSUAA `clientsecret`,
    // typically 40+ chars) clears the bar; the realistic trigger here is a
    // test/dev secret. Use byte length, not char length, so multi-byte UTF-8
    // is measured correctly.
    const secretBytes = Buffer.byteLength(signingSecret, 'utf8');
    if (secretBytes < 16) {
      logger.warn(
        'StatelessDcrClientStore signing secret is shorter than 16 bytes (128 bits) — below the recommended minimum. Use `openssl rand -base64 48` for a secure value.',
        { bytes: secretBytes },
      );
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

    if (this.ttlSeconds > 0) {
      const ageSec = Math.floor(this.now() / 1000) - decoded.payload.iat;
      if (ageSec > this.ttlSeconds) {
        this.emitLookupFailed(clientId, 'expired');
        logger.debug('OAuth client expired (TTL)', { clientId, ageSec, ttlSeconds: this.ttlSeconds });
        return undefined;
      }
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

    // RFC 7591 §3.2.1: `client_secret_expires_at` is REQUIRED when a
    // `client_secret` is issued. Value is the absolute expiry time in
    // seconds since epoch, OR exactly 0 if the secret never expires —
    // exactly the semantic ARC1_OAUTH_DCR_TTL_SECONDS=0 introduces.
    const clientSecretExpiresAt = this.ttlSeconds > 0 ? issuedAt + this.ttlSeconds : 0;

    return {
      ...client,
      client_id: clientId,
      client_secret: clientSecret,
      client_id_issued_at: issuedAt,
      client_secret_expires_at: clientSecretExpiresAt,
    };
  }

  // ── SDK redirect_uri hook ──

  /**
   * Called by the MCP SDK before redirect_uri validation on `/authorize`.
   *
   * For the pre-registered XSUAA client we mutate the in-memory list so the
   * SDK's exact-match check passes. The mutation is replayed on every
   * `/authorize`, so it doesn't need to persist. SECURITY: we register a
   * candidate URI ONLY if it matches `XSUAA_REDIRECT_URI_PATTERNS` (the vendored
   * mirror of xs-security.json). The issue-#214 callback proxy removed XSUAA
   * from the client-redirect path, so an un-gated add here would let an attacker
   * register an arbitrary redirect_uri and have the SDK accept it — the entry
   * point for authorization-code interception (security audit 2026-06). A
   * non-matching URI is dropped (audited); the SDK's exact-match check then
   * rejects the `/authorize` request before any state is minted.
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

    if (!matchesXsuaaRedirectPattern(uri)) {
      logger.warn('Dynamic redirect_uri rejected for XSUAA default client (not in allowlist)', { clientId, uri });
      logger.emitAudit({
        timestamp: new Date().toISOString(),
        level: 'warn',
        event: 'oauth_redirect_uri_rejected',
        registeredClientId: clientId,
        redirectUri: uri,
      });
      return;
    }

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

  /**
   * Validate that `uri` is an allowed redirect target for `clientId` at the
   * `/oauth/callback` proxy — the control that stops authorization-code
   * interception (security audit 2026-06, follow-up to PR #352).
   *
   *  - Default (pre-registered XSUAA) client → must match the redirect-uri
   *    allowlist (`matchesXsuaaRedirectPattern`). Deliberately consults the
   *    static allowlist, NOT the mutable in-memory list, so the verdict is
   *    stateless and identical on every instance — a code is never forwarded to
   *    an unlisted URI even if `/authorize` ran on a different instance.
   *  - DCR (`arc1-…`) client → must be one of the redirect_uris baked immutably
   *    into the signed client_id (re-derived by `getClient`). Returns
   *    `unknown_client` when the id is unrecognised / expired / forged.
   */
  async checkRedirectUri(clientId: string, uri: string): Promise<'ok' | 'unknown_client' | 'unregistered'> {
    if (clientId === this.xsuaaClient.client_id) {
      return matchesXsuaaRedirectPattern(uri) ? 'ok' : 'unregistered';
    }
    const info = await this.getClient(clientId);
    if (!info) return 'unknown_client';
    return info.redirect_uris.includes(uri) ? 'ok' : 'unregistered';
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
