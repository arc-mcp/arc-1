# Streamable HTTP Transport

> **Priority**: High
> **Source**: VSP v2.38.0 — commit daedc99 (2026-04-05)
> **ARC-1 component**: `src/server/http.ts`

## What VSP did
Upgraded from mcp-go v0.17.0 to v0.47.0 and added Streamable HTTP transport alongside existing stdio. VSP now supports both stdio and HTTP transports.

## ARC-1 current state
Already has Streamable HTTP transport since early development (src/server/http.ts) with full auth stack (API keys, OIDC, XSUAA).

## Assessment
VSP closes a major competitive gap. However, ARC-1's HTTP implementation is significantly more mature — it includes API key auth, OIDC JWT, XSUAA OAuth, and principal propagation. VSP's HTTP is likely basic transport without enterprise auth.

## Decision
**No action needed** — ARC-1 already has this with enterprise auth on top. Updates competitive landscape (no longer a unique differentiator).
