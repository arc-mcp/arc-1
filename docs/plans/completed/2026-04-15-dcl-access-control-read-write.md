# FEAT-37: DCL (Access Control) Read/Write

## Overview

Add full read and write support for CDS access control objects (DCL/DCLS) to ARC-1. DCL objects define row-level authorization rules for CDS views — every production CDS entity needs an access control to restrict data access. This is the last missing piece in ARC-1's RAP development workflow: TABL, DDLS, DDLX, BDEF, SRVD, SRVB are all supported, but DCL is absent.

The implementation follows the same pattern as DDLS (CDS views): source-based read/write via `/source/main`, `application/*` wildcard content type for creation, and standard lock/modify/unlock CRUD flow. The ADT API has been verified on the SAP test system — all endpoints confirmed working.

After this feature, ARC-1 will support the complete RAP object lifecycle: TABL → DDLS → **DCLS** → BDEF → SRVD → SRVB.

## Context

### Current State
- ARC-1 supports DDLS, DDLX, BDEF, SRVD, SRVB for RAP development
- DCL (Access Control) objects cannot be read or written — LLMs must tell users to create them manually in ADT
- RAP skills (`generate-rap-service.md`, `generate-rap-logic.md`) explicitly document DCL as a limitation: "ARC-1 does not yet support DCL read/write (FEAT-37)"
- sapcli and vibing-steampunk already support DCL read/write

### Target State
- `DCLS` available in SAPRead (on-prem + BTP) and SAPWrite (on-prem + BTP)
- Full CRUD: read source, create, update, delete — same as DDLS
- DCL included in `batch_create` for automated RAP stack generation
- E2E tests covering DCL lifecycle within a RAP stack
- RAP skills updated to generate DCL objects automatically
- Feature matrix, roadmap, CLAUDE.md all updated

### API Details (Verified on SAP Test System)

| Aspect | Value |
|--------|-------|
| **Base path** | `/sap/bc/adt/acm/dcl/sources` |
| **Source read** | `GET /sap/bc/adt/acm/dcl/sources/{name}/source/main` |
| **Source write** | `PUT /sap/bc/adt/acm/dcl/sources/{name}/source/main` |
| **Create** | `POST /sap/bc/adt/acm/dcl/sources` |
| **Delete** | `DELETE /sap/bc/adt/acm/dcl/sources/{name}` |
| **Search type** | `DCLS` (sub-type `DCLS/DL`) |
| **XML namespace** | `http://www.sap.com/adt/acm/dclsources` |
| **XML root element** | `dcl:dclSource` |
| **Create content type** | `application/vnd.sap.adt.dclSource+xml` or `application/*` |
| **Metadata content type** | `application/vnd.sap.adt.dclSource+xml` |
| **Source content type** | `text/plain` |
| **TADIR type code** | `DCLS/DL` |

**Important:** The base path is `/sap/bc/adt/acm/dcl/sources` (under `acm`, NOT `/ddic/dcl/sources`). The roadmap incorrectly references the sapcli shorthand `/dcl/sources`.

### Key Files

| File | Role |
|------|------|
| `src/adt/client.ts` | ADT client — add `getDcl()` read method (~line 250) |
| `src/handlers/intent.ts` | Tool router — add DCLS to `objectBasePath()` (~line 1732), `buildCreateXml()` (~line 1461), `handleSAPRead()` (~line 698), DDIC hint sets (~line 164) |
| `src/handlers/schemas.ts` | Zod schemas — add DCLS to all 4 type arrays (~lines 17-151) |
| `src/handlers/tools.ts` | Tool definitions — add DCLS to type arrays + descriptions (~lines 37-143) |
| `tests/unit/adt/client.test.ts` | Unit tests for client read operations |
| `tests/unit/handlers/intent.test.ts` | Unit tests for handler routing |
| `tests/e2e/rap-write.e2e.test.ts` | E2E tests for RAP lifecycle |
| `tests/e2e/fixtures.ts` | E2E fixture definitions |
| `tests/fixtures/abap/` | ABAP source fixtures |

### Design Principles

1. **Follow DDLS pattern exactly** — DCL is source-based (like DDLS/BDEF/SRVD), not metadata-based (like DOMA/DTEL/MSAG). Use `application/*` wildcard content type for creation, `text/plain` for source, standard lock/modify/unlock CRUD.
2. **Use `DCLS` as the type code** — matches SAP TADIR, search API, and ARC-1 conventions (DDLS, DDLX, etc.). NOT `DCL`.
3. **ACM base path** — `/sap/bc/adt/acm/dcl/sources`, not `/ddic/dcl/sources`. This is confirmed by the SAP test system.
4. **Available on both on-prem and BTP** — DCL objects are part of ABAP Cloud; add to both type lists.
5. **Add to DDIC hint/check sets** — DCL is a CDS-family object; benefit from post-save syntax checks and save-error hints.
6. **No CDS syntax guard needed** — `guardCdsSyntax()` only applies to DDLS (checks for `define view entity` vs `define view`). DCL syntax is different.

## Development Approach

- Implement foundation (client + handler routing + schemas) first, then tests, then docs/skills
- Unit tests mock the HTTP layer; E2E tests exercise full MCP stack against live SAP
- DCL E2E test extends the existing RAP lifecycle test in `rap-write.e2e.test.ts`

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Add DCL read method to ADT client

**Files:**
- Modify: `src/adt/client.ts`
- Modify: `tests/unit/adt/client.test.ts`

Add a `getDcl(name)` method to `AdtClient` following the exact pattern of `getDdls()` at line 246. The method reads DCL source code from `/sap/bc/adt/acm/dcl/sources/{name}/source/main`.

- [ ] Add `getDcl(name: string): Promise<string>` method to `AdtClient` class after `getDdls()` (~line 250). Pattern: `checkOperation(this.safety, OperationType.Read, 'GetDCL')`, then `this.http.get(...)`, return `resp.body`. URL: `/sap/bc/adt/acm/dcl/sources/${encodeURIComponent(name)}/source/main`
- [ ] Add unit test in `tests/unit/adt/client.test.ts` — "getDcl returns source code" following the `getProgram` test pattern at line 42. Verify the method returns string content and the fetch URL contains `/acm/dcl/sources/`
- [ ] Add unit test for safety check — "getDcl blocked in read-only with Read op disabled" following existing safety tests in the same file
- [ ] Run `npm test` — all tests must pass

### Task 2: Add DCLS to handler routing (objectBasePath, buildCreateXml, SAPRead)

**Files:**
- Modify: `src/handlers/intent.ts`

Wire DCLS into the intent handler: object URL mapping, creation XML template, SAPRead routing, and DDIC hint/check sets. All additions follow existing DDLS patterns in this file.

- [ ] Add DCLS case to `objectBasePath()` function (~line 1746, after the DDLS case): `case 'DCLS': return '/sap/bc/adt/acm/dcl/sources/';`
- [ ] Add DCLS case to `buildCreateXml()` function (~line 1472, after the DDLS case). Use XML namespace `http://www.sap.com/adt/acm/dclsources`, root element `dcl:dclSource`, type code `DCLS/DL`. Template:
  ```xml
  <?xml version="1.0" encoding="UTF-8"?>
  <dcl:dclSource xmlns:dcl="http://www.sap.com/adt/acm/dclsources"
                 xmlns:adtcore="http://www.sap.com/adt/core"
                 adtcore:description="${escapeXml(description)}"
                 adtcore:name="${escapeXml(name)}"
                 adtcore:type="DCLS/DL"
                 adtcore:masterLanguage="EN"
                 adtcore:masterSystem="H00"
                 adtcore:responsible="DEVELOPER">
    <adtcore:packageRef adtcore:name="${escapeXml(pkg)}"/>
  </dcl:dclSource>
  ```
- [ ] Add DCLS case to `handleSAPRead()` switch statement (~line 711, after DDLS case). Follow the BDEF/SRVD pattern (simpler than DDLS — no empty-source hint or elements extraction needed): use `cachedGet('DCLS', name, () => client.getDcl(name))` and return `cachedTextResult(source, cacheHit)`
- [ ] Add `'DCLS'` to the `DDIC_SAVE_HINT_TYPES` Set at line 164 — enables helpful error messages on save failure
- [ ] Add `'DCLS'` to the `DDIC_POST_SAVE_CHECK_TYPES` Set at line 165 — enables post-creation syntax check on inactive object
- [ ] Run `npm test` — all tests must pass
- [ ] Run `npm run typecheck` — no errors

### Task 3: Add DCLS to Zod schemas and tool definitions

**Files:**
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`

Add DCLS to all type arrays and update tool descriptions for both on-prem and BTP variants.

- [ ] In `src/handlers/schemas.ts`: Add `'DCLS'` to `SAPREAD_TYPES_ONPREM` array (line 17, after `'DDLS'`), `SAPREAD_TYPES_BTP` array (line 49, after `'DDLS'`), `SAPWRITE_TYPES_ONPREM` array (line 123, after `'DDLS'`), `SAPWRITE_TYPES_BTP` array (line 139, after `'DDLS'`)
- [ ] In `src/handlers/tools.ts`: Add `'DCLS'` to `SAPREAD_TYPES_ONPREM` array (line 37, after `'DDLS'`), `SAPREAD_TYPES_BTP` array (line 70, after `'DDLS'`), `SAPWRITE_TYPES_ONPREM` array (line 103, after `'DDLS'`), `SAPWRITE_TYPES_BTP` array (line 119, after `'DDLS'`)
- [ ] Update `SAPREAD_DESC_ONPREM` (line 95) to include DCLS: add `DCLS (CDS access control — authorization rules for CDS views)` in the type list after DDLX
- [ ] Update `SAPREAD_DESC_BTP` (line 98) to include DCLS with same description
- [ ] Update `SAPWRITE_DESC_ONPREM` (line 121) to add DCLS to the supported types list
- [ ] Update `SAPWRITE_DESC_BTP` (line 133) to add DCLS to the supported types list
- [ ] Run `npm test` — all tests must pass
- [ ] Run `npm run typecheck` — no errors

### Task 4: Add unit tests for DCL handler routing

**Files:**
- Modify: `tests/unit/handlers/intent.test.ts`

Add unit tests for DCLS read, create, update, and delete operations in the handler test file. Follow existing test patterns for DDLS/BDEF.

- [ ] Search `tests/unit/handlers/intent.test.ts` for existing DDLS or BDEF test patterns to follow. Use `grep -n "DDLS\|BDEF"` in the test file to find the patterns
- [ ] Add test: "SAPRead DCLS returns source code" — call handleToolCall with `{ tool: 'SAPRead', args: { type: 'DCLS', name: 'ZTEST_DCL' } }`, verify mock fetch was called with URL containing `/acm/dcl/sources/ZTEST_DCL/source/main`
- [ ] Add test: "SAPWrite create DCLS posts correct XML" — call handleToolCall with `{ tool: 'SAPWrite', args: { action: 'create', type: 'DCLS', name: 'ZTEST_DCL', package: '$TMP', source: '...' } }`, verify the creation POST body contains `dcl:dclSource` and `http://www.sap.com/adt/acm/dclsources` namespace, and type `DCLS/DL`
- [ ] Add test: "SAPWrite update DCLS writes source" — verify source update flow works for DCLS
- [ ] Add test: "SAPWrite delete DCLS deletes object" — verify delete flow
- [ ] Add test (~2 tests): Verify DCLS appears in `objectBasePath()` returning `/sap/bc/adt/acm/dcl/sources/` and that `sourceUrlForType('DCLS', 'ZTEST')` returns the correct full path
- [ ] Run `npm test` — all tests must pass

### Task 5: Add E2E test for DCL lifecycle

**Files:**
- Modify: `tests/e2e/rap-write.e2e.test.ts`
- Create: `tests/fixtures/abap/zarc1_e2e_dcl.abap`

Add an E2E test for DCL create → write source → activate → read → delete lifecycle. This extends the existing RAP lifecycle tests in `rap-write.e2e.test.ts`.

- [ ] Create fixture file `tests/fixtures/abap/zarc1_e2e_dcl.abap` with a minimal valid DCL source:
  ```
  @EndUserText.label: 'E2E Test Access Control'
  @MappingRole: true
  define role {OBJECT_NAME} {
    grant select on {VIEW_NAME}
    where inheriting conditions from super;
  }
  ```
  Note: The actual source will be generated dynamically in the test using `uniqueName()` for both the DCL name and its referenced DDLS view name, so this fixture is a template reference only.

- [ ] Add a new E2E test in `rap-write.e2e.test.ts` — "DCLS lifecycle: create, activate, read, delete" — following the existing DDLS test pattern (~line 228). The test should:
  1. Use `requireOrSkip(ctx, rapAvailable, ...)` to skip if RAP is not available (same as other RAP tests)
  2. Create a TABL with `uniqueName()` (foundation table)
  3. Create + activate a DDLS (CDS view) that selects from the TABL
  4. Create a DCLS with `SAPWrite(action='create', type='DCLS', name=dclName, package='$TMP', source='...')` where source is a valid access control for the DDLS view
  5. Activate the DCLS with `SAPActivate`
  6. Read the DCLS with `SAPRead(type='DCLS', name=dclName)` and verify the source contains `define role`
  7. Clean up in `finally` block in reverse order: delete DCLS → delete DDLS → delete TABL using `bestEffortDelete()`

- [ ] Also add DCLS to the existing batch_create test (~line 651) if feasible — create a batch with TABL + DDLS + DCLS in one call. If batch_create doesn't support DCL ordering well, skip this sub-step.

- [ ] Run `npm run test:e2e` against a running MCP server to verify (if available). If not available, document that E2E tests need manual verification.

### Task 6: Update RAP skills to support DCL

**Files:**
- Modify: `skills/generate-rap-service.md`
- Modify: `skills/generate-rap-service-researched.md`
- Modify: `skills/generate-rap-logic.md`
- Modify: `skills/explain-abap-code.md`

Now that DCLS is supported, update the RAP skills to generate access control objects automatically instead of telling users to create them manually in ADT.

- [ ] In `skills/generate-rap-service.md`:
  - Remove the FEAT-37 limitation note (~line 731: "Access control (DCL): ARC-1 does not yet support DCL read/write")
  - Add DCLS to the artifact creation workflow after DDLS creation: generate a DCL object for each CDS view with `@AccessControl.authorizationCheck: #NOT_REQUIRED` → change annotation to `#CHECK` and create a basic access control using `SAPWrite(action='create', type='DCLS', ...)`
  - Add DCL template to the naming conventions section (e.g., `Z{PREFIX}_I_{ENTITY}_D` or matching the view name)
  - Update the dependency chain: TABL → DDLS → **DCLS** → BDEF → SRVD → SRVB
  - Update the next-steps section to remove "Add access control (DCLS)" as a manual post-step

- [ ] In `skills/generate-rap-service-researched.md`:
  - Remove the FEAT-37 limitation note (~line 873)
  - Add DCL to the research phase: "Check if existing RAP stacks have access control patterns"
  - Add an authorization question to the clarifying questions phase
  - Add DCLS creation steps to the implementation plan template
  - Update the next-steps section

- [ ] In `skills/generate-rap-logic.md`:
  - Update references to note that DCL is now supported
  - Add a note about behavior-level vs CDS-level authorization when relevant

- [ ] In `skills/explain-abap-code.md`:
  - Add DCLS to the optional reads in step 1e: when explaining a CDS view, also try to read its DCLS to explain authorization rules
  - Add a "Security / Authorization" section to the explanation when a DCLS exists

### Task 7: Update documentation and project artifacts

**Files:**
- Modify: `docs/roadmap.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `docs/tools.md`
- Modify: `CLAUDE.md`

Update all project documentation to reflect the new DCLS support.

- [ ] In `docs/roadmap.md`:
  - Update FEAT-37 status from "Not started" to "✅ Completed" with current date
  - Strike through the item in the master table (row 37)
  - Strike through the item in the Phase B section (~line 169)
  - Update the note at line 1223 to reflect that DCL is now complete: "SRVB and DCL are now covered end-to-end"

- [ ] In `docs/compare/00-feature-matrix.md`:
  - Update row 117 (RAP CRUD) for ARC-1 column: change to `✅ (DDLS, DDLX, DCLS, BDEF, SRVD, SRVB write)`
  - Update row 129 (DCL write): change ARC-1 from `❌ (FEAT-37)` to `✅`

- [ ] In `docs/tools.md`: Add DCLS to the SAPRead and SAPWrite type documentation sections. Brief description: "DCLS — CDS access control objects (authorization rules for CDS views). Read returns the DCL source code. Write supports create, update, delete."

- [ ] In `CLAUDE.md`:
  - Add `DCLS` to the type lists mentioned in the codebase description where DDLS/BDEF/SRVD are listed
  - Add "Add DCL (access control) read/write" entry to the Key Files table pointing to `src/adt/client.ts`, `src/handlers/intent.ts`
  - Update the handler pattern section if needed

- [ ] Run `npm run lint` — no errors

### Task 8: Final verification

- [ ] Run full test suite: `npm test` — all tests pass
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors
- [ ] Verify DCLS appears in both SAPRead and SAPWrite type enums by grepping schemas.ts and tools.ts
- [ ] Verify `objectBasePath('DCLS')` returns `/sap/bc/adt/acm/dcl/sources/` by checking intent.ts
- [ ] Verify `buildCreateXml('DCLS', ...)` produces valid XML with namespace `http://www.sap.com/adt/acm/dclsources`
- [ ] Verify roadmap FEAT-37 is marked completed
- [ ] Verify feature matrix row 129 shows ✅ for ARC-1
- [ ] Move this plan to `docs/plans/completed/`
