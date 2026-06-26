# Issue #30: Stateful Session Mode Requirements

> **Priority**: Medium
> **Source**: abap-adt-api issue #30 (closed, 2023-09-21)
> **ARC-1 component**: `src/adt/http.ts`

## Issue description

"This operation can only be performed in stateful mode" — some ADT operations (like lock + edit + activate sequences) require a stateful HTTP session. The abap-adt-api library manages this with `client.stateful = "stateful"` which sends `X-sap-adt-sessiontype: stateful` header.

## ARC-1 current state

- ARC-1's `src/adt/http.ts` creates HTTP sessions with axios cookie jar
- Sessions are implicitly stateful via cookies (CSRF token + session cookies maintained)
- No explicit `X-sap-adt-sessiontype` header management
- Lock/edit/activate operations work because cookies maintain session state

## Assessment

ARC-1 may work correctly due to cookie-based session management, but some ADT endpoints explicitly require the stateful session header. If a user reports "operation can only be performed in stateful mode", the fix would be adding the `X-sap-adt-sessiontype: stateful` header.

Worth noting that abap-adt-api distinguishes between:
- `stateless` — no session, each request independent
- `stateful` — server maintains session state across requests
- `keepAlive` — stateful with periodic keepalive pings

## Decision

**Verify** — Test ARC-1's write operations on systems that enforce stateful sessions. If issues arise, add `X-sap-adt-sessiontype: stateful` header to write operations in http.ts.

**Effort**: XS (single header addition if needed)
