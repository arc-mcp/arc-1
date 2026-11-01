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

## Stored definitions and what an update writes back (2026-09-30)

Read-only evidence from a4h (S/4HANA 2023 / SAP_BASIS 758): `GET /sap/bc/adt/ddic/tabletypes/{name}`
plus `DD40L`/`DD43L` counts. `STRINGTAB`, `SALV_T_ROW` and `SATC_T_AC_AUNIT_TESTCLASSES` were re-read on
a4h-2025 (816) and were identical.

### `<ttyp:rowType>` by kind

| `typeKind` | `typeName` | `builtInType` (`dataType` `length`) | `rangeType` | Read from |
|---|---|---|---|---|
| `predefinedAbapType` | empty | `STRING` 0, `RAWSTRING` 0, `CHAR` 30, `INT4` 10, `DF34_DEC` 31 | empty | `STRINGTAB`, `SCI_SQLSTMNT`, `SBO_T_SEMANTIC_KEY`, `SALV_T_ROW`, `SAPCRFC_DECFLOAT34_TAB` |
| `dictionaryType` | structure, data element or table type | resolved: `STRU`, `STRING`, `TTYP` | empty | `SADT_EXCEPTION_PROPERTIES`, `SAML2_ANYURI_T`, `SCWB_STATEMENT_TAB` |
| `refToClassOrInterfaceType` | class, interface or `OBJECT` | empty | empty | `SALERTTCLACTIVITY`, `SAML_ATTRIBUTES_REF`, `SWF_UTL_OBJECT_TAB` |
| `refToDictionaryType` | DDIC type or `DATA` | empty | empty | `SCMS_GET_FILES_TEST`, `SCMG_T_LOC_RESULT` |
| `rangeTypeOnPredefinedType` | empty | element type | row structure | `SCA_STRING_RANGE` |
| `rangeTypeOnDataelement` | data element | resolved | row structure | `SACCT_CONNECTION_ID_RANGE` |

What this means for `buildTableTypeXml`:

- SAP returns dictionary names for built-in rows (`INT4`, `CHAR`, `RAWSTRING`), not the ABAP names in
  `TTYP_BUILTIN_ROW_TYPES` (`I`, `C`, `XSTRING`). Auto-detection would classify a stored `INT4` as a
  structure, so an update carries the stored kind instead.
- `length` and `decimals` are part of a built-in row type (`CHAR` 30) and are returned even where SAP
  derives them (`INT4` 10). An update carries them; the builder writes zeros otherwise.
- Reference and range rows have no `rowTypeKind` equivalent and cannot be rebuilt.

### Access type and keys

| Element | Builder writes | Other stored values |
|---|---|---|
| `initialRowCount` | `00000` | `01000` (`SATR_T_HIT1`) |
| `accessType` | `standard` | `sorted`, `hashed`, `index`, `notSpecified` |
| `primaryKey/definition` | `standard` | `keyComponents` with `<ttyp:component ttyp:name>`, `rowType`, `empty`, `notSpecified` |
| `primaryKey/kind` | `nonUnique` | `unique`, `notSpecified` |
| `primaryKey/alias` | empty | `KEY` (`SAML2_AUDIT_MESSAGE_T`) |
| `secondaryKeys/allowed` | `notSpecified` | `allowed`, `notAllowed` |
| `secondaryKeys/secondaryKey` | none | one per key, also under `allowed=notSpecified` (`SACCT_TRACE`) |

`parseTableType` reports `plainStandardTable: true` only when all seven match the builder. Of 63,172
active table types, 52,284 (83%) have the builder's access type and primary key; 1,257 have secondary
keys, and about 2,460 have a reference or range row type.

### Update rule

`mergeMetadataWriteProperties` reads the table type under the lock.

- The description is kept unless supplied.
- An omitted row type is kept with its kind and built-in length when the row kind is
  `predefinedAbapType` or `dictionaryType` and `plainStandardTable` is true. Otherwise the update is
  refused, because the PUT would reset what the builder cannot write.
- A supplied row type that equals the stored one keeps the stored kind and length; a different one
  takes neither.
- A supplied row type always proceeds and still resets access type and keys (roadmap FEAT-78).

### Live write verification (2026-09-30, 758 and 816)

Disposable `$TMP` table types, basic authentication, same results on a4h (758) and a4h-2025 (816).
A build of main `a1875eaa` replaced the description with the object name in the first scenario (758).

| Scenario | Result with the merge |
|---|---|
| Update with only `rowType`, stored description `R&D <rows> "quoted"` | description unchanged, escaped once on the wire |
| Update with only `description` | row type unchanged for `STRING`, `INT4`, `BAPIRET2`, `SYUNAME` and `CHAR` 1 rows |
| `rowType` restated without `rowTypeKind` (`INT4`, `char`) | stored kind and length kept |
| Activation after those updates (`INT4`, `BAPIRET2`, `SYUNAME`) | succeeds |
| Draft pending after activation, then update with only `rowType` | the draft description survives: the version-less GET under the lock returns the inactive version |
| Sorted table with unique key components (crafted with a raw PUT), update with only `description` | refused, nothing written; an explicit `rowType` rewrites it as a standard table |

Further observations:

- SAP derives `builtInType` for dictionary rows: ARC-1 sends `STRU` with length 0, and a `SYUNAME` row
  reads back as `CHAR` 12.
- An `INT4` row created with length 0 reads back with length 0 even when active; activation warns
  `Number of positions is corrected to 10`. SAP-delivered `INT4` table types return 10.
- The create POST alone stores the description and a `CHAR` 1 row. A description-only update of that
  shell keeps `CHAR` 1, which proves the carry for a non-zero length.
- SAP accepted the PUT of a sorted table with unique key components in the builder's element order.
  That is the first evidence for FEAT-78; secondary keys, aliases and reference or range rows are
  untested.


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
