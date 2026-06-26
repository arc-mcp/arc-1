# Plan: FEAT-46 SRVB (Service Binding) Create

## Overview

Add SRVB (Service Binding) creation to the SAPWrite tool. ARC-1 already reads service bindings (`SAPRead type=SRVB`) and can publish/unpublish them via `SAPActivate action=publish_srvb/unpublish_srvb`, but cannot create the binding object itself. This is the last missing piece for a fully automated RAP stack lifecycle: TABL → DDLS → BDEF → SRVD → CLAS → **SRVB** → publish.

Research from abap-adt-api (gold standard):
- **Endpoint:** `POST /sap/bc/adt/businessservices/bindings`
- **Content-type:** `application/*`
- **XML root:** `<srvb:serviceBinding>` with namespace `http://www.sap.com/adt/ddic/ServiceBindings`
- **ADT type:** `SRVB/SVB`
- **Required fields:** name, description, service definition reference, binding type (ODATA), category (0=Web API, 1=UI)
- **Source-based:** SRVB is NOT a source-based type — it has no `/source/main` endpoint. It's a metadata-structured object like DOMA/DTEL, but with a unique XML structure for binding configuration
- **Activation required:** Yes, standard activation after creation. Then publish via `publish_srvb` to make OData service available

**Design consideration:** SRVB read already uses a vendor content type (`application/vnd.sap.adt.businessservices.servicebinding.v2+xml`) for the Accept header. For creation, abap-adt-api uses `application/*` which works. The creation XML includes the service definition reference and binding properties.

## Context

### Current State

- SRVB **read** is implemented: `client.getSrvb(name)` at line ~272 in client.ts reads via `/sap/bc/adt/businessservices/bindings/{name}` with vendor Accept header
- `SAPRead type=SRVB` returns structured JSON: OData version, binding type, publish status, service definition ref
- `objectBasePath('SRVB')` already returns `/sap/bc/adt/businessservices/bindings/` (intent.ts line ~1505)
- `SAPActivate action=publish_srvb` and `unpublish_srvb` already work via `devtools.ts` (line ~158, ~177)
- SRVB is NOT in `SAPWRITE_TYPES` — cannot be created
- `buildCreateXml()` has no SRVB case
- SRVB creation XML is more complex than source-based types — it needs nested `<srvb:services>` and `<srvb:binding>` elements

### Target State

- SAPWrite supports `create`, `update`, `delete` for SRVB
- `batch_create` also supports SRVB (final piece in RAP stack sequence)
- SRVB creation requires: name, description, service definition name, optional binding type/category
- After creation + activation, guide the LLM to use `SAPActivate action=publish_srvb` to publish
- SRVB is treated as a metadata type (no `/source/main`) — update uses XML PUT, not source PUT

### Key Files

| File | Role |
|------|------|
| `src/handlers/intent.ts` | `handleSAPWrite()` (line ~1551), `buildCreateXml()` (line ~1302), `objectBasePath()` (line ~1483), `isDdicMetadataType()` (line ~1042), `needsVendorContentType()` (line ~1047), `vendorContentTypeForType()` (line ~1070) |
| `src/handlers/tools.ts` | `SAPWRITE_TYPES_ONPREM/BTP` (line ~103-104), tool descriptions |
| `src/handlers/schemas.ts` | `SAPWRITE_TYPES` Zod enums (line ~123-136), SAPWriteSchema |
| `src/adt/client.ts` | `getSrvb()` at line ~272 — existing read with vendor content type |
| `src/adt/crud.ts` | `createObject()`, `safeUpdateObject()`, delete flow |
| `src/adt/devtools.ts` | `publishServiceBinding()` at line ~158, `unpublishServiceBinding()` at line ~177 |
| `src/adt/ddic-xml.ts` | Existing XML builders — add SRVB builder here |
| `tests/unit/handlers/intent.test.ts` | SAPWrite handler tests |
| `tests/unit/adt/ddic-xml.test.ts` | XML builder tests |
| `tests/e2e/rap-write.e2e.test.ts` | RAP write lifecycle E2E tests |

### Design Principles

1. **Metadata-type pattern, but distinct from DOMA/DTEL**: SRVB has no `/source/main` — updates are full XML PUT like DOMA/DTEL. But the XML structure is completely different (nested services/binding elements vs. DDIC content).
2. **Add to isDdicMetadataType or introduce isSrvbType**: The existing `isDdicMetadataType()` check gates whether the update flow uses `safeUpdateObject()` (XML PUT) or `safeUpdateSource()` (text PUT). SRVB needs the XML PUT path. Rather than adding SRVB to `isDdicMetadataType()` (which is semantically wrong — SRVB isn't DDIC), rename the function to `isMetadataWriteType()` or add a separate check.
3. **New SRVB-specific parameters**: SRVB creation needs `serviceDefinition` (the SRVD name to bind to), `bindingType` (default: "ODATA"), and `category` (0=Web API, 1=UI, default: "0"). These are new SAPWrite parameters, distinct from the DOMA/DTEL fields.
4. **Content-type**: Use `application/*` for creation POST (matching abap-adt-api). For update PUT, use `application/vnd.sap.adt.businessservices.servicebinding.v2+xml` (the vendor type already used by getSrvb for reading).
5. **Post-create guidance**: After successful creation, include a hint in the response: "Use SAPActivate to activate, then SAPActivate(action='publish_srvb') to publish the OData service."

## Development Approach

- Add SRVB XML builder with service definition reference and binding configuration
- Wire into SAPWrite as a metadata-write type (XML PUT for updates, no source/main)
- Refactor `isDdicMetadataType()` to `isMetadataWriteType()` covering DOMA, DTEL, and SRVB
- Test with XML builder unit tests plus E2E lifecycle

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Add SRVB XML builder and new parameters

**Files:**
- Modify: `src/adt/ddic-xml.ts`
- Modify: `tests/unit/adt/ddic-xml.test.ts`

Add a `buildServiceBindingXml()` function to construct the SRVB creation XML. Based on abap-adt-api research, the XML needs nested service and binding elements.

- [ ] Add a `ServiceBindingCreateParams` interface to `src/adt/ddic-xml.ts`:
  ```typescript
  export interface ServiceBindingCreateParams {
    name: string;
    description: string;
    package: string;
    serviceDefinition: string;   // SRVD name to bind to
    bindingType?: string;        // default: 'ODATA'
    category?: '0' | '1';       // '0' = Web API, '1' = UI; default: '0'
    version?: string;            // service version, default: '0001'
  }
  ```
- [ ] Add `buildServiceBindingXml(params: ServiceBindingCreateParams): string` function. Based on abap-adt-api research, the XML format is:
  ```xml
  <?xml version="1.0" encoding="UTF-8"?>
  <srvb:serviceBinding xmlns:srvb="http://www.sap.com/adt/ddic/ServiceBindings"
    xmlns:adtcore="http://www.sap.com/adt/core"
    adtcore:description="..."
    adtcore:name="ZSB_TRAVEL_O4"
    adtcore:type="SRVB/SVB"
    adtcore:language="EN"
    adtcore:masterLanguage="EN"
    adtcore:responsible="DEVELOPER">
    <adtcore:packageRef adtcore:name="$TMP"/>
    <srvb:services srvb:name="ZSB_TRAVEL_O4">
      <srvb:content srvb:version="0001">
        <srvb:serviceDefinition adtcore:name="ZSD_TRAVEL"/>
      </srvb:content>
    </srvb:services>
    <srvb:binding srvb:category="0" srvb:type="ODATA" srvb:version="V2">
      <srvb:implementation adtcore:name=""/>
    </srvb:binding>
  </srvb:serviceBinding>
  ```
  Notes: `srvb:services srvb:name` matches the binding name. `srvb:version` in content is the service version ("0001"). `srvb:version` in binding element is the OData protocol version ("V2" even for V4 — this is what abap-adt-api sends). All values XML-escaped.
- [ ] Add unit tests (~5 tests) in `tests/unit/adt/ddic-xml.test.ts`:
  - `buildServiceBindingXml` basic — correct root element and SRVB/SVB type
  - `buildServiceBindingXml` with service definition reference in nested elements
  - `buildServiceBindingXml` default category=0 and bindingType=ODATA
  - `buildServiceBindingXml` with category=1 (UI binding)
  - `buildServiceBindingXml` XML escaping of special characters
- [ ] Run `npm test` — all tests must pass

### Task 2: Wire SRVB into SAPWrite type arrays and handler

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `src/handlers/schemas.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

Add SRVB as a writable type. SRVB uses the metadata-write pattern (no `/source/main`), so it needs to be routed through the XML PUT path for updates.

- [ ] Add `'SRVB'` to `SAPWRITE_TYPES_ONPREM` in `src/handlers/tools.ts` (line ~103)
- [ ] Add `'SRVB'` to `SAPWRITE_TYPES_BTP` in `src/handlers/tools.ts` (line ~104)
- [ ] Update `SAPWRITE_DESC_ONPREM` and `SAPWRITE_DESC_BTP` to mention SRVB
- [ ] Add `'SRVB'` to `SAPWRITE_TYPES_ONPREM` and `SAPWRITE_TYPES_BTP` in `src/handlers/schemas.ts` (both main schemas and batch object schemas)
- [ ] Add SRVB-specific fields to `SAPWriteSchema` in `src/handlers/schemas.ts`: `serviceDefinition: z.string().optional()`, `bindingType: z.string().optional()`, `category: z.enum(['0', '1']).optional()`
- [ ] Add SRVB-specific properties to the SAPWrite JSON Schema in `src/handlers/tools.ts`:
  - `serviceDefinition: { type: 'string', description: 'SRVB: service definition name (SRVD) to bind to' }`
  - `bindingType: { type: 'string', description: 'SRVB: binding type (default: ODATA)' }`
  - `category: { type: 'string', enum: ['0', '1'], description: 'SRVB: 0=Web API, 1=UI (default: 0)' }`
- [ ] In `src/handlers/intent.ts`, refactor `isDdicMetadataType()` (line ~1042) to cover SRVB. Options:
  - Rename to `isMetadataWriteType()` and add SRVB: `return type === 'DOMA' || type === 'DTEL' || type === 'SRVB';`
  - Or keep `isDdicMetadataType()` for DOMA/DTEL and add a separate check for SRVB in the update/create paths
  - The key requirement: SRVB updates must use `safeUpdateObject()` (XML PUT), not `safeUpdateSource()` (text PUT)
- [ ] Add `'SRVB'` to `needsVendorContentType()` (line ~1047) — SRVB needs a vendor content type for updates
- [ ] Add SRVB case to `vendorContentTypeForType()` (line ~1070): return `'application/vnd.sap.adt.businessservices.servicebinding.v2+xml; charset=utf-8'`
- [ ] Add a `case 'SRVB':` to `buildCreateXml()` (line ~1302). This should extract SRVB-specific properties from the `properties` parameter and delegate to `buildServiceBindingXml()` from `ddic-xml.ts`. Extract properties: `serviceDefinition` (required for SRVB create — return error if missing), `bindingType`, `category`, `version`.
- [ ] In the `case 'create':` handler (line ~1611): after the `isDdicMetadataType()` / `isMetadataWriteType()` check, SRVB should follow the metadata path (return immediately after createObject, no source write). Add a post-create hint in the success message: "Use SAPActivate to activate, then SAPActivate(action='publish_srvb', name='...') to publish."
- [ ] Add `getDdicWriteProperties()` extraction for SRVB-specific fields (or add a separate `getSrvbWriteProperties()` function) to pass serviceDefinition, bindingType, category through to buildCreateXml
- [ ] Add unit tests (~8 tests) in `tests/unit/handlers/intent.test.ts`:
  - SAPWrite create type=SRVB produces correct XML with service binding root
  - SAPWrite create type=SRVB without serviceDefinition returns error
  - SAPWrite create type=SRVB follows metadata-write path (no safeUpdateSource)
  - SAPWrite update type=SRVB uses safeUpdateObject (XML PUT, not source PUT)
  - SAPWrite delete type=SRVB follows lock/delete/unlock
  - SAPWrite batch_create with SRVB — processes correctly after SRVD in sequence
  - SAPWrite create type=SRVB includes post-create publish hint
  - SAPWrite create type=SRVB blocked by readOnly
- [ ] Run `npm test` — all tests must pass

### Task 3: Add E2E test for SRVB lifecycle

**Files:**
- Modify: `tests/e2e/rap-write.e2e.test.ts`

Add a SRVB create → activate → publish → unpublish → delete lifecycle test. This builds on the existing RAP write E2E suite which already tests DDLS + BDEF + SRVD.

- [ ] Add a new test case: `'SAPWrite create SRVB, activate, publish, unpublish, delete'`. Use `uniqueName('ZSB_ARC_')` for the binding name and create a matching SRVD first. The test should:
  1. Create a DDLS: `SAPWrite(action="create", type="DDLS", name=ddlsName, ...)` with a simple CDS view
  2. Create a BDEF: `SAPWrite(action="create", type="BDEF", name=ddlsName, ...)` with basic managed behavior
  3. Create a SRVD: `SAPWrite(action="create", type="SRVD", name=srvdName, ...)` referencing the DDLS
  4. Activate all: DDLS, BDEF, SRVD in order
  5. Create a SRVB: `SAPWrite(action="create", type="SRVB", name=srvbName, serviceDefinition=srvdName, category="0")`
  6. Activate the SRVB: `SAPActivate(name=srvbName, type="SRVB")`
  7. Read: `SAPRead(type="SRVB", name=srvbName)` — verify JSON contains service definition reference
  8. Publish: `SAPActivate(action="publish_srvb", name=srvbName)`
  9. Unpublish: `SAPActivate(action="unpublish_srvb", name=srvbName)`
  10. Delete: SRVB, SRVD, BDEF, DDLS in reverse order
  11. Use `try/finally` with best-effort cleanup
- [ ] The test should use `requireOrSkip(ctx, rapAvailable, 'RAP/CDS not available on test system')` since SRVB requires RAP
- [ ] Run `npm test` — all tests must pass (E2E tests only run with `npm run test:e2e`)

### Task 4: Update documentation and roadmap

**Files:**
- Modify: `docs/tools.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `CLAUDE.md`

Update all documentation artifacts to reflect SRVB write support.

- [ ] In `docs/tools.md`, add SRVB to the SAPWrite supported types table. Document the new parameters (serviceDefinition, bindingType, category). Add examples:
  ```
  SAPWrite(action="create", type="SRVB", name="ZSB_TRAVEL_O4", package="$TMP",
    serviceDefinition="ZSD_TRAVEL", category="0")
  ```
  Update the batch_create example to include SRVB as the final step:
  ```
  SAPWrite(action="batch_create", package="$TMP", objects=[
    {type:"TABL", name:"ZTRAVEL", source:"..."},
    {type:"DDLS", name:"ZI_TRAVEL", source:"..."},
    {type:"BDEF", name:"ZI_TRAVEL", source:"..."},
    {type:"SRVD", name:"ZSD_TRAVEL", source:"..."},
    {type:"CLAS", name:"ZBP_I_TRAVEL", source:"..."},
    {type:"SRVB", name:"ZSB_TRAVEL_O4", serviceDefinition:"ZSD_TRAVEL", category:"0"}
  ])
  ```
- [ ] In `docs/roadmap.md`, update FEAT-46 status from "Not started" to "Completed"
- [ ] In `docs/compare/00-feature-matrix.md`, update the "Service binding create (SRVB)" row: change `❌ (FEAT-46)` to `✅`
- [ ] In `CLAUDE.md`, update relevant sections to mention SRVB is now writable
- [ ] Run `npm test` — all tests must pass

### Task 5: Final verification

- [ ] Run full test suite: `npm test` — all tests pass
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors
- [ ] Verify `buildServiceBindingXml(...)` produces valid XML with `srvb:serviceBinding` root and `SRVB/SVB` type
- [ ] Verify SAPWrite create with type=SRVB follows the metadata-write path (not source-write)
- [ ] Verify SAPWrite update with type=SRVB uses `safeUpdateObject()` with vendor content type
- [ ] Verify batch_create with SRVB works in a RAP stack sequence (DDLS → BDEF → SRVD → SRVB)
- [ ] Move this plan to `docs/plans/completed/`
