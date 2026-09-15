# SAPWrite

Create, update, or delete ABAP objects. ARC-1 handles locking and unlocking. Requires `SAP_ALLOW_WRITES=true`, the [`write` user scope](../authorization.md), and an allowed package.

```text
SAPWrite(action="edit_method", type="CLAS", name="ZCL_ORDER",
  method="get_name", source="METHOD get_name.\n  result = name.\nENDMETHOD.")
```

> **NetWeaver < 7.51:** ADT writes over HTTP require a stateful session that older releases
> don't honor, so writes fail with `423 invalid lock handle` until the `abapfs_extensions`
> enhancement is installed on the SAP system. This is *not* SAP Note 2727890 (a separate
> narrow bug). See [SAP trial setup → Writes fail with 423](../sap-trial-setup.md) (423 troubleshooting section). S/4HANA (≥ 7.51) is unaffected.

## Editing recipes

- [Function modules and structural includes](write-function-modules.md)
- [Class members and include replacement](write-class-members.md)
- [Text symbols, selection texts, and headings](write-text-elements.md)
- [Procedural units](#procedural-unit-surgery)
- [Batch creation](#batch-creation)
- [Launchpad descriptors (UIAD)](#uiad-create-and-update)

## Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | Yes | `create`, `update`, `delete`, `edit_method`, `edit_unit` (on-prem), `edit_class_definition`, `add_method`, `edit_method_signature`, `delete_method`, `change_method_visibility`, `batch_create`, `scaffold_rap_handlers`, `generate_behavior_implementation`, or `edit_text_symbols`. See the [editing recipes](#editing-recipes) for specialized actions. |
| `type` | string | No | `PROG`, `CLAS`, `INTF`, `FUNC`, `FUGR`, `INCL`, `DDLS`, `DCLS`, `DDLX`, `BDEF`, `SRVD`, `SRVB`, `SKTD`/`KTD`, `TABL`, `TTYP` (on-prem), `TABL/DT`, `TABL/DS`, `DOMA`, `DTEL`, `MSAG` (for single object actions; availability is adapted for BTP vs. on-prem), plus the server-driven objects `DESD`/`EVTB`/`DTSC`/`CSNM`/`EVTO`/`COTA`/`DSFD`/`DTDC`/`UIAD` (see [Server-driven object writes](#server-driven-object-writes)). Slash/case aliases are auto-normalized (e.g., `CLAS/OC` or `clas` → `CLAS`; `KTD` → `SKTD`). |
| `group` | string | No | Parent function group: required for FUNC create, auto-resolved for FUNC update/delete if omitted. For structural INCL create/update/delete/edit_unit, selects the owning group. Ignored for other types. |
| `rowType` | string | No | `TTYP` create/update (on-prem only): the row type — a built-in ABAP type (`STRING`, `I`, …) or a DDIC type name such as `BAPIRET2`. |
| `rowTypeKind` | string | No | `TTYP` only: `builtin` or `structure`. Omit it and ARC-1 infers from `rowType`; pass it explicitly when SAP knows a built-in type ARC-1 has not enumerated. |
| `processingType` | string | No | On-prem `FUNC` create only: `normal`, `rfc` (Remote-Enabled), or `update`. Omit it to preserve the legacy SAP-default behavior. |
| `updateTaskKind` | string | No | Required when `processingType="update"`: `startImmediate` (V1 restartable), `immediateStartNoRestart` (V1 non-restartable), or `startDelayed` (V2). Rejected for normal/RFC modules. |
| `parameters` | array | No | FUNC structured signature: `{kind,name,type?,byValue?,default?,optional?}` rows for importing/exporting/changing/tables/exceptions/raising. ARC-1 builds and splices the clauses; omit to send `source` verbatim. |
| `name` | string | No | Object name (for single object actions) |
| `source` | string | No | Source text: complete object for create/update, method body for edit_method, complete FORM/MODULE block for edit_unit, global DEFINITION block or whole selected include for edit_class_definition, METHODS clause for edit_method_signature. Unused by add_method/delete_method/change_method_visibility. See [class members](write-class-members.md) and [function-module signatures](write-function-modules.md). |
| `include` | string | No | CLAS update/edit_method/edit_class_definition: `definitions`, `implementations`, `macros`, or `testclasses`. Omit for MAIN. Whole-include writes create missing includes automatically and save inactive drafts. Global member actions reject this parameter. See [include replacement and validation](write-class-members.md#actionedit_class_definition-replace-the-definition-block-whole). |
| `textPart` | string | No | For `edit_text_symbols`: which part of the textpool to write — `symbols` (default; the numbered `TEXT-nnn` literals), `selections` (a report's selection texts — the labels beside `PARAMETERS`/`SELECT-OPTIONS`), or `headings` (list header and column headers). A class has only `symbols`; `PROG` and `FUGR` have all three. |
| `method` | string | No | For `edit_method`/`edit_method_signature`/`delete_method`/`change_method_visibility`: method NAME (e.g., `"get_name"`, `"zif_order~process"`, `"lhc_project~approve_project"`). For `add_method`: the full METHODS CLAUSE as ABAP source (e.g., `"METHODS greet IMPORTING who TYPE string RETURNING VALUE(r) TYPE string."`). |
| `unit` | string | No | For on-prem `edit_unit`: case-insensitive FORM or MODULE name (for example `"PROCESS_ORDERS"` or `"STATUS_0100"`). |
| `visibility` | string | No | For `add_method`: target visibility section — `public` (default), `protected`, or `private`. For `change_method_visibility`: target visibility section (required). The section header must already exist in the DEFINITION block; if not, ARC-1 refuses with a hint to use `edit_class_definition` first. |
| `abstract` | boolean | No | For `add_method`: when `true`, only the METHODS clause is inserted into DEFINITION — no `METHOD/ENDMETHOD` stub is added to IMPLEMENTATION. Default `false`. |
| `bdefName` | string | No | For `scaffold_rap_handlers`: interface BDEF name used to derive required handler signatures. For `generate_behavior_implementation`: optional override; default discovery reads the class metadata's `<class:rootEntityRef>` to locate the BDEF automatically. |
| `autoApply` | boolean | No | For `scaffold_rap_handlers`: when `true`, create missing `lhc_*` skeletons, inject missing signatures plus empty method stubs into the behavior pool, and write back. Not used by `generate_behavior_implementation` (which always applies; use `dryRun=true` there to preview). |
| `targetAlias` | string | No | For `scaffold_rap_handlers` and `generate_behavior_implementation`: optional RAP entity alias filter (scaffold only one alias/handler class) |
| `activate` | boolean | No | For `generate_behavior_implementation`: when `true` (default), runs `SAPActivate` on the class after writing. When `false`, only the source is written. Activation failures matching the well-known `Local classes of CL_ABAP_BEHAVIOR_HANDLER…` stale-active coupling do **not** throw — they return `activation.success=false` with a guided recovery hint so the just-written CCDEF/CCIMP source remains useful. |
| `dryRun` | boolean | No | For `generate_behavior_implementation`: when `true`, runs discovery + cross-validation + scaffold planning and returns the report **without** writing or activating. Use this to preview what would change. For SKTD/KTD `update`: runs the identical validation of `source` and `shortTexts` and reports which nodes would change and which keep their text, without a PUT. |
| `description` | string | No | Object description for `create` (defaults to name if omitted, max 60 chars) |
| `package` | string | No | Package for new objects (default `$TMP`) |
| `transport` | string | No | Transport request number. For `update` and `delete`, if omitted ARC-1 auto-uses the correction number returned by the SAP lock (if any). Explicit value takes precedence. |
| `lintBeforeWrite` | boolean | No | Override server lint setting for this call (`false` to bypass pre-write lint) |
| `preflightBeforeWrite` | boolean | No | Override deterministic RAP preflight checks for this call (`false` to bypass TABL/BDEF/DDLX/DDLS static checks) |
| `checkBeforeWrite` | boolean | No | Override the server SAP-side pre-write syntax check. When true, diagnostics are appended but do not block the write; activation remains definitive. |
| `dataType` | string | No | DOMA/DTEL: ABAP data type (`CHAR`, `NUMC`, `DEC`, ...) |
| `length` | number | No | DOMA/DTEL: data type length |
| `decimals` | number | No | DOMA/DTEL: decimal places |
| `outputLength` | number | No | DOMA: output length |
| `conversionExit` | string | No | DOMA: conversion exit (e.g., `ALPHA`) |
| `signExists` | boolean | No | DOMA: whether signed values are allowed |
| `lowercase` | boolean | No | DOMA: whether lowercase characters are allowed |
| `fixedValues` | array | No | DOMA: fixed value entries (`[{low, high?, description?}]`) |
| `valueTable` | string | No | DOMA: value table reference (e.g., `T001`) |
| `typeKind` | string | No | DTEL: `domain` or `predefinedAbapType` |
| `typeName` | string | No | DTEL: referenced domain/type name (for `typeKind="domain"`) |
| `domainName` | string | No | DTEL alias for `typeName` when referencing a domain. |
| `shortLabel` | string | No | DTEL: short field label |
| `shortLength` | integer | No | DTEL: reserved short-label length (0–10) |
| `mediumLabel` | string | No | DTEL: medium field label |
| `mediumLength` | integer | No | DTEL: reserved medium-label length (0–20) |
| `longLabel` | string | No | DTEL: long field label |
| `longLength` | integer | No | DTEL: reserved long-label length (0–40) |
| `headingLabel` | string | No | DTEL: heading field label |
| `headingLength` | integer | No | DTEL: reserved heading length (0–55) |
| `searchHelp` | string | No | DTEL: search help name |
| `searchHelpParameter` | string | No | DTEL: search help parameter |
| `setGetParameter` | string | No | DTEL: SET/GET parameter ID |
| `defaultComponentName` | string | No | DTEL: default component name |
| `deactivateInputHistory` | boolean | No | DTEL: `true` disables SAP GUI input history for fields using the data element; `false` does not suppress it |
| `changeDocument` | boolean | No | DTEL: change document flag |
| `messages` | array | No | MSAG: message entries (`[{number, shortText, longText?}]`) — `number` is a 3-digit string (e.g., `"001"`), `shortText` is the message text (max 73 chars) |
| `serviceDefinition` | string | No | SRVB: referenced service definition name (SRVD). Required for SRVB create. |
| `bindingType` | string | No | SRVB: binding type (default `ODATA`) |
| `odataVersion` | string | No | SRVB OData protocol version, `V2` (default) or `V4`; overrides the value inferred from `bindingType`. |
| `category` | string | No | SRVB: binding category (`0` = UI, `1` = Web API; default `0`) |
| `version` | string | No | SRVB: service version for binding metadata (default `0001`) |
| `refObjectType` | string | No | Required for SKTD/KTD create: parent ADT type/subtype such as `DDLS/DF`, `BDEF/BDO`, `SRVD/SRV`, or `DEVC/K`. |
| `refObjectName` | string | No | SKTD/KTD create: documented parent name; defaults to `name`. |
| `refObjectDescription` | string | No | SKTD/KTD create: parent description shown in ADT tooltips. |
| `shortTexts` | array | No | SKTD/KTD update/create: `[{node, text}]`, where `node` is any name or id the SAPRead node index lists (the same resolver as `## <node>` headings; an ambiguous name is refused with its candidates), `text` is at most 60 characters, and `""` clears it. Works without `source`; nodes marked `obligation="forbidden"` are refused. |
| `objects` | array | No | For `batch_create`: ordered list of objects (see below) |
| `activateAtEnd` | boolean | No | For `batch_create` only. Default `false` (per-object inline activation). When `true`, ARC-1 writes inactive drafts for every object then issues one terminal batch-activate — SAP's activator resolves cross-references between siblings in a single pass. Use this for interdependent objects (composition-linked DDLS, RAP behavior stacks where parent references not-yet-active child). Partial-failure semantics are unchanged: a write-phase failure still breaks the loop and only the already-written subset is batch-activated. |

**DDIC metadata writes:** `DOMA`, `DTEL`, `MSAG`, and `SRVB` use structured XML payloads and do **not** use `/source/main`. On DTEL create, an omitted label length is derived from its label text, or defaults to the field's maximum when the label is absent; omitted `deactivateInputHistory` defaults to `false`. On DTEL update, omitted fields keep their stored values, including lengths, the history flag, the SET/GET parameter, the change-document and bidi flags, and the search-help parameter while the search help is unchanged. Changing a label without supplying its length derives a new length from that label. Every DTEL create sends a follow-up metadata PUT because SAP's create POST drops the description, labels, and custom lengths. `MSAG` writes use the `/sap/bc/adt/messageclass/` endpoint and accept a `messages` array of `{number, shortText, longText?}` entries. `SRVB` create uses wildcard content type (`application/*`) and SRVB update uses vendor type (`application/vnd.sap.adt.businessservices.servicebinding.v2+xml`).

**Source-based DDIC writes:** `TABL`, `DDLS`, `DCLS`, `BDEF`, and `SRVD` write source via `/source/main`. `SKTD`/`KTD` instead GETs the complete `<sktd:docu>` envelope and PUTs it back with the v2 KTD media type, changing only addressed Base64 long-text bodies and existing short-text attributes. `TABL` covers both transparent tables (`TABL/DT`) and DDIC structures (`TABL/DS`); ARC-1 auto-resolves between `/ddic/tables/` and `/ddic/structures/` for read/update. `SKTD` writes Markdown knowledge-transfer documentation attached to one KTD-capable ABAP object; `KTD` is accepted as a friendly alias. Create requires `refObjectType` and uses `name` as the documented object name. ARC-1 supports KTD creates for parent types with verified ADT parent URI routing, including `DDLS/DF`, `BDEF/BDO`, `SRVD/SRV`, `SRVB/SVB`, and `DEVC/K`. `CLAS/OC`, `INTF/OI`, and `PROG/P` were not registered for KTD DOCUMENTATION scope on the tested SAP_BASIS 758 and 816 systems; use ABAP Doc for those code objects. Other SAP-registered KTD parent types require ARC-1 parent URI routing before create is enabled.

**KTD node routing:** Copy a node name from the SAPRead index into a `## <node>` section or `shortTexts[].node`. Exact full IDs take precedence; case-insensitive IDs and names must identify one element. If several elements match, use the exact full ID printed in the error or index. An update merges only the addressed nodes. Create/update responses list changed nodes and headings kept as prose. Use `dryRun=true` to inspect that report before writing. Duplicate-ID documents remain readable through SAPRead, grep, and SAPContext; their read context explains that writes are unavailable because the elements cannot be addressed separately.

Keep edits above the read-only metadata marker in a complete SAPRead result. For a root-only H2 edit, keep that context so the root heading is distinguishable from a visible Markdown title. When only the root has documentation, a bare body without its routing H2 also works. Ordinary unmatched headings remain prose and are reported; a node-shaped typo aborts the update. Prefix a reserved prose heading with one backslash (`\## …`) to keep it inside the current node.

## Server-driven object writes

These types support `create`, `update`, and `delete`. Availability depends on the target's ADT
support; discovery controls access. An unavailable type returns an ADT-support error.

| Type | Object | Source and availability |
| --- | --- | --- |
| `DESD` | CDS Logical External Schema | AFF JSON; 8.16+ |
| `EVTB` | RAP Event Binding | AFF JSON; also on 758 |
| `EVTO` | RAP Event Object | AFF JSON; 8.16+; metadata uses blues v2 |
| `DTSC` | CDS Static Cache | DDL text (`define static cache …`); 8.16+ |
| `CSNM` | Core Schema Notation Model | AFF JSON; 8.16+ |
| `COTA` | Communication Target | AFF JSON; 8.16+ |
| `DSFD` | CDS Scalar Function Definition | DDL text (`define scalar function …`); also on 758 |
| `UIAD` | Launchpad App Descriptor Item (LADI) | AFF JSON; 8.16 and supported 758 backports; see below |
| `DTDC` | CDS Dynamic Cache | DDL text (`define dynamic cache …`); also on 758; uses its own DTDC metadata format |

`create` posts metadata, then writes `source` if supplied. Most types remain inactive until
[SAPActivate](sap-activate.md); UIAD has different save behavior. `update` requires complete source.
`update` and `delete` check the object's real package before locking it.

ARC-1 sends the format listed above with the matching content type: JSON as `application/json`,
DDL as `text/plain`. Malformed JSON is rejected before writing. ABAP lint, RAP preflight, and CDS
source guards do not apply to these types. Other actions, including `batch_create`, surgery, and
RAP scaffolding, are unsupported.

### UIAD create and update

Use `type="UIAD"` to maintain a manually created launchpad descriptor. Supply complete AFF JSON
in `source` for create/update. On create, ARC-1 honors an explicit `header.abapLanguageVersion`;
manual `cloudDevelopment` items are editable, including on-premises SAP_BASIS 816. This does not
change an existing object's language version. Creating metadata without `source` is also supported;
read the resulting object and supply its complete source to finish it.

With `source` supplied, ARC-1 runs these checks before metadata creation or locking:

1. Parses the candidate JSON (maximum 1 MiB, with bounded nesting).
2. For updates, checks the object's root `sap.adt.readonly` configuration. A root read-only flag
   blocks the update; nested field flags do not make the whole object read-only.
3. Validates against the target's matching full-source schema, then sends the exact candidate
   to SAP's semantic checker. Schema or semantic errors block mutation; warnings remain warnings.

Unsupported checks are reported as `unavailable`. A different schema format version, such as an
AFF v1 candidate against a v2 schema, leaves validity to SAP's candidate and save checks.
Authorization and transient preflight failures stop the operation. SAP's save remains authoritative.

**UIAD source saves are active immediately on the verified SAP_BASIS 816 system.** Review the
candidate before writing; there is no inactive-source review step after a successful save.

Deployment-generated descriptors follow the app's lifecycle: edit `manifest.json` and redeploy.
Use a separate editable descriptor for an independently maintained item. See
[SAP's descriptor lifecycle](https://help.sap.com/docs/BTP/65de2977205c403bbc107264b8eccf4b/1d9deef79d7d4936850b2d6343206ec8.html).
Saving a descriptor does not provision app access or prove the app can launch.

Results track `metadata` (`notAttempted`, `unknown`, `created`, or `existing`) and `source`
(`notAttempted`, `unknown`, or `saved`). A source failure can leave a created metadata shell.
Read the object before retrying. If source was saved but unlock failed, inspect its lock state.
If both saving and unlocking fail, the result preserves the original save failure and reports `unlockFailed`.
Validation shows at most 20 messages, errors first, plus total `messageCount`.
`ARC1_MINIMAL_ERRORS=true` hides SAP diagnostic details.

<span id="sapwrite-for-func-create-update-with-structured-parameters"></span>

## Write function modules

Create a function group, declare function-module parameters, and maintain structural includes. See [the guide](write-function-modules.md).

## Input conventions

Omit optional parameters you do not need. ARC-1 treats null and blank values as omitted and accepts
optional booleans as JSON booleans or `"true"`/`"false"`, `"1"`/`"0"`, and `"yes"`/`"no"`.
Use uppercase repository names for `create` and `batch_create`; source text may use mixed case.
A `BDEF` create requires the behavior definition in `source`.

**Release gates for pre-7.52 systems.** Several ADT resources simply do not exist before SAP_BASIS 7.52. Rather than surfacing a raw `404` (whose generic hint wrongly suggests the object "was not found"), ARC-1 refuses these up front with a release hint once discovery has been probed:

| Operation | Missing resource | Fallback |
|-----------|------------------|----------|
| `SAPWrite create type="TABL"/"TABL/DT"` | `/sap/bc/adt/ddic/tables` | SE11. Writing the source through `/ddic/structures/` instead would flip `DD02L-TABCLASS` to `INTTAB` and corrupt the table |
| `SAPWrite create type="DOMA"` | `/sap/bc/adt/ddic/domains` | SE11. Data elements that reference a domain are blocked with it |
| `SAPWrite create type="TTYP"` | `/sap/bc/adt/ddic/tabletypes` | SE11 |
| `SAPManage action="create_package"` | `/sap/bc/adt/packages` | SE80 / SE21 |

Endpoint absence verified on two independent NW 7.50 systems (a dev edition and an ECC EhP8 7.50 SP31 production system); all four are present on S/4HANA 2023 (758) and ABAP Platform 2025 (816). Structures (`TABL/DS`), data elements, function groups, function modules and includes **do** work on 7.50 — note that DDIC structure source there uses `define type <name> { … }`, not `define structure`.

Availability checks use ADT discovery. If discovery is unavailable, SAP may return the endpoint error directly.

**DDIC save diagnostics:** On `SAPWrite` save failures for DDIC/RAP artifacts (`TABL`, `DDLS`, `DCLS`, `BDEF`, `SRVD`, `SRVB`, `DDLX`, `DOMA`, `DTEL`), ARC-1 enriches errors with structured diagnostics:
- T100 message identifiers/variables (e.g., `SBD_MESSAGES/007`, `V1..V4`)
- Line-aware details when available
- Best-effort inactive syntax-check output for source-based DDIC creates (`TABL`, `DDLS`, `DCLS`, `BDEF`, `SRVD`, `SRVB`, `DDLX`)

Inspect these diagnostics before retrying.

## CDS dependency-aware CRUD hints (DDLS)

DDLS updates return downstream impact, a suggested activation order, and a `SAPActivate` template.
Dependency-related delete failures identify blocking objects and may suggest how to break a cycle.
Review these suggestions before changing or deleting dependent objects.

Recently deleted dependents can remain in SAP's active dependency index. If the result appears stale,
wait and recheck references and locks. Restored or stripped source may need activation first.
If where-used is unavailable, the original operation still runs and reports “impact unavailable.”

## CDS pre-write validation

| Check | Result |
| --- | --- |
| `define table entity` on systems older than SAP_BASIS 757, outside ABAP Cloud | Write rejected |
| Possible reserved CDS field names such as `position`, `value`, or `type` | Advisory warning; consider another name |
| Existing DDLS with no stored source, encountered during a read | Explicit empty-source warning |

## ARC-1-native pre-write semantic hints (TABL)

For draft tables, use `"%admin" : include sych_bdl_draft_admin_inc;` as documented in
[SAP's draft-table syntax](https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/ABENBDL_DRAFT_TABLE.html).
A bare include produces warning `arc1-tabl-draft-admin-include`. It does not block the write;
it identifies a declaration that can activate as a table but fail in some behavior-definition scenarios.

## RAP deterministic preflight validation

Before `create`, `update`, and `batch_create`, ARC-1 checks RAP-related source types
(`TABL`, `BDEF`, `DDLX`, `DDLS`). Deterministic errors block the write; advisory findings do not.
Examples include missing currency annotations for `abap.curr`, invalid authorization declarations,
and unsupported DDLX scope annotations. Use `preflightBeforeWrite=false` to override these checks for a call.

## Batch creation

Create up to **100 objects** in array order. Put dependencies first: for example, a domain before
its data element. Smaller batches reduce the chance of a client timeout.

```text
SAPWrite(action="batch_create", package="$TMP", objects=[
  {type:"DOMA", name:"ZORDER_STATUS", dataType:"CHAR", length:1,
   fixedValues:[{low:"A",description:"Active"},{low:"I",description:"Inactive"}]},
  {type:"DTEL", name:"ZORDER_STATUS", typeKind:"domain", typeName:"ZORDER_STATUS",
   shortLabel:"Status", shortLength:10, mediumLabel:"Order Status", mediumLength:20}
])
```

### Batch inputs

Each item requires `type` and `name`. It can also contain `source`, `description`, type-specific
metadata, and `package`/`transport` overrides. Item values take precedence over batch values.

For `FUNC`, supply `group`, optional `processingType`/`updateTaskKind`, and structured `parameters`.
A shared `group` can be set at the top level. The group must already exist when batch preflight runs.
Functions inherit their group's package: omit the item package or use the exact inherited package
as an assertion. Structural `INCL` names starting with `L` require single-object creation with `group`.
Server-driven object types also require single-object creation.

Before creating anything, ARC-1 validates names, duplicate identities, supported types, enabled
lint/RAP checks, AFF headers, create metadata, packages, transport requirements, and MSAG inputs.
CLAS and INTF share a namespace; DDLS and BDEF may share a name. A failed preflight creates nothing.

### Activation and partial failure

By default, each object is created, written, and activated before the next item.
For interdependent objects, set `activateAtEnd=true`: ARC-1 writes inactive drafts and then activates
the written set together. If writing fails, terminal activation covers only the already-written subset.

Execution stops at the first runtime failure. Earlier creations are retained; the batch neither
rolls them back nor overwrites existing objects. Creation, writing, and activation are tracked separately.
An interrupted create can have persisted even when its result is unknown.

Before retrying a failed or timed-out batch:

1. Read the affected objects with `SAPRead`.
2. Check which creation, write, and activation steps succeeded.
3. Resume only the remaining steps. After failed batch activation, an object without an individual
   error can still have unknown activation state.

Confirmed and uncertain mutations invalidate affected caches.

### Failure results

Successful batches return one text block. Batch preflight and execution failures return a readable
summary plus a separate JSON block with a `batch` object. Schema and scope rejections use the normal error response.

| Field | Meaning |
| --- | --- |
| `phase` | Preflight or execution phase |
| `requested`, `created`, `creationUnknown`, `completed`, `failed`, `skipped` | Batch counts |
| `results` | One entry per input, identified by zero-based `index`, `type`, `name`, and effective `packageName` |
| Result `status`, `creation`, `write`, `activation` | Overall and per-step outcomes |
| Result `failedPhase`, `error` | Failure detail, when available |

Creation and writing use `not_attempted`, `confirmed`, or `unknown`; writing can also be `not_required`.
Activation additionally uses `failed` for an explicit SAP activation error. Skipped entries were not attempted.

Check `isError` and parse the second block on its own. Do not concatenate the blocks into one JSON value.
`ARC1_MINIMAL_ERRORS=true` hides SAP diagnostics in both blocks while retaining phases and counts.
The manifest contains bounded per-object diagnostics and no source code; unassigned activation
messages appear in the readable summary.

## RAP handler scaffolding

Generate missing handler declarations and method stubs from a behavior definition.
Preview the result before applying it:

```text
SAPWrite(action="scaffold_rap_handlers", type="CLAS", name="ZBP_I_TRAVEL",
  bdefName="ZI_TRAVEL", autoApply=false)

SAPWrite(action="scaffold_rap_handlers", type="CLAS", name="ZBP_I_TRAVEL",
  bdefName="ZI_TRAVEL", autoApply=true)
```

ARC-1 scans MAIN, definitions, and implementations. New local handler declarations and implementations
are placed in `implementations` (CCIMP); existing declarations are updated where found.
Applying this scaffold saves inactive source. Run `SAPActivate` to activate it.

For an existing behavior-pool class, `generate_behavior_implementation` discovers the BDEF from class
metadata, checks the class/BDEF relationship, adds missing handlers under one stateful lock, and activates by default:

```text
SAPWrite(action="generate_behavior_implementation", type="CLAS", name="ZBP_I_TRAVEL",
  dryRun=true)

SAPWrite(action="generate_behavior_implementation", type="CLAS", name="ZBP_I_TRAVEL")
```

Use `activate=false` to save without activation.

## Transport behavior

An explicit `transport` takes precedence. Otherwise:

| Operation | Behavior |
| --- | --- |
| `update`, `delete` | Reuse the correction number returned by SAP's object lock, if any |
| `create`, `batch_create` in a local package | No transport needed |
| `create`, `batch_create` in a transportable package | Check SAP's transport requirements; reuse an existing object assignment or ask for a transport |

If the transport preflight is unavailable, ARC-1 proceeds and SAP decides whether the operation can
be saved. Find or create a request with [SAPTransport](sap-transport.md).

## Procedural unit surgery

On-premises, `edit_unit` replaces one named `FORM…ENDFORM` or `MODULE…ENDMODULE` block in a `PROG`
or `INCL`. Supply exactly one complete replacement, including the signature and MODULE direction.
Names are case-insensitive; the replacement must keep the original kind and name.
Missing or ambiguous unit names are rejected.

```json
{
  "action": "edit_unit",
  "type": "PROG",
  "name": "ZPROG_ORDERS",
  "unit": "PROCESS_ORDERS",
  "source": "FORM process_orders USING iv_force TYPE abap_bool.\n  \" new implementation\nENDFORM.",
  "transport": "DEVK900001"
}
```

ARC-1 edits the latest active or inactive source, preserves sibling units and line endings,
and uses the normal package and locking checks. Enabled lint checks inspect the resulting full source,
so errors outside the replaced unit can also block the save.
It does not activate automatically: run `SAPActivate` afterwards.
For function-group structural includes, pass `type="INCL"` and `group="<FUGR>"` to both the write and activation.

Event blocks such as `START-OF-SELECTION` and `AT SELECTION-SCREEN` are unsupported. For function
modules, use the [FUNC write operations](write-function-modules.md).

## Class-section surgery

Change method declarations and visibility without resending the whole class. See [Edit class members](write-class-members.md).

## Text elements

Read, replace, or clear one part of a class, program, or function-group text pool. See [Write text elements](write-text-elements.md).

[All tools](../tools.md)
