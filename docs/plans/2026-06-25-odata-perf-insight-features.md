# Plan — OData/SQL performance-insight features for an LLM (no SAP GUI)

**Status:** approved to implement (all 5) on branch `feat/sapquery-metrics-trace-requests` (same PR as
SAPQuery metrics + trace requests). #5 ships **experimental** (warning + prerequisites + stabilize-by-testing).
**Evidence:** all live-verified on a4h (S/4HANA 2023, 758) — see
[odata-performance-insight-for-llm.md](../research/2026-06-25-odata-performance-insight-for-llm.md) +
[abap-trace-requests-and-sapquery-metrics.md](../research/2026-06-25-abap-trace-requests-and-sapquery-metrics.md).
**Use case:** "why is this Fiori Elements OData request slow" → an LLM, without SAP GUI.

Three-file sync invariant for every new action: `src/handlers/tools.ts` (JSON schema) ↔
`src/handlers/schemas.ts` (Zod, `looseOptionalBoolean` for bools) ↔ per-tool handler; add `ACTION_POLICY`
entry in `src/authz/policy.ts` (CI `validate:policy` enforces parity); refresh tool-definition snapshot
(`vitest -u`); bump `check-tool-schema-budget.ts` + `check-file-sizes.mjs` if needed.

---

## #1 — `sap-statistics` OData performance probe  ★★★★★  (Build now, scope `data`/`sql`)

**What:** given an OData URL (relative path from the Fiori app's network tab), GET it with
`?sap-statistics=true` + a wall-clock timer; return the server-side timing split + a routing verdict.

**Verified (a4h):** `GET <odata-url>?sap-statistics=true` → response header
`sap-statistics: gwtotal=173,gwfw=38,gwnongw=4,gwapp=131,gwappfw=25,gwappdb=100,icftotal=220,icfauth=0,icfext=178,icmtotal=233,...`
plus `sap-perf-fesrec=<µs>`. (The **query param** gives the rich `gw*` split; the `sap-statistics: true`
**header** gives only `icf*`/`icm*`.) Fields: `gwtotal` total · `gwfw` framework · `gwapp` app total ·
**`gwappdb` = DB time** · `gwappfw` app-fw · `icfauth` auth.

**Impl:**
- New action `SAPDiagnose action=odata_perf` (param `url`, optional `method` default GET). arc-1's
  `client.http.get` already fetches arbitrary host paths (used it live).
- Parse the `sap-statistics` header → `{ gwtotal, gwfw, gwapp, gwappdb, gwappfw, icfauth, ... }` (split on
  `,` then `=`; all numeric ms). Also capture `sap-perf-fesrec`, `@odata.count` (if JSON body), bytes,
  HTTP status, wall-clock ms.
- Verdict helper: `gwappdb` dominant → "DB-bound → check the CDS query (SAPQuery/CDS Show-SQL/ST05)";
  `gwapp−gwappdb` dominant → "ABAP/SADL"; `gwfw` dominant → "metadata/first-call"; `icfauth` → "auth".
- Scope `data`/`sql` (it executes a query), `OperationType.Query`/`FreeSQL`. Files: `diagnose.ts` (or a small
  new `odata-perf.ts`), `schemas.ts`, `tools.ts`, `policy.ts`. Add a `parseSapStatistics()` unit test.
- Caveat to document: works when the OData service is on the same SAP host arc-1 connects to.

---

## #2 — CDS Show-SQL (`createstatements`)  ★★★★  (Build now, scope `read`)

**What:** return the SQL a CDS view generates (so the LLM sees joins/scan behind a slow entity).

**Verified (a4h):** `/sap/bc/adt/ddic/ddl/createstatements/{name}` exists; **405 on GET → it's POST-only**.
TODO at impl: confirm the exact POST (body = object ref/source? Accept = text/plain?) with one live probe.

**Impl:**
- Add to SAPRead (`type=DDLS` with `show_sql=true`) or a `SAPDiagnose action=cds_sql`. Read scope.
- POST to the endpoint, return the SQL text. Files: `read.ts` or `diagnose.ts` + `client.ts` method +
  `schemas.ts`/`tools.ts`/`policy.ts`. Unit test with a captured response.

---

## #3 — Inactive-service activation guard  ★★★  (Build now, cross-cutting)

**What:** when an endpoint's SICF node is inactive, SAP returns `403` "Service cannot be reached" (HTML).
Detect it and return an actionable message instead of a raw error.

**Verified (a4h):** `/sap/bc/stmc/ui5/` was `403 "Service cannot be reached"` until the admin activated the
SICF nodes; then `200`. (User activated `/sap/bc/stmc/{root,content,data,new_repo,repo,ui5}`.)

**Impl:**
- In `src/adt/errors.ts` / the new handlers: detect 403 whose body contains "Service cannot be reached" →
  `AdtApiError` with hint: "Activate the SICF service `<path>` (tx SICF). For ST05/TMC features activate
  `/sap/bc/stmc` (incl. `data` + `ui5`) and `/sap/bc/adt/st05`." Map the path → the SICF node to name.
- Tiny; reused by #4 and #5. Unit test the detection + message.

---

## #4 — ST05 SQL-trace **state** control (`/sap/bc/adt/st05/trace/state`)  ★★★  (Build, scope `write`)

**What:** activate/deactivate the SQL trace (+ filters) from arc-1 — the *control* half of ST05 (records
are separate, see #5).

**Verified (a4h):** `GET /sap/bc/adt/st05/trace/state` → `200`
`<ts:traceStateInstanceTable><ts:traceStateInstance><ts:instance>vhcala4hci_A4H_00</ts:instance>…<ts:traceTypes>`
`<ts:sqlOn>false</ts:sqlOn><ts:bufOn/><ts:enqOn/><ts:rfcOn/><ts:httpOn/><ts:apcOn/><ts:amcOn/><ts:authOn/></ts:traceTypes>`
`<ts:traceProperties>…`. Backing classes: `CL_ADT_ST05_TRACE_STATE`, `CL_ADT_ST05_KERNEL_INTERFACE`
(7 methods, all state — get/set/convert; **no record read**). Trace types: SQL/BUF/ENQ/RFC/HTTP/APC/AMC/AUTH.
Filter table `ADT_ST05_TRACE_FILTER` (user etc.), props `ADT_ST05_TRACE_PROPERTIES`.

**Impl:**
- Actions `sql_trace_state` (GET) + `set_sql_trace_state` (PUT, body = the `ts:` XML with sqlOn=true + a user
  filter). `write`/`OperationType.Update`. Parse/build the `traceStateInstanceTable` XML.
- Pairs with #5: arm SQL trace → user reproduces → read records (#5). Files: `diagnostics.ts`,
  `schemas.ts`/`tools.ts`/`policy.ts`, xml-parser. Tests with the captured XML. Apply #3 guard.

---

## #5 — TMC PTC OData records reader  ★★★★★  (Build **EXPERIMENTAL** — high value, high risk)

**What:** read the actual SQL-trace records (the ST05-only data) via the TMC OData V4 service.

**Verified (a4h):** OData V4 service at **`/sap/bc/stmc/data`**, provider **PTC**
(`CL_TMC_SRV_AS_ABAP_PTC_DPC`/`_MPC`, `/IWBEP/IF_V4_*`). Entity sets **`TH_PTC_DIRECTORY`** (trace list) +
**`TH_PTC_MAIN_RECORDS`** with columns **`STATEMENT_WITH_VALUES`**, `STATEMENT_WITH_NAMES`, **`DURATION`**,
`OBJECT`, `NUMBER_OF_ROWS`, `STATEMENT_HASH`, `PROGRAM`, `CURSOR`, `START_TIMESTAMP`, `TIMESTAMP`, + `DO_*`
display columns. **= the exact ST05 data.**

**The blocker (why GET returned 200-empty):** the bridge `CL_TMC_HLP_GATEWAY_TO_DP` addresses the V4 service
by **`service_id` + `provider_id`** (`/STMC/CR_V_ID`) via the private `/STMC/IF_DP_REQUEST` framework. The
URL→provider mapping is in the ICF handler / V4 registration (not derivable from code). The real call almost
certainly needs the `/STMC/` IDs + an OData **`$batch` POST** + `sap-*` context headers the UI5 app builds.
Plain GET on `TH_PTC_MAIN_RECORDS`/`$metadata`/`system_id`-prefixed → 200-empty.

**To unblock (do this at impl):** capture ONE real request from the **SQL Trace Analysis** app's browser
Network tab (URL + headers + body — likely a `POST /sap/bc/stmc/data/...` `$batch`), then replay/parametrize:
list via `TH_PTC_DIRECTORY` → read `TH_PTC_MAIN_RECORDS` for a chosen trace → map columns to a clean shape.

**Experimental design (per user decision — ship it, stabilize by testing):**
- Action `SAPDiagnose action=sql_trace_records` (params: trace id from directory, user/time filters, top).
- **Tool description + response carry an EXPERIMENTAL warning:** "Reads SAP's internal Technical Monitoring
  Cockpit OData (`/sap/bc/stmc/data`) — undocumented/version-specific; may break across SP/release; the
  request shape is system-specific."
- **Prerequisites surfaced on failure** (reuse #3 guard): SICF `/sap/bc/stmc` (root + `data` + `ui5`) active;
  the SQL trace must have been run/recorded (arm via #4).
- **Graceful degradation:** if the OData call returns empty/`$batch` mismatch/error → fall back to returning
  the **TMC deep-link** (already available from `GET /sap/bc/adt/st05/trace/directory`) + the prereqs, never a
  hard crash.
- **Stabilization plan in this PR:** capture the request → replay on a4h until records come back → harden the
  parser against the `DO_*`/striping envelope → add an integration test gated on the service being active
  (skip-policy if 403/empty). Keep the working request format documented in this file.
- **Risk register (carry in the PR):** undocumented internal API; `system_id`/`service_id`/`provider_id` are
  per-system; SAP may change between releases. Mark the action clearly so consumers don't depend on it.
- **Long-term alternative (not now):** FM bridge `ST05_GET_TRACE_TABLES` via FEAT-61 plugin = stable contract.

---

## Sequencing
1. **Increment A:** #1 + #2 + #3 (robust, low-risk "where's the time / which SQL / self-activating").
2. **Increment B:** #4 (trace state control) + #5 (experimental records reader, after capturing the request).
3. Each increment: full gate (`lint`/`typecheck`/`test`/`validate:policy`/`build`/`check:sizes`) + live
   verify on a4h; commit small.

## Open follow-ups (not blocking this PR)
- Probe a4h-2025 (816) for the **ABAP Cross Trace** (RAP/OData-aware + HANA PlanViz via ADT) — the strategic
  successor; if present it may outrank #5.
- SQLM data reader (`/sqlm/data?source_name=…`) — works but needs SQLM activated; deferred.
