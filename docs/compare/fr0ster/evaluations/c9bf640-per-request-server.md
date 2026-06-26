# Per-Request Server Functionality in StreamableHttpServer

> **Priority**: Low
> **Source**: fr0ster v2.2.0 — commit c9bf640 (2026-02-09)
> **ARC-1 component**: `src/server/http.ts`

## What fr0ster did

Refactored `StreamableHttpServer` to support per-request server instances. Each incoming HTTP request gets its own MCP server context with isolated state (connection, session, auth). This enables multi-user HTTP deployments where each request may authenticate as a different SAP user.

## ARC-1 current state

ARC-1's HTTP Streamable transport (`src/server/http.ts`) creates a single server instance. Multi-user isolation is handled via principal propagation (`src/adt/btp.ts`) which creates per-user SAP connections through BTP Destination Service, but shares the same MCP server instance.

## Assessment

Per-request server instances provide stronger isolation but at the cost of memory and startup time per request. ARC-1's principal propagation approach is more efficient — shared server, per-user SAP connections.

The only case where per-request servers matter is if MCP server state (beyond SAP connection) needs to be user-isolated. Currently that's not the case for ARC-1.

## Decision

**Skip** — ARC-1's principal propagation provides sufficient user isolation without the overhead of per-request server instances. Not applicable to current architecture.
