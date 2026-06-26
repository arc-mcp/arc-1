# ABAP Parser + Dependency Analysis as MCP Tools

> **Priority**: Medium
> **Source**: VSP v2.30.0 — commits 0756e94, 0c2bace (2026-03-20)
> **ARC-1 component**: `src/context/deps.ts`, `src/context/compressor.ts`

## What VSP did

Exposed the native Go ABAP parser and dependency analyzer as MCP tools:
- `parse_abap` — returns parsed ABAP AST (statements, tokens)
- `analyze_deps` — returns dependency list with types (class refs, function calls, SQL tables, etc.)

Also built a "unified 5-layer code intelligence analyzer":
1. Regex (fastest, least accurate)
2. Lexer (token-level)
3. Parser (statement-level)
4. Cross-refs (CROSS/WBCROSSGT tables)
5. Type resolver (semantic analysis)

## ARC-1 current state

ARC-1 has:
- `src/context/deps.ts` — AST-based dependency extraction using @abaplint/core
- `src/context/compressor.ts` — orchestrates fetch + deps + format into compressed context
- Both are internal — used by SAPContext tool, not exposed as separate tools

The parser output isn't exposed as an MCP tool because ARC-1's intent-based routing abstracts this (SAPContext handles context assembly automatically).

## Assessment

Exposing raw parser output as MCP tools is useful for power users but adds complexity to the tool surface. ARC-1's approach of using parsing internally (for SAPContext compression) is cleaner for the LLM.

The 5-layer analyzer is interesting but ARC-1 already has layers 1-4 across different components. Layer 5 (type resolution) would require full @abaplint/core semantic analysis — possible but expensive.

## Decision

**No action needed** — ARC-1's internal use of parsing for SAPContext is the right design. Exposing raw parser output would complicate the intent-based tool surface. The 5-layer model validates ARC-1's existing approach.
