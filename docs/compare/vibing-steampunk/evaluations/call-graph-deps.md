# Call Graph + Package Dependency Analysis

> **Priority**: Medium (Low #31 in feature matrix)
> **Source**: VSP v2.32.0 — commits ba83e22, 558a300, 2fdea48 (2026-03-22)
> **ARC-1 component**: `src/adt/client.ts` (new feature)

## What VSP did

Added two new capabilities:

### 1. Call graph analysis (`vsp graph`)
Uses CROSS reference tables (WBCROSSGT with fallback to WBCROSS) to build caller/callee graphs for CLAS, PROG, FUGR, TRAN objects. Available as both MCP tools (GetCallGraph, GetCallersOf, GetCalleesOf, AnalyzeCallGraph, CompareCallGraphs) and CLI command.

### 2. Package dependency analysis (`vsp deps`)
Analyzes package contents and their cross-package dependencies. Checks transport readiness — whether all dependencies are satisfied in the transport.

## ARC-1 current state

- **Call graph**: Not implemented. `src/adt/codeintel.ts` has FindDefinition and FindReferences but no call graph traversal.
- **Dependencies**: `src/context/deps.ts` extracts AST-based dependencies from ABAP source (offline, using abaplint). Different from CROSS table queries (server-side, covers runtime refs).

## Assessment

Call graph is useful for code understanding ("what calls this function?", "what's the impact of changing this class?") but is a low-priority feature (#31 in matrix). The CROSS table approach is simpler and more complete than AST parsing.

Package dependency + transport readiness is more immediately useful — "is this transport complete?" is a real developer question.

## Decision

**Defer** — Both features are Medium priority but significant effort (3d+). ARC-1's FindReferences already covers the basic use case. Revisit if enterprise customers request call graph analysis.
