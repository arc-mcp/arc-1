# SMBC — Business Configuration Maintenance Object

Verified 2026-10-11, following the [758 KTD parent lifecycle](../../2026-10-07-ktd-smbc-parent.md).

| Contract | Observed value |
|---|---|
| ADT type | `SMBC/TYP` |
| Collection | `/sap/bc/adt/bct/smbctyp` |
| Metadata | `application/vnd.sap.adt.blues.v1+xml`, `blue:blueSource` |
| Object URI | Collection + lowercase, URI-encoded name |
| Source | `/source/main`, `application/json` |
| Versions | Explicit `?version=active` / `inactive` on metadata and source |

Discovery advertises the collection on SAP_BASIS 758 SP02, 816 SP01 and BTP ABAP;
it is absent on 750 SP02. Read-only inspection of `BEL_ACTIVATE_SOT` on 816 and
`/AIF/MESSAGEDELETION` on BTP confirmed the type, packageRef and native JSON.
The latter uses `/sap/bc/adt/bct/smbctyp/%2faif%2fmessagedeletion` (percent-escape
case is equivalent). Source carries `formatVersion`, `header`, service and app
configuration; ARC-1 preserves it rather than maintaining another schema.

SAP may return active metadata when an absent inactive version was requested.
ARC-1 checks explicit selections before returning source. Omitted/auto reads use
the unversioned developer view. Transport check/history use the same object URI;
SAP still decides recording requirements and whether an object is changeable.
On BTP, checking a protected SAP object correctly returns the backend's refusal.

The shared URI mapping also corrects activation, ATC, syntax-check and navigation
routing, which previously fell back to a program URI. Existing activation write
and package gates still apply; endpoint support is decided by SAP.

SAPWrite creation/update/deletion remains unsupported. KTD documentation creation
against an existing SMBC parent is a separate, already-supported operation.
