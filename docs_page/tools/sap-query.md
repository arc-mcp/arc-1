# SAPQuery

Read SAP table data with ABAP SQL. Requires `SAP_ALLOW_FREE_SQL=true` and the `sql` scope. For structured single-table filters, use [SAPRead TABLE_QUERY](sap-read.md).

```text
SAPQuery(sql="SELECT carrid, connid FROM sflight WHERE carrid = 'LH'", maxRows=20)
```

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sql` | string | Yes | ABAP SQL SELECT statement |
| `maxRows` | number | No | Maximum rows (default 100, clamped to 10,000). This is a request ceiling, not a guaranteed result size: wide results can hit the server byte ceiling much earlier. |

Successful data-preview bodies share one cumulative allowance across the complete tool call,
including automatic `IN`-list chunks. The default is 2 MiB of decompressed transfer bytes, counted
before string conversion. Crossing the configured allowance returns `DATA_RESPONSE_TOO_LARGE`
without partial rows or an automatic retry. Submit a new request with lower `maxRows`, fewer
selected columns, or a restrictive, non-overlapping key-range `WHERE` clause.

**Important:** Uses the ADT freestyle SQL endpoint (`/sap/bc/adt/datapreview/freestyle`) with ABAP SQL syntax, NOT standard SQL:
- Use `alias~field` for qualified fields (not `alias.field`; a dot ends the ABAP statement)
- Use `ASCENDING`/`DESCENDING` (not `ASC`/`DESC`)
- Use `maxRows` parameter (not `LIMIT`)
- `GROUP BY`, `COUNT(*)`, `WHERE` all work
- ABAP SQL aggregate rule applies: non-aggregated selected fields must be listed in `GROUP BY`

JOINs, aggregates, and subqueries are supported. For a plain projection `SELECT`, ARC-1 automatically chunks the longest literal `IN (...)` list—even when the query has several `IN` clauses—and merges the rows. Queries with `ORDER BY`, `GROUP BY`, `HAVING`, `DISTINCT`, `UNION`, or aggregates are sent whole because concatenating per-chunk results would change their semantics. If SAP rejects a long list in these queries, narrow or reformulate the query. Manual partitioning
requires a query-specific merge: concatenation and sorting alone do not preserve aggregates,
HAVING, DISTINCT, or all set-operation semantics.

See: [SAPQuery Freestyle Capability Matrix](https://github.com/arc-mcp/arc-1/blob/main/docs/research/2026-04-21-sapquery-freestyle-capability-matrix.md)

## Examples

```
SAPQuery(sql="SELECT carrid, COUNT(*) as cnt FROM sflight GROUP BY carrid ORDER BY cnt DESCENDING")
SAPQuery(sql="SELECT * FROM mara WHERE matnr LIKE 'Z%'", maxRows=50)
```

**Note:** Not available by default (free SQL blocked). Enable with `SAP_ALLOW_FREE_SQL=true` / `--allow-free-sql=true`. User also needs the `sql` scope (or API-key profile `viewer-sql`/`developer-sql`/`admin`).


## Data-source restrictions and errors

When `SAP_BLOCKED_DATA_SOURCES` is non-empty, SAPQuery is restricted to one statically provable
`SELECT`/`WITH`. ARC-1 extracts every join/union/subquery/CTE source and checks live CDS plus DDIC
replacement lineage before sending the query, authorizing the whole request once even when IN-list
chunking splits it. Supported: joins, unions, nested subqueries, CTEs, parameterized CDS roots,
hierarchy sources, aggregates. Refused: ABAP comments, host expressions, `FOR ALL ENTRIES`, dynamic
sources, `WITH PRIVILEGED ACCESS`, client override, secondary connections, association/column paths,
`SELECT SINGLE`, caller `INTO` targets, multiple statements and CDS table functions.

Outcomes are three stable codes — `DATA_SOURCE_BLOCKED`, `DATA_LINEAGE_UNRESOLVED` and
`DATA_SQL_UNSUPPORTED` — each meaning the SAP request was **not executed**, each carrying
`executed=false` and a `decisionId` that also appears in the server audit log. The empty default keeps
current behavior and adds no metadata calls; a non-empty list is slower by design. This experimental
blocklist is not an allowlist and not a replacement for SAP authorization or CDS DCL. See
[Authorization & Roles](../authorization.md#experimental-data-source-blocklist).

> **Self-correcting errors.** An unknown *table* yields a "Did you mean …?" suggestion; an unknown *column* (here or in `SAPRead type=TABLE_QUERY`) yields the table's actual column list (`Unknown column "X" on T000. Available columns: MANDT, MTEXT, …`), so the agent retries in one shot. Best-effort: if column discovery is unavailable (e.g. the `datapreview` endpoint is unbound on older NW 7.50 SPs), the original error is returned unchanged.

[All tools](../tools.md)
