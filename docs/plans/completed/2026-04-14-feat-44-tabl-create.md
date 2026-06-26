# Plan: FEAT-44 TABL (Database Table) Create/Update/Delete

## Overview

Add create, update, and delete support for DDIC database tables (TABL) to the SAPWrite tool. Tables are a prerequisite for CDS-based RAP development — root views reference persistent tables, and draft tables are required for managed BOs with draft. Two real-world RAP projects ([Xexer/abap_rap_blog](https://github.com/Xexer/abap_rap_blog) with 8 tables, [SAP-samples/cloud-abap-rap](https://github.com/SAP-samples/cloud-abap-rap) with 15 tables) cannot be created end-to-end without TABL write support.

**Critical design decision:** TABL is a **source-based** type, not a metadata-based type like DOMA/DTEL. Research from abap-adt-api (gold standard) confirms that table creation uses a `blue:blueSource` XML shell (like BDEF), and field definitions are written via `/source/main` as CDS-style source text. This means TABL follows the same create-then-write-source pattern as DDLS/BDEF/SRVD, NOT the XML-metadata pattern of DOMA/DTEL.

Key findings from abap-adt-api and sapcli:
- **XML shell:** `<blue:blueSource>` root element with `adtcore:type="TABL/DT"`, namespace `http://www.sap.com/wbobj/blue`
- **Content-type for creation:** `application/*` (same as DDLS/BDEF — the wildcard lets SAP resolve)
- **Source URL:** `/sap/bc/adt/ddic/tables/{name}/source/main` (already used by ARC-1's `getTable()`)
- **Source format:** CDS-like definition text (`@EndUserText.label : 'description'\ndefine table ztable {\n  key client : abap.clnt;\n  ...}`)
- **Activation required:** Yes, standard activation after create

## Context

### Current State

- TABL **read** is fully implemented: `client.getTable(name)` reads source from `/sap/bc/adt/ddic/tables/{name}/source/main`
- `objectBasePath('TABL')` already returns `/sap/bc/adt/ddic/tables/` (intent.ts line ~1507)
- `SAPREAD_TYPES` includes TABL for both on-prem and BTP
- `SAPWRITE_TYPES` does NOT include TABL
- `buildCreateXml()` has no TABL case — falls through to generic objectReferences (which would fail)
- `isDdicMetadataType()` returns false for TABL (correct — TABL is source-based)
- The existing BDEF case in `buildCreateXml()` (line ~1370) uses `blue:blueSource` — TABL uses the same XML root element

### Target State

- SAPWrite supports `create`, `update`, `delete` for TABL
- `batch_create` also supports TABL (critical for RAP stack creation: tables → CDS views → BDEF → SRVD)
- TABL creation: POST shell XML to `/sap/bc/adt/ddic/tables/`, then PUT source to `/source/main`
- TABL update: standard lock → PUT source → unlock (same as DDLS/BDEF)
- TABL delete: standard lock → DELETE → unlock

### Key Files

| File | Role |
|------|------|
| `src/handlers/intent.ts` | `handleSAPWrite()` (line ~1551), `buildCreateXml()` (line ~1302), `objectBasePath()` (line ~1483), `isDdicMetadataType()` (line ~1042), `needsVendorContentType()` (line ~1047) |
| `src/handlers/tools.ts` | `SAPWRITE_TYPES_ONPREM` / `SAPWRITE_TYPES_BTP` (line ~103-104), tool descriptions (line ~106-118) |
| `src/handlers/schemas.ts` | Zod `SAPWRITE_TYPES_ONPREM` / `SAPWRITE_TYPES_BTP` (line ~123-136), batch object schemas |
| `src/adt/client.ts` | `getTable(name)` at line ~281 — reads via `/source/main` |
| `src/adt/crud.ts` | `createObject()`, `safeUpdateSource()`, delete flow — all reusable |
| `src/adt/ddic-xml.ts` | Existing DOMA/DTEL builders — reference for XML builder pattern |
| `tests/unit/handlers/intent.test.ts` | SAPWrite handler tests |
| `tests/unit/adt/ddic-xml.test.ts` | DDIC XML builder tests — reference for test pattern |
| `tests/e2e/rap-write.e2e.test.ts` | RAP write lifecycle E2E tests — add TABL lifecycle here |

### Design Principles

1. **Source-based, not metadata-based**: TABL uses `/source/main` like DDLS/BDEF/SRVD. Do NOT add TABL to `isDdicMetadataType()`. The create flow is: POST shell XML → write source via PUT → activate.
2. **Reuse BDEF's blue:blueSource pattern**: The XML shell for TABL creation is nearly identical to BDEF — same root element, same namespace, only `adtcore:type` differs (`TABL/DT` vs `BDEF/BDO`).
3. **No new CRUD primitives needed**: `createObject()`, `safeUpdateSource()`, and the delete flow in intent.ts all work as-is for TABL.
4. **BTP compatibility**: TABL is supported on BTP ABAP Environment (for custom tables). Add to both on-prem and BTP write type arrays.
5. **Content-type**: Use `application/*` for creation (matching abap-adt-api's approach), not a vendor-specific type. Do NOT add TABL to `needsVendorContentType()`.

## Development Approach

- Follow the BDEF pattern exactly since TABL uses the same XML root element
- The main changes are: add TABL to type arrays, add TABL case to `buildCreateXml()`, update descriptions
- Test with XML snapshot assertions on the builder, plus E2E lifecycle on the test system

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Add TABL to write type arrays and buildCreateXml

**Files:**
- Modify: `src/handlers/tools.ts`
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`
- Modify: `tests/unit/adt/ddic-xml.test.ts`

Add TABL as a writable type and implement the creation XML builder. TABL uses the same `blue:blueSource` XML shell as BDEF (line ~1370 in intent.ts), with `adtcore:type="TABL/DT"` instead of `BDEF/BDO`.

- [ ] Add `'TABL'` to `SAPWRITE_TYPES_ONPREM` array in `src/handlers/tools.ts` (line ~103) — insert after `'SRVD'` to keep alphabetical grouping with other DDIC types
- [ ] Add `'TABL'` to `SAPWRITE_TYPES_BTP` array in `src/handlers/tools.ts` (line ~104)
- [ ] Update `SAPWRITE_DESC_ONPREM` (line ~106) and `SAPWRITE_DESC_BTP` (line ~113) to mention TABL in the supported types list
- [ ] Add `'TABL'` to `SAPWRITE_TYPES_ONPREM` array in `src/handlers/schemas.ts` (line ~123)
- [ ] Add `'TABL'` to `SAPWRITE_TYPES_BTP` array in `src/handlers/schemas.ts` (line ~136)
- [ ] Add `'TABL'` to the batch object schema type enums in `src/handlers/schemas.ts` (both `batchObjectSchemaOnprem` at line ~144 and `batchObjectSchemaBtp` at line ~172)
- [ ] Add a `case 'TABL':` to `buildCreateXml()` in `src/handlers/intent.ts` (line ~1302). The XML is identical to the BDEF case (line ~1370) except `adtcore:type="TABL/DT"`. Use:
  ```xml
  <?xml version="1.0" encoding="UTF-8"?>
  <blue:blueSource xmlns:blue="http://www.sap.com/wbobj/blue"
                   xmlns:adtcore="http://www.sap.com/adt/core"
                   adtcore:description="${escapeXml(description)}"
                   adtcore:name="${escapeXml(name)}"
                   adtcore:type="TABL/DT"
                   adtcore:masterLanguage="EN"
                   adtcore:masterSystem="H00"
                   adtcore:responsible="DEVELOPER">
    <adtcore:packageRef adtcore:name="${escapeXml(pkg)}"/>
  </blue:blueSource>
  ```
- [ ] Verify that TABL does NOT need to be added to `isDdicMetadataType()` (line ~1042) — TABL is source-based, not metadata-based. The existing `case 'create':` handler (line ~1611) will correctly follow the source-write path (step 2: write source if provided).
- [ ] Verify that TABL does NOT need to be added to `needsVendorContentType()` (line ~1047) — TABL uses `application/*` like DDLS/SRVD.
- [ ] Add unit tests (~5 tests) in `tests/unit/handlers/intent.test.ts`:
  - `buildCreateXml('TABL', ...)` produces correct XML with `blue:blueSource` root and `TABL/DT` type
  - SAPWrite create with type=TABL calls createObject + safeUpdateSource (not safeUpdateObject)
  - SAPWrite update with type=TABL calls safeUpdateSource (source-based, not metadata)
  - SAPWrite delete with type=TABL follows lock/delete/unlock
  - SAPWrite batch_create with TABL processes source correctly
- [ ] Run `npm test` — all tests must pass

### Task 2: Update tool descriptions and JSON Schema

**Files:**
- Modify: `src/handlers/tools.ts`
- Modify: `docs/tools.md`

Update the SAPWrite tool description and JSON Schema input properties to document TABL support, and update the tools reference doc.

- [ ] In `src/handlers/tools.ts`, update the SAPWrite `inputSchema.properties.type.description` to mention TABL alongside other supported types
- [ ] In `src/handlers/tools.ts`, update the `objects` array item description to mention TABL can be included in batch_create for RAP stack creation
- [ ] In `docs/tools.md`, add TABL to the SAPWrite supported types table. Add an example showing TABL creation with source:
  ```
  SAPWrite(action="create", type="TABL", name="ZTRAVEL", package="$TMP",
    source="@EndUserText.label : 'Travel'\ndefine table ztravel {\n  key client : abap.clnt;\n  key travel_id : abap.numc(8);\n  description : abap.char(256);\n}")
  ```
- [ ] In `docs/tools.md`, update the batch_create example to show a TABL → DDLS → BDEF → SRVD sequence
- [ ] Run `npm test` — all tests must pass

### Task 3: Add E2E test for TABL lifecycle

**Files:**
- Modify: `tests/e2e/rap-write.e2e.test.ts`

Add a TABL create → read → update → activate → delete lifecycle test to the RAP write E2E suite. This test exercises the full MCP JSON-RPC stack.

- [ ] Add a new test case to `tests/e2e/rap-write.e2e.test.ts`: `'SAPWrite create TABL, read, update, activate, delete'`. Use `uniqueName('ZTABL_')` for a collision-safe name. The test should:
  1. Create a table with `SAPWrite(action="create", type="TABL", name=..., package="$TMP", source="@EndUserText.label : '...'\ndefine table ... { key client : abap.clnt; key id : abap.numc(8); }")`
  2. Read it back with `SAPRead(type="TABL", name=...)` and verify source contains the field definitions
  3. Activate with `SAPActivate(name=..., type="TABL")`
  4. Update source with `SAPWrite(action="update", type="TABL", name=..., source=...)` adding a new field
  5. Delete with `SAPWrite(action="delete", type="TABL", name=...)`
  6. Use `try/finally` with `bestEffortDelete()` for cleanup
- [ ] The test should use `requireOrSkip(ctx, rapAvailable, 'RAP/CDS not available on test system')` since TABL creation on the test system may require CDS support
- [ ] Run `npm test` — all tests must pass (E2E tests only run with `npm run test:e2e`)

### Task 4: Update documentation and roadmap

**Files:**
- Modify: `docs/roadmap.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `CLAUDE.md`

Update all documentation artifacts to reflect TABL write support.

- [ ] In `docs/roadmap.md`, update FEAT-44 status from "Not started" to "Completed"
- [ ] In `docs/compare/00-feature-matrix.md`, update the "Table write (TABL)" row: change `❌ (FEAT-44)` to `✅`
- [ ] In `CLAUDE.md`, update the `SAPWRITE_TYPES` references in Code Patterns or any mention of supported write types to include TABL
- [ ] Run `npm test` — all tests must pass

### Task 5: Final verification

- [ ] Run full test suite: `npm test` — all tests pass
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors
- [ ] Verify `buildCreateXml('TABL', 'ZTEST', '$TMP', 'Test')` produces valid XML with `blue:blueSource` root and `TABL/DT` type
- [ ] Verify that SAPWrite create with type=TABL follows the source-write path (NOT the DDIC metadata path)
- [ ] Move this plan to `docs/plans/completed/`
