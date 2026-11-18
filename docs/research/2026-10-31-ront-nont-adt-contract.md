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
| NONT without `sapObjectType` | Not tested | Saved, activation failed (“No SAP Object Type was referenced”) |
| Activate RONT before and after its root | First activation warned about the missing root. Activation after a source edit and root activation succeeded without that warning. | Same |

On 758 and 816, a source PUT with `technicalobject` or the unknown value `zz` stored `businessObject`. The exact AFF spelling `technicalObject` read back as supplied. On 816 the wizard property used a different representation. The short code `to` worked without nested `metadata`, while `zz` and `technicalObject` in that property produced `ZZ` and `TE`.

Later on 2026-11-18 the author ran ARC-1 at `cdc000f5` on BTP ABAP Environment 2611 (Cloud Foundry in the same subaccount, `OAuth2UserTokenExchange`, a `ZLOCAL` sub-package). The properties-free create sequence created, updated, activated and deleted a RONT, a root and an item NONT, and a KTD on the RONT. `interfaceBehaviorDefinition` was accepted. The three invalid NONT cases behaved as on 816. A NONT without `sapObjectType`, a root NONT named differently from its RONT, and a NONT naming a missing RONT were all saved. Each failed activation: “No SAP Object Type was referenced”, “… differs from SAP Object Type …” and “Referenced SAP Object Type … does not exist”.

On 816 and 2611, activation is therefore SAP's validation point for node types, and ARC-1 does not repeat these checks before the write. On 758 a NONT naming a missing RONT activates with only a warning (table above). ARC-1 leaves that to SAP as well.

## KTD creation and deletion

The two collections and the KTD endpoint exist on both on-prem releases. Only the tested 816 system registered `CL_RONT_DOCU_STRUCTURE` for `RONT/ROT` in `WBOBJTYPES_SCOPE` under `DOCUMENTATION`. The wizard's `documentation/ktd/documents/validation` POST returned an AS-XML status of `OK` on 816 and `ERROR` with “Knowledge Transfer Document not supported for SAP Object Type” on 758. ARC-1 requires explicit approval from this endpoint before it creates a RONT-backed KTD. The parent URI is `/sap/bc/adt/businessobjects/rontrot/<lowercase-name>`.

On 816 the deletion precheck marked the KTD as an `includedObject` with `mustBeDeletedWithParent="true"`. It listed the root and item NONTs as “Used by” warnings. A plain locked parent DELETE left all three objects readable. ARC-1 refused the same deletion while the KTD existed. Deleting the KTD, item, root and RONT in order removed all four. On both systems canonical reads returned 404 after cleanup and a prefix search found no test objects.
