# FEAT-02: API Release State Tool (Clean Core)

## Overview

Add a new `API_STATE` type to `SAPRead` that checks whether an SAP object is released for use in ABAP Cloud / S/4HANA Clean Core. This is critical for every S/4HANA Cloud and BTP ABAP customer — AI copilots assisting with ABAP Cloud development must know which APIs are released, deprecated, or internal.

The feature calls the ADT API release state endpoint (`/sap/bc/adt/apireleases/...`) and returns structured JSON with contract-level release states (C0–C4), successor information, and catalog metadata. This maps directly to what developers see in Eclipse ADT's "API State" column.

**Reference implementation**: vibing-steampunk (VSP) added `GetAPIReleaseState` in commit 7270ad7 (Apr 5) with a bug fix in commit 8a478aa (Apr 9) that corrected how the nested C1 release state is extracted. Our implementation will follow the corrected pattern from the start.

## Context

### Current State

ARC-1 has no way to check API release state. The `SAPRead` tool reads object source and metadata but cannot tell the LLM whether an API is released for cloud use. The roadmap lists this as **P0** (FEAT-02) — ARC-1 is the only major MCP server for SAP without this capability.

### Target State

- `SAPRead(type="API_STATE", name="CL_SALV_TABLE")` returns structured JSON with release contracts
- Works for all object types that have ADT URIs: CLAS, INTF, PROG, FUGR, TABL, DDLS, DOMA, DTEL, SRVD, SRVB, BDEF, DDLX, STRU, FUNC
- Available on both on-premise and BTP ABAP Environment
- Integrated into hyperfocused mode automatically (via existing SAPRead routing)

### Key Files

| File | Role |
|------|------|
| `src/adt/types.ts` | New `ApiReleaseStateInfo` type definition |
| `src/adt/xml-parser.ts` | New `parseApiReleaseState()` parser for ADT XML response |
| `src/adt/client.ts` | New `getApiReleaseState()` method |
| `src/handlers/schemas.ts` | Add `API_STATE` to `SAPREAD_TYPES_ONPREM` and `SAPREAD_TYPES_BTP` |
| `src/handlers/tools.ts` | Add `API_STATE` to type lists and descriptions |
| `src/handlers/intent.ts` | Add `API_STATE` case in `handleSAPRead()` switch, extend `objectUrlForType()` |
| `tests/unit/adt/client.test.ts` | Unit tests for `getApiReleaseState()` |
| `tests/unit/adt/xml-parser.test.ts` | Unit tests for `parseApiReleaseState()` |
| `tests/unit/handlers/intent.test.ts` | Unit tests for `API_STATE` routing |
| `docs/tools.md` | Document new `API_STATE` type |
| `docs/roadmap.md` | Mark FEAT-02 as completed |
| `docs/compare/00-feature-matrix.md` | Update API release state row |
| `CLAUDE.md` | Update codebase structure if needed |

### Design Principles

1. **Follow VSP's corrected ADT endpoint**: `/sap/bc/adt/apireleases/{url-encoded-object-uri}` with `Accept: application/vnd.sap.adt.apirelease.v10+xml`. The object URI is the full ADT path (e.g., `/sap/bc/adt/oo/classes/cl_salv_table`), URL-encoded as a path segment.
2. **Return all contract levels** (C0–C4) with their states, not just C1. Different contracts serve different purposes (C0=SAP internal, C1=released for key user apps and cloud, C2=use in BTP, etc.).
3. **Reuse existing `objectUrlForType()`** function in `intent.ts` to map type codes (CLAS, INTF, etc.) to ADT URI paths. The API release endpoint takes the object's ADT URI as input.
4. **Structured JSON output** following the pattern of DOMA/DTEL — return parsed typed objects, not raw XML.
5. **Read operation only** — uses `OperationType.Read` and `checkOperation()`, no new safety types needed.
6. **Both on-prem and BTP** — API release state is available on both (and especially valuable on BTP).

## Development Approach

- Follow the existing metadata-read pattern: `getDomain()` → `parseDomainMetadata()` → `DomainInfo`
- VSP's XML structure: root element contains `releasableObject`, `c0Release`–`c4Release` (each with `status` child containing `state` and `stateDescription` attrs), and `apiCatalogData`
- The ADT endpoint URL-encodes the object URI as a path segment: `/sap/bc/adt/apireleases/%2Fsap%2Fbc%2Fadt%2Foo%2Fclasses%2Fcl_salv_table`
- Unit tests will mock the XML response and verify parsing

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Add API release state types and XML parser

**Files:**
- Modify: `src/adt/types.ts`
- Modify: `src/adt/xml-parser.ts`
- Modify: `tests/unit/adt/xml-parser.test.ts`
- Create: `tests/fixtures/xml/api-release-state.xml`

Add the `ApiReleaseStateInfo` type and XML parser for ADT API release state responses. The ADT endpoint returns XML with contract-level release information (C0–C4), each containing a status element with state/description attributes, plus object metadata and catalog data.

- [ ] Add `ApiReleaseStateInfo` type to `src/adt/types.ts` (after the `ClassHierarchy` type at line ~337). The type should include:
  - `objectUri: string` — ADT URI of the object
  - `objectType: string` — object type (e.g., "CLAS/OC")
  - `objectName: string` — object name
  - `contracts: ApiReleaseContract[]` — array of contract-level states (C0–C4)
  - `isAnyContractReleased: boolean` — quick check from catalog data
  - `isAnyAssignmentPossible: boolean` — from catalog data
- [ ] Add `ApiReleaseContract` type:
  - `contract: string` — contract name (e.g., "C1")
  - `state: string` — release state (e.g., "RELEASED", "NOT_RELEASED", "DEPRECATED")
  - `stateDescription: string` — human-readable description
  - `useInKeyUserApps: boolean`
  - `useInSAPCloudPlatform: boolean`
  - `successors: Array<{ uri: string; type: string; name: string }>` — recommended replacements
- [ ] Create XML fixture file `tests/fixtures/xml/api-release-state.xml` with a realistic ADT response (based on VSP's XML struct: root with `releasableObject` attrs, `c1Release` with nested `status` element having `state` and `stateDescription` attrs, `successors > successor` elements, and `apiCatalogData` element)
- [ ] Add `parseApiReleaseState()` function to `src/adt/xml-parser.ts` following the `parseDomainMetadata()` pattern. Use `parseXml()` to parse, then navigate the tree. Key points from VSP's corrected implementation:
  - The release contract elements are named `c0Release`, `c1Release`, `c2Release`, `c3Release`, `c4Release` (after NS stripping)
  - Each has a `status` child with `@_state` and `@_stateDescription` attributes
  - The `releasableObject` has `@_uri`, `@_type`, `@_name` attributes
  - `apiCatalogData` has `@_isAnyContractReleased` and `@_isAnyAssignmentPossible` boolean attrs
  - Successor elements are at `successors > successor` with `@_uri`, `@_type`, `@_name` attrs
  - Iterate C0–C4, only include contracts that are present (not null/undefined)
- [ ] Add unit tests (~6 tests) to `tests/unit/adt/xml-parser.test.ts`: parse released object (C1 RELEASED), parse deprecated object with successor, parse not-released object, parse object with multiple contracts, parse empty/minimal response, parse response with catalog data flags
- [ ] Run `npm test` — all tests must pass

### Task 2: Add ADT client method for API release state

**Files:**
- Modify: `src/adt/client.ts`
- Modify: `tests/unit/adt/client.test.ts`

Add the `getApiReleaseState()` method to the ADT client. This method calls the ADT endpoint `/sap/bc/adt/apireleases/{encoded-object-uri}` with the appropriate Accept header. The object URI parameter is the full ADT path of the object (e.g., `/sap/bc/adt/oo/classes/cl_salv_table`), which gets URL-encoded as a path segment.

- [ ] Import `ApiReleaseStateInfo` from `./types.js` in `src/adt/client.ts` (add to the existing type import block at line ~24–34)
- [ ] Import `parseApiReleaseState` from `./xml-parser.js` in `src/adt/client.ts` (add to the existing parser import block at line ~35–50)
- [ ] Add `getApiReleaseState(objectUri: string): Promise<ApiReleaseStateInfo>` method to the `AdtClient` class, after the existing `getTransaction()` method (line ~316). Follow the `getSrvb()` pattern (line ~268) since it also uses a custom Accept header:
  ```typescript
  async getApiReleaseState(objectUri: string): Promise<ApiReleaseStateInfo> {
    checkOperation(this.safety, OperationType.Read, 'GetApiReleaseState');
    const resp = await this.http.get(
      `/sap/bc/adt/apireleases/${encodeURIComponent(objectUri)}`,
      { Accept: 'application/vnd.sap.adt.apirelease.v10+xml' },
    );
    return parseApiReleaseState(resp.body);
  }
  ```
- [ ] Add unit tests (~4 tests) to `tests/unit/adt/client.test.ts` in a new describe block after the existing metadata tests (around line ~300): successful call returns parsed state, safety check blocks when read is disallowed, 404 for unknown object propagates error, verify correct URL encoding of the object URI path (e.g., `/sap/bc/adt/oo/classes/cl_salv_table` becomes `%2Fsap%2Fbc%2Fadt%2Foo%2Fclasses%2Fcl_salv_table`)
- [ ] Run `npm test` — all tests must pass

### Task 3: Add API_STATE routing in handlers

**Files:**
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

Wire up the `API_STATE` type through the handler layer: schema validation, tool definitions, and request routing.

- [ ] Add `'API_STATE'` to `SAPREAD_TYPES_ONPREM` array in `src/handlers/schemas.ts` (line ~45, before the `] as const`)
- [ ] Add `'API_STATE'` to `SAPREAD_TYPES_BTP` array in `src/handlers/schemas.ts` (line ~68, before the `] as const`)
- [ ] Add `'API_STATE'` to `SAPREAD_TYPES_ONPREM` array in `src/handlers/tools.ts` (line ~65, before the `]`)
- [ ] Add `'API_STATE'` to `SAPREAD_TYPES_BTP` array in `src/handlers/tools.ts` (line ~89, before the `]`)
- [ ] Update `SAPREAD_DESC_ONPREM` in `src/handlers/tools.ts` (line ~91) to add API_STATE description: `'API_STATE (API release state — checks if an object is released for ABAP Cloud / S/4HANA Clean Core; returns contract states C0-C4, successor info; essential for clean core compliance)'`
- [ ] Update `SAPREAD_DESC_BTP` in `src/handlers/tools.ts` (line ~94) to add similar API_STATE description (emphasize this is especially valuable on BTP)
- [ ] Add `API_STATE` case in the `handleSAPRead()` switch statement in `src/handlers/intent.ts`. The case should:
  1. Build the object URI using `objectUrlForType()` with args — the caller passes `name` (object name) and optionally a `type` hint (CLAS, INTF, etc.) that defaults to CLAS. The `objectUrlForType()` function (line ~1009) already maps type codes to ADT paths.
  2. However, for API_STATE the user may pass `name="CL_SALV_TABLE"` without specifying the object type. To handle this, accept an optional param that overrides the object type for URL construction. If not provided, attempt to infer from the name pattern (CL_ = CLAS, IF_/ZIF_ = INTF) or default to CLAS.
  3. Call `client.getApiReleaseState(objectUri)` and return `textResult(JSON.stringify(result, null, 2))`
  - Place this case near the existing metadata cases (DOMA, DTEL, TRAN around lines 572–594)
- [ ] Extend `objectUrlForType()` (line ~1009) if needed — it already handles CLAS, INTF, PROG, FUGR, INCL, DDLS, BDEF, SRVD, DDLX, SRVB, TABL, STRU, DOMA, DTEL, TRAN. For `FUNC` (individual function modules), the URL should be `/sap/bc/adt/functions/groups/{group}/fmodules/{name}` but since we don't always have the group, for API_STATE with type=FUNC it's acceptable to return the function group URL. Verify that the existing mappings are sufficient.
- [ ] Add unit tests (~5 tests) to `tests/unit/handlers/intent.test.ts`: API_STATE with explicit type returns release state JSON, API_STATE without type infers CLAS from name pattern, API_STATE for interface (IF_ prefix), API_STATE returns proper error for unknown object (404), API_STATE validates schema correctly
- [ ] Update the JSON Schema `inputSchema` for SAPRead in `src/handlers/tools.ts` to include `API_STATE` in the type enum. Also update the `properties` — API_STATE uses `name` (required) and optionally the existing `type` field could be repurposed, but since `type` is the SAPRead routing type, we need a secondary field. Add an `objectType` property (string, optional) to SAPRead's inputSchema for API_STATE use: "For API_STATE: the SAP object type (CLAS, INTF, PROG, FUGR, etc.) — auto-detected from name if omitted"
- [ ] Add `objectType` to the Zod schemas in `src/handlers/schemas.ts` as `objectType: z.string().optional()` in both `SAPReadSchema` and `SAPReadSchemaBtp`
- [ ] Run `npm test` — all tests must pass

### Task 4: Documentation and roadmap updates

**Files:**
- Modify: `docs/tools.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `CLAUDE.md`
- Modify: `.claude/commands/migrate-custom-code.md`

Update all documentation artifacts to reflect the new API release state capability.

- [ ] Add `API_STATE` row to the types table in `docs/tools.md` (after the `BSP_DEPLOY` row, around line ~51): `| API_STATE | API release state (clean core compliance — checks if an object is released for ABAP Cloud, returns contract states, successor info) |`
- [ ] Add usage examples to `docs/tools.md` after the existing examples section (around line ~85):
  ```
  SAPRead(type="API_STATE", name="CL_SALV_TABLE")              — check if class is released
  SAPRead(type="API_STATE", name="IF_HTTP_CLIENT")              — check interface release state
  SAPRead(type="API_STATE", name="CL_GUI_ALV_GRID", objectType="CLAS")  — explicit type
  ```
- [ ] Add `objectType` parameter to the SAPRead parameters table in `docs/tools.md` (around line ~14): `| objectType | string | No | For API_STATE: SAP object type (CLAS, INTF, PROG, etc.) — auto-detected from name if omitted |`
- [ ] Update `docs/roadmap.md`: change FEAT-02 status from "Not started" to "Completed", update the status field in the table, and mark the checkbox in the "Current State" feature list (line ~400: change `⬜` to `✅` for API release state)
- [ ] Update `docs/compare/00-feature-matrix.md`: find the API release state row in the comparison matrix and change ARC-1's status from ❌ to ✅, update "Last Updated" date
- [ ] Update `CLAUDE.md` if the new `objectType` parameter needs documentation in the config table or code patterns section (likely minimal — just ensure the Key Files table is still accurate)
- [ ] Update `.claude/commands/migrate-custom-code.md` to reference the new API_STATE capability — this skill performs custom code migration which directly benefits from knowing API release states. Add a step or note that the assistant can use `SAPRead(type="API_STATE", name="...")` to check if replacement APIs are released before recommending them
- [ ] Run `npm test` — all tests must pass (docs changes shouldn't break tests, but verify)

### Task 5: Final verification

- [ ] Run full test suite: `npm test` — all tests pass
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors
- [ ] Verify the new type is properly recognized: grep for `API_STATE` across source files to confirm it appears in schemas.ts, tools.ts, intent.ts
- [ ] Verify the XML parser handles edge cases: check that `parseApiReleaseState()` handles missing contract elements gracefully (some objects may have no C1 or C2 release)
- [ ] Move this plan to `docs/plans/completed/`
