---
name: generate-cds-analytical-query
description: Generate an analytical CDS query (transient projection view with PROVIDER CONTRACT ANALYTICAL_QUERY) on top of an existing analytical cube. Use when asked to "create an analytical query", "build a KPI query on a cube", "generate an ANALYTICAL_QUERY view", or "expose a cube for analytics/embedded analytics".
---

# Generate CDS Analytical Query

Generate an analytical CDS query — a **transient projection view** with `provider contract analytical_query` — on top of an existing analytical cube (`@Analytics.dataCategory: #CUBE`).

This skill replicates SAP Joule's "CDS Analytical Query Generation" capability by combining ARC-1 (SAP system access) with mcp-sap-docs (documentation & best practices). The query view is what end users consume in analytical clients (SAP Analytics Cloud, Analysis for Office, embedded analytics) — it selects measures and dimensions from a cube and arranges them on rows/columns/free axes.

## Prerequisites — read this first

- **Requires SAP_BASIS 7.57+ (S/4HANA 2022+).** The `provider contract analytical_query` form is unavailable on 7.56 and earlier. Verify with `SAPManage(action="probe")` (checks `rap.available`) — if RAP/CDS isn't available, stop and tell the user.
- **You need an existing cube.** This skill projects ON a cube. If no cube exists yet, run the `generate-analytics-star-schema` skill first to build the cube + dimensions, then come back here.

## Smart Defaults (apply silently, do NOT ask)

| Setting | Default | Rationale |
|---|---|---|
| Object type | `DDLS` | Analytical queries are CDS data definitions |
| Package | `$TMP` | Fast prototyping; ask before a transportable package |
| Authorization | `#NOT_ALLOWED` | **Mandatory** on analytical queries — any other value fails activation |
| Axis layout | Dimensions → `#ROWS`, measures → `#COLUMNS` | Sensible default grid; user can rearrange |
| ATC | No | Only run if user asks about code quality |

## Input

The user provides a cube name (e.g., `ZI_SALES_CUBE`) or a business description ("revenue by region and month"). Only the **cube** is strictly required; if the user gives a description, find the cube via Step 1.

Optionally:
- **Query name** (default: derive from the cube, e.g. `ZC_SalesQuery`; **must be ≤ 28 characters** — the analytical engine prepends `2C` to the runtime name)
- **Package** (default `$TMP`)
- **Measures / dimensions to expose** (default: all measures + key dimensions from the cube)

## Step 1: Resolve and read the cube

### 1a. Find the cube (if the user gave a description, not a name)

```
SAPSearch(query="<keyword>*", searchType="object", objectType="DDLS")
```

Pick the candidate whose name/description matches an analytical cube. If multiple match, list them and ask.

### 1b. Read the cube source and confirm it IS a cube

```
SAPRead(type="DDLS", name="<cube>")
```

**Verify** the source contains `@Analytics.dataCategory: #CUBE` (or `@Analytics: { dataCategory: #CUBE ... }`). If it does NOT, stop: an analytical query can only project on a cube or a dimension. Suggest `generate-analytics-star-schema` to build a cube first.

### 1c. Get the structured element list

```
SAPRead(type="DDLS", name="<cube>", include="elements")
```

This returns every field with key markers and types. Use it to classify each element:
- **Measures** — numeric fields carrying `@Aggregation.default` (e.g. `#SUM`) in the cube source
- **Dimensions** — key fields and foreign-key-association fields
- **Units/currencies** — fields referenced by `@Semantics.amount.currencyCode` / `@Semantics.quantity.unitOfMeasure`

## Step 2: Look up current analytical-query syntax

Ground the generation in current docs — do NOT rely on memory for annotation names:

```
search("CDS analytical query provider contract analytical_query transient view")
search("AnalyticsDetails.query.axis ROWS COLUMNS FREE")
```

Cite the doc IDs you used in your final summary. Key facts the docs confirm (7.58):
- Header form: `define transient view entity <name> provider contract analytical_query as projection on <cube>`
- `@AccessControl.authorizationCheck: #NOT_ALLOWED` is **mandatory** (queries can't be read via ABAP SQL → no DCL allowed; the cube's access control applies)
- The `transient` keyword is mandatory (no HANA SQL view is generated)
- You cannot define new associations or use `KEY` in a query view
- A calculated measure (arithmetic / CASE-on-a-measure) needs `@Aggregation.default: #FORMULA`

## Step 3: Compose the analytical query

Pick the template that matches the request.

### Template A — simple projection (1+ dimensions on rows, 1+ measures on columns)

```abap
@EndUserText.label: 'Sales Analytical Query'
@AccessControl.authorizationCheck: #NOT_ALLOWED
define transient view entity ZC_SalesQuery
  provider contract analytical_query
  as projection on ZI_Sales_Cube
{
      @AnalyticsDetails.query.axis: #ROWS
  RegionId,

      @AnalyticsDetails.query.axis: #FREE
  CalendarYear,

      @AnalyticsDetails.query.axis: #COLUMNS
      @Semantics.amount.currencyCode: 'CurrencyCode'
  SalesAmount,

  CurrencyCode
}
```

### Template B — restricted + calculated measures

```abap
@EndUserText.label: 'Sales KPI Query'
@AccessControl.authorizationCheck: #NOT_ALLOWED
define transient view entity ZC_SalesKpiQuery
  provider contract analytical_query
  as projection on ZI_Sales_Cube
{
      @AnalyticsDetails.query.axis: #ROWS
  RegionId,

      // restricted measure: selection-related CASE — WHEN must reference a DIMENSION
      @Semantics.amount.currencyCode: 'CurrencyCode'
  case when CalendarYear = '2025' then SalesAmount else null end as SalesAmount2025,

      // calculated measure: formula CASE — needs @Aggregation.default: #FORMULA
      @Aggregation.default: #FORMULA
  case when SalesAmount is initial then abap.int8'0' else abap.int8'1' end as HasSales,

  CurrencyCode
}
```

### Template C — query with input parameters (filter prompt)

```abap
@EndUserText.label: 'Sales Query (parameterized)'
@AccessControl.authorizationCheck: #NOT_ALLOWED
define transient view entity ZC_SalesParamQuery
  provider contract analytical_query
  with parameters
    p_year : abap.numc(4)
  as projection on ZI_Sales_Cube
{
      @AnalyticsDetails.query.axis: #ROWS
  RegionId,
      @Semantics.amount.currencyCode: 'CurrencyCode'
  SalesAmount,
  CurrencyCode
}
where CalendarYear = $parameters.p_year
```

**Composition rules** (enforce before writing):
- Element names must match the cube's element names exactly (you read them in Step 1c).
- Every amount measure needs a `@Semantics.amount.currencyCode: '<field>'` and that currency field must also be projected.
- Every quantity measure needs `@Semantics.quantity.unitOfMeasure: '<field>'` and that unit field must be projected.
- Query name ≤ 28 chars.

## Step 4: Show the plan, then write

Show the user the composed DDL and the axis layout (which fields are rows / columns / free) before writing. On confirmation:

```
SAPWrite(action="create", type="DDLS", name="<query>", source="<ddl>", package="$TMP")
```

For a transportable package, pass `package="<pkg>"` and `transport="<TR>"` (the user must supply the TR; create one with `SAPTransport` if needed).

## Step 5: Activate

```
SAPActivate(name="<query>", type="DDLS")
```

If activation fails, surface the diagnostics **verbatim** and let the user re-prompt. Do NOT silently retry. Common failures:
- `@AccessControl.authorizationCheck` not `#NOT_ALLOWED` → fix the annotation
- Element not found in cube → you used a name not in the cube (re-check Step 1c)
- Measure missing currency/unit reference → add the `@Semantics.*` annotation + project the currency/unit field
- Name > 28 chars → shorten the query name

## Step 6: Verify

```
SAPRead(type="DDLS", name="<query>", include="elements")
```

Confirm the query is live and the projected elements appear. Report success with the runtime name (`2C<query>`).

## Error Handling

| Error | Cause | Fix |
|---|---|---|
| Projection target is not a cube | Tried to project on a plain view | Build a cube first via `generate-analytics-star-schema` |
| `provider contract` syntax error | SAP_BASIS < 7.57 | Stop — analytical_query unsupported on this release |
| Authorization check error on activate | Used a value other than `#NOT_ALLOWED` | Set `@AccessControl.authorizationCheck: #NOT_ALLOWED` |
| Element does not exist | Element name typo vs cube | Re-read the cube elements (Step 1c) |
| Name too long | Query name > 28 chars | Shorten it |

## Notes

- This skill **only creates the query layer**. To build the underlying cube + dimensions + texts, use `generate-analytics-star-schema` first — the two skills chain: star-schema produces the cube, this skill projects on it.
- For a transactional (RAP) service rather than analytics, use `generate-rap-service` instead.
- BTP ABAP and on-prem 7.58 both support this; on 7.57 verify the exact provider-contract form via `search()` first.
