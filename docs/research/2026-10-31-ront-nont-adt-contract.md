# SAP object types and node types in ADT

| Type | Collection under `/sap/bc/adt/` | Subtype | AFF source fields |
|---|---|---|---|
| RONT | `businessobjects/rontrot` | `RONT/ROT` | `name`, `typeCategory`, `objectTypeCode`, `interfaceBehaviorDefinition`, `odmEntityName` |
| NONT | `businessobjects/nontnot` | `NONT/NOT` | `name`, `sapObjectType`, `rootNode` |

Both use `blue:blueSource` metadata with `application/vnd.sap.adt.blues.v2+xml`. ARC-1 creates the metadata, locks the object, writes AFF JSON to `source/main`, and unlocks. SAP handles activation. [RONT schema](https://github.com/SAP/abap-file-formats/blob/main/file-formats/ront/ront-v1.json) · [NONT schema](https://github.com/SAP/abap-file-formats/blob/main/file-formats/nont/nont-v1.json)

## Create and activate

The 2026-10-31 Eclipse ADT 3.62 trace on BTP ABAP Environment 2611 includes wizard properties in the create POST. The author's ARC-1 run on S/4HANA 2025 FPS01 (816) used those properties, BTP Cloud Foundry principal propagation, and a transportable package. It covered CRUD, activation, and a KTD attached to the RONT.

On 2026-11-18 a direct ADT comparison and the built CLI (`99b3b07fa`, HTTP Basic, `$TMP`) established the following on SAP_BASIS 758 and 816.

| Experiment | 758 | 816 |
|---|---|---|
| Plain metadata POST, then AFF source PUT | RONT, root and item NONT activated. Non-default category and node ownership read back. | Same |
| Activate an empty RONT shell | Succeeded with warnings | Failed with “Missing Name for SAP Object Type” until source was supplied |
| Root NONT named differently from its RONT | Saved, activation failed | Same |
| NONT naming a missing RONT | Activated with a warning | Activation failed |
| Activate RONT before and after its root | First activation warned about the missing root. Activation after a source edit and root activation succeeded without that warning. | Same |

On both releases a source PUT with an unknown category (`zz`) succeeded and changed `technicalObject` to `businessObject` on read-back. On 816 the wizard property used a different representation. The short code `to` worked without nested `metadata`, while `zz` and `technicalObject` in that property produced `ZZ` and `TE`.

The BTP service-key target returned HTTP 503 (“ABAP Environment - System is stopped”) on 2026-11-18. The properties-free create sequence still needs an ARC-1 run there.

## KTD creation and deletion

The two collections and the KTD endpoint exist on both on-prem releases. Only the tested 816 system registered `CL_RONT_DOCU_STRUCTURE` for `RONT/ROT` in `WBOBJTYPES_SCOPE` under `DOCUMENTATION`. The wizard's `documentation/ktd/documents/validation` POST returned an AS-XML status of `OK` on 816 and `ERROR` with “Knowledge Transfer Document not supported for SAP Object Type” on 758. ARC-1 requires explicit approval from this endpoint before it creates a RONT-backed KTD. The parent URI is `/sap/bc/adt/businessobjects/rontrot/<lowercase-name>`.

On 816 the deletion precheck marked the KTD as an `includedObject` with `mustBeDeletedWithParent="true"`. It listed the root and item NONTs as “Used by” warnings. A plain locked parent DELETE left all three objects readable. ARC-1 refused the same deletion while the KTD existed. Deleting the KTD, item, root and RONT in order removed all four. On both systems canonical reads returned 404 after cleanup and a prefix search found no test objects.
