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
