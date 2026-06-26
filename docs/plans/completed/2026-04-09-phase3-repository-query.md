# Phase 3: ABAP Repository Service (Query/Describe)

## Overview

Add read operations against the `/sap/opu/odata/UI5/ABAP_REPOSITORY_SRV` OData service. This enables querying deployed BSP apps via OData (name, package, description), checking app existence, and downloading app content as a ZIP. This is the foundation for Phase 4 (deployment) and validates that ARC-1's HTTP client works with OData services on a different path from ADT.

**Important:** This phase requires manual testing on a real SAP system. The OData service is at `/sap/opu/odata/` (not `/sap/bc/adt/`), and CSRF token sharing, cookie behavior, and auth headers must be verified empirically.

## Context

### Current State

- ARC-1's HTTP client (`src/adt/http.ts`) only targets `/sap/bc/adt/` endpoints
- CSRF tokens are fetched via `HEAD /sap/bc/adt/core/discovery` — unclear if these work for `/sap/opu/odata/` paths
- No OData V2 response parsing exists in the codebase
- The `ABAP_REPOSITORY_SRV` OData service is available since SAP_UI 7.53 and is the standard deployment API used by SAP Business Application Studio and `@sap-ux/deploy-tooling`

### Target State

- New module `src/adt/ui5-repository.ts` with OData client for ABAP Repository Service
- Feature probe for the OData service availability
- `SAPRead(type="BSP_DEPLOY", name="ZAPP_BOOKING")` — get app metadata via OData (name, package, description, publish status)
- Validated CSRF/auth behavior documented for Phase 4

### Key Files

| File | Role |
|------|------|
| `src/adt/ui5-repository.ts` | **New** — OData client for ABAP Repository Service |
| `src/adt/http.ts` | HTTP transport — may need extension for OData paths (line ~1, CSRF logic) |
| `src/adt/features.ts` | Feature probes — add `ui5repo` probe (line ~33, PROBES array) |
| `src/adt/types.ts` | Types — add `BspDeployInfo` interface |
| `src/handlers/schemas.ts` | Zod schemas — add `BSP_DEPLOY` to SAPRead types |
| `src/handlers/tools.ts` | Tool descriptions — add BSP_DEPLOY to SAPRead |
| `src/handlers/intent.ts` | Intent handler — add BSP_DEPLOY case |
| `tests/unit/adt/ui5-repository.test.ts` | **New** — unit tests |

### Design Principles

1. The ABAP Repository Service is an OData V2 service returning JSON (with `$format=json`). Response structure is `{ d: { Name, Package, Description, ZipArchive } }`.
2. CSRF tokens may or may not be shared with ADT. The implementation should try the existing ADT token first, and if it fails (403), fetch a separate token from the OData service using `X-Csrf-Token: Fetch` piggy-backed on a GET request.
3. Keep this module self-contained — it uses `AdtHttpClient` for low-level HTTP but adds its own OData-specific logic (query params, JSON parsing, Atom XML payloads for future writes).
4. Feature-gate behind a new `ui5repo` probe: `HEAD /sap/opu/odata/UI5/ABAP_REPOSITORY_SRV`.
5. The `getAppInfo()` method is the critical function — Phase 4 deployment will call it to determine POST vs PUT.

## Development Approach

Unit tests with mock HTTP. For OData JSON responses, create simple inline mocks (no fixture files needed — JSON is straightforward). Manual testing on real SAP system is **required** after implementation to validate CSRF behavior.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Create UI5 Repository module

**Files:**
- Create: `src/adt/ui5-repository.ts`
- Modify: `src/adt/types.ts`

Create a new module for the ABAP Repository OData Service with read operations.

- [x] Add `BspDeployInfo` interface to `src/adt/types.ts`: `{ name: string; package: string; description: string; info: string }`
- [x] Create `src/adt/ui5-repository.ts` with constant `SERVICE_PATH = '/sap/opu/odata/UI5/ABAP_REPOSITORY_SRV'`
- [x] Implement `getAppInfo(http: AdtHttpClient, safety: SafetyConfig, appName: string): Promise<BspDeployInfo | undefined>` — `GET ${SERVICE_PATH}/Repositories('${encodeURIComponent(appName)}')` with headers `Accept: application/json` and query `$format=json`. Parse response `{ d: { Name, Package, Description, Info } }`. Return `undefined` on 404. Safety check: `checkOperation(safety, OperationType.Read, 'GetBSPDeployInfo')`
- [x] Implement `downloadApp(http: AdtHttpClient, safety: SafetyConfig, appName: string): Promise<Buffer | undefined>` — same GET with additional query params `CodePage=UTF8&DownloadFiles=RUNTIME`. Extract `ZipArchive` field from response, decode from base64 to Buffer. Return `undefined` if `ZipArchive` is empty.
- [x] Implement `probeService(http: AdtHttpClient): Promise<boolean>` — `HEAD ${SERVICE_PATH}`, return true on 2xx/405, false on 404
- [x] Handle CSRF: For GET operations, include `X-Csrf-Token: Fetch` header. Store the returned token from the `x-csrf-token` response header on the http client for future write operations (Phase 4).
- [x] Add unit tests (~8 tests) in `tests/unit/adt/ui5-repository.test.ts`: getAppInfo happy path, getAppInfo returns undefined on 404, getAppInfo parses OData JSON correctly, downloadApp returns Buffer, downloadApp returns undefined when empty, probeService true on 200, probeService false on 404, safety check blocks
- [x] Run `npm test` — all tests must pass

### Task 2: Add feature probe

**Files:**
- Modify: `src/adt/features.ts`
- Modify: `src/adt/types.ts`

Add a feature probe for the ABAP Repository OData Service.

- [x] Add `{ id: 'ui5repo', endpoint: '/sap/opu/odata/UI5/ABAP_REPOSITORY_SRV', description: 'UI5 ABAP Repository Deploy' }` to the `PROBES` array at `src/adt/features.ts:33`
- [x] Add `ui5repo: FeatureStatus` to the `FeatureResults` type in `src/adt/types.ts` (near the existing `ui5: FeatureStatus` field)
- [x] Add `SAP_FEATURE_UI5REPO` environment variable support in `src/server/config.ts` and `src/server/types.ts` following the existing `SAP_FEATURE_UI5` pattern
- [x] Add unit test (~2 tests) to verify the probe is included and resolves correctly
- [x] Run `npm test` — all tests must pass

### Task 3: Wire up SAPRead handler

**Files:**
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `src/handlers/intent.ts`

Expose the OData query via `SAPRead(type="BSP_DEPLOY")`.

- [x] Add `'BSP_DEPLOY'` to `SAPREAD_TYPES_ONPREM` at `src/handlers/schemas.ts:17` and `SAPREAD_TYPES_BTP` at line ~45
- [x] Update SAPRead description strings in `src/handlers/tools.ts` to include: `BSP_DEPLOY (query deployed UI5 apps via ABAP Repository Service — returns name, package, description)`
- [x] Add `BSP_DEPLOY` case in `handleSAPRead` at `src/handlers/intent.ts`. Call `getAppInfo(http, safety, name)`. If result is undefined, return "App not found". Otherwise return JSON.stringify of the metadata.
- [x] Add handler unit tests (~3 tests): BSP_DEPLOY returns metadata, returns "not found" for missing app, feature gate
- [x] Run `npm test` — all tests must pass

### Task 4: Final verification

- [x] Run full test suite: `npm test` — all tests pass
- [x] Run typecheck: `npm run typecheck` — no errors
- [x] Run lint: `npm run lint` — no errors
- [x] Document in a comment in `src/adt/ui5-repository.ts` that CSRF token sharing with ADT needs manual verification on a real SAP system
- [x] Move this plan to `docs/plans/completed/`
