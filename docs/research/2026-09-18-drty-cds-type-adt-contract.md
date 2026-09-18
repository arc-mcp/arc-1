# DRTY (CDS Type) — ADT wire contract

**Status:** live-verified, 2026-09-18
**System:** local ABAP trial (`abap-trial-local`), SAP_BASIS **816** SP0001, on-prem, client 001
**Conclusion:** `DRTY` is a plain "blue" server-driven object — a structural sibling of `DSFD`. It
needs **one registry entry** in `src/adt/server-driven.ts`, not a bespoke code path.

## Why it looked unsupported

Earlier attempts read DRTY through the **DDLS** endpoint (`/sap/bc/adt/ddic/ddl/sources/…`), which
404s: a CDS type is not a DDL source. The real collection is `/sap/bc/adt/ddic/drty/sources`, and it
is advertised in ADT discovery under the `Dictionary` workspace as:

```
<app:collection href="/sap/bc/adt/ddic/drty/sources">
  <atom:title>Type</atom:title>
  <app:accept>application/vnd.sap.adt.blues.v1+xml</app:accept>
  <app:accept>text/html</app:accept>
```

The title is the generic word `Type`, which is why a text search for "DRTY"/"CDS type" over the
discovery document does not surface it. The sibling sub-resources (`$metadata`, `$navigation`,
`$codecompletion`, `$formatter`, `$elementinfo`, `$outlineconfiguration`, `$occurrencemarkers`,
`validation`) all say `for type DRTY` explicitly and confirm the collection identity.

## Verified operations

All calls below carry `sap-client=001`. Lock/modify/unlock requires
`X-sap-adt-sessiontype: stateful` — without it the PUT fails **423 `ExceptionResourceInvalidLockHandle`**
even though the LOCK itself returned 200 with a handle.

| Op | Request | Result |
|----|---------|--------|
| Read metadata | `GET /sap/bc/adt/ddic/drty/sources/{name}`<br>`Accept: application/vnd.sap.adt.blues.v1+xml` | 200 `<blue:blueSource>` |
| Read source | `GET …/{name}/source/main`<br>`Accept: text/plain` | 200 DDL text |
| Create | `POST /sap/bc/adt/ddic/drty/sources`<br>`Content-Type: application/vnd.sap.adt.blues.v1+xml` | **201**, object `version="inactive"`, empty source |
| Update source | lock → `PUT …/{name}/source/main?lockHandle=…`<br>`Content-Type: text/plain` → unlock | 200, echoes the stored source |
| Activate | `POST /sap/bc/adt/activation?method=activate&preauditRequested=true` (generic `adtcore:objectReferences`) | 200 `activationExecuted="true"`, metadata flips to `version="active"` |
| Delete | lock → `DELETE …/{name}?lockHandle=…` → unlock | 200; subsequent GET 404 |

### Create body (minimal, verified sufficient)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<blue:blueSource xmlns:blue="http://www.sap.com/wbobj/blue"
                 xmlns:adtcore="http://www.sap.com/adt/core"
                 adtcore:type="DRTY/STY"
                 adtcore:name="ZARC1_DRTY_PROBE"
                 adtcore:description="…">
  <adtcore:packageRef adtcore:name="$TMP"/>
</blue:blueSource>
```

This is byte-for-byte the shape the existing SDO engine already builds for the blue family — no new
builder is required.

## Registry entry

```ts
DRTY: {
  href: '/sap/bc/adt/ddic/drty/sources',
  label: 'CDS Type (scalar type / enum)',
  createType: 'DRTY/STY',
  metadataContentType: BLUES_V1,
  ...BLUE_METADATA,
  sourceFormat: 'text',
},
```

`sourceFormat: 'text'` is **not** a guess. Negative test: the same PUT under a valid lock with
`Content-Type: application/json` returns **415 `ExceptionUnsupportedMediaType`**. It also matches the
discovery `$formatter` sub-resource, which advertises `text/plain`.

## One subtype covers everything

`DRTY` spans scalar types *and* enumerated types, but SAP models both with the **single** subtype
`DRTY/STY` — so create needs no subtype routing (unlike TABL `/DT` vs `/DS`, #285). Sampled live:

| Object | `adtcore:type` | `abapLanguageVersion` | Shape |
|--------|----------------|----------------------|-------|
| `DEMO_SIMPLE_TYPE` | `DRTY/STY` | cloudDevelopment | over builtin (`abap.int4`) |
| `DEMO_SIMPLE_TYPE_DE` | `DRTY/STY` | cloudDevelopment | over a data element |
| `DEMO_SIMPLE_TYPE_INHERITANCE` | `DRTY/STY` | cloudDevelopment | over another CDS type |
| `DEMO_CDS_ENUM_WEEKDAY` | `DRTY/STY` | cloudDevelopment | `enum { … }`, int1 |
| `DEMO_CDS_ENUM_BOOLEAN` | `DRTY/STY` | cloudDevelopment | `enum { … }`, char(1) |
| `DD_DRTY_ST_ENUM_LENGTHS` | `DRTY/STY` | **standard** | `enum { … }`, numc(6) |

The created probe object came back `abapLanguageVersion="standard"` in `$TMP` on on-prem 816, so DRTY
is **not** restricted to ABAP Cloud — matching `DD_DRTY_ST_ENUM_LENGTHS`, a standard-language SAP
object.

## Source-language notes (relevant to lint / pre-write hints)

- `define type` and `DEFINE TYPE` are both accepted (`DEMO_BT_DATE` uses upper case).
- Annotations precede the definition: `@EndUserText.label` / `.heading` / `.quickInfo`.
- Enum members use `NAME = initial;` for the initial value and quoted or unquoted literals
  thereafter, each optionally annotated with its own `@EndUserText.label`.
- The body is a single statement terminated by `;` — abaplint has no DRTY grammar, so pre-write lint
  must stay off for this type (same posture as the other DDL-text SDO types).

## Test corpus on the trial

384 `DRTY` rows in TADIR. Useful read fixtures live in `SABAP_DEMOS_ABAP_CDS_CLOUD` (`DEMO_*`),
`SD_CDS_TYPES` (`DD_DRTY_ST_ENUM_*`), and `SABAP_DEMOS_ABAP_LANGU_CLOUD`.

## Open questions for the implementation phase

1. Whether `SAPRead`'s existing SDO path needs the `version=inactive` handling that KTD required
   (`getKtd()` omits `version` so inactive drafts accumulate) — not yet probed for DRTY.
2. Whether the `$elementinfo` / `$navigation` sub-resources are worth surfacing for `SAPContext`
   dependency walking of types referenced by CDS entities.
3. Availability on 7.58 — the collection was verified present on 816 only; the discovery gate makes a
   missing collection degrade cleanly, but the release floor should be recorded once probed.
