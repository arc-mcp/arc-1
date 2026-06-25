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

### 0. Orient (no execution)
- `SAPContext(action="deps", name=…)` / `SAPRead(type="DDLS", name=…)` — read the CDS/ABAP source. Eyeball it
  for the usual suspects **before** measuring: `LIKE '%term%'` (leading wildcard = no index), `SELECT … FROM`
  with no `WHERE` on a key, `SELECT *`, nested `SELECT` in a `LOOP` (N+1), client-side filtering, missing
  `FOR ALL ENTRIES` pre-check, calculated fields forcing a full scan.
- `SAPContext(action="impact", type="DDLS", name=…)` — the CDS stack (projection → base views → tables). The
  slow view is often a thin projection over a heavy base.

### 1. Where did the time go? (one cheap call)
For an **OData / Fiori** request:
```
SAPDiagnose(action="odata_perf", url="/sap/opu/odata4/sap/…/Entity?$filter=…")
```
Read the `verdict`:
- **`db`** (`gwappdb` dominates) → the CDS/SQL query is the cost → go to rung 2.
- **`app`** (`gwapp − gwappdb`) → ABAP/SADL logic, not the DB → go to rung 3 (profiler trace).
- **`framework`** (`gwfw`/`gwhub`) → metadata / first-call / cold cache → re-probe warm; usually not your query.
- **`auth`** (`icfauth`) → ICF/DCL authorization overhead.
- **`unknown`** → no per-component split on this release (e.g. 7.50 reports only `gwhub`); treat as Gateway
  time and descend to a trace anyway.

(`odata_perf` needs `SAP_ALLOW_DATA_PREVIEW`; the OData service must be on the SAP host ARC-1 connects to.)

### 2. DB-bound → see and measure the actual SQL
- `SAPDiagnose(action="cds_sql", name="I_TheView")` — the **native `CREATE VIEW`** the CDS compiles to. Now you
  see the real joins, `CAST`s, `COALESCE`s, and whether a sub-view drags in extra tables.
- `SAPQuery("SELECT … FROM <cds-or-base> WHERE <the filter> ")` — returns `queryExecutionTimeMs`, `totalRows`,
  and the `executedQueryString`. Run it with the **real filter values** from the slow request. A big
  `totalRows` scanned for a small result = a scan/selectivity problem. (Needs `SAP_ALLOW_FREE_SQL` for
  freestyle SQL; multi-column `WHERE` via `SAPRead(type="TABLE_QUERY")` needs `SAP_ALLOW_DATA_PREVIEW`.)
- Compare timings: probe the OData URL, then run `SAPQuery` on the underlying CDS — if both are slow, it's the
  DB; if only OData is slow, it's the SADL/framework layer above.

### 3. App-bound → ABAP profiler trace (which code, which tables)
```
SAPDiagnose(action="traces")                                  # list recent profiler traces
SAPDiagnose(action="traces", id="<id>", analysis="hitlist")    # hottest call paths
SAPDiagnose(action="traces", id="<id>", analysis="dbAccesses") # which tables, counts, buffered?
```
The `dbAccesses` view tells you *which* tables a request hit and how often (N+1 shows up as a huge count on one
table). The `hitlist` tells you the ABAP hot path. (Traces must already be recorded; arm them in SAT/ST12 or via
the profiler-trace request API.)

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

> If a perf endpoint 403s with "Service cannot be reached", ARC-1 surfaces an `icf-service-inactive` hint —
> activate the named SICF node (`/sap/bc/stmc` for the trace UI) in tcode SICF.

### 5. Static check (anytime)
`SAPDiagnose(action="atc", name=…, variant="PERFORMANCE_DB")` — flags perf anti-patterns statically (it won't
catch a runtime `LIKE` scan that depends on data, but it's free and catches the obvious ones).

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
| Huge `rows fetched` ≫ rows shown; long duration | Full scan / poor selectivity | `cds_sql` shows no indexed `WHERE`; `SAPQuery totalRows` large | Add a `WHERE` on indexed fields; add a secondary index (SE11); push the filter into the CDS |
| `LIKE '%term%'` | Leading-wildcard = index unusable | Read DDLS/ABAP source | Search help / fuzzy (HANA) / full-text index; anchor the pattern; pre-filter |
| Same table hit thousands of times | N+1 (SELECT in LOOP) | `traces dbAccesses` shows a giant count on one table | `FOR ALL ENTRIES` / a join / read-all-then-loop; RAP: prefetch |
| `SELECT *` then use 2 fields | Over-fetch | `cds_sql` / source | Select only needed fields; trim the CDS projection |
| Fast in DEV, slow in PROD | Data volume / stale stats / different plan | Compare `EXPLAIN` + table sizes (DBACOCKPIT) | Refresh optimizer stats; add index; partition |
| `gwappdb` small but OData slow | SADL / determinations / virtual elements / auth (DCL) | `odata_perf` verdict `app`/`auth`; profiler `hitlist` | Move logic to the DB/CDS; simplify DCL; cache; avoid per-row ABAP virtual elements |
| Slow only first call | Metadata / cold cache | `odata_perf` verdict `framework`; re-probe warm | Expected; warm-up; don't optimize the query |
| `TIME_OUT` / memory dump under load | Unbounded result / missing paging | ST22 + ST05 | Server-side paging (`$top`/`$skip`); add filters; package the work |

---

## Output

Deliver a tight diagnosis, not a tool log:

1. **Verdict** — DB / app / framework / auth, with the number that proves it (e.g. "`gwappdb` 412 ms of 480 ms").
2. **The statement** — the offending SQL (from `cds_sql` / ST05) and what it scans (`totalRows`, the table,
   the missing index).
3. **Root cause** — one sentence, mapped to the catalog above.
4. **Fix** — concrete and minimal (the index to add, the filter to push down, the N+1 to collapse), with the
   cheapest option first and the trade-off named.
5. **Evidence** — the exact ARC-1 calls run + any ST05/HANA-plan capture, so the user can re-verify.

Always **disarm any trace you armed**. On PROD, prefer read-only signals (`odata_perf`, `cds_sql`, `SAPQuery`,
read-only traces) and get explicit sign-off before arming an ST05 trace or touching state.
