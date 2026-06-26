# ListTransports Accept Header Negotiation

> **Priority**: Medium (related to Critical #3 — 415 auto-retry)
> **Source**: fr0ster v4.5.1 — commit 3da3311 (2026-03-26)
> **ARC-1 component**: `src/adt/transport.ts`, `src/adt/http.ts`

## What fr0ster did

Rewrote `ListTransports` to use their ADT client (which has `enableAcceptCorrection`) instead of raw HTTP calls. The transport endpoint is particularly finicky about Accept headers on older SAP systems — it requires `application/atom+xml` on some systems and `application/xml` on others.

The commit switches from a hardcoded Accept header to the ADT client's automatic Accept negotiation, which retries with different content types on 415.

## ARC-1 current state

`src/adt/transport.ts` uses `this.http.get()` with the default Accept header from `src/adt/http.ts`. No special Accept negotiation for transports.

## Assessment

This is a **specific instance** of the broader 415 auto-retry issue (covered in `415-content-type-retry.md`). If ARC-1 implements the 415 retry interceptor in `http.ts`, this specific issue is automatically fixed for all endpoints including transports.

No separate implementation needed — the 415 interceptor covers this.

## Decision

**Covered by 415 auto-retry implementation** — No separate action needed. When the 415 retry interceptor is added to `src/adt/http.ts`, transport listing will automatically benefit.
