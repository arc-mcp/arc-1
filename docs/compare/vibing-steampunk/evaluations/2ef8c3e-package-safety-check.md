# CreatePackage Safety Check Bug

> **Priority**: Low
> **Source**: VSP issue #71, commit 2ef8c3e (2026-03-18)
> **ARC-1 component**: `src/adt/safety.ts`

## What VSP fixed

CreatePackage safety check was checking if operations on an empty string were allowed, instead of checking the actual package name being created. Bug: the package name wasn't being passed to the safety check.

Also, issue #54: SAP_ALLOWED_PACKAGES blocked InstallZADTVSP because the ZADT_VSP package wasn't in the allowed list — chicken-and-egg problem for bootstrap tools.

## ARC-1 current state

`src/adt/safety.ts` `checkOperation()` validates package restrictions. ARC-1 doesn't have InstallZADTVSP (doesn't deploy ABAP to SAP), so the bootstrap issue doesn't apply.

**But**: Verify that package name is correctly passed to safety checks during create operations.

## Decision

**Verify** — Quick check that `src/adt/safety.ts` receives the correct package name during SAPWrite create operations. Low risk since ARC-1 has different handler architecture.

**Effort**: 0.25d
