# Side Effect Extraction & LUW Classification

> **Priority**: Medium
> **Source**: VSP v2.39.0 — commit 11c2253 (2026-04-08)
> **ARC-1 component**: `src/context/deps.ts`, `src/context/compressor.ts`

## What VSP did
Side effect extraction (DB writes via UPDATE/INSERT/MODIFY/DELETE, authority checks via AUTHORITY-CHECK, commit work via COMMIT WORK) + LUW (Logical Unit of Work) classification. Classifies methods as read-only, write, or mixed based on side effects.

## ARC-1 current state
Has dependency extraction in deps.ts but doesn't analyze side effects or classify methods by mutation profile. SAPContext returns deps but no safety metadata.

## Assessment
Novel capability for safety analysis. Could enhance SAPContext to flag methods that perform writes, helping LLMs understand impact before suggesting changes. However, ARC-1's safety system operates at the tool level (readOnly, allowedOps), not at code analysis level. Consider for future SAPContext enhancement.

## Decision
**Consider future** — interesting for advanced context but not urgent. ARC-1's intent-based safety model operates at a different layer.
