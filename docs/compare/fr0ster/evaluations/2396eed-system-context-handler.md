# System Context Integration in Handler Layer

> **Priority**: Low
> **Source**: fr0ster v2.7.0 — commit 2396eed (2026-02-28)
> **ARC-1 component**: `src/handlers/intent.ts`

## What fr0ster did

Integrated `IAdtSystemContext` into the handler layer via a `createAdtClient` factory. Each handler call creates an ADT client with system context (URL, client, language, auth type) instead of using a shared global client.

This enables per-request connection isolation — each tool call can connect to a different SAP system.

## ARC-1 current state

ARC-1 creates a single ADT client at startup (`src/server/server.ts`) and shares it across all handler calls. The client manages sessions, CSRF tokens, and cookies internally. Per-request principal propagation exists for BTP deployments via `src/adt/btp.ts`.

## Assessment

ARC-1's shared client approach is simpler and more efficient (connection reuse, session caching). Per-request client creation adds overhead and complexity. ARC-1's principal propagation already handles the multi-user case for BTP.

This pattern only makes sense if ARC-1 moves to multi-system support.

## Decision

**No action needed** — ARC-1's shared client + principal propagation handles current requirements. Revisit only alongside multi-system support (#22 in matrix).
