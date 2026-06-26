# Package Boundary Crossing Analysis

> **Priority**: Medium
> **Source**: VSP v2.39.0 — commits 53fb790, b661c09 (2026-04-05–08)
> **ARC-1 component**: `src/context/deps.ts`

## What VSP did
Package boundary crossing analysis — detects when code in one package calls code in another, with directional analysis (who calls whom). Also includes a graph engine with package boundary analysis, dynamic call detection.

## ARC-1 current state
Has dependency extraction in deps.ts that lists dependencies but doesn't classify them by package boundaries. No package-level architecture governance.

## Assessment
Architecture governance tool — useful for large codebases but niche. ARC-1's SAPContext already provides dependency lists; adding boundary analysis would be a specialized extension.

## Decision
**Consider future** — valuable for enterprise clean core analysis but not a priority.
