# SearchObject TSV Format Optimization

**Priority**: Medium
**Source**: Commits 8a22669, 04d03ed; Issue #40, #39
**ARC-1 Component**: `src/handlers/intent.ts` (SAPSearch handler)

## What They Did

fr0ster changed SearchObject response format in two steps:
1. First from raw XML to compact JSON (#39, 04d03ed)
2. Then from JSON to TSV (#40, 8a22669) — tab-separated values

The motivation is **reducing LLM token consumption** for search results. Raw XML is verbose; JSON is better; TSV is most compact per-row.

## ARC-1 Current State

ARC-1's SAPSearch returns results as formatted text (`textResult()`). The response includes object name, type, package, and description. The format is already reasonably compact but not as structured as TSV.

## Assessment

**Consider-future.** ARC-1's text format is decent, but structured TSV could:
- Be more token-efficient for large result sets
- Allow LLMs to parse columns more reliably
- Align with the trend of compact, structured MCP responses

Not urgent — ARC-1's current search results work well. But if we see LLM confusion on search result parsing, TSV is a proven optimization.

## Decision

**Consider-future** — implement if search result parsing issues arise or as part of a broader response format optimization pass.
