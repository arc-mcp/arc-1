# Dynamic Tool Hiding by System Capabilities (available_in)

> **Priority**: Medium
> **Source**: fr0ster v4.0.0-v4.1.0 — commits 72d828e, 170a873, bc97793, ea0998a, c0ae41d (2026-03-06 to 2026-03-09)
> **ARC-1 component**: `src/adt/features.ts`, `src/handlers/tools.ts`

## What fr0ster did

Added an `available_in` property to all 128+ handlers:
```typescript
available_in: ["cloud", "onprem"]  // or just ["cloud"] or ["onprem"]
```

At startup, detects system type (cloud vs on-premise) and **removes tools from the MCP tool list** that aren't available on the connected system. E.g., CDS unit tests are cloud-only, RFC-based operations are on-prem-only.

5 commits over 4 days to tag all handlers and wire up the filtering.

## ARC-1 current state

`src/adt/features.ts` has feature detection with 6 probes:
```typescript
export type FeatureId = 'cts' | 'atc' | 'unitTest' | 'profiler' | 'debugger' | 'dumps';
```

But this is used at **runtime** (check before calling), not at **registration time** (hide tool). All 11 tools are always visible to the LLM regardless of system capabilities. If a feature isn't available, the error message tells the LLM.

## Assessment

**Pros of dynamic tool hiding**:
- Cleaner LLM experience — no tools that will always fail
- Reduces confusion ("why is this tool here if it doesn't work?")
- Slightly smaller tool schema

**Cons / why ARC-1 is different**:
- ARC-1 has 11 intent-based tools, not 128. The LLM decision surface is already tiny.
- ARC-1 tools are multi-action (SAPDiagnose handles dumps, traces, ATC). Hiding the whole tool because one action isn't available would be wrong.
- Runtime error messages ("Feature X not available on this system") already guide the LLM.
- Feature detection requires a connected SAP system at startup — what if connection fails?

**Better approach for ARC-1**: Instead of hiding tools, enhance the tool descriptions dynamically to include/exclude actions based on detected features. E.g., SAPDiagnose description could say "Available actions: dumps, traces, atc, syntax_check" and omit "debugger" if not detected.

## Decision

**Not applicable to ARC-1's architecture** — With 11 intent-based tools, hiding isn't needed. The runtime error approach works. If anything, dynamic tool descriptions (listing available actions) would be the equivalent improvement, but it's low priority since the current approach works fine.
