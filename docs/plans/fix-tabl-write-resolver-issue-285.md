# Fix TABL Write Resolver — Refuse TABL/DT Writes on NW 7.50 (issue #285)

## Overview

`SAPWrite(action="update", type="TABL")` on NW 7.50 silently writes to `/sap/bc/adt/ddic/structures/<name>/source/main` instead of `/sap/bc/adt/ddic/tables/<name>/source/main`, flipping `DD02L-TABCLASS` from `TRANSP` to `INTTAB` on the inactive draft. The call reports success but activation later fails with `Tab. ZXXX is of type INTTAB (Technical settings are not meaningful)`. Reads are unaffected; create, update, delete, and activate are all broken for transparent tables on releases that don't ship `/sap/bc/adt/ddic/tables/`.

The root cause is `AdtClient.resolveTablObjectUrl()` (at `src/adt/client.ts:472`), a 404-fallback probe introduced in PR #219 that collapsed the `STRU` type into `TABL`. The fallback is correct for **reads** (the source body is identical from either endpoint) but structurally wrong for **writes**: on NW 7.50 the `/tables/` endpoint is absent entirely, so every transparent-table write silently routes to `/structures/` where SAP infers the object kind from the PUT payload and produces an INTTAB draft.

This plan adds `AdtClient.resolveTablObjectUrlForWrite()` — a search-first resolver that asks SAP for the actual subtype (`TABL/DT` vs `TABL/DS`) and refuses transparent-table writes on systems where `/sap/bc/adt/ddic/tables/` is not exposed (verified live: NW 7.50 NPL discovery feed lists `/ddic/structures` but not `/ddic/tables`; Eclipse ADT 2.51 release notes ship structure/DTEL/DOMA editors but no table editor — the database-table editor was added in ADT 2.52 for NW 7.52). The new resolver replaces the read-path resolver at the four write/activate call sites (`SAPWrite update/delete`, `SAPActivate single + batch`); the `create` and `batch_create` paths get a separate discovery-gated guard since they have no existing object to search for. Refusals carry an `SE11` hint matching SAP's own design (Eclipse ADT users on NW 7.50 are expected to use SAPGUI SE11 for transparent tables).

## Context

### Current State

- `src/adt/client.ts:472` `resolveTablObjectUrl(name)` probes `/sap/bc/adt/ddic/tables/<n>` first, falls back to `/sap/bc/adt/ddic/structures/<n>` on 404. Caches the result in `tablUrlCache` keyed by uppercased name.
- `src/handlers/intent.ts:3459` (SAPWrite update/delete TABL), `:5096` (SAPActivate batch TABL), `:5154` (SAPActivate single TABL) — all call the read-path resolver and then PUT/DELETE/activate against the resolved URL.
- `src/handlers/intent.ts:3500` (SAPWrite create TABL — falls through to `objectUrlForType('TABL', name)` at `objectBasePath('TABL')` → hardcoded `/sap/bc/adt/ddic/tables/`) and `:4541` (batch_create per-entry — same).
- On NW 7.50 (`npl.marianzeis.de`, verified 2026-05-15): `GET /sap/bc/adt/ddic/tables/T000` → **404**, `GET /sap/bc/adt/ddic/structures/T000` → **200**. ADT discovery feed lists `ddic/structures` (plus `validation`, `parser/info`) but not `ddic/tables`. `POST /sap/bc/adt/ddic/tables` (create collection) → 404.
- On A4H S/4HANA 2023: both endpoints exist; discovery advertises both.
- Sami's prior commit `88386fed` (2026-04-23, "guard STRU writes against non-structure objects") introduced a search-based STRU-update guard that was lost in the PR #219 collapse. The new resolver re-introduces the same pattern.
- Existing test coverage: 4 unit tests on `resolveTablObjectUrl` in `tests/unit/adt/client.test.ts:335-377` cover the fallback behavior for reads. Two SAPActivate TABL tests in `tests/unit/handlers/intent.test.ts` mock the probe-and-fallback. **No write-path test asserts what happens when the resolved URL points at `/structures/` for a TABL/DT object on a 7.50-style system.**
- `cachedFeatures.discoveryMap` (populated by `src/server/server.ts:323` via `probeFeatures`, pushed to `intent.ts` via `setCachedFeatures` at `src/server/server.ts:346`) carries the parsed discovery feed as `Map<collectionPath, accept-types[]>` — the right datum for endpoint-availability checks.
- `AdtSafetyError` (`src/adt/errors.ts:602`) is the canonical error class for safety-driven refusals.

### Target State

- `src/adt/client.ts` exports a new `AdtClient.resolveTablObjectUrlForWrite(name, options)` method:
  - Calls `searchObject(name, 5)` to discover the actual `adtcore:type` (TABL/DT vs TABL/DS).
  - Tolerates the NPL 7.50 name suffix quirk (`"T000 (Database Table)"` etc.) by stripping parenthesized text before matching.
  - If TABL/DT: returns `/sap/bc/adt/ddic/tables/<n>` when `options.tablesEndpointAvailable !== false`, otherwise throws `AdtSafetyError` with the SE11 hint.
  - If TABL/DS: returns `/sap/bc/adt/ddic/structures/<n>` (always allowed).
  - If search returns no match or fails (object doesn't yet exist; search auth missing): falls through to the read-path resolver.
  - Caches the resolved URL in a separate `tablWriteUrlCache` map. Cached `/tables/` entries re-validate `tablesEndpointAvailable` on every call (defense-in-depth so a stale cache can't bypass the guard).
- `src/handlers/intent.ts` exposes a new `isTablesEndpointAvailable()` helper returning `boolean | undefined` (undefined when no probe has run yet → callers default-allow for backward compatibility with tests that bypass `SAPManage`). Adds a shared `TABL_DT_WRITE_UNAVAILABLE_HINT` constant so update/delete/activate/create paths all produce the same message.
- All 4 write/activate sites switch from `client.resolveTablObjectUrl(name)` to `client.resolveTablObjectUrlForWrite(name, { tablesEndpointAvailable: isTablesEndpointAvailable() })` and report `AdtSafetyError` cleanly via `errorResult(err.message)`.
- `SAPWrite create TABL` and per-entry `batch_create` TABL refuse upfront with `TABL_DT_WRITE_UNAVAILABLE_HINT` when `isTablesEndpointAvailable() === false`. Refusal happens BEFORE any HTTP call (no wasted /tables/ 404 round-trips).
- Refusal message mentions: NW 7.50/7.51 + table editor added in NW 7.52, SE11 hint, object name, TABCLASS=INTTAB corruption explanation.
- Live verification: on a4h S/4HANA 2023, TABL/DT writes go to `/tables/` (unchanged behavior). On NPL 7.50, all four code paths refuse with the SE11 hint before any HTTP write fires.
- Test coverage: 7 new unit tests on the new resolver, 4 new SAPWrite unit tests (create refusal, update refusal, TABL/DS still works, batch_create marks TABL failed without aborting other entries), 3 new integration tests on a4h that exercise `resolveTablObjectUrlForWrite` end-to-end. Existing 2 SAPActivate TABL tests updated to mock the new search-first flow.
- Research doc `research/abap-types/types/tabl.md` updated with the NW 7.50 live evidence, ADT release-notes reference, and cross-repo pattern matrix (abapGit / abap-adt-api / AFF).

### Key Files

| File | Role |
|------|------|
| `src/adt/client.ts` | ADT client — add `resolveTablObjectUrlForWrite()` (~70 LOC) next to `resolveTablObjectUrl()` at line 472. Add `tablWriteUrlCache` field at line ~161. Import `AdtSafetyError` (line 21). |
| `src/handlers/intent.ts` | Tool dispatch — add `isTablesEndpointAvailable()` + `TABL_DT_WRITE_UNAVAILABLE_HINT` near `isBtpSystem()` at line ~1278. Wire the new resolver at lines ~3459 (SAPWrite update/delete), ~5096 (SAPActivate batch), ~5154 (SAPActivate single). Add discovery-gated create guard at line ~3500 (else branch) and inside the `batch_create` per-entry loop at ~4541. |
| `src/adt/errors.ts` | Existing `AdtSafetyError` (line 602) — no changes; just used by the new resolver. |
| `src/adt/features.ts` | Existing `probeFeatures` populates `cachedFeatures.discoveryMap` — no changes. |
| `tests/unit/adt/client.test.ts` | Add `describe('resolveTablObjectUrlForWrite (issue #285)', ...)` block with ~7 tests covering refusal, cache, fallthrough, SE11-hint shape. |
| `tests/unit/handlers/intent.test.ts` | Update the 2 existing SAPActivate TABL tests (currently mock 404/200 probe) to mock the new search-first flow. Add 4 new SAPWrite tests for the discovery-gated paths. |
| `tests/integration/adt.integration.test.ts` | Add 3 integration tests under the existing `DDIC operations` describe block (line ~531) that exercise `resolveTablObjectUrlForWrite` against the live a4h system. |
| `research/abap-types/types/tabl.md` | Update with the 7.50 live evidence, the issue #285 fix verdict, and the cross-repo pattern matrix. |
| `CLAUDE.md` | Add a row to "Key Files for Common Tasks" for the new resolver + discovery-gated guards. |
| `compare/00-feature-matrix.md` | Add an inline note next to the "Table write (TABL)" row that ARC-1 refuses TABL/DT writes on NW 7.50/7.51 with an SE11 hint (matching Eclipse ADT's own design). |

### Design Principles

1. **Decide by type, not by 404** — the canonical pattern (abapGit `zcl_abapgit_object_tabl_compar:168` checks `IF ls_dd02v-tabclass <> 'TRANSP'`; Eclipse ADT routes deterministically based on the wizard the user picked) is to inspect the object's actual subtype first, then route. ARC-1 mirrors this via `searchObject(name).objectType` (TABL/DT vs TABL/DS) on the write path. The read path keeps its 404 fallback because the source body is identical from either endpoint.
2. **Two caches, one contract** — `tablUrlCache` for reads (where `/structures/` is a safe fallback), `tablWriteUrlCache` for writes (where the cache must reflect the correct endpoint by type, not by what answered first). Don't conflate.
3. **Defense-in-depth on the cache** — even when a write URL is cached, re-validate `tablesEndpointAvailable` for cached `/tables/` entries. The cache is a perf optimization, not a security boundary.
4. **Refuse loudly, with recovery guidance** — `AdtSafetyError` with a message naming the missing endpoint, the release range (NW 7.50/7.51), the SE11 hint, the object name, and the TABCLASS corruption mechanism. The LLM (or human reader) should know exactly why the call refused and what to do instead.
5. **Match Eclipse ADT's own design** — ADT 2.51 (the NW 7.50 plug-in) shipped editors for structures, DTEL, DOMA only. Transparent tables were intentionally out of REST scope; SE11 was the path. Refusing on 7.50 is consistent with SAP's own product decision.
6. **Discovery feed is the source of truth** — `cachedFeatures.discoveryMap` already carries the parsed feed. Don't add a separate probe; consult the existing map. If no probe has run (e.g. test setup that skips `SAPManage`), default-allow to preserve backward compatibility.
7. **Tolerate the NPL search-result quirk** — NPL 7.50 returns `adtcore:name="T000 (Database Table)"` (localized suffix); A4H returns bare `T000`. Strip parenthesized text before matching. This is a portable normalization that doesn't break A4H.

## Development Approach

- Foundation first: new resolver + new helpers/constant in intent.ts. Then wire into 4 call sites. Then guard the 2 create paths. Then tests (unit + integration). Then docs.
- Every code-changing task has unit-test checkboxes. Integration tests run against a4h since the fix touches SAP-system interaction. No E2E tests added — `SAPWrite(type=TABL)` is an existing tool operation; the unit + integration coverage matches similar fixes (e.g. `docs/plans/completed/fix-devc-listing-descriptions.md`).
- Lint and typecheck run as part of validation. The autonomous agent should expect Biome's pre-commit hook to auto-fix formatting on commit — never manually format.
- Live verification on NPL 7.50 (`npl.marianzeis.de`) is non-destructive: no Z transparent tables exist there, and the bug's create path 404s preventing test fixture creation. The integration tests run against a4h (positive paths) and assert refusal-with-hint via the explicit `tablesEndpointAvailable: false` simulator; the standalone NPL verification used during development is documented in the plan but not part of CI.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run test:integration` (requires `TEST_SAP_URL`, `TEST_SAP_USER`, `TEST_SAP_PASSWORD` env — see `INFRASTRUCTURE.md` for the a4h credentials)

### Task 1: Add `resolveTablObjectUrlForWrite()` to `AdtClient`

**Files:**
- Modify: `src/adt/client.ts`
- Modify: `tests/unit/adt/client.test.ts`

The current `resolveTablObjectUrl()` at line 472 is a 404-fallback probe that's correct for reads (source body identical from either endpoint) but wrong for writes (silently routes TABL/DT to `/structures/` on NW 7.50, corrupting DD02L-TABCLASS to INTTAB). Add a parallel `resolveTablObjectUrlForWrite()` that asks SAP via `searchObject()` for the actual subtype and refuses TABL/DT when the `/sap/bc/adt/ddic/tables/` endpoint is unavailable.

- [ ] In `src/adt/client.ts`, change the import on line 21 from `import { AdtApiError, isNotFoundError } from './errors.js';` to `import { AdtApiError, AdtSafetyError, isNotFoundError } from './errors.js';`.
- [ ] At line ~161, immediately after `private readonly tablUrlCache = new Map<string, string>();`, add `private readonly tablWriteUrlCache = new Map<string, string>();` with a JSDoc comment explaining it stores write-path resolutions populated by `resolveTablObjectUrlForWrite()` after asking SAP for `adtcore:type` (TABL/DT vs TABL/DS); separate from `tablUrlCache` to prevent contamination between read and write contracts.
- [ ] Update the JSDoc on `resolveTablObjectUrl()` (line 467-471) to add a paragraph: "Do NOT use this for writes/activates — on NW 7.50 the /tables/ endpoint is absent entirely, so transparent tables (TABL/DT) fall through to /structures/ and a PUT there silently sets DD02L-TABCLASS=INTTAB (corruption). Use `resolveTablObjectUrlForWrite()` instead. See issue #285."
- [ ] Immediately after `resolveTablObjectUrl()` (ending at line 490), add a new method `async resolveTablObjectUrlForWrite(name: string, options: { tablesEndpointAvailable?: boolean } = {}): Promise<string>`. Implementation:
  - Uppercase `name` into `upper`.
  - Check `tablWriteUrlCache.get(upper)`. If cached AND the cached URL starts with `/sap/bc/adt/ddic/tables/` AND `options.tablesEndpointAvailable === false` → throw `AdtSafetyError` with the SE11 hint (use the message from the next bullet). Otherwise if cached → return the cached URL.
  - Call `searchObject(name, 5)` inside a try/catch. The catch should set `actualType = undefined` (search auth missing should not block writes).
  - Find the matching result via `results.find((r) => { const bare = String(r.objectName ?? '').replace(/\s*\(.*$/, '').toUpperCase(); return bare === upper; })`. The parenthesis-stripping is needed because NPL 7.50 appends localized suffixes like `"T000 (Database Table)"` while A4H returns bare `T000`.
  - Set `actualType = match?.objectType`.
  - If `actualType === 'TABL/DT'`:
    - If `options.tablesEndpointAvailable === false` → throw `AdtSafetyError` with this message: `"Transparent table writes via ADT REST are not available on this system (/sap/bc/adt/ddic/tables/ is not exposed — NW 7.50/7.51 ship the DDIC structures endpoint only; the table editor was added in NW 7.52). Use SE11 in SAPGUI to modify transparent table \"${name}\", or connect ARC-1 to an SAP_BASIS ≥ 7.52 system. Writing to /sap/bc/adt/ddic/structures/ would silently flip DD02L-TABCLASS to INTTAB and corrupt the table."`.
    - Otherwise: cache `/sap/bc/adt/ddic/tables/${encodeURIComponent(name)}` and return it.
  - If `actualType === 'TABL/DS'`: cache `/sap/bc/adt/ddic/structures/${encodeURIComponent(name)}` and return it.
  - If neither (undefined or any other value): fall through to `return this.resolveTablObjectUrl(name)`. The caller is creating a brand-new object or the search failed; the read-path resolver's behavior is the best best-effort fallback.
- [ ] Add a JSDoc comment above the new method explaining its contract, why it differs from `resolveTablObjectUrl()`, the citation to issue #285, and that it caches separately to avoid contaminating the read-path cache.
- [ ] Add unit tests (~7 tests) to `tests/unit/adt/client.test.ts` under a new `describe('resolveTablObjectUrlForWrite (issue #285)', ...)` block. Follow the existing mocking pattern (`vi.mock('undici', ...)` + `mockResponse()`). Define a helper `const searchResponse = (uri: string, type: string, name: string) => mockResponse(200, "<?xml...><adtcore:objectReferences ...><adtcore:objectReference adtcore:uri=\"${uri}\" adtcore:type=\"${type}\" adtcore:name=\"${name}\"/></adtcore:objectReferences>")`. Tests:
  - `returns /tables/ URL when search reports TABL/DT and tables endpoint is available`
  - `refuses TABL/DT writes when /sap/bc/adt/ddic/tables/ is unavailable (NW 7.50)` — asserts `.rejects.toThrow(/Transparent table writes via ADT REST are not available/)`
  - `returns /structures/ URL when search reports TABL/DS regardless of tables availability`
  - `caches the resolved write URL — second call hits no HTTP` — only one fetch call after two resolver invocations
  - `SE11 hint mentions NW 7.50/7.51 + the table editor landing in 7.52` — asserts `message` contains `'NW 7.50/7.51'`, `'NW 7.52'`, `'SE11'`, the object name, and `'TABCLASS'`
  - `falls through to the read-path resolver when search returns no match` — mock search empty + then a /tables/ 200 GET; expect `/tables/<name>` returned
  - `treats search failure as fall-through (search auth missing should not block writes)` — mock search rejected + then a /tables/ 200 GET; expect `/tables/<name>` returned
- [ ] Run `npm test` — all tests must pass

### Task 2: Add `isTablesEndpointAvailable()` helper + shared refusal hint in `intent.ts`

**Files:**
- Modify: `src/handlers/intent.ts`

The new resolver and the create-path guards both need to consult the discovery feed and surface the same refusal message. Centralize both.

- [ ] In `src/handlers/intent.ts`, find `isBtpSystem()` at line ~1273. Immediately after it (after the closing brace of the function and the empty line), add a new helper `isTablesEndpointAvailable(): boolean | undefined`:
  - Read `const map = cachedFeatures?.discoveryMap ?? cachedDiscovery;`
  - Return `undefined` when `!map || map.size === 0` (so callers can default-allow when no probe has run).
  - Otherwise return `map.has('/sap/bc/adt/ddic/tables')`.
  - Include a JSDoc paragraph: "Return whether the SAP ADT discovery feed advertises the /sap/bc/adt/ddic/tables collection (the transparent-table editor endpoint). Absent on NW 7.50/7.51 — SAP added it in NW 7.52 along with the new database-table editor. When the discovery cache is empty (e.g. probe never ran, tests that bypass SAPManage), returns `undefined` so callers can decide whether to default-allow. See issue #285."
- [ ] Immediately after `isTablesEndpointAvailable()`, add a module-level constant `const TABL_DT_WRITE_UNAVAILABLE_HINT = "Transparent table writes via ADT REST are not available on this system (/sap/bc/adt/ddic/tables/ is not exposed — NW 7.50/7.51 ship the DDIC structures endpoint only; the table editor was added in NW 7.52). Use SE11 in SAPGUI, or connect ARC-1 to an SAP_BASIS ≥ 7.52 system. Writing the source via /sap/bc/adt/ddic/structures/ would silently flip DD02L-TABCLASS to INTTAB and corrupt the table.";`. JSDoc paragraph: "Stable hint surfaced when ARC-1 refuses a TABL/DT write because the connected system does not expose /sap/bc/adt/ddic/tables/. Shared between the resolver-driven update/delete/activate paths and the discovery-gated create paths so the LLM always sees the same recovery instructions."
- [ ] No new tests in this task — the helpers are exercised indirectly by the tests in tasks 3-6. Run `npm test` to confirm nothing regressed.

### Task 3: Wire the new resolver into SAPWrite update/delete TABL

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

The current code at `src/handlers/intent.ts:3459` calls `client.resolveTablObjectUrl(name)` for TABL update/delete/edit_method. Replace with `client.resolveTablObjectUrlForWrite()` and translate `AdtSafetyError` into a clean `errorResult()`.

- [ ] In `src/handlers/intent.ts`, locate the block at line ~3459: `if (type === 'TABL' && action !== 'create' && action !== 'batch_create') { objectUrl = await client.resolveTablObjectUrl(name); srcUrl = ... }`. Replace with a `try`/`catch` that calls `client.resolveTablObjectUrlForWrite(name, { tablesEndpointAvailable: isTablesEndpointAvailable() })` and on `AdtSafetyError` returns `errorResult(resolveErr.message)`. Re-throw any other error. Add an inline comment citing issue #285 explaining the change.
- [ ] Confirm `AdtSafetyError` is imported in `intent.ts` (it is — at line ~101 — but verify after the edit). If not present, add it to the existing import from `'../adt/errors.js'`.
- [ ] No new tests in this task — coverage lives in Task 6. Run `npm test` to confirm no regressions (existing SAPWrite TABL tests at `tests/unit/handlers/intent.test.ts` line ~8089 use `mockFetch.mockImplementation` that catches all fetches, so the new resolver's search call falls through to the generic-success handler → resolver returns no match → falls through to read-path resolver → tests still pass).

### Task 4: Wire the new resolver into SAPActivate (single + batch) TABL

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

Two more call sites: the batch activate loop at line ~5096 and the single-activate path at line ~5154. Both currently call `client.resolveTablObjectUrl(name)`. Replace with `resolveTablObjectUrlForWrite()`.

- [ ] In `src/handlers/intent.ts`, at line ~5096 inside the batch `Promise.all(rawObjects.map(async (o) => {...}))` block, find `if (objType === 'TABL') { url = await client.resolveTablObjectUrl(objName); }` and replace with `if (objType === 'TABL') { url = await client.resolveTablObjectUrlForWrite(objName, { tablesEndpointAvailable: isTablesEndpointAvailable() }); }`. Add an inline comment referencing issue #285 noting that the resolver's `AdtSafetyError` propagates up via `Promise.all`'s rejection → caught by the outer SAPActivate error path → reported as a tool error. No need for a local try/catch here.
- [ ] At line ~5154 (the single-activate path after the batch block), find the existing TABL branch `if (type === 'TABL') { objectUrl = await client.resolveTablObjectUrl(name); }`. Wrap it in a try/catch: call `client.resolveTablObjectUrlForWrite(name, { tablesEndpointAvailable: isTablesEndpointAvailable() })`; on `AdtSafetyError` return `errorResult(resolveErr.message)`; re-throw other errors. Add a comment citing issue #285.
- [ ] Update the 2 existing SAPActivate TABL tests in `tests/unit/handlers/intent.test.ts`:
  - `activates a DDIC structure via TABL with structure URL in XML body` (currently around line 5069): replace the 404+200 probe mocks with a single search-response mock returning `adtcore:type="TABL/DS"` for the structure. Update the comment to describe the new search-first flow.
  - `activates a transparent table via TABL with /tables/ URL (no fallback)` (currently around line 5094): replace the single 200 probe mock with a search-response mock returning `adtcore:type="TABL/DT"`. Keep the assertion that `/tables/` ends up in the activate POST body.
- [ ] Run `npm test` — both updated tests must pass; full suite must remain green.

### Task 5: Add discovery-gated guard on `SAPWrite create` and `batch_create` TABL paths

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

For `create` and `batch_create` there's no existing object to search for, so the type-based resolver can't help. Instead, consult `isTablesEndpointAvailable()` directly and refuse with the shared hint when the endpoint is missing. Refusal must happen BEFORE any HTTP call (no wasted POST → 404 round-trip).

- [ ] In `src/handlers/intent.ts`, find the `else` branch at line ~3500 (just before `objectUrl = objectUrlForType(type, name);`). At the top of the else branch, before the existing `objectUrl = ...` line, add: `if (type === 'TABL' && (action === 'create' || action === 'batch_create')) { if (isTablesEndpointAvailable() === false) { return errorResult(TABL_DT_WRITE_UNAVAILABLE_HINT); } }`. Add an inline comment explaining the guard cites issue #285 and only fires when discovery has confirmed the endpoint is missing (not when no probe has run).
- [ ] In the same file, find the `batch_create` per-entry loop at line ~4587 (just before `const objUrl = objectUrlForType(objType, objName);`). Add a TABL-specific guard at the very top of the per-entry try-block: `if (objType === 'TABL' && isTablesEndpointAvailable() === false) { results.push({ type: objType, name: objName, packageName: objPackage, status: 'failed', error: TABL_DT_WRITE_UNAVAILABLE_HINT }); break; }`. This marks just the TABL entry as failed; other entries in the batch (e.g. DOMA, DTEL) continue.
- [ ] Add unit tests (~4 tests) to `tests/unit/handlers/intent.test.ts` inside the existing `describe('SAPWrite TABL source-based writes', ...)` block at line ~8089. Each test must call `setCachedFeatures({ abapRelease: '750', systemType: 'onprem', discoveryMap: new Map<string, string[]>([['/sap/bc/adt/ddic/structures', ['application/*']]]) } as ResolvedFeatures)` in a `try/finally` with `resetCachedFeatures()` in the finally:
  - `refuses TABL create when /sap/bc/adt/ddic/tables/ is missing from discovery (issue #285)` — calls SAPWrite create TABL, asserts `result.isError === true`, message contains `'Transparent table writes via ADT REST are not available'`, `'NW 7.50/7.51'`, `'SE11'`, `'TABCLASS'`, and `mockFetch.mock.calls` is empty (no HTTP fired).
  - `refuses TABL update when search reports TABL/DT and /tables/ is missing (issue #285)` — mocks search returning TABL/DT for `SCARR`, calls SAPWrite update TABL, asserts refusal message + that no PUT to `/source/main`, no LOCK, and no `/structures/SCARR` hit appears in the captured URLs.
  - `allows TABL update for TABL/DS structures on 7.50 (structures endpoint is available)` — uses `mockFetch.mockImplementation` to handle search (returns TABL/DS) and LOCK (returns LH7 handle), asserts the eventual PUT lands on `/sap/bc/adt/ddic/structures/ZSTRU_750/source/main` and no `/tables/` URL is touched.
  - `refuses TABL in batch_create when /tables/ is missing — other entries continue (issue #285)` — calls batch_create with a DOMA + TABL pair, asserts the result text contains both the DOMA success marker (`'ZD_OK_750'`) and the TABL refusal message; `lintBeforeWrite: false` to bypass lint complexity.
- [ ] Run `npm test` — all 4 new tests + full suite must pass.

### Task 6: Add integration tests on a4h (S/4HANA 2023)

**Files:**
- Modify: `tests/integration/adt.integration.test.ts`

The fix touches a SAP-endpoint round-trip; add live coverage that exercises `resolveTablObjectUrlForWrite` against a4h (where `/tables/` is available). The NPL 7.50 path is covered by the unit tests (the resolver's refusal logic is fully deterministic when given `tablesEndpointAvailable: false`).

- [ ] In `tests/integration/adt.integration.test.ts`, find the existing `describe('DDIC operations', ...)` block (line ~531). Immediately after the `reads T000 via unified getTabl() — transparent table (URL release-dependent)` test (ending around line ~569), add three new tests:
  - `resolveTablObjectUrlForWrite returns /tables/ for TABL/DT when /tables/ endpoint is available (issue #285)` — calls `client.resolveTablObjectUrlForWrite('T000', { tablesEndpointAvailable: true })` and asserts the resolved URL is exactly `'/sap/bc/adt/ddic/tables/T000'`. Comment: "T000 is a transparent table on every release."
  - `resolveTablObjectUrlForWrite refuses TABL/DT writes when /tables/ is unavailable (issue #285)` — uses a try/catch to capture the error from `client.resolveTablObjectUrlForWrite('T000', { tablesEndpointAvailable: false })`. Asserts the captured error is defined, message contains `'Transparent table writes via ADT REST are not available'`, `'SE11'`, `'NW 7.52'`. Note that the resolver caches per-client — this test must run AFTER the positive test above so the cache's defense-in-depth re-validation is exercised.
  - `resolveTablObjectUrlForWrite returns /structures/ for TABL/DS regardless of tables availability` — calls `client.resolveTablObjectUrlForWrite('BAPIRET2', { tablesEndpointAvailable: false })` and asserts the result is exactly `'/sap/bc/adt/ddic/structures/BAPIRET2'`. Comment: "BAPIRET2 is a TABL/DS structure on every release; even with /tables/ unavailable, structure writes route to /structures/."
- [ ] Run `npm run test:integration -- -t "resolveTablObjectUrlForWrite"` — all 3 new tests must pass against a4h. Requires `TEST_SAP_URL`, `TEST_SAP_USER`, `TEST_SAP_PASSWORD` in env per `INFRASTRUCTURE.md`.

### Task 7: Update research note + CLAUDE.md Key Files table + feature matrix

**Files:**
- Modify: `research/abap-types/types/tabl.md`
- Modify: `CLAUDE.md`
- Modify: `compare/00-feature-matrix.md`

Document the fix in the artifact surface so future autonomous-agent runs and human readers understand the new write-path behavior.

- [ ] In `research/abap-types/types/tabl.md`, update the TL;DR section to add a paragraph distinguishing the **read path** (uses `resolveTablObjectUrl()` with 404 fallback — correct because source is identical from either endpoint) from the **write path** (uses `resolveTablObjectUrlForWrite()` introduced for issue #285 — search-first, refuses TABL/DT writes on systems lacking `/sap/bc/adt/ddic/tables/`). Mention that Eclipse ADT 2.51 (the NW 7.50 plug-in) shipped editors for structures/DTEL/DOMA only and added the database-table editor in ADT 2.52 for NW 7.52.
- [ ] In `research/abap-types/types/tabl.md`, replace the existing `### 7.50 (NW 7.50)` section ("Not verified live...") with verified-live evidence: ADT discovery lists `ddic/structures` but not `ddic/tables`; `GET /sap/bc/adt/ddic/tables/T000` → 404, `/structures/T000` → 200; `/sap/bc/adt/ddic/structures/SCARR/source/main` returns body framed as `define type scarr { ... }` (the corruption mechanism); `POST /sap/bc/adt/ddic/tables` (create collection) → 404; search returns `adtcore:type="TABL/DT" adtcore:name="T000 (Database Table)"` (NPL-only suffix). Date the entry "verified 2026-05-15 (issue #285)".
- [ ] In `research/abap-types/types/tabl.md`, update the "ARC-1 current surface" table to add a row for `src/adt/client.ts resolveTablObjectUrlForWrite` (issue #285) and a row for the discovery-gated create guard in `src/handlers/intent.ts`. Add a new "Cross-repo pattern reference" subsection with the comparison matrix: Eclipse ADT 2.51 vs 2.52+, abapGit (`zcl_abapgit_object_tabl` reads TABCLASS first), abap-adt-api (same broken probe-and-fallback — has the same latent bug), SAP/abap-file-formats (no TABL schema yet).
- [ ] In `CLAUDE.md`, find the "Key Files for Common Tasks" table. Add a new row: `Add TABL/DT write-path guard (issue #285) | src/adt/client.ts (resolveTablObjectUrlForWrite — search-first, refuses on systems lacking /ddic/tables), src/handlers/intent.ts (isTablesEndpointAvailable + TABL_DT_WRITE_UNAVAILABLE_HINT + 4 call sites: SAPWrite update/delete, SAPActivate single/batch, SAPWrite create + batch_create discovery gate), tests/unit/adt/client.test.ts, tests/unit/handlers/intent.test.ts, tests/integration/adt.integration.test.ts. Read path (resolveTablObjectUrl) unchanged.`
- [ ] In `compare/00-feature-matrix.md`, find the `| Table write (TABL) |` row (around line 165). Update the ARC-1 cell to `✅ (with NW 7.50/7.51 refusal + SE11 hint; transparent-table editor lives in 7.52+ ADT only — matches Eclipse ADT's own design)` so the matrix accurately reflects the new behavior. Refresh the "Last Updated" date at the top of the file to today's date (search for a `_Last Updated:_` or `## Changelog` style header — keep the existing format).
- [ ] No automated test for documentation changes; verify by reading the diffs.
- [ ] Run `npm test` — all tests must still pass (no code changed in this task).

### Task 8: Final verification

- [ ] Run full unit suite: `npm test` — all tests pass (count should be ~2909, up from ~2898 prior to this work)
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors (Biome's pre-commit hook will auto-fix formatting if needed; never manually format)
- [ ] Run integration tests against a4h: `npm run test:integration -- -t "resolveTablObjectUrlForWrite"` — all 3 new tests pass
- [ ] Run the full DDIC integration block: `npm run test:integration -- -t "DDIC operations"` — all existing tests still pass
- [ ] Smoke test against `npl.marianzeis.de` to verify the fix end-to-end on the actual 7.50 system. Build first: `npm run build`. Then create a one-shot Node script that constructs an `AdtClient` against NPL with `DDIC:Appl1ance` (per `INFRASTRUCTURE.md`) and `safety: { allowWrites: true, ... }`, and calls `client.resolveTablObjectUrlForWrite('T000', { tablesEndpointAvailable: false })`. Expect it to throw `AdtSafetyError` with the SE11 hint. Also verify the positive paths on a4h. The verification script is throwaway — do not commit it.
- [ ] Move this plan to `docs/plans/completed/fix-tabl-write-resolver-issue-285.md`
