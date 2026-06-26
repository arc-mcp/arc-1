# Namespaced Class URI in Syntax Check

> **Priority**: Medium
> **Source**: VSP issue #52, commit 6d1f00a (2026-03-18)
> **ARC-1 component**: `src/adt/devtools.ts`

## What VSP fixed

SyntaxCheck was appending unnecessary URL suffixes for long namespaced classes like `/NAMESPACE/CL_VERY_LONG_CLASS_NAME`. The resulting URL exceeded SAP's URL length limit.

Fix: Use shorter object URIs without redundant path segments for syntax check requests.

## ARC-1 current state

`src/adt/devtools.ts` `syntaxCheck()` constructs the check URL. Need to verify:
1. Does it handle `/namespace/` objects correctly?
2. Does it add unnecessary URL suffixes?

## Decision

**Verify** — Check `src/adt/devtools.ts` syntax check URL construction for namespaced objects. If it uses the full object URL with suffixes, simplify to match VSP's fix.

**Effort**: 0.5d
