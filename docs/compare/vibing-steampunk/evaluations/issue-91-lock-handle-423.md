# Lock Handle 423 Error (ExceptionResourceInvalidLockHandle)

> **Priority**: Medium
> **Source**: VSP issue #91 (2026-04-08)
> **ARC-1 component**: `src/adt/crud.ts`

## What VSP did
Users getting 423 ExceptionResourceInvalidLockHandle errors. This is a recurring issue in VSP (also #78, #88).

## ARC-1 current state
Uses lock->modify->unlock pattern in crud.ts with try/finally for unlock. Has withStatefulSession to share cookies.

## Assessment
Lock handle errors are common with ADT. ARC-1's pattern should be robust but worth verifying error handling for 423 specifically.

## Decision
**Verify** — ensure ARC-1 crud.ts handles 423 lock handle errors gracefully.
