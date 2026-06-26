# Evaluation: 22517d4 — Fix lock-handle bug class: Stateful + ModificationSupport guard

**Priority**: High
**Source**: oisee/vibing-steampunk commit 22517d4 (2026-04-15)
**ARC-1 Component**: `src/adt/crud.ts`, `src/adt/http.ts`

## What They Did

Fixed a systemic bug class: lock handles become invalid if the stateful HTTP session changes between the LOCK and subsequent MODIFY/UPDATE request. The fix adds two guards:
1. **Stateful session check**: Ensures the same stateful session is used for all operations in a lock→modify→unlock sequence.
2. **ModificationSupport guard**: The ADT lock response includes a `AdtLockResult.modificationSupport` flag. If `modificationSupport = false`, the object is read-only in the current transport (e.g., in a released transport). Previously they'd try to modify and get a 423, now they detect this upfront.

The companion docs commit (`1989ce1`) documents this as "session wisdom — security scrub and lock-handle bug class" suggesting it's a well-understood pattern now.

## ARC-1 Current State

ARC-1 uses `http.withStatefulSession()` in `crud.ts` for lock→modify→unlock sequences, which should maintain session continuity. However:
1. The `lockObject()` return type in `crud.ts` extracts `{ lockHandle, corrNr }` from the ADT response. It does NOT extract or check `modificationSupport`.
2. The 423 `ExceptionResourceInvalidLockHandle` errors seen repeatedly in VSP, fr0ster, and abap-adt-api issues (#36, #78, #88, #91, #92) suggest this is a genuine widespread issue.

## Assessment

**This is directly relevant to ARC-1.** Two distinct action items:

1. **Verify `withStatefulSession()` truly isolates sessions** — concurrent requests to the same ADT client could potentially contaminate the cookie jar if not properly isolated. ARC-1 uses undici pool + stateful sessions; verify that stateful session cookies don't bleed across concurrent writes.

2. **Add `modificationSupport` check to `lockObject()`** — Parse and return the `modificationSupport` flag from the ADT lock response. If `false`, return an LLM-friendly error: "Object is locked in a released transport. Create a new transport to modify this object." This prevents the cryptic 423 error.

## ADT Lock Response Structure

The ADT lock response XML contains:
```xml
<adtcore:objectLock>
  <adtcore:lockHandle>...</adtcore:lockHandle>
  <adtcore:corrNr>...</adtcore:corrNr>
  <adtcore:modificationSupport>false</adtcore:modificationSupport>
</adtcore:objectLock>
```

## Decision

**implement** — Add `modificationSupport` parsing to `lockObject()` in `crud.ts`. Return early with clear error if `false`. This prevents confusing 423 errors and is a known pain point across all SAP ADT clients.

Cross-reference: vibing-steampunk issues #88, #91, #92; abap-adt-api issues #30, #36; fr0ster issues #57, #58.
