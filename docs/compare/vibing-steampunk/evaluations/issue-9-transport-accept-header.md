# Issue #9: Transport API Returns 406 — Wrong Accept Header

> **Priority**: High (same class as fr0ster Critical #3)
> **Source**: VSP issue #9 (closed, 2026-01-14)
> **ARC-1 component**: `src/adt/transport.ts`, `src/adt/http.ts`

## Issue description

Transport CTS endpoints return 406 Not Acceptable when the Accept header doesn't match what the SAP system expects. This is the same class of issue as fr0ster's #22/#23 (415 Content-Type).

Different SAP versions expect different Accept headers for the same endpoint:
- Some want `application/xml`
- Some want `application/atom+xml`
- Some want `application/vnd.sap.adt.transportrequests.v1+xml`

## ARC-1 current state

Same risk as documented in fr0ster's `415-content-type-retry.md`. The 415/406 auto-retry interceptor would fix both cases.

## Decision

**Covered by 415 auto-retry implementation** — See `../fr0ster/evaluations/415-content-type-retry.md`. The retry interceptor should handle both 415 and 406 responses.

**Cross-reference**: fr0ster issues #22, #23, #25 — same root cause.
