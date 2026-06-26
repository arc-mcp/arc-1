# Issue #12: Resource Not Locked Error

> **Priority**: Low
> **Source**: fr0ster issue #12 (closed, 2026-03-08)
> **ARC-1 component**: `src/adt/crud.ts`

## Issue description

User got "SAP Error: Resource Z_TEST_REPORT is not locked" when trying to update a program. The issue was that the update handler was not properly locking the object before writing, or the lock was lost between operations.

Root cause: fr0ster's handler sequence was create→write (without explicit lock), relying on create to leave the object locked. But in some flows the lock wasn't retained.

## ARC-1 current state

ARC-1's `src/adt/crud.ts` has explicit lock management:
```typescript
const handle = await this.lock(uri);
try {
  // write operation
} finally {
  await this.unlock(uri, handle);
}
```

Every write operation explicitly locks, writes, and unlocks in a try-finally block. The lock handle is always obtained before any write attempt.

## Assessment

ARC-1 doesn't have this bug. The explicit lock→try→finally→unlock pattern prevents this class of issue entirely. This validates ARC-1's approach.

## Decision

**No action needed** — ARC-1's lock management is already correct. This issue confirms the design is sound.
