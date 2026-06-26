---
name: debug-slow-sql
description: Find the root cause of a slow ABAP SQL or Fiori-Elements OData request and propose the cheapest fix — GUI-free via ARC-1 (odata_perf sap-statistics timing split, cds_sql "Show SQL", SAPQuery execution metrics, ST05 SQL-trace control, ABAP profiler traces), escalating to SAP GUI / HANA only for trace records and execution plans. Use when a report, transaction, Fiori list, CDS view, or OData entity is slow, a query times out under load, or someone asks "why is this SQL/OData so slow" or "where is the time going".
---

# Debug Slow SQL / OData

Find the **root cause** of a slow ABAP SQL or Fiori-Elements OData request and propose a fix — driving
ARC-1's diagnostics first (GUI-free), then escalating to SAP GUI / Fiori apps only when the deeper signal
needs them. The goal is not "it's slow" but *why*: which statement, what it scans, and what to change.

Use this when the user reports a slow report/transaction, a slow OData/Fiori list, a long-running CDS view, a
timeout/dump under load, or "this query got slow after …".

---

## Inputs (ask only for what's missing)

- **What is slow** — one of: an OData URL (copy from the browser Network tab), a CDS view / DDLS name, an ABAP
  program / class / report, a transaction code, or a table + access pattern.
- **How slow / how often** — a single slow call vs. slow-under-load vs. intermittent. (Routes you to per-request
  vs. aggregate analysis.)
- **Reproducible?** — can the user re-trigger it on demand (needed to arm a live trace)? On which system
  (DEV/QA/PROD) and as which SAP user?
- **Recent change?** — new code, new data volume, a transport, an index drop. Narrows the search fast.

If you only have a vague "X is slow", get the OData URL or the object name first — everything below keys off it.

---

## The diagnostic ladder — stop at the rung that explains it

Work top-down. Each rung is cheaper than the next and usually tells you whether to descend.

> **Reachability — don't promise a plan you can't reach.** Rungs 3–4 (profiler, ST05) need `SAP_ALLOW_WRITES`
> to arm and `S_ADT_RES` (ACTVT 01 **and** 02) to read — and don't exist on NW 7.50. If arming returns *writes
> disabled* or a `403`, say so and **stop at rung 2**: `odata_perf` + `cds_sql` + `SAPQuery` already pin a
> DB-bound root cause GUI-free. Tier-3–4 (the exact statement + execution plan) then depends on Basis/config, so
> hand the user the precise ST05/SAT steps below instead of pretending you reached the plan.

### 0. Orient (no execution)
- `SAPContext(action="deps", type="<type>", name=…)` / `SAPRead(type="DDLS", name=…)` — read the CDS/ABAP
  source. Eyeball it for the usual suspects **before** measuring: `LIKE '%term%'` (leading wildcard = no
  index), `SELECT … FROM` with no `WHERE` on a key, `SELECT *`, nested `SELECT` in a `LOOP` (N+1),
  client-side filtering, missing `FOR ALL ENTRIES` pre-check, calculated fields forcing a full scan.
- `SAPContext(action="impact", type="DDLS", name=…)` — the CDS stack (projection → base views → tables). The
  slow view is often a thin projection over a heavy base.
- **Find the generator, not just the literal SQL.** A slow `LIKE '%…%'`/scan is often *generated* — by a search
  help, SADL/RAP, or a framework — not hand-written, so a `grep`/where-used for the literal `SELECT` comes up
  empty. Trace the generator instead: for a value-help / type-ahead screen, the **search help**
  (`DD30L.SELMETHOD` + `FUZZY_SEARCH`, `DD32S` fields) and its DSH/SADL classes (`CL_DSH_*`, the F4→WHERE
  conversion) via `SAPSearch`/`SAPNavigate`/`SAPRead`. For an OData service, find its implementation: a **V4/RAP** binding → `SAPRead(type="SRVB", name=…)` → the service definition → the CDS view (then use `cds_sql`, rung 2). The **binding** (SRVB) name often differs from the URL's service path — if `SRVB` 404s, `SAPSearch` the service name to find the actual binding, or read the **service definition** (`SRVD`) directly for its `expose … as` entities. A **classic SEGW / Gateway V2** service has **no CDS** → find the DPC class (`SAPSearch "<SERVICE>_DPC*"`, read its `*_get_entityset` / `*_get_entity` / expand / `resolve_navigation_path` methods) and **skip rung 2**. (Don't
  confuse SE91/`WBMESSAGES`, which loads one message class in memory and searches with `CS`, with a search-help
  path that issues a real DB `LIKE`.)

### 1. Where did the time go? (one cheap call)
For an **OData / Fiori** request:
```
SAPDiagnose(action="odata_perf", url="/sap/opu/odata4/sap/…/Entity?$filter=…")
```
Read the `verdict`:
- **`db`** (`gwappdb` dominates) → the CDS/SQL query is the cost → go to rung 2.
- **`app`** (`gwapp` ≫ `gwappdb`, or `gwappdb` **absent**) → ABAP/SADL logic, **not the DB**. Do **not**
  ST05-hunt for a slow query — find what implements the service (rung 0) and trace it (rung 3). Classic
  culprit is an `$expand` **N+1** — isolate it by re-probing the URL **with vs without** `$expand`/`$select`
  and watch `gwapp` move.
- **`framework`** (`gwfw`; on 7.50 often only `gwhub`) → metadata / first-call / cold cache → re-probe warm.
  If only `gwhub` is present, you do not have a DB/app split yet; descend to a trace if it is not just cold
  cache.
- **`auth`** (`icfauth`) → ICF/DCL authorization overhead.
- **`unknown`** → no usable Gateway timing at all; confirm the URL is an OData/Gateway service on the SAP host.

(`odata_perf` needs `SAP_ALLOW_DATA_PREVIEW`; `url` must be a host-relative OData path under `/sap/opu/odata`
or `/sap/opu/odata4` on the SAP host ARC-1 connects to — other paths are rejected. It does a GET, so use the
entity/list request from the Network tab, not a `$batch` POST.)

### 2. DB-bound → see and measure the actual SQL
- `SAPDiagnose(action="cds_sql", name="I_TheView")` — the **native `CREATE VIEW`** the CDS compiles to
  (read-only; verified on 7.50/758/816). Now you see the real joins, `CAST`s, `COALESCE`s, and whether a
  sub-view drags in extra tables.
- `SAPQuery(sql="SELECT … FROM <cds-or-base> WHERE <the filter>")` — returns `columns`/`rows` plus datapreview
  metrics: `queryExecutionTimeMs`, `totalRows` (total matches), `rowsReturned`, and the `executedQueryString`.
  Run it with the **real filter values** from the slow request: a large `totalRows` / `queryExecutionTimeMs` for
  a small useful result = a scan/selectivity problem. It does **not** expose the HANA execution plan or buffer
  state — use ST05/HANA for those. A `SAPQuery` that **times out** is itself evidence of an unbounded scan —
  record the timeout as the signal, don't just retry with a smaller `maxRows`. (Needs `SAP_ALLOW_FREE_SQL` for
  freestyle SQL; multi-column `WHERE` via `SAPRead(type="TABLE_QUERY")` needs `SAP_ALLOW_DATA_PREVIEW`.)
- **Equality also slow? It's the view, not your filter.** If `SAPQuery` with an exact `WHERE key = '…'` is as
  slow as a `LIKE '%…%'` (both tens of seconds), the `LIKE` is a red herring — the cost is the CDS itself: a wide
  `SELECT DISTINCT`, a deep join the filter can't start from (the filtered field isn't index-leading), or an
  aggregate / `$count=true`. `cds_sql` shows the join order; the fix is to invert the join so the **selective**
  table leads, trim the `DISTINCT`/aggregate out of the list projection, or drop `$count=true` on a large scan —
  not to touch the `LIKE`.
- Compare signals: probe the OData URL, then run `SAPQuery` on the underlying CDS/base — if `queryExecutionTimeMs`
  is close to the OData `gwappdb`, the DB query is the cost; if OData is slow but the query is fast, it's the
  SADL/framework layer above. For the exact statement + execution plan, descend to ST05.
- Recommending a HANA full-text / `CONTAINS` / fuzzy fix? You **can't A/B-test it with `SAPQuery`** — the ADT
  freestyle endpoint is Open-SQL-only and rejects `CONTAINS(...)` / `… CP '*x*'` (`400 "(" is not allowed`).
  Prove it instead with an **ST05 trace during a live reproduce** of the real feature, or a one-off ABAP probe
  report. First confirm the table even has a full-text index: `SAPQuery(sql="SELECT indexname, full_text FROM
  dd12l WHERE sqltab = '<TABLE>'")` → `full_text = 'X'`.

### 3. App-bound → ABAP profiler trace (which code, which tables)
```
SAPDiagnose(action="traces")                                  # list recent profiler traces
SAPDiagnose(action="traces", id="<id>", analysis="hitlist")    # hottest call paths
SAPDiagnose(action="traces", id="<id>", analysis="dbAccesses") # which tables, counts, buffered?
```
The `dbAccesses` view tells you *which* tables a request hit and how often (N+1 shows up as a huge count on one
table). The `hitlist` tells you the ABAP hot path. ARC-1 can **arm** a profiler trace request itself —
`SAPDiagnose(action="trace_start", …)`, then `trace_requests` to list and `trace_cancel` to clean up — or record
one in SAT/ST12; then list/analyze it with the `traces` action above.

**Two caveats `trace_start` itself flags — heed them:** (1) an HTTP trace captures the user's *very next* matching
HTTP call, so after arming make **no** other ARC-1/MCP calls until the user has reproduced — your own ADT calls
will consume the trap. (2) For HTTP/OData traces on HANA the profiler is weak: `hitlist`/`statements` are usually
empty (or 400 `"Data is invalid…"`), and business tables hide inside a `<DB Access from Kernel>` bucket — use
`dbAccesses` only for "did we touch table X, how often", and use **ST05** (rung 4) for the actual OData SQL +
timings. The profiler is richest for dialog/report/RFC traces of ABAP-side code.

### 4. The exact SQL + plan → ST05 SQL trace
ARC-1 can **arm/disarm** the ST05 SQL trace and point you to the records (it can't read the records over ADT —
SAP has no SQL-record API; record viewing is the TMC Fiori app / SAP GUI ST05):
```
SAPDiagnose(action="sql_trace_state")                                   # is a trace already on?
SAPDiagnose(action="set_sql_trace_state", sqlOn=true, user="<SAPUSER>") # arm, filtered to the user (needs SAP_ALLOW_WRITES)
#   → user reproduces the slow request now ←
SAPDiagnose(action="sql_trace_directory")                               # SAP's "SQL Trace Analysis" deep-link
SAPDiagnose(action="set_sql_trace_state", sqlOn=false)                  # always disarm when done
```
Then read the records (see "SAP GUI / Fiori escalation"). The record list gives you the exact `SELECT`, its
**duration**, **rows fetched**, the object, and (in ST05) the **EXPLAIN / execution plan** + buffer state.
Available on 758/816; **not** on NW 7.50 (the `/st05/trace` ADT API returns 404 there — use SAP GUI ST05).

**Reading the records** (there is **no** `sql_trace_records`/`sql_trace_read` ADT action — `sql_trace_directory`
only returns the viewer link): open the deep-link (TMC "SQL Trace Analysis") **or** SAP GUI **ST05 → Display
Trace** → pick the app server + your trace file → sort by **Duration** desc → per row read the SQL text,
Duration, **Records** (rows fetched), Object (table/view); double-click the slowest → **Explain** for the HANA
plan. Look for: extra hits on association/text tables (SADL expansion), repeated identical `SELECT`s (N+1), or
Records ≫ visible rows (selectivity).

> If a perf endpoint 403s with "Service cannot be reached", ARC-1 surfaces an `icf-service-inactive` hint —
> activate the named SICF node (`/sap/bc/stmc` for the trace UI) in tcode SICF.

### 5. Static check (anytime)
`SAPDiagnose(action="atc", type="<type>", name=…, variant="PERFORMANCE_DB")` — flags perf anti-patterns
statically (it won't catch a runtime `LIKE` scan that depends on data, but it's free and catches the obvious
ones).

---

## SAP GUI / Fiori escalation (when ARC-1's GUI-free signals aren't enough)

ARC-1 is GUI-free up to the point of **reading SQL-trace records and execution plans** — for those, escalate.
Tell the user exactly what to open and what to look for; or, if you have a desktop/Chrome MCP and authorization,
drive it yourself (never on PROD without explicit sign-off).

| Tool | Where | What it gives you that ARC-1 can't |
|------|-------|------------------------------------|
| **ST05** (SQL/RFC/buffer/enqueue trace) | SAP GUI | The recorded `SELECT`s with duration + rows; **"Explain"** → the DB execution plan; identical-/similar-statement grouping; buffer hits. The ground truth for "which statement and why". |
| **SQL Trace Analysis** | Fiori app (the `sql_trace_directory` deep-link) | The same ST05 records in a browser (TMC) — use when SAP GUI isn't available. Needs `/sap/bc/stmc` SICF active. |
| **ST12 / SAT** | SAP GUI | Combined ABAP+SQL trace with aggregation — best for "where does the time really go" across app+DB in one capture. |
| **DBACOCKPIT / HANA** | SAP GUI / HANA Studio / DBeaver | `EXPLAIN PLAN`, **PlanViz**, `M_SQL_PLAN_CACHE`, table/index sizes, missing-index hints, optimizer stats freshness. The HANA-side root cause (column-store scan, no pruning, stale stats). |
| **ST22 / SM50 / SM66** | SAP GUI | Dumps (e.g. `TIME_OUT`, `TSV_*` memory) and what work processes are stuck on under load. |
| **SE11 / SE14** | SAP GUI | Indexes on the table, their fields, and whether the slow `WHERE` matches a usable index prefix. |
| **ABAP Cross Trace** | ADT (`/sap/bc/adt/crosstrace/*`, 758+) | RAP/OData-aware cross-layer trace incl. OData V4 request types — the strategic ADT-native record reader (ARC-1 follow-up; not yet a tool). |

**Capturing an OData request for `odata_perf`:** browser DevTools → Network → click the slow `$batch`/entity
request → copy the path after the host (e.g. `/sap/opu/odata4/sap/zsrv/…/Entity?$filter=…&$top=…`). That path is
the `url` argument.

---

## Root-cause catalog (pattern → confirm → fix)

| Symptom in the trace/SQL | Likely cause | Confirm | Typical fix |
|--------------------------|--------------|---------|-------------|
| Huge `rows fetched` ≫ rows shown; long duration | Full scan / poor selectivity | `cds_sql` shows no indexed `WHERE`; `SAPQuery totalRows` large / ST05 high rows fetched | Add a `WHERE` on indexed fields; add a secondary index (SE11); push the filter into the CDS |
| `LIKE '%term%'` | Leading-wildcard = index unusable | Read DDLS/ABAP source | Search help / fuzzy (HANA) / full-text index; anchor the pattern; pre-filter |
| Same table hit thousands of times | N+1 (SELECT in LOOP) | `traces dbAccesses` shows a giant count on one table | `FOR ALL ENTRIES` / a join / read-all-then-loop; RAP: prefetch |
| `SELECT *` then use 2 fields | Over-fetch | `cds_sql` / source | Select only needed fields; trim the CDS projection |
| Fast in DEV, slow in PROD | Data volume / stale stats / different plan | Compare `EXPLAIN` + table sizes (DBACOCKPIT) | Refresh optimizer stats; add index; partition |
| `gwappdb` small but OData slow | SADL / determinations / virtual elements / auth (DCL) | `odata_perf` verdict `app`/`auth`; profiler `hitlist` | Move logic to the DB/CDS; simplify DCL; cache; avoid per-row ABAP virtual elements |
| Slow only first call | Metadata / cold cache | `odata_perf` verdict `framework`; re-probe warm | Expected; warm-up; don't optimize the query |
| `TIME_OUT` / memory dump under load | Unbounded result / missing paging | ST22 + ST05 | Server-side paging (`$top`/`$skip`); add filters; package the work |

---

## Worked example (real, a4h S/4HANA 2023)

A "message-text search screen is slow" complaint. The query behind it:

```
SAPQuery(sql="SELECT sprsl, arbgb, msgnr, text FROM t100 WHERE text LIKE '%error%'")
→ { totalRows: 12549, queryExecutionTimeMs: 49.086, rowsReturned: 100,
    executedQueryString: "SELECT … FROM T100 WHERE TEXT LIKE '%error%' … UP TO 100 ROWS" }
```

Read it: **12 549 rows matched** a leading-wildcard `LIKE '%…%'` on a non-indexed text column → a full table
scan (the index is unusable because the pattern starts with `%`). The result the user actually wanted was a
handful of rows. **Fix:** drop the leading wildcard (anchor the search) / add a search help or full-text index /
pre-filter on an indexed field first. For the HANA plan + rows-fetched, arm an ST05 trace (rung 4), reproduce,
and open the directory deep-link.

This is the **simple** case — a single-table scan where the leading wildcard really is the bottleneck. On a
wide CDS view it often is **not**: if an exact-match `WHERE key = '…'` is just as slow as the `LIKE`, the cost is
the view's joins / `DISTINCT` / `$count`, not the wildcard (rung 2, "Equality also slow?"). Measure both before
you blame the `LIKE`.

---

## Output

Deliver a tight diagnosis, not a tool log:

1. **Verdict** — DB / app / framework / auth, with the number that proves it (e.g. "`gwappdb` 412 ms of `gwtotal`
   480 ms"). Cite the **SAP** figure (`gwtotal`/`gwappdb`), never `wallClockMs`: wall-clock also counts
   network/MCP/proxy (`odata_perf` returns that gap as `clientWaitMs`), so when `clientWaitMs` dwarfs `gwtotal`
   the latency is the landscape, not the query.
2. **The statement** — the offending SQL (from `cds_sql` / ST05) and what it scans (`SAPQuery totalRows` / ST05
   rows fetched, the table, the missing index).
3. **Root cause** — one sentence, mapped to the catalog above.
4. **Fix** — concrete and minimal (the index to add, the filter to push down, the N+1 to collapse), with the
   cheapest option first and the trade-off named.
5. **Evidence** — the exact ARC-1 calls run + any ST05/HANA-plan capture, so the user can re-verify.

Always **disarm any trace you armed**. On PROD, prefer read-only signals (`odata_perf`, `cds_sql`, `SAPQuery`,
read-only traces) and get explicit sign-off before arming an ST05 trace or touching state.
