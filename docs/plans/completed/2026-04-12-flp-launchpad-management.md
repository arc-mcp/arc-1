# FLP Launchpad Management (FEAT-40)

## Overview

This plan adds Fiori Launchpad (FLP) management capabilities to ARC-1, enabling LLM-driven automation of catalog, group, tile, and target mapping configuration via the SAP OData service `/sap/opu/odata/UI2/PAGE_BUILDER_CUST`.

sapcli has a full FLP implementation (`sap/flp/service.py`, `sap/flp/builder.py`) using three OData entity sets: `Catalogs`, `Pages` (groups), and `PageChipInstances` (tiles and target mappings). ARC-1 will expose equivalent read and write operations through `SAPManage` actions.

**Test system verification (A4H, SAP_BASIS 758, verified 2026-04-12):**
- The OData service `/sap/opu/odata/UI2/PAGE_BUILDER_CUST` is **fully active** (HTTP 200). `$metadata` returns the complete EDM schema.
- **Entity sets confirmed:** `Catalogs` (112 entries), `Pages` (41 entries), `PageChipInstances`, `Chips`, `Bags`, `Properties`, `ChipBags`, `ChipProperties`, `ChipInstanceBags`, `ChipInstanceProperties`, `PageSets`. Also 2 FunctionImports: `CloneCatalog`, `ClonePageChipInstance`.
- **Supported formats:** `atom json xlsx` (per `sap:supported-formats` in metadata).
- **CRUD verified:** POST to `Catalogs` returns HTTP 201 with the created entity. DELETE returns HTTP 204 (no content). CSRF token fetching works via the OData service root.
- **Catalog entity properties:** `id`, `type`, `domainId`, `remoteType`, `title`, `systemAlias`, `remoteId`, `isReadOnly`, `originalLanguage`, `scope`, `baseUrl`, `chipCount`, `outdated`. Key: `id`. Navigation: `CatalogPage`, `Chips`.
- **Page entity properties:** `id`, `title`, `catalogId`, `layout`, `originalLanguage`, `isCatalogPage`, `chipInstanceCount`, `isPersLocked`, `isReadOnly`, `scope`, `updated`, `outdated`. Key: `id`. Navigation: `Catalog`, `allCatalogs`, `PageChipInstances`, `Bags`.
- **PageChipInstance properties:** `pageId` + `instanceId` (composite key), `chipId`, `title`, `configuration`, `layoutData`, `remoteCatalogId`, `referencePageId`, `referenceChipInstanceId`, `isReadOnly`, `scope`, `updated`, `outdated`. Navigation: `Chip`, `ReferenceChip`, `RemoteCatalog`, `ReferenceChipInstance`, `ChipInstanceBags`.
- **Create catalog response:** `POST /Catalogs { domainId: "ZARC1_TEST_CAT", title: "ARC1 Test Catalog", type: "CATALOG_PAGE" }` → `201 Created` with `id: "X-SAP-UI2-CATALOGPAGE:ZARC1_TEST_CAT"`, `scope: "CUSTOMIZING"`, `chipCount: "0000"`. The SAP system prefixes `domainId` with `X-SAP-UI2-CATALOGPAGE:` to generate the `id`.
- **Performance:** Unfiltered queries on large entity sets (112 catalogs) timeout after 30s without `$top`/`$select`. Always use `$top` and `$select` for listing operations.
- **Known issue:** `PageChipInstances` with `$filter=pageId eq 'X-SAP-UI2-CATALOGPAGE:{id}'` triggers `ASSERTION_FAILED` for some catalog IDs (e.g., `/UI2/TEST_CHIP_CATALOG_1`, `SAP_BASIS_BCG_UI_WDR_UI_ELEMENTS`). Unfiltered `$top=N` queries work fine. The implementation should handle this error gracefully.
- **Double-serialized JSON confirmed:** A real `PageChipInstance` configuration value: `{"tileConfiguration":"{\"semantic_object\":\"DataAgingObjectGroup\",\"semantic_action\":\"manageDAGrpT\",\"display_title_text\":\"Manage Data Aging Groups\",\"url\":\"/sap/bc/ui5_ui5/sap/bas_daggrp_man\",...}"}` — the `tileConfiguration` value is itself a JSON string that must be parsed a second time.

**Design decision — SAPManage vs new tool:** FLP operations are added as new `SAPManage` actions rather than a separate tool. This keeps the tool count at 11 (design principle #3) and matches the management/admin nature of FLP configuration. Read operations (`flp_list_catalogs`, `flp_list_groups`) use `OperationType.Read`; write operations (`flp_create_catalog`, `flp_create_tile`, etc.) use `OperationType.Workflow`.

## Context

### Current State

- ARC-1 has one existing OData client: `src/adt/ui5-repository.ts` (51 lines) querying `/sap/opu/odata/UI5/ABAP_REPOSITORY_SRV` with JSON format, `Accept: application/json` header, and OData V2 `d`-property response parsing.
- `SAPManage` currently has 3 actions: `features`, `probe`, `cache_stats` (lines 1975-2051 in `intent.ts`).
- Feature detection in `src/adt/features.ts` probes 7 endpoints. No FLP probe exists.
- sapcli's FLP implementation uses 3 entity sets on `PAGE_BUILDER_CUST`:
  - `Catalogs` — business catalog CRUD (type `CATALOG_PAGE`). Test system has 112 catalogs including `/UI2/CATALOG_ALL`, `/UI2/FLPD_CATALOG`, and SAP_BASIS catalogs.
  - `Pages` — groups/spaces CRUD (catalogId `/UI2/FLPD_CATALOG`). Test system has 41 pages including groups like `SAP_BASIS_BCG_UI_WDR_UI_ELEMENTS`.
  - `PageChipInstances` — tiles, target mappings, tile-to-group assignments. Composite key: `(pageId, instanceId)`.
- Tile configuration uses double-serialized JSON: the `configuration` field is a JSON string containing a `tileConfiguration` key whose value is also a JSON string. Verified on test system with real target mapping instances.
- Key chip IDs: `X-SAP-UI2-CHIP:/UI2/STATIC_APPLAUNCHER` (tile), `X-SAP-UI2-CHIP:/UI2/ACTION` (target mapping). Both confirmed present on test system.
- The OData service also exposes 2 FunctionImports: `CloneCatalog(sourceId, targetId, title)` and `ClonePageChipInstance(sourcePageId, sourceChipInstanceId, targetPageId)` — useful for future extensions but out of scope for initial implementation.
- **Performance consideration:** The OData service is slow on large entity sets (30s+ for 112 catalogs without `$select`). All list operations must use `$top` (with configurable limit) and `$select` to avoid timeouts.

### Target State

- New module `src/adt/flp.ts` with OData client functions for FLP management.
- 6 new `SAPManage` actions: `flp_list_catalogs`, `flp_list_groups`, `flp_create_catalog`, `flp_create_group`, `flp_create_tile`, `flp_add_tile_to_group`.
- Feature detection for FLP availability via `PAGE_BUILDER_CUST` probe.
- Unit tests for all OData parsing and handler routing.
- Integration tests for live FLP queries.
- Updated authorization documentation with FLP-specific SAP authorization objects (S_SERVICE, S_PB_CHIP, /UI2/CHIP).
- Updated Cloud Connector documentation with required resource paths for `/sap/opu/odata/UI2/PAGE_BUILDER_CUST`.

### Key Files

| File | Role |
|------|------|
| `src/adt/flp.ts` | **New** — OData client for PAGE_BUILDER_CUST (catalogs, groups, tiles) |
| `src/adt/ui5-repository.ts` | Existing OData pattern to follow |
| `src/adt/types.ts` | Add FLP type interfaces |
| `src/adt/features.ts` | Add `flp` feature probe |
| `src/adt/config.ts` | Add `flp` to FeatureConfig |
| `src/handlers/intent.ts` | Add FLP actions to `handleSAPManage()` |
| `src/handlers/tools.ts` | Update SAPManage action enum and descriptions |
| `src/handlers/schemas.ts` | Update SAPManage Zod schema with FLP actions and params |
| `tests/unit/adt/flp.test.ts` | **New** — Unit tests for FLP OData client |
| `tests/unit/handlers/intent.test.ts` | Add FLP SAPManage action tests |

### Design Principles

1. **Follow existing OData pattern** — `ui5-repository.ts` is the template: `$format=json`, `Accept: application/json`, OData V2 `d`-property parsing, `checkOperation()` at entry point.
2. **HTTP client reuse** — FLP OData uses the same `AdtHttpClient` as ADT. CSRF tokens, cookies, auth headers are all inherited. No new HTTP infrastructure needed.
3. **Read-safe by default** — List operations use `OperationType.Read` (always allowed). Create/modify operations use `OperationType.Workflow` (blocked by `readOnly`).
4. **Progressive implementation** — Start with read operations (list catalogs, list groups), then add write operations (create catalog, create tile, add tile to group). Reads are useful standalone for auditing existing FLP configuration.
5. **Double-serialized JSON handling** — Tile configuration uses nested JSON strings (sapcli pattern). Parse on read, serialize on write. Expose clean JSON to the LLM, handle serialization internally.
6. **Feature-gated** — Add FLP to the feature probe system. When PAGE_BUILDER_CUST is not active (404), FLP actions return a clear error message instead of a cryptic HTTP error.
7. **Performance-aware queries** — Always use `$top` and `$select` for OData list queries. The test system (112 catalogs) shows that unfiltered queries without `$select` timeout after 30s. Default `$top=500` is a reasonable upper bound.
8. **Graceful error handling for ASSERTION_FAILED** — Some `PageChipInstances` filter queries trigger SAP backend assertion errors for specific catalog page IDs. The implementation must catch these and return empty results with a warning, not throw.

## Development Approach

Unit tests mock `AdtHttpClient` using the same `mockHttp()` factory as `tests/unit/adt/ui5-repository.test.ts` (lines 7-16). OData JSON responses use helper functions wrapping `{ d: { results: [...] } }` for collections and `{ d: { ... } }` for single entities. Test data should use real field values from the A4H test system (e.g., `id: "/UI2/CATALOG_ALL"`, `chipId: "X-SAP-UI2-CHIP:/UI2/ACTION"`).

Integration tests run against the live SAP system when `TEST_SAP_URL` is set. The A4H test system has the PAGE_BUILDER_CUST service fully active with 112 catalogs and 41 pages. CRUD integration tests are slow (~60-90s per create/delete operation) and must use `try/finally` for cleanup.

**Important for the `mockHttp()` factory:** The mock must include a `delete` method (not present in the `ui5-repository.test.ts` mock since UI5 repo only reads). Add `delete: vi.fn().mockResolvedValue({ statusCode: 204, headers: {}, body: '' })` to match the real SAP DELETE response (HTTP 204, no body).

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Add FLP type definitions and OData client (read operations)

**Files:**
- Modify: `src/adt/types.ts`
- Create: `src/adt/flp.ts`

This task creates the core FLP OData client module with read operations. It follows the same pattern as `src/adt/ui5-repository.ts`: import `AdtHttpClient`, `SafetyConfig`, `checkOperation`, use `$format=json`, parse OData V2 `d.results` responses.

- [ ] In `src/adt/types.ts`, add these interfaces at the end of the file (after `BspDeployInfo` at line ~318). These match the OData `$metadata` entity types verified on the A4H test system:
  ```typescript
  /** FLP catalog from PAGE_BUILDER_CUST OData (entity: Catalog) */
  export interface FlpCatalog {
    id: string;           // e.g. "X-SAP-UI2-CATALOGPAGE:ZARC1_TEST_CAT" (auto-generated key)
    domainId: string;     // e.g. "ZARC1_TEST_CAT" (user-provided ID)
    title: string;        // e.g. "ARC1 Test Catalog"
    type: string;         // e.g. "CATALOG_PAGE" or "" (empty for system catalogs)
    scope: string;        // e.g. "CUSTOMIZING" (set automatically on create)
    chipCount: string;    // e.g. "0000" (4-char counter)
  }
  /** FLP group (page) from PAGE_BUILDER_CUST OData (entity: Page) */
  export interface FlpGroup {
    id: string;           // e.g. "SAP_BASIS_BCG_UI_WDR_UI_ELEMENTS"
    title: string;        // e.g. "Web Dynpro ABAP - UI Elements"
    catalogId: string;    // always "/UI2/FLPD_CATALOG" for groups
    layout: string;       // JSON string with order array, or empty
  }
  /** FLP tile/target mapping instance from PAGE_BUILDER_CUST OData (entity: PageChipInstance) */
  export interface FlpTileInstance {
    instanceId: string;   // e.g. "00O2TO3741QLWH4GV74AHMWQE"
    chipId: string;       // e.g. "X-SAP-UI2-CHIP:/UI2/STATIC_APPLAUNCHER" or "X-SAP-UI2-CHIP:/UI2/ACTION"
    pageId: string;       // e.g. "X-SAP-UI2-CATALOGPAGE:SAP_BASIS_TCR_T"
    title: string;        // display title (often empty — title is in configuration)
    configuration: Record<string, unknown> | null; // parsed double-serialized JSON
  }
  ```
- [ ] Create `src/adt/flp.ts` with service path constant: `export const FLP_SERVICE_PATH = '/sap/opu/odata/UI2/PAGE_BUILDER_CUST';`
- [ ] Add `listCatalogs(http, safety)` function: `GET ${FLP_SERVICE_PATH}/Catalogs?$format=json&$top=500&$select=id,domainId,title,type,scope,chipCount` with `Accept: application/json`. The `$top=500` and `$select` are critical — the test system has 112 catalogs and unfiltered queries without `$select` timeout after 30s. Parse `data.d.results` array, map to `FlpCatalog[]`. Use `checkOperation(safety, OperationType.Read, 'ListFlpCatalogs')`. Handle 404 gracefully (return empty array). Expected response shape: `{"d":{"results":[{"id":"/UI2/CATALOG_ALL","domainId":"/UI2/CATALOG_ALL","title":"Catalog with all Chips","type":"","scope":"","chipCount":"..."}]}}`.
- [ ] Add `listGroups(http, safety)` function: `GET ${FLP_SERVICE_PATH}/Pages?$format=json&$top=500&$select=id,title,catalogId,layout&$filter=catalogId eq '/UI2/FLPD_CATALOG'` — filters to only FLP groups (not system pages). Parse to `FlpGroup[]`. Expected response: groups like `{"id":"SAP_BASIS_BCG_UI_WDR_UI_ELEMENTS","title":"Web Dynpro ABAP - UI Elements","catalogId":"/UI2/FLPD_CATALOG","layout":"{...}"}`.
- [ ] Add `listTiles(http, safety, catalogId)` function: `GET ${FLP_SERVICE_PATH}/PageChipInstances?$format=json&$top=500&$select=pageId,instanceId,chipId,title,configuration&$filter=pageId eq 'X-SAP-UI2-CATALOGPAGE:${encodeURIComponent(catalogId)}'`. **Important:** some catalog page IDs cause `ASSERTION_FAILED` errors on the SAP backend (verified on test system). Catch this error and return an empty array with a warning message instead of throwing. Parse `configuration` field: it's a JSON string containing `tileConfiguration` which is also a JSON string. Parse both levels and return clean `FlpTileInstance[]`.
- [ ] Add a helper function `parseTileConfiguration(configStr: string): Record<string, unknown> | null` that safely handles the double-JSON parsing, returning `null` if parsing fails.
- [ ] Run `npm test` — all existing tests must pass

### Task 2: Add unit tests for FLP OData client (read operations)

**Files:**
- Create: `tests/unit/adt/flp.test.ts`

Add unit tests for the FLP OData client created in Task 1. Follow the test pattern from `tests/unit/adt/ui5-repository.test.ts`: mock `AdtHttpClient` with `vi.fn()`, create OData JSON helpers, assert URL construction and response parsing.

- [ ] Create `tests/unit/adt/flp.test.ts` with a `mockHttp()` factory function identical to the one in `ui5-repository.test.ts` (lines 7-16)
- [ ] Add OData helpers: `odataCollection(results)` → `JSON.stringify({ d: { results } })` and `odataSingle(entity)` → `JSON.stringify({ d: entity })`
- [ ] Add test: `listCatalogs returns parsed catalogs` — mock response with the real OData shape: `{"d":{"results":[{"id":"/UI2/CATALOG_ALL","domainId":"/UI2/CATALOG_ALL","title":"Catalog with all Chips","type":"","scope":"","chipCount":"0042"},{"id":"X-SAP-UI2-CATALOGPAGE:ZARC1_TEST_CAT","domainId":"ZARC1_TEST_CAT","title":"ARC1 Test Catalog","type":"CATALOG_PAGE","scope":"CUSTOMIZING","chipCount":"0000"}]}}`. Assert correct URL contains `/Catalogs?$format=json&$top=500&$select=`, assert returned array has 2 entries with correct field mapping.
- [ ] Add test: `listCatalogs returns empty array on 404` — mock 404 AdtApiError, assert returns `[]`
- [ ] Add test: `listCatalogs sends Accept: application/json header` — assert `http.get` called with header `Accept: application/json`
- [ ] Add test: `listGroups filters by catalogId` — assert URL contains `$filter=catalogId%20eq%20'/UI2/FLPD_CATALOG'` (URL-encoded space)
- [ ] Add test: `listTiles parses double-serialized configuration` — use real response shape from test system: `configuration` is `'{"tileConfiguration":"{\\"semantic_object\\":\\"DataAgingObjectGroup\\",\\"semantic_action\\":\\"manageDAGrpT\\",\\"display_title_text\\":\\"Manage Data Aging Groups\\"}"}'`. Assert the returned tile has `configuration.semantic_object === 'DataAgingObjectGroup'` and `configuration.display_title_text === 'Manage Data Aging Groups'`.
- [ ] Add test: `listTiles handles malformed configuration gracefully` — mock response with `configuration: "C1"` (real value found on test system for tic-tac-toe gadget). Assert `configuration` is `null`.
- [ ] Add test: `listTiles handles ASSERTION_FAILED error gracefully` — mock `http.get` throwing `AdtApiError` with status 500 and body containing `ASSERTION_FAILED`. Assert returns empty array (not throw), since this is a known SAP backend issue for some catalog page IDs.
- [ ] Add test: `listCatalogs throws on safety check when Read is blocked` — use `{ disallowedOps: 'R' }` safety config
- [ ] Run `npm test` — all tests pass (~9 new tests)

### Task 3: Add FLP write operations to OData client

**Files:**
- Modify: `src/adt/flp.ts`

Add create operations following sapcli's `sap/flp/service.py` patterns. Write operations use `POST` with JSON payload and require CSRF tokens (handled automatically by `AdtHttpClient`).

- [ ] Add `createCatalog(http, safety, domainId, title)` function: `POST ${FLP_SERVICE_PATH}/Catalogs` with JSON body `{ domainId, title, type: 'CATALOG_PAGE' }`, Content-Type `application/json`, Accept `application/json`. Use `checkOperation(safety, OperationType.Workflow, 'CreateFlpCatalog')`. Return the created catalog entity. **Verified on test system:** Returns HTTP 201 with full entity including auto-generated `id: "X-SAP-UI2-CATALOGPAGE:${domainId}"`, `scope: "CUSTOMIZING"`, `chipCount: "0000"`. The `domainId` is the user-provided ID; SAP generates the prefixed `id`. **Performance note:** This operation takes ~30-60s on the test system — the HTTP client timeout may need consideration.
- [ ] Add `createGroup(http, safety, id, title)` function: `POST ${FLP_SERVICE_PATH}/Pages` with JSON body `{ id, title, catalogId: '/UI2/FLPD_CATALOG', layout: '' }`. Use `checkOperation(safety, OperationType.Workflow, 'CreateFlpGroup')`.
- [ ] Add `createTile(http, safety, catalogId, tile)` function: `POST ${FLP_SERVICE_PATH}/PageChipInstances` with JSON body matching sapcli's pattern: `chipId: 'X-SAP-UI2-CHIP:/UI2/STATIC_APPLAUNCHER'`, `pageId: 'X-SAP-UI2-CATALOGPAGE:${catalogId}'`, `scope: 'CUSTOMIZING'`, `configuration` field as double-serialized JSON string. Accept a `tile` parameter with: `{ id, title, icon, semanticObject, semanticAction, url?, subtitle?, info? }`. Return the created instance (including `instanceId`).
- [ ] Add `addTileToGroup(http, safety, groupId, catalogId, tileInstanceId)` function: `POST ${FLP_SERVICE_PATH}/PageChipInstances` with body `{ chipId: 'X-SAP-UI2-PAGE:X-SAP-UI2-CATALOGPAGE:${catalogId}:${tileInstanceId}', pageId: groupId }`. Use `checkOperation(safety, OperationType.Workflow, 'AddFlpTileToGroup')`.
- [ ] Add `deleteCatalog(http, safety, catalogId)` function: `DELETE ${FLP_SERVICE_PATH}/Catalogs('${encodeURIComponent(catalogId)}')`. The `catalogId` parameter is the full OData key (e.g., `X-SAP-UI2-CATALOGPAGE:ZARC1_TEST_CAT`). Use `checkOperation(safety, OperationType.Workflow, 'DeleteFlpCatalog')`. **Verified on test system:** Returns HTTP 204 (no content) on success. No response body.
- [ ] Run `npm test` — all existing tests must pass

### Task 4: Add unit tests for FLP write operations

**Files:**
- Modify: `tests/unit/adt/flp.test.ts`

Add tests for write operations. Write operations use `http.post()` and `http.delete()`. Assert request body, headers, and CSRF flow.

- [ ] Add test: `createCatalog sends correct OData POST` — assert URL is `${FLP_SERVICE_PATH}/Catalogs`, body is JSON with `{ domainId: 'ZARC1_TEST', title: 'Test', type: 'CATALOG_PAGE' }`, Content-Type is `application/json`. Mock response should return 201 with entity including auto-generated `id: 'X-SAP-UI2-CATALOGPAGE:ZARC1_TEST'` (matching real SAP behavior).
- [ ] Add test: `createCatalog uses Workflow operation type` — use safety config with `disallowedOps: 'W'`, assert throws `blocked by safety`
- [ ] Add test: `createTile serializes double-JSON configuration` — call `createTile()` with tile data, assert the body sent to `http.post()` has `configuration` as a JSON string containing `tileConfiguration` as a nested JSON string
- [ ] Add test: `createTile uses correct chipId and pageId` — assert body has `chipId: 'X-SAP-UI2-CHIP:/UI2/STATIC_APPLAUNCHER'` and `pageId: 'X-SAP-UI2-CATALOGPAGE:MY_CATALOG'`
- [ ] Add test: `addTileToGroup constructs composite chipId` — assert body `chipId` matches `'X-SAP-UI2-PAGE:X-SAP-UI2-CATALOGPAGE:CATALOG:TILE123'`
- [ ] Add test: `deleteCatalog sends DELETE with encoded key` — call `deleteCatalog(http, safety, 'X-SAP-UI2-CATALOGPAGE:ZARC1_TEST')`. Assert `http.delete` called with URL containing `Catalogs('X-SAP-UI2-CATALOGPAGE%3AZARC1_TEST')` (colon encoded). Mock 204 response (no body, matching real SAP behavior).
- [ ] Add test: `createGroup sends correct payload` — assert body has `catalogId: '/UI2/FLPD_CATALOG'` and `layout: ''`
- [ ] Run `npm test` — all tests pass (~7 new tests)

### Task 5: Add FLP feature probe

**Files:**
- Modify: `src/adt/features.ts`
- Modify: `src/adt/types.ts`
- Modify: `src/adt/config.ts`

Add FLP as a probed feature so that FLP availability is detected at startup.

- [ ] In `src/adt/features.ts`, add a new probe to the `PROBES` array (after the `ui5repo` entry at line 40): `{ id: 'flp', endpoint: '/sap/opu/odata/UI2/PAGE_BUILDER_CUST/', description: 'FLP customization (PAGE_BUILDER_CUST)' }`. Note the trailing slash — the OData service root responds with HTTP 200 on the test system (A4H). The probe uses HEAD, which should also return 200.
- [ ] In `src/adt/types.ts`, add `flp: FeatureStatus;` to the `ResolvedFeatures` interface (after `ui5repo` at line ~46)
- [ ] In `src/adt/config.ts`, find the `FeatureConfig` interface and add `flp: FeatureMode;`. Find the `defaultFeatureConfig()` function and add `flp: 'auto'` to defaults.
- [ ] In `src/adt/features.ts`, add `flp: config.flp` to the `modeMap` record in `probeFeatures()` (line ~81)
- [ ] In `src/adt/features.ts`, add `flp: 'FLP customization (PAGE_BUILDER_CUST)'` to the `descriptions` record in `resolveWithoutProbing()` (line ~336)
- [ ] In `src/handlers/intent.ts`, add `featureConfig.flp = config.featureFlp as 'auto' | 'on' | 'off';` in the probe action handler (after line ~2022), and add `featureFlp` field to `ServerConfig` if needed (check `src/server/types.ts`)
- [ ] Run `npm test` — all existing tests must pass. Some feature probe tests in `tests/unit/adt/features.test.ts` may need updating to account for the new `flp` feature.

### Task 6: Wire FLP actions into SAPManage handler

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`

Connect the FLP OData client to the SAPManage tool by adding new action cases.

- [ ] In `src/handlers/schemas.ts` (line 250), update the SAPManage schema enum to include FLP actions:
  ```typescript
  action: z.enum(['features', 'probe', 'cache_stats', 'flp_list_catalogs', 'flp_list_groups', 'flp_list_tiles', 'flp_create_catalog', 'flp_create_group', 'flp_create_tile', 'flp_add_tile_to_group']),
  ```
  Also add optional FLP-specific parameters to the schema: `catalogId: z.string().optional()`, `groupId: z.string().optional()`, `title: z.string().optional()`, `domainId: z.string().optional()`, `tileInstanceId: z.string().optional()`, and a `tile` object schema for create_tile: `tile: z.object({ id: z.string(), title: z.string(), icon: z.string().optional(), semanticObject: z.string(), semanticAction: z.string(), url: z.string().optional(), subtitle: z.string().optional(), info: z.string().optional() }).optional()`
- [ ] In `src/handlers/tools.ts`, update the SAPManage action enum at line 637 to include all FLP actions. Update the description strings `SAPMANAGE_DESC_ONPREM` (line 199) and `SAPMANAGE_DESC_BTP` (line 211) to document FLP actions:
  ```
  - "flp_list_catalogs": List FLP business catalogs
  - "flp_list_groups": List FLP groups
  - "flp_list_tiles": List tiles in a catalog (requires catalogId)
  - "flp_create_catalog": Create a business catalog (requires domainId, title)
  - "flp_create_group": Create a group (requires groupId, title)
  - "flp_create_tile": Create a tile in a catalog (requires catalogId, tile object)
  - "flp_add_tile_to_group": Add a tile to a group (requires groupId, catalogId, tileInstanceId)
  ```
  Also add parameter descriptions to the `inputSchema.properties` object for `catalogId`, `groupId`, `title`, `domainId`, `tileInstanceId`, and `tile`.
- [ ] In `src/handlers/intent.ts`, add FLP action cases to the `handleSAPManage()` switch statement (before the `default:` case at line 2048). Import the FLP functions from `../adt/flp.js`. For each action:
  - `flp_list_catalogs`: call `listCatalogs(client.http, client.safety)`, return `textResult(JSON.stringify(result, null, 2))`
  - `flp_list_groups`: call `listGroups(client.http, client.safety)`
  - `flp_list_tiles`: extract `catalogId` from args, require it, call `listTiles(client.http, client.safety, catalogId)`
  - `flp_create_catalog`: extract `domainId`, `title` from args, call `createCatalog(...)`
  - `flp_create_group`: extract args, call `createGroup(...)`
  - `flp_create_tile`: extract `catalogId` and `tile` from args, call `createTile(...)`
  - `flp_add_tile_to_group`: extract `groupId`, `catalogId`, `tileInstanceId` from args, call `addTileToGroup(...)`
- [ ] For write actions, check FLP feature availability from `cachedFeatures` before executing. If `cachedFeatures?.flp?.available === false`, return a helpful error: `"FLP customization service (PAGE_BUILDER_CUST) is not available on this system. Check ICF service activation in SICF."`
- [ ] Run `npm test` — all tests pass

### Task 7: Add unit tests for SAPManage FLP action routing

**Files:**
- Modify: `tests/unit/handlers/intent.test.ts`

Add tests for FLP action routing in the SAPManage handler. Follow existing patterns in the file for SAPManage tests.

- [ ] Add a `describe('SAPManage FLP actions', ...)` block
- [ ] Add test: `flp_list_catalogs returns catalog list` — mock the ADT client's `http.get` to return an OData catalog response, call `handleToolCall` with `SAPManage` + `action: 'flp_list_catalogs'`. Assert the result contains parsed catalog JSON.
- [ ] Add test: `flp_list_tiles requires catalogId` — call with `action: 'flp_list_tiles'` without `catalogId`. Assert error result.
- [ ] Add test: `flp_create_catalog blocked in readOnly mode` — set `readOnly: true` in safety config, assert write operation is blocked
- [ ] Add test: `flp_create_tile serializes configuration correctly` — verify the POST body contains double-serialized JSON
- [ ] Add test: `unknown FLP action returns error` — call with `action: 'flp_unknown'`, assert error result listing available actions
- [ ] Run `npm test` — all tests pass (~5 new tests)

### Task 8: Add integration tests for FLP OData

**Files:**
- Modify: `tests/integration/adt.integration.test.ts`

Add integration tests that probe the real SAP system for FLP service availability and attempt read operations.

- [ ] Add a `describe('FLP (PAGE_BUILDER_CUST)', ...)` block in the integration test file
- [ ] Add test: `probes FLP service availability` — call `http.get('/sap/opu/odata/UI2/PAGE_BUILDER_CUST/')` with `Accept: application/json`. Expected: HTTP 200 on A4H test system (service is confirmed active). Use `requireOrSkip(ctx, serviceAvailable, SkipReason.BACKEND_UNSUPPORTED)` if the service returns 404.
- [ ] Add test: `lists catalogs` — call `listCatalogs()`, assert result is an array with length > 0 (A4H has 112 catalogs). Verify at least one catalog has `id` and `domainId` fields. Use `requireOrSkip` for service availability.
- [ ] Add test: `lists groups` — call `listGroups()`, assert result is an array. On A4H, expect groups filtered by `catalogId eq '/UI2/FLPD_CATALOG'` (41 pages total, but not all are FLP groups).
- [ ] Add test: `CRUD lifecycle — create and delete catalog` — create catalog with `domainId: 'ZARC1_INTTEST_' + Date.now()`, assert returned entity has `id` starting with `X-SAP-UI2-CATALOGPAGE:`. Then delete by the returned `id`, assert no error. Use `try/finally` for cleanup (delete in finally). This test is slow (~60-90s) due to SAP backend processing.
- [ ] Wrap FLP tests in a conditional block: skip the entire describe if the FLP service probe returns 404. Use `requireOrSkip(ctx, serviceAvailable, SkipReason.BACKEND_UNSUPPORTED)`.
- [ ] Run `npm run test:integration` — tests pass (confirmed: PAGE_BUILDER_CUST is active on A4H test system)

### Task 9: Update documentation (roadmap, feature matrix, tools, CLAUDE.md)

**Files:**
- Modify: `docs/roadmap.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `docs/tools.md`
- Modify: `CLAUDE.md`

Update project artifacts to reflect FLP feature completion.

- [ ] In `docs/roadmap.md`: update FEAT-40 status from "Not started" to "Completed", add completion date. Move to the "Completed" table. Strike through in the prioritized execution order.
- [ ] In `docs/compare/00-feature-matrix.md`: update the FLP/OData row to show ✅ for ARC-1
- [ ] In `docs/tools.md`: add FLP actions to the SAPManage tool reference section (currently at lines 474-521). Document each action, required parameters, and example responses.
- [ ] In `CLAUDE.md`: update the "Key Files for Common Tasks" table to add a row for FLP: `Add FLP operation | src/adt/flp.ts, src/handlers/intent.ts, src/handlers/tools.ts, src/handlers/schemas.ts`. Update the codebase structure tree to include `src/adt/flp.ts`. Add `flp` to the FeatureConfig reference if the config table lists feature flags.
- [ ] Run `npm run lint` — no lint errors in modified docs

### Task 10: Update authorization & Cloud Connector documentation for FLP OData route

**Files:**
- Modify: `docs/authorization.md`
- Modify: `docs/setup-guide.md` (or `docs/sap-trial-setup.md` if more appropriate)
- Modify: `docs/principal-propagation-setup.md`
- Modify: `docs/security-guide.md`

The FLP feature uses a non-ADT OData endpoint (`/sap/opu/odata/UI2/PAGE_BUILDER_CUST`) that requires separate SAP authorization objects and explicit Cloud Connector resource whitelisting. Without these, FLP operations will fail with 403 (authorization) or connection errors (CC not routing the path).

**SAP Authorization (verified via SAP Help Portal — [Authorizations for UI Services](https://help.sap.com/docs/ABAP_PLATFORM_NEW/9765143c554c4ec3951fb17ff80d8989/86fa207d3edd4ed987e66b547d1b3025.html)):**

The PAGE_BUILDER_CUST OData service requires these SAP authorization objects beyond the standard ADT objects (S_ADT_RES, S_DEVELOP):

| Auth Object | Field | Value | Purpose |
|-------------|-------|-------|---------|
| **S_SERVICE** | SRV_NAME | (hashed — see USOBHASH table) | OData service access for `/UI2/PAGE_BUILDER_CUST` |
| | SRV_TYPE | HT | Hash type |
| **S_PB_CHIP** | ACTIVITY | All (admin) or 03+16 (read-only) | Page builder access — required for catalog/tile operations |
| | CHIP_NAME | (none or X-SAP-UI2*) | |
| **/UI2/CHIP** | ACTIVITY | All (admin) or 03+16 (read-only) | Chip access — required for tile creation |
| | /UI2/CHIP | X-SAP-UI2* | |
| **S_DEVELOP** | OBJTYPE | IWSG | OData service group registration |
| **S_TRANSPRT** | (standard) | | Required if FLP customizations are transported |

SAP provides example roles: `SAP_FLP_ADMIN` (full admin — includes PAGE_BUILDER_CUST + CONF + PERS) and `SAP_FLP_USER` (end-user — only PAGE_BUILDER_PERS + INTEROP + LAUNCHPAD).

- [ ] In `docs/authorization.md`, add FLP-specific authorization objects to the "Key SAP Authorization Objects" table (after `S_SQL_VIEW` at line ~249):
  ```
  | **S_SERVICE** | OData service start authorization (hashed SRV_NAME) | SAPManage (FLP actions) |
  | **S_PB_CHIP** | Page builder chip access | SAPManage (FLP actions) |
  | **/UI2/CHIP** | UI2 chip access | SAPManage (FLP actions) |
  ```
- [ ] In `docs/authorization.md`, add a new "Recommended SAP Roles" entry for FLP:
  ```
  | **ZMCP_FLP** | S_SERVICE (PAGE_BUILDER_CUST), S_PB_CHIP, /UI2/CHIP, S_DEVELOP (OBJTYPE=IWSG) | FLP launchpad management via SAPManage |
  ```
  Also add a note: "Alternatively, assign SAP standard role `SAP_FLP_ADMIN` which includes all required authorizations for FLP customization."
- [ ] In `docs/authorization.md`, add a note in the "POST Needed for Read Operations" warning box that FLP list operations also use HTTP GET (not POST), but the OData service still requires S_SERVICE authorization.
- [ ] In `docs/authorization.md`, add an "ICF Service Activation" subsection after the authorization objects table explaining that the PAGE_BUILDER_CUST OData service must be activated via transaction `/IWFND/MAINT_SERVICE` (see [SAP Help: Activate OData Services for FLP](https://help.sap.com/docs/FIORI_IMPLEMENTATION_740/bc700aa28d5c468c84969c3b33773710/b7383953fcabff4fe10000000a44176d.html)). List the required services: `/UI2/PAGE_BUILDER_CUST` (activated as `ZPAGE_BUILDER_CUST` in customer namespace). Verification: `curl -s -o /dev/null -w "%{http_code}" "$SAP_URL/sap/opu/odata/UI2/PAGE_BUILDER_CUST/"` should return 200.

**Cloud Connector Resource Whitelisting:**

The `sap-trial-setup.md` uses a permissive `/` wildcard for all paths. Production deployments with restrictive CC resource rules need to explicitly whitelist the FLP OData path. SAP's own documentation ([Expose Service Paths on SAP Cloud Connector](https://help.sap.com/docs/SAP_COPILOT/c7d829d2dff24c458f88fe7671e3ae8e/c50ef094c74440bebc95b1e6ed4a8df6.html)) lists `/sap/opu/odata/UI2/PAGE_BUILDER_CUST` as a required whitelist path.

- [ ] In `docs/principal-propagation-setup.md`, add a "Required Cloud Connector Resource Paths" section after the system mapping step (Step 2, line ~74). Document the minimum CC resource paths for ARC-1:
  ```
  | URL Path | Access Policy | Purpose |
  |----------|--------------|---------|
  | `/sap/bc/adt` | Path and all sub-paths | ADT API (all ARC-1 read/write operations) |
  | `/sap/opu/odata/UI2/PAGE_BUILDER_CUST` | Path and all sub-paths | FLP launchpad management (SAPManage FLP actions) |
  | `/sap/opu/odata/UI5/ABAP_REPOSITORY_SRV` | Path and all sub-paths | UI5 ABAP Repository (BSP deploy info) |
  ```
  Note: the trial setup guide uses `/` (all paths) which implicitly includes these. Production deployments should use explicit path whitelisting for defense-in-depth.
- [ ] In `docs/security-guide.md`, add a note in the BTP-specific security section mentioning that FLP management operations require additional CC resource paths beyond `/sap/bc/adt` if restrictive path whitelisting is used.
- [ ] In `docs/setup-guide.md` (if it exists) or `docs/sap-trial-setup.md`, add a note in the "Adding Resources" section (line ~558) that the `/` wildcard includes FLP OData paths, but production deployments should use explicit paths. List `/sap/opu/odata/UI2/PAGE_BUILDER_CUST` as needed for FLP management.
- [ ] Run `npm run lint` — no lint errors in modified docs

### Task 11: Final verification

- [ ] Run full test suite: `npm test` — all tests pass
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors
- [ ] Verify FLP feature probe is included in `SAPManage probe` output (check feature list)
- [ ] Verify `SAPManage flp_list_catalogs` is routed correctly (check handler switch)
- [ ] Verify SAPManage tool description includes FLP actions (check tools.ts)
- [ ] Verify `docs/authorization.md` includes FLP-specific auth objects (S_SERVICE, S_PB_CHIP, /UI2/CHIP)
- [ ] Verify `docs/principal-propagation-setup.md` includes CC resource path for `/sap/opu/odata/UI2/PAGE_BUILDER_CUST`
- [ ] Move this plan to `docs/plans/completed/`
