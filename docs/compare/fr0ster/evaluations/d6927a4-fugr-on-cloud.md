# Enable FunctionGroup/FunctionModule on Cloud (BTP)

> **Priority**: Medium
> **Source**: fr0ster v4.0.0 — commit d6927a4 (2026-03-11)
> **ARC-1 component**: `src/adt/features.ts`, `src/adt/client.ts`

## What fr0ster did

Enabled FunctionGroup and FunctionModule handlers on BTP ABAP (cloud) systems. Previously these were on-prem only. Added a `getSystemType()` helper to detect cloud vs on-prem.

The key insight: BTP ABAP Environment **does** support function groups/modules via ADT, but with restrictions (e.g., only released APIs, no classic FUGR creation).

## ARC-1 current state

ARC-1's feature detection (`src/adt/features.ts`) probes for specific capabilities but doesn't restrict FUGR/FUNC by system type. The ADT client methods for function groups/modules should work on BTP if the endpoints exist.

## Assessment

Need to verify: Does ARC-1's `getFunction()` and `getFunctionGroup()` work on BTP ABAP? If the BTP integration tests cover these, it's already handled. If not, worth adding a test case.

This is more of a **verification task** than an implementation task.

## Decision

**Verify in BTP integration tests** — Check if `tests/integration/btp-abap.integration.test.ts` covers FUGR/FUNC read. If not, add a test case. No code changes expected in the main codebase unless BTP returns different XML structure.

**Effort**: 0.5d (testing only)
