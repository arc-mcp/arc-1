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

## SAP-side validation

Verified 2026-10-29 through ARC-1 on the same release:

- An invalid save is refused with `400` and the generic `SWB_TOOL/036` ("… contains errors and cannot be
  saved"). A check run with the edited document as artifact of the object URI (`POST /sap/bc/adt/checkruns`,
  `chkrun:contentType="application/vnd.sap.adt.blues.v1+xml; charset=utf-8"`), as Eclipse sends before
  saving, names the cause. ARC-1 runs it after a refused save and adds the findings to the error.
- Tag values come from a value help per category (`GET …/sod1/tagvaluehelp/values?name=*&data=<category>`);
  the captured system refused other values ("tag value … is not allowed for tag category …").
- `adtConfigurationItems` in the metadata switch fields off per API package. On the captured system, in a customer-namespace package
  (`namespace` `customer.ext`) `ui_attribute__type` and `ui_attribute__is_scope_dependent` have
  `isEnabled=false`; SAP then keeps the stored value and still answers the save with `200`. ARC-1 refuses a
  change to a switched-off field before saving.

## Knowledge Transfer Documents

`POST /sap/bc/adt/documentation/ktd/documents?corrNr=…` with `<sktd:refObject adtcore:type="SOD1"
adtcore:uri="/sap/bc/adt/aps/com/sod1/<name>"/>` (respectively `SOD2`): the parent type has no slash
subtype, the URI uses the lowercase name. The KTD is then edited and activated like any other KTD.

## Direct CLI verification, 2026-11-20

The local PR #1131 build used on-premise Basic authentication, cache disabled, and disposable
objects in `$TMP`. Both 7.58 and 8.16 created, updated and deleted SOD1 and SOD2. A SOD2
referencing `SPRX CO_KEY_MAP_RPLCTCO` accepted a locked follow-up save. On each release,
KTD create, Markdown update, activation and read-back succeeded on both parent types.
Parent deletion named the dependent KTD. After deleting the KTD, ARC-1 deleted the parent.
Deleting a package with a remaining assignment produced SAP's prerequisites message. A separate
assignment listing named the blocker. On 7.50 both collections were absent from discovery.

In `$TMP`, both releases stored types `1` and `2` in namespace `customer.ext`.
8.16 also stored changes to `isScopeDependent` in both directions. The 7.58 document omitted
this field, so an explicit edit was refused. Omitting it from the read result let a full
read-edit-save round trip succeed. Neither system reproduced the 8.16 author's switched-off
field configuration. Both accepted an arbitrary category-`2` value under `customer.arc1`.
Category `ZZ_INVALID` produced a transformation/deserialization error on both object types.

Raw metadata from a tagged SOD1 with a URL and a tagged SOD2 on each release had one
`content` and one occurrence of each exposed writable field. The 7.58 SOD1 had no
`isScopeDependent`. Edits use the qualified field's source positions in SAP's original XML.

On both releases a manual documentation link on a type-`2` assignment and a nonexistent
leading business object type produced `SWB_TOOL/036`. The check run identified the internal-package
requirement and the unknown business object respectively. ARC-1 runs this diagnostic for that
message when detailed errors are enabled. Transportable-package recording and a live
principal-propagation route were outside this run.
