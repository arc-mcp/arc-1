# Dead Code Detection

> **Priority**: Medium
> **Source**: VSP v2.38.0 — commits 1ecafe7, 7027b83 (2026-04-06–07)
> **ARC-1 component**: `src/adt/codeintel.ts`, `src/context/compressor.ts`

## What VSP did
Dead code detection at method level using where-used analysis (WBCROSSGT). Slim V2 Phase 3 adds `--level` flag for configurable analysis depth. Identifies methods with zero cross-references as dead code candidates.

## ARC-1 current state
Has findWhereUsed in codeintel.ts. Could theoretically implement dead code detection by running where-used for each method and checking for zero results, but doesn't have this as an orchestrated capability.

## Assessment
Useful refactoring tool. Could be implemented as a SAPContext operation or SAPDiagnose extension using existing where-used infrastructure. However, it's a batch analysis (check all methods in a class) which could be expensive for large classes.

## Decision
**Consider future** — feasible with existing infrastructure but not high priority.
