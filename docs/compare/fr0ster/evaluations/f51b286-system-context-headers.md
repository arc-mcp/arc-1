# System Context Headers for HTTP/SSE Transport

> **Priority**: Low
> **Source**: fr0ster v2.7.3 — commit f51b286 (2026-03-03)
> **ARC-1 component**: `src/server/http.ts`

## What fr0ster did

Added support for passing system context (SAP system URL, client, language, auth) via HTTP headers when using HTTP/SSE transport:
- `x-sap-destination` — SAP Destination header
- `x-mcp-destination` — MCP Destination header
- `x-sap-jwt-token` — JWT token
- `x-sap-login` / `x-sap-password` — Basic auth

This enables multi-system support: a single MCP server can route to different SAP systems based on request headers.

## ARC-1 current state

ARC-1's HTTP transport (`src/server/http.ts`) connects to a single SAP system configured at startup. Multi-system support is not implemented. BTP Destination Service (`src/adt/btp.ts`) can route to different systems but is configured per-connection, not per-request.

## Assessment

Multi-system via headers is Medium #22 in the feature matrix. This commit shows one approach: header-based routing. ARC-1's BTP Destination Service is actually more powerful (it uses SAP's Destination Service for credential management), but per-request system selection could complement it.

Not needed now — single-system is the primary use case. Multi-system becomes relevant when ARC-1 is deployed as a shared service.

## Decision

**Defer** — Relevant only for shared/multi-tenant deployment scenarios. When multi-system support is prioritized, study this approach alongside ARC-1's existing BTP Destination Service.
