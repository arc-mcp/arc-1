# ABAP Trace Requests (arm/list/cancel) + SAPQuery metrics — research dossier

**Date:** 2026-06-25
**Author:** live spike on a4h (S/4HANA 2023, SAP_BASIS 758) via arc-1's own `AdtHttpClient`
**Scope:** two features requested for the "slow OData serial search" perf-debugging use case:
1. **Trace requests** — let `SAPDiagnose` *arm* an ABAP profiler trace (with SQL capture) so a user can
   reproduce a slow OData call and arc-1 then reads `dbAccesses` (the existing read path). Closes the loop
   that returned `[]` on MUP because no trace had ever been recorded.
2. **SAPQuery metrics** — surface the `totalRows` + server-side execution time that the datapreview
   response already contains and arc-1 currently discards.

> Background feasibility: `docs_page/roadmap.md` FEAT-09 (SQL Trace Monitoring, "Not started") and the
> docs/compare matrix row "SQL traces" (`docs/compare/00-feature-matrix.md:221`). True standalone ST05 has **no ADT
> REST resource**; the ABAP *profiler* trace's SQL/`dbAccesses` dimension is the ADT-native substitute and
> is what these two features deliver.

---

## Feature 2 — datapreview already returns the metrics (VERIFIED LIVE)

`SAPQuery` → `client.runQuery()` → `POST /sap/bc/adt/datapreview/freestyle?rowNumber=N` (text/plain SELECT).
Real response body (a4h 758, `SELECT mandt FROM t000`, rowNumber=3):

```xml
<dataPreview:tableData xmlns:dataPreview="http://www.sap.com/adt/dataPreview">
  <dataPreview:totalRows>2</dataPreview:totalRows>
  <dataPreview:isHanaAnalyticalView>false</dataPreview:isHanaAnalyticalView>
  <dataPreview:executedQueryString>SELECT MANDT FROM T000   INTO     TABLE @DATA(LT_RESULT)   UP TO 3  ROWS   .</dataPreview:executedQueryString>
  <dataPreview:queryExecutionTime>0.3150000</dataPreview:queryExecutionTime>
  <dataPreview:columns> … </dataPreview:columns>
</dataPreview:tableData>
```

- **`totalRows`** — the true count the query matched (their "511,927 rows" signal), independent of `rowNumber`.
- **`queryExecutionTime`** — server-side execution time in **milliseconds** (Eclipse Data Preview labels it ms;
  0.315 ms for a 2-row select is consistent). Server-authoritative — better than a wall-clock timer that
  includes ADT/network overhead.
- **`executedQueryString`** — the exact OpenSQL ADT generated (useful to show what really ran).

Current code: `parseTableContents()` ([src/adt/xml-parser.ts:237](../../src/adt/xml-parser.ts)) parses only
`{columns, rows}` and explicitly skips `totalRows` (comment at line 260). `runQuery()`
([src/adt/client.ts:1321](../../src/adt/client.ts)) returns `{columns, rows}` and drops the rest.

**Design:** add `parseDataPreviewMeta(xml) -> {totalRows?, queryExecutionTimeMs?, executedQueryString?}`,
have `runQuery()` merge it (additive optional fields — backward compatible for the 2 internal callers
`runChunkedSapQuery`/`searchObject`), and surface it in the `SAPQuery` handler output. For the chunked
long-IN-list path, sum `totalRows` and `queryExecutionTimeMs` across chunks.

---

## Feature 1 — ABAP trace requests (VERIFIED LIVE, full arm→list→cancel round-trip)

Endpoints exist 7.50 → 8.16: NW750 discovery already lists `…/abaptraces/parameters` and `…/abaptraces/requests`
(`docs/research/2026-05-08-nw750-discovery-gap-analysis.md:52-53`); confirmed live on 758 below. Eclipse bundle
`com.sap.adt.profiler_3.56.1` (`ProfilerUriDiscovery`) per `~/DEV/arc-1-eclipse-adt/api/17-runtime-diagnostics-and-traces.md`.
Reference impl: `abap-adt-api/src/api/{traces,tracetypes}.ts` (verbatim contract below). Neither fr0ster nor
mario implement arm-a-request (fr0ster only has *run-class-with-profiling*, a different mechanism).

### Contract (abap-adt-api, verbatim) + live confirmation

**1) Set capture parameters** → `POST /sap/bc/adt/runtime/traces/abaptraces/parameters`, `Content-Type: application/xml`:
```xml
<trc:parameters xmlns:trc="http://www.sap.com/adt/runtime/traces/abaptraces">
  <trc:allMiscAbapStatements value="false"/> <trc:allProceduralUnits value="true"/>
  <trc:allInternalTableEvents value="false"/> <trc:allDynproEvents value="false"/>
  <trc:description value="…"/> <trc:aggregate value="true"/> <trc:explicitOnOff value="false"/>
  <trc:withRfcTracing value="false"/> <trc:allSystemKernelEvents value="false"/>
  <trc:sqlTrace value="true"/> <trc:allDbEvents value="false"/>
  <trc:maxSizeForTraceFile value="100"/> <trc:maxTimeForTracing value="600"/>
</trc:parameters>
```
LIVE 758 → **HTTP 200, empty body**, id returned in the `Location` header:
`Location: /sap/bc/adt/runtime/traces/abaptraces/parameters/8EDEEFE4F3661FE19C8F2D46C4CC38A2`
→ **parametersId = the Location path** (use verbatim as the `parametersId` query param below).

**2) Create trace request** → `POST /sap/bc/adt/runtime/traces/abaptraces/requests?<qs>` (empty body). Query params:
`server=* · description · traceUser=<UPPER> · traceClient · processType=<uri> · objectType=<uri> ·
expires=<ISO-8601 Z> · maximalExecutions · parametersId=<Location from step 1>`.
LIVE 758 → **HTTP 200**, atom feed with the created entry. `expires=2026-06-26T23:59:59Z` (ISO-8601 `Z`) accepted:
```xml
<atom:entry xml:lang="EN">
  <atom:content type="application/atom+xml" src="/sap/bc/adt/runtime/traces/abaptraces/requests/vhcala4hci_A4H_00%2c1%2c20260625093701"/>
  <atom:id>/sap/bc/adt/runtime/traces/abaptraces/requests/vhcala4hci_A4H_00%2c1%2c20260625093701</atom:id>
  <atom:title>arc1 spike</atom:title>
  <trc:extendedData>
    <trc:host>vhcala4hci</trc:host> <trc:client trc:role="trace">001</trc:client>
    <trc:description>arc1 spike</trc:description> <trc:isAggregated>true</trc:isAggregated>
    <trc:expires>2026-06-26T23:59:59Z</trc:expires>
    <trc:processType trc:processTypeId=".../processtypes/http"/>
    <trc:object trc:objectTypeId=".../objecttypes/url"/>
    <trc:executions trc:maximal="1" trc:completed="0"/>
  </trc:extendedData>
</atom:entry>
```
→ **request id = the `<atom:id>` element text** (NOT an `id="…"` attribute — my first cleanup regex missed this
and left an armed request; second pass DELETEd it, list confirmed empty). URL-encoded commas (`%2c`) in the id
are passed through verbatim on DELETE.

**3) List requests** → `GET /sap/bc/adt/runtime/traces/abaptraces/requests?user=<UPPER>`,
`Accept: application/atom+xml;type=feed`. LIVE 758 → **HTTP 200** atom feed; `<atom:entry>` per armed request
(same `extendedData` shape as above); empty feed (no entries) when none armed.

**4) Cancel request** → `DELETE /sap/bc/adt/runtime/traces/abaptraces/requests/{id}`. LIVE 758 → **HTTP 200**.
**5) Delete a recorded trace result** → `DELETE /sap/bc/adt/runtime/traces/abaptraces/{id}` (out of scope here).

### processType → objectType validity map (abap-adt-api `traceProcessObjects`)
`ANY→[functionmodule,url,transaction,report,sharedobjectsarea,any]`, **`HTTP→[url]`** (the OData case),
`DIALOG→[transaction,report]`, `BATCH→[report]`, `RFC→[functionmodule]`, `SHARED_OBJECTS_AREA→[sharedobjectsarea]`.
URIs: `…/abaptraces/processtypes/{any|http|dialog|batch|rfc|sharedobjectsarea}` and
`…/abaptraces/objecttypes/{any|url|transaction|report|functionmodule|sharedobjectarea}`.

---

## Design decisions

- **Separate actions, not a `mode` flag** — scope is enforced by `ACTION_POLICY[Tool.action]` in
  `dispatch.ts`, keyed by *action*. Arming/cancelling mutate server state and must require `write`; listing is
  `read`. New actions keep that true *by construction* (no special-casing dispatch by sub-mode):
  - `trace_start` → scope `write`, `OperationType.Update`
  - `trace_requests` → scope `read`, `OperationType.Read`
  - `trace_cancel` → scope `write`, `OperationType.Update`
  - existing `traces` (list/analyze recorded traces) — **unchanged**.
- **One `trace_start` = two HTTP calls** (set parameters → create request). Internal; LLM sees one action.
- **Minimal exposed params** (sensible defaults for the OData case): `traceUser` (default = connected user),
  `processType` (default `http`), `objectType` (optional; default = first valid for the process type → `url`),
  `maxExecutions` (default 1), `sqlTrace` (default true), `aggregate` (default true), `description`,
  `expiresHours` (default 24). Fixed internal defaults: `allProceduralUnits=true` (populates hitlist/statements),
  everything else `false`, `maxTimeForTracing=600`, `maxSizeForTraceFile=100`. Booleans use
  `looseOptionalBoolean` (never `z.coerce.boolean`, per #360).

## Per-release notes
- Endpoints present 7.50 (discovery) → 7.58 (live, this dossier) → 8.16 (discovery). Treated release-invariant;
  no body-marker heuristics needed. (816 has a known `datapreview/ddic` 404 quirk — irrelevant; SAPQuery uses
  `datapreview/freestyle`, and `totalRows`/`queryExecutionTime` are returned by freestyle, verified on 758.)
- Live re-verification on 816 deferred to the test phase (endpoints identical per discovery).

## Affected ARC-1 files
- `src/adt/diagnostics.ts` — add `createTraceRequest`, `listTraceRequests`, `deleteTraceRequest`.
- `src/adt/xml-parser.ts` — add `parseTraceRequestFeed` + `parseDataPreviewMeta`.
- `src/adt/types.ts` — `TraceRequest`, `TraceRequestCreateOptions`, process/object-type unions + URI maps.
- `src/adt/client.ts` — `runQuery` returns optional metrics.
- `src/handlers/query.ts` — surface metrics (incl. chunked aggregation).
- `src/handlers/diagnose.ts` — route `trace_start`/`trace_requests`/`trace_cancel`.
- `src/handlers/schemas.ts` + `src/handlers/tools.ts` — three-file sync (new actions + params).
- `src/authz/policy.ts` — `ACTION_POLICY` entries for the 3 new actions.
- Tests: unit (parsers, client fns mocked, handler routing, schema) + tool-definition snapshot refresh.

## Open questions (resolve in test phase)
- Confirm `trace_start` round-trips on 816 (expected identical).
- SAP-side auth needed to POST a request (S_DEVELOP vs S_ADT_RES) — arc-1 maps to `write` scope regardless;
  SAP enforces its own auth. Note any 403 in testing.
- Whether a recorded OData trace's `dbAccesses` is actually populated by `sqlTrace=true` — needs a real OData
  reproduction (human-in-the-loop); the arm/read endpoints themselves are proven.

## Live e2e through the shipped tools (2026-06-25, a4h 758, via `arc1-cli call`)

- **SAPQuery** `SELECT mandt FROM t000` → `{ totalRows: 2, queryExecutionTimeMs: 0.334, executedQueryString: "…UP TO 100 ROWS .", rowsReturned: 2, columns, rows }`. ✅ metrics surfaced first.
- **trace_start** (defaults) → `{ armed: true, request: { id, user: MARIAN, processType: …/http, objectType: …/url, maxExecutions: 1, completedExecutions: 0, … } }`. ✅
- **trace_requests** → lists the armed request. ✅
- **trace_cancel** with the id → `{ cancelled: true }`; follow-up list → `[]`. ✅ cleanup works.

**CAVEAT discovered live:** between `trace_start` and `trace_requests`, `completedExecutions` advanced `0 → 1` —
ARC-1's own ADT calls (HTTP, same user) consumed the single execution. An `processType=http` request armed for
the connected user captures the user's *very next* matching HTTP request across any session, so unrelated ARC-1
traffic can consume it. This is inherent to the mechanism (Eclipse behaves the same), not a defect. Mitigation
reflected in the `trace_start` runtime `next` hint: reproduce promptly and avoid other ARC-1 calls in between.

**Future improvement (not in scope):** the ADT trace request also accepts an *object name* (URL pattern /
transaction code) to scope the match — Eclipse's "Object Name" field. Adding it would let the trace fire only on
the specific OData URL and ignore ARC-1's `/sap/bc/adt/…` traffic. The create-request param for it was not probed;
worth a follow-up spike if the consume-race proves annoying in practice.

**Release coverage:** verified on 758; trace endpoints are discovery-confirmed identical on 7.50 and 8.16, and
`datapreview/freestyle` `totalRows`/`queryExecutionTime` are release-stable ADT fields — 816 re-run skipped as
low-risk (the 816 `datapreview/ddic` 404 quirk does not affect the `freestyle` path SAPQuery uses).

## Review hardening (Claude code-review + Codex, 2026-06-25)

- **`trace_cancel` arbitrary-DELETE (HIGH):** `traceRequestPath` originally trusted a `startsWith(prefix)` check
  on the raw id. `http.ts buildUrl()` does `new URL(base+path)`, which normalizes `..`, so `requests/../../oo/…`
  escaped the guard; Codex further noted `%2f`/`%2e` encoded separators (which SAP ICM may decode before
  routing) also slipped through. Final form validates on the **decoded + normalized** path and requires exactly
  one slash-free segment under `requests/`, while still sending the original (e.g. `%2c`-encoded) id SAP expects.
  Live round-trip of the real `%2c` id still cancels; `..` and `%2f` traversals are rejected (tests cover both).
- **`runQuery` metrics spillover:** widening `runQuery`'s return leaked `totalRows`/`executedQueryString` (internal
  SQL) into other consumers that `JSON.stringify` the whole result (e.g. `SAPRead type=SOBJ`). Split into a narrow
  `runQuery` + a dedicated `runQueryWithMetrics` (SAPQuery only); also removes the chunked path's N× double-parse.
- **`queryExecutionTimeMs` unit:** flagged as possibly seconds — **live-verified milliseconds** (a 318,837-row
  filtered scan reported 21.8, i.e. ms; the unit-test `executionTime` seconds precedent is a different field).
- **Minor:** `expiresHours:0` no-op guarded; empty `<totalRows/>` → spurious 0 guarded; empty-`id` create-response
  rejected; `pickTraceRole` reuses `toRecordArray`. Empty-string `traceUser` is already stripped pre-Zod by
  `stripLlmEmptyValues` (no fix needed).

## Live OData demo + `allDbEvents` fix (2026-06-25, a4h 758)

Built a reproducible slow-OData artifact (the MUP "slow substring search" problem) to test the full loop:
- `ZI_TRACE_DEMO` (DDLS over `t100`, 615,690 rows) → `ZUI_TRACE_DEMO` (SRVD) → `ZUI_TRACE_DEMO` (SRVB, OData V4, **published**), all in `$TMP`. Read-only service — **no BDEF/behavior needed**.
- URL: `…/sap/opu/odata4/sap/zui_trace_demo/srvd/sap/zui_trace_demo/0001/TraceDemo?$filter=contains(MessageText,'error')&$count=true` → **~0.4–1.4 s**, `@odata.count=30525` (substring scan = `LIKE '%error%'` over 615k rows).

**Bug found end-to-end:** with `processType=http objectType=url`, arming **does** capture the OData call (a trace with the request's title appears), but `dbAccesses`/`hitlist`/`statements` came back EMPTY — the shipped `buildTraceParametersXml` hardcoded `allDbEvents=false`. **Fix:** `allDbEvents` now follows `sqlTrace` (default on). With it, `dbAccesses` returns ~30 real entries for the OData call (the `/IWFND/*` Gateway-dispatch tables, BAdI/auth-config reads, plus the CDS query's DB access). Locked by a unit assertion so it can't regress.

**Nuance (important for the MUP case):** an OData V4 query over a CDS view pushes the heavy work to HANA, so the ABAP profiler's `dbAccesses` shows the **Gateway/ABAP-side** DB events (IWFND dispatch + the single CDS SELECT), not a HANA-internal per-table breakdown of the substring scan. For statement-level SQL with bind values + DB execution plan you still need ST05 (no ADT REST surface — the original FEAT-09 conclusion). The profiler trace is most informative when the slow path has real ABAP-side Open SQL / loops; for pure CDS pushdown it shows the framework overhead + the CDS access, not the HANA plan.

### ST05 vs ARC-1 abaptraces, head-to-head (2026-06-25, user-run on a4h)

Same OData call (`contains(MessageText,'error')`) captured by both ST05 (SAP GUI) and an ARC-1 http/url trace:

- **ST05 (SQL trace)** — nailed it: one row `ZI_TRACE_DEMO  SELECT WHERE UPPER("MESSAGETEXT") LIKE UPPER('%error%') … LIMIT 200`, **DURATION 82,070 µs, HANA_PROCESSING_TIME 81,048 µs, HANA_MAX_MEMORY 414 MB, 200 rows** (+ a `<AGGREGATE>` count at 50,155 µs). Exact SQL + timing + memory.
- **ARC-1 `dbAccesses` (aggregate=true, default)** — saw the same access as `ZI_TRACE_DEMO SELECT ×2` but **`accessTime=0`** (no timing), buried among ~30 framework tables (`/IWFND/*`, `/IWBEP/*`, `SRVD_RT_*`, `SRVB_*`, `T002`×20, auth). `hitlist` → `[]`. `statements` → SAP **400** `ExceptionInvalidData` "Data is invalid and could not be converted" (`T100KEY SADT_REST/006` — a SAP-side error, not our parser).
- **aggregate=false** makes it WORSE: `dbAccesses` itself returns the same SAP **400**. So aggregate=true is the only working mode for HTTP traces (keep it the default), and even then there's no per-statement SQL timing.

**Verdict:** for an HTTP/OData/CDS-pushdown request, the ADT abaptraces analysis sub-resources give "which tables were touched" but **not** the slow SQL + duration — that lives in ST05, which has no ADT REST surface. ARC-1's trace feature is a correct, GUI-free wrapper over the abaptraces endpoints; its analysis depth equals theirs. It earns its keep for (a) the arm/capture/read workflow without SAP GUI, (b) "what did this request touch", and (c) **dialog/report/RFC traces of ABAP-side code**, where SAT captures real hot-spot hitlists + DB timing. It is **not** a substitute for ST05 on CDS pushdown — exactly the FEAT-09 call.
