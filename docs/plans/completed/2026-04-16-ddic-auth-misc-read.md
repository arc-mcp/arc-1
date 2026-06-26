# FEAT-43: DDIC Auth & Misc Read (Authorization Fields, Feature Toggles, Enhancement Implementations)

## Overview

This plan adds three new read-only SAPRead types for on-premise ABAP systems: `AUTH` (Authorization Fields), `FTG2` (Feature Toggles), and `ENHO` (Enhancement Implementations / BAdI). The new operations let LLMs inspect authorization metadata, feature-toggle states from SAP's switch framework, and BAdI implementations — useful for security audits, conditional-feature analysis, and enhancement discovery.

All three endpoints are **on-prem only** (not available on BTP ABAP Environment) and read-only (no CRUD). The Authorization Field and Enhancement Implementation endpoints return XML (parsed into structured JSON); the Feature Toggle endpoint returns JSON (passed through after parse).

The roadmap (`docs/roadmap.md` line 1193) currently states an incorrect URL for Authorization Fields — this plan also fixes that. The correct URL (verified against sapcli commit `2ec4228`) is `/sap/bc/adt/aps/iam/auth/{name}`, not `/sap/bc/adt/authorizationfields/{name}`.

## Context

### Current State

- SAPRead supports DDIC metadata for `DOMA`, `DTEL`, `MSAG`, `TRAN`, etc., but has no support for authorization fields, feature toggles, or enhancement implementations.
- `docs/compare/00-feature-matrix.md` line 93 shows ARC-1 as ❌ for "Enhancements (BAdI/ENHO)" — sapcli is ✅.
- No competitor has Authorization Fields read yet (sapcli added it April 2026). ARC-1 would be first MCP server to expose this.
- Feature Toggles are used heavily in SAP's switch framework (SFW); no MCP server currently exposes them.

### Target State

- `SAPRead(type="AUTH", name="S_DEVELOP")` returns structured JSON with field name, role name, check table, conversion exit, output length, origin-level info.
- `SAPRead(type="FTG2", name="BTP_TOGGLE_NAME")` returns structured JSON with the feature toggle's current state (on/off per system) parsed from ADT JSON.
- `SAPRead(type="ENHO", name="ZMY_BADI_IMPL")` returns structured JSON with BAdI technology type, referenced enhancement spot, and list of BAdI implementation entries.
- All three types listed in `SAPREAD_TYPES_ONPREM` (not BTP), documented in on-prem tool description, `docs/tools.md`, `docs/compare/00-feature-matrix.md`, and marked as done in `docs/roadmap.md`.

### Key Files

| File | Role |
|------|------|
| `src/adt/types.ts` | Response type definitions (`DomainInfo`, `DataElementInfo`, etc.) — add `AuthorizationFieldInfo`, `FeatureToggleInfo`, `EnhancementImplementationInfo` |
| `src/adt/xml-parser.ts` | XML parsers (`parseDomainMetadata`, `parseDataElementMetadata`) — add three new parsers |
| `src/adt/client.ts` | ADT client facade with read operations (`getDomain`, `getDataElement`, `getTransaction`) — add three new methods |
| `src/handlers/schemas.ts` | Zod input schemas; `SAPREAD_TYPES_ONPREM` enum at line 17 — add `AUTH`, `FTG2`, `ENHO` |
| `src/handlers/tools.ts` | JSON-Schema tool definitions; `SAPREAD_TYPES_ONPREM` at line 38, `SAPREAD_DESC_ONPREM` at line 99 — mirror schema changes and update description text |
| `src/handlers/intent.ts` | `handleSAPRead` router (line 606), case statements ~line 793 — add `case 'AUTH'`, `case 'FTG2'`, `case 'ENHO'` |
| `tests/unit/adt/xml-parser.test.ts` | Parser unit tests — add describe blocks for the three new parsers |
| `tests/unit/adt/client.test.ts` | Client unit tests — add mocked tests for the three new methods |
| `tests/unit/handlers/intent.test.ts` | Router tests (if present) — add AUTH/FTG2/ENHO routing tests |
| `tests/integration/adt.integration.test.ts` | Integration tests against live SAP A4H — add reads for well-known fixtures |
| `tests/fixtures/xml/` | XML fixtures — add `authorization-field.xml`, `enhancement-implementation.xml`, `feature-toggle-states.json` |
| `docs/tools.md` | Tool reference — add AUTH/FTG2/ENHO to the `type` row and add per-type description |
| `docs/roadmap.md` | FEAT-43 entry (line 1183) — fix incorrect URL, mark as completed |
| `docs/compare/00-feature-matrix.md` | Update "Enhancements (BAdI/ENHO)" row (line 93) to ✅; add new "Authorization fields" and "Feature toggles" rows |
| `CLAUDE.md` | "Key Files for Common Tasks" table — add a row for AUTH/FTG2/ENHO |

### Design Principles

1. **Read-only, on-prem only.** All three new types go into `SAPREAD_TYPES_ONPREM` only. They must NOT be added to `SAPREAD_TYPES_BTP` (the BTP ABAP Environment doesn't expose these endpoints — all three are classic on-prem SFW / IAM / enhancement framework artifacts).
2. **Structured JSON output.** Parse XML into typed objects and return as `JSON.stringify(obj, null, 2)` — same pattern used by `DOMA`, `DTEL`, `MSAG` cases in `intent.ts`.
3. **No CRUD.** These operations are `OperationType.Read` only. No `checkOperation(..., OperationType.Create, ...)` and no safety gates beyond the default read gate.
4. **XML fallback for ENHO.** sapcli tries `v4+xml` first with fallback to `v3+xml`. Our ADT discovery layer already handles content-negotiation fallback; pass the preferred Accept header and let `http.ts` retry on 406/415 — do not hand-roll the fallback.
5. **FTG2 returns JSON, not XML.** `/sap/bc/adt/sfw/featuretoggles/{name}/states` returns `application/vnd.sap.adt.states.v1+asjson`. Parse with `JSON.parse` and re-emit the structured shape we care about. Do NOT route through `xml-parser.ts`.
6. **Do not include write paths.** SAP's feature-toggle toggle/check/validate endpoints (POST) are out of scope for this plan — pure read only.
7. **Ignore fixture unavailability.** Some systems may not have the Authorization Fields endpoint (it requires an ADT kernel version from late 2024+). Integration tests must use `requireOrSkip` with `SkipReason.BACKEND_UNSUPPORTED` on 404 — never silent-pass.

## Development Approach

- Follow the existing DDIC patterns (`getDomain`, `parseDomainMetadata`, `DomainInfo`) — keep parsers pure, side-effect-free, and tested against fixture XML.
- Types/parsers first (foundation), then client methods, then handler cases, then schemas/tools, then tests, then docs.
- Use `vi.mock('undici', ...)` + `mockResponse(200, xml, { 'x-csrf-token': 'T' })` for unit tests; use `getTestClient()` + `requireSapCredentials()` for integration tests.
- Integration tests should try a well-known authorization field (e.g., `BUKRS` — the company code field on `S_TABU_DIS`). Feature toggles may not exist on SAP A4H in useful form — use `requireOrSkip` liberally.
- No E2E test required for pure read additions following an existing pattern. Integration test coverage is sufficient.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Add response types in `src/adt/types.ts`

**Files:**
- Modify: `src/adt/types.ts`

Add three new interfaces mirroring the existing `DomainInfo` / `DataElementInfo` shape. These types will be consumed by the new XML/JSON parsers and the `SAPRead` handler. Place them in a new "Authorization & Switch Framework Types" section at the end of the file.

- [ ] Open `src/adt/types.ts` and scroll to the end (after `InactiveObject`, ~line 451).
- [ ] Add interface `AuthorizationFieldInfo` with string fields: `name`, `description`, `roleName`, `checkTable`, `domainName`, `outputLength`, `conversionExit`, `exitFunctionModule`, `package`; plus `orgLevelInfo: string[]` and `masterLanguage: string` (from `adtcore:masterLanguage`).
- [ ] Add interface `FeatureToggleInfo` with string fields: `name`, `description`, `package`; plus `states: Array<{ system: string; state: 'on' | 'off' | 'unknown'; description?: string }>` (one entry per SAP system returned by the `/states` endpoint — typically at least the current system).
- [ ] Add interface `EnhancementImplementationInfo` with string fields: `name`, `description`, `package`, `technology` (e.g., `BADI_IMPL`, `ENHO_GENERIC`), `referencedObjectUri`, `referencedObjectName`, `referencedObjectType`; plus `badiImplementations: Array<{ name: string; implementationClass: string; badiDefinition: string; active: boolean; default: boolean }>`.
- [ ] Add JSDoc comments (one line each) matching the style of `DomainInfo` / `DataElementInfo` — describe which ADT endpoint produces the type.
- [ ] Run `npm run typecheck` — must pass (types-only change, no behavior).
- [ ] Add unit tests: none for this task (types have no runtime behavior).

### Task 2: Add XML/JSON parsers in `src/adt/xml-parser.ts`

**Files:**
- Modify: `src/adt/xml-parser.ts`
- Create: `tests/fixtures/xml/authorization-field.xml`
- Create: `tests/fixtures/xml/enhancement-implementation.xml`
- Create: `tests/fixtures/xml/feature-toggle-states.json`
- Modify: `tests/unit/adt/xml-parser.test.ts`

Add `parseAuthorizationField(xml)`, `parseFeatureToggleStates(json)`, `parseEnhancementImplementation(xml)`. Follow the existing `parseDomainMetadata` pattern (xml-parser.ts ~line 455): use `parseXml()` to strip namespaces, destructure root, use `findDeepNodes()` for nested arrays, coerce every field with `String(... ?? '')`.

**Reference XML namespaces and roots (verified from sapcli source):**
- Authorization field: root `<auth:auth>` (after NS strip → `auth`), namespace `http://www.sap.com/iam/auth`, children include `auth:fieldName`, `auth:rollName`, `auth:checkTable`, `auth:domname`, `auth:outputlen`, `auth:convexit`, `auth:exitFB`, `auth:orglvlinfo` (repeating).
- Feature toggle states: **JSON** (not XML) — structure `{ "states": [ { "system": "A4H", "state": "on" | "off", ... } ] }` from MIME `application/vnd.sap.adt.states.v1+asjson`.
- Enhancement implementation: root `<enho:objectData>` (after NS strip → `objectData`), namespace `http://www.sap.com/adt/enhancements/enho`. Children: `enho:contentCommon`, `enho:contentSpecific`, `enho:badiTechnology`, `enho:badiImplementations` > `enho:badiImplementation` (repeating with `@_name`, `@_implementingClass`, `@_badi`, `@_active`, `@_default`). Also `enhcore:referencedObject` from `http://www.sap.com/abapsource/enhancementscore`.

Steps:

- [ ] Create `tests/fixtures/xml/authorization-field.xml` — a minimal but realistic sample for `BUKRS` field on object `S_TABU_DIS`: include `<auth:auth>` root with `adtcore:name="BUKRS"`, `adtcore:description="Company code"`, `auth:fieldName`, `auth:rollName="BUKRS"`, `auth:checkTable="T001"`, `auth:domname="BUKRS"`, `auth:outputlen="4"`, `auth:convexit=""`, `auth:exitFB=""`, two `auth:orglvlinfo` entries, and an `<adtcore:packageRef adtcore:name="SF">`.
- [ ] Create `tests/fixtures/xml/enhancement-implementation.xml` — realistic sample: `<enho:objectData>` root with `adtcore:name="ZMY_BADI_IMPL"`, `adtcore:description="Test impl"`, nested `<enho:badiTechnology>BADI_IMPL</enho:badiTechnology>`, `<enhcore:referencedObject adtcore:uri="/sap/bc/adt/enhancements/enhsxsb/..." adtcore:name="..." adtcore:type="ENHS/XSB"/>`, and two `<enho:badiImplementation>` children with distinct `@_name` / `@_implementingClass` / `@_active` values.
- [ ] Create `tests/fixtures/xml/feature-toggle-states.json` — realistic sample: `{ "name": "ABC_TOGGLE", "description": "Sample toggle", "states": [ { "system": "A4H", "state": "on" } ] }`.
- [ ] Add exported function `parseAuthorizationField(xml: string): AuthorizationFieldInfo` at end of `xml-parser.ts`. Use `parseXml()`, destructure `parsed.auth`, extract `packageRef['@_name']`, map `findDeepNodes(... , 'orglvlinfo')` to string array. Coerce all string fields via `String(... ?? '')`.
- [ ] Add exported function `parseEnhancementImplementation(xml: string): EnhancementImplementationInfo`. Destructure `parsed.objectData`. Pull `referencedObject` via `findDeepNodes(parsed, 'referencedObject')[0]`. Map `badiImplementation` children (either array or single object) into the `badiImplementations` result array. Boolean fields (`active`, `default`) via `String(attr) === 'true'`.
- [ ] Add exported function `parseFeatureToggleStates(json: string, name: string): FeatureToggleInfo`. Use `JSON.parse(json)` (wrap in try/catch — throw `AdtApiError` with code `ADT_JSON_PARSE` on failure). Map states to `{ system, state, description? }`. Default state to `'unknown'` when not `'on'` or `'off'`.
- [ ] Add parser unit tests in `tests/unit/adt/xml-parser.test.ts` (~6 tests): one fixture-based test per parser, plus one "minimal payload" test per parser that constructs inline XML/JSON with only required fields and asserts empty-string / empty-array defaults. Follow the `parseDomainMetadata` test style at line 368.
- [ ] Run `npm test -- tests/unit/adt/xml-parser.test.ts` — all tests pass.
- [ ] Run `npm test` — full suite still passes.

### Task 3: Add client methods in `src/adt/client.ts`

**Files:**
- Modify: `src/adt/client.ts`
- Modify: `tests/unit/adt/client.test.ts`

Add three new read methods on the `AdtClient` class following the `getDomain` pattern at line 324: `checkOperation(safety, OperationType.Read, '...')` → `http.get(url, { Accept: '...' })` → parse → return. Place them after `getDataElement()` (line 335) in a new "Authorization & Switch Framework" section.

Verified URLs and MIME types (from sapcli commit `2ec4228`):

| Method | URL | Accept header |
|--------|-----|---------------|
| `getAuthorizationField(name)` | `/sap/bc/adt/aps/iam/auth/{encodeURIComponent(name)}` | `application/vnd.sap.adt.blues.v1+xml` |
| `getFeatureToggle(name)` | `/sap/bc/adt/sfw/featuretoggles/{encodeURIComponent(name)}/states` | `application/vnd.sap.adt.states.v1+asjson` |
| `getEnhancementImplementation(name)` | `/sap/bc/adt/enhancements/enhoxhb/{encodeURIComponent(name)}` | `application/vnd.sap.adt.enh.enhoxhb.v4+xml` (let `http.ts` fall back to `...v3+xml` via content-negotiation retry — do not hand-code fallback) |

Steps:

- [ ] Import the three new parsers from `./xml-parser.js` and the three new types from `./types.js` at the top of `client.ts`.
- [ ] Add method `async getAuthorizationField(name: string): Promise<AuthorizationFieldInfo>` with `OperationType.Read` op name `'GetAuthorizationField'`.
- [ ] Add method `async getFeatureToggle(name: string): Promise<FeatureToggleInfo>` with op name `'GetFeatureToggle'`. Pass the parsed JSON + `name` into `parseFeatureToggleStates(body, name)`.
- [ ] Add method `async getEnhancementImplementation(name: string): Promise<EnhancementImplementationInfo>` with op name `'GetEnhancementImplementation'`.
- [ ] In `tests/unit/adt/client.test.ts`, add three mocked tests mirroring the `getDomain` test at line 276. Each should: `mockFetch.mockReset()` → `mockFetch.mockResolvedValue(mockResponse(200, fixtureContent, { 'x-csrf-token': 'T' }))` → call the method → assert at least two fields from the parsed result.
- [ ] Use `loadFixture('authorization-field.xml')` / `loadFixture('enhancement-implementation.xml')` / `loadFixture('feature-toggle-states.json')` to share fixture content between parser and client tests.
- [ ] Run `npm test -- tests/unit/adt/client.test.ts` — must pass.
- [ ] Run `npm test` — full suite still passes.

### Task 4: Wire AUTH / FTG2 / ENHO into SAPRead schemas and tools

**Files:**
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`

Extend the on-prem SAPRead enum and description. **Do NOT add these types to the BTP enum** — the endpoints are on-prem only (BTP ABAP Environment does not expose `aps/iam/auth`, `sfw/featuretoggles`, or `enhancements/enhoxhb`).

Steps:

- [ ] In `src/handlers/schemas.ts`, add `'AUTH'`, `'FTG2'`, `'ENHO'` to `SAPREAD_TYPES_ONPREM` (line 17) after `'INACTIVE_OBJECTS'`. Keep `as const`.
- [ ] In `src/handlers/tools.ts`, add the same three string literals to the `SAPREAD_TYPES_ONPREM` array (line 38-69) after `'INACTIVE_OBJECTS'`.
- [ ] Update `SAPREAD_DESC_ONPREM` in `tools.ts` (line 99-100) by appending to the type list: `AUTH (Authorization Fields — returns check table, domain, conversion exit, org-level flags; on-prem only)`, `FTG2 (Feature Toggles — returns current toggle state per system from SAP's switch framework; on-prem only)`, `ENHO (Enhancement Implementations / BAdI — returns technology type, referenced enhancement spot, list of BAdI implementations with their implementing classes; on-prem only)`.
- [ ] Also update the `type` enum summary in the SAPRead JSON-Schema (the `type` field `description` string) to include the new types.
- [ ] Run `npm run typecheck` — zod enum changes must compile.
- [ ] Run `npm run lint` — must pass.
- [ ] Add ~3 unit tests in `tests/unit/handlers/schemas.test.ts` (or wherever the SAPRead schema tests live — grep for `SAPREAD_TYPES_ONPREM` to find): assert AUTH/FTG2/ENHO accepted on-prem, rejected on BTP. If no existing tests exist for enum membership, add a new describe block.
- [ ] Run `npm test` — all tests pass.

### Task 5: Add handler cases in `src/handlers/intent.ts`

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts` (if it exists; otherwise skip this file)

Add three new cases to the `handleSAPRead` switch (around line 793 where `DOMA`/`DTEL`/`TRAN` cases live). All three follow the same `textResult(JSON.stringify(..., null, 2))` pattern used by `DOMA`:

```typescript
case 'AUTH': {
  const auth = await client.getAuthorizationField(name);
  return textResult(JSON.stringify(auth, null, 2));
}
case 'FTG2': {
  const toggle = await client.getFeatureToggle(name);
  return textResult(JSON.stringify(toggle, null, 2));
}
case 'ENHO': {
  const enho = await client.getEnhancementImplementation(name);
  return textResult(JSON.stringify(enho, null, 2));
}
```

Steps:

- [ ] Locate the `DOMA` case in `handleSAPRead` (line 793). Add the three new cases immediately after `DTEL` (before `TRAN`).
- [ ] Verify no other switch in `intent.ts` needs updating — these are read-only additions (no `buildCreateXml`, no `getDdicContentType`, no `getCreateUrl` changes).
- [ ] Run `npm run typecheck` and `npm run lint`.
- [ ] If `tests/unit/handlers/intent.test.ts` exists with routing tests, add ~3 tests: mock `client.getAuthorizationField` / `getFeatureToggle` / `getEnhancementImplementation` and assert the handler returns the JSON-stringified shape. If routing tests are in a different file or don't exist, rely on the client-level tests from Task 3 as coverage.
- [ ] Run `npm test` — all tests pass.

### Task 6: Integration tests against live SAP

**Files:**
- Modify: `tests/integration/adt.integration.test.ts`

Add three integration tests against the configured SAP system (A4H). Use `getTestClient()` from `tests/integration/helpers.ts`, `requireSapCredentials()` to hard-fail when `TEST_SAP_URL` unset, and `requireOrSkip` for graceful skip when the backend doesn't expose the endpoint.

Steps:

- [ ] At the top of the existing describe block for DDIC reads (or in a new `describe('AUTH/FTG2/ENHO read')` block), add three tests.
- [ ] **AUTH test:** `await client.getAuthorizationField('BUKRS')` (company code is a ubiquitous SAP authorization field). Assert `result.name === 'BUKRS'`. Wrap in `try/catch` and, on 404, `requireOrSkip(ctx, false, SkipReason.BACKEND_UNSUPPORTED, 'Auth Fields ADT endpoint not available on this kernel')` via `expectSapFailureClass` + conditional skip — follow the pattern used elsewhere for kernel-version-dependent endpoints.
- [ ] **FTG2 test:** probe a well-known feature toggle if one exists on A4H; if none is known, use `expectSapFailureClass(err, [404, 403], [/not found/i, /no authorization/i])` and skip with `SkipReason.BACKEND_UNSUPPORTED`. Document in a comment that feature toggles are typically empty on plain A4H systems.
- [ ] **ENHO test:** use any known BAdI implementation name on A4H if available; otherwise skip with `SkipReason.NO_FIXTURE`. If a plain-vanilla A4H has no customer BAdI impls, fall back to a SAP-standard one (e.g., query via `SAPSearch(type='ENHO')` first and use the first result). If search also returns empty, skip.
- [ ] Every catch must assert something (expected error class) — no empty `catch {}` and no `if (!x) return;` shortcuts.
- [ ] Run `npm run test:integration` — all tests pass or skip with a documented reason.

### Task 7: Documentation updates

**Files:**
- Modify: `docs/tools.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `CLAUDE.md`

Keep every artifact that lists SAPRead types in sync. Specifically, the `docs/tools.md` type table (line 145) and per-type field docs need the new rows; `docs/roadmap.md` FEAT-43 entry needs a status flip to completed AND the URL correction; the feature matrix needs three rows updated/added; `CLAUDE.md`'s "Key Files for Common Tasks" table needs a row for AUTH/FTG2/ENHO.

Steps:

- [ ] `docs/tools.md` line 145: append `AUTH`, `FTG2`, `ENHO` to the `type` parameter enum description.
- [ ] `docs/tools.md` lines 49-50 area: add three short table rows describing `AUTH`, `FTG2`, `ENHO` return shapes (same style as `DOMA`, `DTEL`).
- [ ] `docs/tools.md` examples block (around line 89): add three SAPRead examples.
- [ ] `docs/roadmap.md` line 1183: update FEAT-43 status from `Not started` to `Completed (2026-04-17)`. Also fix the URL in line 1193 — change `/sap/bc/adt/authorizationfields/{name}` to `/sap/bc/adt/aps/iam/auth/{name}` and note the XML namespace `http://www.sap.com/iam/auth`. Update the top-of-file matrix at line 60 (`FEAT-43` row) to show completed status.
- [ ] `docs/roadmap.md` "Completed items" section (the list that mentions FEAT-46, FEAT-47, FEAT-48 as completed around line 197-203): add FEAT-43 entry with completion date.
- [ ] `docs/compare/00-feature-matrix.md` line 93 (`Enhancements (BAdI/ENHO)`): change ARC-1 column from ❌ to ✅ and add endpoint note `` `GET /sap/bc/adt/enhancements/enhoxhb/{name}` ``.
- [ ] `docs/compare/00-feature-matrix.md`: add a new row after line 93 for `Authorization fields (AUTH)` — ARC-1 ✅, sapcli ✅ (both with endpoint note `/sap/bc/adt/aps/iam/auth/{name}`), others ❌.
- [ ] `docs/compare/00-feature-matrix.md`: add a new row for `Feature toggles (FTG2)` — ARC-1 ✅ (states only), sapcli ✅ (states/toggle/check/validate), others ❌.
- [ ] `docs/compare/00-feature-matrix.md`: update the "Last Updated" date at the top of the file.
- [ ] `CLAUDE.md` "Key Files for Common Tasks" table: add a row `| Add AUTH/FTG2/ENHO read (read-only DDIC metadata) | src/adt/client.ts, src/adt/xml-parser.ts, src/adt/types.ts, src/handlers/intent.ts, src/handlers/schemas.ts, src/handlers/tools.ts |`.
- [ ] Spot-check `README.md` — if SAPRead feature highlights call out specific types, add AUTH/FTG2/ENHO. Skip if no type list is present.
- [ ] Run `npm test` and `npm run typecheck` — no code touched, but ensure nothing regressed.

### Task 8: Final verification

- [ ] Run `npm test` — all unit tests pass.
- [ ] Run `npm run typecheck` — no errors.
- [ ] Run `npm run lint` — no errors.
- [ ] Run `npm run test:integration` when `TEST_SAP_URL` is available — all three new integration tests pass or skip with a documented reason (no silent skips).
- [ ] Manually invoke `SAPRead(type="AUTH", name="BUKRS")` via `npm run dev` stdio against A4H; verify structured JSON output includes `checkTable: "T001"` and a non-empty `orgLevelInfo` array.
- [ ] Manually invoke `SAPRead(type="ENHO", name="<any_existing_impl>")` and verify `badiImplementations` array is populated.
- [ ] `git grep -n 'authorizationfields' docs/` returns nothing (old incorrect URL fully removed from roadmap).
- [ ] `docs/roadmap.md` FEAT-43 is marked Completed.
- [ ] `docs/compare/00-feature-matrix.md` Authorization Fields / Feature Toggles / Enhancements rows all reflect ARC-1 ✅.
- [ ] Move this plan to `docs/plans/completed/2026-04-16-ddic-auth-misc-read.md`.
