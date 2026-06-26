# Auth Header on Redirects & Stateful Lock Sessions

> **Priority**: Medium
> **Source**: VSP v2.38.1 — commit 27d4d7c (2026-04-07)
> **ARC-1 component**: `src/adt/http.ts`

## What VSP did
Two fixes: (1) Auth headers lost on HTTP redirects — SAP systems sometimes redirect (301/302) and the Go HTTP client strips Authorization header on cross-origin redirects. (2) Stateful lock sessions — ensures lock/modify/unlock uses same session.

## ARC-1 current state
Uses undici fetch in http.ts. undici follows redirects by default but may strip auth headers on cross-origin redirects (Node.js fetch behavior). Stateful sessions are handled via withStatefulSession() which shares cookies/CSRF.

## Assessment
The redirect auth issue is a real risk — verify ARC-1's undici/fetch behavior on redirects. The stateful session fix validates ARC-1's withStatefulSession() pattern.

## Decision
**Verify** — check that ARC-1's undici fetch preserves auth headers on same-origin redirects and that withStatefulSession works correctly.
