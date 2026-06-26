# Change Package Assignment

## Overview

Add a `change_package` action to `SAPManage` that moves ABAP objects between packages via the ADT refactoring API (`POST /sap/bc/adt/refactorings`). This is a two-step preview-then-execute flow that changes the TADIR entry (object directory) for an object, reassigning it from one development package to another.

This is a standalone implementation of one part of FEAT-05 (Code Refactoring). Unlike rename/extract-method (which require complex AST analysis), change package is self-contained and high-value: it enables "productionize local development" ($TMP to real package) and package reorganization workflows that LLMs frequently need.

## Context

### Current State
- ARC-1 supports `create_package` and `delete_package` via SAPManage
- No support for moving objects between packages
- Objects created in `$TMP` stay there permanently unless the developer uses Eclipse ADT
- The feature is tracked in roadmap as FEAT-05 (Phase F, P3) and evaluated in `docs/compare/abap-adt-api/evaluations/a55c8f8-change-package.md`
- marcellourbani/abap-adt-api implements this in `src/api/refactor.ts` (commit a55c8f8, v7.0.0)

### Target State
- `SAPManage(action="change_package", objectUri=..., objectType=..., objectName=..., oldPackage=..., newPackage=..., transport=...)` moves an object between packages
- Two-step flow: preview (validate + discover affected objects) then execute
- Transport auto-detection: if moving to a transportable package, auto-creates or reuses a transport
- Safety: respects read-only mode, package allowlists (checked on BOTH old and new packages), operation type `Update`
- Proper error handling for: locked objects (TK 760), missing transport (TK 136), cross-software-component moves, packages that can't be moved (DEVC type)

### Verified ADT API Behavior (tested on A4H system 2026-04-15)

The refactoring endpoint uses a two-step flow:

**Step 1 — Preview:**
```
POST /sap/bc/adt/refactorings?step=preview&rel=http://www.sap.com/adt/relations/refactoring/changepackage
Content-Type: application/*
```
Request body is "wrapped" XML with `<changepackage:changePackageRefactoring>` outer element containing `<generic:genericRefactoring>`. Response returns the validated generic refactoring (unwrapped) with affected objects and any server-assigned transport.

**Step 2 — Execute:**
```
POST /sap/bc/adt/refactorings?step=execute
Content-Type: application/*
```
Request body is "unwrapped" — just `<generic:genericRefactoring>` element. Response is HTTP 200 with empty body on success.

**Transport behavior (tested):**
- `$TMP` to transportable package: requires transport in the `<generic:transport>` element (error TK 136 without it)
- Transportable to `$TMP`: no transport needed, succeeds with empty transport element
- After moving to transportable package, object is locked in transport — cannot be moved again until transport task is released (error TK 760)
- `$TMP` to `$TMP`: not tested (unlikely use case)
- Between transportable packages (same software component): needs transport

**XML Namespaces:**
- `changepackage` = `http://www.sap.com/adt/refactoring/changepackagerefactoring`
- `generic` = `http://www.sap.com/adt/refactoring/genericrefactoring`
- `adtcore` = `http://www.sap.com/adt/core`

### Key Files

| File | Role |
|------|------|
| `src/handlers/intent.ts` | Tool call router — add `change_package` case in `handleSAPManage` (~line 3010) |
| `src/handlers/schemas.ts` | Zod input schemas — add `change_package` to SAPManage action enum (~line 423) |
| `src/handlers/tools.ts` | Tool definitions — add `change_package` to action enum and new params (~line 846) |
| `src/adt/refactoring.ts` | **NEW** — Change package refactoring XML builder + executor |
| `src/adt/safety.ts` | Safety system — existing `checkOperation` + `checkPackage` (no changes needed) |
| `src/adt/crud.ts` | CRUD operations — reference for lock/unlock patterns (no changes needed) |
| `src/adt/http.ts` | HTTP transport — existing POST support (no changes needed) |
| `tests/unit/adt/refactoring.test.ts` | **NEW** — Unit tests for XML builder and parser |
| `tests/unit/handlers/intent.test.ts` | Handler tests — add `change_package` tests (~line 2505) |
| `tests/unit/handlers/schemas.test.ts` | Schema tests — add `change_package` validation tests |
| `docs/tools.md` | Tool reference — add `change_package` to SAPManage docs |
| `docs/roadmap.md` | Roadmap — update FEAT-05 status |

### Design Principles

1. **Reuse the existing SAPManage tool** — `change_package` is a package lifecycle action, fits naturally alongside `create_package` and `delete_package`. No new MCP tool needed.

2. **Two-step API with single-step UX** — The MCP action does preview + execute in one call. The preview validates the operation and discovers the transport; the execute performs it. If preview fails, the error is returned immediately.

3. **Transport auto-handling** — If a transport is needed but not provided, use the same transport pre-flight pattern as `create_package` (lines 3042-3068 in intent.ts). If a transport is auto-assigned by the preview response, use it.

4. **Separate refactoring module** — XML building for the refactoring endpoint is distinct from `ddic-xml.ts` (which handles DEVC metadata). Create `src/adt/refactoring.ts` for the change-package-specific XML and HTTP logic.

5. **Safety on both packages** — The old package and new package must both pass `checkPackage()`. This prevents moving objects out of allowed packages into unrestricted ones, or vice versa.

6. **Object identity via search** — The caller provides `objectName` and `objectType`. The handler resolves the ADT URI and current package via the existing search endpoint, so the caller doesn't need to know the internal ADT path.

## Development Approach

- Unit tests mock the HTTP layer with `mockFetch` + `mockResponse` pattern
- Integration tests use the A4H test system with `ZARC1_DV_MNZQP5V11PD2` (in `$TMP`) as the test object
- Follow existing `create_package`/`delete_package` test patterns in `tests/unit/handlers/intent.test.ts`

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Create refactoring module with XML builders and executor

**Files:**
- Create: `src/adt/refactoring.ts`
- Create: `tests/unit/adt/refactoring.test.ts`

Create a new module `src/adt/refactoring.ts` that encapsulates the ADT change-package refactoring API. This module handles XML building (preview + execute payloads), HTTP calls, and response parsing. It's separate from `crud.ts` because the refactoring API uses a different endpoint pattern (`/sap/bc/adt/refactorings` with query params) and different XML namespaces than standard CRUD operations.

- [ ] Define the `ChangePackageParams` interface:
  ```typescript
  export interface ChangePackageParams {
    objectUri: string;      // ADT URI, e.g., "/sap/bc/adt/ddic/ddl/sources/zarc1_dv_mnzqp5v11pd2"
    objectType: string;     // ADT type, e.g., "DDLS/DF"
    objectName: string;     // Object name, e.g., "ZARC1_DV_MNZQP5V11PD2"
    oldPackage: string;     // Current package, e.g., "$TMP"
    newPackage: string;     // Target package, e.g., "Z_LLM_TEST_PACKAGE"
    transport?: string;     // Optional transport request number
    description?: string;   // Object description (used in XML, defaults to object type label)
  }
  ```

- [ ] Implement `buildPreviewXml(params: ChangePackageParams): string` that generates the "wrapped" preview XML with:
  - Root element: `<changepackage:changePackageRefactoring>` with xmlns for adtcore, generic, changepackage
  - `<changepackage:oldPackage>` and `<changepackage:newPackage>` elements
  - Inner `<generic:genericRefactoring>` with title, adtObjectUri, affectedObjects (single object with changePackageDelta), transport, ignoreSyntaxErrors flags
  - `<changepackage:userContent>` element

- [ ] Implement `buildExecuteXml(params: ChangePackageParams): string` that generates the "unwrapped" execute XML with:
  - Root element: `<generic:genericRefactoring>` with xmlns for generic and adtcore (NO changepackage wrapper)
  - Same inner structure as preview's genericRefactoring: title, adtObjectUri, affectedObjects, transport

- [ ] Implement `parsePreviewResponse(xml: string): { transport?: string }` that extracts transport from the preview response XML using regex or fast-xml-parser. The preview response is a `<generic:genericRefactoring>` element. Extract the `<generic:transport>` value if non-empty.

- [ ] Implement `async changePackage(http: AdtHttpClient, safety: SafetyConfig, params: ChangePackageParams): Promise<{ transport?: string }>` that:
  1. Calls `checkOperation(safety, OperationType.Update, 'ChangePackage')`
  2. POSTs preview XML to `/sap/bc/adt/refactorings?step=preview&rel=http://www.sap.com/adt/relations/refactoring/changepackage` with `Content-Type: application/*` and `Accept: application/*`
  3. Parses preview response to extract server-assigned transport (if any)
  4. Merges transport: explicit param > preview response > empty string
  5. POSTs execute XML to `/sap/bc/adt/refactorings?step=execute` with same content type
  6. Returns `{ transport }` with the transport used (if any)

- [ ] Add unit tests (~12 tests) in `tests/unit/adt/refactoring.test.ts`:
  - `buildPreviewXml` generates correct wrapped XML structure with all namespaces
  - `buildPreviewXml` includes oldPackage, newPackage, objectUri, objectType, objectName
  - `buildPreviewXml` includes transport when provided
  - `buildPreviewXml` has empty transport element when no transport
  - `buildExecuteXml` generates unwrapped XML (no changePackageRefactoring wrapper)
  - `buildExecuteXml` includes transport when provided
  - `parsePreviewResponse` extracts transport from response XML
  - `parsePreviewResponse` returns undefined transport when element is empty
  - `changePackage` calls preview then execute with correct URLs
  - `changePackage` uses server-assigned transport from preview when no explicit transport
  - `changePackage` uses explicit transport even when preview returns different one
  - `changePackage` throws AdtSafetyError when Update operation is blocked

- [ ] Ensure ESM imports use `.js` extensions. Import `checkOperation`, `OperationType`, `SafetyConfig` from `./safety.js` and `AdtHttpClient` from `./http.js`.

- [ ] Run `npm test` — all tests must pass

### Task 2: Wire change_package into SAPManage handler

**Files:**
- Modify: `src/handlers/schemas.ts` (~line 422)
- Modify: `src/handlers/tools.ts` (~line 846)
- Modify: `src/handlers/intent.ts` (~line 3010)
- Modify: `tests/unit/handlers/intent.test.ts` (~line 2505)
- Modify: `tests/unit/handlers/schemas.test.ts`

Connect the refactoring module to the MCP tool layer by adding `change_package` as a new SAPManage action. Follow the existing `create_package`/`delete_package` patterns exactly.

- [ ] In `src/handlers/schemas.ts`, add `'change_package'` to the `SAPManageSchema` action enum (after `'delete_package'` at ~line 428). Add new optional string fields to the schema: `objectUri`, `objectType`, `objectName`, `oldPackage`, `newPackage`. The existing `name`, `transport` fields are already available and will be reused.

- [ ] In `src/handlers/tools.ts`, add `'change_package'` to the SAPManage action enum (~line 851). Update the action description (~line 861) from "package lifecycle (create/delete)" to "package lifecycle (create/delete/move)". Add new properties to the inputSchema:
  - `objectUri` (string): "ADT URI of the object to move (e.g., /sap/bc/adt/oo/classes/zcl_my_class). If not provided, resolved automatically from objectName + objectType."
  - `objectType` (string): "ADT object type (e.g., CLAS/OC, DDLS/DF, PROG/P). Required for change_package."
  - `objectName` (string): "Object name to move (e.g., ZCL_MY_CLASS). Required for change_package."
  - `oldPackage` (string): "Current package of the object. Required for change_package."
  - `newPackage` (string): "Target package to move the object to. Required for change_package."
  - Update the `transport` description to mention change_package

- [ ] In `src/handlers/intent.ts`, add a new case `'change_package'` in the `handleSAPManage` switch statement (after `delete_package` at ~line 3112). Implementation:
  1. Extract params: `objectUri`, `objectType`, `objectName`, `oldPackage`, `newPackage`, `transport` from args
  2. Validate required params: `objectName`, `objectType`, `oldPackage`, `newPackage` (return `errorResult` if missing)
  3. Call `checkPackage(client.safety, oldPackage)` and `checkPackage(client.safety, newPackage)` — both must be in the allowlist
  4. If `objectUri` is not provided, resolve it: use `client.http.get()` on the search endpoint (`/sap/bc/adt/repository/informationsystem/search?operation=quickSearch&query=${objectName}&maxResults=5`) and find the matching entry by type. Extract the `adtcore:uri` attribute. If not found, return `errorResult`.
  5. Transport pre-flight: if no explicit transport and `newPackage` is not `$TMP`, use `getTransportInfo()` (same pattern as `create_package` lines 3042-3068) to auto-detect. If transport is required but not found, return `errorResult` with the same helpful message format.
  6. Call `changePackage(client.http, client.safety, { objectUri, objectType, objectName, oldPackage, newPackage, transport })` from the new refactoring module
  7. Return `textResult` with success message including object name, old package, new package, and transport used (if any)
  8. Import `changePackage` from `../../adt/refactoring.js` at the top of the file

- [ ] Add unit tests (~10 tests) in `tests/unit/handlers/intent.test.ts` (in the SAPManage describe block, after the delete_package tests ~line 2550):
  - `change_package` calls refactoring preview then execute endpoints (mock both POSTs)
  - `change_package` returns error when objectName is missing
  - `change_package` returns error when objectType is missing
  - `change_package` returns error when oldPackage is missing
  - `change_package` returns error when newPackage is missing
  - `change_package` is blocked by read-only safety mode
  - `change_package` is blocked when old package not in allowlist
  - `change_package` is blocked when new package not in allowlist
  - `change_package` passes transport in XML when provided
  - `change_package` success message includes object name and packages

- [ ] Add schema validation tests in `tests/unit/handlers/schemas.test.ts`:
  - `change_package` is accepted as valid action
  - Schema accepts all change_package params (objectUri, objectType, objectName, oldPackage, newPackage, transport)

- [ ] Run `npm test` — all tests must pass
- [ ] Run `npm run typecheck` — no errors
- [ ] Run `npm run lint` — no errors

### Task 3: Add integration tests

**Files:**
- Modify: `tests/integration/adt.integration.test.ts`

Add integration tests that exercise the change_package flow against the real SAP A4H system. Use object `ZARC1_DV_MNZQP5V11PD2` (a DDLS in `$TMP`) as the test object. The test moves it to `Z_LLM_TEST_PACKAGE` and back.

Integration tests require `TEST_SAP_URL`, `TEST_SAP_USER`, `TEST_SAP_PASSWORD` env vars (see `tests/integration/helpers.ts` for `getTestClient()`). They run sequentially (`vitest.integration.config.ts`).

- [ ] Add a `describe('changePackage refactoring')` block in the integration test file. Import `changePackage` from `../../src/adt/refactoring.js`.

- [ ] Add test: "moves object from $TMP to transportable package":
  1. Use `getTestClient()` to create a client
  2. First verify object is in `$TMP` via search endpoint
  3. Create a transport request for the move (use `client.http.post()` to CTS endpoint, same pattern as existing transport tests)
  4. Call `changePackage(client.http, client.safety, { objectUri: '/sap/bc/adt/ddic/ddl/sources/zarc1_dv_mnzqp5v11pd2', objectType: 'DDLS/DF', objectName: 'ZARC1_DV_MNZQP5V11PD2', oldPackage: '$TMP', newPackage: 'Z_LLM_TEST_PACKAGE', transport })` 
  5. Verify object is now in `Z_LLM_TEST_PACKAGE` via search endpoint
  6. In `finally` block: release the transport task+request, then move back to `$TMP` (cleanup). Tag cleanup catch with `// best-effort-cleanup`.

- [ ] Add test: "move fails without transport when target is transportable":
  1. Wrap in try/catch
  2. Call `changePackage` without transport, targeting `Z_LLM_TEST_PACKAGE`
  3. Expect an `AdtApiError` with status 500 and message containing "request" (TK 136)
  4. Use `expectSapFailureClass(err, [500], [/request/i])` from `tests/helpers/expected-error.ts`

- [ ] Add test: "move fails when object is locked in transport":
  1. This tests the TK 760 error case
  2. Move object to `Z_LLM_TEST_PACKAGE` (with transport), then immediately try to move again without releasing
  3. Expect error about locked objects
  4. Cleanup: release transport, move back to `$TMP`

- [ ] Use `requireOrSkip()` from `tests/helpers/skip-policy.ts` for credentials. Use `SkipReason.NO_CREDENTIALS` if `TEST_SAP_URL` is not set.

- [ ] Run `npm run test:integration` — all tests must pass (or skip cleanly if no credentials)

### Task 4: Update documentation and roadmap

**Files:**
- Modify: `docs/tools.md` (~line 601, SAPManage section)
- Modify: `docs/roadmap.md` (~line 1267, FEAT-05)
- Modify: `docs/compare/abap-adt-api/evaluations/a55c8f8-change-package.md`
- Modify: `CLAUDE.md` (Key Files table ~line 183)

Update all documentation artifacts to reflect the new `change_package` action.

- [ ] In `docs/tools.md`, update the SAPManage section:
  - Add `change_package` to the action list
  - Add parameter descriptions for `objectUri`, `objectType`, `objectName`, `oldPackage`, `newPackage`
  - Update the `transport` description to mention `change_package`
  - Add an example showing `change_package` usage
  - Add a note about transport requirements (required when moving to transportable packages)

- [ ] In `docs/roadmap.md`, update FEAT-05:
  - Update status from "Not started" to reflect partial completion
  - Add note that `change_package` is implemented as SAPManage action; rename and extract-method remain future work
  - Add entry in the current state feature matrix if appropriate

- [ ] In `docs/compare/abap-adt-api/evaluations/a55c8f8-change-package.md`:
  - Update "ARC-1 current state" section to reflect implementation
  - Update "Decision" from "Consider future" to "Implemented"
  - Note the implementation approach (SAPManage action, not standalone refactoring tool)

- [ ] In `CLAUDE.md`, update the Key Files table:
  - Change "Add package create/delete (DEVC)" row to "Add package create/move/delete (DEVC)"
  - Add `src/adt/refactoring.ts` to the file list for that row
  - Add a new row: "Add refactoring operations" pointing to `src/adt/refactoring.ts`, `src/handlers/intent.ts`, `src/handlers/tools.ts`, `src/handlers/schemas.ts`

- [ ] Run `npm run lint` — no errors (docs aren't linted but verify no accidental code changes)

### Task 5: Final verification

- [ ] Run full test suite: `npm test` — all tests pass
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors
- [ ] Verify the new module is properly imported and exported (check that `src/adt/refactoring.ts` doesn't break the build)
- [ ] Verify the change_package action appears in SAPManage tool definition (check `src/handlers/tools.ts` has it in the enum)
- [ ] Move this plan to `docs/plans/completed/`
