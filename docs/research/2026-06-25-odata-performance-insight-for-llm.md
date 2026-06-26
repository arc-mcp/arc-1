# Giving an LLM insight into a slow OData (Fiori Elements) request — without SAP GUI

**Date:** 2026-06-25 · live on a4h (S/4HANA 2023, 758) · follow-up to
[abap-trace-requests-and-sapquery-metrics.md](2026-06-25-abap-trace-requests-and-sapquery-metrics.md).

**Problem:** a Fiori Elements app issues a slow OData V4 request. We want an LLM/MCP to explain *why* it's
slow — not just "the SQL" — using ADT-REST / HTTP signals, never SAP GUI. Researched across ADT APIs, the
Eclipse ADT api docs (`~/DEV/arc-1-eclipse-adt`), adt-ls (`~/DEV/arc-1-lsp`), other ADT-MCP repos, and live
probes on a4h.

## TL;DR — the winning signal is `sap-statistics`, which ARC-1 does not yet surface

Add `?sap-statistics=true` to the OData request → the response carries a **server-side timing decomposition**
in the `sap-statistics` header. The **query-param** form is richer than the `sap-statistics: true` *header*
form (live a4h, same call):

| Form | `sap-statistics` value |
|------|------------------------|
| request **header** `sap-statistics: true` | `icftotal=299, icfauth=41, icfext=264, icmtotal=313, icmreqrcv=2, icmext=311` |
| **query param** `?sap-statistics=true` | `gwtotal=173, gwfw=38, gwnongw=4, gwapp=131, gwappfw=25, gwappdb=100, icftotal=220, icfauth=0, icfext=178, …` |

Field meanings (NetWeaver Gateway perf stats):
- `gwtotal` total Gateway processing · `gwfw` GW framework · `gwapp` application (data provider) total
- **`gwappdb` = application DATABASE time** ← the CDS/HANA time (here **100 ms of 173 ms**)
- `gwappfw` app framework · `gwnongw` non-GW · `icftotal/icfauth/icfext` ICF layer · `icmtotal/…` ICM layer
- `sap-perf-fesrec` (separate header) = the FESR / SAP-Passport E2E record in µs.

**Why this is the right tool:** it answers "where did the time go" in one cheap call —
DB (`gwappdb`) vs app/ABAP (`gwapp−gwappdb`) vs framework (`gwfw`) vs auth (`icfauth`) — and routes the LLM to
the correct deeper signal. ARC-1's HTTP client already fetches arbitrary paths on the SAP host (used it to hit
the OData URL); it just doesn't issue OData calls as a tool or parse this header.

## Recommended capability: an "OData performance probe" tool

`SAPDiagnose action=odata_perf url="/sap/opu/odata4/…?$filter=…"` (or a new tool):
1. GET the URL with `?sap-statistics=true` + a wall-clock timer.
2. Return: HTTP status, wall-clock ms, the **parsed `sap-statistics` map**, response bytes, `@odata.count` if present.
3. Add a verdict that routes: high `gwappdb` → DB-bound (→ SAPQuery `queryExecutionTime` on the CDS, or ST05);
   high `gwapp−gwappdb` → ABAP/SADL; high `gwfw` → metadata/framework (1st-call cost); high `icfauth` → auth.

This is more useful for the Fiori/OData case than the abaptraces trace (which gives "which tables", not timing —
see the sibling dossier). Scope: it executes a query → gate like SAPQuery (`data`/`sql`); read-only GET; works
when the OData service is on the same SAP host ARC-1 connects to (on-prem; BTP if same destination).

## Full signal inventory (ADT-REST / HTTP accessible = LLM-usable)

| Signal | How | LLM-usable? | What it tells you about a slow OData call |
|--------|-----|-------------|-------------------------------------------|
| **`sap-statistics` breakdown** | `?sap-statistics=true` on the OData URL | ✅ **yes (not yet in ARC-1)** | **WHERE the time is**: DB vs app vs framework vs auth. Best first signal. |
| datapreview `queryExecutionTime` + `totalRows` | `POST /sap/bc/adt/datapreview/freestyle` (SAPQuery) | ✅ shipped | The CDS/SQL execution time + match count, tested directly (bypasses OData). Confirms DB cost. |
| ABAP profiler `dbAccesses` | `…/abaptraces/{id}/dbAccesses` (SAPDiagnose traces) | ✅ shipped | WHICH tables a request touched (CDS entity + `/IWFND/*` framework). No per-stmt timing on HTTP traces. |
| ATC `PERFORMANCE_DB` variant | `POST /sap/bc/adt/atc/runs` (SAPDiagnose atc) | ✅ shipped | Static perf anti-patterns in the CDS/ABAP. **Live: `findings: []` for our view** — blind to runtime `LIKE` scans. |
| where-used / CDS deps | `/repository/informationsystem/…` (SAPContext impact) | ✅ shipped | Impact, not timing. |
| Gateway error log | `/sap/bc/adt/gw/errorlog` (SAPDiagnose gateway_errors) | ✅ shipped | Errors, not slow-but-OK calls. |
| FESR / SAP Passport | `sap-perf-fesrec` header (µs) | ⚠️ header present | Finer E2E sub-records, but the binary/aggregate FESR format is heavy to decode; `sap-statistics` is enough. |

### Confirmed NOT available via ADT REST (GUI/HANA only)
- **ST05 SQL trace** (exact SQL + HANA plan + memory): `/sap/bc/adt/runtime/traces/sql` → **404 live**; no REST surface (FEAT-09). The real `SELECT … LIKE '%…%'` + 82 ms HANA + 414 MB only via ST05 GUI.
- **`/IWFND/STATS` Gateway statistics** transaction: no ADT endpoint (but `sap-statistics` is the per-request equivalent).
- **HANA EXPLAIN / PlanViz / `M_SQL_PLAN_CACHE`**: HANA-native; not via ADT (possibly via Open SQL on monitoring views if authorized — unverified).
- **SADL / RAP runtime per-step timing**: no dedicated REST trace.
- **SQLM** `/sap/bc/adt/sqlm/data`: endpoint EXISTS but returns `400 ExceptionParameterNotFound` without the right query params, and SQLM must be activated (sampling monitor). Worth a follow-up spike if aggregated-over-time SQL stats are wanted; not needed for single-request "why slow".

## Recommended LLM diagnostic flow for "this OData request is slow"
1. **`sap-statistics` probe** the exact failing URL → read `gwtotal` and the split. (the new tool above)
2. If **`gwappdb` dominates** → it's the DB/CDS query → `SAPQuery "SELECT … FROM <cds/base> WHERE …"` to get
   `queryExecutionTime` + `totalRows` (confirms scan cost; you saw 30 525 matches / ~100 ms), and read the CDS
   source (`SAPRead DDLS`) for the `LIKE`/`contains`/missing-filter cause. For the HANA plan → ST05 (GUI).
3. If **app−db dominates** → ABAP/SADL: arm an abaptraces trace, read `dbAccesses`/`hitlist` for the ABAP hot path.
4. If **`gwfw` dominates** and it's the first call → metadata/cold-cache; re-probe to see warm-cache delta.
5. If **`icfauth` dominates** → auth/DCL overhead.

This turns "it's slow" into a routed, mostly-GUI-free diagnosis — and `sap-statistics` is the missing piece
ARC-1 should add.
