# 401 Auto-Retry After Idle Timeout

> **Priority**: Medium
> **Source**: VSP issue #32/#35, commit d73460a (2026-03-13)
> **ARC-1 component**: `src/adt/http.ts`

## What VSP fixed

After idle periods, SAP sessions expire and return 401 Unauthorized. Previously this bubbled up as an error. Fix: auto-retry the request once after re-authenticating.

Pattern: On 401 response → clear session/CSRF token → re-authenticate → retry original request once.

## ARC-1 current state

`src/adt/http.ts` manages CSRF tokens and sessions. It re-fetches CSRF on 403 (token expiry) but may not handle 401 (session expiry) automatically.

## Assessment

This is a common production issue — SAP sessions expire after 15-30 minutes of inactivity. Without auto-retry, the LLM gets an auth error mid-conversation and the user has to restart.

## Decision

**Verify and implement if needed** — Check if `src/adt/http.ts` handles 401 with auto-retry. If not, add a retry interceptor similar to the CSRF 403 handler: clear session state, re-authenticate, retry once.

**Effort**: 0.5d
