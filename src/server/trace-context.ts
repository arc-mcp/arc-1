/**
 * W3C Trace Context ([spec](https://www.w3.org/TR/trace-context/)) pass-through + calling-agent
 * identity, per the SAP Architecture Center guidance for third-party MCP access
 * (https://architecture.learning.sap.com/docs/ref-arch/137800).
 *
 * ARC-1 is a NON-PARTICIPATING system: it runs no tracer and owns no spans, so the spec's rule for
 * pass-through services applies — forward `traceparent`/`tracestate` unchanged, never rewrite
 * `parent-id`, and never mint a trace we don't own (`requestId` already correlates ARC-1's own logs).
 *
 * Everything here validates UNTRUSTED inbound header values before they are re-emitted on an
 * outbound SAP request or written to an audit sink. The charset restrictions are the real control:
 * they make header injection (CR/LF) structurally impossible.
 */

/** `<2 hex version>-<32 hex trace-id>-<16 hex parent-id>-<2 hex flags>`, lowercase, exactly 55 chars. */
const TRACEPARENT = /^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;
/**
 * A version above `00` may append further dash-delimited fields after the 55-char prefix, and the
 * spec requires forwarding them. Version `00` is exactly 55 characters — anything longer is invalid
 * there, so the version check below keeps that strict. The `[0-9a-f-]` remainder is a deliberately
 * narrow superset of the (unspecified) future fields: wide enough to forward, still injection-proof.
 */
const TRACEPARENT_FUTURE = /^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}-[0-9a-f-]+$/;
const ZERO_TRACE_ID = '0'.repeat(32);
const ZERO_PARENT_ID = '0'.repeat(16);

/** Spec cap; a receiver may drop anything larger. */
const TRACESTATE_MAX = 512;
/** Printable ASCII + HTAB (spec-legal optional whitespace) — no CR/LF can reach an outbound header. */
const TRACESTATE_CHARSET = /^[\x20-\x7e\t]+$/;

const CLIENT_AGENT_MAX = 200;

/**
 * Return the header value when it is a valid `traceparent`, else `undefined`.
 *
 * Rejects the spec's forbidden forms: version `ff`, all-zero trace-id, all-zero parent-id, and any
 * uppercase/short/long/garnished value. We do NOT substitute a replacement on failure — a system
 * that doesn't trace has nothing to put there.
 */
export function validateTraceparent(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const [version, traceId, parentId] = value.split('-');
  if (version === 'ff') return undefined;
  // Version 00 is exactly 55 characters; a higher version may carry extra fields we forward blind.
  const shaped = TRACEPARENT.test(value) || (version !== '00' && TRACEPARENT_FUTURE.test(value));
  if (!shaped) return undefined;
  if (traceId === ZERO_TRACE_ID || parentId === ZERO_PARENT_ID) return undefined;
  return value;
}

/**
 * Return the header value when it may accompany a valid `traceparent`, else `undefined`.
 *
 * Per spec, `tracestate` MUST NOT travel without a valid `traceparent`, so callers pass the already
 * validated traceparent. Member-level parsing is deliberately skipped: ARC-1 neither reads nor
 * mutates vendor state, so length + charset are the only checks that matter here.
 */
export function validateTracestate(value: unknown, traceparent: string | undefined): string | undefined {
  if (!traceparent) return undefined;
  if (typeof value !== 'string' || value.length > TRACESTATE_MAX) return undefined;
  return TRACESTATE_CHARSET.test(value) ? value : undefined;
}

/**
 * Normalize a calling-agent label for audit attribution.
 *
 * Sourced from the MCP client's `clientInfo` (stdio) or the HTTP `User-Agent` — both
 * caller-controlled, so strip control characters (log injection) and truncate. Audit-only: this is
 * never sent to SAP.
 */
export function sanitizeClientAgent(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars is the point
  const cleaned = value.replace(/[\x00-\x1f\x7f]/g, ' ').trim();
  if (cleaned.length === 0) return undefined;
  return cleaned.length > CLIENT_AGENT_MAX ? cleaned.slice(0, CLIENT_AGENT_MAX) : cleaned;
}

/** Format an MCP `clientInfo` as `name/version` (version optional). */
export function formatClientInfo(info: { name?: string; version?: string } | undefined): string | undefined {
  const name = sanitizeClientAgent(info?.name);
  if (!name) return undefined;
  const version = sanitizeClientAgent(info?.version);
  return version ? sanitizeClientAgent(`${name}/${version}`) : name;
}

/**
 * Outbound trace headers for one SAP request. Empty when the caller sent no usable trace context —
 * ARC-1 forwards, it does not originate.
 */
export function traceHeaders(ctx: { traceparent?: string; tracestate?: string } | undefined): Record<string, string> {
  if (!ctx?.traceparent) return {};
  return ctx.tracestate
    ? { traceparent: ctx.traceparent, tracestate: ctx.tracestate }
    : { traceparent: ctx.traceparent };
}
