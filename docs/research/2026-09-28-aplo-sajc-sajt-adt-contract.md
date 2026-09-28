# APLO, SAJC and SAJT — ADT wire contract

Verified 2026-09-28 against an on-premise S/4HANA development system (SAP_BASIS 8.16, S4CORE 109),
Basic auth, both with raw ADT requests and end to end through ARC-1's own code path
(`arc1-cli call SAPRead|SAPWrite|SAPActivate`), and on a BTP ABAP Environment trial through
`handleToolCall` with a named-user token. All test objects were deleted afterwards.

## Discovery

| Collection | Title | Accept |
|---|---|---|
| `/sap/bc/adt/applicationlog/objects` | Application Log Object | `application/vnd.sap.adt.blues.v1+xml` |
| `/sap/bc/adt/applicationjob/catalogs` | Application Job Catalog Entry | `application/vnd.sap.adt.blues.v2+xml` |
| `/sap/bc/adt/applicationjob/templates` | Application Job Template | `application/vnd.sap.adt.blues.v2+xml` |

All three also advertise the server-driven `$schema`, `$configuration`, `source/formatter` (JSON)
and `validation` sub-collections, i.e. they are ordinary "blue" server-driven objects.

## APLO / SAJC / SAJT (server-driven)

| Type | Metadata root | `adtcore:type` | Source |
|---|---|---|---|
| APLO | `blue:blueSource` | `APLO/TYP` | AFF JSON: `header`, `subobjects[] {name, description}` |
| SAJC | `blue:blueSource` | `SAJC` (bare, no subtype) | AFF JSON: `header`, `generalInformation.className`, `parameters[] {name, readOnly?}` |
| SAJT | `blue:blueSource` | `SAJT` (bare, no subtype) | AFF JSON: `header`, `generalInformation.catalogName`, `parameters.singleValueParameters[] {name, value}`, `parameters.valueRangesParameters[] {name, valueRanges[]}` |

- **Create** with the minimal blue body (`adtcore:type` as above, package ref) → 201, object inactive;
  source PUT `application/json` under a lock; SAPActivate activates.
- **SAJC activation** regenerates `parameters[]` from the class's `IF_APJ_DT_EXEC_OBJECT~GET_PARAMETERS`
  (a two-parameter source came back with all 14 class parameters and `readOnly` for radio buttons) and
  returns the class's own warnings (e.g. lowercase parameter names).
- **SAJT** must reference an existing catalog entry; delete templates before their catalog.
- **`header.abapLanguageVersion`** in the source does not override the package's language version:
  objects created in `$TMP` read back as `standard`.
- **Delete**: the generic SDO delete (lock → deletion check → DELETE → unlock → 404 confirmation) works for all three.

## BTP ABAP Environment (trial, 2026-09-28)

Browser OAuth with a named user; objects in a new `ZLOCAL` sub-package, all through `handleToolCall`.

| Type | Observation |
|---|---|
| SAJC / SAJT | class implementing `IF_APJ_DT_EXEC_OBJECT`/`IF_APJ_RT_EXEC_OBJECT` → SAJC create/activate → SAJT create/activate/update/activate → read → SAJT delete succeed. SAJC delete right after activation: 400 `Publishing in process for &APP_ID& in catalog &BU_CATALOG_ID&` (SAP's asynchronous launchpad-catalog publishing) |
| APLO | create (with and without source in the create call, with and without `header.abapLanguageVersion`) → activate → update → activate → read → delete succeed on five fresh objects |
| All | The generic create body needs no cloud-specific change; the owner comes from the JWT |

**Intermittent APLO 403.** In the first runs, a source PUT for a new APLO failed with 403
`You are not authorized to make changes (authorization object S_ABPLNGVS)`, independent of
`header.abapLanguageVersion`. Such an object stays inconsistent: reads fail with "Error while importing
object … from the database", later source PUTs repeat the 403, and SAP accepts a DELETE but keeps the
object (ARC-1's post-delete check reports this as incomplete deletion). Re-using that name reproduces the
state; fresh names in the systematic re-test above did not. The trigger is on the SAP side and was not
isolated.

The existing BTP create-body check (`btp-abap.integration.test.ts`) builds names of ~24 characters;
APLO names are limited to 20 (`BALOBJ-OBJECT`), so that check fails with 500 "Data was lost while
copying a value" for APLO only — a test-harness limit, not a create-body problem.
