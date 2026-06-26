# Compact Mode (HandlerAction Router)

> **Priority**: Low
> **Source**: fr0ster v2.5.0 — commits 740f75b, 135ad35, a6638d3, d8370d5 (2026-02-20 to 2026-02-21)
> **ARC-1 component**: `src/handlers/tools.ts`, `src/handlers/hyperfocused.ts`

## What fr0ster did

Added a "compact" tier with 22 tools unified by `object_type` parameter:
- `HandlerCreate`, `HandlerGet`, `HandlerUpdate`, `HandlerDelete`
- `HandlerActivate`, `HandlerLock`, `HandlerUnlock`, `HandlerValidate`
- `HandlerCheckRun`, `HandlerTransportCreate`
- `HandlerUnitTestRun/Status/Result`
- etc.

This reduces their 287 tools to 22 by using `object_type` as a discriminator (e.g., `HandlerGet { object_type: "CLAS", name: "ZCL_FOO" }`).

## ARC-1 current state

ARC-1 already has two modes:
1. **Standard** (default): 11 intent-based tools (SAPRead, SAPWrite, etc.)
2. **Hyperfocused**: 1 universal SAP tool (~200 tokens)

## Assessment

fr0ster's compact mode (22 tools) sits between ARC-1's standard (11) and their own read-only tier (52). It's a reasonable middle ground for their architecture.

But ARC-1's intent-based routing is already more compact AND more semantic. SAPRead handles all read operations with `type` as a parameter — same concept, better execution. And hyperfocused mode goes even further with 1 tool.

## Decision

**Skip** — ARC-1's existing architecture (11 intent + 1 hyperfocused) is already better than fr0ster's compact mode. No action needed.
