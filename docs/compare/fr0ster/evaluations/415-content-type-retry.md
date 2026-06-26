# 415 Content-Type Auto-Retry

> **Priority**: ~~High (Critical #3 in feature matrix)~~ **Resolved**
> **Source**: fr0ster issues #22, #23, #25 — commits 3da3311, 32ab9d4, b059736 (2026-03-26)
> **Status**: ✅ ARC-1 already has 406/415 auto-retry in `src/adt/http.ts:324-398`. See [v4.5.0 deep dive](v4.5.0-release-deep-dive.md).

## The problem

SAP systems (especially older ones) reject requests with wrong `Accept` or `Content-Type` headers, returning HTTP 415.

Examples from fr0ster issues:
- `ListTransports` fails with `ExceptionResourceNotAcceptable` — SAP wants `application/atom+xml` but client sends `application/xml`
- `checkruns` endpoint fails with 415 — Content-Type mismatch

## What fr0ster did

1. **Issue #25**: Enabled `enableAcceptCorrection` on all ADT client instances — this is a setting in their `adt-clients` lib that automatically retries with a corrected Accept header on 415
2. **Issue #23**: Rewrote `ListTransports` to use the ADT client with Accept negotiation instead of raw HTTP calls
3. **Issue #22**: Added Content-Type auto-detection on checkruns + guaranteed unlock (the unlock part ARC-1 already has)

## ARC-1 current state

**Already implemented.** ARC-1 has 406/415 auto-retry in `src/adt/http.ts:324-398` using undici/fetch (not axios):

- **406 fallback**: `inferAcceptFromError()` extracts expected media type from SAP error body → try `application/xml` → try `*/*`
- **415 fallback**: Switch Content-Type to `application/xml`
- **One retry per request** (`negotiationRetried` guard prevents infinite loops)
- **Audit logging** on both the failure and retry success

### Remaining gap: Per-endpoint header caching

fr0ster's adt-clients 3.12.0 caches successful Content-Type per endpoint path. ARC-1 retries per-request. This is a P3 optimization — adds ~50-100ms on first call to each finicky endpoint per session.

## Decision

**Resolved.** ARC-1's implementation is functionally equivalent. Per-endpoint caching is a nice-to-have (P3). See [v4.5.0 deep dive](v4.5.0-release-deep-dive.md) for full comparison.
