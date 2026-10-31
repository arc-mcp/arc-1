# RONT and NONT — ADT wire contract

Source: Eclipse ADT 3.62 communication logs of a BTP ABAP Environment (release 2611), 2026-10-31.
The logs cover creating a SAP object type (`RONT`), a knowledge transfer document on it, its root
node type (`NONT`), source changes and activation of both, and deleting all three. The objects
lived in a local (`ZLOCAL`) package, so no transport request was involved. The ADT discovery of an
S/4HANA 2025 system (SAP_BASIS 816) advertises the same collections, media types and template links.

## Contract

| Type | Collection under `/sap/bc/adt/` | Metadata MIME | `adtcore:type` | Source |
|---|---|---|---|---|
| RONT | `businessobjects/rontrot` | `application/vnd.sap.adt.blues.v2+xml` | `RONT/ROT` | AFF JSON (`ront-v1.json`): `header`, `typeCategory`, `name`, `objectTypeCode`, `interfaceBehaviorDefinition`, `odmEntityName` |
| NONT | `businessobjects/nontnot` | `application/vnd.sap.adt.blues.v2+xml` | `NONT/NOT` | AFF JSON (`nont-v1.json`): `header`, `name`, `sapObjectType`, `rootNode` |

Both use `<blue:blueSource>` metadata, a JSON source at `…/{name}/source/main` (`application/json`
for GET and PUT) under a lock, generic activation and the deletion framework. That is the existing
server-driven object engine; only the creation input is type specific.

## Creation input

The creation wizard is server driven: `$new/schema`, `$new/configuration` and `$new/content`
describe it, a side effect fills `metadata` while the name is typed, and
`<collection>/validation` checks the input. The create POST carries the result as additional
creation properties after `adtcore:packageRef`:

| Type | `$new/schema` properties | Required |
|---|---|---|
| RONT | `name` (30), `typeCategory` (`bo`, `to`, `ao`, `co`, `do`, `ho`), `metadata {name, description, package}` | `name` |
| NONT | `name` (30), `sapObjectType` (30, a RONT), `rootNode` (boolean), `metadata {…}` | `name`, `sapObjectType` |

The wizard's category codes are the short forms of the AFF `typeCategory` values (`bo` =
`businessObject`, `to` = `technicalObject`, `ao` = `analyticalObject`, `co` = `configurationObject`,
`do` = `dependentObject`, `ho` = `hierarchyObject`).

Eclipse 3.62 sends the properties base64-encoded with `adtcore:type="application/vnd.sap.adt.serverdriven.content.v1+json"`.
ARC-1 uses the escaped-JSON form with `application/vnd.sap.adt.objecttype.new.content.additional.v1+json`
that SAP's `SADT_CONTENT` transformation already reads for SAJC/SAJT on 758 and 816
([APLO/SAJC/SAJT contract](2026-09-28-aplo-sajc-sajt-adt-contract.md)). Discovery advertises the
same `$new/content` media type for SAJC, SAJT, RONT and NONT.

ARC-1 derives the properties from the AFF source of the create call: `name` from `source.name`
(default: the object name), `typeCategory` from `source.typeCategory` (default `businessObject`),
`sapObjectType` and `rootNode` from the NONT source, and `metadata` from name, description and
package. An unknown category or a NONT without `sapObjectType` is refused before the POST. The
source PUT after creation writes the remaining fields (`objectTypeCode`,
`interfaceBehaviorDefinition`).

## Observed SAP behaviour

- Both objects are created inactive and need activation.
- Activating a RONT without a root node type succeeds with warning `RAP_SOT_RONT_WB/020`
  "Corresponding SAP Object Root Node Type missing".
- NONT validation with `rootNode: true` refuses a node type name that differs from the object
  type: `RAP_SONT_WB/013` "SAP Object Root Node Type '…' differs from SAP Object Type '…'".
- The source PUT echoes the stored JSON. SAP drops an empty `interfaceBehaviorDefinition` and
  `rootNode: false` from the stored source.
- The RONT value help for `interfaceBehaviorDefinition` is
  `POST rontrot/$values?objectUri=…&path=$.interfaceBehaviorDefinition&kind=domainSpecificNamedItems`.
  ARC-1 does not call it; SAP checks the value on save and activation.
- Eclipse also PUTs the unchanged metadata document before the source. ARC-1 does not; the
  metadata carries nothing the source does not.

## Knowledge transfer documents

`RONT/ROT` is a KTD parent type (`WBOBJTYPES_SCOPE`, `DOCUMENTATION`). Eclipse validates with
`documentation/ktd/documents/validation?objtype=SKTD/TYP&refObjType=RONT/ROT` and creates with the
usual `sktd:docu` body; its `sktd:refObject` points to `/sap/bc/adt/businessobjects/rontrot/<name>`
(lowercase). The document has one node for the object type itself, with an optional long text
and no short text. NONT is not a registered KTD parent type.

## Deletion

Eclipse deletes through `deletion/check` and `deletion/delete` without a lock. For a RONT with a
KTD the check reports `isDeletable="true"`, a warning "Used by … (SKTD/TYP)" and the KTD as
`includedObject` with `mustBeDeletedWithParent="true"`; Eclipse then deletes both in one request.
ARC-1's server-driven delete sends a plain DELETE of one object under a lock. It therefore refuses
when the precheck lists a KTD and asks for the KTD to be deleted first. Node types are deleted
before their object type.

## Primary references

- SAP AFF schemas: [RONT](https://github.com/SAP/abap-file-formats/blob/main/file-formats/ront/ront-v1.json),
  [NONT](https://github.com/SAP/abap-file-formats/blob/main/file-formats/nont/nont-v1.json).
