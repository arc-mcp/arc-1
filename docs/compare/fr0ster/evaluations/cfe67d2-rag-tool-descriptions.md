# RAG-Optimized Tool Descriptions

> **Priority**: Low
> **Source**: fr0ster v4.4.0-v4.4.1 — commits e8ba563, cfe67d2 (2026-03-22, 2026-03-26)
> **ARC-1 component**: `src/handlers/tools.ts`

## What fr0ster did

Rewrote all 287 tool descriptions to be optimized for vector embedding / RAG discoverability:
- Added domain keywords (ABAP, SAP, ADT, CDS, RAP, etc.)
- Made descriptions operation-first ("Read ABAP class source code" instead of "Gets the source of a class")
- Ensured each description is unique enough for embedding similarity search

Two commits: one for all tools (#20), one specifically for SearchObject (#21).

## ARC-1 current state

ARC-1 has 11 intent-based tools with focused descriptions in `src/handlers/tools.ts`. The LLM routes by intent (SAPRead, SAPWrite, etc.), not by embedding similarity. Tool selection is deterministic, not RAG-based.

## Assessment

**Not applicable to ARC-1's architecture**. With 11 tools, the LLM doesn't need embedding-based discovery — it reads all tool descriptions directly. RAG optimization matters when you have 287 tools and the MCP client uses vector search to pick the right one.

The only takeaway: ensure ARC-1's tool descriptions are clear and action-oriented (they already are).

## Decision

**Skip** — ARC-1's intent-based routing makes RAG optimization irrelevant. No action needed.
