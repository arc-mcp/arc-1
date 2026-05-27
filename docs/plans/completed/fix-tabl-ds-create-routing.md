# Fix TABL/DS Create Routing — Support DDIC Structure Creation via SAPWrite

**Status:** Completed. Shipped as a follow-up to PR #286 / issue #285. A Codex review of the initial implementation surfaced three additional fixes — explicit-slash bypass of the PR #286 search-first resolver on update/delete, legacy `STRU/DS` alias collapsing through SLASH_TYPE_MAP, and downstream Set-membership checks not seeing canonical `TABL` for slash-form callers — all addressed in the same PR with `canonicalTablType()` helper and an extended write-side alias map.

## Overview

`SAPWrite(action="create", type="TABL/DS", name="...")` mis-routed to `/sap/bc/adt/ddic/tables` (the transparent-table collection) instead of `/sap/bc/adt/ddic/structures`, emitted `adtcore:type="TABL/DT"` in the create payload, and consequently failed on SAP with a confusing "name too long" error (T100 AD102) whenever the structure name exceeded the 16-character transparent-table limit (e.g. namespaced names like `/LEOWM/SD_MON_S_WHO`). Even when the name length passed, ARC-1 silently created a transparent table instead of the DDIC structure the user asked for. PR #286 (issue #285) fixed the update/delete/activate side via a search-first resolver, but the **create** path had no existing object to look up and therefore needed a different fix: preserve the user's subtype intent end-to-end.

The root cause was two-fold. First, `normalizeTypeArgsForValidation()` in `src/handlers/intent.ts` flattened `TABL/DS` to bare `TABL` via `SLASH_TYPE_MAP` before schema validation, so by the time `handleSAPWrite()` ran the subtype information was gone. Second, `objectBasePath('TABL')` was hardcoded to `/sap/bc/adt/ddic/tables/` and `buildCreateXml('TABL', ...)` was hardcoded to emit `adtcore:type="TABL/DT"`. The fix preserves `TABL/DS` (and the explicit `TABL/DT` form) end-to-end on every SAPWrite action — not just create — branches URL and XML envelope on subtype, routes update/delete/activate/edit_method/scaffold_rap_handlers through the PR #286 search-first resolver for all TABL forms, and skips the PR #286 discovery-gated `/tables/` refusal when the user asks for `TABL/DS` (since `/structures/` exists on every release that ships ADT, including NW 7.50).

Live verification on the a4h S/4HANA 2023 test system (2026-05-27) confirms POST `/sap/bc/adt/ddic/structures` with `<blue:blueSource adtcore:type="TABL/DS">` returns 201 Created for namespaced and ≤30-char Z-names — exactly the failing case Michael reported. The fix unlocks DDIC structure creation across both S/4 and NW 7.50, matches the existing `<blue:blueSource>` envelope (no new XML namespace needed), and stays consistent with the search-first write resolver shipped in PR #286.

## Context

### Current State

- `src/handlers/intent.ts:3136` `normalizeObjectType('TABL/DS')` → `SLASH_TYPE_MAP['TABL/DS']` → `'TABL'`. Subtype is lost before schema validation runs.
- `src/handlers/schemas.ts:306-324` `SAPWRITE_TYPES_ONPREM` enum accepts only `'TABL'` (no slash forms).
- `src/handlers/intent.ts:3500-3504` else-branch of the URL/srcUrl resolver block: TABL create falls through to `objectUrlForType('TABL', name)`, which routes to `/sap/bc/adt/ddic/tables/<name>` unconditionally.
- `src/handlers/intent.ts:3247` `objectBasePath` case `'TABL'`: returns `/sap/bc/adt/ddic/tables/`. No case for `'TABL/DS'` or `'TABL/DT'` — slash forms reach the default `throw new Error("refusing to build URL for slash-form type ...")` guard.
- `src/handlers/intent.ts:2813-2825` `buildCreateXml` case `'TABL'`: hardcodes `adtcore:type="TABL/DT"` in the `<blue:blueSource>` envelope.
- `src/handlers/intent.ts:3502-3504` post-PR-286 discovery gate refuses TABL create when `/sap/bc/adt/ddic/tables` is not advertised in discovery. Correct for transparent tables on 7.50, but would incorrectly block TABL/DS creates if not scoped to bare TABL.
- `src/handlers/intent.ts:4541-4600` batch_create per-entry loop mirrors all of the above: hardcodes `objectUrlForType(objType, objName)` plus an analogous PR #286 guard that refuses TABL when /tables/ missing — needs the same subtype-aware fix.
- Read/update/delete/activate paths are subtype-tolerant already: `getTabl()` and `resolveTablObjectUrlForWrite()` (PR #286) inspect existing objects via search and route accordingly. Only **create** is broken.

Live evidence (a4h S/4HANA 2023, verified 2026-05-27):
```
POST /sap/bc/adt/ddic/tables   adtcore:type=TABL/DT name=/LEOWM/SD_MON_S_WHO → 422 AD102 "Select a shorter name"  ← Michael's bug
POST /sap/bc/adt/ddic/structures adtcore:type=TABL/DS name=ZSTR_BUG_PROBE     → 201 Created
POST /sap/bc/adt/ddic/structures adtcore:type=TABL/DS name=ZSTR_NS_PROBE_LONG_NAME_TST (27 chars) → 201 Created
GET  /sap/bc/adt/ddic/structures/BAPIRET2 → <blue:blueSource adtcore:type="TABL/DS" xmlns:blue="http://www.sap.com/wbobj/blue" ...>
```

ADT discovery on a4h advertises both collections side-by-side: `/sap/bc/adt/ddic/structures` (Accept `application/vnd.sap.adt.structures.v2+xml`, category term `tablds`) and `/sap/bc/adt/ddic/tables` (Accept `application/vnd.sap.adt.tables.v2+xml`, category term `tabldt`). The envelope shape (`<blue:blueSource>` with `xmlns:blue="http://www.sap.com/wbobj/blue"`) is identical for both endpoints — only `adtcore:type` and the URL path differ. Content-Type `application/*` is accepted by both endpoints.

### Target State

- `SAPWrite(action="create", type="TABL/DS", name="ZSTR_X", ...)` succeeds end-to-end on any release that ships `/sap/bc/adt/ddic/structures` (every modern ADT-enabled release including NW 7.50). The POST goes to `/sap/bc/adt/ddic/structures` with `adtcore:type="TABL/DS"` and SAP returns 201.
- `SAPWrite(action="create", type="TABL/DT", name="ZTBL_X", ...)` is equivalent to today's `type="TABL"` — explicit transparent-table create. Subject to PR #286's discovery-gated refusal on systems lacking `/sap/bc/adt/ddic/tables` (NW 7.50/7.51).
- `SAPWrite(action="create", type="TABL", name="ZTBL_X", ...)` continues to default to TABL/DT (transparent table) — backward-compatible with existing callers, no change for them.
- Same behavior for `batch_create` per-entry: each object's `type` accepts `TABL`, `TABL/DT`, or `TABL/DS`; URL + XML envelope branch on subtype; the PR #286 discovery guard fires only for TABL/DT.
- Update/delete/activate paths remain on the PR #286 search-first resolver — unchanged. `SAPWrite(action="update", type="TABL/DS", ...)` is supported because the resolver determines the actual subtype from SAP search.
- LLM-discoverability: tool schema lists `TABL/DT` and `TABL/DS` alongside bare `TABL` in the SAPWrite type enum, with description noting that `TABL` defaults to TABL/DT.
- Tests cover schema acceptance, normalization preservation, URL routing branching, XML envelope branching, content-type behavior, discovery-gated refusal (TABL + TABL/DT on 7.50 only — not TABL/DS), and a live end-to-end create+delete on a4h with a namespaced name (Michael's exact scenario).
- Docs: `research/abap-types/types/tabl.md` updated with the create-side fix verdict and live evidence; `CLAUDE.md` Key Files table gains a row; `compare/00-feature-matrix.md` "Table write (TABL)" row gets an inline note that ARC-1 now also creates TABL/DS structures.

### Key Files

| File | Role |
|------|------|
| `src/handlers/schemas.ts` | `SAPWRITE_TYPES_ONPREM` enum at line 306-324; add `'TABL/DT'` and `'TABL/DS'` alongside the existing `'TABL'`. Schemas for SAPWrite, SAPWriteBatchEntry, SAPWriteSchemaBtp (if applicable). |
| `src/handlers/intent.ts` | Several touch points: (1) `normalizeTypeArgsForValidation` at line ~3143 — preserve `TABL/DT`/`TABL/DS` for SAPWrite (don't collapse via SLASH_TYPE_MAP). (2) `objectBasePath` at line ~3247 — add cases for the slash forms. (3) `buildCreateXml` at line ~2813 — branch on subtype, emit correct `adtcore:type`. (4) `handleSAPWrite` else-branch at line ~3500 — restrict the discovery gate to bare `TABL` and `TABL/DT`. (5) `batch_create` per-entry at line ~4587 — mirror (4). |
| `src/handlers/tools.ts` | SAPWrite tool JSON schema for the `type` field — document the new enum values and their semantics. |
| `tests/unit/handlers/schemas.test.ts` | Unit tests: schema accepts `TABL/DT` and `TABL/DS` (existing tests for `TABL` must still pass). |
| `tests/unit/handlers/intent.test.ts` | Unit tests: create with TABL/DS routes to `/structures/`; create with TABL/DT and bare TABL route to `/tables/`; XML envelope carries the correct `adtcore:type`; batch_create entries support all three forms; PR #286 discovery gate fires only for bare TABL + TABL/DT (NOT TABL/DS). |
| `tests/integration/adt.integration.test.ts` | Integration test on a4h: end-to-end create + delete of a Z-prefixed structure with a namespaced/long name (reproduces Michael's scenario); assert no fallback to `/tables/`. |
| `research/abap-types/types/tabl.md` | Add a "Create-path routing (TABL/DT vs TABL/DS)" section documenting the post-fix behavior with live evidence. |
| `CLAUDE.md` | Add a Key Files row for "Add TABL/DS create routing — preserve subtype through SAPWrite, branch URL + XML on TABL/DT vs TABL/DS". |
| `compare/00-feature-matrix.md` | Update the "Table write (TABL)" row to note ARC-1 supports both TABL/DT and TABL/DS create after this fix; refresh "Last Updated". |

### Design Principles

1. **Preserve subtype on writes, collapse on reads.** SLASH_TYPE_MAP collapses TABL/DT and TABL/DS to bare TABL globally today — correct for reads (the fallback resolver in `getTabl` handles either endpoint and source content is identical). For SAPWrite the normalization layer must keep `TABL/DT` and `TABL/DS` intact so the create path can route on subtype.
2. **Bare `TABL` keeps today's behavior.** `SAPWrite(action="create", type="TABL", ...)` continues to default to TABL/DT (transparent table). Old callers don't break. The new explicit `TABL/DT` form is equivalent to bare `TABL`.
3. **The discriminator is the URL + `adtcore:type`, not the envelope.** Live probing on a4h confirms `<blue:blueSource xmlns:blue="http://www.sap.com/wbobj/blue">` works for both subtypes — only the URL path and the `adtcore:type` attribute differ. Don't invent a new namespace or envelope element.
4. **Content-Type stays `application/*`.** SAP accepts the wildcard on both `/ddic/tables` and `/ddic/structures` creates (verified live). The discovery-advertised vendor types (`application/vnd.sap.adt.structures.v2+xml`, `application/vnd.sap.adt.tables.v2+xml`) are not required for the create round-trip.
5. **PR #286 discovery gate stays scoped to bare TABL + TABL/DT.** The "transparent table writes via ADT REST are not available on this system" refusal must NOT fire for TABL/DS, since `/sap/bc/adt/ddic/structures` exists on every release (including NW 7.50). This unlocks structure CRUD on 7.50 as a bonus.
6. **Match the existing slash-type pattern.** ARC-1 already has precedent for slash forms surviving normalization on specific paths (`SLASH_TYPE_MAP` maps `CLAS/OC → CLAS`, `INTF/OI → INTF`, etc., for SAPRead — but Set membership / KNOWN_BASE_TYPES checks distinguish). The fix should follow the same pattern: SAPRead and SAPNavigate keep collapsing TABL/DT and TABL/DS to bare TABL; SAPWrite preserves the slash form.
7. **No new ADT round-trip on the happy path.** Subtype is determined entirely from the user's input — no extra HEAD/GET probe needed. The PR #286 search-first resolver runs only on update/delete/activate (where an existing object must be inspected); create is purely a routing decision based on the user's argument.

## Development Approach

- Foundation first: schema enum + normalization preservation. Then URL routing + XML envelope branching. Then discovery-gate scoping. Then tests (unit + integration). Then docs.
- Every code-changing task has unit-test checkboxes using the project's `vi.mock('undici')` + `mockResponse()` pattern.
- Integration test added (touches a SAP-system create round-trip and reproduces Michael's failing namespaced-name case end-to-end on a4h). The integration test must clean up via `try/finally` per `docs/testing-skip-policy.md`.
- No E2E test added — `SAPWrite(action='create', type='TABL/...')` is an existing tool operation with a new enum value, not a new tool or protocol behavior. Unit + integration coverage suffices.
- Lint and typecheck run as part of validation. Biome's pre-commit hook auto-fixes formatting on commit — never manually format.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run test:integration` (requires `TEST_SAP_URL`, `TEST_SAP_USER`, `TEST_SAP_PASSWORD` per `INFRASTRUCTURE.md` — a4h S/4HANA 2023 trial)

### Task 1: Extend SAPWrite schema with `TABL/DT` and `TABL/DS`

**Files:**
- Modify: `src/handlers/schemas.ts`
- Modify: `tests/unit/handlers/schemas.test.ts`

Today `SAPWRITE_TYPES_ONPREM` accepts only bare `'TABL'`. Add `'TABL/DT'` and `'TABL/DS'` so the user can explicitly request a transparent-table create vs a structure create. Bare `'TABL'` continues to mean TABL/DT (today's default).

- [x] In `src/handlers/schemas.ts`, find the `SAPWRITE_TYPES_ONPREM` array at line ~306. Add `'TABL/DT'` and `'TABL/DS'` as additional entries (place them adjacent to `'TABL'` for readability). Keep `'TABL'` so existing callers don't break. The Zod `z.enum(SAPWRITE_TYPES_ONPREM)` at line ~396 will pick up the new values automatically.
- [x] If there is a separate `SAPWRITE_TYPES_BTP` array, mirror the addition there too (BTP ABAP Environment doesn't ship `/sap/bc/adt/ddic/tables` either, but it does ship structures via cloud-equivalent objects — the schema must accept the values even if the runtime gate refuses). Check the file for the BTP enum first; if absent, skip this bullet.
- [x] Add unit tests (~4 tests) in `tests/unit/handlers/schemas.test.ts`: SAPWrite accepts `type='TABL/DT'`; SAPWrite accepts `type='TABL/DS'`; SAPWrite still accepts bare `type='TABL'`; SAPWriteSchema's `objects` (batch_create) accepts entries with `type='TABL/DS'`. Follow the existing `describe('SAPWriteSchema', ...)` patterns at the top of the file.
- [x] Run `npm test` — all tests must pass

### Task 2: Preserve `TABL/DT` and `TABL/DS` through SAPWrite type normalization

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

`normalizeTypeArgsForValidation` at line ~3143 currently collapses `TABL/DS` → `TABL` (via `SLASH_TYPE_MAP['TABL/DS'] = 'TABL'`) before Zod validation. This is correct for SAPRead/SAPNavigate (where the read-path resolver handles either endpoint) but wrong for SAPWrite (where the user's subtype intent must reach the create handler). Preserve the slash form for SAPWrite specifically; SAPRead and SAPNavigate keep collapsing.

- [x] In `src/handlers/intent.ts`, find `normalizeTypeArgsForValidation` at line ~3143. For the `case 'SAPWrite':` branch (and any batch entries inside it), replace `normalizeObjectType(String(args.type ?? ''))` with a TABL-aware variant: if the input upper-cased trim is `'TABL/DT'` or `'TABL/DS'`, return the slash form unchanged; otherwise call `normalizeObjectType()` as before. Define this as a small inline helper or a new exported function `normalizeWriteObjectType()` for clarity. Apply the same logic to each `obj.type` inside the `objects.map` for batch_create.
- [x] Make sure the slash forms still survive when passed through `KNOWN_BASE_TYPES.has(type)` checks downstream — `KNOWN_BASE_TYPES` is a Set used to detect base canonical types; if your inline helper short-circuits before the SLASH_TYPE_MAP lookup, slash forms won't be in that Set and the existing "throw on slash form" guard at `objectBasePath` default-case would fire. Task 3 adds the missing `objectBasePath` cases that prevent the throw.
- [x] Add unit tests (~5 tests) in `tests/unit/handlers/intent.test.ts` under a new `describe('SAPWrite type normalization (TABL/DT vs TABL/DS)', ...)` block: SAPWrite preserves `TABL/DT` through normalization; SAPWrite preserves `TABL/DS`; bare `TABL` still normalizes to `'TABL'`; SAPWrite batch_create per-entry preserves `TABL/DS`; SAPRead with `type='TABL/DS'` still collapses to bare `'TABL'` (regression guard — must NOT change read behavior).
- [x] Run `npm test` — all tests must pass

### Task 3: Route create URL by subtype in `objectBasePath`

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

`objectBasePath` at line ~3247 has a single `case 'TABL':` returning `/sap/bc/adt/ddic/tables/`. The default branch throws for slash-form types. Add explicit cases for `'TABL/DT'` (→ `/tables/`, same as bare TABL) and `'TABL/DS'` (→ `/structures/`). This is the single source of truth for create URL routing.

- [x] In `src/handlers/intent.ts`, find `objectBasePath` at line ~3225 (the case-by-case dispatcher). Locate `case 'TABL':` at line ~3243-3247 with its inline comment. Add two new cases ABOVE or BELOW (your choice) for the slash forms:
  - `case 'TABL/DT':` returns `'/sap/bc/adt/ddic/tables/'` (with a comment "Explicit transparent-table form; equivalent to bare 'TABL'.")
  - `case 'TABL/DS':` returns `'/sap/bc/adt/ddic/structures/'` (with a comment "Explicit structure form; the only path for structure creation. The bare 'TABL' form defaults to /tables/ for backward compat.")
- [x] Keep the existing `case 'TABL':` returning `/sap/bc/adt/ddic/tables/` — bare TABL means "transparent table" (today's default behavior).
- [x] Verify the existing default-branch slash-form guard at line ~3288 doesn't fire — adding the explicit cases means `'TABL/DT'` and `'TABL/DS'` never reach that branch. (If you want extra defense-in-depth, you could explicitly remove them from the "include this in the throw" check, but the case-handler ordering already prevents the issue.)
- [x] Add unit tests (~4 tests) in `tests/unit/handlers/intent.test.ts` under a `describe('objectBasePath TABL subtypes', ...)` block: `objectBasePath('TABL')` returns `/sap/bc/adt/ddic/tables/`; `objectBasePath('TABL/DT')` returns `/sap/bc/adt/ddic/tables/`; `objectBasePath('TABL/DS')` returns `/sap/bc/adt/ddic/structures/`; `objectUrlForType('TABL/DS', 'ZSTR')` returns `/sap/bc/adt/ddic/structures/ZSTR`. If `objectBasePath` is not exported, either export it (preferred — small one-line change) or test it indirectly via `objectUrlForType`.
- [x] Run `npm test` — all tests must pass

### Task 4: Branch `buildCreateXml` on TABL subtype

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

`buildCreateXml` at line ~2813 emits `adtcore:type="TABL/DT"` literally for any TABL create — meaning even when the user wants a structure, the body says "transparent table". Add subtype-aware emission.

- [x] In `src/handlers/intent.ts`, find `buildCreateXml` and locate `case 'TABL':` at line ~2813-2825. Add a new case ABOVE or BELOW for `case 'TABL/DS':` that emits the same `<blue:blueSource>` envelope but with `adtcore:type="TABL/DS"` instead of `adtcore:type="TABL/DT"`. The namespace (`xmlns:blue="http://www.sap.com/wbobj/blue"`), all other adtcore attributes (description, name, masterLanguage, masterSystem, responsible), and the `<adtcore:packageRef>` child are identical. Optionally extract a small helper `function buildTablBlueSource(adtcoreType: 'TABL/DT' | 'TABL/DS', name, pkg, description)` to dedup the two cases — your call, both are fine.
- [x] Add a `case 'TABL/DT':` that falls through to (or replicates) the existing `case 'TABL':` body — explicit subtype form is equivalent to bare TABL today (`adtcore:type="TABL/DT"`).
- [x] Keep `case 'TABL':` as-is (bare = TABL/DT for backward compat). Add an inline comment on the existing case clarifying "Bare TABL is the legacy alias — defaults to transparent table (TABL/DT). For explicit structure creates use the slash form 'TABL/DS' below."
- [x] Add unit tests (~4 tests) in `tests/unit/handlers/intent.test.ts` under a `describe('buildCreateXml TABL subtypes', ...)` block (or extend an existing buildCreateXml test): bare TABL emits `adtcore:type="TABL/DT"`; TABL/DT emits `adtcore:type="TABL/DT"`; TABL/DS emits `adtcore:type="TABL/DS"`; all three use the `<blue:blueSource xmlns:blue="http://www.sap.com/wbobj/blue">` envelope.
- [x] Run `npm test` — all tests must pass

### Task 5: Scope PR #286 discovery gate to bare TABL + TABL/DT (not TABL/DS)

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

The PR #286 discovery gate at line ~3500-3504 (`SAPWrite create` else-branch) and the analogous batch_create gate at line ~4587-4596 currently refuse `type === 'TABL'` when `/sap/bc/adt/ddic/tables` is missing from discovery. With Task 1's enum extension, the new explicit `TABL/DT` should ALSO be refused (it explicitly asks for the missing endpoint), but `TABL/DS` must NOT — `/sap/bc/adt/ddic/structures` exists on every ADT release including NW 7.50, so structure creates should work.

- [x] In `src/handlers/intent.ts`, find the create-path discovery guard at line ~3500-3504. Change the condition from `if (type === 'TABL' && (action === 'create' || action === 'batch_create'))` to `if ((type === 'TABL' || type === 'TABL/DT') && (action === 'create' || action === 'batch_create'))`. Update the inline comment to mention the TABL/DT explicit form. (TABL/DS deliberately falls through to the no-refusal path because `/structures/` is always available.)
- [x] In `src/handlers/intent.ts`, find the batch_create per-entry guard at line ~4587-4596 (`if (objType === 'TABL' && isTablesEndpointAvailable() === false) { ... }`). Update to `if ((objType === 'TABL' || objType === 'TABL/DT') && isTablesEndpointAvailable() === false) { ... }`. Same reasoning.
- [x] Add unit tests (~4 tests) in `tests/unit/handlers/intent.test.ts` under a `describe('SAPWrite create discovery gate per TABL subtype', ...)` block. Each test uses `setCachedFeatures({ ..., discoveryMap: new Map([['/sap/bc/adt/ddic/structures', ['application/*']]]) } as ResolvedFeatures)` in try/finally with `resetCachedFeatures()` cleanup:
  - `refuses TABL create on NW 7.50` (discovery lacks /tables) — bare TABL still refused with SE11 hint
  - `refuses TABL/DT create on NW 7.50` — explicit transparent-table form refused with SE11 hint
  - `allows TABL/DS create on NW 7.50` — discovery lacks /tables but advertises /structures, so structure create proceeds; assert the POST URL is `/sap/bc/adt/ddic/structures` (not `/tables`)
  - `batch_create: TABL/DS entry succeeds while TABL entry fails on NW 7.50` — mixed batch demonstrates per-entry guard semantics
- [x] Run `npm test` — all tests must pass

### Task 6: Integration test on a4h — Michael's namespaced-name scenario

**Files:**
- Modify: `tests/integration/adt.integration.test.ts`

Reproduce Michael's failure end-to-end against the live a4h S/4HANA 2023 test system and prove the fix works: create a Z-prefixed structure with a name longer than 16 chars (the transparent-table limit), assert success, then clean up via DELETE. The test must be hermetic — use a unique name and try/finally cleanup per `docs/testing-skip-policy.md`.

- [x] In `tests/integration/adt.integration.test.ts`, find the existing `describe('DDIC operations', ...)` block (around line 531) — the same area where PR #286's resolver-for-write tests live. After the PR #286 tests, add a new `describe('SAPWrite TABL/DS create (issue follow-up to #285)', ...)` block.
- [x] Test 1: `creates a DDIC structure via SAPWrite(type='TABL/DS') and routes POST to /sap/bc/adt/ddic/structures`. Use `generateUniqueName('ZSTR_ARC1')` (from `tests/integration/crud-harness.ts`) for collision safety. Wrap the create in try/finally; on success call `client.http.withStatefulSession(async (s) => { const l = await lockObject(s, client.safety, structUrl, 'MODIFY'); try { await deleteObject(s, client.safety, structUrl, l.lockHandle); } finally { await unlockObject(s, structUrl, l.lockHandle).catch(()=>{}); } })` as the cleanup. Assert the response: 201-equivalent success, plus `await client.http.get(structUrl)` succeeds before cleanup and 404s after.
- [x] Test 2: `reproduces the issue #285 follow-up: long Z-name structure that would have hit AD102 on the /tables/ endpoint succeeds via /structures/`. Use a 27-char Z-name like `'ZSTR_ARC1_LONG_NAMETEST_X'` — definitely exceeds the 16-char transparent-table limit but is a valid structure name. Same try/finally cleanup as Test 1. Assert no `/tables/` URL ever appears in the captured `mockFetch.mock.calls` — wait, this is an integration test, not unit; assert via direct curl after the fact that the object lives at `/sap/bc/adt/ddic/structures/<name>` (200) and `/sap/bc/adt/ddic/tables/<name>` (404).
- [x] Both tests tag transient objects with `// best-effort-cleanup` on the unlock comment, per `docs/testing-skip-policy.md`.
- [x] Run `npm run test:integration -- -t "TABL/DS create"` — both new tests pass against a4h (`TEST_SAP_URL=http://a4h.marianzeis.de:50000`, credentials per `INFRASTRUCTURE.md`).

### Task 7: Update tool description in `tools.ts`

**Files:**
- Modify: `src/handlers/tools.ts`

The SAPWrite tool JSON schema's `type` enum is what LLMs see. Make sure the new values are discoverable and well-documented.

- [x] In `src/handlers/tools.ts`, find the SAPWrite tool definition (search for `'SAPWrite'` and locate the `inputSchema.properties.type.enum`). Add `'TABL/DT'` and `'TABL/DS'` to the enum (mirroring the Zod schema). Update the `description` field for `type` to note: "Use 'TABL/DS' explicitly to create DDIC structures (otherwise 'TABL' and 'TABL/DT' default to transparent tables — and longer than 16-char names will fail with 'name too long')."
- [x] If the SAPWrite tool also has separate `objects[].type` enum for batch_create, mirror the addition there.
- [x] No new tests in this task (the tool schema is data, not logic). Verify with `npm run typecheck` that nothing breaks downstream.
- [x] Run `npm test` — full suite must still pass

### Task 8: Update docs (research note, CLAUDE.md, feature matrix)

**Files:**
- Modify: `research/abap-types/types/tabl.md`
- Modify: `CLAUDE.md`
- Modify: `compare/00-feature-matrix.md`

Document the create-path fix so future agents and human readers understand the TABL/DT vs TABL/DS distinction on writes.

- [x] In `research/abap-types/types/tabl.md`, add a new section `## TABL/DS create-path routing (post issue #285 follow-up)`. Document: the bug shape (Michael's `/LEOWM/SD_MON_S_WHO` 422 AD102 reproduction), the live evidence captured on a4h (both endpoints exist, same `<blue:blueSource>` envelope, only adtcore:type + URL differ), the fix design (TABL/DT and TABL/DS preserved through SAPWrite normalization; `objectBasePath` + `buildCreateXml` branch on subtype; PR #286 discovery gate scoped to bare TABL + TABL/DT), and the bonus benefit (TABL/DS create now works on NW 7.50 too since `/structures/` exists there).
- [x] In `CLAUDE.md`, find the "Key Files for Common Tasks" table. Add a new row: `Add TABL/DS create routing (Michael's report — #285 follow-up) | src/handlers/intent.ts (preserve TABL/DT and TABL/DS through normalizeTypeArgsForValidation for SAPWrite; objectBasePath cases for both slash forms; buildCreateXml branches on subtype; PR #286 discovery gate scoped to bare TABL + TABL/DT). src/handlers/schemas.ts (SAPWRITE_TYPES_ONPREM enum). src/handlers/tools.ts (SAPWrite type enum + description). Tests in tests/unit/handlers/{schemas,intent}.test.ts and tests/integration/adt.integration.test.ts.`
- [x] In `compare/00-feature-matrix.md`, find the `| Table write (TABL) |` row around line 165. Update the ARC-1 cell to also note TABL/DS create support: `✅ (TABL/DT transparent tables + TABL/DS structures; bare TABL defaults to TABL/DT for backward compat; transparent-table writes on NW 7.50/7.51 refused with SE11 hint per #285)`. Refresh the file's "Last Updated" header to today's date.
- [x] No automated test for documentation changes; verify by reading the diffs.
- [x] Run `npm test` — all tests must still pass (no code changed in this task)

### Task 9: Final verification

- [x] Run full unit suite: `npm test` — all tests pass (count goes up by ~17 from the new tests in tasks 1-5)
- [x] Run typecheck: `npm run typecheck` — no errors
- [x] Run lint: `npm run lint` — no errors (Biome's pre-commit hook will auto-fix formatting; never manually format)
- [x] Run integration tests: `npm run test:integration -- -t "TABL/DS create"` — new integration tests pass against a4h
- [x] Run the full DDIC integration block: `npm run test:integration -- -t "DDIC operations"` — all existing tests (PR #286's resolver tests, BAPIRET2/T000 reads, etc.) still pass
- [x] Smoke test the exact failing case Michael reported. Build (`npm run build`), then run a one-shot Node script that constructs an `AdtClient` against a4h with `safety.allowWrites=true` and calls the in-process equivalent of `SAPWrite(action='create', type='TABL/DS', name='ZSTR_SMOKE_<random>', package='$TMP', source='@EndUserText.label : ...\ndefine structure zstr_smoke_<random> { mandt : abap.clnt; }')`. Expect 201 Created and the resolved URL to be `/sap/bc/adt/ddic/structures/...`. Clean up via DELETE. The verification script is throwaway — do not commit it.
- [x] Move this plan to `docs/plans/completed/fix-tabl-ds-create-routing.md`
