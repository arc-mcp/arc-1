# Guaranteed Unlock via try-finally in All Update Handlers

> **Priority**: None (ARC-1 already has this pattern)
> **Source**: fr0ster commit 32ab9d4 (2026-03-26) — fixes issue #22
> **ARC-1 component**: `src/adt/crud.ts` (lines 108-129), `src/handlers/intent.ts` (lines 1246-1257)

## What fr0ster changed

Refactored 9 update handlers from try-catch to try-finally for the lock/unlock lifecycle:

**Affected handlers**: UpdateProgram, UpdateClass, UpdateInterface, UpdateView, UpdateTable, UpdateStructure, UpdateDomain, UpdateServiceDefinition, UpdateDataElement

### The bug

In the old pattern, unlock only happened in the catch block:

```typescript
const lock = await client.lock(objectUrl);
try {
  await client.updateSource(sourceUrl, source, lock.handle);
  await client.checkRun(objectUrl);    // <-- if this throws...
  await client.activate(objectUrl);     // <-- or this throws...
} catch (error) {
  await client.unlock(objectUrl, lock.handle);  // only unlock on error
  throw error;
}
await client.unlock(objectUrl, lock.handle);    // unlock on success
```

**Problem**: If `checkRun()` or `activate()` threw an error that was caught elsewhere (e.g., a framework-level error handler), the unlock in the catch block might not execute, leaving the object permanently locked in SAP. Developers would need to manually unlock via SE03/SM12.

### The fix

```typescript
const lock = await client.lock(objectUrl);
try {
  await client.updateSource(sourceUrl, source, lock.handle);
} finally {
  await client.unlock(objectUrl, lock.handle);
}
// Check + activate moved AFTER unlock
await client.checkRun(objectUrl);
await client.activate(objectUrl);
```

Key design changes:
1. `finally` guarantees unlock regardless of error path
2. Check/activate moved outside the lock scope (they don't need the lock)
3. Simpler flow: only one unlock call instead of two

### Why this matters for SAP

Locked ABAP objects in SAP are a serious problem:
- The lock is **system-wide** — no other developer or AI agent can edit that object
- Locks persist across sessions — they don't auto-expire
- Manual cleanup requires SE03 (Transport Organizer) or SM12 (Lock Entries) authorization
- In BTP ABAP Environment, lock cleanup is even harder (no SE03/SM12 GUI)

## ARC-1 comparison

**ARC-1 has had try-finally unlock since the initial TypeScript implementation.**

### Update path (`src/adt/crud.ts:108-129`)

```typescript
export async function safeUpdateSource(
  http: AdtHttpClient, safety: SafetyConfig,
  objectUrl: string, sourceUrl: string, source: string, transport?: string,
): Promise<void> {
  await http.withStatefulSession(async (session) => {
    const lock = await lockObject(session, safety, objectUrl);
    const effectiveTransport = transport ?? (lock.corrNr || undefined);
    try {
      await updateSource(session, safety, sourceUrl, source, lock.lockHandle, effectiveTransport);
    } finally {
      await unlockObject(session, objectUrl, lock.lockHandle);
    }
  });
}
```

### Delete path (`src/handlers/intent.ts:1246-1257`)

```typescript
await client.http.withStatefulSession(async (session) => {
  const lock = await lockObject(session, client.safety, objectUrl);
  const effectiveTransport = transport ?? (lock.corrNr || undefined);
  try {
    await deleteObject(session, client.safety, objectUrl, lock.lockHandle, effectiveTransport);
  } finally {
    try {
      await unlockObject(session, objectUrl, lock.lockHandle);
    } catch {
      // Object may already be deleted — unlock failure is expected
    }
  }
});
```

### Design advantages of ARC-1's approach

| Aspect | fr0ster (v4.5.0) | ARC-1 |
|--------|------------------|-------|
| Pattern | 9 duplicated try-finally blocks | 1 centralized `safeUpdateSource()` |
| Session management | Connection reuse (implicit) | Explicit `withStatefulSession()` |
| Transport resolution | Caller provides | Auto-extract from lock `corrNr` |
| Safety checks | None (no safety system) | `checkOperation()` before lock |
| Delete unlock | Standard try-finally | Nested try-catch (handles deleted objects) |

ARC-1's centralized approach means:
- One place to fix if the pattern needs updating
- All write paths (update, create+write, edit_method, batch_create) share the same safe unlock
- No risk of individual handlers forgetting the pattern

## Decision

**No action needed.** ARC-1's implementation is superior — centralized, session-aware, with safety checks and transport auto-resolution. The `crud.ts` file already references fr0ster's bug in its opening comment as a design lesson.
