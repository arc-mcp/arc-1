# Rename Refactoring Preview

> **Priority**: Medium
> **Source**: VSP v2.38.0 — commit dcaa358 (2026-04-06)
> **ARC-1 component**: `src/adt/codeintel.ts`

## What VSP did
Rename refactoring preview — shows what would change if a symbol is renamed, without actually performing the rename. Lists affected files and locations.

## ARC-1 current state
Has findWhereUsed and findDefinition in codeintel.ts for navigation but no refactoring operations. The abap-adt-api library has rename support (3 methods: renameEvaluate, renameExecute, renamePreview).

## Assessment
Refactoring is a significant feature gap (#18 Medium in feature matrix). VSP adds preview only; ARC-1 could implement full rename using the ADT refactoring API. abap-adt-api provides a reference implementation.

## Decision
**Consider future** — maps to feature matrix gap #18. Preview-first approach is sensible.
