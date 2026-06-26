# Issue #78: 423 Lock Handle Errors on ECC 6.0 EHP7

> **Priority**: Medium
> **Source**: VSP issue #78 (closed, 2026-03-28)
> **ARC-1 component**: `src/adt/crud.ts`

## Issue description

Updating PROG/CLAS on ECC 6.0 EHP7 fails with `423 ExceptionResourceInvalidLockHandle`. Eclipse ADT succeeds on the same system. Root cause: the lock handle format or lock mechanism differs on older ECC systems vs S/4HANA.

Resolution in VSP: The issue was marked resolved — likely through adjusting the lock request parameters or using a different lock endpoint for older systems.

## ARC-1 current state

ARC-1 targets ABAP 7.50+ which includes ECC 6.0 EHP7. `src/adt/crud.ts` handles locking via standard ADT lock endpoints.

## Assessment

If ARC-1 users connect to ECC 6.0 systems, they may hit this same issue. The fix likely involves:
- Adjusting lock request headers/parameters for ECC
- Or using a different lock endpoint

Since ARC-1's primary target is S/4HANA and BTP ABAP, this is medium priority — only affects users with older systems.

## Decision

**Monitor** — Not urgent since most ARC-1 users are on S/4HANA or BTP. If users report 423 errors, reference this VSP issue for the fix pattern.

**Effort**: 1d (if needed)
