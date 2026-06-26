# Issue #42: runQuery API Issue

> **Priority**: Medium
> **Source**: abap-adt-api issue #42 (open, 2026-03-26)
> **ARC-1 component**: `src/adt/client.ts` (runQuery)

## Issue description

User reports an issue with the `runQuery` API. Exact details are sparse but the issue is open and recent.

## ARC-1 current state

- ARC-1 has `runQuery()` in client.ts that executes free-form SQL via `/sap/bc/adt/datapreview/freestyle`
- Parameters: `sql`, `maxRows` (default 100), `decode` flag
- Protected by `blockFreeSQL` safety flag

## Assessment

Worth monitoring. If the issue reveals a specific ADT endpoint behavior change in recent SAP versions, ARC-1 may need the same fix.

## Decision

**Monitor** — Check back when the issue gets more detail or is resolved. If it's a parsing issue, verify ARC-1's response handling for the same endpoint.
