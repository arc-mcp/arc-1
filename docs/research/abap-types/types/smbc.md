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

## Writes (verified 2026-10-28 on 816)

SMBC is registered as a server-driven type, so `SAPWrite` update and delete use the shared
engine. Captured from ADT 3.60 editing an existing SMBC (list report, object pages, table
settings and configuration group changed), then activating it:

| Step | Request |
|---|---|
| Lock | `POST <object>?_action=LOCK&accessMode=MODIFY` (returns lock handle and the recording request) |
| Metadata | `PUT <object>?lockHandle=…&corrNr=…`, `application/vnd.sap.adt.blues.v1+xml`, the unchanged `blueSource` |
| Source | `PUT <object>/source/main?lockHandle=…&corrNr=…`, `application/json; charset=utf-8`, the complete JSON |
| Unlock | `POST <object>?_action=UNLOCK&lockHandle=…` |
| Activate | `POST /sap/bc/adt/activation?method=activate&preauditRequested=true` with the object URI |

ADT re-sends the unchanged metadata; ARC-1 writes only the source, as for the other blue types,
because SMBC has no metadata field that `update` changes. While editing, ADT validated the
unsaved metadata and JSON through `POST /sap/bc/adt/checkruns` with both as base64 artifacts.
SAP reported content errors there, for example an unknown configuration group or
"Transportauswahlleiste wird nur für Wurzelentität Singleton unterstützt" for a non-root object
page; activation runs the same checks (`checkExecuted="true"`).

Create stays unsupported: discovery offers no `$new` schema/content templates for `smbctyp`
(unlike other `bct` types), and ADT creates SMBC only through the `smbc` object generator,
together with the service and data model it configures. ARC-1 refuses `create` with a pointer to
the generator. Delete follows the shared engine (deletion check when advertised, locked DELETE,
absence read) and still lacks a captured ADT trace for SMBC.

### Live run through ARC-1 (2026-10-28, 816)

An MCP agent ran update, read-back, activation, KTD update and delete through a single-target
BTP Cloud Foundry write instance with principal propagation. Findings:

- SAP stores and activates a source with a value outside its schema without any message and
  drops the value: `appConfiguration.listReport.variantManagement: "control"` (schema: `page`,
  `none`) disappeared on save; activation reported success. ARC-1 therefore checks `update`
  sources against `GET <object>/schema` (`application/vnd.sap.adt.serverdriven.schema.v1+json;
  framework=objectTypes.v1`, the AFF `smbc-v1` schema) before locking. The schema is interpreted,
  not compiled (`src/adt/object-schema.ts`).
- SAP omits values that equal their schema default (`rowCountMode: "fixed"`, `initialLoad:
  "enabled"`, `selectionMode: "multi"`); ADT's own save shows the same. The meaning is kept.
- Inactive and active versions behaved as expected: after `update` the inactive version carried
  the change and the object was in the inactive list; `SAPActivate` made it active.
- Delete of the SMBC succeeded and the object read 404 afterwards. Its KTD was not deleted with it.
- Whether SAP refuses semantically invalid but schema-valid content on save or only on activation
  (ADT showed such errors through `checkruns`) was not exercised; the planned case did not change
  the content.

KTD documentation for an SMBC parent was captured in the same session: ADT posted the same
`<sktd:docu>` body ARC-1 sends (`refObject` type `SMBC/TYP`, URI `/sap/bc/adt/bct/smbctyp/<name>`).
