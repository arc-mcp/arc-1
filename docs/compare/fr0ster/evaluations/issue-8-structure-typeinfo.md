# Issue #8: GetTypeInfo Does Not Return Data for Structures

> **Priority**: Low
> **Source**: fr0ster issue #8 (closed, 2026-01-30)
> **ARC-1 component**: `src/adt/client.ts`

## Issue description

fr0ster's `GetTypeInfo` tool returned empty results for DDIC structures. Fix: added a fallback to try the structure-specific ADT endpoint when the generic type info endpoint returns 404 or empty.

## ARC-1 current state

ARC-1 has dedicated `getStructure(name)` method in `src/adt/client.ts` that returns structured metadata (CDS-like source definition). The SAPRead handler routes `type: "STRU"` directly to this method.

ARC-1 doesn't have a generic "type info" endpoint that could miss structures — each type has its own dedicated handler.

## Assessment

ARC-1's per-type routing avoids this class of bug. When a user asks for a structure, it goes directly to the structure endpoint, not through a generic dispatcher that might miss it.

## Decision

**No action needed** — ARC-1's intent-based routing with per-type handlers prevents this issue by design.
