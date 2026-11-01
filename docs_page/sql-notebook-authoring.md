# Create a notebook for SAP's VS Code extension

Ask your agent to save a native `.abapsql` file, then open it with **ABAP Development
Tools for VS Code**. SAP's extension handles editing, syntax checks and execution.
ARC-1 can help discover table fields and try individual queries through `SAPQuery`.

## Start with an example

Copy the [flight example](https://github.com/arc-mcp/arc-1/blob/main/examples/notebooks/flight.abapsql)
to your workspace. It uses SAP's `/DMO` demo tables; adapt it if those tables are absent.

1. Open the `.abapsql` file in VS Code. If it opens as text, use **Reopen Editor
   With… → ABAP SQL Notebook**. To start empty, run **ABAP: SQL Notebook**.
2. Select each SQL cell and run **ABAP: Set Cell System**. The example deliberately
   has no system binding. Choose your existing destination; do not invent one.
3. Review the SQL, then use **ABAP: Set Cell Max. Rows** and **ABAP: Check Cell Syntax**.
   A row cap limits returned rows, not necessarily database work.
4. Run the intended cells explicitly and save the file. Opening it does not execute SQL.

Execution uses the extension's own destination and SAP identity. SAP authorization
still applies; ARC-1's SQL/data gates, blocklist, deny rules, scopes and audit do not.
ARC-1 controls apply only when a query is sent through ARC-1.

## Ask an agent to create one

> Create a native SAP `.abapsql` notebook for [question]. Verify table and field
> names with the available ARC-1 tools. Put the purpose and result interpretation
> in Markdown cells, followed by focused ABAP SQL cells with `rowNumber: 20`.
> Omit `destination` so I can select the system in VS Code. Save the file without
> executing it. Use a separate aggregate query when the question needs a count
> over all matching records; do not infer that count from a capped detail result.

The file is ordinary UTF-8 JSON. This is the format observed in SAP extension **1.2.0**:

```json
{
  "cells": [
    { "kind": "markdown", "value": "# Flight count\nCount the matching flights." },
    { "kind": "sql", "value": "SELECT COUNT( * ) AS N FROM /DMO/FLIGHT", "rowNumber": 20 }
  ]
}
```

| Field | Meaning |
|---|---|
| `cells` | Ordered Markdown and SQL cells |
| `kind` | `markdown` or `sql` |
| `value` | Markdown or ABAP SQL text |
| `destination` | Optional exact extension destination name; set through the editor |
| `rowNumber` | Optional integer row cap; extension default 100, editor range 1–100,000 |

The extension saves these fields, not arbitrary custom metadata, assertions or
result rows. Keep durable notes in Markdown cells. This observed serialization is
not a versioned SAP interchange specification; recheck it after extension updates.
No ARC-1-specific `schemaVersion`, cell IDs, target mapping or import step is needed.
Validate the JSON before opening: malformed JSON opens as an empty SQL cell in
1.2.0, and saving that state replaces the original contents. The supplied example
already matches the serializer's formatting. ARC-1's separate `maxRows` cap is 10,000.

## Interpret query results

Use ABAP SQL (`alias~field`, `DESCENDING`), and a row cap rather than SQL `LIMIT`.
See [SAPQuery syntax and backend limits](tools.md#freestyle-sql-behavior).

For ARC-1 query responses, `rowsReturned` counts output rows. SAP's `totalRows`
can describe matching input records. Observed on SAP_BASIS 758: a scalar `COUNT`
returns one row containing `"0 "` while `totalRows` is `0`. Read the aggregate value from its result column.
Values remain strings, including padding, leading zeros and decimal precision.
Separate cell executions are not an atomic snapshot.

[SAP extension](https://marketplace.visualstudio.com/items?itemName=SAPSE.adt-vscode)
· [Extraction decision and validation](https://github.com/arc-mcp/arc-1/blob/main/docs/research/2026-10-17-notebook-extraction.md)
