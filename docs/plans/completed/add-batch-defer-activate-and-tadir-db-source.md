# Add `activateAtEnd` for SAPWrite batch_create and `source` mode for SAPSearch tadir_lookup

## Overview

Two opt-in fixes surfaced by the SEGW→RAP migration skill (Run 6) and confirmed by deep research against live a4h S/4HANA 2023:

1. **`SAPSearch(searchType="tadir_lookup")` split-brain** — the current implementation calls the ADT `informationsystem/search?operation=quickSearch` endpoint, which only returns workbench-resolvable objects. Orphan TADIR rows from aborted create/delete cycles (e.g. `ZR_DM_PRECHECK` ghost surviving after `SAPWrite delete`) remain invisible to `tadir_lookup` even though SQL `SELECT … FROM tadir` finds them. Add a new optional `source: 'adt' | 'db' | 'both'` parameter. Default `'adt'` preserves current behavior. `'db'` issues SQL via the existing freestyle-SQL path. `'both'` runs both and emits a `splitBrain` warning array listing names that diverged.

2. **`SAPWrite(action="batch_create")` activates each object inline** — for composition-linked DDLS (parent → child references via `composition [0..*] of ZR_X`), the per-object activation hits *"data source ZR_X does not exist or is not active"* on the parent before the child even exists. Workaround today is per-object `SAPWrite create` + terminal `SAPActivate` batch. Add a new optional `activateAtEnd: boolean` parameter (default `false`). When `true`, ARC-1 writes inactive drafts for every object then issues one terminal `activateBatch()` call. SAP's activator resolves the cross-references graph internally.

Both fixes are pure additions with backward-compatible defaults; existing tests pass unchanged. Together they remove the two micro-frictions Run 6 cataloged that didn't have an SAP-side workaround other than "ask the LLM to use a different sequence".

## Context

### Current State

**`SAPSearch.tadir_lookup`** lives at `src/handlers/intent.ts:1853` and routes to `src/adt/client.ts:586` (`lookupObjects`). The latter issues one `GET /sap/bc/adt/repository/informationsystem/search?operation=quickSearch&query=NAME&maxResults=N[&objectType=T]` per name, parses `<adtcore:objectReference>` entries from the response, and filters client-side for exact-name match. The ADT info-system runtime explicitly filters out any TADIR row that doesn't resolve to a live workbench resource — so ghost rows (TADIR entry exists, source/handler does not) are invisible by design. There is no flag on the endpoint that returns ghosts.

**`SAPWrite.batch_create`** lives at `src/handlers/intent.ts:4253–4550`. The per-object loop does: create → lock → write source → unlock → **single-object `activate(http, safety, objUrl)`** at line 4482 → cache invalidation per object. SAP's single-object activator at `/sap/bc/adt/activation?method=activate&preauditRequested=true` resolves only the one object in its payload; cross-references to other inactive siblings in the same batch are unresolved, hence the composition cycle fails.

By contrast, `src/adt/devtools.ts:193` `activateBatch` POSTs many `<adtcore:objectReference>` elements in one body. SAP's activator sees the whole graph and resolves cross-references between siblings correctly — verified live on a4h with parent-first ordering.

`src/handlers/intent.ts case 'create'` (line 3548) and `case 'update'` (line 3837) **never auto-activate**. Only `batch_create` does, and that's the asymmetry this plan removes via an opt-in flag.

### Target State

- `SAPSearch(searchType="tadir_lookup", source="adt")` — unchanged behavior. Default.
- `SAPSearch(searchType="tadir_lookup", source="db")` — issues SQL `SELECT pgmid, object, obj_name, devclass FROM tadir WHERE obj_name IN (...) [AND object IN (...)]` via the existing freestyle-SQL path. Returns the same JSON shape (`{count, lookups, missing}`) with each match tagged `_origin: 'db'`. Requires `sql` scope (admin must have `SAP_ALLOW_FREE_SQL=true` AND user must have the `sql` scope).
- `SAPSearch(searchType="tadir_lookup", source="both")` — runs both, merges results per name, adds `splitBrain: ['NAME1', ...]` warning array listing names where ADT and DB disagree, plus a `warnings: ['NAME1 exists in TADIR but ADT cannot resolve it (ghost)']` array.
- `SAPWrite(action="batch_create", activateAtEnd=true)` — skip the per-object `activate()` call. Accumulate `writtenObjects: Array<{type, name, url}>` for each successful create+source-write pair. After the loop, if `writtenObjects.length > 0`, issue one `activateBatch()` call. Map result back to per-object statuses using existing `buildBatchActivationStatuses` / `formatBatchActivationStatuses`. Move cache invalidation to after the terminal activate succeeds. Default `false` preserves today's per-object behavior.

### Key Files

| File | Role |
|------|------|
| `src/adt/client.ts` | ADT client facade — add `lookupObjectsViaDb` method that runs SQL TADIR lookup via existing `runQuery` |
| `src/adt/types.ts` | Type definitions — optionally extend `AdtObjectLookupResult` with `_origin` marker field |
| `src/handlers/intent.ts` | Tool dispatch — extend `handleSAPSearch` tadir_lookup branch (lines 1853–1872) for `source`; extend `case 'batch_create'` (lines 4253–4550) for `activateAtEnd` |
| `src/handlers/schemas.ts` | Zod input validation — add `source` to SAPSearch schemas; add `activateAtEnd` to SAPWrite schemas |
| `src/handlers/tools.ts` | JSON-Schema tool descriptors — document both new parameters |
| `src/authz/policy.ts` | Scope enforcement — add `SAPSearch.tadir_lookup_db` and `SAPSearch.tadir_lookup_both` entries requiring `sql` scope |
| `tests/unit/adt/client.test.ts` | Unit tests for the new `lookupObjectsViaDb` method |
| `tests/unit/handlers/intent.test.ts` | Unit tests for both handler changes |
| `tests/unit/handlers/schemas.test.ts` | Schema validation tests for new fields |
| `tests/unit/handlers/tools.test.ts` | Tool description tests |
| `tests/unit/authz/policy.test.ts` | Policy tests for new sql-scoped entries |
| `tests/integration/adt.integration.test.ts` | Live a4h tests for both features |
| `CLAUDE.md` | Project guidelines — Key Files table entries |
| `docs_page/tools.md` | Tool reference docs |
| `compare/00-feature-matrix.md` | Feature matrix update |
| `docs_page/roadmap.md` | Roadmap entry / completion |

### Design Principles

1. **Backward compatible by default.** Both new parameters default to today's behavior. Existing callers never see a difference. Existing tests untouched.

2. **Reuse existing infrastructure.** TADIR DB lookup reuses `runQuery` (which already chunks long IN-lists via `planSimpleInListChunking`) — no new freestyle-SQL endpoint logic. `activateAtEnd` reuses `activateBatch` (which already handles ED064 retry, dependency resolution, and audit emission) — no new activation logic.

3. **Scope discipline.** DB-mode TADIR lookup is gated by `sql` scope (same as `SAPQuery`). Default ADT-mode stays on `read` scope (broadest viewer audience). Server-level `SAP_ALLOW_FREE_SQL=false` blocks `'db'`/`'both'` exactly like it blocks `SAPQuery`.

4. **Defer-activate ≠ retry-activate.** When `activateAtEnd=true` and an early `create` fails, ARC-1 still breaks the loop. The terminal `activateBatch` runs only over the already-written subset, not the original input. Skipped objects stay skipped. Aligns with the existing `break`-on-first-failure semantics; only removes the "activate-each-as-you-go" coupling.

5. **One PR for two features.** Both fixes share the "opt-in flag with backward-compat default" shape, the same test files, and the same docs. Bundling reduces context-switching cost in review without coupling the implementations (each task is feature-scoped).

## Development Approach

- TDD discipline: every code task ships with its unit tests. Integration tests are a single dedicated task that exercises both features live.
- Foundation first: client-level DB lookup before handler wiring. Schema field before handler reads it. Policy entry before runtime scope check enforces it.
- Re-use the `_origin: 'adt' | 'db'` marker shape from the research report — don't invent a new field nomenclature.
- For `activateAtEnd`, keep FUNC group resolution upfront when staging `writtenObjects` — same pattern `handleSAPActivate` uses at lines 4904–4918. Avoid post-hoc URL resolution to keep the deferred path simple.
- Move cache invalidation (both `invalidateWrittenObject` and `cachingLayer.inactiveLists.invalidate`) to AFTER terminal activate succeeds. Don't invalidate before activation could itself fail and roll back the cache prematurely.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`

### Task 1: Add `lookupObjectsViaDb` client method (SQL-based TADIR lookup)

**Files:**
- Modify: `src/adt/client.ts`
- Modify: `src/adt/types.ts`
- Modify: `tests/unit/adt/client.test.ts`

Build the DB-backed alternative to `lookupObjects`. The new method issues a single SQL `SELECT … FROM tadir WHERE obj_name IN (…) [AND object IN (…)]` via the existing `runQuery` (which chunks long IN-lists automatically), parses each row back into the same `AdtObjectLookupResult` shape that `lookupObjects` returns, and stamps each match with `_origin: 'db'`. This is the foundation for Task 2 (handler wiring) and Task 3 (policy).

- [ ] In `src/adt/types.ts`: optionally extend the existing `AdtSearchResult` / `AdtObjectLookupResult` types with an optional `_origin?: 'adt' | 'db'` field (string union). Mark optional so existing callers compile unchanged.
- [ ] In `src/adt/client.ts`: add a new method `lookupObjectsViaDb(names: string[], opts?: { objectTypes?: string[]; maxResults?: number }): Promise<AdtObjectLookupResult[]>` immediately after the existing `lookupObjects` (around line 644). Implementation:
  - Validate `names.length > 0`; throw with a clear message otherwise.
  - Build SQL: `SELECT pgmid, object, obj_name, devclass FROM tadir WHERE obj_name IN ('A','B',…) [AND object IN ('DDLS','BDEF',…)]` — quote names; uppercase names before quoting (TADIR stores uppercase).
  - Call `this.runQuery(sql, { rowNumber: maxResults ?? 1000 })` — reuses the existing SQL chunking logic.
  - For each returned row, build an `AdtObjectLookupResult` with: `name` from `OBJ_NAME`, `found: true`, `matches: [{ objectType: row.OBJECT, objectName: row.OBJ_NAME, packageName: row.DEVCLASS, description: '', uri: objectUrlForType(row.OBJECT, row.OBJ_NAME), _origin: 'db' }]`. Use the existing `objectUrlForType` helper.
  - For names not returned by SQL, emit a record with `found: false`, `matches: []`.
  - Preserve input-order of names in the result array.
- [ ] Add JSDoc above the new method explaining: (a) why this exists (TADIR ghost detection), (b) when to use vs `lookupObjects` (DB sees ghosts; ADT route only sees workbench-resolvable objects), (c) the `sql` scope requirement.
- [ ] Add unit tests (~6 tests) in `tests/unit/adt/client.test.ts`:
  - Basic call with 3 names returns 3 results, all `found: true` with `_origin: 'db'`.
  - Call with `objectTypes: ['DDLS']` adds `AND object IN ('DDLS')` to the SQL.
  - Names not in TADIR appear as `found: false` in result order.
  - Empty names array throws a clear error.
  - SQL error from `runQuery` propagates (use `mockResponse` to simulate 4xx).
  - Uppercase normalization: lowercase input `['zfoo']` produces SQL `IN ('ZFOO')`.
  - Mock `undici` per the existing pattern in `tests/unit/adt/client.test.ts` (see existing `lookupObjects` tests around line 791–853 for the established structure).
- [ ] Run `npm test -- tests/unit/adt/client.test.ts` — all tests pass.
- [ ] Run `npm test` — full unit suite passes.

### Task 2: Wire `source` parameter through SAPSearch tadir_lookup

**Files:**
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/schemas.test.ts`
- Modify: `tests/unit/handlers/tools.test.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

Surface the new `source` parameter through the public tool schema, route the handler branch to the right client method, and add a merge layer for `source='both'` that emits the `splitBrain` warning.

- [ ] In `src/handlers/schemas.ts`: find `SAPSearchSchemaOnprem` and `SAPSearchSchemaBtp` (search for `searchType`). Add a new field `source: z.enum(['adt', 'db', 'both']).optional()` to both. Use `.describe(...)` to document.
- [ ] In `src/handlers/tools.ts`: find the matching JSON Schema definitions for SAPSearch (both onprem and btp variants). Add `source` property with the same enum and a description that mentions: default `'adt'` matches today's behavior; `'db'` sees TADIR ghosts but needs `sql` scope; `'both'` reports divergence via `splitBrain` array.
- [ ] In `src/handlers/intent.ts handleSAPSearch` `tadir_lookup` branch (lines 1853–1872): read `const source = (args.source as 'adt' | 'db' | 'both') ?? 'adt';`. Branch:
  - `'adt'`: existing `client.lookupObjects(...)` call, tag each match with `_origin: 'adt'`.
  - `'db'`: call the new `client.lookupObjectsViaDb(...)` (Task 1 already returns `_origin: 'db'`).
  - `'both'`: run both in parallel via `Promise.all`. Merge per name: for each input name, take all matches from both result sets, dedupe by `(objectType, objectName)` (case-insensitive on name). If a name has matches from one origin but not the other, add it to a `splitBrain: string[]` array. Compose a friendly `warnings: string[]` for each splitBrain name (e.g. `"<NAME> exists in TADIR (DB) but ADT cannot resolve it — likely a TADIR ghost from an aborted create/delete cycle. Consider RS_DD_TADIR_CLEANUP or manual SE03 cleanup."`).
- [ ] In the same branch, update the JSON response shape:
  - `count`, `lookups`, `missing` stay (existing fields).
  - Add `splitBrain: string[]` (only present when source='both' and there's at least one divergent name).
  - Add `warnings: string[]` (only present when splitBrain is non-empty).
- [ ] Add unit tests (~8 tests):
  - `tests/unit/handlers/schemas.test.ts`: `source` accepts `'adt'`/`'db'`/`'both'`; rejects other strings; missing `source` is fine.
  - `tests/unit/handlers/tools.test.ts`: JSON Schema for SAPSearch onprem + btp includes `source` enum with three values.
  - `tests/unit/handlers/intent.test.ts`: source='adt' default calls `lookupObjects` only; source='db' calls `lookupObjectsViaDb` only; source='both' calls both and merges; source='both' detects splitBrain when ADT has zero matches but DB has matches; source='both' has no splitBrain when both agree; response shape includes `_origin` per match.
- [ ] Run `npm test -- tests/unit/handlers/` — all handler tests pass.
- [ ] Run `npm test` — full suite passes.

### Task 3: Add policy enforcement for sql-scoped tadir_lookup variants

**Files:**
- Modify: `src/authz/policy.ts`
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/authz/policy.test.ts`

Stamp `'db'` and `'both'` sources with the `sql` scope so viewer-only profiles can't escalate to free-SQL by piggybacking on `tadir_lookup`. Existing `SAPQuery` already uses this pattern; mirror it.

- [ ] In `src/authz/policy.ts`: find `ACTION_POLICY` (around line 33). Add two new entries:
  - `'SAPSearch.tadir_lookup_db': { scope: 'sql', opType: OperationType.FreeSQL }`
  - `'SAPSearch.tadir_lookup_both': { scope: 'sql', opType: OperationType.FreeSQL }`
- [ ] In `src/handlers/intent.ts handleSAPSearch`: when `searchType === 'tadir_lookup'` and `source !== 'adt'`, synthesize the policy lookup key as `\`SAPSearch.tadir_lookup_${source}\``. Plumb this through the existing scope check (search for where `getActionPolicy` or `requireScope` is called in `handleSAPSearch`). The default key for `'adt'` (or `tadir_lookup` without `source`) remains the existing `'SAPSearch'` entry (scope `'read'`).
- [ ] Also check `safety.ts` at the operation layer: `OperationType.FreeSQL` requires `allowFreeSQL=true` — the existing `checkOperation` enforcement automatically applies. Confirm by inspection; no new code needed if the existing path covers it.
- [ ] Add unit tests (~4 tests) in `tests/unit/authz/policy.test.ts`:
  - `SAPSearch.tadir_lookup_db` requires `sql` scope.
  - `SAPSearch.tadir_lookup_both` requires `sql` scope.
  - `SAPSearch` (no key suffix) requires only `read`.
  - Calling `tadir_lookup` with `source='db'` against a viewer scope throws a clear error referencing missing `sql` scope.
- [ ] Run `npm test -- tests/unit/authz/` — policy tests pass.
- [ ] Run `npm test` — full suite passes.

### Task 4: Add `activateAtEnd` parameter to SAPWrite batch_create

**Files:**
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/schemas.test.ts`
- Modify: `tests/unit/handlers/tools.test.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

Implement the deferred-activation path. Default behavior unchanged; new `activateAtEnd: true` flag flips to terminal batch-activate.

- [ ] In `src/handlers/schemas.ts`: locate `SAPWriteSchemaOnprem` and `SAPWriteSchemaBtp`. Add `activateAtEnd: z.coerce.boolean().optional()` to both, alongside the existing top-level `activate` flag (which is reserved for `generate_behavior_implementation` — do not repurpose it). Document the field as: applies only to `action='batch_create'`; defaults to `false` (per-object inline activation); when `true`, ARC-1 writes inactive drafts for every object then issues one terminal batch-activate. Use case: composition-linked DDLS / interdependent BDEF graphs.
- [ ] In `src/handlers/tools.ts`: add `activateAtEnd` to the JSON Schema for both onprem and btp variants. Description should explicitly note the composition-stack use case and warn it does nothing when `action !== 'batch_create'`.
- [ ] In `src/handlers/intent.ts case 'batch_create'` (lines 4253–4550):
  - Near the top of the case, read `const activateAtEnd = args.activateAtEnd === true || String(args.activateAtEnd) === 'true';` — same coerce pattern existing flags use.
  - Initialize `const writtenObjects: Array<{ type: string; name: string; url: string }> = [];` before the per-object `for` loop.
  - In the loop, AFTER the `safeUpdateSource` call (around line 4479) and BEFORE the `activate(...)` call (line 4482), compute `objUrl` (it's already in scope from earlier in the loop iteration) and the activation-ready record. For FUNC entries, resolve the group URL using the same pattern `handleSAPActivate` uses at lines 4904–4918 — extract this into a small helper if it's cleaner. For TABL entries, the URL is the one already used by `createObject` / `safeUpdateSource`. Push the record into `writtenObjects` only on the success path (after source write succeeded).
  - Wrap the existing `activate(...)` block (line 4482 through the `invalidateWrittenObject` call at line 4494) with `if (!activateAtEnd) { /* existing inline activation */ }`. When `activateAtEnd=true`, the loop iteration ends after pushing into `writtenObjects` — no inline activation, no per-object cache invalidation.
  - After the loop terminates (success or partial failure via `break`), if `activateAtEnd && writtenObjects.length > 0`:
    - Call `activateBatch(client.http, client.safety, writtenObjects)`.
    - Capture the result. If `success: true`: for each entry in `writtenObjects`, find the matching record in `results` and ensure it's marked `status: 'success'` (write-phase already did so; this is defensive). Invalidate caches once: loop over `writtenObjects` calling `invalidateWrittenObject(o.type, o.name)`, then call `cachingLayer.inactiveLists.invalidate(client.username)` once.
    - If `success: false`: use the existing `buildBatchActivationStatuses` / `formatBatchActivationStatuses` helpers (search for them in `intent.ts` around line 4928) to map per-object errors. Flip those entries' status to `'failed'` with the activation error message; preserve the original "create + write succeeded" context in the message (`"3/3 written, batch activation failed: <details>"`).
  - Update the final summary line emitted at the end of the case to reflect "batch-activate at end" mode: e.g. `"Batch created N/M objects in package X; activated as a single batch."`
- [ ] Add unit tests (~6 tests) in `tests/unit/handlers/intent.test.ts`:
  - `batch_create with activateAtEnd=false` (default): existing inline-activate behavior; mock asserts one activation POST per object.
  - `batch_create with activateAtEnd=true and 3 successful objects`: mock asserts ZERO per-object activation POSTs, exactly ONE batch-activate POST with 3 `<adtcore:objectReference>` elements in body.
  - `batch_create with activateAtEnd=true and write-phase failure on 2nd object`: loop breaks; terminal `activateBatch` is called with ONLY the 1st object (which was written); 2nd is `'failed'`, 3rd is `'skipped'`.
  - `batch_create with activateAtEnd=true and terminal batch activate fails`: all 3 writes succeed; `activateBatch` returns `success: false`; all 3 entries flipped to `'failed'` with the activation error appended; the create-write success context is preserved.
  - `batch_create with activateAtEnd=true and FUNC entry`: FUNC group URL resolution happens at staging time; the batch-activate body contains the resolved FUNC URL, not a "needs group" placeholder.
  - `batch_create with activateAtEnd=true caches invalidated AFTER terminal activate`: assert `invalidateWrittenObject` is called for each written object only after `activateBatch` returns success.
- [ ] Add a schema test (~2 tests) in `tests/unit/handlers/schemas.test.ts`: `activateAtEnd` accepts `true`/`false`/`"true"`/`"false"` (z.coerce); rejects strings like `"yes"`/`"1"`/numbers other than boolean coercibles.
- [ ] Add a tools test (~2 tests) in `tests/unit/handlers/tools.test.ts`: `activateAtEnd` exists in both SAPWrite onprem and btp tool schemas with type `boolean` and a non-empty description.
- [ ] Run `npm test -- tests/unit/handlers/` — all handler tests pass.
- [ ] Run `npm test` — full suite passes.

### Task 5: Integration tests on live SAP system

**Files:**
- Modify: `tests/integration/adt.integration.test.ts`

Verify both features end-to-end against a live SAP system. Tests must follow the existing skip-policy patterns (no silent skips, no empty catches).

- [ ] Add a new `describe('SAPSearch tadir_lookup source variants', ...)` block:
  - One test creates a Z DDLS view in `$TMP` (use `generateUniqueName('ZRES_TADIR_')`), then queries via `source='adt'`, `source='db'`, and `source='both'`. All three should find the object (no splitBrain). Cleanup in `finally` block with `// best-effort-cleanup` comment.
  - One test reads through the same lookup variants after deleting the object. Asserts the response shape: `found: false` consistently when both sources agree, or `splitBrain` populated when ghost is detected. Either outcome counts as a passing test — the assertion is on shape and consistency, not on the presence of a ghost (system-dependent).
  - Use `requireOrSkip(ctx, env.TEST_SAP_URL, 'TEST_SAP_URL')` and the existing `getTestClient()` factory from `tests/integration/helpers.ts`.
- [ ] Add a new `describe('SAPWrite batch_create activateAtEnd', ...)` block:
  - One test creates two composition-linked DDLS views in `$TMP` via `batch_create(activateAtEnd=false)` (default). Asserts it fails with the well-known *"data source <child> does not exist or is not active"* error using `expectSapFailureClass(err, [...], [/does not exist or is not active/])` from `tests/helpers/expected-error.ts`. Cleanup any objects that did get written. **This test documents the failure mode** — it doesn't catch a regression unless someone changes the default behavior.
  - One test creates the same two composition-linked DDLS views in `$TMP` via `batch_create(activateAtEnd=true)`. Asserts both objects are active afterwards (read each via `SAPRead`, expect 200 + active source). Cleanup both via `SAPWrite delete` in `finally`.
- [ ] Run `npm run test:integration` — both new test blocks pass when SAP creds available; skip cleanly otherwise.
- [ ] Run `npm test` — unit suite still passes (no regression).

### Task 6: Documentation updates

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs_page/tools.md`
- Modify: `compare/00-feature-matrix.md`
- Modify: `docs_page/roadmap.md`

Sync the user-facing and AI-assistant-facing docs with the two new parameters.

- [ ] In `CLAUDE.md`: locate the "Key Files for Common Tasks" table. Add two new rows:
  - `Add SAPSearch tadir_lookup source variants (adt/db/both)` → `src/handlers/intent.ts`, `src/handlers/schemas.ts`, `src/handlers/tools.ts`, `src/adt/client.ts` (`lookupObjectsViaDb`), `src/authz/policy.ts` (sql-scoped variants), tests under `tests/unit/{handlers,adt,authz}/`.
  - `Add SAPWrite batch_create activateAtEnd` → `src/handlers/intent.ts` (`case 'batch_create'`), `src/handlers/schemas.ts`, `src/handlers/tools.ts`, tests in `tests/unit/handlers/intent.test.ts`.
- [ ] In `CLAUDE.md` "Code Patterns" section: optionally add a one-line note about the deferred-activation pattern: "For interdependent objects in `batch_create`, prefer `activateAtEnd: true` so SAP's activator resolves cross-references in one pass."
- [ ] In `docs_page/tools.md`: locate the SAPSearch section. Add a subsection or table documenting `searchType="tadir_lookup"` and the `source` parameter with the three values, the `_origin` field on matches, the `splitBrain` and `warnings` arrays, and the `sql` scope requirement for `'db'`/`'both'`. Locate the SAPWrite section. Add a subsection for the `activateAtEnd` flag explaining the composition-stack use case and the partial-failure semantics.
- [ ] In `compare/00-feature-matrix.md`: update or add rows for "TADIR DB-mode lookup" and "Batch-create deferred activation". Refresh the "Last Updated" date at the top.
- [ ] In `docs_page/roadmap.md`: if there's an existing roadmap entry mentioning either feature, mark it completed with a date. Otherwise add a one-line entry under "Recent additions" or similar section.
- [ ] Read all skill files in `.claude/commands/*.md` and check for any that should mention the new capabilities. In particular:
  - `migrate-custom-code.md` — could mention `tadir_lookup source='both'` as a cleanup-verification step.
  - `generate-rap-service.md` and `generate-rap-service-researched.md` — could mention `batch_create activateAtEnd=true` for the composition CDS layer.
  - Update each affected skill with a one-line pointer at the relevant phase. Do not rewrite skills wholesale.
- [ ] Run `npm test` — confirm no doc-related test breaks (unlikely but cheap to verify).

### Task 7: Final verification

**Files:** none modified in this task.

Top-to-bottom validation of the whole plan, then promote.

- [ ] Run `npm test` — full unit suite passes (target: ~2700+ tests, no failures).
- [ ] Run `npm run typecheck` — no errors.
- [ ] Run `npm run lint` — no errors.
- [ ] Run `npm run build` — clean dist build.
- [ ] If SAP credentials are available locally: run `npm run test:integration` — Task 5's new integration tests pass.
- [ ] Manual smoke against a4h (if available): `cd /Users/marianzeis/DEV/arc-1 && node dist/cli.js call SAPSearch --json '{"searchType":"tadir_lookup","names":["ZR_DM_PRECHECK"],"source":"both"}'` — confirms split-brain reporting. `node dist/cli.js call SAPWrite --json '{"action":"batch_create","activateAtEnd":true,"package":"$TMP","objects":[{...},{...}]}'` — confirms deferred-activate path.
- [ ] Confirm Git status is clean (no stray files): all new code is in committed files; tests/ structure is preserved.
- [ ] Move this plan to `docs/plans/completed/add-batch-defer-activate-and-tadir-db-source.md`.
