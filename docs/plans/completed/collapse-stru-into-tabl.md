# Collapse STRU type into TABL (Model B)

## Overview

DDIC structures and transparent tables share one parent in TADIR: `R3TR TABL` (distinguished only by `DD02L-TABCLASS = TRANSP` for transparent tables vs `INTTAB`/`APPEND` for structures). ADT's slash subtypes reflect the same legacy: `TABL/DT` for transparent tables, `TABL/DS` for structures. Independent ABAP tooling (abapGit, sap/abap-file-formats) follows the same convention — there is no separate `STRU` object type; structures are handled under `TABL` and disambiguated by `TABCLASS`.

ARC-1 currently maintains a fictional `STRU` short type and a hardcoded `STRU/DS` slash mapping that no SAP system actually returns. The mapping is dead code; the user-visible duality (`STRU` vs `TABL`) is misleading; and the `STRU` write path silently falls through to a broken generic envelope. GitHub issue [#218](https://github.com/marianfoo/arc-1/issues/218) reports this from external observation.

This plan collapses `STRU` into `TABL` to match abapGit and SAP file-format conventions. ARC-1 ships pre-1.0, so this is an outright breaking change — no `STRU` alias is preserved at the public API level (only an internal slash-type alias for back-compat with any LLM-stored prompts that learned the old form).

Key design decisions:
1. **Single user-facing type `TABL`** covers both transparent tables and DDIC structures.
2. **Internal URL resolution** tries `/sap/bc/adt/ddic/tables/{name}` first, falls back to `/sap/bc/adt/ddic/structures/{name}` on 404. Verified on S/4HANA 2023 against `T000` (transparent) and `BAPIRET2` (structure).
3. **Source cache stores the resolved URL kind** alongside source/etag, so warm reads go straight to the right URL with one HTTP round trip.
4. **`SLASH_TYPE_MAP`** maps `TABL/DT → TABL` and `TABL/DS → TABL`; `STRU/DS` and `STRU` are kept only as legacy aliases that map to `TABL` (so old prompts don't 404 immediately).
5. **CDS-impact bucketing** keeps a single `tables` bucket — the parent type is identical, splitting buckets has no informational value.
6. **Search results preserve ADT's slash form** in `objectType` (`TABL/DT` vs `TABL/DS`) — no normalization there. `mainObjectType()` returns `TABL` for both.

## Context

### Current State

- [src/handlers/schemas.ts:33](src/handlers/schemas.ts:33), [:69](src/handlers/schemas.ts:69) — `SAPRead` enums include `STRU`.
- [src/handlers/tools.ts:54](src/handlers/tools.ts:54), [:91](src/handlers/tools.ts:91), [:106](src/handlers/tools.ts:106), [:110](src/handlers/tools.ts:110), [:443](src/handlers/tools.ts:443), [:444](src/handlers/tools.ts:444) — tool descriptions list `STRU` separately.
- [src/handlers/intent.ts:1260](src/handlers/intent.ts:1260) — `STRU` in `VERSIONED_SOURCE_READ_TYPES`.
- [src/handlers/intent.ts:1557-1562](src/handlers/intent.ts:1557) — `case 'STRU'` calls `client.getStructure()`.
- [src/handlers/intent.ts:1774](src/handlers/intent.ts:1774) — error message lists `STRU`.
- [src/handlers/intent.ts:2572](src/handlers/intent.ts:2572) — `SLASH_TYPE_MAP` has fictional `'STRU/DS': 'STRU'`.
- [src/handlers/intent.ts:2684-2685](src/handlers/intent.ts:2684) — `objectBasePath` returns `/sap/bc/adt/ddic/structures/` for `STRU`.
- [src/handlers/intent.ts:645-647](src/handlers/intent.ts:645) — `mainObjectType` strips slash without consulting the map.
- [src/handlers/intent.ts:294](src/handlers/intent.ts:294), [:295-308](src/handlers/intent.ts:295) — `CDS_ORDERABLE_TYPES`, `CDS_IMPACT_WHERE_USED_TYPES` include `TABL` only (not `STRU`).
- [src/adt/client.ts:339-354](src/adt/client.ts:339) — `getTable()` and `getStructure()` are separate methods.
- [src/context/compressor.ts:443-460](src/context/compressor.ts:443) — CDS dep fallback chain `DDLS → TABL → STRU`.
- [src/probe/catalog.ts:96-101](src/probe/catalog.ts:96) — separate STRU probe entry.
- Live evidence (S/4HANA 2023): `GET /sap/bc/adt/ddic/tables/BAPIRET2/source/main` → 404. `GET /sap/bc/adt/ddic/structures/BAPIRET2/source/main` → 200. `GET /sap/bc/adt/ddic/tables/T000/source/main` → 200. So `/tables/` is restricted to transparent tables; `/structures/` works for structures. The two-URL-try strategy works.

### Target State

- One user-facing type `TABL` for transparent tables AND DDIC structures.
- `SAPRead(type='TABL', name='BAPIRET2')` returns the structure source (CDS-like format with `@AbapCatalog.tableCategory : #TRANSPARENT` for tables and structure annotations for structures).
- `SAPRead(type='STRU', ...)` returns a clear validation error from the Zod schema with a hint to use `TABL`.
- ADT's slash types `TABL/DS` and `STRU/DS` (legacy) both normalize to `TABL` via `SLASH_TYPE_MAP`.
- `client.getTabl(name, opts)` is the single read entry point; tries `/tables/` then `/structures/`; caches the resolved URL.
- Cache key remains `('TABL', name)` — kind is not part of the cache key (TADIR uniqueness guarantees no collision).
- The CDS dep fallback chain in compressor is `DDLS → TABL` (one TABL method handles both).
- The probe catalog has one `TABL` probe with two known objects: a transparent table and a structure.
- All references to `STRU` in docs (`docs_page/`, `CLAUDE.md`, `compare/00-feature-matrix.md`, `tests/evals/`, `README.md` if any) are removed.
- All STRU-using tests are updated to use TABL with a structure name (e.g. `BAPIRET2`) and assert the source content, not the path.

### Key Files

| File | Role |
|------|------|
| `src/adt/client.ts` | ADT client: add `getTabl(name, opts)`; keep `getTable`/`getStructure` as private/deprecated. |
| `src/handlers/intent.ts` | SAPRead/Write/Activate handlers: drop STRU case, route TABL through getTabl(). Update SLASH_TYPE_MAP, mainObjectType, objectBasePath, VERSIONED_SOURCE_READ_TYPES, CDS_IMPACT_WHERE_USED_TYPES. |
| `src/handlers/schemas.ts` | Zod enum: drop `STRU` from SAPREAD_TYPES_ONPREM/BTP, SAPWRITE_TYPES_ONPREM/BTP. |
| `src/handlers/tools.ts` | Tool description text and supported-types arrays: drop STRU. |
| `src/context/compressor.ts` | CDS dep fallback chain: `DDLS → TABL` (TABL handles both transparent and structure now). |
| `src/probe/catalog.ts` | Drop STRU entry; extend TABL entry with structure known-object. |
| `src/cache/caching-layer.ts` | Cache value optionally stores resolved URL kind for fast warm reads (optional optimization). |
| `tests/unit/handlers/intent.test.ts` | Update STRU tests at lines 577, 985, 3791, 5699, 7693 to use TABL; add tests for /tables/→/structures/ fallback and SLASH_TYPE_MAP. |
| `tests/e2e/smoke.e2e.test.ts` | Update `SAPRead STRU` test (line 109) to `SAPRead TABL` against BAPIRET2. |
| `tests/e2e/navigate.e2e.test.ts` | Update structure references tests (lines 186, 260) to use TABL. |
| `tests/evals/scenarios/read-basic.ts` | Update STRU eval scenario (lines 4, 87). |
| `tests/integration/adt.integration.test.ts` | Add integration test that reads BAPIRET2 via TABL on A4H. |
| `docs_page/tools.md` | Update SAPRead type table; drop STRU row, expand TABL description. |
| `docs_page/caching.md` | Drop STRU from DDIC list. |
| `docs_page/roadmap.md` | Update FEAT-04 status note (line 2223), feature matrix (line 2361), task note (line 1419). |
| `compare/00-feature-matrix.md` | Drop STRU mention (line 335). |
| `CLAUDE.md` | Update Key Files table and Handler Pattern example. |

### Design Principles

1. **No public alias for `STRU`.** Pre-1.0 means we take the breaking change cleanly. Schema rejects `STRU` with a Zod error. Slash form aliases (`STRU/DS`, `STRU`) live ONLY inside `SLASH_TYPE_MAP` so older LLM prompts that learned the slash form don't immediately 404 — they get normalized to `TABL`.
2. **Two-try URL resolution, no metadata pre-flight.** No SAPQuery/searchObject pre-call; just try `/tables/` first, fall back to `/structures/` on 404. Cache the resolved URL inside the source cache value.
3. **Cache key stays `('TABL', name)`.** TADIR uniqueness guarantees no collision between transparent table and structure of the same name (impossible — both share `R3TR TABL`).
4. **Existing low-level methods are kept.** `client.getTable()` and `client.getStructure()` remain; `client.getTabl()` is a thin orchestrator that calls them with fallback. This keeps unit-test mocking and probe-catalog logic working.
5. **STRU create stays unsupported.** Current STRU create path is broken (falls through to generic envelope SAP rejects). Model B drops STRU entirely; structure creation is out of scope for this plan and can be added later via `properties.tableClass='INTTAB'` on TABL create.
6. **Search results retain ADT slash form.** `parseSearchResults` returns `objectType: 'TABL/DT'` or `'TABL/DS'` unchanged. Downstream code that needs the parent type uses `mainObjectType()`.
7. **Backward-incompat on E2E inputs only.** `SAPRead(type='STRU', ...)` returns a Zod validation error with a hint. The fix is one keystroke for any caller.
8. **Tests must run live against A4H.** Integration and E2E tests verify the structure-via-TABL path end-to-end against the BAPIRET2 structure on the A4H S/4HANA 2023 system.

## Development Approach

- All work happens on the current worktree branch `claude/condescending-elgamal-d73cd0`.
- Order: foundation (URL resolver) → schemas (drop STRU) → handlers (route TABL) → tests (unit + integration + E2E) → docs.
- Mock pattern: `vi.mock('undici', ...)` + `mockResponse()` for unit tests. The /tables/→/structures/ fallback test must mock both responses in sequence.
- Integration tests use `getTestClient()` from `tests/integration/helpers.ts`; require A4H credentials in `TEST_SAP_*` env vars.
- E2E tests use `connectClient()`/`callTool()` from `tests/e2e/helpers.ts`; require running MCP server.
- Live verification reference: `BAPIRET2` is a structure on A4H, `T000` is a transparent table. Both are SAP-shipped, present on every release.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run test:integration` (requires `TEST_SAP_URL`)
- `npm run test:e2e` (requires running MCP server)

### Task 1: Add `client.getTabl()` URL resolver with structures fallback

**Files:**
- Modify: `src/adt/client.ts`
- Modify: `tests/unit/adt/client.test.ts`

Add a unified TABL read method that tries the `/sap/bc/adt/ddic/tables/{name}/source/main` endpoint first, falls back to `/sap/bc/adt/ddic/structures/{name}/source/main` on 404. Cache the resolved URL on the client for later write/activate URL resolution (Task 4a). Keep the existing `getTable()` and `getStructure()` methods as the low-level building blocks (`getTabl()` calls them internally — easier to unit-test the fallback).

- [ ] In [src/adt/client.ts](src/adt/client.ts), add a private instance field on `AdtClient`:
  ```ts
  /** Per-client cache of resolved TABL URLs (transparent table vs structure).
   *  Populated by getTabl() so subsequent write/activate flows skip the 404 retry. */
  private readonly tablUrlCache = new Map<string, string>();
  ```
- [ ] In [src/adt/client.ts](src/adt/client.ts), add a new method right after `getStructure()`:
  ```ts
  /** Read TABL source (transparent table or DDIC structure).
   *  Tries /sap/bc/adt/ddic/tables/ first; on 404 falls back to /sap/bc/adt/ddic/structures/.
   *  Both share TADIR R3TR TABL — distinguished only by DD02L-TABCLASS. */
  async getTabl(name: string, opts?: SourceReadOptions): Promise<SourceReadResult> {
    checkOperation(this.safety, OperationType.Read, 'GetTabl');
    const upper = name.toUpperCase();
    try {
      const result = await this.getTable(name, opts);
      this.tablUrlCache.set(upper, `/sap/bc/adt/ddic/tables/${encodeURIComponent(name)}`);
      return result;
    } catch (err) {
      if (err instanceof AdtApiError && err.statusCode === 404) {
        const result = await this.getStructure(name, opts);
        this.tablUrlCache.set(upper, `/sap/bc/adt/ddic/structures/${encodeURIComponent(name)}`);
        return result;
      }
      throw err;
    }
  }
  ```
- [ ] Confirm `AdtApiError` is imported in `client.ts` (it should already be via `errors.js`).
- [ ] Add unit tests (~4 tests) in [tests/unit/adt/client.test.ts](tests/unit/adt/client.test.ts):
  - `getTabl('T000')` calls `/tables/T000/source/main` and returns source on 200.
  - `getTabl('BAPIRET2')` calls `/tables/BAPIRET2/source/main` (404), then `/structures/BAPIRET2/source/main` (200), returns structure source.
  - `getTabl('NONEXISTENT')` calls both URLs (both 404), surfaces the second 404 as `AdtApiError`.
  - `getTabl(name)` re-throws non-404 errors from `/tables/` (e.g. 500) without falling back.
- [ ] Run `npm test` — all tests must pass.

### Task 2: Drop STRU from Zod schemas

**Files:**
- Modify: `src/handlers/schemas.ts`
- Modify: `tests/unit/handlers/intent.test.ts` (add new schema test)
- Modify: `tests/unit/handlers/schemas.test.ts` if it pins enum membership

Remove `STRU` from `SAPREAD_TYPES_ONPREM`, `SAPREAD_TYPES_BTP`, and any other enum that lists it. The Zod-emitted error message will list valid types (no `STRU`), giving callers a clear hint.

- [ ] In [src/handlers/schemas.ts:33](src/handlers/schemas.ts:33), remove `'STRU',` from `SAPREAD_TYPES_ONPREM`.
- [ ] In [src/handlers/schemas.ts:69](src/handlers/schemas.ts:69), remove `'STRU',` from `SAPREAD_TYPES_BTP`.
- [ ] Verify that `SAPWRITE_TYPES_ONPREM` and `SAPWRITE_TYPES_BTP` (lines 219-251) do NOT contain `STRU` (they shouldn't — `STRU` was never a write target).
- [ ] In [tests/unit/handlers/intent.test.ts](tests/unit/handlers/intent.test.ts):
  - Update test at line 985 — change `expect(...).toContain('STRU')` to `expect(...).toContain('TABL')` (or just remove that line; the test already covers PROG/CLAS/etc.).
  - Add a new test case verifying `SAPRead(type='STRU', name='X')` returns a Zod validation error message that mentions `TABL`. The intent: the error path is observable, not silent.
- [ ] Run `npm test` — all tests must pass; pre-existing STRU SAPRead unit tests at lines 577 and 5699 will fail; that is expected and addressed in Task 4.

### Task 3: Update SLASH_TYPE_MAP, mainObjectType, objectBasePath

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

Fix the slash-type normalization so ADT's real slash forms map to `TABL` and so `mainObjectType()` agrees. Also drop the `STRU` branch from `objectBasePath()`.

- [ ] At [src/handlers/intent.ts:2556-2580](src/handlers/intent.ts:2556) in `SLASH_TYPE_MAP`:
  - Change `'STRU/DS': 'STRU',` to `'TABL/DS': 'TABL',`.
  - Add a back-compat alias entry on the next line: `'STRU/DS': 'TABL',` (legacy: ADT never sent this; keep it only so any persistent prompt or downstream tool that learned the old form still routes correctly).
  - Add another back-compat alias: `'STRU': 'TABL',` (legacy short type — same reason; new schema rejects it before reaching this map, but `mainObjectType()` may still see it from external sources).
  - Add a one-line comment above these three lines: `// DDIC structures: ADT slash subtype is TABL/DS — they share R3TR TABL with transparent tables (TABL/DT).`
- [ ] At [src/handlers/intent.ts:645-647](src/handlers/intent.ts:645), rewrite `mainObjectType` to consult the slash-type map:
  ```ts
  function mainObjectType(type: string): string {
    return normalizeObjectType(type);
  }
  ```
  This makes `mainObjectType('TABL/DS') === 'TABL'` and propagates the structure-as-table normalization into `bucketForType`, `isCdsImpactWhereUsedType`, etc.
- [ ] At [src/handlers/intent.ts:2682-2685](src/handlers/intent.ts:2682) in `objectBasePath`:
  - Remove the `case 'STRU': return '/sap/bc/adt/ddic/structures/';` branch entirely.
  - Keep `case 'TABL': return '/sap/bc/adt/ddic/tables/';`. The runtime resolver in Task 4 handles structure URLs; for write/activate paths, `/tables/` is the create-time URL, the lock URL is the existing object's URL (resolved separately), and `/structures/` is only needed for structures that already exist (read-only path).
- [ ] At [src/handlers/intent.ts:1260](src/handlers/intent.ts:1260) in `VERSIONED_SOURCE_READ_TYPES`, remove `'STRU',`. `'TABL'` already covers both kinds after the collapse.
- [ ] Update the test at [tests/unit/handlers/intent.test.ts:7676-7700](tests/unit/handlers/intent.test.ts:7676):
  ```ts
  ['TABL/DT', 'TABL'],
  ['TABL/DS', 'TABL'],     // NEW — primary fix
  ['STRU/DS', 'TABL'],     // CHANGED from 'STRU' — legacy alias
  ['STRU', 'TABL'],         // NEW — legacy alias
  ```
- [ ] Add unit tests (~3 tests):
  - `mainObjectType('TABL/DS') === 'TABL'`
  - `bucketForType('TABL/DS') === 'tables'` (already passes after the helper change; verify explicitly)
  - `isCdsImpactWhereUsedType('TABL/DS') === true` (already passes; verify)
- [ ] Run `npm test` — all tests must pass.

### Task 4: Drop STRU from SAPRead handler; route TABL through getTabl()

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`
- Modify: `src/context/compressor.ts`

Remove the `case 'STRU'` branch from the SAPRead handler. Route the `case 'TABL'` branch through the new `getTabl()` resolver so structure reads work with `type='TABL'`. Update the CDS dep fallback chain in compressor to use the unified resolver.

- [ ] At [src/handlers/intent.ts:1545-1550](src/handlers/intent.ts:1545) in the SAPRead handler, change the `case 'TABL'` branch:
  ```ts
  case 'TABL': {
    const { source, cacheHit, revalidated } = await cachedGet('TABL', name, effectiveVersion, (ifNoneMatch) =>
      client.getTabl(name, { ifNoneMatch, version: effectiveVersion }),
    );
    return cachedTextResult(source, cacheHit, revalidated, versionWarning);
  }
  ```
- [ ] Remove the entire `case 'STRU'` block at [src/handlers/intent.ts:1557-1562](src/handlers/intent.ts:1557).
- [ ] At [src/handlers/intent.ts:1774](src/handlers/intent.ts:1774), update the error message — remove `STRU` from the list.
- [ ] At [src/context/compressor.ts:355](src/context/compressor.ts:355), update the JSDoc comment: replace `with a type fallback chain: DDLS → TABL → STRU.` with `with a type fallback chain: DDLS → TABL (structures and transparent tables share the TABL parent).`
- [ ] At [src/context/compressor.ts:422-470](src/context/compressor.ts:422) in `fetchCdsDependency`:
  - Update the JSDoc: `Try DDLS first (another CDS view), then TABL.` (drop the STRU reference).
  - Remove the third `try { ... }` block at lines 458-470 entirely.
  - Replace `client.getTable(dep.name, ...)` at line 452 with `client.getTabl(dep.name, ...)` so the unified resolver handles both transparent and structure deps.
  - Inline-comment why this is enough now: `// getTabl() handles the /tables/ → /structures/ fallback internally.`
- [ ] Update the existing test at [tests/unit/handlers/intent.test.ts:577-583](tests/unit/handlers/intent.test.ts:577): change `type: 'STRU'` to `type: 'TABL'`. Mock both `/tables/` (404) and `/structures/` (200 with structure body) so the test exercises the fallback.
- [ ] Update the existing test at [tests/unit/handlers/intent.test.ts:5699-5706](tests/unit/handlers/intent.test.ts:5699): change `type: 'STRU'` to `type: 'TABL'`. Same fallback mock.
- [ ] Add unit tests (~4 tests) for the new TABL+fallback behavior:
  - `SAPRead(type='TABL', name='BAPIRET2')` returns the structure source after the /tables/→/structures/ fallback.
  - `SAPRead(type='TABL', name='T000')` returns the table source from /tables/ on the first try (no fallback).
  - `SAPRead(type='TABL', name='X')` returns an error when both URLs 404 (object truly missing).
  - `SAPRead(type='STRU', name='X')` is rejected by Zod with a message that recommends `TABL`.
- [ ] Run `npm test` — all tests must pass.

### Task 4a: TABL URL resolution for write/activate/lock paths

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `src/adt/client.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

`objectUrlForType('TABL', name)` is a sync helper used by SAPWrite (update/delete), SAPActivate, the lock helper, syntax-check, and where-used path-builders. Today it always returns `/sap/bc/adt/ddic/tables/{name}`. After Model B, an existing structure must be addressed at `/sap/bc/adt/ddic/structures/{name}`. This task adds a runtime URL resolver and threads it through the write/activate paths.

Approach: keep `objectUrlForType()` sync (it has many callers, and changing every signature is invasive) and add an async helper `resolveTablObjectUrl(client, name)` that returns the right URL. Cache resolutions on the `AdtClient` instance so subsequent activate/lock calls don't pay the 404 cost twice. SAPWrite update/delete and SAPActivate will await the resolver before computing `objectUrl`/`srcUrl`. Create-time URLs (`action='create'`) keep using the sync `/tables/` default — structure creation is out of scope for this plan.

- [ ] In [src/adt/client.ts](src/adt/client.ts), add a method that consults the `tablUrlCache` populated by `getTabl()` (Task 1) and falls back to a probe if the cache is cold:
  ```ts
  /** Resolve the canonical ADT URL for a TABL name (transparent table or structure).
   *  Returns the cached URL if a previous getTabl() resolved it; otherwise probes
   *  /tables/ first and /structures/ on 404. Result cached per client. */
  async resolveTablObjectUrl(name: string): Promise<string> {
    const upper = name.toUpperCase();
    const cached = this.tablUrlCache.get(upper);
    if (cached) return cached;
    // Cold cache — populate it via a metadata GET (no /source/main suffix).
    const tableUrl = `/sap/bc/adt/ddic/tables/${encodeURIComponent(name)}`;
    const structUrl = `/sap/bc/adt/ddic/structures/${encodeURIComponent(name)}`;
    try {
      await this.http.get(tableUrl);
      this.tablUrlCache.set(upper, tableUrl);
      return tableUrl;
    } catch (err) {
      if (err instanceof AdtApiError && err.statusCode === 404) {
        // Confirm structure URL exists too — if both 404, the object truly isn't there.
        await this.http.get(structUrl);
        this.tablUrlCache.set(upper, structUrl);
        return structUrl;
      }
      throw err;
    }
  }
  ```
- [ ] At [src/handlers/intent.ts:2760-2761](src/handlers/intent.ts:2760) in `handleSAPWrite`, replace the unconditional sync URL build with:
  ```ts
  let objectUrl = objectUrlForType(type, name);
  let srcUrl = sourceUrlForType(type, name);
  if (type === 'TABL' && action !== 'create' && action !== 'batch_create') {
    objectUrl = await client.resolveTablObjectUrl(name);
    srcUrl = `${objectUrl}/source/main`;
  }
  ```
- [ ] In `handleSAPActivate` (around [src/handlers/intent.ts:3784](src/handlers/intent.ts:3784)), find every place that calls `objectUrlForType('TABL', ...)` and similarly use `resolveTablObjectUrl()`. The activate XML body must reference the right URL.
- [ ] In [tests/unit/handlers/intent.test.ts:3790-3798](tests/unit/handlers/intent.test.ts:3790) (the `'activates DDIC types with correct object URLs in XML body'` test): change `type: 'STRU'` to `type: 'TABL'`. Mock the resolver: first request for `ZTEST_STRUCT` is a HEAD/GET to `/tables/ZTEST_STRUCT` returning 404, then resolution falls back to `/structures/ZTEST_STRUCT`. Assert the activation XML body contains `/sap/bc/adt/ddic/structures/ZTEST_STRUCT`.
- [ ] Add unit tests (~3 tests):
  - `client.resolveTablObjectUrl('T000')` returns `/sap/bc/adt/ddic/tables/T000` after one 200 GET (no fallback).
  - `client.resolveTablObjectUrl('BAPIRET2')` returns `/sap/bc/adt/ddic/structures/BAPIRET2` after a 404 then a fallback resolution.
  - Subsequent calls hit the in-memory cache (verified by mock-call count: only one HTTP request for two consecutive `resolveTablObjectUrl(name)` calls).
- [ ] Run `npm test` — all tests must pass.

### Task 5: Update tools.ts descriptions and supported-types arrays

**Files:**
- Modify: `src/handlers/tools.ts`

Drop `STRU` from every supported-types array and inline description string. Replace the standalone STRU description with a sentence inside the TABL description: "TABL covers both transparent tables and DDIC structures (they share TADIR R3TR TABL — `BAPIRET2`-style structures and `T000`-style tables)."

- [ ] At [src/handlers/tools.ts:54](src/handlers/tools.ts:54), remove `'STRU',` from the on-prem read types array.
- [ ] At [src/handlers/tools.ts:91](src/handlers/tools.ts:91), remove `'STRU',` from the BTP read types array.
- [ ] At [src/handlers/tools.ts:106](src/handlers/tools.ts:106), edit the on-prem SAPRead description: drop the `STRU` reference and merge it into the `TABL` clause: replace `TABL, VIEW, STRU (DDIC structures like BAPIRET2 — returns CDS-like source)` with `TABL (DDIC tables and structures — both transparent tables like T000 and structures like BAPIRET2; CDS-like source), VIEW`.
- [ ] At [src/handlers/tools.ts:110](src/handlers/tools.ts:110), edit the BTP SAPRead description similarly: replace `TABL (custom tables only), STRU (DDIC structures — returns CDS-like source)` with `TABL (custom tables and DDIC structures — both via the same type)`.
- [ ] At [src/handlers/tools.ts:443-444](src/handlers/tools.ts:443), edit the conditional descriptions: remove `STRU` from both the BTP and on-prem listings.
- [ ] Run `npm run typecheck` and `npm test` — all tests must pass.

### Task 6: Update probe catalog and remaining src/ references

**Files:**
- Modify: `src/probe/catalog.ts`
- Modify: `src/handlers/intent.ts` (one comment line)
- Modify: `tests/unit/probe/replay.test.ts` if it pins STRU as a separate type

Drop the standalone STRU probe entry; extend the TABL probe with structure known-objects so the probe still verifies both read paths.

- [ ] At [src/probe/catalog.ts:96-101](src/probe/catalog.ts:96), remove the entire STRU entry.
- [ ] Find the existing TABL entry in [src/probe/catalog.ts](src/probe/catalog.ts) and add a structure to its `knownObjects` array (e.g. `'BAPIRET2'` or `'SYST'`). The probe runner will check that at least one URL works for at least one known-object.
- [ ] At [src/handlers/intent.ts:3722-3723](src/handlers/intent.ts:3722), edit the comment: replace `Metadata-write types (DOMA/DTEL/TABL/STRU/MSAG/DEVC/SKTD)` with `Metadata-write types (DOMA/DTEL/TABL/MSAG/DEVC/SKTD)`.
- [ ] Run `npm test` — all tests must pass. If `tests/unit/probe/replay.test.ts` references STRU explicitly, update it to assert TABL covers both transparent table and structure known-objects.
- [ ] Re-run probe locally if convenient: `npm run probe -- --save-fixtures /tmp/probe-stru-collapse` — verify the captured fixtures show TABL works for both `T000` and `BAPIRET2`.

### Task 7: Update integration and E2E tests against A4H

**Files:**
- Modify: `tests/integration/adt.integration.test.ts`
- Modify: `tests/e2e/smoke.e2e.test.ts`
- Modify: `tests/e2e/navigate.e2e.test.ts`
- Modify: `tests/evals/scenarios/read-basic.ts`

Update STRU-using tests to use TABL and add coverage that runs against the live A4H S/4HANA 2023 system to verify the structure-via-TABL path end-to-end.

- [ ] At [tests/e2e/smoke.e2e.test.ts:109-114](tests/e2e/smoke.e2e.test.ts:109): rename test `'SAPRead STRU — reads BAPIRET2 structure definition'` to `'SAPRead TABL — reads BAPIRET2 structure via unified TABL type'`. Change `type: 'STRU'` to `type: 'TABL'`. Keep the `expect(text).toContain('bapiret2')` and `expect(text).toContain('message')` assertions — they still hold for the structure source. Add an assertion that the response source contains structure-shape syntax: `expect(text.toLowerCase()).toMatch(/define type bapiret2|define structure/i)`.
- [ ] At [tests/e2e/navigate.e2e.test.ts:183-193](tests/e2e/navigate.e2e.test.ts:183) (`'finds references to BAPIRET2 structure'`): change `type: 'STRU'` to `type: 'TABL'`. Add a comment: `// BAPIRET2 is a DDIC structure; under Model B, both structures and transparent tables use type='TABL'.`
- [ ] At [tests/e2e/navigate.e2e.test.ts:257-264](tests/e2e/navigate.e2e.test.ts:257) (`'filters references by objectType CLAS/OC'`): change `type: 'STRU'` to `type: 'TABL'`.
- [ ] At [tests/e2e/navigate.e2e.test.ts:7](tests/e2e/navigate.e2e.test.ts:7): update file-level header comment — drop `STRU,` from the type list.
- [ ] At [tests/evals/scenarios/read-basic.ts:4](tests/evals/scenarios/read-basic.ts:4): drop `STRU,` from the comment.
- [ ] At [tests/evals/scenarios/read-basic.ts:87](tests/evals/scenarios/read-basic.ts:87): change `type: 'STRU'` to `type: 'TABL'`.
- [ ] In [tests/integration/adt.integration.test.ts](tests/integration/adt.integration.test.ts), add a new test in the appropriate `describe` block:
  ```ts
  it('reads a DDIC structure via TABL (auto-resolves /tables/→/structures/)', async () => {
    const result = await client.getTabl('BAPIRET2');
    expect(result.source).toMatch(/bapiret2/i);
    expect(result.source.toLowerCase()).toMatch(/define type bapiret2|define structure|message/);
  });
  it('reads a transparent table via TABL (uses /tables/ on first try)', async () => {
    const result = await client.getTabl('T000');
    expect(result.source).toMatch(/T000|@AbapCatalog\.tableCategory/i);
  });
  ```
- [ ] Run `npm test` — all unit tests must pass.
- [ ] Run `npm run test:integration` (with A4H credentials) — new tests pass.
- [ ] Run `npm run test:e2e` (with MCP server running, see `INFRASTRUCTURE.md`) — updated E2E tests pass.

### Task 8: Update documentation

**Files:**
- Modify: `docs_page/tools.md`
- Modify: `docs_page/caching.md`
- Modify: `docs_page/roadmap.md`
- Modify: `compare/00-feature-matrix.md`
- Modify: `CLAUDE.md`

Remove `STRU` from end-user docs and contributor guidance; update the TABL description to call out the dual coverage.

- [ ] In [docs_page/tools.md:30](docs_page/tools.md:30), remove `STRU` from the version-aware types list.
- [ ] In [docs_page/tools.md:49-51](docs_page/tools.md:49): replace the two rows (`TABL` / `STRU`) with one row: `| `TABL` | DDIC TABL: transparent tables (T000-style) and DDIC structures (BAPIRET2-style). Returns CDS-like source. ARC-1 auto-resolves the URL — try /tables/ first, fall back to /structures/. |`.
- [ ] In [docs_page/tools.md:96](docs_page/tools.md:96): replace `SAPRead(type="STRU", name="BAPIRET2")            — structure definition` with `SAPRead(type="TABL", name="BAPIRET2")            — DDIC structure (auto-resolved)`.
- [ ] In [docs_page/caching.md:83](docs_page/caching.md:83), drop `STRU` from the DDIC list: `DDIC metadata: TABL, VIEW`.
- [ ] In [docs_page/roadmap.md:1419](docs_page/roadmap.md:1419), update the TABL/STRU collapse plan reference. Add a new line under FEAT-04 status: `**TABL collapse (Model B):** STRU type collapsed into TABL. ADT exposes structures as TABL/DS (legacy share with TABL/DT). See docs/plans/completed/collapse-stru-into-tabl.md.`
- [ ] In [docs_page/roadmap.md:2223](docs_page/roadmap.md:2223), edit the implemented-features sentence: drop `structures (STRU)` and add `(TABL covers transparent tables and DDIC structures)`.
- [ ] In [docs_page/roadmap.md:2361](docs_page/roadmap.md:2361), update the feature-matrix row: `FEAT-04: DOMA, DTEL, DDLX, TRAN, BOR, T100, variants` (drop STRU; structures are now part of TABL).
- [ ] In [compare/00-feature-matrix.md:335](compare/00-feature-matrix.md:335), remove the `STRU` mention.
- [ ] In [CLAUDE.md:373-374](CLAUDE.md:373) (Handler Pattern example), replace the `case 'STRU'` example with `case 'TABL'`:
  ```ts
  case 'TABL':
    return textResult((await client.getTabl(name)).source);
  ```
- [ ] In [CLAUDE.md](CLAUDE.md) Key Files for Common Tasks table: search for any STRU mention and update.
- [ ] Run `npm test` — sanity check that documentation edits did not somehow affect runtime (they shouldn't).

### Task 9: Final verification

**Files:**
- (verification only; no code changes unless an issue is found)

End-to-end verification across all test tiers and infrastructure.

- [ ] Run full unit test suite: `npm test` — all tests pass.
- [ ] Run typecheck: `npm run typecheck` — no errors.
- [ ] Run lint: `npm run lint` — no errors.
- [ ] Run integration tests against A4H: `npm run test:integration` — all pass; new TABL/structure tests demonstrate the fallback.
- [ ] Run E2E tests against the locally-running MCP server: `npm run test:e2e` — all pass.
- [ ] Sanity-check by hand: `npx tsx src/cli.ts call SAPRead '{"type":"TABL","name":"BAPIRET2"}'` (or equivalent) returns the structure source.
- [ ] Sanity-check error path: `npx tsx src/cli.ts call SAPRead '{"type":"STRU","name":"BAPIRET2"}'` returns a Zod validation error mentioning TABL.
- [ ] Grep the codebase for stale STRU references: `grep -rn "STRU\b" src/ tests/ docs_page/ docs/ CLAUDE.md compare/ | grep -v -E "STRUCT|STRUST|STRU_|struct_"` — only legacy SLASH_TYPE_MAP aliases (in `src/handlers/intent.ts`) and history/changelog entries should remain.
- [ ] Move this plan to `docs/plans/completed/`.
