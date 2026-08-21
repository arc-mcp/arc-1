/**
 * Audit event types for ARC-1.
 *
 * Every structured log entry is one of these typed events.
 * They are written to all registered sinks (stderr, file, BTP audit log).
 *
 * requestId correlates all events within a single MCP tool call,
 * including nested HTTP requests and auth events.
 */

import type { LogLevel } from './logger.js';

/** Base shape for all audit events */
export interface AuditEventBase {
  timestamp: string;
  level: LogLevel;
  event: string;
  requestId?: string;
  user?: string;
  clientId?: string;
  /** Multi-destination mode: the BTP destination the request was bound to. */
  destination?: string;
  /** Public immutable SID/client identifier for a multi-target request. */
  target?: string;
  /** Effective SAP identity mode for a selected multi-target request. */
  identity?: 'per-user' | 'shared';
  /**
   * Calling MCP client/agent — `clientInfo` name/version on stdio, HTTP `User-Agent` otherwise.
   * Complements `clientId` (the registered OAuth client): which software acted, not just which
   * registration it acted under. Caller-controlled, so treat as a hint, not an authorization input.
   */
  clientAgent?: string;
  /** Inbound W3C `traceparent`, when the caller supplied a valid one. */
  traceparent?: string;
}

/** MCP tool call started */
export interface ToolCallStartEvent extends AuditEventBase {
  event: 'tool_call_start';
  tool: string;
  /** Contributing plugin name when `tool` is a plugin-sourced `Custom_*` tool (FEAT-61). */
  pluginName?: string;
  args: Record<string, unknown>;
}

/** MCP tool call completed (success or error) */
export interface ToolCallEndEvent extends AuditEventBase {
  event: 'tool_call_end';
  tool: string;
  /** Contributing plugin name when `tool` is a plugin-sourced `Custom_*` tool (FEAT-61). */
  pluginName?: string;
  durationMs: number;
  status: 'success' | 'error';
  errorClass?: string;
  errorMessage?: string;
  resultSize?: number;
  /** Sanitized and truncated response preview (for debugging in server logs). */
  resultPreview?: string;
}

/** HTTP request to SAP ADT */
export interface HttpRequestEvent extends AuditEventBase {
  event: 'http_request';
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  errorBody?: string;
  /** Request body captured when ARC1_LOG_HTTP_DEBUG=true; redacted before sink writes. */
  requestBody?: string;
  /** Request headers with sensitive values redacted when ARC1_LOG_HTTP_DEBUG=true. */
  requestHeaders?: Record<string, string>;
  /** Response body captured when ARC1_LOG_HTTP_DEBUG=true; redacted before sink writes. */
  responseBody?: string;
  /** Response headers with sensitive values redacted when ARC1_LOG_HTTP_DEBUG=true. */
  responseHeaders?: Record<string, string>;
}

/** CSRF token fetch */
export interface HttpCsrfFetchEvent extends AuditEventBase {
  event: 'http_csrf_fetch';
  durationMs: number;
  success: boolean;
}

/** Auth scope denied */
export interface AuthScopeDeniedEvent extends AuditEventBase {
  event: 'auth_scope_denied';
  tool: string;
  requiredScope: string;
  availableScopes: string[];
}

/** Per-user ADT client created via principal propagation */
export interface AuthPPCreatedEvent extends AuditEventBase {
  event: 'auth_pp_created';
  success: boolean;
  errorMessage?: string;
}

/** Shared technical-user authentication succeeded after the Basic canary. */
export interface AuthSharedCreatedEvent extends AuditEventBase {
  event: 'auth_shared_created';
  tool: string;
  identity: 'shared';
}

/** Failure at a security-relevant multi-target stage. Successful calls use the normal terminal event only. */
export interface MultiTargetStageFailedEvent extends AuditEventBase {
  event:
    | 'target_resolution_failed'
    | 'pp_exchange_failed'
    | 'shared_auth_failed'
    | 'cloud_connector_access_denied'
    | 'sap_service_unavailable'
    | 'sap_authentication_failed'
    | 'sap_authorization_failed'
    | 'target_policy_denied';
  tool: string;
  errorCode: string;
}

/** Safety system blocked an operation */
export interface SafetyBlockedEvent extends AuditEventBase {
  event: 'safety_blocked';
  operation: string;
  reason: string;
}

/** Server started */
export interface ServerStartEvent extends AuditEventBase {
  event: 'server_start';
  version: string;
  transport: string;
  allowWrites: boolean;
  url: string;
  pid?: number;
}

/** Two-phase activation preaudit handshake completed.
 *
 *  ADT's activation endpoint sometimes responds to `preauditRequested=true` with an
 *  <ioc:inactiveObjects> prompt listing related objects that must be included; the client
 *  re-POSTs them with `preauditRequested=false` to commit. This event marks that the
 *  handshake fired (so audit consumers can correlate the two http_request events as one
 *  logical operation) and records its outcome. */
export interface ActivationPreauditEvent extends AuditEventBase {
  event: 'activation_preaudit_completed';
  objectLabel: string;
  refCount: number;
  phase1DurationMs: number;
  phase2DurationMs: number;
  outcome: 'success' | 'error';
}

/** OAuth Dynamic Client Registration: a new client_id was minted via /register. */
export interface OAuthClientRegisteredEvent extends AuditEventBase {
  event: 'oauth_client_registered';
  /** Issued client_id (the full signed token). */
  registeredClientId: string;
  clientName?: string;
  redirectUriCount: number;
  /** Length of the issued client_id, for tracking URL-budget regressions. */
  idBytes: number;
}

/** OAuth DCR: getClient was called with an unrecognised, malformed, or
 *  forged-signature client_id. Useful for detecting probing/replay attempts. */
export interface OAuthClientLookupFailedEvent extends AuditEventBase {
  event: 'oauth_client_lookup_failed';
  /** The client_id that failed lookup. May be attacker-controlled — treat as untrusted. */
  registeredClientId: string;
  reason: 'unknown_prefix' | 'malformed' | 'bad_signature' | 'invalid_payload' | 'expired';
}

/** OAuth DCR: a redirect_uri was dynamically appended to the pre-registered XSUAA
 *  default client at /authorize time. The URI passed ARC-1's redirect-uri
 *  allowlist (mirrors xs-security.json — what XSUAA itself would have validated;
 *  in the issue-#214 callback-proxy flow XSUAA no longer sees the client's
 *  redirect_uri, so ARC-1 is the validator). This records the widening so the
 *  change is auditable. */
export interface OAuthRedirectUriRegisteredEvent extends AuditEventBase {
  event: 'oauth_redirect_uri_registered';
  registeredClientId: string;
  redirectUri: string;
}

/** OAuth DCR: a dynamic redirect_uri was REJECTED for the pre-registered XSUAA
 *  default client because it matched no entry in ARC-1's redirect-uri allowlist
 *  (mirrors xs-security.json). Because the issue-#214 callback proxy removed
 *  XSUAA from the client-redirect path, this allowlist is the control that
 *  prevents authorization-code interception via an attacker-supplied
 *  redirect_uri; a hit here is a blocked attempt and worth alerting on. */
export interface OAuthRedirectUriRejectedEvent extends AuditEventBase {
  event: 'oauth_redirect_uri_rejected';
  registeredClientId: string;
  /** The rejected redirect_uri. May be attacker-controlled — treat as untrusted. */
  redirectUri: string;
}

/** CIMD (SEP-991): an HTTPS-URL `client_id` was resolved to a client record — either
 *  freshly fetched and validated, or served from this instance's bounded cache. The
 *  `/authorize` and `/oauth/callback` checks both resolve, so a completed authorization
 *  normally produces two of these, the second with `cacheHit: true`. */
export interface OAuthCimdResolvedEvent extends AuditEventBase {
  event: 'oauth_cimd_resolved';
  /** The Client Identifier URL. Caller-supplied — treat as untrusted. */
  clientIdUrl: string;
  redirectUriCount: number;
  cacheHit: boolean;
}

/** CIMD: an HTTPS-URL `client_id` was refused. `reason` comes from the auth package's
 *  closed vocabulary — URL shape, the SSRF address/host gates, transport failures, proxy
 *  failures, or document-validation failures — plus `cimd_disabled` when a URL client_id
 *  arrives while the feature is off.
 *
 *  `blocked_address` and `host_not_allowed` are the alertable ones: they mean someone
 *  aimed this server at something it refused to reach. The reason never reaches the OAuth
 *  client; it exists for the operator. */
export interface OAuthCimdRejectedEvent extends AuditEventBase {
  event: 'oauth_cimd_rejected';
  /** The Client Identifier URL. Caller-supplied — treat as untrusted. */
  clientIdUrl: string;
  reason: string;
  cacheHit: boolean;
}

/** A browser request was rejected by CORS because its `Origin` header is not in
 *  `ARC1_ALLOWED_ORIGINS`. Emitted at most once per request — preflight rejections
 *  also fire this. The browser itself drops the response, so this event is the
 *  only server-side signal that something tried to call /mcp from a foreign origin. */
export interface CorsRejectedEvent extends AuditEventBase {
  event: 'cors_rejected';
  /** Origin header sent by the browser. May be attacker-controlled — treat as untrusted. */
  origin: string;
  /** HTTP method on the rejected request (OPTIONS for preflight, POST/GET/DELETE for actual). */
  method: string;
  /** Request path, e.g. `/mcp`, `/register`, `/authorize`. */
  path: string;
}

/** Layer 1: a per-IP HTTP-edge rate limit fired. Either OAuth (`/register`, `/authorize`,
 *  `/token`, `/revoke`) or `/mcp` (pre-bearer-auth probing). Returned a 429 with
 *  `Retry-After` and RFC 9331 `RateLimit-*` headers. See docs_page/rate-limiting.md. */
export interface AuthRateLimitedEvent extends AuditEventBase {
  event: 'auth_rate_limited';
  /** Endpoint that triggered — '/register' | '/authorize' | '/token' | '/revoke' | '/mcp'. */
  endpoint: string;
  /** Client IP after `trust proxy 1` resolution. May be attacker-controlled. */
  ip: string;
  /** Configured per-minute cap for this endpoint at the time of denial. */
  limitPerMinute: number;
}

/** Layer 2: a per-user MCP tool-call rate limit fired. Returned an MCP tool error with
 *  `retryAfter` (not HTTP 429), so the LLM client surfaces it as a tool failure and
 *  the agent loop backs off. See docs_page/rate-limiting.md. */
export interface McpRateLimitedEvent extends AuditEventBase {
  event: 'mcp_rate_limited';
  /** Resolved user key: `authInfo.userName ?? clientId ?? '__anon__'`. */
  user: string;
  /** MCP tool that was denied (e.g. 'SAPRead', 'SAPWrite'). */
  tool: string;
  /** Configured per-user per-minute cap at the time of denial. */
  limitPerMinute: number;
  /** Milliseconds until the bucket refills enough for the next call. */
  retryAfterMs: number;
}

/** Discriminated union of all audit events */
export type AuditEvent =
  | ToolCallStartEvent
  | ToolCallEndEvent
  | HttpRequestEvent
  | HttpCsrfFetchEvent
  | AuthScopeDeniedEvent
  | AuthPPCreatedEvent
  | AuthSharedCreatedEvent
  | MultiTargetStageFailedEvent
  | SafetyBlockedEvent
  | ServerStartEvent
  | ActivationPreauditEvent
  | OAuthClientRegisteredEvent
  | OAuthClientLookupFailedEvent
  | OAuthRedirectUriRegisteredEvent
  | OAuthRedirectUriRejectedEvent
  | OAuthCimdResolvedEvent
  | OAuthCimdRejectedEvent
  | CorsRejectedEvent
  | AuthRateLimitedEvent
  | McpRateLimitedEvent;

const SENSITIVE_KEY_FRAGMENTS = [
  'password',
  'passwd',
  'passphrase',
  'pwd',
  'token',
  'secret',
  'cookie',
  'session',
  'sessionid',
  'jsessionid',
  'sapsessionid',
  'authorization',
  'csrf',
  'apikey',
  'authpwd',
  'authuser',
  'authtoken',
  'remotepassword',
  'credential',
  'accesskey',
  'privatekey',
  'sshkey',
  'signature',
];
const KNOWN_SENSITIVE_FIELD_KEYS = new Set([
  'password',
  'passwd',
  'passphrase',
  'pwd',
  'token',
  'secret',
  'cookie',
  'session',
  'sessionid',
  'jsessionid',
  'sap-sessionid',
  'sap_sessionid',
  'authorization',
  'csrf',
  'apikey',
  'api-key',
  'api_key',
  'authpwd',
  'auth-pwd',
  'auth_pwd',
  'authuser',
  'auth-user',
  'auth_user',
  'authtoken',
  'auth-token',
  'auth_token',
  'remotepassword',
  'remote-password',
  'remote_password',
  'credential',
  'accesskey',
  'access-key',
  'access_key',
  'privatekey',
  'private-key',
  'private_key',
  'sshkey',
  'ssh-key',
  'ssh_key',
  'signature',
  'x-csrf-token',
  'x_csrf_token',
  'set-cookie',
  'x-api-key',
  'proxy-authorization',
]);
const KNOWN_SAFE_FIELD_KEYS = new Set(['includesignature']);

const PAYLOAD_BODY_KEYS = new Set(['errorbody', 'errormessage', 'requestbody', 'responsebody', 'resultpreview']);
const REDACTION_LIMIT_MARKER = '[TRUNCATED: redaction budget exceeded]';
const MAX_REDACTION_DEPTH = 16;
const MAX_REDACTION_ENTRIES = 512;
const MAX_AUDIT_STRING_LENGTH = 500;
const AUDIT_STRING_PREFIX_LENGTH = 200;

interface RedactionState {
  remainingEntries: number;
  seen: WeakSet<object>;
}

type RedactionMode = 'audit-event' | 'tool-args';

function normalizeSafeUnicodeEscapes(value: string): string {
  return value.replace(/\\{1,8}u([0-9a-f]{4})/gi, (encoded, hex: string) => {
    const decoded = String.fromCharCode(Number.parseInt(hex, 16));
    return /^[a-z0-9_.-]$/i.test(decoded) ? decoded : encoded;
  });
}

function canonicalKey(key: string): string {
  return normalizeSafeUnicodeEscapes(key)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function isSensitiveKey(key: string): boolean {
  const normalized = canonicalKey(key);
  return (
    !KNOWN_SAFE_FIELD_KEYS.has(normalized) && SENSITIVE_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment))
  );
}

function isUrlKey(key: string): boolean {
  const normalized = canonicalKey(key);
  return ['url', 'urls', 'uri', 'uris', 'href', 'hrefs'].some(
    (suffix) => normalized === suffix || normalized.endsWith(suffix),
  );
}

function isSensitiveUrlQueryKey(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    isSensitiveKey(key) ||
    ['auth', 'credential', 'access_key', 'accesskey', 'signature'].some((fragment) => lower.includes(fragment))
  );
}

function redactCredentialAssignments(value: string): string {
  return value
    .replace(
      /\bauthorization\s*([:=])\s*(?:bearer|basic)\s+(?:\\{1,64}"[^"]*\\{1,64}"|\\{1,64}'[^']*\\{1,64}'|"[^"]*"|'[^']*'|[^\s,;&<>"']+)/gi,
      'authorization$1[REDACTED]',
    )
    .replace(
      /\b(bearer|basic)\s+(?:\\{1,64}"[^"]*\\{1,64}"|\\{1,64}'[^']*\\{1,64}'|"[^"]*"|'[^']*'|[^\s,;&<>"']+)/gi,
      '$1 [REDACTED]',
    )
    .replace(
      /\b(password|passwd|passphrase|pwd|token|secret|api[_-]?key|authorization|credential|access[_-]?key|private[_-]?key|ssh[_-]?key|signature|cookie|jsessionid|sap[_-]?sessionid|sessionid|session|(?:client[_-]?vcs[_-]?)?auth[_-]?(?:pwd|user|token)|remote[_-]?(?:password|user|token))(?:(?:\\{1,64})?["'])?\s*([:=])\s*(?:(?:bearer|basic)\s+)?(?:\\{1,64}"[^"]*\\{1,64}"|\\{1,64}'[^']*\\{1,64}'|"[^"]*"|'[^']*'|[^\s,;&<>"']+)/gi,
      '$1$2[REDACTED]',
    );
}

function normalizeEscapedUrlSlashes(value: string): string {
  return normalizeSafeUnicodeEscapes(value.replace(/\\{1,8}\//g, '/'));
}

/** Redact query-style assignments in a query string or URL fragment, including encoded keys. */
function sanitizeUrlAssignments(value: string): string {
  return redactCredentialAssignments(value).replace(
    /(^|[&;])([^=&;]+)(?:=([^&;]*))?/g,
    (part, separator: string, rawKey: string) => {
      let decodedKey = rawKey;
      try {
        decodedKey = decodeURIComponent(rawKey.replace(/\+/g, ' '));
      } catch {
        // Keep the raw key for the sensitivity check.
      }
      return isSensitiveUrlQueryKey(decodedKey) ? `${separator}[REDACTED]=[REDACTED]` : part;
    },
  );
}

function sanitizeUrl(value: string): string {
  const normalizedValue = normalizeEscapedUrlSlashes(value);
  try {
    const parsed = new URL(normalizedValue);
    let changed = parsed.username.length > 0 || parsed.password.length > 0;
    if (changed) {
      parsed.username = '';
      parsed.password = '';
    }
    const sanitizedPath = redactCredentialAssignments(parsed.pathname);
    if (sanitizedPath !== parsed.pathname) {
      parsed.pathname = sanitizedPath;
      changed = true;
    }
    if (parsed.search) {
      const sanitizedSearch = sanitizeUrlAssignments(parsed.search.slice(1));
      if (sanitizedSearch !== parsed.search.slice(1)) {
        parsed.search = `?${sanitizedSearch}`;
        changed = true;
      }
    }
    if (parsed.hash) {
      const sanitizedHash = sanitizeUrlAssignments(parsed.hash.slice(1));
      if (sanitizedHash !== parsed.hash.slice(1)) {
        parsed.hash = `#${sanitizedHash}`;
        changed = true;
      }
    }
    return changed ? parsed.toString() : normalizedValue;
  } catch {
    // Invalid URLs are rejected later by the handler, but audit runs before validation. Apply a
    // best-effort textual scrub so malformed userinfo/query secrets cannot escape first.
    const withoutUserinfo = normalizedValue.replace(/^([a-z][a-z\d+.-]*:\/\/)[^/@\s]+@/i, '$1[REDACTED]@');
    const fragmentStart = withoutUserinfo.indexOf('#');
    const beforeFragment = fragmentStart >= 0 ? withoutUserinfo.slice(0, fragmentStart) : withoutUserinfo;
    const fragment = fragmentStart >= 0 ? withoutUserinfo.slice(fragmentStart + 1) : undefined;
    const queryStart = beforeFragment.indexOf('?');
    const path = queryStart >= 0 ? beforeFragment.slice(0, queryStart) : beforeFragment;
    const query = queryStart >= 0 ? beforeFragment.slice(queryStart + 1) : undefined;
    return `${redactCredentialAssignments(path)}${query === undefined ? '' : `?${sanitizeUrlAssignments(query)}`}${
      fragment === undefined ? '' : `#${sanitizeUrlAssignments(fragment)}`
    }`;
  }
}

function sanitizeText(value: string): string {
  const normalized = normalizeEscapedUrlSlashes(value);
  return redactCredentialAssignments(normalized).replace(/https?:\/\/[^\s<>"']+/gi, (candidate) => {
    const trailing = candidate.match(/[),.;]+$/)?.[0] ?? '';
    const core = trailing ? candidate.slice(0, -trailing.length) : candidate;
    return `${sanitizeUrl(core)}${trailing}`;
  });
}

function boundAuditString(value: string, originalLength = value.length): string {
  if (value.length <= MAX_AUDIT_STRING_LENGTH && originalLength <= MAX_AUDIT_STRING_LENGTH) return value;
  return `${value.slice(0, AUDIT_STRING_PREFIX_LENGTH)}... [truncated ${originalLength} chars]`;
}

function auditStringInput(value: string): string {
  return value.length <= MAX_AUDIT_STRING_LENGTH ? value : value.slice(0, MAX_AUDIT_STRING_LENGTH);
}

function redactedAuditKey(entryKey: string, target: Record<string, unknown>): string {
  const normalizedEntryKey = normalizeSafeUnicodeEscapes(auditStringInput(entryKey));
  const sensitiveKeyContainsData =
    isSensitiveKey(normalizedEntryKey) && !KNOWN_SENSITIVE_FIELD_KEYS.has(normalizedEntryKey.toLowerCase());
  const sanitized = sensitiveKeyContainsData
    ? '[REDACTED sensitive key]'
    : boundAuditString(sanitizeText(normalizedEntryKey), entryKey.length);
  if (!Object.hasOwn(target, sanitized)) return sanitized;
  let collision = 2;
  while (Object.hasOwn(target, `[REDACTED duplicate key ${collision}]`)) collision += 1;
  return `[REDACTED duplicate key ${collision}]`;
}

function setAuditEntry(target: Record<string, unknown>, entryKey: string, value: unknown): void {
  Object.defineProperty(target, redactedAuditKey(entryKey, target), {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function redactPayloadValue(value: unknown): string {
  if (typeof value === 'string') return `[REDACTED ${value.length} chars]`;
  return '[REDACTED]';
}

function redactValue(key: string, value: unknown, state: RedactionState, depth: number, mode: RedactionMode): unknown {
  if (depth > MAX_REDACTION_DEPTH || state.remainingEntries <= 0) return REDACTION_LIMIT_MARKER;
  state.remainingEntries -= 1;
  if (isSensitiveKey(key)) return '[REDACTED]';
  if (mode === 'audit-event' && PAYLOAD_BODY_KEYS.has(canonicalKey(key))) {
    if (value == null) return value;
    return redactPayloadValue(value);
  }
  if (typeof value === 'string') {
    const boundedInput = auditStringInput(value);
    const sanitized = isUrlKey(key) ? sanitizeUrl(boundedInput) : sanitizeText(boundedInput);
    return boundAuditString(sanitized, value.length);
  }
  if (Array.isArray(value)) {
    if (state.seen.has(value)) return REDACTION_LIMIT_MARKER;
    state.seen.add(value);
    const result: unknown[] = [];
    for (const entry of value) {
      if (state.remainingEntries <= 0) {
        result.push(REDACTION_LIMIT_MARKER);
        break;
      }
      result.push(redactValue(key, entry, state, depth + 1, mode));
    }
    return result;
  }
  if (value && typeof value === 'object') {
    if (state.seen.has(value)) return REDACTION_LIMIT_MARKER;
    state.seen.add(value);
    const result: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
      if (state.remainingEntries <= 0) {
        setAuditEntry(result, '__truncated__', REDACTION_LIMIT_MARKER);
        break;
      }
      setAuditEntry(result, entryKey, redactValue(entryKey, entryValue, state, depth + 1, mode));
    }
    return result;
  }
  return value;
}

/** Redact sensitive or high-volume SAP payload fields before any audit sink sees them. */
export function redactAuditEvent(event: AuditEvent): AuditEvent {
  return redactValue(
    '',
    event,
    { remainingEntries: MAX_REDACTION_ENTRIES, seen: new WeakSet() },
    0,
    'audit-event',
  ) as AuditEvent;
}

/** Sanitize tool call arguments before the pre-dispatch audit event is emitted. */
export function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  return redactValue(
    '',
    args,
    { remainingEntries: MAX_REDACTION_ENTRIES, seen: new WeakSet() },
    0,
    'tool-args',
  ) as Record<string, unknown>;
}
