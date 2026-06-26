# Plan: FEAT-33 CDS Impact Analysis

## Overview

Add CDS-specific **impact analysis** so a RAP skill can answer "if I change this CDS view, what breaks?" without the LLM having to stitch together multiple calls. Today ARC-1 has:

- **Upstream** for CDS: `SAPContext(type="DDLS", action="analyze")` uses AST-based `extractCdsDependencies()` (`src/context/cds-deps.ts`) and returns the CDS's own sources (base tables, joined views, associations, compositions).
- **Downstream** (generic): `SAPNavigate(action="references")` returns a flat `WhereUsedResult[]` from the ADT usage-references endpoint. It drops the tree hierarchy (`parentUri`), the `isResult` / `canHaveChildren` flags, and the `usageInformation` (direct vs. indirect, productive vs. test) — and it does no RAP-aware classification.

FEAT-33 builds the downstream story on top of that existing endpoint. We extend `findWhereUsed` to preserve the full response shape, add a new CDS-specific classifier that buckets consumers into RAP-relevant categories (projection views, BDEFs, service definitions, service bindings, access controls, metadata extensions, ABAP consumers, documentation), and expose it via a new `SAPContext` action `impact`. A RAP skill can then call one tool and get the whole dependency picture — upstream (from AST) plus downstream (from where-used) — in one deterministic response.

Live probes against A4H (`http://a4h.marianzeis.de:50000`, SAP-shipped `I_ABAPPACKAGE` DDLS) confirmed the response shape: `POST /sap/bc/adt/repository/informationsystem/usageReferences?uri=<ddls-uri>` with `Content-Type: application/vnd.sap.adt.repository.usagereferences.request.v1+xml` returns `<usageReferences:referencedObject uri=… parentUri=… isResult=… canHaveChildren=… usageInformation="gradeDirect,includeProductive">` elements nested under `usageReferences:referencedObjects`, each wrapping an `<adtcore:adtObject type="DCLS/DL" name=…>` and `<adtcore:packageRef>`. That's the shape we'll parse.

## Context

### Current State

- `findWhereUsed()` in `src/adt/codeintel.ts:171-214` POSTs to the usage-references endpoint with the correct vendor content type and parses `referencedObject` nodes into a flat `WhereUsedResult[]` with `{ uri, type, name, line, column, packageName, snippet, objectDescription }`. It discards `parentUri`, `isResult`, `canHaveChildren`, and `usageInformation`.
- `SAPNavigate(action="references", type, name)` in `src/handlers/intent.ts:2695-2734` is the only path to downstream references. It calls `findWhereUsed()` with an optional `objectType` filter, falls back to `findReferences()` on 404/405/415/501, and returns raw JSON to the LLM. No classification, no upstream, no RAP framing.
- `SAPContext` in `src/handlers/intent.ts:3039-3161` already has a DDLS branch that fetches the CDS source, extracts upstream deps via `extractCdsDependencies()` + `compressCdsContext()`, and returns a compressed context. There is no `impact` action.
- `WhereUsedResult` loses hierarchy, so a caller can't distinguish "this DDLS consumes me directly" from "this ABAP class consumes a projection view that consumes me" — all are reported at the same level.
- `docs/compare/00-feature-matrix.md` rows 147/157 show "CDS dependencies" and "CDS unit tests" as ❌ for ARC-1. VSP added CDS impact analysis in commit `6c67140` (Apr 4, 2026) — this is the last meaningful CDS gap on the feature matrix. See `docs/compare/vibing-steampunk/evaluations/6c67140-cds-impact.md`.
- `docs/roadmap.md:906-920` lists FEAT-33 as P2/S, "Not started". The "Why not" note says full downstream tracing is out of scope for one call — we are explicitly narrowing that scope to **what RAP cares about** (the stack immediately around the view: projection chain, BDEF, SRVD, SRVB, DCLS, DDLX, plus direct ABAP consumers).

### Target State

1. `findWhereUsed()` returns a richer shape that preserves `parentUri`, `isResult`, `canHaveChildren`, and `usageInformation` as a structured object — without breaking existing SAPNavigate callers.
2. A new `src/adt/cds-impact.ts` module provides `classifyCdsImpact(results)` that buckets consumers into RAP-aware categories and returns summary counts plus per-category lists.
3. `SAPContext` gains an `impact` action for `type=DDLS` that returns both **upstream** (from AST extraction) and **downstream** (from classified where-used) in one JSON response.
4. Unit tests cover the enhanced parser and the classifier. An integration test hits live A4H against `I_ABAPPACKAGE` (SAP-shipped, stable where-used set). An E2E test uses a deterministic three-object persistent fixture chain (one TABL → two DDLS) so assertions are exact counts, not regex heuristics.
5. `docs/tools.md`, `docs/roadmap.md` (FEAT-33 → Done), `docs/compare/00-feature-matrix.md`, `CLAUDE.md` Key Files table, and `.claude/commands/implement-feature.md` all mention the new capability.

### Key Files

| File | Role |
|------|------|
| `src/adt/codeintel.ts` | Existing `findWhereUsed()` at lines 171-214; extend to preserve tree shape; export new enriched result type |
| `src/adt/cds-impact.ts` | **NEW** — classifier that maps where-used results to RAP-aware buckets |
| `src/context/cds-deps.ts` | Existing AST-based upstream CDS dependency extractor — reused for the upstream half of the impact response |
| `src/handlers/intent.ts` | `handleSAPContext` at line 3039 gains an `action === 'impact'` branch that composes upstream + downstream |
| `src/handlers/tools.ts` | `SAPContext` tool schema — add `impact` to the action enum and parameter description |
| `src/handlers/schemas.ts` | Zod schema for `SAPContext` — add `impact` action |
| `tests/unit/adt/codeintel.test.ts` | Existing where-used tests; add cases for the enriched shape |
| `tests/unit/adt/cds-impact.test.ts` | **NEW** — classifier unit tests with fixture XML |
| `tests/unit/handlers/intent.test.ts` | Add `SAPContext action="impact"` handler test |
| `tests/integration/adt.integration.test.ts` | Live integration test against SAP-shipped `I_ABAPPACKAGE` |
| `tests/e2e/cds-impact.e2e.test.ts` | **NEW** — E2E test using the persistent fixture chain |
| `tests/e2e/fixtures.ts` | Extend `PERSISTENT_OBJECTS` with `ZTABL_ARC1_I33`, `ZI_ARC1_I33_ROOT`, `ZI_ARC1_I33_PROJ` |
| `tests/e2e/setup.ts` | Ensure the sync loop can handle TABL+DDLS creation in dependency order |
| `tests/fixtures/abap/ztabl_arc1_i33.tabl.abap` | **NEW** — TABL source (custom table, few fields) |
| `tests/fixtures/abap/zi_arc1_i33_root.ddls.abap` | **NEW** — Root CDS view selecting from `ZTABL_ARC1_I33` |
| `tests/fixtures/abap/zi_arc1_i33_proj.ddls.abap` | **NEW** — Projection CDS view on `ZI_ARC1_I33_ROOT` |
| `tests/fixtures/xml/where-used-cds-impact.xml` | **NEW** — Fixture mimicking A4H response for the classifier unit test |

### Design Principles

1. **Additive shape change.** `WhereUsedResult` stays backward-compatible — new fields (`parentUri`, `isResult`, `canHaveChildren`, `usageInformation`) are added as optional so existing SAPNavigate callers and their tests keep passing.
2. **RAP-aware buckets, not a generic dump.** The classifier returns named buckets (`projectionViews`, `bdefs`, `serviceDefinitions`, `serviceBindings`, `accessControls`, `metadataExtensions`, `abapConsumers`, `tables`, `documentation`, `other`) keyed on the SAP object-type code (`DDLS/DF`, `BDEF/BO`, `SRVD/SD`, `SRVB/SB`, `DCLS/DL`, `DDLX/EX`, `CLAS/OC`, `PROG/P`, `FUGR/FF`, `INTF/OI`, `TABL/DT|DS`, `SKTD/TYP`). Buckets are the contract — new types get appended to `other` rather than changing the shape.
3. **Deterministic E2E.** The E2E test owns its fixtures. Assertions are exact object-name matches (`expect(impact.downstream.projectionViews.map(r => r.name)).toEqual(['ZI_ARC1_I33_PROJ'])`), not counts-against-system-state. No dependency on which SAP-shipped objects exist.
4. **Upstream comes from AST, downstream from ADT.** Reuse the existing `extractCdsDependencies()` path for upstream — don't call where-used twice. Upstream answers "what does this view read"; downstream answers "what reads this view".
5. **Scope endpoint is optional.** A4H live probe confirms the `/usageReferences/scope` sub-path returns "No suitable resource found" for CDS — don't rely on it. The classifier works off the non-scoped response.
6. **`includeIndirect` is off by default.** Default response excludes `usageInformation` entries without `gradeDirect` (i.e., transitive uses through other objects). Caller can pass `includeIndirect=true` to widen the scope. Keeps default payload small for token-efficient LLM use.
7. **Tree flattening is one level deep.** Don't traverse multiple levels of `parentUri` — the RAP stack around a CDS view is shallow (view → {projection | BDEF | DCLS | DDLX | SRVD} → SRVB). `canHaveChildren=true` items are reported with the flag set but not auto-expanded.

## Development Approach

- Write the enriched `findWhereUsed` first; add a new type `WhereUsedResultEnriched` that extends `WhereUsedResult` rather than renaming, so existing tests stay green.
- Build the classifier against a static XML fixture captured from A4H (see Task 5) — no live SAP needed for unit tests.
- Wire the handler last, once the primitives have tests.
- For E2E, add persistent fixtures in dependency order (`ZTABL_ARC1_I33` first, then `ZI_ARC1_I33_ROOT`, then `ZI_ARC1_I33_PROJ`). The existing sync in `tests/e2e/setup.ts` iterates top-down and respects that order for create. Deletion on drift is per-object; if the setup can't recreate due to dependents, the test logs and falls back to deleting dependents first.
- Integration tests must not depend on Z-namespace objects existing — use SAP-shipped `I_ABAPPACKAGE` (confirmed live to return `DCLS/DL` and `SKTD/TYP` consumers).
- Every task that changes code includes tests in the same task, per the ralphex test policy.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`

### Task 1: Enrich findWhereUsed result shape

**Files:**
- Modify: `src/adt/codeintel.ts`
- Modify: `tests/unit/adt/codeintel.test.ts`

The existing `findWhereUsed()` (`src/adt/codeintel.ts:171-214`) parses `referencedObject` nodes but drops tree + usage metadata. Keep the existing `WhereUsedResult` interface backward-compatible, but add optional fields so callers can build the impact classifier.

- [ ] In `src/adt/codeintel.ts`, extend `WhereUsedResult` with optional fields: `parentUri?: string`, `isResult?: boolean`, `canHaveChildren?: boolean`, `usageInformation?: { direct: boolean; productive: boolean; raw: string }`
- [ ] Update `findWhereUsed()` to populate the new fields from the XML: `ref['@_parentUri']`, `ref['@_isResult']` (parse "true"/"false"), `ref['@_canHaveChildren']`, and `ref['@_usageInformation']` (a comma-separated token list — set `direct` = token list includes `gradeDirect`, `productive` = includes `includeProductive`, `raw` = the original string)
- [ ] The existing fields (`uri`, `type`, `name`, `line`, `column`, `packageName`, `snippet`, `objectDescription`) keep their current population — no regressions
- [ ] Handle missing attributes defensively (treat absent `@_isResult` as `undefined`, not `false`, so consumers can distinguish "not provided" from "explicitly false")
- [ ] Add unit tests (~4 tests) in `tests/unit/adt/codeintel.test.ts`: (a) parses `parentUri` from the fixture, (b) parses `isResult=true` and `isResult=false` correctly, (c) parses `usageInformation="gradeDirect,includeProductive"` into `{ direct: true, productive: true }`, (d) existing `findWhereUsed()` test still passes unchanged (backward compatibility)
- [ ] Run `npm test` — all tests must pass
- [ ] Run `npm run typecheck` — no errors

### Task 2: Capture A4H where-used XML fixture

**Files:**
- Create: `tests/fixtures/xml/where-used-cds-impact.xml`

The classifier (Task 3) and its unit tests need a realistic multi-type where-used response. Rather than synthesize XML, capture one from the live A4H system against a CDS entity that has a mix of RAP-relevant consumers. This task is small (no code change) but belongs here so the classifier can be test-driven.

- [ ] Source the credentials from `.env.infrastructure` (listed as `SAP_DEVELOPER_USER` / `SAP_DEVELOPER_PASSWORD` against `http://a4h.marianzeis.de:50000`, client `001`). If `.env.infrastructure` is not accessible in the CI environment, the user will provide credentials out-of-band.
- [ ] Fetch a CSRF token: `curl -I -u "$USER:$PASSWORD" -H "X-CSRF-Token: Fetch" "http://a4h.marianzeis.de:50000/sap/bc/adt/repository/informationsystem/usageReferences?uri=/sap/bc/adt/ddic/ddl/sources/i_abappackage&sap-client=001"`
- [ ] POST with the vendor content-type and save the body to `tests/fixtures/xml/where-used-cds-impact.xml`. Request body: the minimal `<usageReferenceRequest><affectedObjects/></usageReferenceRequest>` shape (the endpoint accepts the URI via the `?uri=` query param)
- [ ] Confirm the saved fixture contains at least one `DCLS/DL` entry (access control) and one `SKTD/TYP` entry (documentation) — both are present on A4H for `I_ABAPPACKAGE`
- [ ] If live capture fails, fall back to a hand-synthesized fixture modeled on the shape documented at the top of this plan. Note that choice in the fixture file header comment.
- [ ] No test run needed in this task — the fixture is consumed in Task 3 tests

### Task 3: Add CDS impact classifier

**Files:**
- Create: `src/adt/cds-impact.ts`
- Create: `tests/unit/adt/cds-impact.test.ts`

A new module takes the enriched `WhereUsedResult[]` from Task 1 and groups entries into RAP-aware buckets. No SAP HTTP calls here — pure data transformation.

- [ ] Create `src/adt/cds-impact.ts` exporting:
  - Interface `CdsImpactDownstream` with fields: `projectionViews: WhereUsedResult[]` (DDLS/DF), `bdefs: WhereUsedResult[]` (BDEF/BO), `serviceDefinitions: WhereUsedResult[]` (SRVD/SD), `serviceBindings: WhereUsedResult[]` (SRVB/SB), `accessControls: WhereUsedResult[]` (DCLS/DL), `metadataExtensions: WhereUsedResult[]` (DDLX/EX), `abapConsumers: WhereUsedResult[]` (CLAS/* + INTF/* + PROG/P + FUGR/FF + FUGR/F), `tables: WhereUsedResult[]` (TABL/*), `documentation: WhereUsedResult[]` (SKTD/*), `other: WhereUsedResult[]`, `summary: { total: number; direct: number; indirect: number; byBucket: Record<string, number> }`
  - Function `classifyCdsImpact(results: WhereUsedResult[], options?: { includeIndirect?: boolean }): CdsImpactDownstream`
- [ ] Classification rules: split `r.type` on `/` → first segment (`DDLS`, `BDEF`, etc.) drives bucket. Respect `isResult === false` + `canHaveChildren === true` entries as "package group nodes" — these are filtered out of all buckets (they carry no useful impact info, see the A4H probe)
- [ ] Default behavior: `includeIndirect=false` → drop any entry where `usageInformation?.direct === false`. Entries with `usageInformation === undefined` are treated as direct (conservative default for older SAP systems that don't populate the attribute)
- [ ] `summary.byBucket` lists bucket name → entry count; `summary.direct`/`summary.indirect` count by `usageInformation.direct` (undefined → direct)
- [ ] Add unit tests (~8 tests) in `tests/unit/adt/cds-impact.test.ts`:
  - Load `tests/fixtures/xml/where-used-cds-impact.xml`, parse via `findDeepNodes()` + manual mapping into `WhereUsedResult[]`, run classifier
  - Assert `accessControls` contains `I_ABAPPACKAGE` (type `DCLS/DL`)
  - Assert `documentation` contains `I_ABAPPACKAGE` (type `SKTD/TYP`)
  - Assert package-group entries (`DEVC/K` with `isResult=false`) are NOT classified into any bucket
  - Assert synthetic input with `BDEF/BO`, `SRVD/SD`, `SRVB/SB`, `DDLS/DF` lands in the right buckets
  - Assert `includeIndirect=false` (default) drops `direct=false` entries
  - Assert `includeIndirect=true` keeps them
  - Assert unknown types (`ZZZ/XX`) fall into `other`
  - Assert `summary.total` equals included count (respecting the filter)
- [ ] Run `npm test` — all tests must pass
- [ ] Run `npm run lint` — no errors

### Task 4: Wire SAPContext action="impact" in the handler

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

Expose the new capability through `SAPContext`. For `type="DDLS"`, action `impact` returns `{ upstream, downstream, summary }` by combining the existing AST extractor with the new classifier.

- [ ] In `src/handlers/intent.ts` `handleSAPContext()` (line 3039+), add a new branch early in the function: `if (action === 'impact') { … }`. Require `type="DDLS"` + `name`. Return an error for other types with a message pointing at `SAPNavigate(action="references")` for non-CDS objects.
- [ ] Inside the branch: fetch DDLS source via `client.getDdls(name)` (cache-aware via `cachedGet` helper already in the function), run `extractCdsDependencies(source)` for upstream, build the DDLS URI with `objectUrlForType('DDLS', name)`, call `findWhereUsed(client.http, client.safety, uri)` for downstream results, then `classifyCdsImpact(results, { includeIndirect: args.includeIndirect === true })`.
- [ ] Return JSON shape: `{ name, type: "DDLS", upstream: { tables: [...], views: [...], associations: [...], compositions: [...] }, downstream: CdsImpactDownstream, summary: { upstreamCount, downstreamTotal, downstreamDirect } }`
- [ ] Use `textResult(JSON.stringify(result, null, 2))` so LLMs get formatted JSON
- [ ] On `AdtApiError` from `findWhereUsed` (404/405/415/501), gracefully degrade: return `{ ..., downstream: { …empty buckets…, summary: { total: 0, ... } }, warnings: ["Where-used endpoint not available on this system"] }` — matches the fallback philosophy in the existing `references` action
- [ ] In `src/handlers/schemas.ts`: extend the `SAPContext` Zod action enum to include `'impact'` and add optional `includeIndirect: z.boolean().optional()`
- [ ] In `src/handlers/tools.ts`: add `'impact'` to the `action` enum in the `SAPContext` tool definition and update the action description to include "impact — for DDLS only: returns upstream AST dependencies + downstream RAP-classified consumers (projection views, BDEFs, SRVDs, SRVBs, DCLS, DDLX, ABAP consumers)"
- [ ] Add unit tests (~4 tests) in `tests/unit/handlers/intent.test.ts`:
  - Happy path: `SAPContext(action="impact", type="DDLS", name="Z_MY_VIEW")` returns expected upstream + downstream structure (mock `client.getDdls` + `http.post` for where-used with a fixture)
  - Type guard: `SAPContext(action="impact", type="CLAS", name="X")` returns error mentioning `SAPNavigate`
  - Schema validation: `SAPContext(action="impact")` without `name` fails with LLM-friendly Zod error
  - Fallback: mock `http.post` to throw `AdtApiError(404)` → response contains `warnings` array + empty `downstream`
- [ ] Run `npm test` — all tests must pass
- [ ] Run `npm run typecheck` — no errors

### Task 5: Add integration test against live SAP

**Files:**
- Modify: `tests/integration/adt.integration.test.ts`

Validates the full stack (HTTP → parser → classifier → handler composition) against a real SAP system. Uses SAP-shipped objects so it's deterministic without relying on our own fixtures.

- [ ] Add a new `describe('CDS impact analysis', () => { … })` block guarded by `requireSapCredentials()`
- [ ] Test 1: `client` SAPContext-equivalent call — in integration tests we call the ADT client methods directly rather than the handler, but here we need to exercise the full classify path. Import `findWhereUsed` from `src/adt/codeintel.ts` and `classifyCdsImpact` from `src/adt/cds-impact.ts`. Call `findWhereUsed(client.http, client.safety, '/sap/bc/adt/ddic/ddl/sources/i_abappackage')`, then run the classifier.
- [ ] Assert: `downstream.accessControls.length >= 1` and contains an entry with `name === 'I_ABAPPACKAGE'` and `type === 'DCLS/DL'` (confirmed live). This is the stable signal.
- [ ] Assert: `summary.total >= 2` — `I_ABAPPACKAGE` has at least DCLS + SKTD on every vanilla S/4 system (verified on A4H)
- [ ] Wrap the assertions in `try` with an `expectSapFailureClass(err, [403, 404, 500], [/not found/i, /forbidden/i])` fallback + `requireOrSkip(ctx, undefined, SkipReason.BACKEND_UNSUPPORTED)` so systems without the endpoint skip cleanly
- [ ] Test 2: Probe `includeIndirect` — call classifier twice (default vs. `includeIndirect=true`). Assert that `includeIndirect=true` returns `>=` the total of the default. Skip gracefully if the default returns 0 (indicates the system doesn't populate `usageInformation`).
- [ ] Run `npm run test:integration` locally against A4H — both tests pass
- [ ] Run `npm test` to confirm unit tests still pass

### Task 6: Add persistent CDS fixture chain

**Files:**
- Modify: `tests/e2e/fixtures.ts`
- Modify: `tests/e2e/setup.ts`
- Create: `tests/fixtures/abap/ztabl_arc1_i33.tabl.abap`
- Create: `tests/fixtures/abap/zi_arc1_i33_root.ddls.abap`
- Create: `tests/fixtures/abap/zi_arc1_i33_proj.ddls.abap`

The E2E test for FEAT-33 needs a deterministic object chain. Adding it as persistent fixtures (synced once, reused across runs) avoids the multi-minute TABL+CDS activation cost on every run.

- [ ] Create `tests/fixtures/abap/ztabl_arc1_i33.tabl.abap` — a simple custom table with delivery class `A`, 3-4 fields (`MANDT`, `ID`, `DESCRIPTION`, `CREATED_AT`), following the existing TABL create payload shape in `src/adt/ddic-xml.ts`. The file content is whatever format the TABL create path accepts for the `source` parameter (see `feat-44-tabl-create.md` in `docs/plans/completed/` for the format)
- [ ] Create `tests/fixtures/abap/zi_arc1_i33_root.ddls.abap` — CDS DDL source:
  ```
  @AbapCatalog.sqlViewName: 'ZIARC1I33R'
  @AbapCatalog.compiler.docs/compareFilter: true
  @AccessControl.authorizationCheck: #NOT_REQUIRED
  @EndUserText.label: 'ARC-1 FEAT-33 root view'
  define view entity ZI_ARC1_I33_ROOT as select from ztabl_arc1_i33 {
    key id,
    description,
    created_at
  }
  ```
- [ ] Create `tests/fixtures/abap/zi_arc1_i33_proj.ddls.abap` — CDS projection view on the root:
  ```
  @EndUserText.label: 'ARC-1 FEAT-33 projection'
  @AccessControl.authorizationCheck: #NOT_REQUIRED
  define view entity ZI_ARC1_I33_PROJ as projection on ZI_ARC1_I33_ROOT {
    id,
    description
  }
  ```
- [ ] In `tests/e2e/fixtures.ts`, append three entries to `PERSISTENT_OBJECTS` (order matters — TABL first, root DDLS second, projection DDLS third):
  - `{ name: 'ZTABL_ARC1_I33', type: 'TABL', fixture: 'ztabl_arc1_i33.tabl.abap', searchQuery: 'ZTABL_ARC1_I33' }`
  - `{ name: 'ZI_ARC1_I33_ROOT', type: 'DDLS', fixture: 'zi_arc1_i33_root.ddls.abap', searchQuery: 'ZI_ARC1_I33_ROOT' }`
  - `{ name: 'ZI_ARC1_I33_PROJ', type: 'DDLS', fixture: 'zi_arc1_i33_proj.ddls.abap', searchQuery: 'ZI_ARC1_I33_PROJ' }`
- [ ] Verify `tests/e2e/setup.ts` `syncPersistentFixtures()` iterates `PERSISTENT_OBJECTS` in declaration order (it does — confirmed at `tests/e2e/setup.ts:38`). Creation in the declared order respects the dependency chain.
- [ ] If the sync detects source drift on `ZTABL_ARC1_I33`, deletion will fail because the DDLS views depend on it. In `deleteObjectTypes()` (`tests/e2e/setup.ts:132`), catch "still in use" / "dependent objects" errors and skip with a warning (mark as `// best-effort-cleanup`). Drift on the TABL will be surfaced as a test warning, not a sync failure — worst case the DDLS views stay on the system until the TABL is manually dropped.
- [ ] Run `npm run test:e2e:fixtures` — the three new objects are created on A4H (one-time sync cost ~2-3 min for CDS activation)
- [ ] Confirm via `SAPSearch` on the running MCP server that all three objects exist

### Task 7: Add E2E test for CDS impact

**Files:**
- Create: `tests/e2e/cds-impact.e2e.test.ts`

End-to-end assertion that the full MCP stack — server, intent routing, classifier, handler composition — returns the expected downstream chain for our owned fixtures.

- [ ] Model on `tests/e2e/rap-write.e2e.test.ts` structure: `beforeAll` calls `connectClient()`, `afterAll` closes it; single `describe` block with 2-3 tests
- [ ] Probe `rap.available` via `SAPManage(action="probe")` — if `rap.available === false`, skip with `requireOrSkip(ctx, rapAvailable, SkipReason.BACKEND_UNSUPPORTED)` (CDS impact itself doesn't require RAP, but the projection-view pattern does)
- [ ] Test 1: `SAPContext(action="impact", type="DDLS", name="ZI_ARC1_I33_ROOT")` — assert `result.downstream.projectionViews.map(r => r.name)` contains `'ZI_ARC1_I33_PROJ'`. Assert `result.upstream.tables.map(t => t.name)` contains `'ZTABL_ARC1_I33'` (uppercase — `extractCdsDependencies` normalizes case). Both are exact-match deterministic because we own the objects.
- [ ] Test 2: `SAPContext(action="impact", type="DDLS", name="ZI_ARC1_I33_PROJ")` — assert `result.upstream.views.map(v => v.name)` contains `'ZI_ARC1_I33_ROOT'`. Assert `result.downstream.summary.total` is `0` (no consumers of the leaf). This confirms the classifier handles empty downstream cleanly.
- [ ] Test 3: Type guard — `SAPContext(action="impact", type="CLAS", name="ZCL_ARC1_TEST")` — assert `expectToolError(result, /SAPNavigate|DDLS only/i)`
- [ ] Each test uses `expectToolSuccess(result)` → parse JSON → assert; no transient cleanup needed (persistent fixtures)
- [ ] Run `npm run test:e2e` (with the MCP server running) — all three tests pass
- [ ] Verify the test is listed in any E2E runner configs (`tests/e2e/vitest.e2e.config.ts` auto-picks up `*.e2e.test.ts` — no config change needed)

### Task 8: Documentation, roadmap, feature matrix, skills

**Files:**
- Modify: `docs/tools.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `CLAUDE.md`
- Modify: `.claude/commands/implement-feature.md`

Every artifact that mentions SAPContext, CDS, or where-used must reflect the new capability. Skip the user-facing `README.md` and `docs/index.md` unless the current list of capabilities highlights CDS explicitly — check during the task.

- [ ] `docs/tools.md`: In the `SAPContext` section, add a row/paragraph documenting the `impact` action — parameters (`type=DDLS`, `name`, optional `includeIndirect`), example request, example response (truncated JSON shape showing upstream + downstream buckets)
- [ ] `docs/roadmap.md:906-920`: Change FEAT-33 status from "Not started" to "Done (commit $SHA)". Update the "Why not" paragraph — it's no longer accurate, rewrite as a "Scope" note: "Scoped to the RAP stack immediately around a CDS view (projection chain, BDEF, SRVD, SRVB, DCLS, DDLX, direct ABAP consumers). Multi-level transitive tracing is intentionally out of scope — callers can follow up with SAPNavigate(references) on individual consumers." Also mark the row at line 64 Done, and update the deprecation ticks in lines 209 and 226.
- [ ] `docs/compare/00-feature-matrix.md`: Update the "CDS dependencies" row (line 147) from ❌ to ✅ for ARC-1. Update the "Last Updated" line at the top of the file to today's date.
- [ ] `CLAUDE.md` Key Files for Common Tasks table: Add a row: `| Add CDS impact classifier / extend downstream grouping | src/adt/cds-impact.ts, src/adt/codeintel.ts (findWhereUsed), tests/unit/adt/cds-impact.test.ts |`. Also add `src/adt/cds-impact.ts` to the codebase structure tree under the `adt/` section.
- [ ] `.claude/commands/implement-feature.md`: If the skill mentions "understand downstream impact before changing a CDS view" or similar, update it to reference `SAPContext(action="impact")`. Read the skill first to decide if an edit is warranted — if not, add a one-line tip in the existing "Before modifying a CDS view" / "Before refactoring" section (grep for those phrases).
- [ ] Skim `README.md` and `docs/index.md` — if either lists SAPContext actions explicitly, append `impact` to the list. If not, skip.
- [ ] Run `npm run lint` + `npm test` — all pass

### Task 9: Final verification

- [ ] Run `npm test` — all unit tests pass
- [ ] Run `npm run typecheck` — no errors
- [ ] Run `npm run lint` — no errors
- [ ] Run `npm run build` — clean build
- [ ] Run `npm run test:integration` (with `.env.infrastructure` loaded) — the new integration tests pass against A4H
- [ ] Run `npm run test:e2e:full` — the new E2E test passes end-to-end against a running MCP server
- [ ] Manual smoke via an MCP client: `SAPContext(action="impact", type="DDLS", name="I_ABAPPACKAGE")` returns a well-formed response with populated `accessControls` and `documentation` buckets
- [ ] Verify `docs/roadmap.md` FEAT-33 status reads "Done"
- [ ] Verify `docs/compare/00-feature-matrix.md` "CDS dependencies" row shows ✅ for ARC-1 and the date is today
- [ ] Verify `CLAUDE.md` Key Files table includes the new classifier row
- [ ] Move this plan file from `docs/plans/` to `docs/plans/completed/`
