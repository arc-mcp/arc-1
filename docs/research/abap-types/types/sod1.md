# SOD1 — API Package

Verified 2026-10-29 from an Eclipse ADT 3.60.3 communication log (plugin `com.sap.adt.com.sod2` 3.60.1)
against S/4HANA, SAP_BASIS 8.16 SP01: create, edit and delete of an API package and an API package
assignment (SOD2), each with a Knowledge Transfer Document. Fixtures in `tests/fixtures/xml/sod1-*.xml`
and `sod2-metadata-odatav4.xml` / `sod2-deletion-check-with-ktd.xml` are anonymized copies.

| Contract | Observed value |
|---|---|
| ADT type | `SOD1` (no slash subtype) |
| Collection | `/sap/bc/adt/aps/com/sod1`, advertised by discovery with `application/vnd.sap.adt.blues.v1+xml`; a display-only user gets the collection with an empty `<app:accept/>`, so ARC-1 gates on the listing, not on the media type |
| Metadata | `GET` collection + lowercase name, root `sod1:sod1` (namespace `http://www.sap.com/oda/sod1`) |
| Assignments | `GET …/sod1/$packageassignments?name=<NAME>`, `application/vnd.sap.adt.oda.packageassignments+xml` |
| Name check | `POST …/sod1/validation?objtype=sod1&objname=…&description=…` (Eclipse wizard; not used by ARC-1) |

## Create, update, delete (SOD1 and SOD2)

| Step | Request |
|---|---|
| Create | `POST <collection>?corrNr=<TR>`, `Content-Type`/`Accept` blues.v1; body: root with `adtcore:type`, `name`, `description`, `packageRef` and a minimal `content` (SOD1: `abbreviation`; SOD2: API reference) → `201`, `Location` = lowercase object URI |
| Update | `POST <uri>?_action=LOCK&accessMode=MODIFY` → `PUT <uri>?lockHandle=…&corrNr=…` with the complete metadata document (as read, with changed elements) → unlock |
| Activation | none: Eclipse never activates SOD1 or SOD2; the saved document is what SAP returns afterwards |
| Delete | `POST /sap/bc/adt/deletion/check` (object URI) → `POST /sap/bc/adt/deletion/delete` with `<del:transportNumber>`; no lock handle |

The deletion check reports the locking transport and, for an assignment with a KTD, an
`includedObject` (`SKTD/TYP`, `mustBeDeletedWithParent="true"`). Eclipse then sent both in one
delete request: SAP deleted the KTD and refused the assignment ("prerequisites for deleting the API
package assignment are not met"); deleting the assignment alone afterwards succeeded. ARC-1 therefore
refuses to delete an object with included objects and asks for the KTD to be deleted first.

Tags are written as `<tag><value/><category/></tag>`; SAP assigns the `id` returned on read. URLs follow
the same pattern (`technicalName`, `displayName`, `value`, `version`, `text`). `abapLanguageVersion` of a
new API package follows its ABAP package (`cloudDevelopment` in a cloud package, `standard` otherwise).

## Knowledge Transfer Documents

`POST /sap/bc/adt/documentation/ktd/documents?corrNr=…` with `<sktd:refObject adtcore:type="SOD1"
adtcore:uri="/sap/bc/adt/aps/com/sod1/<name>"/>` (respectively `SOD2`): the parent type has no slash
subtype, the URI uses the lowercase name. The KTD is then edited and activated like any other KTD.
