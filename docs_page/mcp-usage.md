# Using the tools

Start with a small read, choose the tool for your task, and inspect its result before sending the
next call. Examples below use tool-call notation; your MCP client supplies the actual JSON request.
For every parameter and supported object type, use the [tool reference](tools.md).

## Check the connection

```text
SAPRead(type="SYSTEM")
```

Confirm the intended SAP system and release before a batch of calls. If this fails, resolve the
connection or authentication error before starting parallel work.

## Choose a tool

| You need to… | Start with |
|---|---|
| Find an object | `SAPSearch(query="ZCL_ORDER*")` |
| Understand an object's purpose and dependencies | `SAPContext(action="deps", type="CLAS", name="ZCL_ORDER")` |
| Check exact implementation behavior | `SAPRead(type="CLAS", name="ZCL_ORDER", method="get_name")` |
| Read your unactivated draft | `SAPRead(type="CLAS", name="ZCL_ORDER", version="inactive")` |
| Assess a CDS change | `SAPContext(action="impact", type="DDLS", name="ZI_ORDER")` |
| Find consumers | `SAPNavigate(action="references", type="CLAS", name="ZCL_ORDER", maxResults=20)` |
| Read a few data rows | `SAPRead(type="TABLE_QUERY", name="T000", columns=["MANDT","MTEXT"], maxRows=10)` |
| Run SQL with joins or aggregates | `SAPQuery(sql="SELECT carrid, COUNT(*) AS cnt FROM sflight GROUP BY carrid", maxRows=20)` |
| Check syntax or run tests | `SAPDiagnose(action="syntax", type="CLAS", name="ZCL_ORDER")` or `action="unittest"` |

Table data and SQL require separate server opt-ins and user scopes. Writes also require an allowed
package. See [Authorization](authorization.md) when a capability is unavailable.

## Understand an object

1. Read its context:

   ```text
   SAPContext(action="deps", type="CLAS", name="ZCL_ORDER")
   ```

   This returns the Knowledge Transfer Document (KTD), when available, and selected dependency
   contracts. Compare those requirements with the implementation; existing behavior alone does
   not establish intended behavior.

2. Read the source relevant to your question:

   ```text
   SAPRead(type="CLAS", name="ZCL_ORDER", method="*")
   SAPRead(type="CLAS", name="ZCL_ORDER", method="get_name")
   SAPRead(type="CLAS", name="ZCL_ORDER", include="testclasses")
   ```

   Omit `include` to read the global class declaration and implementation. `definitions` and
   `implementations` hold **local helper classes**. A qualified method such as
   `lhc_travel~accept` automatically selects the local implementation include.

3. State the limits of the evidence. Dependency contracts omit method bodies. Static references do
   not prove runtime execution, and a capped or empty search does not prove a complete inventory.

For CDS views, use the same `deps` → targeted `SAPRead` sequence with `type="DDLS"`.

## Create or change an object

Before editing, read the current source and use a method-level edit when only one method changes.
For transportable packages, resolve the transport before writing:

```text
SAPTransport(action="check", type="CLAS", name="ZCL_ORDER", package="ZDEV")
SAPTransport(action="list")
```

Use an appropriate modifiable transport returned by SAP. If the task requires a new transport,
create one with `SAPTransport(action="create", description="Order validation", package="ZDEV")`.
Pass its returned ID to the write:

```text
SAPWrite(action="create", type="CLAS", name="ZCL_ORDER",
  package="ZDEV", transport="<returned transport ID>", source="<complete class source>")
SAPActivate(type="CLAS", name="ZCL_ORDER")
```

Check each result before continuing. Use `SAPDiagnose(action="syntax", ..., version="inactive")`
to inspect saved drafts before activation; use `action="unittest"` after activation when tests
apply. A timeout or incomplete diagnostic result is not a passing check.

### Related objects and RAP

Create dependencies first. Confirm that the connected release supports the proposed syntax; a
successful connection does not establish support for every CDS or RAP feature.

`SAPWrite(action="batch_create")` accepts shared `package` and `transport` values and per-object
overrides. Inspect partial results before retrying: some objects may already have been created.
Activate dependent objects together with `SAPActivate(objects=[...])`.

Use the [RAP service skill](skills.md) for a complete workflow, and the
[SAPWrite reference](tools/sap-write.md) for batch and behavior-implementation options.

Before recreating named objects, check whether they already exist across packages:

```text
SAPSearch(searchType="tadir_lookup",
  names=["ZORDER","ZI_ORDER","ZUI_ORDER_O4"], objectTypes=["TABL","DDLS","SRVB"])
```

## Query data

Prefer `TABLE_QUERY` for a structured projection and filter:

```text
SAPRead(type="TABLE_QUERY", name="MARA", columns=["MATNR"],
  where=[{field:"MATNR", op:"LIKE", value:"Z%"}], maxRows=10)
```

Use `SAPQuery` for ABAP SQL joins or aggregates. The ADT endpoint expects these conventions:

| Need | Use |
|---|---|
| Qualified field | `alias~field` |
| Sort direction | `ASCENDING` or `DESCENDING` |
| Row limit | The `maxRows` tool parameter |
| Aggregate plus other selected fields | List every non-aggregated field in `GROUP BY` |
| Result target | Omit ABAP `INTO`, `APPENDING`, and `PACKAGE SIZE` clauses |

Avoid legacy `TABLE_CONTENTS.sqlFilter` in portable automation; its payload differs across SAP
versions. On SAP_BASIS 758, use `<>` for `TABLE_QUERY` inequality because SAP rejects `!=`.
Row limits and byte limits both apply. See [SAPQuery](tools/sap-query.md) for query chunking,
backend parser limits, and data-source restrictions.

## Investigate a problem

| Problem | First call or check |
|---|---|
| Short dump | `SAPDiagnose(action="dumps", maxResults=10)`, then repeat with the returned `id` |
| Message text | `SAPRead(type="MSAG", name="ZMSG")` |
| CDS UI fields differ between related views | `SAPContext(action="impact", type="DDLS", name="ZI_ORDER")`; inspect `consistencyHints` and metadata extensions |
| Source differs from the editor | Read with `version="inactive"` or `version="auto"` |
| Suspected cache issue | Repeat a source read with `force_refresh=true` |

For sibling CDS checks, use `siblingMaxCandidates` to bound work or `siblingCheck=false` to skip
that analysis. Read the identified DDLX source to confirm the issue.

## Handle errors and incomplete results

| Result | Next step |
|---|---|
| Object not found | Check spelling and type with `SAPSearch`; pass `group` for function modules |
| Package requires transport | Check transport requirements and retry with a returned ID |
| Package or action denied | Ask the administrator to review the configured policy |
| Startup authentication preflight failed | Fix credentials, client, or authorization and restart; do not repeat blocked calls |
| SQL parser error | Check ABAP SQL syntax and the endpoint's supported form |
| `DATA_RESPONSE_TOO_LARGE` | Request fewer rows/columns or a narrower key range |
| HTTP 502/503 | Check system availability before retrying |
| Write returns an uncertain result | Read the object or operation status before retrying the mutation |

For a SAP 500 error, inspect diagnostics such as short dumps. Repeating the same mutation can
compound a partial change. Follow the returned error details and the
[log analysis guide](log-analysis.md).

## Keep calls focused

- Use a small `maxResults`, `maxRows`, or `maxDeps` initially; widen only when needed.
- Use `method` or `grep` to retrieve relevant source. They cannot be combined.
- Use `SAPContext` for selected API contracts; read full source when implementation matters.
- Check `complete`, truncation, coverage, and warning fields before drawing conclusions.
- Reuse the source already returned when a tool accepts it; source reads revalidate cached bodies
  with SAP. See [Caching](caching.md).
