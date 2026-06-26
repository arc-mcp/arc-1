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
