---
name: generate-analytics-star-schema
description: Generate a CDS analytical model (star schema — cube + dimension + text views) on top of a RAP business object or a DDIC table. Use when asked to "create a star schema", "generate an analytical cube and dimensions", "make a RAP BO analytical", "build a CDS cube from a table", or "create an analytical model".
---

# Generate CDS Analytics Star Schema

Generate a CDS **analytical model** — a star schema consisting of a cube view (`@Analytics.dataCategory: #CUBE`), one or more dimension views (`#DIMENSION`), and text views (`#TEXT`) — on top of a RAP business object or a plain DDIC table.

This skill replicates SAP Joule's "CDS Analytical Model Generation" capability (basic + extended scope) by combining ARC-1 (SAP system access) with mcp-sap-docs (documentation & best practices). Basic scope = cube + reuse existing dimensions. Extended scope = also generate new dimensions, and start from a DDIC table (not just a RAP BO).

## Prerequisites — read this first

- **Requires SAP_BASIS 7.5x with the analytics annotations.** Verify with `SAPManage(action="probe")` (`rap.available`). If RAP/CDS isn't available, stop.
- The output is a set of **interdependent** CDS views (cube → dimensions → texts). They must be created as inactive drafts and activated together so SAP's activator resolves the cross-references in one pass. This skill uses `SAPWrite(action="batch_create", activateAtEnd: true)` for exactly that.

## Smart Defaults (apply silently, do NOT ask)

| Setting | Default | Rationale |
|---|---|---|
| Object type | `DDLS` | Cube/dimension/text are all CDS data definitions |
| Package | `$TMP` | Fast prototyping; ask before a transportable package |
| Activation | `batch_create` + `activateAtEnd: true` | Cross-references resolve in one terminal pass |
| Authorization | `#NOT_REQUIRED` (cube/dimension) | Standard for analytical interface views |
| Naming | `ZI_<X>_CUBE`, `ZI_<X>_DIM`, `ZI_<X>_TXT` | Clear star-schema roles |

## Input

The user provides either:
- A **RAP business object** root entity / behavior pool (e.g. `ZBP_R_TRAVEL` or `ZI_Travel`), or
- A **DDIC table** (e.g. `ZTRAVEL`), or
- An **interface CDS view** to use as the fact source.

Optionally: which numeric fields are measures, which fields are dimensions, target package, and whether to generate new dimension views or reuse existing ones.

## Step 1: Resolve and read the source

### 1a. RAP BO input — find the bound CDS root entity

If the user names a behavior pool class (`ZBP_*`), read the class metadata to find the root entity it's bound to:

```
SAPRead(type="CLAS", name="<ZBP_class>", format="structured")
```

Look for the bound root entity reference. Then read that CDS root entity (next step). If the user already named the CDS root entity / interface view, skip to 1c.

### 1b. DDIC table input — read the table structure

```
SAPRead(type="TABL", name="<table>")
```

Capture the field list with types. Identify candidate keys, dimension fields (foreign keys, characteristics), and numeric measure fields (amounts, quantities, counts).

### 1c. CDS view input — read source + elements

```
SAPRead(type="DDLS", name="<view>")
SAPRead(type="DDLS", name="<view>", include="elements")
```

The element list classifies fields. Decide for each:
- **Measure**: numeric, additive (amount / quantity / count) → goes in the cube with `@Aggregation.default: #SUM`
- **Dimension**: a characteristic you slice by (region, customer, date) → either reuse an existing dimension view or generate a new one
- **Currency/Unit**: paired with each amount/quantity measure

## Step 2: Discover reusable dimensions

For each dimension field, check whether a reusable dimension view already exists before generating a new one:

```
SAPSearch(query="*<dimension_keyword>*", searchType="object", objectType="DDLS")
```

If a released `#DIMENSION` view exists (e.g. `I_Country`, `I_CalendarDate`), reuse it via association. Otherwise generate a new `ZI_<X>_DIM` (extended scope).

## Step 3: Look up current analytics annotations

Ground the generation in current docs:

```
search("CDS analytical model cube Analytics.dataCategory CUBE dimension representativeKey")
search("ObjectModel.foreignKey.association text association Semantics.text")
```

Cite the doc IDs in your summary. Key facts (7.58):
- Cube: `@Analytics: { dataCategory: #CUBE, internalName: #LOCAL }` + `@ObjectModel: { supportedCapabilities: [ #ANALYTICAL_PROVIDER ], modelingPattern: #ANALYTICAL_CUBE }`
- A cube needs **≥1 measure**; measures carry `@Aggregation.default: #SUM` (or `#MIN`/`#MAX`/`#AVG`); a numeric field WITHOUT `@Aggregation.default` is treated as a dimension
- Cube→dimension associations must be **`[1..1]`**; `@ObjectModel.foreignKey.association: '_Dim'` goes on the **dimension key field in the cube**
- Dimension: `@Analytics.dataCategory: #DIMENSION` + `@ObjectModel: { representativeKey: '<key>', supportedCapabilities: [ #ANALYTICAL_DIMENSION ], modelingPattern: #ANALYTICAL_DIMENSION }`
- Text view uses `@ObjectModel.dataCategory: #TEXT` (the `ObjectModel.` namespace — NOT `@Analytics.dataCategory`) + `@Semantics.text: true` + `@Semantics.language: true`

## Step 4: Compose the model

### Cube template

```abap
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Sales Cube'
@Analytics: {
  dataCategory: #CUBE,
  internalName: #LOCAL
}
@ObjectModel: {
  supportedCapabilities: [ #ANALYTICAL_PROVIDER ],
  modelingPattern: #ANALYTICAL_CUBE
}
define view entity ZI_Sales_Cube
  as select from zsales_data
  association [1..1] to ZI_Region_Dim as _Region
    on _Region.RegionId = $projection.RegionId
{
      @ObjectModel.foreignKey.association: '_Region'
  key region_id   as RegionId,
  key calyear     as CalendarYear,

      @Semantics.amount.currencyCode: 'CurrencyCode'
      @Aggregation.default: #SUM
      amount       as SalesAmount,

      currency     as CurrencyCode,

      @Aggregation.default: #SUM
      @EndUserText.label: 'Number of Records'
      1            as RecordCount,

      _Region
}
```

### Dimension template

```abap
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Region Dimension'
@Analytics.dataCategory: #DIMENSION
@ObjectModel: {
  representativeKey: 'RegionId',
  supportedCapabilities: [ #ANALYTICAL_DIMENSION ],
  modelingPattern: #ANALYTICAL_DIMENSION
}
define view entity ZI_Region_Dim
  as select from zregion
  association [0..1] to ZI_Region_Txt as _Text
    on _Text.RegionId = $projection.RegionId
{
      @ObjectModel.text.association: '_Text'
  key region_id as RegionId,
      _Text
}
```

### Text view template

```abap
@EndUserText.label: 'Region - Text'
@ObjectModel.dataCategory: #TEXT
@ObjectModel.representativeKey: 'RegionId'
define view entity ZI_Region_Txt
  as select from zregion_t
{
      @ObjectModel.foreignKey.association: '_Region'
  key region_id as RegionId,

      @Semantics.language: true
  key spras     as Language,

      @Semantics.text: true
      regiontext  as RegionName
}
```

**Composition rules** (enforce before writing):
- Cube has ≥1 measure (`@Aggregation.default`).
- Each amount measure has `@Semantics.amount.currencyCode` + the currency field is projected; each quantity measure has `@Semantics.quantity.unitOfMeasure` + the unit field is projected.
- Every cube→dimension association is `[1..1]` and the dimension key field carries `@ObjectModel.foreignKey.association`.
- Every dimension has a `representativeKey`.
- Text views use `@ObjectModel.dataCategory: #TEXT` + `@Semantics.text/language`.

## Step 5: Show the plan as a tree, then batch-create

Show the user the model tree before writing:

```
Cube: ZI_Sales_Cube  (from zsales_data)
  Measures: SalesAmount (SUM, currency CurrencyCode), RecordCount (SUM)
  Dimensions:
    ZI_Region_Dim (new) → ZI_Region_Txt (new)
```

On confirmation, create all views in one batch with deferred activation so cross-references resolve together:

```
SAPWrite(action="batch_create", activateAtEnd=true, objects=[
  { type: "DDLS", name: "ZI_Region_Txt",  source: "<text_ddl>",      package: "$TMP" },
  { type: "DDLS", name: "ZI_Region_Dim",  source: "<dimension_ddl>", package: "$TMP" },
  { type: "DDLS", name: "ZI_Sales_Cube",  source: "<cube_ddl>",      package: "$TMP" }
])
```

Order the array dependencies-first (text → dimension → cube) so that even if `activateAtEnd` falls back to per-object activation on an older release, the chain still resolves. With `activateAtEnd: true`, ARC-1 writes all three as inactive drafts and fires one terminal activation over the whole graph.

If `batch_create` with `activateAtEnd` is not honored (older release), fall back to: create each object with `SAPWrite(action="create", ...)` then a single `SAPActivate(objects=[...])` over all created objects.

## Step 6: Verify

```
SAPRead(type="DDLS", name="ZI_Sales_Cube", include="elements")
```

Confirm the cube is live and its dimension association + measures resolved.

## Step 7: Offer the query layer

The cube is the foundation; the query is what end users consume. Offer:

> "Want me to generate an analytical query (the consumable KPI view) on top of this cube? → `generate-cds-analytical-query`"

## Error Handling

| Error | Cause | Fix |
|---|---|---|
| Cube has no measure | All numeric fields treated as dimensions | Add `@Aggregation.default: #SUM` to at least one numeric field |
| Association cardinality error | Cube→dimension not `[1..1]` | Change cardinality to `[1..1]` |
| `foreignKey.association` placement | Annotation on the association instead of the key field | Move it to the dimension key field in the cube |
| Text view rejected | Used `@Analytics.dataCategory` instead of `@ObjectModel.dataCategory` for `#TEXT` | Text views use the `ObjectModel` namespace |
| Cross-reference unresolved | Created objects activated individually before siblings existed | Use `batch_create` with `activateAtEnd: true` |
| Representative key missing | Dimension has no `representativeKey` | Add `@ObjectModel.representativeKey` |

## Notes

- **Basic vs extended scope:** Basic = reuse existing dimensions (Step 2 finds released `#DIMENSION` views). Extended = also generate new `ZI_*_DIM` + `ZI_*_TXT` and accept a DDIC table as the fact source (Step 1b).
- This skill builds the **model**; the consumable **query** is a separate step (`generate-cds-analytical-query`).
- For a transactional RAP service (not analytics), use `generate-rap-service`.
- Reuse SAP standard dimensions where they exist (`I_CalendarDate`, `I_Country`, `I_Currency`) instead of regenerating them — `SAPSearch` in Step 2.
