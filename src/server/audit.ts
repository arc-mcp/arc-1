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
}

/** MCP tool call started */
export interface ToolCallStartEvent extends AuditEventBase {
  event: 'tool_call_start';
  tool: string;
  args: Record<string, unknown>;
}

/** MCP tool call completed (success or error) */
export interface ToolCallEndEvent extends AuditEventBase {
  event: 'tool_call_end';
  tool: string;
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
  /** Full request body when ARC1_LOG_HTTP_DEBUG=true. Truncated past 65536 chars. */
  requestBody?: string;
  /** Request headers with sensitive values redacted when ARC1_LOG_HTTP_DEBUG=true. */
  requestHeaders?: Record<string, string>;
  /** Full response body when ARC1_LOG_HTTP_DEBUG=true. Truncated past 65536 chars. */
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
  destination: string;
  success: boolean;
  errorMessage?: string;
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

/** Elicitation sent to client */
export interface ElicitationSentEvent extends AuditEventBase {
  event: 'elicitation_sent';
  tool: string;
  message: string;
  fields?: string[];
}

/** Elicitation response from client */
export interface ElicitationResponseEvent extends AuditEventBase {
  event: 'elicitation_response';
  tool: string;
  action: string;
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
 *  default client at /authorize time. XSUAA itself is the authoritative validator
 *  via xs-security.json wildcards; this event records that ARC-1's local SDK-side
 *  list was widened so the change is auditable. */
export interface OAuthRedirectUriRegisteredEvent extends AuditEventBase {
  event: 'oauth_redirect_uri_registered';
  registeredClientId: string;
  redirectUri: string;
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

/** Discriminated union of all audit events */
export type AuditEvent =
  | ToolCallStartEvent
  | ToolCallEndEvent
  | HttpRequestEvent
  | HttpCsrfFetchEvent
  | AuthScopeDeniedEvent
  | AuthPPCreatedEvent
  | SafetyBlockedEvent
  | ServerStartEvent
  | ElicitationSentEvent
  | ElicitationResponseEvent
  | ActivationPreauditEvent
  | OAuthClientRegisteredEvent
  | OAuthClientLookupFailedEvent
  | OAuthRedirectUriRegisteredEvent
  | CorsRejectedEvent;

/** Sanitize tool call arguments — remove values that might contain sensitive data */
export function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = [
    'password',
    'token',
    'secret',
    'cookie',
    'authorization',
    'csrf',
    'apikey',
    'authpwd',
    'authtoken',
    'remotepassword',
  ];
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'string' && value.length > 500) {
      result[key] = `${value.slice(0, 200)}... [truncated ${value.length} chars]`;
    } else {
      result[key] = value;
    }
  }
  return result;
}
