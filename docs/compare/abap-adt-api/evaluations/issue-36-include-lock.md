# Issue #36: Include Lock Handle Issues

> **Priority**: Medium
> **Source**: abap-adt-api issue #36 (closed, 2025-06-23)
> **ARC-1 component**: `src/adt/crud.ts`

## Issue description

"Resource INCLUDE is not locked (invalid lock handle)" — when trying to update an include, the lock must be acquired on the correct resource URL. The issue reveals that locking an include requires locking the parent object (e.g., the class or function group), not the include itself.

## ARC-1 current state

- ARC-1's `lockObject()` in crud.ts locks by object URL
- Class include editing via method-level surgery locks the class URL
- Verify: does ARC-1 correctly lock the parent when editing function group includes?

## Assessment

This is an ADT API quirk — includes don't have their own lock, they inherit the parent's lock. ARC-1's method-level surgery already handles class includes correctly (locks the class). But other include types (function group includes, program includes) may need the same parent-locking pattern.

## Decision

**Verify** — Check that ARC-1's lock handling for function group includes and program includes acquires the lock on the parent object. If not, fix the lock URL resolution.

**Effort**: XS (verify + potential URL fix)
