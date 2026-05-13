---
name: modernize-abap-cap-schema
description: Generate a CAP CDS data model (db/schema.cds) from a Z* package's ABAP database tables (TABL). Applies DDIC→CDS type mapping (24 types), infers Associations/Compositions from foreign-key references, auto-applies cuid/managed aspects when applicable. Use when asked to "convert this Z table to CDS entity", "generate CAP schema from ABAP TABL", "reverse-engineer Z tables to CDS", or as sub-skill of modernize-abap-to-btp-cap.
---

# Modernize ABAP CAP Schema

Generate a CAP CDS data model (`db/schema.cds`) from a Z* package's database tables (`TABL`) and structures. Maps DDIC types to CDS types, infers associations from foreign-key references, applies `cuid` / `managed` aspects automatically, and emits a single namespace-scoped schema ready for `cds compile`.

Sub-skill of [modernize-abap-to-btp-cap](../modernize-abap-to-btp-cap/SKILL.md) but also usable standalone when only data-model migration is needed (e.g., reverse-engineer a Z table inventory into CAP CDS for a fresh project).

This is greenfield CDS *for CAP runtime* (`@sap/cds`) — NOT ABAP CDS DDL. The two share syntax fragments but have different semantics, type systems, and tooling.

## Smart Defaults (apply silently, do NOT ask)

| Setting | Default | Rationale |
|---|---|---|
| Output file | `<target>/db/schema.cds` | CAP convention |
| Namespace | derived from package: `com.example.<package_lower>` | Customer-namespace by default; user can override |
| Aspect: cuid | Auto-applied when primary key is `sysuuid_x16` (RAW(16)) | RAP convention; cleanest mapping to CAP `cuid` |
| Aspect: managed | Auto-applied when table has any of `crusr` / `crdat` / `cruzt` / `chusr` / `chdat` / `chuzt` fields | Standard ABAP timestamp / user audit columns |
| Aspect: temporal | NOT auto-applied | Temporal modeling rarely 1:1 from ABAP; flag for user review |
| Default key | First field with key flag set in DDIC | DDIC primary-key inheritance |
| Type mapping | DDIC → CDS table (see Step 3) | Lossless where possible; documented where ambiguous |
| Associations | Inferred from foreign-key references (`KEY` table relations) | Composition vs Association heuristic in Step 4 |
| Currency / Quantity reference | `@Semantics.amount.currencyCode` / `@Semantics.quantity.unitOfMeasure` | Required by CAP runtime for proper formatting |
| Comments | Preserved from DDIC table short text + field labels | `@Common.Label: '<text>'` annotation |
| Output format | Pretty-printed, 2-space indent | CAP standard |

## Input

The user provides:

- **Z package name** (required) — e.g., `ZSALES_PKG`
- **Target directory** (required) — where `db/schema.cds` will be written

Optionally:

- **Namespace override** — e.g., `com.acme.sales` (overrides default)
- **Object scope** — comma list of TABL names to include (default: all in package)
- **Skip aspects** — disable `cuid`/`managed` auto-application
- **No-associations** — emit flat entities without inferred Associations

## Step 1: Enumerate Database Tables

### 1a. List TABL objects in package

```
SAPRead(type="DEVC", name="<package>")
```

Filter results to keep only `objectType=TABL` entries. Sort by name.

For very large packages, partition by name pattern if user provides one (e.g., `ZSALES_TBL*` for header tables only).

### 1b. Skip non-transparent table types

Read the DDIC `tabClass` for each candidate; keep only:

- `TRANSP` — Transparent table (most common, maps directly to CDS entity)
- `POOL` / `CLUSTER` — Skip with warning (pooled/cluster tables don't map cleanly to CDS — recommend redesign)
- `VIEW` — Skip (treat as DDLS via `modernize-abap-clean-core-gap`)
- `STRU` / `INTTAB` — Include but emit as `type` (not `entity`)

### 1c. Read each table

For each TABL retained:

```
SAPRead(type="TABL", name="<table_name>")
```

The response includes field list with: `name`, `dataElement`, `domain`, `dataType`, `length`, `decimals`, `key`, `notNull`, `checkTable` (foreign-key target), `searchHelp`, `shortText`.

## Step 2: Read Domain + Data Element Details (where needed)

For fields where the DDIC type is custom (`Z*_DTE` / `Z*_DOM`):

```
SAPRead(type="DTEL", name="<data_element>")
SAPRead(type="DOMA", name="<domain>")
```

Extract:

- `dataType` (numeric, character, decimal)
- `length` and `decimals`
- `fixedValues` (for domains with value list — useful for CDS `enum` generation)
- `conversionExit` (e.g., `MATN1`, `ALPHA` — flag in comment, NOT auto-applied because CAP doesn't have built-in conversion exits)

Cache results — same domain often referenced from many tables.

## Step 3: DDIC → CDS Type Mapping

Apply the standard DDIC → CDS type table. **Implement these as canonical mapping; do NOT improvise**:

| DDIC type | DDIC length | CDS type | Notes |
|---|---|---|---|
| `CHAR` | 1..N | `String(N)` | If N = 1 and domain is boolean-like (`XFELD`, `BOOLE_D`), map to `Boolean` |
| `NUMC` | 1..N | `String(N)` | NOT `Integer` — preserve leading zeros via String |
| `DEC` | N,M | `Decimal(N, M)` | Both precision + scale preserved |
| `INT1` | 1 | `Integer` (8-bit) | CDS doesn't have 8-bit; use `Integer` and `@assert.range: [0, 255]` |
| `INT2` | 2 | `Integer` (16-bit) | `Integer` + `@assert.range: [-32768, 32767]` |
| `INT4` | 4 | `Integer` | Direct map |
| `INT8` | 8 | `Integer64` | CAP-native |
| `FLTP` | 8 | `Double` | IEEE-754 |
| `DATS` | 8 | `Date` | YYYYMMDD source; CAP normalizes |
| `TIMS` | 6 | `Time` | HHMMSS source |
| `TZNTSTMPS` | 14 | `Timestamp` | UTC timestamp |
| `TZNTSTMPL` | 21 | `Timestamp` | Long timestamp with milliseconds |
| `UTCLONG` | 8 | `Timestamp` | New ABAP type; map directly |
| `CURR` | N,M | `Decimal(N, M) @Semantics.amount.amount` | Must have `currencyCode` reference field |
| `QUAN` | N,M | `Decimal(N, M) @Semantics.quantity.value` | Must have `unitOfMeasure` reference field |
| `LANG` | 1 | `String(2)` | Language key (ISO 639-1 in CAP) |
| `RAW` | N | `Binary(N)` | Direct map |
| `RAWSTRING` | unlimited | `LargeBinary` | Streaming blob |
| `LRAW` | N | `LargeBinary` | Same as `RAWSTRING` |
| `STRING` | unlimited | `LargeString` | Streaming text |
| `LCHR` | N | `LargeString` | Same as `STRING` |
| `CUKY` | 5 | `String(5)` + `@Semantics.amount.currencyCode` if referenced from a CURR field | Currency code |
| `UNIT` | 3 | `String(3)` + `@Semantics.quantity.unitOfMeasure` if referenced from a QUAN field | Unit of measure |
| `CLNT` | 3 | OMIT | CAP is single-tenant per service; `mandt` should NOT appear in target |
| `MANDT` | 3 | OMIT | Same as CLNT |
| `XSEQUENCE` | N | `Binary(N)` | Numbering sequence |
| `XFELD` | 1 | `Boolean` | Boolean flag (X = true, ' ' = false) |
| `BOOLE_D` | 1 | `Boolean` | Boolean data element |
| `SYSUUID_X16` | 16 | (key only) → triggers `cuid` aspect | Special: don't emit field, apply `cuid` |

### Edge cases

- **Multi-currency tables** — a table with two `CURR` fields needs two `CUKY` references; preserve both
- **Computed fields** (`KEYFLAG = 'X'` for header amount totals) — flag as virtual: `virtual amount: Decimal(15, 2);`
- **Append structures** — read separately via `SAPRead(type="TABL", name="<APPEND>")` and merge fields into target entity
- **Include structures** — same as append but with `INCLUDE` keyword in DDIC; merge fields inline

## Step 4: Infer Associations

For each field with `checkTable` set (foreign-key reference):

### 4a. Determine cardinality

- **1:N** — checkTable is parent → emit `Association to one <ParentEntity>` on child with FK field name
- **N:1** — fields on the target table reference back → emit `Composition of many <ChildEntity>` on parent

Heuristic:

- If field is part of primary key AND the source table has additional non-key fields → composition (child)
- If checkTable points to a customizing table (`T*` namespace, customizing tab class) → Association
- If checkTable is in same package → Composition unless explicitly modeled otherwise

### 4b. Emit association definition

```cds
entity Order : cuid, managed {
  customer    : Association to one Customer on customer.ID = customerId;
  customerId  : String(10);
  items       : Composition of many OrderItem on items.parent = $self;
  totalAmount : Decimal(15, 2) @Semantics.amount.amount;
  currency    : String(5) @Semantics.amount.currencyCode;
}
```

### 4c. Flag ambiguous mappings

If the FK relationship is unclear (e.g., shared key fields with no `checkTable` declared), emit a CDS comment:

```cds
// REVIEW: foreign-key relationship implied but not declared in DDIC.
// Source table: ZSALES_ITEM   target hint: ZSALES_HEADER
customerId : String(10);
```

## Step 5: Apply Aspects (cuid / managed / temporal)

### 5a. `cuid` aspect

If the table has a single primary key of type `SYSUUID_X16`:

- Remove the primary-key field from the entity body
- Add `: cuid` after the entity name

```cds
entity Customer : cuid {
  name : String(80);
  // ID is provided by cuid aspect
}
```

### 5b. `managed` aspect

If the table has timestamp / user audit fields (`crusr`/`crdat`/`cruzt`/`chusr`/`chdat`/`chuzt`):

- Remove those fields from entity body
- Add `, managed` after `cuid` (or directly if no `cuid`)

```cds
entity Customer : cuid, managed {
  name : String(80);
  // createdAt, createdBy, modifiedAt, modifiedBy provided by managed aspect
}
```

### 5c. Skip temporal aspect

CAP `temporal` aspect requires `validFrom` / `validTo` with specific semantics; do NOT auto-apply even if such fields exist. Flag for user review:

```cds
entity ContractVersion {
  // REVIEW: this table has validFrom/validTo — consider applying ': cuid, managed, temporal' if business semantics match.
  ...
}
```

## Step 6: Generate db/schema.cds

Emit a single file with structure:

```cds
namespace <namespace>;

using { sap.common.CodeList } from '@sap/cds/common';
using { cuid, managed, temporal } from '@sap/cds/common';

@Common.Label: '<package short text>'
entity <Entity1> : cuid, managed {
  // fields
  // associations
}

@Common.Label: '<table short text>'
entity <Entity2> : cuid {
  // fields
}

// REVIEW: <flagged items>
```

### Naming

- DDIC table `ZSALES_ORDER_H` → CDS entity `Order` (drop `Z`, drop `_H` suffix, CamelCase)
- DDIC field `KUNNR` → CDS field `customer` (use ABAP semantic name if `dataElement` provides one) OR keep ABAP name lower-cased: `kunnr`
- Default heuristic: if `dataElement` matches a known SAP standard (`KUNNR` → customer, `MATNR` → material, `BUKRS` → companyCode), apply standard name; otherwise lower-case ABAP field name

Track ABAP → CDS naming map in a comment at the top of the file:

```cds
// Field naming map (ABAP source → CDS target):
//   ZSALES_ORDER_H.KUNNR  →  Order.customer
//   ZSALES_ORDER_H.MATNR  →  Order.material
//   ZSALES_ORDER_H.WAERS  →  Order.currency
//   ZSALES_ORDER_H.NETWR  →  Order.netAmount
```

## Step 7: Validate

### 7a. CDS compile

```bash
npx cds compile <target>/db/schema.cds --to edmx > /dev/null
```

Must succeed. Common errors:

| Error | Cause | Fix |
|---|---|---|
| `Cannot resolve association target` | FK reference points to a table not in scope | Add the parent table to package scope or remove the association |
| `Type 'X' is not supported` | DDIC type without mapping | Add missing entry in Step 3 table, regenerate |
| `Duplicate field name` | Append structure collision | Manual review; rename or merge fields |
| `Currency reference missing` | CURR field without CUKY companion | Add `@Semantics.amount.currencyCode` reference |
| `Namespace conflict` | Namespace mismatches between schema and using-imports | Verify `namespace` header matches CAP namespace conventions |

### 7b. CDS-to-SQL generation

```bash
npx cds compile <target>/db/schema.cds --to sql > /dev/null
```

Validates that the schema can be deployed to an actual database (HANA + SQLite both).

### 7c. Lint (optional)

If the target project has CAP eslint configured:

```bash
npx eslint <target>/db/schema.cds
```

## Step 8: Emit Migration Notes

Append at end of `db/schema.cds`:

```cds
// ============================================================================
// Migration notes (ABAP source: <package> → CAP CDS schema)
// ============================================================================
//
// - <N> entities generated from <M> source TABL objects
// - <P> associations inferred from FK references
// - <Q> tables with cuid aspect applied (SYSUUID_X16 primary key)
// - <R> tables with managed aspect applied (audit timestamps)
// - <S> tables flagged for REVIEW (manual mapping required)
//
// REVIEW items:
//   - <list>
//
// SKIPPED items:
//   - <list of POOL/CLUSTER tables with reason>
// ============================================================================
```

## Re-validate

After user edits the REVIEW items:

```bash
npx cds compile <target>/db/schema.cds --to edmx
npx cds compile <target>/db/schema.cds --to sql
```

## BTP vs On-Premise Differences

| Aspect | BTP target | On-prem CAP (out of scope v1) |
|---|---|---|
| HANA deployment | HANA Cloud + HDI container | HANA on-prem + HDI |
| `mandt` / `CLNT` | Always OMIT — single-tenant per service | Same: CAP target is multi-tenant via service tenancy, not table field |
| Reserved words | CAP CDS reserves: `entity`, `aspect`, `type`, `service`, `action`, `function` — rename collisions | Same |
| Currency / Unit | Same semantics annotations | Same |

## Error Handling

| Error | Cause | Fix |
|---|---|---|
| `SAPRead TABL` returns empty | Table doesn't exist or wrong type | Verify with `SAPSearch query="<name>"` |
| Append structure not detected | Append linked via `APPEND` flag | Re-read with explicit DDIC dictionary scan |
| Field name collision (e.g., two `ORDER_ID` fields) | Append merged from multiple sources | Manual rename; flag in REVIEW section |
| Foreign key target outside scope | checkTable points outside Z package | Choice: extend scope, omit association, or use `String` FK reference |
| Currency without companion | DDIC table has `CURR` without referenced `CUKY` field | Manual fix; emit entity with `// REVIEW: missing currency reference` |
| `cds compile` fails on `Decimal(31, 0)` | DDIC `DEC(31)` exceeds CAP max | Cap at `Decimal(34, 2)` or use `Double` if precision not critical |

## What This Skill Does NOT Do

- **No table data migration** — generates schema only, NOT INSERT scripts
- **No HANA-specific syntax** — generates portable CAP CDS, not HDI artifacts (CAP `cds build` does that)
- **No append-structure deep recursion** — handles direct appends, not nested appends-of-appends
- **No CDS view migration** — that's [modernize-abap-clean-core-gap](../modernize-abap-clean-core-gap/SKILL.md) territory (Z CDS views → released SAP views OR keep as Z)
- **No semantic merge** — if two tables represent the same business entity (rare), no auto-merge; manual modeling needed
- **No table-function (`TF`) handling** — function-based tables are skipped with warning

## When to Use This Skill

- As Step 3 of [modernize-abap-to-btp-cap](../modernize-abap-to-btp-cap/SKILL.md)
- Standalone: greenfield CAP project that needs to mirror existing Z table inventory
- Standalone: refactor an existing CAP schema after schema drift (regenerate baseline, compare with current)
- During architecture spike: get a quick CDS skeleton from a Z package for evaluation

## When NOT to Use This Skill

- Source tables are pooled / clustered → redesign required, this skill skips them
- Tables are in standard SAP namespace (T*, V*, M*) → use released SAP CDS views via `@sap/cds-types-released`; don't regenerate
- Target is HANA HDI native (not CAP) → use `hana-cli` or HANA Web IDE Cloud generators

## Follow-up

After this skill produces the schema:

- [modernize-abap-cap-service](../modernize-abap-cap-service/SKILL.md) — generate service definitions on top of these entities
- [generate-cds-unit-test](../generate-cds-unit-test/SKILL.md) — generate unit tests for the entities with calculations
- Manual: review REVIEW items, refine type mappings, decide on association policies (Association vs Composition)

## References

- [CAP CDS reference](https://cap.cloud.sap/docs/cds/cdl)
- [CAP common aspects](https://cap.cloud.sap/docs/cds/common)
- [CAP semantic annotations](https://cap.cloud.sap/docs/cds/annotations)
- [DDIC type reference](https://help.sap.com/docs/abap-cloud/abap-rap-cloud-development-tools/data-types)
