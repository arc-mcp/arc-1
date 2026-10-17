# SQL notebooks

Save a repeatable investigation as Markdown and SQL cells, then explicitly run it through the
configured ARC-1 connection. The runner uses SAPQuery's existing authorization, SQL policy and
data limits. It adds no credentials or permissions. Available in builds containing this workflow;
the published 1.6.0 package does not include it.

## Import without executing

```bash
arc1-cli notebook import Flight_Capacity_Showcase.abapsql \
  --destination A4H2023-2 --target dev --out flight.notebook.json
```

This adapts the observed ADT for VS Code 1.2 format. It creates a document and makes no SAP calls.
The editor destination is a label, not a permission grant. Unknown fields remain under `imported`
as inert metadata (reserved JavaScript structural keys such as `__proto__` are omitted); a source field named `assertion` cannot become an executable ARC-1 check.
The same source produces stable cell IDs. Existing output files are refused. The formatted imported
document must also fit the 1-MiB input limit; no oversized output file is written.

## Run explicitly

```bash
arc1-cli notebook run flight.notebook.json --target dev --output-dir runs/flight-01
# Include returned rows and actual assertion values only when needed:
arc1-cli notebook run flight.notebook.json --target dev --include-results --output-dir runs/flight-02
```

`--target dev` maps the document's logical `dev` label to the existing configured CLI connection.
All SQL cells must use that mapped label; another target is rejected before any SQL. This CLI does
not discover destinations or configure multi-system access. Review the SQL and current connection
before running a document received from someone else. Execution remains subject to administrator
SQL/data policies and SAP authorization.

Each run creates private `evidence.json` and `report.html` files in a new directory. Results are
excluded by default, but SQL, expected values and error messages can still contain sensitive data.
HTML displays escaped text and contains no scripts. Markdown source is shown as text. Validation
failure removes only the empty directory reserved by this run, so corrected input can reuse the path.

## Document format

```json
{
  "schemaVersion": 1,
  "title": "Flight capacity check",
  "cells": [
    { "id": "notes", "kind": "markdown", "value": "Check for negative booked-seat counts." },
    {
      "id": "flights",
      "kind": "sql",
      "target": "dev",
      "maxRows": 20,
      "value": "SELECT * FROM /DMO/FLIGHT WHERE seats_occupied < 0",
      "assertion": {
        "sql": "SELECT COUNT( * ) AS N FROM /DMO/FLIGHT WHERE seats_occupied < 0",
        "column": "N",
        "equals": "0 "
      }
    }
  ]
}
```

Cell IDs are unique and remain stable when editing an ARC-1 document. There is no parameter
substitution, auto-run on import, stored connection credential or interactive editor.

## Interpret the evidence

| Field / state | Meaning |
|---|---|
| Cell `success` | Valid detail result with no known missing rows for that query |
| `incomplete` | Limited/unknown rows, export limit, cancellation or collection limit |
| `blocked` | Existing ARC-1 policy refused the call |
| `error` | Backend failure or malformed/contradictory evidence |
| `not-run` | The cell was not started after cancellation or a collection limit |
| Assertion `passed` / `failed` | Its separate scalar result equals / differs from the expected string |
| Run `partial`, exit 1 | At least one cell or assertion was blocked, failed, incomplete, unavailable or not run |
| Run `success`, exit 0 | All executed detail cells and requested assertions succeeded |

A full page without an authoritative total stays incomplete. Detail completeness describes the
submitted query, not the entire table. Grouped aggregates and DISTINCT detail queries can remain
incomplete when SAP counts matching input records; only the proven scalar case below overrides that count. Whole-data assertions use their own aggregate SELECT,
never the limited detail rows. Queries run sequentially and are not an atomic snapshot.

Assertions accept one classic `SELECT COUNT/SUM/AVG/MIN/MAX( column ) AS alias FROM ...`
projection; `COUNT( * )` and simple `DISTINCT` arguments are supported. Use a static source and
optional filters/joins. Comments, grouping, windows, arithmetic projections, subqueries, host
expressions and paging are refused before execution. The expected value is a string, compared
exactly without number conversion; `0`, `0.00` and a blank remain different values.

Scalar results preserve SAP strings exactly, including trailing spaces (the verified COUNT example
returns `"0 "`). Set `equals` from the returned value; ARC-1 does not trim or convert numbers.
For a proven scalar aggregate, `totalRows` can describe matched input records rather than output
rows. Completeness requires exactly one returned row and no explicit truncation; the report
retains the original backend count and marks `scalarAggregate: true`.

Evidence includes SQL/hash, configured target/client, start/finish time, elapsed time, returned row
count, completeness, SAP timing when available and separate assertion outcomes. Result strings
retain leading zeros, whitespace and decimal precision. Invalid column/count metadata cannot pass.

## Bounds

| Bound | Limit |
|---|---|
| Input | Regular UTF-8 JSON file, 1 MiB; 50 cells; 64 Ki characters per cell |
| Rows | 1–10,000 per detail query; two rows requested for scalar assertions |
| Calls | Sequential; at most one detail and one assertion per SQL cell |
| Duration | Five-minute run deadline; cancellation reaches in-flight data requests |
| Responses | Existing server byte/concurrency limits, plus 4 MiB per tool reply |
| Collection | Stop after 8 MiB of returned query evidence; the final rejected reply can add up to 4 MiB |
| Export | At most 4 MiB of rows/columns/actual values; omitted data is explicit |
| Files | New directory only, private permissions, no silent overwrite |

Startup authentication/discovery uses the existing CLI machinery; cancellation does not introduce
new timeout behavior for those metadata probes. No new SQL offset paging is invented. Use focused
queries or aggregates when results exceed the limits.
