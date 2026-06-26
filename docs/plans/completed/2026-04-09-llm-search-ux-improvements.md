# LLM Search UX Improvements: Transliteration, Field-Name Hints, and Cache Indicators

## Overview

This plan implements three server-side improvements that reduce wasted MCP tool calls, particularly for weaker/smaller LLMs. The improvements were identified from real session analysis showing a ~6x overhead factor (68 actual calls vs. 12 optimal) when an LLM investigated SAP objects on a German system.

The three changes are:

1. **Auto-transliterate non-ASCII characters in SAPSearch queries** — SAP object names are ASCII-only. When an LLM passes `*Schätz*`, it gets empty results and retries repeatedly. ARC-1 should auto-transliterate (ä→AE, ö→OE, ü→UE, ß→SS) and inform the caller.
2. **Field-name detection hint on empty SAPSearch results** — When a short uppercase query returns empty (looks like a field name, not an object name), hint that SAPQuery on DD03L or SAPRead with `include='elements'` is the right approach.
3. **Cache hit indicator for SAPRead** — SAPContext already marks cached results with `[cached]`. Extend this to SAPRead so LLMs (and users) know when a result came from cache vs. a live fetch.

## Context

### Current State

- **SAPSearch** passes the query string directly to ADT without any normalization. Non-ASCII characters silently return empty results. The empty-result hint mentions "try German business terms" but doesn't mention the ASCII constraint.
- **SAPSearch empty results** return a generic hint about Z*/Y* prefixes. No intelligence about whether the query looks like a field name rather than an object name.
- **SAPRead** uses `cachedGet()` internally but the `{ hit }` boolean from `cachingLayer.getSource()` is discarded — the caller never knows if the result was cached.

### Target State

- SAPSearch transparently transliterates non-ASCII characters and reports the transliteration in the response.
- Empty SAPSearch results include a contextual hint when the query looks like a field name.
- SAPRead responses include a `[cached]` indicator when served from cache, consistent with SAPContext behavior.

### Key Files

| File | Role |
|------|------|
| `src/handlers/intent.ts` | Tool handlers: `handleSAPSearch` (line ~585), `handleSAPRead` (line ~361), `cachedGet` helper (line ~374), `formatErrorForLLM` (line ~115) |
| `src/handlers/tools.ts` | Tool descriptions: `SAPSEARCH_DESC_ONPREM` (line ~170), `SAPSEARCH_DESC_BTP` (line ~176) |
| `src/cache/caching-layer.ts` | `getSource()` returns `{ source, hit }` — hit boolean already exists |
| `tests/unit/handlers/intent.test.ts` | SAPSearch tests (line ~525), SAPRead tests (line ~40), error guidance (line ~1380) |
| `docs/tools.md` | SAPSearch docs (line ~75) |
| `docs/caching.md` | Caching docs |

### Design Principles

1. **No new dependencies** — all changes are pure string manipulation and conditional logic in existing handlers.
2. **Backward compatible** — transliteration appends a note to results but doesn't change the result structure. Cache indicators are informational text prepended to responses.
3. **Concise tool descriptions** — any description changes must not increase token count significantly. Shorter is better for weaker models.
4. **Consistent patterns** — cache indicator follows the `[cached]` pattern already used in SAPContext.
5. **Testable** — each behavior is unit-testable via the existing mock-fetch pattern.

## Development Approach

All three features are isolated changes within `src/handlers/intent.ts` with corresponding unit tests. No new files needed. The features don't depend on each other, but they share the same handler file so ordering avoids merge conflicts.

Testing: unit tests only (code-only changes, no new SAP interaction or MCP protocol changes).

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Auto-transliterate non-ASCII characters in SAPSearch

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

Add a transliteration step at the top of `handleSAPSearch()` (line ~586 in `src/handlers/intent.ts`) that normalizes the query before passing it to `client.searchObject()`. When transliteration occurs, append a note to the result explaining what happened.

- [ ] Add a `transliterateQuery(query: string): { normalized: string; changed: boolean }` helper function near the top of `src/handlers/intent.ts` (near the other helper functions around line ~100). The function should:
  - Replace German umlauts: `ä/Ä→AE`, `ö/Ö→OE`, `ü/Ü→UE`, `ß→SS`
  - Replace other common accented Latin characters by stripping diacritics (use `String.normalize('NFD').replace(/[\u0300-\u036f]/g, '')` as a general fallback after the explicit German replacements)
  - Return `{ normalized, changed: true }` if any replacement was made, otherwise `{ normalized: query, changed: false }`
- [ ] In `handleSAPSearch()` at line ~586, after extracting `query` from args, call `transliterateQuery(query)`. Use the normalized query for the actual search call. If `changed` is true and the search returns results, prepend a note to the response: `Note: Query contained non-ASCII characters. Transliterated "${original}" → "${normalized}" (SAP object names are ASCII-only).\n\n`. If `changed` is true and results are empty, include the transliteration note in the empty-result hint.
- [ ] Also apply transliteration to source code search path (line ~601) — pass normalized query to `client.searchSource()`. Source code search may legitimately contain non-ASCII in ABAP comments/strings, so only transliterate for object search (`searchType !== 'source_code'`). Actually, for source_code search do NOT transliterate — source code can contain umlauts in strings and comments.
- [ ] Add unit tests (~6 tests) in `tests/unit/handlers/intent.test.ts` inside the existing `describe('SAPSearch', ...)` block:
  - `transliterateQuery` helper: `*Schätz*` → `*SCHAETZ*`, `*Übersicht*` → `*UEBERSICHT*`, `*straße*` → `*STRASSE*`, already-ASCII query returns unchanged
  - `handleSAPSearch` with umlaut query: verify the transliteration note appears in the response
  - `handleSAPSearch` with umlaut query returning empty: verify the hint mentions the transliteration
- [ ] Run `npm test` — all tests must pass

### Task 2: Field-name detection hint on empty SAPSearch results

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

Enhance the empty-result message in `handleSAPSearch()` (line ~619 in `src/handlers/intent.ts`) to detect queries that look like field names and provide targeted advice.

- [ ] Add a `looksLikeFieldName(query: string): boolean` helper function near `transliterateQuery()` in `src/handlers/intent.ts`. A query looks like a field name when: it is short (<=15 chars after stripping wildcards `*`), consists only of uppercase letters, digits, and underscores, and does not start with `Z` or `Y` (which are more likely object names). Examples that should match: `QDSTAT`, `ABLTYPE`, `MATNR`, `BUKRS`. Examples that should NOT match: `ZCL_*`, `*SCHAETZ*`, `Z_MY_FUNC`.
- [ ] In the empty-result block of `handleSAPSearch()` (line ~619), after the existing hint text, add a conditional: if `looksLikeFieldName(query)` is true, append: `\nThis looks like a field/column name. Use SAPQuery("SELECT fieldname, rollname, domname FROM dd03l WHERE fieldname = '${query}'") or SAPRead(type='DDLS', include='elements') to find fields.`
- [ ] Update the SAPSearch tool description in `src/handlers/tools.ts` — the existing note about field names (end of `SAPSEARCH_DESC_ONPREM` at line ~174 and `SAPSEARCH_DESC_BTP` at line ~180) is adequate and should not be made longer. No changes needed to tool descriptions.
- [ ] Add unit tests (~4 tests) in `tests/unit/handlers/intent.test.ts`:
  - `looksLikeFieldName`: `QDSTAT` → true, `MATNR` → true, `ZCL_TEST` → false, `*SCHAETZ*` → false, `Z_MY_FUNC` → false
  - `handleSAPSearch` with field-like query returning empty: mock `searchObject` to return `[]`, verify the DD03L hint appears in the response
  - `handleSAPSearch` with `Z*` query returning empty: verify the DD03L hint does NOT appear
- [ ] Run `npm test` — all tests must pass

### Task 3: Cache hit indicator for SAPRead

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

Make the `cachedGet` helper in `handleSAPRead()` (line ~374) propagate cache hit status so the response can include a `[cached]` indicator, following the pattern already used in `handleSAPContext()` (line ~1549).

- [ ] Refactor the `cachedGet` helper in `handleSAPRead()` (line ~374 in `src/handlers/intent.ts`). Currently it returns only the source string. Change it to return `{ source: string; cacheHit: boolean }`. When `cachingLayer` is absent, return `{ source, cacheHit: false }`. When `cachingLayer` is present, pass through the `hit` boolean from `cachingLayer.getSource()`.
- [ ] Add a `wrapWithCacheIndicator(text: string, cacheHit: boolean): string` helper (or inline logic). When `cacheHit` is true, prepend `[cached] ` as a single-line prefix before the result text. Keep it minimal — no extra newlines or verbose messages. The format should be: `[cached]\n<actual content>`.
- [ ] Update all `cachedGet` call sites in `handleSAPRead()` to destructure `{ source, cacheHit }` and pass `cacheHit` to `textResult()` via the wrapper. The affected cases are: `PROG`, `CLAS` (full source, no include), `INTF`, `FUNC`, `INCL`, `DDLS`, `BDEF`, `SRVD`, `DDLX`, `SRVB`, `TABL`, `VIEW`, `STRU`. For `CLAS` with method param or include param, and for types that don't use `cachedGet` (DOMA, DTEL, TRAN, TABLE_CONTENTS, SOBJ, DEVC, SYSTEM, COMPONENTS, MESSAGES, TEXT_ELEMENTS, VARIANTS), no indicator is needed.
- [ ] Add unit tests (~4 tests) in `tests/unit/handlers/intent.test.ts`:
  - SAPRead with cache enabled: first read = no `[cached]` prefix; second read of same object = `[cached]` prefix. This requires setting up a `CachingLayer` with a `MemoryCache` in the test. Import `MemoryCache` from `src/cache/memory.js` and `CachingLayer` from `src/cache/caching-layer.js`, pass as the `cachingLayer` parameter to `handleToolCall()`.
  - SAPRead without cache (no cachingLayer passed): verify no `[cached]` prefix ever appears
  - SAPRead for types that don't use cachedGet (e.g., DOMA): verify no `[cached]` prefix
- [ ] Run `npm test` — all tests must pass

### Task 4: Update documentation

**Files:**
- Modify: `docs/tools.md`
- Modify: `docs/caching.md`
- Modify: `docs/roadmap.md`

Update documentation to reflect the three new behaviors.

- [ ] In `docs/tools.md`, in the SAPSearch section (line ~75), add a note after the examples: `**Umlaut handling:** Queries containing non-ASCII characters (ä, ö, ü, ß) are automatically transliterated to ASCII equivalents (AE, OE, UE, SS). SAP object names are ASCII-only.` Also add a note: `**Field names:** If searching for a field/column name (e.g., MATNR, BUKRS), use SAPQuery against DD03L instead — SAPSearch only searches object names.`
- [ ] In `docs/caching.md`, in the "How It Works" → "Source code caching" section (line ~44), add a paragraph: `When a cached source is returned, the response is prefixed with [cached] so the caller knows the result came from cache. This matches the behavior of SAPContext dependency results.`
- [ ] In `docs/roadmap.md`, add a new completed item in the "Current State" table (around line ~65, after the "Object Caching" row): `| LLM Search UX | ✅ Auto-transliteration, field-name hints, cache indicators |`
- [ ] Run `npm test` — all tests must pass (no code changes, just doc validation)

### Task 5: Final verification

- [ ] Run full test suite: `npm test` — all tests pass
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors
- [ ] Verify transliteration: grep for `transliterateQuery` in `src/handlers/intent.ts` — function exists and is called in `handleSAPSearch`
- [ ] Verify field-name hint: grep for `looksLikeFieldName` in `src/handlers/intent.ts` — function exists and is called in empty-result block
- [ ] Verify cache indicator: grep for `cacheHit` in `src/handlers/intent.ts` — used in `handleSAPRead`
- [ ] Move this plan to `docs/plans/completed/`
