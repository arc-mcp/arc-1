/**
 * Request context for ARC-1.
 *
 * Uses AsyncLocalStorage to thread a requestId through the entire
 * call stack (intent handler → ADT client → HTTP client) without
 * changing function signatures. The logger reads from the store
 * automatically to attach requestId to every log entry.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
  user?: string;
  tool?: string;
  /** Legacy multi-destination/internal runtime key. Never expose it as a public target. */
  destination?: string;
  /** Public immutable SID/client target for multi-target calls. */
  target?: string;
  /** Effective SAP identity mode for the selected multi-target call. */
  identity?: 'per-user' | 'shared';
  /** Validated inbound W3C `traceparent`, forwarded verbatim to SAP. See trace-context.ts. */
  traceparent?: string;
  /** Validated inbound W3C `tracestate`; only ever set alongside `traceparent`. */
  tracestate?: string;
  /** Calling MCP client/agent (`clientInfo` on stdio, `User-Agent` on HTTP). Audit-only. */
  clientAgent?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

let requestCounter = 0;

/** Generate a monotonically increasing request ID */
export function generateRequestId(): string {
  return `REQ-${++requestCounter}`;
}

/** Get the current request context (if any) */
export function getCurrentContext(): RequestContext | undefined {
  return requestContext.getStore();
}
