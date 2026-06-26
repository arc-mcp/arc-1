# Plan: RalphEx Feedback — ARC-1 Tool Improvements

## Overview

Implement 5 improvements from the RalphEx usage feedback report (2026-04-07), based on a CDS view hierarchy analysis task ("Ablesesteuerung in Zählerstände anzeigen") on IS-U. Only 3 of 11 tools were used (SAPSearch, SAPRead, SAPQuery). The feedback identified misleading error messages, missing error classification, and documentation gaps.

### Architecture Context

ARC-1 is a TypeScript MCP server for SAP ADT with 11 intent-based tools. Tool definitions are generated **dynamically** on every `ListTools` request via `getToolDefinitions(config)` in `tools.ts` — this means tool schemas can adapt based on runtime probe results (e.g., hide `source_code` search if unavailable). Feature probing runs 6 parallel HEAD/GET requests at startup via `probeFeatures()` in `features.ts`, detecting system capabilities (HANA, abapGit, RAP, AMDP, UI5, Transport) + SAP_BASIS version + system type (BTP/on-prem). Results are cached in `cachedFeatures` in `intent.ts`.

### Key Files

| File | Purpose |
|------|---------|
| `src/handlers/tools.ts` | Tool definitions (names, descriptions, JSON schemas) — what the LLM sees |
| `src/handlers/intent.ts` | Tool dispatch, error handling, `cachedFeatures` state |
| `src/adt/features.ts` | Feature probe — detects system capabilities at startup |
| `src/adt/types.ts` | `ResolvedFeatures`, `FeatureStatus` types |
| `src/adt/client.ts` | ADT client — `searchSource()`, `runQuery()`, `getDdlx()` |
| `src/adt/errors.ts` | `AdtApiError` with status code classification |
| `src/server/server.ts` | Server lifecycle — `createAndStartServer()`, `createServer()` |

## Validation Commands

- `npm run build`
- `npm test`
- `npm run typecheck`
- `npm run lint`

## Success criteria

- [x] All 5 items implemented and tested
- [x] `npm test` passes (707+ tests)
- [x] `npm run build` succeeds
- [x] `npm run typecheck` succeeds
- [x] `npm run lint` succeeds

### Task 1: textSearch smoketest at startup + dynamic tool hiding

Source code search (`searchType="source_code"`) failed on RalphEx's system with a misleading error blaming SAP_BASIS < 7.51, but the system IS above 7.51. The real cause is likely SICF service not activated, missing authorization, or search framework not configured. Currently `intent.ts:530` catches 404/501 and always returns the same wrong message.

**Approach:** Run a real smoketest at startup (`GET .../textSearch?searchString=SY-SUBRC&maxResults=1`) to test end-to-end. Classify errors precisely. Hide `source_code` from the SAPSearch tool schema when unavailable so the LLM never tries it.

- [x] Add `probeTextSearch(client: AdtHttpClient)` function in `src/adt/features.ts` that does a real GET to `/sap/bc/adt/repository/informationsystem/textSearch?searchString=SY-SUBRC&maxResults=1` and classifies results: 2xx=available, 401/403="User lacks authorization (check S_ADT_RES)", 404="textSearch ICF service not activated — activate in SICF", 500="Search framework error (component BC-DWB-AIE)", 501="Not implemented (requires SAP_BASIS >= 7.51)", network error="Network error"
- [x] Add `textSearch?: { available: boolean; reason?: string }` field to `ResolvedFeatures` interface in `src/adt/types.ts`
- [x] Call `probeTextSearch()` inside `probeFeatures()` in `src/adt/features.ts`, running in parallel with existing 6 probes (add to the `Promise.all` block). Store result in the returned `ResolvedFeatures`
- [x] In `src/handlers/tools.ts` `getToolDefinitions()`: read textSearch probe status (import from a shared accessor or pass via config). When textSearch is unavailable: remove `source_code` from the `searchType` enum, remove `objectType` and `packageName` properties (only used for source_code), and simplify the SAPSearch description to only describe object search
- [x] In `src/handlers/intent.ts` `handleSAPSearch`: if `searchType === 'source_code'` and textSearch probe says unavailable, return `errorResult()` with the precise reason from the probe (e.g., "SICF not activated") instead of the generic BASIS version message. Keep existing catch block as final fallback for cases where probe wasn't run yet
- [x] Add unit tests in `tests/unit/adt/features.test.ts`: test `probeTextSearch()` returns correct classification for mocked 200, 401, 403, 404, 500, 501 responses and network errors
- [x] Add unit tests in `tests/unit/handlers/intent.test.ts`: test that `source_code` search returns precise error when probe says unavailable; test that search still works normally when probe says available
- [x] Add unit test in `tests/unit/handlers/tools.test.ts` or inline: verify `getToolDefinitions()` omits `source_code` from searchType enum when textSearch is unavailable, and includes it when available

### Task 2: SAPRead — improve "unknown type" error + objectType mapping hint

When the LLM passes a `uri` field (from SAPSearch results) instead of `type`+`name`, SAPRead returns `"Unknown SAPRead type: ."` which is unclear. Also, the SAPSearch description doesn't explain how to map `objectType` from results (e.g., `DDLS/DF`) to SAPRead's `type` parameter.

- [x] In `src/handlers/intent.ts`, find the SAPRead handler's default case that returns `Unknown SAPRead type: "${type}"`. Improve the error message to include: the list of supported types, and a tip: "Map objectType from SAPSearch results by dropping the slash suffix (e.g., DDLS/DF → type='DDLS', CLAS/OC → type='CLAS')."
- [x] In `src/handlers/tools.ts`, append to the SAPSearch tips section in `SAPSEARCH_DESC_ONPREM`: "The objectType field in results maps to SAPRead's type parameter — drop the slash suffix (DDLS/DF → DDLS, CLAS/OC → CLAS)."
- [x] Add unit test in `tests/unit/handlers/intent.test.ts`: call SAPRead with empty/missing type, verify the improved error message contains supported types and the mapping tip

### Task 3: DDLX 404 — soft "no metadata extension exists" message

Not every DDLS has a DDLX. Currently a DDLX 404 returns a generic error suggesting to "use SAPSearch to verify the name", which is misleading.

- [x] In `src/handlers/intent.ts`, wrap the `case 'DDLX'` handler in a try/catch. If `isNotFoundError(err)` is true, return a `textResult()` (NOT `errorResult()`) with message: `No metadata extension (DDLX) found for "${name}". This means no @UI annotations are defined via DDLX for this view. The view may use inline annotations in the DDLS source, or the Fiori app may configure columns via manifest.json / app descriptor.`
- [x] Add unit test in `tests/unit/handlers/intent.test.ts`: mock a 404 response for DDLX read, verify the result is NOT `isError` and contains the soft informational message

### Task 4: SAPQuery — JOIN-aware error handling + description warning

Multi-table JOINs can fail on the ADT `datapreview/freestyle` endpoint with confusing errors like `"INTO" is invalid`. SAP Note 3605050 (BC-DWB-AIE-DP) confirms parser keyword collision bugs. JOINs work in many cases but fail on specific syntax patterns. The tool description doesn't warn about this.

- [x] In `src/handlers/tools.ts`, update `SAPQUERY_DESC_ONPREM` to append: "Note: Uses the ADT freestyle SQL endpoint (same as ADT SQL Console in Eclipse). Supports ABAP SQL syntax including JOINs, but the endpoint parser has known edge cases with complex queries on some system versions (SAP Note 3605050). If a complex query fails, try simplifying — split JOINs into separate single-table SELECTs."
- [x] In `src/handlers/intent.ts` `handleSAPQuery` catch block: add a check before `throw err` — if `err instanceof AdtApiError && err.statusCode === 400` and `/\bJOIN\b/i.test(sql)`, return `errorResult()` with the original error message plus a hint: "Multi-table JOIN query failed. The ADT freestyle SQL endpoint has known parser edge cases with JOINs (SAP Note 3605050). Try splitting into separate single-table queries."
- [x] Add unit test in `tests/unit/handlers/intent.test.ts`: mock a 400 error for a SQL query containing JOIN, verify the JOIN-specific hint is included in the error. Also test that a 400 error without JOIN does NOT include the JOIN hint (falls through to default error handling)

### Task 5: SAPSearch — field-name clarification in description

Searching for `ZZ_ABLESARTST*` (a field name) returned nothing because SAPSearch only searches object names. The description doesn't make this explicit.

- [x] In `src/handlers/tools.ts`, update `SAPSEARCH_DESC_ONPREM` object search description to include: "Searches object names only (classes, tables, CDS views, etc.) — field/column names are not searchable here. To find fields by name, use SAPRead(type='DDLS', include='elements') for CDS views or SAPQuery against DD03L."
- [x] Also update `SAPSEARCH_DESC_BTP` with similar wording adapted for BTP (mention that DD03L is not available on BTP, use SAPRead with include='elements' for CDS views instead)
