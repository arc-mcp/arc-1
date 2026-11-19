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

Delete follows the shared engine (deletion check when advertised, locked DELETE, absence read)
and still lacks a captured ADT trace for SMBC.

## Create

ADT accepts a direct create without the `smbc` object generator. Discovery advertises no `$new`
templates for `smbctyp` (unlike other `bct` types), but `GET <collection>/$new/schema` returns the
SMBC schema. Contract:

| Step | Request |
|---|---|
| Schema | `GET /sap/bc/adt/bct/smbctyp/$new/schema` (same Accept as the object schema) |
| Create | `POST /sap/bc/adt/bct/smbctyp`, `application/vnd.sap.adt.blues.v1+xml`, `blue:blueSource` with `adtcore:type="SMBC/TYP"` and `packageRef` |
| Source | Lock, `PUT <object>/source/main` (`application/json`), unlock |
| Activate | As for update |

After create, the inactive source is a JSON skeleton: a header with `description` and
`originalLanguage`, empty `serviceConfiguration` fields with `serviceVersion: "0000"` and
`skipRootEntity: false`, and `appConfiguration: {"listReport":{}}`. BTP adds an empty
`serviceConfiguration.transportObject`. ARC-1 checks a create `source` against the `$new` schema
before the POST, so a refused source leaves no object.

`header.abapLanguageVersion` follows the ABAP language version of the package, not the release: the
skeleton carries `"cloudDevelopment"` in an ABAP for Cloud Development package (816 and BTP) and no
such field in a Standard ABAP package or in `$TMP` (816). SAP ignores the field in a source PUT: a
save with `"cloudDevelopment"` in a Standard ABAP package succeeds without a message, and the
read-back omits it. When `serviceConfiguration.name` is empty, SAP fills it with the object name on
save.

Evidence:

- 758: direct create and activation against a draft-enabled service during the
  [KTD parent lifecycle](../../2026-10-07-ktd-smbc-parent.md).
- 816 and BTP ABAP (SAP_BASIS 921), 2026-11-19, low-level ADT helpers, disposable objects: create,
  source save, inactive read-back and locked delete worked on both. Activation succeeded on BTP; on
  816 SAP refused it because the referenced service was already used by a delivered SMBC.
- Through `SAPWrite` on 816 (S/4HANA 2025 FPS01, single-target BTP Cloud Foundry write instance with
  principal propagation) and BTP ABAP environment 2611 (same subaccount, `OAuth2UserTokenExchange`),
  2026-11-19; see the live run below.

Rules SAP enforces, all on activation, not on save:

- One SMBC per service and version ("Service … already used in BC Object …").
- The referenced service must be draft-enabled; a non-draft service fails activation (758).
- `rootEntitySet` must name a root entity with a behavior definition ("Select a CDS root entity set
  with existing behavior definition.", 2611).
- `skipRootEntity: true` requires a singleton root ("Singleton entity could not be retrieved",
  2611); a non-singleton root activates with `false`.
- On BTP, `$TMP` is refused with a missing `S_ABPLNGVS` authorization; the object needs a cloud
  package under `ZLOCAL`.

The generator remains the route when the service and data model do not exist yet; it creates them
together with the SMBC.

### Live run through ARC-1 (2026-11-19, 816 and BTP 2611)

An MCP agent ran the create path through `SAPWrite` with disposable objects:

| Step | 816 | BTP 2611 |
|---|---|---|
| Create with a source outside the `$new` schema | refused before the POST; object absent afterwards | same |
| Create with source | shell and source written in one call; recorded in the given transport; package correct | n/a (created without source, then updated) |
| Create without source | skeleton as above | skeleton as above, plus `transportObject` |
| Activate (unused, draft-enabled service) | succeeded; active source equals the written one | succeeded after choosing a root entity with a behavior definition and `skipRootEntity: false` |
| Second SMBC on the same service | save ok, activation refused ("Service … wird in BC-Obj. … verwendet") | save ok, activation refused ("Service … already used in BC Object …") |
| Delete | object absent afterwards | same |

On 816 the object recreated an SMBC that the generator had produced before, using its original source
unchanged; the read-back after activation was identical to the written source.

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
