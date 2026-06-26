# Fix DEVC Listing Descriptions Misalignment

## Overview

`SAPRead(type="DEVC", name="<package>")` calls `getPackageContents()` which in turn POSTs to ADT's `repository/nodestructure?withShortDescriptions=true`. On real systems this endpoint returns object descriptions that are **misaligned with their `OBJECT_NAME`** in the XML response itself — for example, the `ZDEMO_MIG_RAP` sub-package's description ("Demo: RAP migration outputs from migrate-segw-to-rap skill") is attributed to a contained `CLAS/OC` node, while `ZCL_*_DPC_EXT` shows `"Data Provider Base Class"` (which is `_DPC`'s description). Names and URIs are correct; only descriptions are stale/shifted.

This is a server-side data-quality issue with the `nodestructure` endpoint, not a parser bug — the captured raw XML at `/sap/bc/adt/repository/nodestructure?parent_type=DEVC/K&parent_name=ZDEMO_MIG&withShortDescriptions=true` contains the misaligned values inside the `<DESCRIPTION>` child elements. Setting `withShortDescriptions=false` returns no descriptions at all (every `<DESCRIPTION/>` empty).

The fix: switch `getPackageContents()` from `nodestructure` to the **`informationsystem/search?packageName=<pkg>`** endpoint, which returns the same set of objects with **correctly-aligned descriptions** in `adtcore:objectReferences` format that ARC-1 already parses (`parseSearchResults` at `src/adt/xml-parser.ts:118-128`). Verified on the live `a4h.marianzeis.de` test system: every captured key (`ZDEMO_MIG_RAP`, `ZCL_*_DPC`, `ZDM_PROJECT`, `ZDM_SEED_DATA`) returns its real description from the search endpoint. The change is low-risk because the search endpoint is already used by `searchObject()` (line 569-575) and the XML format/parser are mature.

## Context

### Current State

- `src/adt/client.ts:594-605` `getPackageContents(packageName)`:
  - POSTs `/sap/bc/adt/repository/nodestructure?parent_type=DEVC/K&parent_name=<pkg>&withShortDescriptions=true`
  - Calls `parsePackageContents(resp.body)` from `src/adt/xml-parser.ts:142-158`
  - Returns `Array<{ type: string; name: string; description: string; uri: string }>`
- `src/adt/xml-parser.ts:142-158` `parsePackageContents()`:
  - Reads `<SEU_ADT_REPOSITORY_OBJ_NODE>` children of `TREE_CONTENT`
  - Maps `OBJECT_TYPE`, `OBJECT_NAME`, `DESCRIPTION`, `OBJECT_URI` from each node
  - Faithfully emits whatever SAP returns — including the broken descriptions
- `src/handlers/intent.ts:1740` `case 'DEVC':` calls `client.getPackageContents(name)` — no other params
- `src/adt/client.ts:569-575` `searchObject(query, maxResults)` already exists and uses the same `informationsystem/search` endpoint successfully — proven path
- `src/adt/xml-parser.ts:118-128` `parseSearchResults()` already exists and returns `{ objectType, objectName, description, packageName, uri }` — needs only a field-rename map to fit DEVC contract
- Existing fixture: `tests/fixtures/xml/package-contents.xml` (28 lines, uses idealised `nodestructure` format with descriptions in the right places)
- Existing parser test: `tests/unit/adt/xml-parser.test.ts:315-330` — only asserts `length > 0`, doesn't check description alignment
- No integration test exercises `getPackageContents()` against a live SAP system today

Reproducer (live SAP test system `a4h.marianzeis.de`, package `ZDEMO_MIG`, after the SEGW→RAP migration baseline was set up):
```
SAPRead(type="DEVC", name="ZDEMO_MIG")
  → ZDEMO_MIG_RAP (sub-package): description=""                                       (should be "Demo: RAP migration outputs…")
  → ZCL_ZDEMO_MIG_PROJECTS_DPC: description="Demo: RAP migration outputs from…"       (should be "Data Provider Base Class")
  → ZCL_ZDEMO_MIG_PROJECTS_MPC_EXT: description="ZCL_ZDEMO_MIG_PROJECTS_MPC"          (off — that's another object's name)
  → ZDM_SEED_DATA: description="ZCL_ZDEMO_MIG_PROJECTS_MPC_EXT"                       (off — same pattern)
```

### Target State

- `getPackageContents()` GETs `/sap/bc/adt/repository/informationsystem/search?operation=quickSearch&query=*&packageName=<pkg>&maxResults=<n>` instead of POSTing nodestructure
- Returns the same shape `{ type, name, description, uri }[]` — backward-compatible API
- Descriptions are reliably aligned with names — verified by integration test against live SAP
- `parsePackageContents()` (the old parser) stays in place for backwards compatibility but is no longer the production path; its existing tests continue to pass
- `SAPRead(type="DEVC", ...)` accepts an optional `maxResults` parameter (default 200, max 1000) so very large packages don't silently truncate at the search endpoint's default
- Documented behavior: descriptions for `IWSV` (legacy SEGW service version objects) may be missing — the search endpoint returns `IWMO`/`IWPR` instead. Most consumers don't care; SEGW-aware tools that need `IWSV` should use `SAPSearch` directly. This is documented inline in the client method.
- Captured the live SAP response as a new fixture `tests/fixtures/xml/package-contents-search.xml` so the test asserts the alignment fix using a real-world response, not a hand-crafted one.

### Key Files

| File | Role |
|------|------|
| `src/adt/client.ts` | ADT client — `getPackageContents()` at line 594-605 (the function to change) and `searchObject()` at line 569-575 (the proven pattern to follow) |
| `src/adt/xml-parser.ts` | XML parsing — `parseSearchResults()` at line 118-128 (reuse) and `parsePackageContents()` at line 142-158 (keep, no longer used by client) |
| `src/handlers/intent.ts` | Tool dispatch — `case 'DEVC':` at line 1740 (extend with `maxResults` argument) |
| `src/handlers/schemas.ts` | Zod schema — `SAPReadSchema` (add optional `maxResults` field) |
| `src/handlers/tools.ts` | Tool definition — SAPRead JSON schema (document the new `maxResults` for DEVC) |
| `tests/unit/adt/client.test.ts` | Client unit tests — add coverage for new search-based `getPackageContents()` |
| `tests/unit/adt/xml-parser.test.ts` | Parser unit tests — add fixture-based alignment assertion |
| `tests/fixtures/xml/package-contents-search.xml` | NEW fixture — captured ZDEMO_MIG search response, asserts real-world description alignment |
| `tests/integration/adt.integration.test.ts` | Integration test — add live `getPackageContents()` smoke check that descriptions are non-empty for known objects |
| `CLAUDE.md` | Update Key Files table row about DEVC reading + a one-line note in Code Patterns about the search-based approach |
| `docs/tools.md` | Note in SAPRead section that DEVC descriptions come from the search endpoint and are reliable |

### Design Principles

1. **Reuse the proven path** — `searchObject()` already uses the same endpoint with the same XML parser. Reuse `parseSearchResults()` instead of inventing a new parser; just rename fields at the boundary.
2. **Preserve the public API contract** — `Array<{ type, name, description, uri }>` stays the same so no MCP client breaks.
3. **GET instead of POST** — the new endpoint is a safe GET, removing the CSRF token requirement and one round-trip on first use. Net positive.
4. **Make `maxResults` opt-in, default 200** — packages with thousands of objects need pagination; default protects against silent truncation while keeping defaults sensible. Clamp 1..1000.
5. **Keep `parsePackageContents()` exported** — it's exported and might be used by external callers; removing it would be a breaking change for no benefit. Mark as deprecated in a JSDoc comment.
6. **Test with a real captured XML** — the new unit test uses a fixture captured from the live `ZDEMO_MIG` package on the test system, not a hand-crafted XML. This catches future regressions if SAP changes the response shape.
7. **Document the IWSV trade-off inline** — the search endpoint returns slightly different object types than nodestructure (e.g., `IWSV` legacy SEGW service objects don't appear; `IWMO` does). Document this in the function JSDoc so future readers understand the trade-off.

## Development Approach

- Tasks ordered: client method first (uses existing parser), then schema/handler wiring for `maxResults`, then fixture + tests, then integration test, then docs.
- Every code-changing task has unit-test checkboxes using the project's `vi.mock('undici')` + `mockResponse()` pattern.
- Integration test added because the change touches a SAP endpoint round-trip.
- No E2E test added — `SAPRead(type=DEVC)` is an existing tool operation, not a new one; unit + integration coverage is sufficient.
- The old parser `parsePackageContents()` and its existing fixture `package-contents.xml` stay in place (deprecated but tested) so that if any external consumer still calls it, the behavior is unchanged.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Switch `getPackageContents()` to the search endpoint

**Files:**
- Modify: `src/adt/client.ts`
- Modify: `tests/unit/adt/client.test.ts`

The current `getPackageContents()` POSTs to `/sap/bc/adt/repository/nodestructure` which returns descriptions misaligned with object names (verified server-side bug). Switch to a GET on `/sap/bc/adt/repository/informationsystem/search?packageName=<pkg>` which returns the same set of objects with correctly-aligned descriptions in `adtcore:objectReferences` format. The existing `parseSearchResults()` parser already handles the response shape — just map field names at the boundary. Add an optional `maxResults` parameter (default 200, max 1000).

- [ ] Modify `getPackageContents()` at `src/adt/client.ts:594-605`. Change the signature to `async getPackageContents(packageName: string, maxResults = 200): Promise<Array<{ type: string; name: string; description: string; uri: string }>>`. Replace the body to: (1) call `checkOperation(this.safety, OperationType.Read, 'GetPackage')` (unchanged), (2) clamp maxResults: `const limit = Math.max(1, Math.min(maxResults, 1000));`, (3) GET `/sap/bc/adt/repository/informationsystem/search?operation=quickSearch&query=*&packageName=${encodeURIComponent(packageName)}&maxResults=${limit}` with `Accept: application/xml`, (4) parse with `parseSearchResults(resp.body)`, (5) map each result `{ objectType, objectName, description, uri }` → `{ type: objectType, name: objectName, description, uri }`. Remove the `await this.http.post(...)` call. Drop the `parsePackageContents` import line if it's no longer used by this method.
- [ ] Add a JSDoc comment to `getPackageContents()` explaining: "Uses the ADT search endpoint instead of nodestructure because nodestructure returns descriptions misaligned with names on real systems (server-side data-quality issue). The search endpoint returns slightly different object coverage — e.g. legacy SEGW IWSV objects may not appear; if you need them, use `searchObject()` directly. See `docs/plans/completed/2026-05-09-fix-devc-listing-descriptions.md` for the full investigation."
- [ ] Add unit tests (~6 tests) to `tests/unit/adt/client.test.ts`. Mock `mockFetch` to return a hand-crafted small `objectReferences` XML payload. Verify: (1) hits the correct GET URL with `query=*` and `packageName=<encoded>`, (2) returns objects with correct field-name mapping (`objectType` → `type`, etc.), (3) descriptions in the response are preserved verbatim, (4) honours the `maxResults` parameter, (5) clamps `maxResults` above 1000 and below 1, (6) safety check still blocks when read is denied. Follow the patterns at the top of `tests/unit/adt/client.test.ts` for the mock setup.
- [ ] Run `npm test` — all tests must pass

### Task 2: Add real captured fixture + parser-level alignment test

**Files:**
- Create: `tests/fixtures/xml/package-contents-search.xml`
- Modify: `tests/unit/adt/xml-parser.test.ts`

The existing test for `parsePackageContents` (line 315-330) only asserts `length > 0`. Add a new test that uses a fixture **captured from the live test system** to assert that descriptions are correctly aligned with object names — this is the regression test for the bug we're fixing.

- [ ] Create `tests/fixtures/xml/package-contents-search.xml` with the captured response from `GET /sap/bc/adt/repository/informationsystem/search?operation=quickSearch&query=*&packageName=ZDEMO_MIG&maxResults=50` on `a4h.marianzeis.de`. The XML root is `<adtcore:objectReferences>` containing `<adtcore:objectReference>` elements with `adtcore:type`, `adtcore:name`, `adtcore:description`, `adtcore:uri`, `adtcore:packageName` attributes. Include at least these four reference rows so the alignment assertions have material to bite on: `ZDEMO_MIG_RAP` (DEVC/K, description "Demo: RAP migration outputs from migrate-segw-to-rap skill"), `ZCL_ZDEMO_MIG_PROJECTS_DPC` (CLAS/OC, description "Data Provider Base Class"), `ZDM_PROJECT` (TABL/DT, description "Demo: Project (legacy SEGW era)"), `ZDM_SEED_DATA` (PROG/P, description "Seed data for SEGW->RAP demo"). The reference XML to copy from is at `/tmp/devc-fixture-capture/package-contents-search.xml` (4012 bytes, captured from the live system) — if not still on disk, recapture from the live system or hand-craft using the four rows above.
- [ ] Add a unit test in `tests/unit/adt/xml-parser.test.ts` under a new `describe('parseSearchResults — package contents alignment regression', ...)` block: load the fixture via `loadFixture('package-contents-search.xml')`, call `parseSearchResults(xml)`, then for each of the four expected rows assert that `result.find(r => r.objectName === 'X').description === '<expected>'`. This is the regression test that proves the misalignment bug was fixed.
- [ ] Add unit tests (~3 more) covering: empty fixture (no `<adtcore:objectReference>` children) → empty array; single-object fixture; objects with empty `description` attribute → empty string in output (no `undefined`).
- [ ] Run `npm test` — all tests must pass

### Task 3: Add `maxResults` parameter to SAPRead schema and handler

**Files:**
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/schemas.test.ts`

Currently `SAPRead(type="DEVC", name="<pkg>")` doesn't accept `maxResults`. With the search-endpoint switch in Task 1, packages with hundreds of objects can hit the default-200 cap. Add an optional parameter so callers can request more.

- [ ] In `src/handlers/schemas.ts`, find `SAPReadSchema` and add an optional field: `maxResults: z.number().int().min(1).max(1000).optional()`. Place it logically next to other size-related options. The schema should accept the field on any SAPRead invocation but only DEVC actually uses it.
- [ ] In `src/handlers/tools.ts`, update the SAPRead JSON schema's `properties` to include `maxResults` with description: `"For type=DEVC: maximum number of objects to return from the package listing (default 200, max 1000)."`. Don't add it to the `required` array.
- [ ] In `src/handlers/intent.ts`, find `case 'DEVC':` (currently at ~line 1740) and pass the new `maxResults` argument: `const contents = await client.getPackageContents(name, args.maxResults);`.
- [ ] Add unit tests (~3 tests) in `tests/unit/handlers/schemas.test.ts`: SAPRead accepts optional maxResults; rejects out-of-range values (0, 1001, negative); ignores maxResults when type is not DEVC (no error, just unused).
- [ ] Add a unit test in `tests/unit/handlers/intent.test.ts` (~2 tests) that verifies `case 'DEVC':` forwards `maxResults` to the client method using `vi.spyOn(client, 'getPackageContents')`.
- [ ] Run `npm test` — all tests must pass

### Task 4: Add integration test against live SAP system

**Files:**
- Modify: `tests/integration/adt.integration.test.ts`

The change touches a SAP endpoint round-trip and the bug only manifests against real systems — add a live integration test that proves the fix works end-to-end. The test system is `a4h.marianzeis.de` (see `INFRASTRUCTURE.md` for credentials pattern).

- [ ] Add a new `describe('getPackageContents (search-endpoint based)', ...)` block in `tests/integration/adt.integration.test.ts`. Use `getTestClient()` from `tests/integration/helpers.ts`. Run the test against package `ZDEMO_MIG` (a known package on the test system that contains `ZDM_PROJECT`, `ZDM_TASK`, `ZDM_TIMEENTRY`, plus SEGW-generated classes). Assert: (1) the result contains entries with non-empty `description` (specifically: a `TABL/DT` entry named `ZDM_PROJECT` with description `'Demo: Project (legacy SEGW era)'`); (2) the description for each known object matches the expected value (no misalignment); (3) the result is non-empty for an existing package; (4) for a non-existent package name, the result is an empty array (graceful handling). Use `requireOrSkip(ctx, packageName, 'package fixture')` to skip if the test system is unavailable. Mark the test as **`expectsZdemoMigPackage`** in a comment so future fixture-cleanup work knows it depends on this package.
- [ ] If `ZDEMO_MIG` doesn't exist on the test system, the test must skip cleanly via `SkipReason.NO_FIXTURE` from `tests/helpers/skip-policy.ts` — never silently pass. Tag the skip with the message `'ZDEMO_MIG package not on test system — see demo workspace setup'`.
- [ ] Run `npm run test:integration` (requires `TEST_SAP_URL`, `TEST_SAP_USER`, `TEST_SAP_PASSWORD` env). All tests must pass against the live system.

### Task 5: Update CLAUDE.md and `docs/tools.md`

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/tools.md`

The behavior of `SAPRead(type=DEVC)` changes (more reliable descriptions, slightly different object coverage, new `maxResults` param). Document so future autonomous-agent runs and human readers understand.

- [ ] In `CLAUDE.md`, find the "Key Files for Common Tasks" table row for "Add new read operation" or "Modify ADT service discovery". Either update an existing row or add: `Modify package listing (DEVC) | src/adt/client.ts (getPackageContents — uses search endpoint, NOT nodestructure, since nodestructure returns misaligned descriptions on real systems), src/adt/xml-parser.ts (parseSearchResults reused). Add maxResults param at handler/schema level.`
- [ ] In `CLAUDE.md`, find the "Code Patterns" section. Add a new sub-section after "ADT Client Method" titled "Package listing (DEVC)" with a one-paragraph note: nodestructure is unreliable for descriptions; we use the search endpoint; the trade-off is slightly different object coverage (legacy IWSV objects are absent — use SAPSearch for those).
- [ ] In `docs/tools.md`, find the SAPRead section's `type` parameter documentation. Update the `DEVC` row to note: descriptions are reliable (sourced from `informationsystem/search` not `nodestructure`); accepts optional `maxResults` (default 200, max 1000); does not include `IWSV` legacy SEGW service objects — for those use `SAPSearch`.
- [ ] No automated test for documentation changes; verify manually by reading the diffs.
- [ ] Run `npm test` — all tests must still pass (no code changed in this task)

### Task 6: Final verification

- [ ] Run full test suite: `npm test` — all tests pass
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors
- [ ] Run integration tests: `npm run test:integration` — all tests pass against live SAP (see `INFRASTRUCTURE.md` for credentials)
- [ ] Smoke test against `a4h.marianzeis.de`: build (`npm run build`), then call `node dist/cli.js call SAPRead --json '{"type":"DEVC","name":"ZDEMO_MIG"}'` and verify the response contains `ZDEMO_MIG_RAP` with description `"Demo: RAP migration outputs from migrate-segw-to-rap skill"` (the alignment fix in action).
- [ ] Move this plan to `docs/plans/completed/2026-05-09-fix-devc-listing-descriptions.md`
