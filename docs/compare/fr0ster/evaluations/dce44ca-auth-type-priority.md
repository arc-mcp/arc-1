# SAP_AUTH_TYPE Priority over SAP_JWT_TOKEN

> **Priority**: Low
> **Source**: fr0ster v4.5.0 — commit dce44ca, issue #24 (2026-03-26)
> **ARC-1 component**: `src/server/config.ts`

## What fr0ster did

Fixed a bug where `SAP_JWT_TOKEN` env var would override `SAP_AUTH_TYPE` setting. If both were set, the JWT token always won regardless of what auth type was configured. Fix: check `SAP_AUTH_TYPE` first, only fall back to JWT detection if not explicitly set.

## ARC-1 current state

ARC-1's config priority is: CLI args > env vars > .env > defaults (in `src/server/config.ts`). Auth is handled via `SAP_USER`/`SAP_PASSWORD` for basic auth, `SAP_BTP_SERVICE_KEY` for BTP OAuth, and `SAP_OIDC_*` for OIDC.

ARC-1 doesn't have `SAP_AUTH_TYPE` or `SAP_JWT_TOKEN` env vars — auth type is inferred from which credentials are provided.

## Assessment

ARC-1's approach of inferring auth type from provided credentials avoids this class of bug entirely. No explicit `SAP_AUTH_TYPE` override means no priority conflict.

## Decision

**No action needed** — ARC-1's config model doesn't have this bug class. The implicit auth detection approach is actually cleaner.
