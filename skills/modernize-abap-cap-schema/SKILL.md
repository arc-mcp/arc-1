---
name: modernize-abap-cap-schema
description: Generate a CAP CDS data model (`db/schema.cds`) from a Z* package's ABAP database tables. Maps DDIC types to CDS, infers Associations/Compositions from foreign keys, auto-applies `cuid` / `managed` aspects. Use when asked to "convert Z tables to CDS entities", "generate CAP schema from ABAP TABL", "reverse-engineer Z tables", or as sub-skill of `modernize-abap-to-btp-cap`.
---

# Modernize ABAP → CAP Schema

Produces `<target>/db/schema.cds` from a Z* package's tables (`TABL`). Greenfield CDS for the **CAP runtime** (`@sap/cds`), NOT ABAP CDS DDL.

Sub-skill of [`../modernize-abap-to-btp-cap/SKILL.md`](../modernize-abap-to-btp-cap/SKILL.md). Also usable standalone for table-only reverse-engineering.

## Input

```
<Z-package> <target-dir> [--namespace=com.example.foo]
```

## Defaults

| Aspect | Default |
|---|---|
| Output | `<target>/db/schema.cds` |
| Namespace | derived from package: `com.example.<package_lower>` |
| `cuid` aspect | auto-applied if PK is `sysuuid_x16` (RAW(16)) |
| `managed` aspect | auto-applied if table has any of `crusr` / `crdat` / `cruzt` / `chusr` / `chdat` / `chuzt` |
| `temporal` aspect | NOT auto-applied (rare 1:1 mapping; flag for user review) |
| Key | first DDIC key field |
| Currency / Quantity | `@Semantics.amount.currencyCode` / `@Semantics.quantity.unitOfMeasure` |
| Comments | DDIC short text + field labels → `@Common.Label` |

## DDIC → CDS type mapping (24 mappings)

| DDIC | CDS | Notes |
|---|---|---|
| CHAR(n) | `String(n)` | preserve length |
| NUMC(n) | `String(n)` | leading-zero numeric; CAP-side validation up to user |
| DEC(p,s) / CURR(p,s) / QUAN(p,s) | `Decimal(p,s)` | currency/quantity get semantic annotation |
| INT1 / INT2 / INT4 | `Integer` / `Int16` / `Int32` | |
| INT8 | `Int64` | |
| FLTP | `Double` | |
| RAW(n) / SSTRING / STRING | `Binary(n)` / `String` / `LargeString` | |
| RAW(16) | `UUID` (auto via `cuid`) | UUID convention |
| RAWSTRING | `LargeBinary` | |
| DATS | `Date` | |
| TIMS | `Time` | |
| TZNTSTMPS | `Timestamp` | with timezone |
| LCHR / LRAW | `LargeString` / `LargeBinary` | |
| UNIT (CUKY) | `Association to Currencies` | when associated with amount field |
| MEINS | `Association to Units` | when associated with quantity field |
| LANG (SPRAS) | `Association to Languages` | |
| CLNT | `String(3)` | client field — usually omitted in BTP CAP |

## Workflow

### Step 1 — Enumerate tables

`SAPSearch(tadir_lookup, devclass=<pkg>, object='TABL')` → list of Z tables.

### Step 2 — Read DDIC details (per table)

`SAPRead(type='TABL', name=<table>)` — fields + types + keys + foreign keys + domain references.

For complex domains / data elements: drill in only when the DDIC type alone is insufficient (e.g. fixed value lists → `@assert.range`).

### Step 3 — Apply type mapping + aspects

Walk each field through the table above. For each table, decide aspects:
- `cuid` if RAW(16) primary key
- `managed` if audit columns present
- `localized` if `texts` companion table detected (`<table>T`)

### Step 4 — Infer Associations

From DDIC foreign-key references:

| FK cardinality | Heuristic | CAP relation |
|---|---|---|
| Child table with parent FK + parent owns lifecycle | parent has stronger semantics | `Composition of many <Child>` on parent |
| Lookup / master data (Currencies, Units, Languages) | shared catalog | `Association to <Master>` |
| Generic FK to entity not owned | independent lifecycle | `Association to <Entity>` |

Bidirectional inference: write both sides (`<parent>.items : Composition of many <child>` AND `<child>.parent : Association to <parent>`).

### Step 5 — Emit + validate

Write `<target>/db/schema.cds` in CAP pretty-print format. Validate via:

```bash
npx cds compile <target>/db/schema.cds --to edmx > /dev/null && echo "OK"
```

### Step 6 — Migration notes

Write `<target>/docs/schema-notes.md` with:
- Tables migrated + their CAP entity name + namespace
- Aspects auto-applied
- Associations inferred + cardinality reasoning
- Manual review items: temporal candidates, ambiguous FKs, `LCHR` / `LRAW` size limits

## Gotchas

- **MANDT (client) field**: drop on BTP CAP (no client concept). Flag if data needs cross-client merge.
- **`@AbapCatalog` annotations** (DDIC): do NOT carry over; CAP has its own (`@cds.persistence.skip`, `@assert.range`, etc.).
- **Domain fixed values**: map to `@assert.range` if ≤10 values, otherwise emit a CodeList entity.
- **Hierarchical / parent-child Z tables**: review `Composition` choice — sometimes Association is safer (no cascade delete).

## When NOT to use

- Greenfield CDS design from scratch → use [`../generate-rap-service/SKILL.md`](../generate-rap-service/SKILL.md) or hand-write
- View-only entities (no underlying TABL) → not the target of this skill
- Multi-package data model with cross-package FK → split into multiple invocations, then merge manually

## References

- [SAP CAP — CDS Modeling](https://cap.cloud.sap/docs/cds/cdl)
- [CAP — Common Reuse Aspects](https://cap.cloud.sap/docs/cds/common) (`cuid`, `managed`, `temporal`, `localized`)
- DDIC types → CDS types: [SAP — ABAP CDS Types](https://help.sap.com/docs/abap-cloud/abap-data-types) (cross-reference for ABAP CDS vs CAP CDS)
