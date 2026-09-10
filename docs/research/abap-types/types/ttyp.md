# TTYP — Table Type (DDIC)

ADT object type for DDIC **table types** (DD40L). Canonical short type: `TTYP`.

## Live-verified `<adtcore:type>` (2026-06-24)

`GET /sap/bc/adt/ddic/tabletypes/STRINGTAB` on a4h (S/4HANA 2023 / 758) **and** a4h-2025
(ABAP Platform 2025 / 816) both return:

- `Content-Type: application/vnd.sap.adt.tabletype.v1+xml`
- root `<ttyp:tableType … adtcore:type="TTYP/DA" …>` (namespace `http://www.sap.com/dictionary/tabletype`)

So the slash-form is **`TTYP/DA`** → canonical `TTYP`. The object is XML-metadata only — `…/source/main`
returns 404 (not source-based).

## Endpoints

- Read: `GET /sap/bc/adt/ddic/tabletypes/{name}`
- Create: `POST /sap/bc/adt/ddic/tabletypes` (Content-Type `application/vnd.sap.adt.tabletype.v1+xml`),
  body `<ttyp:tableType>` with a `<ttyp:rowType>` whose children are required **in order**:
  `typeKind`, `typeName`, `builtInType(dataType,length,decimals)`, `rangeType`. Built-in row →
  `typeKind=predefinedAbapType` + empty `typeName` + `builtInType.dataType=<builtin>`; structure row →
  `typeKind=dictionaryType` + `typeName=<struct>` + `builtInType.dataType=STRU`. Verified 201 on 758 + 816.
- Delete: `DELETE /sap/bc/adt/ddic/tabletypes/{name}` → 200.

Created objects are inactive → activate via the standard ADT activation endpoint.

## Built-in row types (`TTYP_BUILTIN_ROW_TYPES` is a heuristic, not an allow-list)

The set of built-in ABAP row types **grows across releases**, so ARC-1 must not hard-reject a built-in
just because it isn't enumerated. Live-verified on a4h 758 + 816: `UTCLONG` (8-byte UTC timestamp, ABAP
7.54+) creates + activates as `predefinedAbapType` / `dataType=UTCLONG`. Before it was added to the
list, `rowType=UTCLONG, rowTypeKind=builtin` was wrongly rejected ("not a supported built-in"), and
auto-detect mis-classified it as a `dictionaryType` (`typeName=UTCLONG`, `STRU`).

Design (see `src/adt/ddic-xml.ts` `buildTableTypeXml`):
- The list drives **auto-detection only** (when the caller omits `rowTypeKind`).
- An **explicit `rowTypeKind` is authoritative** — never gated against the list; SAP validates the name.
  So a future built-in ARC-1 hasn't enumerated still works via `rowTypeKind="builtin"`.
- Current built-in set (16): `STRING XSTRING I INT8 F P D T C N X B S DECFLOAT16 DECFLOAT34 UTCLONG`.


## Relation Explorer identity evidence — SAP_BASIS 758 (2026-09-10)

This dated section concerns read-only relationship roots, not new SAPRead operations, writes, or a global slash alias. The metadata root and `adtcore:type` attribute below were retained from an actual metadata **GET**, not a create template. Namespace prefixes are preserved. Authors, descriptions and unrelated fields were removed; identity values were not invented or rewritten.

### TTYP/DA

- Observed object: `/BOBF/T_FRW_CHANGE`; GET `/sap/bc/adt/ddic/tabletypes/%2fbobf%2ft_frw_change`.
- Recorded: 2026-09-09T22:07:49.315Z; metadata QName: `ttyp:tableType`.
- [Sanitized wire fixture](../../../../tests/fixtures/relations/ttyp-da.json) also preserves one observed ENV edge and original-body SHA-256 values. It is a projection, not a complete network.

```xml
<ttyp:tableType adtcore:name="/BOBF/T_FRW_CHANGE" adtcore:type="TTYP/DA" adtcore:version="active" xmlns:ttyp="http://www.sap.com/dictionary/tabletype" xmlns:adtcore="http://www.sap.com/adt/core">
<adtcore:packageRef adtcore:uri="/sap/bc/adt/packages/%2fbobf%2fframework" adtcore:type="DEVC/K" adtcore:name="/BOBF/FRAMEWORK"/>
</ttyp:tableType>
```

Qualification and limitations: [per-type research](../../2026-09-10-live-relations-types.md). CI binds every qualified native identity to this document and replays the independent recorded fixtures. This proves the observed 758 shapes, not support on other releases or relationship completeness.
