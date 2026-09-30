# APLO, SAJC and SAJT — ADT wire contract

Initial verification: 2026-09-28 on SAP_BASIS 816 (Basic auth) and a BTP ABAP trial
(named-user OAuth). Independent verification: 2026-09-30 through the production dispatcher
on 750, 758, 816 and BTP 920. Availability comes from discovery, not a hard-coded release threshold.

## Contract

| Type | Collection under `/sap/bc/adt/` | Metadata MIME | `adtcore:type` | Source |
|---|---|---|---|---|
| APLO | `applicationlog/objects` | `application/vnd.sap.adt.blues.v1+xml` | `APLO/TYP` | AFF JSON: `header`, optional `subobjects[]` |
| SAJC | `applicationjob/catalogs` | `application/vnd.sap.adt.blues.v2+xml` | `SAJC` | AFF JSON: `generalInformation.className`, `parameters[]` |
| SAJT | `applicationjob/templates` | `application/vnd.sap.adt.blues.v2+xml` | `SAJT` | AFF JSON: `generalInformation.catalogName`, `parameters.singleValueParameters[]` / `valueRangesParameters[]` |

All three use `<blue:blueSource>` metadata and JSON source PUT under a lock. The generic
SDO package gate, lock lifecycle, no-create-replay policy and verified deletion remain in use.
The package determines the language version; setting `header.abapLanguageVersion` alone does
not override it. APLO names are limited to 20 characters (`BALOBJ-OBJECT`).

**APLO saves are immediately active**, including metadata-only creation on 758/816. Source PUT
changes the active object before any SAPActivate call. SAP substitutes the active version for
an unavailable inactive version; ARC-1's explicit-version check correctly refuses that substitution.
Catalogs and templates have inactive drafts and require activation.

## Creation-reference defect and fix

The original PR used a metadata-only POST followed by source PUT for every type. On 758,
SAJT's POST failed with 500 “Dereferencing of the NULL reference”; on 816 it succeeded.
SAJC created on both, but omitting its creation reference also skipped initialization from
the class. A later source PUT is not a substitute for supplying the wizard's required inputs.

Both systems' `$new/schema` require `className` for SAJC and `catalogName` for SAJT.
Reading SAP's `SADT_BLUE_SOURCE` / `SADT_CONTENT` transformations and the
`CL_SAJC_CREATION_HANDLER` / `CL_SAJT_CREATION_HANDLER` implementations established the wire form:

```xml
<blue:additionalCreationProperties>
  <adtcore:content adtcore:type="application/vnd.sap.adt.objecttype.new.content.additional.v1+json">{"catalogName":"ZMY_CATALOG"}</adtcore:content>
</blue:additionalCreationProperties>
```

It follows `adtcore:packageRef` in the create document. ARC-1 takes the reference from
`source.generalInformation`, XML-escapes the JSON, and refuses missing references before POST.
There are no new tool arguments or discovery round trips. The identical body fixed creation
on 758 and preserved the complete lifecycle on 816.

Create dependencies in order: active class implementing `IF_APJ_DT_EXEC_OBJECT` and
`IF_APJ_RT_EXEC_OBJECT` → create/activate catalog → create/activate template. SAP invokes the
class's `GET_PARAMETERS` during definition processing. The spike used a disposable class whose
method returned one harmless parameter; its execute method was empty and was never run.

## Independent live results — 2026-09-30

| Target | Result |
|---|---|
| 750 / NPL | No collections advertised. Read, create and activate refused for all three types; no objects created. |
| 758 / a4h | Full APLO and class→SAJC→SAJT create/read/update/activate/delete lifecycle passed with creation references. SAJC AFF readback omits `parameters[]`; SAJT parameter defaults still round-trip. |
| 816 / a4h-2025 | Same lifecycle passed. SAJC readback includes class parameters. Active/inactive template values remain separate until activation. |
| BTP free plan / 920 SP04 | Full APLO and class→SAJC→SAJT lifecycle passed with named-user OAuth in a disposable `ZLOCAL` sub-package. APLO metadata-only creation and an explicit `cloudDevelopment` update also passed, including lock contention and package refusals. |

The dispatcher checks also exercised read-only refusal, actual-package enforcement, malformed
JSON before creation, repeated APLO saves, and missing-version refusal. A second session holding
the APLO lock blocked an update; the same update succeeded after unlock without losing content. Templates were deleted
before catalogs during cleanup, and every application-log, job and class fixture was confirmed absent with GET 404.
758 allowed deletion of a referenced catalog, whereas 816 refused it: do not rely on uniform
dependency enforcement. Prefer dependency-order cleanup on every release.

The on-premise tests used HTTPS Basic and `$TMP`; BTP used named-user OAuth and a disposable
`ZLOCAL` sub-package. No principal propagation, MCP transport or transport-assigned development was
exercised. No job was scheduled.

BTP catalog cleanup initially returned 400 “Publishing in process”. A later explicit delete succeeded,
and GET 404 confirmed removal. No automatic mutation replay was added. Both fresh BTP APLO objects
were deleted successfully; the earlier unexplained 403 below did not recur.

The temporary BTP package could not be deleted: SAP returned `PAK/051` (not empty), although
ADT search and virtual folders showed no contained objects. After restoring availability, the
released `I_CustABAPObjDirectoryEntry` view revealed a `SUSH` entry marked deleted. Its identifier
matches the deleted test catalog using SAP's `AUTH_TRACE_CALC_HASH` algorithm.

The 920 source trace points to a SAP local-package mismatch: catalog deletion calls
`SU2X_API_DELETE_APPL` → `CL_SU2X_API=>CTS_SET_WBO_ENTRY_STATUS`. Its local-package check recognizes
`$TMP` or software component `LOCAL`, but this non-recording package uses `ZLOCAL`; the other branch
sets the deletion flag instead of removing the directory entry. `CL_PACKAGE` still counts that
entry when checking whether the package is empty. The object's transport properties were empty,
and its responsible user had no listed transport requests. This explanation matches the live
residue but has not been confirmed by SAP. No supported repair was established or directory
workaround added. Object-level GET 404 checks do not establish complete package cleanup; the
package remains a tracked test artifact pending SAP guidance.

## Earlier BTP trial evidence — 2026-09-28

The contributor exercised SAJC/SAJT create, activate, update, read and delete through
`handleToolCall` with named-user OAuth in a new `ZLOCAL` sub-package. Catalog deletion immediately
after activation sometimes returned 400 “Publishing in process”; retry after SAP finishes its
asynchronous publishing. Five fresh APLO objects also completed their lifecycle.

An earlier APLO source PUT returned 403 `S_ABPLNGVS` and left an inconsistent object: reads failed,
subsequent PUTs repeated the error, and DELETE did not remove it. The trigger was not isolated;
this evidence does not establish whether creation metadata, tenant state or authorization caused
it. Do not claim all original test objects were removed. ARC-1's post-delete check detected the
incomplete deletion. The fresh 2026-09-30 on-premise and BTP runs did not reproduce that failure; they do not identify its original cause.

## Primary references

- SAP AFF schemas: [APLO](https://github.com/SAP/abap-file-formats/blob/main/file-formats/aplo/aplo-v1.json),
  [SAJC](https://github.com/SAP/abap-file-formats/blob/main/file-formats/sajc/sajc-v1.json),
  [SAJT](https://github.com/SAP/abap-file-formats/blob/main/file-formats/sajt/sajt-v1.json).
- [SAP Help: creating application job templates (2023 FPS02)](https://help.sap.com/docs/ABAP_PLATFORM_NEW/c238d694b825421f940829321ffa326a/b64216261fc84bd0808610aea4f31177.html?version=202310.002)
  requires a catalog reference in the creation wizard.
