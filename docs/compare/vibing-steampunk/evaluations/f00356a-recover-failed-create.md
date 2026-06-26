# Evaluation: f00356a — RecoverFailedCreate recovery primitive (Phase 3)

**Priority**: Medium
**Source**: oisee/vibing-steampunk commits f00356a + 1b05441 (2026-04-13)
**ARC-1 Component**: `src/adt/crud.ts`, `src/handlers/intent.ts`

## What They Did

Added a `RecoverFailedCreate` primitive and CLI wrapper `vsp recover-failed-create`. The problem: when an ADT object create request returns a 5xx error (server error), the object may have been partially created on the SAP side (the write succeeded but the response failed). On retry, the create fails with 409 (already exists). Without recovery, the object is stuck in an inconsistent state — exists but may have no source, no transport assignment, etc.

The recovery primitive:
1. Detects if the object exists (GET by URL)
2. If it exists with no source — proceeds to write source (treating it as an update)
3. If it exists with source — returns the existing object (idempotent success)
4. If it doesn't exist — proceed with normal create

This was Phase 3 of their `reconcile partial-create on 5xx` effort (fix `3d1353e` is Phase 1).

## ARC-1 Current State

ARC-1's `createObject()` in `crud.ts` calls `PUT /sap/bc/adt/...` and handles errors. If a 5xx occurs during create:
- The current code throws `AdtApiError` with the HTTP status.
- There is no detection of "partial create" state.
- On retry, the user would get a 409 which ARC-1 formats as "object already exists — use update instead."

ARC-1's commit-level message to the LLM: "Object already exists, use SAPWrite action=update instead." This is actually not bad UX, but it doesn't handle the case where the object exists without source.

## Assessment

The partial-create recovery is a genuinely useful pattern for reliability in AI agent workflows where retries are common. However:
- ARC-1's 409 response already tells the LLM to switch to update, which effectively recovers in most cases.
- True partial-create (exists with no source) is edge-case. The LLM can retry with update.
- Adding a formal recovery primitive adds complexity.

The simpler approach: when SAPWrite action=create returns 409, automatically check if the object exists and either:
a) Return its current state (and let the LLM decide to update)
b) Attempt to write source as update (auto-recovery)

## Decision

**consider-future** — The 409 hint in ARC-1 already handles 80% of cases. For a future enhancement, the auto-recovery on 5xx-followed-by-409 pattern is valuable. Track as a quality-of-life improvement for AI agent reliability.
