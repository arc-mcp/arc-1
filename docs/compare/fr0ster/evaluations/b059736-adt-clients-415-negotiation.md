# adt-clients 3.12.0: 415 Content-Type Negotiation with Auto-Retry

> **Priority**: Low (ARC-1 already has equivalent functionality)
> **Source**: fr0ster commit b059736 (2026-03-26) — updates @mcp-abap-adt/adt-clients to 3.12.0
> **Related**: Issues #22, #23, #25; adt-clients commits in fr0ster/mcp-abap-adt-clients repo
> **ARC-1 component**: `src/adt/http.ts` (lines 324-398)

## What fr0ster did

Updated the `@mcp-abap-adt/adt-clients` dependency to v3.12.0, which adds:

1. **415 Content-Type auto-retry**: When SAP returns HTTP 415 (Unsupported Media Type), the library automatically retries with a corrected Content-Type header. This mirrors the existing 406 (Not Acceptable) retry for Accept headers.

2. **Per-endpoint header caching**: After a successful retry, the correct Content-Type and Accept headers are cached per ADT endpoint path. Subsequent requests to the same endpoint use the cached headers, avoiding the retry round-trip.

3. **Enabled by default**: `enableAcceptCorrection: true` is the default. Can be disabled with `enableAcceptCorrection: false` or `ADT_ACCEPT_CORRECTION=false`.

### The problem this solves

Different SAP system versions (S/4HANA Cloud, on-prem ECC, various patch levels) require different media types for the same ADT endpoint:

- `/sap/bc/adt/cts/transportrequests` — some systems want `application/atom+xml`, others want `application/xml`
- `/sap/bc/adt/checkruns` — Content-Type varies by system version
- `/sap/bc/adt/programs/programs/.../source/main` — most accept `text/plain` but some require `application/xml`

Hardcoding headers fails when connecting to heterogeneous SAP landscapes.

### Implementation pattern (adt-clients 3.12.0)

From the adt-clients v3.12.0 changelog:

Two commits in the adt-clients repo:
1. `feat: add Content-Type extraction for 415 negotiation` — parses SAP 415 error body to extract expected Content-Type
2. `feat: handle 415 Unsupported Media Type with Content-Type retry and caching` — retry logic + per-endpoint cache

The pattern:
```
Request → 415 → Extract expected Content-Type from error body → Retry with corrected header → Cache for endpoint
Request → 406 → Extract expected Accept from error body → Retry with corrected header → Cache for endpoint
```

## ARC-1 current state

ARC-1 already implements 406/415 auto-retry in `src/adt/http.ts:324-398`:

```typescript
// Handle 406/415 content negotiation failure — retry once with fallback headers
if ((response.status === 406 || response.status === 415) && !negotiationRetried) {
  negotiationRetried = true;
  const fallbackHeaders = { ...headers };

  if (response.status === 406) {
    // 3-step fallback: infer from error body → application/xml → */*
    const inferred = inferAcceptFromError(responseBody);
    if (inferred && inferred !== fallbackHeaders.Accept) {
      fallbackHeaders.Accept = inferred;
    } else if (fallbackHeaders.Accept !== 'application/xml') {
      fallbackHeaders.Accept = 'application/xml';
    } else {
      fallbackHeaders.Accept = '*/*';
    }
  } else {
    // 415: try application/xml as Content-Type fallback
    if (contentType && contentType !== 'application/xml') {
      fallbackHeaders['Content-Type'] = 'application/xml';
    }
  }

  // Retry with fallback headers (one retry max)
  const retryResp = await this.doFetch(url, method, fallbackHeaders, body);
  // ... audit logging ...
  return retryResult;
}
```

### Differences

| Aspect | fr0ster (adt-clients 3.12.0) | ARC-1 (http.ts) |
|--------|------------------------------|-----------------|
| 406 retry | Yes | Yes |
| 415 retry | Yes | Yes |
| Error body parsing | Yes (extract expected type) | Yes (`inferAcceptFromError()`) |
| Per-endpoint caching | Yes | No |
| Retry limit | 1 per request | 1 per request |
| Configurable | Yes (`enableAcceptCorrection`) | Always on |
| Audit logging | Unknown | Yes (warn on failure, info on retry success) |

### Gap: Per-endpoint caching

The only thing ARC-1 lacks is per-endpoint header caching. In fr0ster's implementation, once a retry succeeds for a specific endpoint path, future requests immediately use the correct headers. In ARC-1, every first request to a finicky endpoint will trigger one failed request + one retry.

**Impact**: ~50-100ms extra latency per unique endpoint path, per session. In practice this affects maybe 3-5 endpoints (transports, checkruns, some DDIC endpoints) and only on the first call to each.

**Implementation sketch** (if ever needed):
```typescript
// Add to AdtHttpClient class
private negotiatedHeaders = new Map<string, { accept?: string; contentType?: string }>();

// In request method, before making request:
const cached = this.negotiatedHeaders.get(path);
if (cached?.accept && !headers.Accept) headers.Accept = cached.accept;
if (cached?.contentType && !headers['Content-Type']) headers['Content-Type'] = cached.contentType;

// After successful retry:
this.negotiatedHeaders.set(path, {
  accept: fallbackHeaders.Accept !== headers.Accept ? fallbackHeaders.Accept : undefined,
  contentType: fallbackHeaders['Content-Type'] !== headers['Content-Type'] ? fallbackHeaders['Content-Type'] : undefined,
});
```

## Decision

**No action needed.** ARC-1's implementation is functionally equivalent and architecturally cleaner (centralized in http.ts vs spread across a separate library). Per-endpoint caching is a P3 optimization — add only if latency on heterogeneous SAP landscapes becomes a reported issue.
