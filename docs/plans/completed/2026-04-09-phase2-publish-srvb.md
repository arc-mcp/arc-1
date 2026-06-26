# Phase 2: Publish Service Binding

## Overview

Add the ability to publish and unpublish OData service bindings via the ADT API. This is the missing step between creating a RAP stack and having a working OData service. After publishing, the Fiori Elements preview URL becomes available — equivalent to clicking "Publish" in ADT Eclipse. The `generate-rap-service` skill currently tells users to create and publish the service binding manually (Step 13); this change enables `SAPActivate(action="publish_srvb")` to automate the publish step.

Confirmed working API — used by vibing-steampunk (`PublishServiceBinding`) and mcp-abap-abap-adt-api (`publishServiceBinding`, `unPublishServiceBinding`).

## Context

### Current State

- ARC-1 can **read** service binding metadata: `getSrvb()` at `src/adt/client.ts:264-270` returns structured JSON with OData version, publish status, service definition reference
- ARC-1 **cannot publish or unpublish** service bindings
- The `generate-rap-service` skill instructs users to manually create and publish SRVB (Step 13 at `skills/generate-rap-service.md:565-583`)
- `SAPActivate` currently only supports object activation (not service publishing)

### Target State

- `SAPActivate(action="publish_srvb", name="ZSB_BOOKING_V4")` publishes the service binding
- `SAPActivate(action="unpublish_srvb", name="ZSB_BOOKING_V4")` unpublishes it
- After publish, read back SRVB to confirm and show the service URL
- `generate-rap-service` skill updated to include publish step

### Key Files

| File | Role |
|------|------|
| `src/adt/devtools.ts` | Development tools — add `publishServiceBinding()`, `unpublishServiceBinding()` (after `activate` at line ~48) |
| `src/handlers/intent.ts` | Intent handler — add `publish_srvb`/`unpublish_srvb` cases in `handleSAPActivate` |
| `src/handlers/tools.ts` | Tool descriptions — update SAPActivate description |
| `src/handlers/schemas.ts` | Zod schemas — add action enum to SAPActivate (line ~156) |
| `skills/generate-rap-service.md` | RAP generation skill — update Step 13 |
| `.claude/commands/generate-rap-service.md` | Claude Code command — same update |
| `tests/unit/adt/devtools.test.ts` | Unit tests for new functions |
| `tests/unit/handlers/intent.test.ts` | Handler tests for new actions |

### Design Principles

1. Follow existing devtools pattern: safety check → HTTP call → return result (see `activate()` at `src/adt/devtools.ts:48`)
2. Use `OperationType.Activate` for both publish and unpublish — consistent with existing activation semantics and blocked by `readOnly` mode
3. The API is a POST with `?action=publish` query parameter to the existing SRVB endpoint — minimal new HTTP logic
4. After publish, read back the SRVB metadata to confirm success and show the service URL to the user

## Development Approach

Standard unit test approach. The publish API is a simple POST — mock it and verify the URL, method, and query parameters. Update the skill markdown files to include the new step.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Implement publish/unpublish in devtools

**Files:**
- Modify: `src/adt/devtools.ts`
- Modify: `tests/unit/adt/devtools.test.ts`

Add two new functions to `src/adt/devtools.ts` after the existing `activate()` function (line ~48).

- [x] Add `publishServiceBinding(http: AdtHttpClient, safety: SafetyConfig, name: string): Promise<string>` — `checkOperation(safety, OperationType.Activate, 'PublishServiceBinding')`, then `POST /sap/bc/adt/businessservices/bindings/${encodeURIComponent(name)}` with query param `action=publish`, empty body. Return response body.
- [x] Add `unpublishServiceBinding(http: AdtHttpClient, safety: SafetyConfig, name: string): Promise<string>` — same pattern with `action=unpublish`
- [x] Add unit tests (~6 tests): publish happy path (verify URL contains `?action=publish`, method is POST), unpublish happy path, safety check blocks in read-only mode for both, verify `encodeURIComponent` is applied to the name
- [x] Run `npm test` — all tests must pass

### Task 2: Wire up SAPActivate handler and schema

**Files:**
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `src/handlers/intent.ts`

Expose publish/unpublish via the SAPActivate tool with new action values.

- [x] Update `SAPActivateSchema` at `src/handlers/schemas.ts:156` to add an optional `action` field: `action: z.enum(['activate', 'publish_srvb', 'unpublish_srvb']).optional()` (default behavior remains `activate` when action is omitted)
- [x] Update SAPActivate tool description in `src/handlers/tools.ts` to mention the new actions: `For publish_srvb/unpublish_srvb: publish or unpublish an OData service binding (SRVB) — makes the OData service available for consumption`
- [x] Add `publish_srvb` and `unpublish_srvb` cases in `handleSAPActivate` at `src/handlers/intent.ts`. For `publish_srvb`: call `publishServiceBinding(http, safety, name)`, then call `client.getSrvb(name)` to read back and return the metadata with publish confirmation. For `unpublish_srvb`: call `unpublishServiceBinding(http, safety, name)` and return confirmation.
- [x] Add handler unit tests (~4 tests): publish_srvb action calls correct function and returns SRVB info, unpublish_srvb action works, missing name returns error, default action still works as activate
- [x] Run `npm test` — all tests must pass

### Task 3: Update generate-rap-service skill

**Files:**
- Modify: `skills/generate-rap-service.md`
- Modify: `.claude/commands/generate-rap-service.md`

Update the RAP generation skill to use the new publish action after the user creates the service binding.

- [x] In `skills/generate-rap-service.md`, update Step 13 (line ~565-583): after the manual SRVB creation instructions, add a new sub-step: "After the service binding is created and activated, publish it:" with `SAPActivate(action="publish_srvb", name="ZSB_<entity>_V4")`. Then `SAPRead(type="SRVB", name="ZSB_<entity>_V4")` to verify and show the service URL.
- [x] Make the same update in `.claude/commands/generate-rap-service.md`
- [x] Update the summary checklist at Step 14 (line ~596) to include `[x] Service binding published` as a checklist item
- [x] Run `npm test` — all tests must pass (skill changes don't affect tests, but verify nothing is broken)

### Task 4: Final verification

- [x] Run full test suite: `npm test` — all tests pass
- [x] Run typecheck: `npm run typecheck` — no errors
- [x] Run lint: `npm run lint` — no errors
- [x] Verify SAPActivate schema accepts `action="publish_srvb"` with a name parameter
- [x] Move this plan to `docs/plans/completed/`
