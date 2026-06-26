# Issue #11: Not Able to Create or Update (Transport Required)

> **Priority**: Low
> **Source**: fr0ster issue #11 (closed, 2026-02-26)
> **ARC-1 component**: `src/server/elicit.ts`, `src/adt/crud.ts`

## Issue description

User could read objects but couldn't create or update. Root cause: the SAP system required a transport request for write operations, but the user didn't provide one. The error message wasn't clear about what was missing.

## ARC-1 current state

ARC-1 handles this in two ways:
1. **MCP elicitation** (`src/server/elicit.ts`): For destructive operations, ARC-1 can prompt the user for missing information (like transport request) via `confirmDestructive()` and `promptString()`.
2. **Error messages**: `AdtApiError` surfaces SAP's error response which typically includes "A transport request is required".

This is actually a **validation of ARC-1's approach** — MCP elicitation solves exactly this UX problem.

## Assessment

No action needed. ARC-1's elicitation system is specifically designed to handle the "missing transport" scenario. fr0ster doesn't have MCP elicitation and relies on the user knowing to provide the transport upfront.

## Decision

**No action needed** — ARC-1's MCP elicitation already solves this. Good validation of the feature.
