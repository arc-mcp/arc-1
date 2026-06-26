# API Surface Inventory

> **Priority**: Medium
> **Source**: VSP v2.38.0 — commit aa5aa5b (2026-04-06)
> **ARC-1 component**: `src/context/contract.ts`

## What VSP did
API surface inventory — scans a package and lists all public methods, interfaces, and function modules that constitute the package's public API. Useful for understanding what a package exposes.

## ARC-1 current state
Has public API contract extraction in context/contract.ts which extracts interface definitions and public method signatures. SAPContext uses this for dependency-aware context compression.

## Assessment
ARC-1 already has similar capability in contract.ts. The difference is VSP exposes this as a standalone tool while ARC-1 uses it internally within SAPContext. ARC-1's approach is arguably better for LLM consumption (context includes only what's needed).

## Decision
**No action needed** — ARC-1 has this capability in contract.ts, used internally by SAPContext.
