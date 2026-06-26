# Plan: FEAT-45 DEVC (Package) Create

## Overview

Add package creation to ARC-1 via the SAPManage tool. Packages (DEVC) are the container for all ABAP development objects — without package creation, LLMs cannot set up greenfield projects or organize objects into proper packages. Six of eight competitors support package creation.

**Key design decision: SAPManage, not SAPWrite.** Packages are infrastructure/administrative objects, not source code objects. They don't have source code, don't need activation, and their creation XML is fundamentally different from all SAPWrite types. Following ARC-1's intent-based design:
- SAPWrite = source code and DDIC metadata objects (PROG, CLAS, DDLS, DOMA, DTEL, TABL, etc.)
- SAPManage = infrastructure operations (features, probe, cache, FLP, and now packages)

Research from abap-adt-api (gold standard):
- **Endpoint:** `POST /sap/bc/adt/packages`
- **Content-type:** `application/*`
- **XML root:** `<pak:package>` with namespace `http://www.sap.com/adt/packages`
- **ADT type:** `DEVC/K`
- **Required fields:** name, description, superPackage, softwareComponent, transportLayer, packageType
- **No activation needed** — packages are active on creation
- **Transport:** Non-local packages require a transport number (`?corrNr=...`)

## Context

### Current State

- Package **read** is implemented: `client.getPackageContents()` lists objects via `/sap/bc/adt/repository/nodestructure`
- `SAPRead type=DEVC` returns package contents as JSON
- `objectBasePath('DEVC')` is NOT currently mapped (unlike TABL, SRVB which are)
- No create/delete support for packages
- `checkPackage()` in safety.ts validates the *target* package for writes — for DEVC creation, we should validate the *parent* (superPackage), not the new package name itself

### Target State

- `SAPManage action=create_package` creates a new package with specified properties
- `SAPManage action=delete_package` deletes an existing package
- Required parameters: name, description; optional: superPackage, packageType, softwareComponent, transportLayer, transport
- Sensible defaults: packageType=development, superPackage derived from name prefix or empty
- Safety: package creation is gated by `checkOperation(safety, OperationType.Create, 'CreatePackage')` — blocked by `readOnly`
- Transport pre-flight: same pattern as SAPWrite create for non-$TMP packages

### Key Files

| File | Role |
|------|------|
| `src/handlers/intent.ts` | `handleSAPManage()` — add `create_package` and `delete_package` actions |
| `src/handlers/tools.ts` | SAPManage tool definition — add actions and parameters to JSON Schema |
| `src/handlers/schemas.ts` | `SAPManageSchema` (line ~371) — add `create_package`/`delete_package` to action enum and new fields |
| `src/adt/crud.ts` | `createObject()` — reusable for package POST; lock/delete flow for deletion |
| `src/adt/safety.ts` | `checkOperation()`, `checkPackage()` — safety gates |
| `src/adt/client.ts` | `getPackageContents()` at line ~369 — existing read; add package metadata read if needed |
| `tests/unit/handlers/intent.test.ts` | SAPManage handler tests |
| `tests/e2e/rap-write.e2e.test.ts` | E2E tests — add package lifecycle test |

### Design Principles

1. **SAPManage is the right home**: Packages are infrastructure, not source code. FLP operations (catalogs, groups, tiles) are already in SAPManage — packages follow the same pattern.
2. **Reuse existing CRUD primitives**: `createObject()` from `src/adt/crud.ts` works for the POST. Delete uses the standard lock/DELETE/unlock flow.
3. **Dedicated XML builder**: Package XML is complex (superPackage, softwareComponent, transportLayer, packageType) — use a dedicated builder function, similar to `buildDomainXml()` in `ddic-xml.ts`.
4. **Safety enforcement**: Use `checkOperation(safety, OperationType.Create, 'CreatePackage')` for creation. For package allowlist checking, validate the *superPackage* (parent), not the new package name — you can't restrict creating children of $TMP if $TMP is in the allowlist.
5. **Transport handling**: Reuse the existing transport pre-flight pattern from SAPWrite create (intent.ts line ~1616-1650).
6. **No activation**: Packages are immediately active after creation — no SAPActivate step needed.

## Development Approach

- Add a dedicated package XML builder function in a new section of `src/adt/ddic-xml.ts` (or a new `src/adt/package-xml.ts` if cleaner)
- Wire into SAPManage handler with new actions
- Test with unit tests for XML builder and handler routing, plus E2E lifecycle

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Add package XML builder

**Files:**
- Modify: `src/adt/ddic-xml.ts`
- Modify: `tests/unit/adt/ddic-xml.test.ts`

Add a `buildPackageXml()` function to `src/adt/ddic-xml.ts` that constructs the DEVC creation XML. The XML follows the abap-adt-api pattern with `pak:package` root element.

- [ ] Add a `PackageCreateParams` interface to `src/adt/ddic-xml.ts`:
  ```typescript
  export interface PackageCreateParams {
    name: string;
    description: string;
    superPackage?: string;       // parent package (default: empty)
    softwareComponent?: string;  // e.g., "LOCAL" or "HOME"
    transportLayer?: string;     // e.g., "HOME" or system-specific
    packageType?: 'development' | 'structure' | 'main';  // default: 'development'
  }
  ```
- [ ] Add `buildPackageXml(params: PackageCreateParams): string` function. Based on abap-adt-api research, the XML format is:
  ```xml
  <?xml version="1.0" encoding="UTF-8"?>
  <pak:package xmlns:pak="http://www.sap.com/adt/packages"
    xmlns:adtcore="http://www.sap.com/adt/core"
    adtcore:description="..."
    adtcore:name="ZPACKAGE"
    adtcore:type="DEVC/K"
    adtcore:version="active"
    adtcore:responsible="DEVELOPER">
    <adtcore:packageRef adtcore:name="ZPACKAGE"/>
    <pak:attributes pak:packageType="development"/>
    <pak:superPackage adtcore:name="PARENT_PACKAGE"/>
    <pak:applicationComponent/>
    <pak:transport>
      <pak:softwareComponent pak:name="LOCAL"/>
      <pak:transportLayer pak:name=""/>
    </pak:transport>
    <pak:translation/>
    <pak:useAccesses/>
    <pak:packageInterfaces/>
    <pak:subPackages/>
  </pak:package>
  ```
  All user-provided values must be XML-escaped via the existing `escapeXml()` function.
- [ ] Add unit tests (~6 tests) in `tests/unit/adt/ddic-xml.test.ts`:
  - `buildPackageXml` basic with name and description
  - `buildPackageXml` with superPackage specified
  - `buildPackageXml` with softwareComponent and transportLayer
  - `buildPackageXml` with packageType='structure'
  - `buildPackageXml` defaults (packageType=development, empty superPackage)
  - `buildPackageXml` XML escaping of special characters in description
- [ ] Run `npm test` — all tests must pass

### Task 2: Wire package create/delete into SAPManage handler

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `src/handlers/schemas.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

Add `create_package` and `delete_package` actions to SAPManage. The create action uses the XML builder from Task 1 and POSTs to `/sap/bc/adt/packages`. The delete action uses the standard lock/DELETE/unlock flow.

- [ ] In `src/handlers/schemas.ts`, add `'create_package'` and `'delete_package'` to the `SAPManageSchema` action enum (line ~372). Add new optional fields to the schema:
  - `name: z.string().optional()` (if not already present)
  - `description: z.string().optional()` (if not already present — check; it's not in current SAPManageSchema)
  - `superPackage: z.string().optional()`
  - `softwareComponent: z.string().optional()`
  - `transportLayer: z.string().optional()`
  - `packageType: z.enum(['development', 'structure', 'main']).optional()`
  - `transport: z.string().optional()`
  Note: some fields like `name` and `description` may not exist yet in SAPManageSchema — add them if missing.
- [ ] In `src/handlers/tools.ts`, update the SAPManage tool definition:
  - Add `'create_package'` and `'delete_package'` to the action enum in `inputSchema.properties.action.enum`
  - Add new properties to `inputSchema.properties`: `name`, `description` (if not present), `superPackage`, `softwareComponent`, `transportLayer`, `packageType`, `transport`
  - Update the SAPManage description string to mention package management
- [ ] In `src/handlers/intent.ts`, find the `handleSAPManage()` function and add cases for `create_package` and `delete_package`:
  - **create_package**: Extract params (name, description, superPackage, softwareComponent, transportLayer, packageType, transport). Call `checkOperation(safety, OperationType.Create, 'CreatePackage')`. Build XML via `buildPackageXml()`. POST to `/sap/bc/adt/packages` via `createObject()` from crud.ts. Add transport pre-flight check (same pattern as SAPWrite create at intent.ts line ~1616-1650, using `/sap/bc/adt/packages/${name}` as the object URL for transport info). Return success message.
  - **delete_package**: Extract name and transport. Call `checkOperation(safety, OperationType.Delete, 'DeletePackage')`. Use lock/delete/unlock flow via `client.http.withStatefulSession()` (same pattern as SAPWrite delete at intent.ts line ~1749-1766) against `/sap/bc/adt/packages/${name}`.
- [ ] Add unit tests (~8 tests) in `tests/unit/handlers/intent.test.ts`:
  - SAPManage create_package happy path — calls createObject with correct URL and XML body
  - SAPManage create_package with transport — appends corrNr query parameter
  - SAPManage create_package without name — returns error
  - SAPManage create_package blocked by readOnly — returns AdtSafetyError
  - SAPManage delete_package happy path — calls lock/delete/unlock
  - SAPManage delete_package blocked by readOnly — returns AdtSafetyError
  - SAPManage create_package transport pre-flight — returns guidance when transport required but not provided
  - SAPManage create_package with all optional fields — XML contains superPackage, softwareComponent, etc.
- [ ] Run `npm test` — all tests must pass

### Task 3: Add E2E test for package lifecycle

**Files:**
- Modify: `tests/e2e/rap-write.e2e.test.ts`

Add a package create → verify → delete lifecycle test to the E2E suite. Packages don't need activation, so the lifecycle is simpler.

- [ ] Add a new test case: `'SAPManage create_package, verify, delete'`. Use `uniqueName('ZARC1T_')` for a collision-safe name (packages max 30 chars). The test should:
  1. Create a package with `SAPManage(action="create_package", name=..., description="ARC-1 E2E test package")` in `$TMP` (no transport needed)
  2. Read contents with `SAPRead(type="DEVC", name=...)` — verify it returns (possibly empty) contents
  3. Delete with `SAPManage(action="delete_package", name=...)`
  4. Use `try/finally` for cleanup — best-effort delete in finally block
- [ ] The test does NOT need rapAvailable check — packages are a basic ABAP feature available on all systems
- [ ] Run `npm test` — all tests must pass (E2E tests only run with `npm run test:e2e`)

### Task 4: Update documentation and roadmap

**Files:**
- Modify: `docs/tools.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `CLAUDE.md`

Update all documentation artifacts to reflect package creation support.

- [ ] In `docs/tools.md`, add `create_package` and `delete_package` to the SAPManage section. Document parameters (name, description, superPackage, softwareComponent, transportLayer, packageType, transport). Add examples:
  ```
  SAPManage(action="create_package", name="ZRAP_TRAVEL", description="RAP Travel Demo")
  SAPManage(action="create_package", name="ZRAP_TRAVEL", description="RAP Travel Demo",
    superPackage="ZRAP", softwareComponent="HOME", transportLayer="HOME",
    packageType="development", transport="K900123")
  SAPManage(action="delete_package", name="ZRAP_TRAVEL")
  ```
- [ ] In `docs/roadmap.md`, update FEAT-45 status from "Not started" to "Completed"
- [ ] In `docs/compare/00-feature-matrix.md`, update the "Package create (DEVC)" row: change `❌ (FEAT-45)` to `✅`
- [ ] In `CLAUDE.md`, update the Key Files table to mention package creation under "Add new write operation" or add a new row for package operations pointing to `src/handlers/intent.ts` (handleSAPManage), `src/adt/ddic-xml.ts` (buildPackageXml)
- [ ] Run `npm test` — all tests must pass

### Task 5: Final verification

- [ ] Run full test suite: `npm test` — all tests pass
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors
- [ ] Verify `buildPackageXml({ name: 'ZTEST', description: 'Test' })` produces valid XML with `pak:package` root and `DEVC/K` type
- [ ] Verify SAPManage create_package is blocked by `readOnly=true`
- [ ] Verify SAPManage create_package handles transport pre-flight for non-$TMP packages
- [ ] Move this plan to `docs/plans/completed/`
