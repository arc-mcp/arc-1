# RAP Write Guard & Skill Hardening

## Overview

When `SAPManage(action="probe")` reports `rap.available = false`, ARC-1 still accepts DDLS/BDEF/DDLX/SRVD write requests and forwards them to SAP, which returns opaque 415/500 errors. This wastes tool calls and confuses LLM agents into elaborate workaround attempts (Python escaping, local file writing) instead of failing fast.

This plan adds a **feature-aware write guard** that returns a clear, actionable error before any HTTP request when RAP-dependent types are requested on a system without RAP. It also hardens the RAP generation skills based on real-world failure feedback, and adds E2E test coverage for the RAP creation lifecycle (DDLS/BDEF/SRVD) which currently has zero automated verification.

## Context

### Current State

- Feature probing works: `SAPManage(action="probe")` correctly detects `rap.available` via HEAD to `/sap/bc/adt/ddic/ddl/sources`
- The probed result is stored in module-level `cachedFeatures` variable in `src/handlers/intent.ts` (line ~2327)
- `handleSAPWrite` for `create` and `batch_create` actions has NO guard checking `cachedFeatures.rap.available` before attempting DDLS/BDEF/DDLX/SRVD creation
- A similar guard pattern already exists for FLP in `handleSAPManage` (lines ~2390-2404): `if (cachedFeatures?.flp && !cachedFeatures.flp.available) return errorResult(...)`
- The `generate-rap-service-researched.md` skill calls `SAPManage(action="features")` but does NOT instruct the agent to check `rap.available` before attempting writes
- The skill also calls `SAPManage(action="features")` redundantly after `probe` — `features` just reads the same cache
- `SAPRead(type="INACTIVE_OBJECTS")` IS a valid type (calls `/sap/bc/adt/activation/inactive`) but may return 404 on systems that don't expose that endpoint — the skill should handle this gracefully
- No E2E or integration test creates a DDLS, BDEF, DDLX, or SRVD on a real SAP system — only PROG and DOMA/DTEL have write test coverage

### Target State

- `SAPWrite(action="create/update/delete/batch_create")` for types DDLS/BDEF/DDLX/SRVD returns a clear error when `rap.available === false`
- Error message includes: what failed, why (RAP not available), and what to do instead (create in ADT, or check system configuration)
- RAP skills check `rap.available` from the features response before attempting any CDS/BDEF writes
- Skills don't make redundant `features` call after `probe`
- Skills handle `INACTIVE_OBJECTS` 404 gracefully (try/catch, not a hard requirement)
- E2E tests verify DDLS + BDEF + SRVD creation lifecycle on a real system

### Key Files

| File | Role |
|------|------|
| `src/handlers/intent.ts` | Tool handler — add RAP write guard at lines ~1429 (create), ~1543 (batch_create), ~1413 (update), ~1492 (delete) |
| `src/adt/features.ts` | Feature probe definitions (line 36: rap probe endpoint) |
| `tests/unit/handlers/intent.test.ts` | Unit tests for write guard behavior |
| `tests/e2e/rap-write.e2e.test.ts` | New: E2E tests for RAP object lifecycle |
| `tests/e2e/fixtures.ts` | Fixture definitions (may need RAP fixture) |
| `skills/generate-rap-service.md` | Vibe-code RAP skill — add feature guard |
| `skills/generate-rap-service-researched.md` | Research-first RAP skill — add feature guard, remove redundancies |
| `skills/generate-rap-logic.md` | RAP logic skill — add feature guard |

### Design Principles

1. **Fail fast, fail clearly** — return an actionable error before any HTTP request, not after a 415/500 from SAP
2. **Follow existing patterns** — use the same guard pattern as FLP (`if (cachedFeatures?.X && !cachedFeatures.X.available)`)
3. **Don't block when unknown** — if features haven't been probed yet (`cachedFeatures === undefined`), allow the request (the SAP system will validate)
4. **Guard at the handler level** — check in `handleSAPWrite` before calling `createObject()`, not deep in the HTTP layer
5. **Skills must be defensive** — check features result before attempting writes, handle errors gracefully

## Development Approach

- Task 1-2: Code changes (guard + tests)
- Task 3: E2E test coverage for RAP write lifecycle
- Task 4: Skill hardening
- Task 5: Documentation updates
- Task 6: Final verification

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Add RAP feature guard to SAPWrite handler

**Files:**
- Modify: `src/handlers/intent.ts`

Add a feature-aware guard that blocks DDLS/BDEF/DDLX/SRVD writes when `rap.available === false`. The guard should fire for `create`, `update`, `delete`, `edit_method`, and `batch_create` actions.

- [ ] Add a helper function `checkRapAvailable(type: string): string | undefined` near the other helper functions in the SAPWrite section (~line 1380). It should:
  - Define RAP-dependent types: `['DDLS', 'BDEF', 'DDLX', 'SRVD']`
  - Check if `type` is in that list
  - If yes, check `cachedFeatures?.rap` — if it exists AND `available === false`, return an error message string
  - If features haven't been probed yet (`cachedFeatures` is undefined) or `rap` is not in features, return `undefined` (allow the request)
  - Error message: `"RAP/CDS feature is not available on this system (probed endpoint: /sap/bc/adt/ddic/ddl/sources). Cannot create/modify ${type} objects via SAPWrite. Create them manually in ADT, or check your SAP system configuration. Run SAPManage(action=\"probe\") to re-check availability."`
- [ ] Add the guard to the `create` action (after line ~1430, before `buildCreateXml`): `const rapErr = checkRapAvailable(type); if (rapErr) return errorResult(rapErr);`
- [ ] Add the guard to the `update` action (after line ~1413, before `safeUpdateSource`): same pattern
- [ ] Add the guard to the `delete` action (after line ~1520, before lock/delete): same pattern
- [ ] Add the guard to `batch_create` (after validating objects array, before the loop ~line 1549): check if ANY object in the array has a RAP type: `const rapTypes = objects.filter(o => ['DDLS','BDEF','DDLX','SRVD'].includes(String(o.type ?? '').toUpperCase())); if (rapTypes.length > 0) { const rapErr = checkRapAvailable(String(rapTypes[0].type)); if (rapErr) return errorResult(rapErr); }`
- [ ] Also guard `edit_method` — while edit_method only supports CLAS currently, guard it at the type-check level for future safety
- [ ] Run `npm test` — all tests must pass (existing tests use mocked features so guard won't fire)

### Task 2: Add unit tests for RAP write guard

**Files:**
- Modify: `tests/unit/handlers/intent.test.ts`

Add unit tests verifying the RAP write guard behavior. Follow the existing mock pattern: `vi.mock('undici', ...)` with `mockResponse()` helper.

- [ ] Add a new `describe('SAPWrite RAP feature guard')` section near the existing SAPWrite tests (~line 3613 area)
- [ ] Test: `SAPWrite create DDLS returns error when rap.available=false` — set `cachedFeatures` to have `rap: { available: false, ... }` via `setCachedFeatures()`, call `handleToolCall` with `SAPWrite create type=DDLS`, assert `isError: true` and message contains "RAP/CDS feature is not available"
- [ ] Test: `SAPWrite create BDEF returns error when rap.available=false` — same pattern
- [ ] Test: `SAPWrite create SRVD returns error when rap.available=false` — same pattern
- [ ] Test: `SAPWrite batch_create with DDLS returns error when rap.available=false`
- [ ] Test: `SAPWrite create DDLS succeeds when rap.available=true` — set features with `rap: { available: true }`, verify no guard error (mock HTTP to return success)
- [ ] Test: `SAPWrite create DDLS succeeds when features not probed` — set `cachedFeatures` to undefined via `resetCachedFeatures()`, verify no guard error
- [ ] Test: `SAPWrite create PROG is not affected by rap.available=false` — verify PROG creation still works when RAP is unavailable
- [ ] Test: `SAPWrite update DDLS returns error when rap.available=false`
- [ ] Test: `SAPWrite delete DDLS returns error when rap.available=false`
- [ ] Add `afterEach(() => resetCachedFeatures())` to clean up feature state between tests
- [ ] Run `npm test` — all tests must pass

### Task 3: Add E2E tests for RAP object lifecycle (DDLS + BDEF + SRVD)

**Files:**
- Create: `tests/e2e/rap-write.e2e.test.ts`

Add E2E tests that create, read, activate, and delete DDLS/BDEF/SRVD objects on a real SAP system. Follow the pattern in `tests/e2e/ddic-write.e2e.test.ts` (transient objects with try/finally cleanup). These tests require `rap.available = true` on the test system — skip gracefully if not.

- [ ] Create `tests/e2e/rap-write.e2e.test.ts` following the ddic-write pattern:
  - Import helpers: `callTool`, `connectClient`, `expectToolSuccess`, `expectToolError` from `./helpers.js`
  - Import `uniqueName` pattern (timestamp-based) for collision-safe object names
  - Use `requireOrSkip` from `tests/helpers/skip-policy.ts` for skipping when RAP is unavailable
- [ ] Add setup: connect client, call `SAPManage(action="features")`, check `rap.available` — if false, skip all tests with `requireOrSkip(ctx, rapAvailable, 'RAP_NOT_AVAILABLE')`
- [ ] Test: `SAPWrite create DDLS table entity` — create a minimal table entity DDL (`define table z<unique> { key client : abap.clnt not null; key id : sysuuid_x16 not null; name : abap.char(40); }`), verify via `SAPRead(type="DDLS")`, cleanup via `SAPWrite(action="delete")`
- [ ] Test: `SAPWrite create DDLS CDS view entity + BDEF + activate` — create interface CDS view selecting from the table entity, create BDEF with managed scenario + behavior pool stub (CLAS), batch activate all, verify via SAPRead, cleanup in reverse dependency order
- [ ] Test: `SAPWrite create SRVD` — create a service definition exposing a CDS view, activate, verify, cleanup
- [ ] Test: `SAPWrite batch_create for RAP stack` — batch_create table entity + CDS view + BDEF + CLAS in one call, verify all were created, cleanup
- [ ] All tests use `try/finally` for cleanup with `// best-effort-cleanup` catch blocks
- [ ] Run `npm run test:e2e` — all tests pass (or skip gracefully if RAP unavailable on test system)

### Task 4: Harden RAP generation skills based on real-world feedback

**Files:**
- Modify: `skills/generate-rap-service-researched.md`
- Modify: `skills/generate-rap-service.md`
- Modify: `skills/generate-rap-logic.md`

Apply lessons learned from the failed Football Clubs RAP creation session. The key issues: (1) agent didn't check `rap.available` before writing, (2) redundant `features` after `probe`, (3) `INACTIVE_OBJECTS` assumed always available, (4) no fail-fast on first 415.

- [ ] In `skills/generate-rap-service-researched.md` Phase 1a: After `SAPManage(action="features")`, add explicit instruction: "**Critical gate:** Check `rap.available` in the features response. If `rap.available = false`, STOP — inform the user: 'RAP/CDS writes are not available on this system. Objects must be created manually in ADT.' Do not attempt any DDLS/BDEF/DDLX/SRVD writes."
- [ ] In `skills/generate-rap-service-researched.md` Phase 1a: Change `SAPManage(action="features")` to `SAPManage(action="probe")` since probe does the actual probing AND returns the results (features just reads cache). Remove any separate `features` call that follows a `probe` call.
- [ ] In `skills/generate-rap-service-researched.md` Phase 4-pre: Change the `SAPRead(type="INACTIVE_OBJECTS")` step to be wrapped in a try/catch note: "This may return 404 on some systems — if so, skip this check and proceed."
- [ ] In `skills/generate-rap-service.md` Step 1: After `SAPManage(action="features")`, add the same `rap.available` gate as above
- [ ] In `skills/generate-rap-service.md` Step 12: Same INACTIVE_OBJECTS graceful handling note
- [ ] In `skills/generate-rap-logic.md` Step 1: After reading the BDEF, add a note: "If the BDEF read fails with 404/415, RAP may not be available on this system. Run `SAPManage(action="probe")` to verify."
- [ ] In all three skills: Add to error handling table: `| 415 Unsupported Media Type on DDLS/BDEF | RAP/CDS not available on this system | Check SAPManage features — rap.available must be true. Create objects in ADT if RAP endpoint is unavailable. |`
- [ ] In `skills/generate-rap-service-researched.md`: Add general principle to Phase 4: "**Fail fast:** If the first DDLS/BDEF write fails with 415 or 500, stop all further CDS writes immediately. Do not retry with different types — the underlying issue is system-level, not object-specific."
- [ ] Run `npm test` — all tests must pass (skills are not code, but validate nothing is broken)

### Task 5: Documentation updates

**Files:**
- Modify: `docs/roadmap.md`
- Modify: `CLAUDE.md`

Update documentation to reflect the new feature guard and E2E test coverage.

- [ ] In `docs/roadmap.md`: Add a new entry for the RAP write guard feature. It can be a sub-item under FEAT-38 (ADT Service Discovery) or a standalone note under "Completed" — it's a safety improvement, not a new feature per se. Something like: `| — | RAP Write Guard (feature-aware) | 2026-04-XX | Features |` in the completed table.
- [ ] In `CLAUDE.md` "Key Files for Common Tasks" table: Add row: `| Add feature-gated write guard | src/handlers/intent.ts (checkRapAvailable), src/adt/features.ts |`
- [ ] In `CLAUDE.md` "Testing" section or "E2E Notes": Mention the new `tests/e2e/rap-write.e2e.test.ts` test file for RAP write lifecycle testing
- [ ] Run `npm test` — all tests must pass

### Task 6: Final verification

- [ ] Run full test suite: `npm test` — all tests pass
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors
- [ ] Verify the guard works manually: import `setCachedFeatures` and `handleToolCall` in a scratch test, set `rap.available = false`, call SAPWrite with type=DDLS, confirm error message is returned
- [ ] Move this plan to `docs/plans/completed/`
