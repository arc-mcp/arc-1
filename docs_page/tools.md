# ARC-1 Tool Reference

Complete documentation for all MCP tools available in ARC-1.

ARC-1 exposes **12 intent-based tools** designed for AI agents. Instead of 200+ individual tools (one per object type per operation), ARC-1 groups by *intent* with a `type` parameter for routing. This keeps the LLM's tool selection simple and the context window small (~5K schema tokens).

**Error intelligence:** ARC-1 enriches many SAP ADT failures with concise, actionable hints (for example lock conflicts, enqueue issues, missing authorizations, and transport/corrNr problems). Hints can include SAP transaction references like `SM12` (locks), `SU53` (authorization), and `SE09` (transport checks) to speed up troubleshooting.

---

## SAPRead

Read any SAP ABAP object.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | string | Yes | Object type (see below; includes `AUTH`, `FEATURE_TOGGLE`, `ENHO`, `VERSIONS`, `VERSION_SOURCE` on on-prem systems) |
| `name` | string | No | Object name (e.g., `ZTEST_PROGRAM`, `ZCL_ORDER`, `MARA`) |
| `format` | string | No | Output format: `"text"` (default) or `"structured"` (CLAS only, see below) |
| `include` | string | No | For CLAS: `main`, `testclasses`, `definitions`, `implementations`, `macros`. For DDLS: `elements` (extract CDS view elements). |
| `method` | string | No | For CLAS: method name to read (e.g., `get_name`), or `*` to list all methods |
| `expand_includes` | boolean | No | For FUGR: expand include source inline |
| `group` | string | No | For FUNC: function group name |
| `versionUri` | string | No | For VERSION_SOURCE: revision URI from a VERSIONS response (`revisions[].uri`), must start with `/sap/bc/adt/` |
| `maxRows` | number | No | For TABLE_CONTENTS: max rows (default 100) |
| `sqlFilter` | string | No | For TABLE_CONTENTS: condition expression only (no `WHERE`, no `SELECT`), e.g. `MANDT = '100'` |
| `objectType` | string | No | For API_STATE: SAP object type (CLAS, INTF, PROG, FUGR, etc.) — auto-detected from name if omitted |
| `version` | string | No | Source version: `active` (default), `inactive`, or `auto`. Applies to source-bearing types (PROG, CLAS, INTF, FUNC, INCL, DDLS, DCLS, DDLX, BDEF, SRVD, FUGR, SRVB, SKTD, TABL, VIEW). See [Active vs Inactive Source](#active-vs-inactive-source) below. |
| `force_refresh` | boolean | No | For source reads: bypass the cached source AND the inactive-list cache before reading. Use when you know the object changed outside ARC-1 in a way conditional GET can't catch. |
| `includeSignature` | boolean | No | For `FUNC` only. When `true`, response is JSON `{source, signature: {importing[], exporting[], changing[], tables[], exceptions[], raising[]}}` — each parameter parsed into `{kind, name, type, byValue?, default?, optional?}`. Default `false` (returns plain source body). Use this to introspect FM signatures programmatically. See [SAPWrite for FUNC](#sapwrite-for-func-create--update-with-structured-parameters) for the round-trip. |

**Supported types:**

| Type | Description |
|------|-------------|
| `PROG` | Program source |
| `CLAS` | Class source |
| `INTF` | Interface source |
| `FUNC` | Function module source |
| `FUGR` | Function group structure |
| `INCL` | Include source |
| `DDLS` | CDS view source |
| `DCLS` | CDS access control source (authorization rules for CDS views) |
| `DDLX` | CDS metadata extension (UI annotations for Fiori Elements) |
| `BDEF` | Behavior definition |
| `SRVD` | Service definition |
| `SRVB` | Service binding (structured JSON: OData version, binding type, publish status) |
| `TABL` | DDIC TABL — covers both transparent tables (T000-style) and DDIC structures (BAPIRET2-style). Returns CDS-like source. ARC-1 auto-resolves the URL: tries `/sap/bc/adt/ddic/tables/{name}` first, falls back to `/sap/bc/adt/ddic/structures/{name}` on 404. There is no separate `STRU` type — `TABL` is the canonical short type for both, mirroring TADIR `R3TR TABL` and abapGit conventions. |
| `VIEW` | DDIC view |
| `DOMA` | Domain metadata (structured JSON: data type, length, fixed values, value table) |
| `DTEL` | Data element metadata (structured JSON: type, labels, search help) |
| `AUTH` | Authorization field metadata (structured JSON: role name, check table, domain, conversion exit, org-level info) |
| `FEATURE_TOGGLE` | Feature toggle states (structured JSON: toggle state per system from SAP switch framework). Renamed from `FTG2` in audit Plan B (research/abap-types/types/ftg2.md) — `FTG2` still accepted as deprecated alias for one minor release with stderr warning. |
| `ENHO` | Enhancement implementation metadata (structured JSON: BAdI technology, referenced object, implementation classes) |
| `VERSIONS` | Revision history for an ABAP object. Returns JSON: `{ object: { name, type }, revisions: [{ id, author, timestamp, transport?, uri }] }`. Optional `include` for CLAS and `group` for FUNC. On-prem only. |
| `VERSION_SOURCE` | Source code at a specific revision. Pass `versionUri` from a VERSIONS response. Returns raw source text. On-prem only. |
| `TRAN` | Transaction metadata (structured JSON: code, description, program) |
| `SOBJ` | BOR business object (list methods, or read specific method with `method` param) |
| `BSP` | BSP/UI5 filestore (list apps, browse structure, read files via `name`+`include` path) |
| `API_STATE` | API release state (clean core compliance — contract states C0-C4, successor info) |
| `TABLE_CONTENTS` | Table data (rows) |
| `DEVC` | Package contents |
| `SYSTEM` | System info (SID, release, kernel) |
| `COMPONENTS` | Installed software components |
| `MSAG` | Message class metadata (structured JSON with `number`, `shortText`, `longText` per message). `MSAG` is the canonical TADIR R3TR short type (added in audit Plan B — research/abap-types/types/msag.md). |
| `MESSAGES` | Deprecated alias for `MSAG`. Still accepted for one minor release with stderr warning; use `MSAG` going forward. |
| `TEXT_ELEMENTS` | Program text elements |
| `VARIANTS` | Program variants |
| `INACTIVE_OBJECTS` | List all objects pending activation for the calling user (no `name` needed). Returns rich metadata: `name`, `type`, `uri`, `description?`, `user`, `deleted`, `transport`, `parentTransport`. |

**Structured format (CLAS only):**

When `format="structured"` is used with CLAS type, the response is a JSON object with:
- `metadata` — class metadata (description, language, category, package, fixPointArithmetic, abapLanguageVersion)
- `main` — main class source code
- `testclasses` — test class source (or null if none)
- `definitions` — local definitions (or null)
- `implementations` — local implementations (or null)
- `macros` — macros (or null)

This is useful when you need to understand class structure or separate test code from production code.

**Examples:**
```
SAPRead(type="PROG", name="ZTEST_REPORT")
SAPRead(type="CLAS", name="ZCL_ORDER", include="testclasses")
SAPRead(type="CLAS", name="ZCL_ORDER", format="structured")  — JSON with metadata + decomposed source
SAPRead(type="CLAS", name="ZCL_ORDER", method="*")           — list all methods
SAPRead(type="CLAS", name="ZCL_ORDER", method="get_name")    — read a specific method
SAPRead(type="DDLS", name="ZI_TRAVEL", include="elements")   — extract CDS view elements
SAPRead(type="DCLS", name="ZI_TRAVEL_DCL")       — CDS access control source
SAPRead(type="DDLX", name="ZC_TRAVEL")          — metadata extension with UI annotations
SAPRead(type="SRVB", name="ZUI_TRAVEL_O4")       — service binding metadata as JSON
SAPRead(type="FUGR", name="ZUTILS", expand_includes=true)    — function group with all includes expanded
SAPRead(type="TABL", name="BAPIRET2")            — DDIC structure (auto-resolved to /structures/)
SAPRead(type="TABL", name="T000")                — transparent table (auto-resolved to /tables/)
SAPRead(type="DOMA", name="BUKRS")               — domain metadata with fixed values
SAPRead(type="DTEL", name="MANDT")               — data element metadata with labels
SAPRead(type="AUTH", name="BUKRS")               — authorization field metadata
SAPRead(type="FEATURE_TOGGLE", name="ABC_TOGGLE")  — feature toggle states (FTG2 still works as deprecated alias)
SAPRead(type="MSAG", name="SY")                    — message class (MESSAGES still works as deprecated alias)
SAPRead(type="ENHO", name="ZMY_BADI_IMPL")       — enhancement implementation metadata
SAPRead(type="VERSIONS", name="ZARC1_TEST_REPORT") — list object revisions with revision URIs
SAPRead(type="VERSIONS", name="ZCL_X", include="definitions") — list revisions for CLAS definitions include
SAPRead(type="VERSION_SOURCE", versionUri="/sap/bc/adt/programs/programs/ZARC1_TEST_REPORT/source/main/versions/20260410185851/00000/content") — fetch source at one revision
SAPRead(type="TRAN", name="SE38")                — transaction metadata
SAPRead(type="SOBJ", name="BUS2032")             — list BOR object methods
SAPRead(type="BSP")                              — list all BSP/UI5 apps
SAPRead(type="API_STATE", name="CL_SALV_TABLE")              — check if class is released for ABAP Cloud
SAPRead(type="API_STATE", name="IF_HTTP_CLIENT")              — check interface release state
SAPRead(type="API_STATE", name="MARA", objectType="TABL")     — check table with explicit type
SAPRead(type="TABLE_CONTENTS", name="MARA", maxRows=10, sqlFilter="MATNR LIKE 'Z%'")
# TABLE_CONTENTS sqlFilter must be a condition expression only:
#   ✅ "MANDT = '100'"
#   ❌ "WHERE MANDT = '100'"
#   ❌ "SELECT * FROM MARA WHERE MANDT = '100'"
SAPRead(type="SYSTEM")
SAPRead(type="INACTIVE_OBJECTS")                 — list objects pending activation
```

### Active vs Inactive Source

Source-bearing types accept a `version` parameter to choose between the activated source and the calling user's unactivated draft:

| `version` | Behaviour |
|-----------|-----------|
| `active` (default) | Reads the last activated source. If the user has an unactivated draft (created in Eclipse/SE80, not yet activated), the response is prefixed with a one-line note flagging the draft so the LLM knows there's a gap and can re-read with `version='inactive'` if appropriate. |
| `inactive` | Reads the user's draft directly. If no draft exists, SAP falls back to the active source and the response is prefixed with: *"No inactive draft exists for this object on the server. Returning the active version."* |
| `auto` | Resolves client-side via the cached inactive-objects list: returns the draft if one exists, otherwise active. No warning is prefixed (the caller explicitly opted into "show me my view"). |

The default preserves all existing caller behaviour; `version` is an opt-in extension.

```
SAPRead(type="CLAS", name="ZCL_ORDER")                          — active source (default)
SAPRead(type="CLAS", name="ZCL_ORDER", version="inactive")       — your draft
SAPRead(type="CLAS", name="ZCL_ORDER", version="auto")           — draft if it exists, else active
```

### Cache Behaviour

ARC-1 caches every source read with the SAP-emitted `ETag`. On the next read, ARC-1 sends `If-None-Match` so the server itself confirms freshness:

- **`304 Not Modified`** → cached body is still authoritative; response is prefixed with `[cached:revalidated]`.
- **`200 OK` with new body and ETag** → cache is replaced; no prefix on the response.
- **`404` / `410`** → cache entry is invalidated and the error is propagated.

This means external writes (Eclipse activations, gCTS pulls, abapGit imports) are caught automatically — there's no staleness window. To force a fresh fetch and bypass the cache for one read, pass `force_refresh: true`.

The full caching architecture (per-version cache keys, conditional GET, dependency-graph caching, inactive-list session cache, write invalidation) is documented in [Caching System](caching.md).

---

## SAPSearch

Search for ABAP objects by name pattern, exact object-directory names, or ABAP source text.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | No | Search pattern (e.g., `ZCL_ORDER*`, `Z*TEST*`), source text, or comma/whitespace-separated names for `tadir_lookup` |
| `maxResults` | number | No | Maximum results (default 100) |
| `searchType` | string | No | `object` (default, name search), `tadir_lookup` (exact cross-package object lookup), or `source_code` (text search within ABAP source) |
| `names` | array | No | For `tadir_lookup`: exact object names to resolve across packages |
| `objectTypes` | array | No | For `tadir_lookup`: optional ADT/TADIR type filters such as `TABL`, `DDLS`, `BDEF`, `SRVB`, `CLAS/OC` |
| `objectType` | string | No | For `source_code`: filter by object type. For `tadir_lookup`: single type filter |
| `source` | string | No | For `tadir_lookup` only: `adt` (default), `db`, or `both`. `db`/`both` require the `sql` scope and `SAP_ALLOW_FREE_SQL=true`. See [TADIR lookup `source` modes](#tadir-lookup-source-modes) below. |
| `packageName` | string | No | For `source_code` search: filter by package |

**Returns:** Object type, name, package, and description for each match. `tadir_lookup` groups exact matches by requested name and includes a `missing` list. Source code search also returns line numbers and code snippets. When `source='both'` reveals divergence between the ADT and DB views, the response adds a `splitBrain: [name, ...]` array and a `warnings: [...]` array explaining each diverging name.

**Examples:**
```
SAPSearch(query="ZCL_ORDER*")
SAPSearch(query="Z*INVOICE*", maxResults=20)
SAPSearch(searchType="tadir_lookup", names=["ZDM_PROJECT_D","ZR_DM_PROJECT"], objectTypes=["TABL","BDEF"])
SAPSearch(searchType="tadir_lookup", query="ZDM_PROJECT_D ZUI_DM_PROJECTS_O4")
SAPSearch(searchType="tadir_lookup", names=["ZR_OLD_VIEW"], source="both")   // detect TADIR ghosts after a failed delete
SAPSearch(query="SY-SUBRC", searchType="source_code")
SAPSearch(query="SELECT * FROM mara", searchType="source_code", objectType="CLAS", packageName="ZDEV")
```

**Umlaut handling:** Object name queries containing non-ASCII characters (ä, ö, ü, ß) are automatically transliterated to ASCII equivalents (AE, OE, UE, SS). SAP object names are ASCII-only. Source code search preserves non-ASCII characters.

**Field names:** If searching for a field/column name (e.g., MATNR, BUKRS), use SAPQuery against DD03L instead — SAPSearch only searches object names.

**TADIR lookup:** Use `searchType="tadir_lookup"` for reset/create preflights that need to know whether objects exist anywhere, regardless of package. The default `source='adt'` uses ADT repository quick search, which avoids long `IN (...)` parser limits and works in read/search-only configurations. The endpoint deliberately filters out TADIR rows that don't resolve to a live workbench resource, so orphan/ghost entries (left behind by aborted create/delete cycles) are invisible to the default path — see the source modes section below.

### TADIR lookup source modes

| `source` | Underlying call | Scope required | When to use |
|----------|-----------------|----------------|-------------|
| `adt` (default) | `GET /sap/bc/adt/repository/informationsystem/search?operation=quickSearch&query=...` (one per name) | `read` | Default; workbench-resolvable objects only. Skips TADIR ghost rows by design. |
| `db` | `POST /sap/bc/adt/datapreview/freestyle` with `SELECT pgmid, object, obj_name, devclass FROM tadir WHERE obj_name IN (…)` | `sql` (server-side: `SAP_ALLOW_FREE_SQL=true`) | One round-trip for any number of names — much faster for large lists, and surfaces orphan TADIR rows the ADT route hides. |
| `both` | Parallel `adt` + `db` calls; merge by `(base type, name)` with dedupe | `sql` | Explicit split-brain detection. Returns `splitBrain: [name, ...]` and a `warnings` array when the two sources disagree (e.g. a TADIR ghost from an aborted create/delete). |

Every match in the result set is stamped with an `_origin: 'adt' | 'db'` field so callers can colour-code or filter rows by provenance. The `'db'` path also covers legacy SEGW types (`IWSV`/`IWMO`/`IWPR`) that the ADT info-system does not return; the URL is left empty for types that aren't addressable via a single ADT base URL (e.g. function modules, which need the parent group).

**Source code search availability:** Not available on all SAP systems. Requires SICF service activation. If unavailable, falls back with an error suggesting SAPQuery as an alternative.

---

## SAPWrite

Create or update ABAP source code. Handles lock/modify/unlock automatically.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | Yes | `create`, `update`, `delete`, `edit_method`, `batch_create`, `scaffold_rap_handlers`, or `generate_behavior_implementation` |
| `type` | string | No | `PROG`, `CLAS`, `INTF`, `FUNC`, `FUGR`, `INCL`, `DDLS`, `DCLS`, `DDLX`, `BDEF`, `SRVD`, `SRVB`, `TABL`, `DOMA`, `DTEL`, `MSAG` (for single object actions). Slash/case aliases are auto-normalized (e.g., `CLAS/OC` or `clas` → `CLAS`). |
| `group` | string | No | For `FUNC`: parent function-group name. **Required for FUNC create** (the FUGR must already exist — create it first via `SAPWrite type=FUGR`). Auto-resolved via search for FUNC update/delete if omitted. Ignored for other types. |
| `name` | string | No | Object name (for single object actions) |
| `source` | string | No | ABAP source code (for create/update/edit_method) |
| `include` | string | No | For `update type="CLAS"` only: write a class-local include (`definitions`, `implementations`, `macros`, or `testclasses`) instead of `/source/main`. Omit this parameter for main class source updates. Include writes create an inactive draft; verify with `SAPRead(version="inactive")` until activation. |
| `method` | string | No | For `edit_method`: method name to replace (e.g., `"get_name"`) |
| `bdefName` | string | No | For `scaffold_rap_handlers`: interface BDEF name used to derive required handler signatures. For `generate_behavior_implementation`: optional override; default discovery reads the class metadata's `<class:rootEntityRef>` to locate the BDEF automatically. |
| `autoApply` | boolean | No | For `scaffold_rap_handlers`: when `true`, create missing `lhc_*` skeletons, inject missing signatures plus empty method stubs into the behavior pool, and write back. Not used by `generate_behavior_implementation` (which always applies; use `dryRun=true` there to preview). |
| `targetAlias` | string | No | For `scaffold_rap_handlers` and `generate_behavior_implementation`: optional RAP entity alias filter (scaffold only one alias/handler class) |
| `activate` | boolean | No | For `generate_behavior_implementation`: when `true` (default), runs `SAPActivate` on the class after writing. When `false`, only the source is written. Activation failures matching the well-known `Local classes of CL_ABAP_BEHAVIOR_HANDLER…` stale-active coupling do **not** throw — they return `activation.success=false` with a guided recovery hint so the just-written CCDEF/CCIMP source remains useful. |
| `dryRun` | boolean | No | For `generate_behavior_implementation`: when `true`, runs discovery + cross-validation + scaffold planning and returns the report **without** writing or activating. Use this to preview what would change. |
| `description` | string | No | Object description for `create` (defaults to name if omitted, max 60 chars) |
| `package` | string | No | Package for new objects (default `$TMP`) |
| `transport` | string | No | Transport request number. For `update` and `delete`, if omitted ARC-1 auto-uses the correction number returned by the SAP lock (if any). Explicit value takes precedence. |
| `lintBeforeWrite` | boolean | No | Override server lint setting for this call (`false` to bypass pre-write lint) |
| `preflightBeforeWrite` | boolean | No | Override deterministic RAP preflight checks for this call (`false` to bypass TABL/BDEF/DDLX/DDLS static checks) |
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
| `shortLabel` | string | No | DTEL: short field label |
| `mediumLabel` | string | No | DTEL: medium field label |
| `longLabel` | string | No | DTEL: long field label |
| `headingLabel` | string | No | DTEL: heading field label |
| `searchHelp` | string | No | DTEL: search help name |
| `searchHelpParameter` | string | No | DTEL: search help parameter |
| `setGetParameter` | string | No | DTEL: SET/GET parameter ID |
| `defaultComponentName` | string | No | DTEL: default component name |
| `changeDocument` | boolean | No | DTEL: change document flag |
| `messages` | array | No | MSAG: message entries (`[{number, shortText, longText?}]`) — `number` is a 3-digit string (e.g., `"001"`), `shortText` is the message text (max 73 chars) |
| `serviceDefinition` | string | No | SRVB: referenced service definition name (SRVD). Required for SRVB create. |
| `bindingType` | string | No | SRVB: binding type (default `ODATA`) |
| `category` | string | No | SRVB: binding category (`0` = UI, `1` = Web API; default `0`) |
| `version` | string | No | SRVB: service version for binding metadata (default `0001`) |
| `objects` | array | No | For `batch_create`: ordered list of objects (see below) |
| `activateAtEnd` | boolean | No | For `batch_create` only. Default `false` (per-object inline activation). When `true`, ARC-1 writes inactive drafts for every object then issues one terminal batch-activate — SAP's activator resolves cross-references between siblings in a single pass. Use this for interdependent objects (composition-linked DDLS, RAP behavior stacks where parent references not-yet-active child). Partial-failure semantics are unchanged: a write-phase failure still breaks the loop and only the already-written subset is batch-activated. |

**DDIC metadata writes:** `DOMA`, `DTEL`, `MSAG`, and `SRVB` use structured XML payloads and do **not** use `/source/main`. `MSAG` writes use the `/sap/bc/adt/messageclass/` endpoint and accept a `messages` array of `{number, shortText, longText?}` entries. `SRVB` create uses wildcard content type (`application/*`) and SRVB update uses vendor type (`application/vnd.sap.adt.businessservices.servicebinding.v2+xml`).

**Source-based DDIC writes:** `TABL`, `DDLS`, `DCLS`, `BDEF`, and `SRVD` are source-based and write source via `/source/main`. `TABL` covers both transparent tables (`TABL/DT`) and DDIC structures (`TABL/DS`); ARC-1 auto-resolves between `/ddic/tables/` and `/ddic/structures/` for read/update.

**Function group (`FUGR`) create:** POSTs `<group:abapFunctionGroup … adtcore:type="FUGR/F">` to `/sap/bc/adt/functions/groups` with content type `application/vnd.sap.adt.functions.groups.v3+xml`. Provide `package` and (for non-`$TMP`) `transport`. Delete the FUGR only after all its function modules have been deleted.

**Function module (`FUNC`) create / update / delete (issue [#250](https://github.com/marianfoo/arc-1/issues/250)):** The parent FUGR must already exist — pass `group` explicitly on create (or auto-resolve via search on update/delete). Create POSTs `<fmodule:abapFunctionModule … adtcore:type="FUGR/FF">` with `<adtcore:containerRef>` to `/sap/bc/adt/functions/groups/{group}/fmodules`. The FM inherits its package from the parent FUGR — do not pass `package`. SAPGUI-style `*"…IMPORTING…"*` parameter comment blocks in source are auto-stripped before PUT as defense-in-depth (SAP rejects them with `FUNC_ADT028`) and a warning is appended in that case.

#### SAPWrite for FUNC: create / update with structured parameters

Issue [#252](https://github.com/marianfoo/arc-1/issues/252) added structured FM parameter management. Pass a `parameters` array to declare the function module's signature; ARC-1 builds the ABAP-source-based `IMPORTING / EXPORTING / CHANGING / TABLES / EXCEPTIONS / RAISING` clause and splices it into the source body before PUT. SAP ADT exposes parameters ONLY through `/source/main` (verified live on a4h S/4HANA 2023 + NPL 7.50 SP02) — there is no separate metadata endpoint.

Each parameter:

| Field | Type | Description |
|-------|------|-------------|
| `kind` | string | One of `importing`, `exporting`, `changing`, `tables`, `exceptions`, `raising`. |
| `name` | string | Parameter / exception name. Always uppercased on emit. |
| `type` | string | ABAP type expression (`STRING`, `I`, `BAPIRET2`, `TYPE STANDARD TABLE OF X`, `LIKE DOKHL-OBJECT`, …). Required for IMPORTING/EXPORTING/CHANGING/TABLES; ignored for EXCEPTIONS/RAISING. For TABLES, include the leading `TYPE` or `LIKE` keyword. |
| `byValue` | boolean | Emit `VALUE(name)` wrapper. Default `false` (pass-by-reference). |
| `default` | string | Raw ABAP literal — IMPORTING/CHANGING only. Emitted verbatim (no escaping). Examples: `'X'`, `0`, `space`. |
| `optional` | boolean | Emit `OPTIONAL` keyword. |

Example — create an FM with a typed signature:

```jsonc
SAPWrite({
  action: "create",
  type: "FUNC",
  name: "Z_GREET",
  group: "ZARC1_FG",
  description: "Greet a user",
  parameters: [
    { kind: "importing", name: "IV_NAME",  type: "STRING", byValue: true, default: "'World'" },
    { kind: "exporting", name: "EV_GREET", type: "STRING", byValue: true },
    { kind: "raising",   name: "CX_ROOT" }
  ],
  source: "  ev_greet = |Hello { iv_name }|.\n"
})
```

The `source` value is the FM body only — ARC-1 wraps it in `FUNCTION Z_GREET …. ENDFUNCTION.` and emits the signature clause from `parameters`. Or pass full `FUNCTION/ENDFUNCTION` source and the splicer will replace just the signature region. Or omit `source` entirely to create an empty-body FM with only the signature.

Round-trip: `SAPRead({type: "FUNC", name: "Z_GREET", group: "ZARC1_FG", includeSignature: true})` returns:

```jsonc
{
  "source": "FUNCTION z_greet\n  IMPORTING\n    VALUE(iv_name) TYPE string DEFAULT 'World'\n  EXPORTING\n    VALUE(ev_greet) TYPE string\n  RAISING\n    cx_root.\n  ev_greet = |Hello { iv_name }|.\nENDFUNCTION.",
  "signature": {
    "importing": [ { "kind": "importing", "name": "IV_NAME", "type": "string", "byValue": true, "default": "'World'" } ],
    "exporting": [ { "kind": "exporting", "name": "EV_GREET", "type": "string", "byValue": true } ],
    "changing":  [],
    "tables":    [],
    "exceptions": [],
    "raising":   [ { "kind": "raising", "name": "CX_ROOT" } ]
  }
}
```

Backward-compat: when `parameters` is omitted, the existing source-only PUT path runs unchanged. When `includeSignature` is omitted on read, the response is plain text source.

**Mixed-case object names rejected on create.** SAP TADIR is uppercase on every release; mixed-case names cause silent corruption (e.g., a DDLS named `Zc_MyView` registers as `ZC_MYVIEW` in TADIR but the source body keeps mixed case, confusing every downstream tool). `SAPWrite(action="create"\|"batch_create")` rejects mixed-case names pre-flight with an actionable error. The source code *inside* the object can still use mixed case (e.g., `define view entity Zc_MyView`); only the TADIR object name needs to be uppercase.

**BDEF creation:** Uses SAP's `blue:blueSource` XML format with content-type `application/vnd.sap.adt.blues.v1+xml`. BDEF objects are created with `type="BDEF"` and require a `source` parameter containing the behavior definition.

**DDIC save diagnostics:** On `SAPWrite` save failures for DDIC/RAP artifacts (`TABL`, `DDLS`, `DCLS`, `BDEF`, `SRVD`, `SRVB`, `DDLX`, `DOMA`, `DTEL`), ARC-1 enriches errors with structured diagnostics:
- T100 message identifiers/variables (e.g., `SBD_MESSAGES/007`, `V1..V4`)
- Line-aware details when available
- Best-effort inactive syntax-check output for source-based DDIC creates (`TABL`, `DDLS`, `DCLS`, `BDEF`, `SRVD`, `SRVB`, `DDLX`)

This helps pinpoint the exact failing field/annotation instead of retrying blindly.

**CDS dependency-aware CRUD hints (DDLS):**
- `SAPWrite(action="update", type="DDLS", ...)` appends downstream where-used impact buckets and a concrete re-activation order + `SAPActivate(objects=[...])` template.
- `SAPWrite(action="delete", type="DDLS", ...)` enriches dependency-style delete failures (for example DDIC `[?/039]`) with blocking dependents and suggested delete order.
- Delete hints include cycle-break guidance for mutually-dependent projection graphs (strip redirected/composition clauses, activate stripped versions, then delete).
- If delete guidance lists dependents that were just deleted, treat it as possible stale SAP active dependency/index state and retry after a short wait before deeper cleanup.
- If SAP reports a delete dependency error but current where-used results are empty, ARC-1 now adds stale active-dependency guidance: wait/retry after recent cleanup, activate restored/stripped sources first, then re-check references/locks.
- ARC-1 combines unfiltered ADT where-used results with scoped object-type filters where available. This avoids under-reporting dependents on SAP systems that return only a shallow default usageReferences result.
- If the where-used endpoint is unavailable on the backend, ARC-1 keeps the CRUD action behavior unchanged and adds a short "impact unavailable" note instead of failing the call.

**Blue framework package handling:** `TABL` and `BDEF` create calls now pass package in both the XML (`packageRef`) and URL query (`_package=<pkg>`), alongside transport (`corrNr`) when provided.

**CDS pre-write validation:**

- **Table entity version guard:** `define table entity` syntax requires ABAP Cloud (BTP) or S/4HANA on-premise with SAP_BASIS >= 757. On older systems, ARC-1 rejects the write early with an actionable message instead of letting SAP fail with a generic error.
- **Reserved keyword warnings:** CDS field names like `position`, `value`, `type`, `data` etc. may be CDS reserved keywords that cause silent DDL save failures. ARC-1 detects these and includes an advisory warning (non-blocking) suggesting renamed alternatives.
- **Empty DDLS source:** When reading a DDLS that exists but has no stored source, ARC-1 returns an explicit warning instead of silent empty content.

**RAP deterministic preflight validation:**

- Runs before `create`/`update`/`batch_create` for RAP-prone source types (`TABL`, `BDEF`, `DDLX`, `DDLS`).
- Blocks writes on deterministic rule errors (for example: missing `@Semantics.amount.currencyCode` for `abap.curr`, invalid `authorization master ( none )`, unsupported DDLX scope annotations on on-prem 7.5x).
- Emits warning-only findings for non-fatal patterns (for example: explicit client in DDLS select list).
- Per-call override: `preflightBeforeWrite=false`.

**Batch creation:**

`batch_create` creates and activates multiple objects in sequence via a single tool call. Objects are processed in array order — put dependencies first (e.g., domain before data element, TABL before DDLS, DCLS after DDLS, BDEF after CDS views). Each object in the array has: `type` (string, required), `name` (string, required), `source` (string, optional), `description` (string, optional), optional `package` and `transport` overrides, plus optional DOMA/DTEL metadata fields. Item-level `package` and `transport` override the top-level values for that object.

If any object fails, processing stops and the response reports which objects succeeded and which failed. AFF metadata validation runs automatically for supported types (CLAS, INTF, PROG, DDLS, BDEF, SRVD, SRVB) — invalid metadata is rejected before hitting SAP.

**Deferred activation for interdependent objects (`activateAtEnd: true`):** By default, each object is created → source written → activated, in order. This works for linear dependency chains but fails when siblings cross-reference each other (e.g. composition-linked DDLS where the parent's `composition [0..*] of ZR_CHILD` references a not-yet-active child, or a RAP behavior stack where the BDEF refers to a draft SRVD). Set `activateAtEnd: true` to defer activation: ARC-1 writes inactive drafts for every object then issues one terminal `activateBatch` call. SAP's activator sees the whole graph at once and resolves cross-references internally. Partial-failure semantics are unchanged — a write-phase failure still breaks the loop, and the terminal batch-activate runs only over the already-written subset.

**RAP handler scaffolding:**

`scaffold_rap_handlers` derives required behavior-pool `METHODS ... FOR ...` signatures from an interface BDEF, computes missing signatures, and can optionally create missing local handler skeletons plus inject declarations and empty `METHOD ... ENDMETHOD` stubs into the behavior pool class:

- Scans class sections from `source/main`, `includes/definitions`, and `includes/implementations`
- In `autoApply=true`, creates missing `CLASS lhc_<alias> DEFINITION INHERITING FROM cl_abap_behavior_handler` shells in `includes/definitions` and matching implementation shells in `includes/implementations`
- Supports dry-run listing (`autoApply=false`, default) and write-back mode (`autoApply=true`)
- Helps recover from generic behavior-pool save errors by generating exact signatures for actions/determinations/validations/authorization handlers

```
SAPWrite(action="batch_create", package="ZDEV", transport="K900123", objects=[
  {type:"TABL", name:"ZTRAVEL", source:"define table ztravel {...}"},
  {type:"DDLS", name:"ZI_TRAVEL", source:"define root view..."},
  {type:"DCLS", name:"ZI_TRAVEL_DCL", source:"define role..."},
  {type:"BDEF", name:"ZI_TRAVEL", source:"managed implementation..."},
  {type:"SRVD", name:"ZSD_TRAVEL", source:"define service..."},
  {type:"CLAS", name:"ZBP_I_TRAVEL", source:"CLASS zbp_i_travel..."},
  {type:"SRVB", name:"ZSB_TRAVEL_O4", serviceDefinition:"ZSD_TRAVEL", category:"0"}
])

SAPWrite(action="batch_create", objects=[
  {type:"TABL", name:"ZTRAVEL", package:"ZDEV", transport:"K900123", source:"define table ztravel {...}"},
  {type:"DDLS", name:"ZI_TRAVEL", package:"ZDEV", transport:"K900123", source:"define root view..."}
])

SAPWrite(action="create", type="TABL", name="ZTRAVEL", package="$TMP",
  source="@EndUserText.label : 'Travel'\ndefine table ztravel {\n  key client : abap.clnt;\n  key travel_id : abap.numc(8);\n  description : abap.char(256);\n}")

SAPWrite(action="create", type="DOMA", name="ZSTATUS", package="$TMP",
  dataType="CHAR", length=1,
  fixedValues=[{low:"A",description:"Active"},{low:"I",description:"Inactive"}])

SAPWrite(action="create", type="DTEL", name="ZSTATUS", package="$TMP",
  typeKind="domain", typeName="ZSTATUS",
  shortLabel="Status", mediumLabel="Order Status")

SAPWrite(action="create", type="SRVB", name="ZSB_TRAVEL_O4", package="$TMP",
  serviceDefinition="ZSD_TRAVEL", category="0")

SAPWrite(action="update", type="CLAS", name="ZBP_I_TRAVELREQ",
  include="implementations",
  source="CLASS lhc_travel IMPLEMENTATION.\nENDCLASS.")

SAPWrite(action="scaffold_rap_handlers", type="CLAS", name="ZBP_I_TRAVELREQ",
  bdefName="ZI_TRAVELREQ", autoApply=true)

# One-shot RAP behavior pool: discover BDEF + scaffold + activate in one call
SAPWrite(action="generate_behavior_implementation", type="CLAS", name="ZBP_DM_PROJECT")

# Same, with preview-only mode (returns the plan, does not write)
SAPWrite(action="generate_behavior_implementation", type="CLAS", name="ZBP_DM_PROJECT",
  dryRun=true, activate=false)
```

`generate_behavior_implementation` is the reliable equivalent of Eclipse ADT's "Generate Behavior Implementation" Cmd+1 quickfix. Auto-discovers the BDEF via the class metadata's `<class:rootEntityRef>` element, cross-validates that MAIN's `FOR BEHAVIOR OF <bdef>` and the BDEF's `managed implementation in class <class>` agree, scaffolds every required handler (creating missing `lhc_<alias>` skeletons), writes CCDEF + CCIMP under one stateful lock, and (by default) activates the class. Avoids the broken `/sap/bc/adt/quickfixes/proposals/.../create_class_implementation` server endpoint (HTTP 500 on a4h regardless of payload, verified live during PR-C research 2026-05-10).


**Transport behavior:**

- **`update` and `delete`**: ARC-1 automatically reuses the correction number from the SAP object lock when no explicit `transport` is provided. This means writes to transportable objects often succeed without manually specifying a transport.
- **`create` and `batch_create`**: ARC-1 performs a **transport pre-flight check** for non-`$TMP` packages when no transport is provided. This calls the SAP transport checks endpoint to determine whether a transport number is required:
  - If the object is already locked in a transport, ARC-1 auto-uses that transport.
  - If the package is local (e.g., `$TMP`), no transport is needed — creation proceeds.
  - If a transport IS required but none was provided, ARC-1 returns an actionable error message listing existing transports and guiding the caller to use `SAPTransport(action="list")` or `SAPTransport(action="create")` first.
  - If the pre-flight check fails (older system, permissions), ARC-1 proceeds and lets SAP handle the error.

**Note:** Not available by default (read-only mode). Enable with `SAP_ALLOW_WRITES=true` / `--allow-writes=true`. Write access is restricted to package `$TMP` by default; to write to other packages, set `SAP_ALLOWED_PACKAGES='$TMP,Z*'` (quote in shell so `$TMP` isn't expanded).

---

## SAPActivate

Activate (publish) ABAP objects. Supports single object or batch activation.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | No | Object name (for single activation) |
| `type` | string | No | Object type (`PROG`, `CLAS`, `DDLS`, `DDLX`, `BDEF`, `SRVD`, `SRVB`, etc.) |
| `preaudit` | boolean | No | Request pre-activation audit from SAP (default: `true`). Set `false` to skip pre-audit for faster activation. |
| `objects` | array | No | For batch: array of `{type, name}` objects to activate together |

Use batch activation for RAP stacks where objects depend on each other (DDLS, BDEF, SRVD, DDLX, SRVB must be activated together). Batch responses include per-object status (`active`, `warning`, `error`) with attached messages, so failed members can be retried selectively.

For failed `DDLS` activation, ARC-1 appends CDS dependency impact buckets and a concrete batch re-activation template derived from where-used results.

**Examples:**
```
SAPActivate(type="CLAS", name="ZCL_ORDER")
SAPActivate(objects=[{type:"DDLS",name:"ZI_TRAVEL"},{type:"BDEF",name:"ZI_TRAVEL"},{type:"SRVD",name:"ZSD_TRAVEL"}])
```

**Note:** Not available by default (read-only mode). Enable with `SAP_ALLOW_WRITES=true` / `--allow-writes=true`.

---

## SAPNavigate

Navigate code: find definitions, references (where-used), code completion, and class hierarchy.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | Yes | `definition`, `references`, `completion`, or `hierarchy` |
| `uri` | string | No | Source URI of the object. Optional for `references` if `type`+`name` are provided. |
| `type` | string | No | Object type (PROG, CLAS, INTF, FUNC, etc.) — alternative to `uri` for `references`. |
| `name` | string | No | Object name — alternative to `uri` for `references`. |
| `objectType` | string | No | For `references`: filter where-used results by ADT object type in slash format (e.g., PROG/P, CLAS/OC, FUGR/FF, INTF/OI). On systems supporting the scope endpoint, only returns references from objects of the specified type. On older systems, the filter is ignored and all references are returned with a note. |
| `line` | number | No | Line number (1-based) |
| `column` | number | No | Column number (1-based) |
| `source` | string | No | Current source code |

**References action (Where-Used):** Uses the full scope-based Where-Used API, returning detailed results with line numbers, code snippets, and package info. Falls back to the simpler reference lookup on older SAP systems that don't support the scope endpoint.

**Hierarchy action:** Returns the class inheritance chain via `SEOMETAREL`: superclass (or null), implemented interfaces, and direct subclasses. Requires `name` parameter (class name). It needs either table preview (`SAP_ALLOW_DATA_PREVIEW=true` + `data` scope) or freestyle SQL (`SAP_ALLOW_FREE_SQL=true` + `sql` scope). ARC-1 uses SQL when available and falls back to named table preview.

**Examples:**
```
SAPNavigate(action="definition", uri="/sap/bc/adt/programs/programs/ztest", line=10, column=5)
SAPNavigate(action="references", uri="/sap/bc/adt/oo/classes/zcl_order")
SAPNavigate(action="references", type="CLAS", name="ZCL_ORDER")
SAPNavigate(action="references", type="CLAS", name="ZCL_ORDER", objectType="PROG/P")
SAPNavigate(action="completion", uri="/sap/bc/adt/programs/programs/ztest", line=10, column=15, source="...")
SAPNavigate(action="hierarchy", name="ZCL_ORDER")
```

---

## SAPQuery

Execute ABAP SQL queries against SAP tables.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sql` | string | Yes | ABAP SQL SELECT statement |
| `maxRows` | number | No | Maximum rows (default 100) |

**Important:** Uses the ADT freestyle SQL endpoint (`/sap/bc/adt/datapreview/freestyle`) with ABAP SQL syntax, NOT standard SQL:
- Use `ASCENDING`/`DESCENDING` (not `ASC`/`DESC`)
- Use `maxRows` parameter (not `LIMIT`)
- `GROUP BY`, `COUNT(*)`, `WHERE` all work
- ABAP SQL aggregate rule applies: non-aggregated selected fields must be listed in `GROUP BY`

ABAP SQL as a language supports JOINs and subqueries, but the freestyle endpoint parser can still reject valid-looking statements on some backend versions (for example grammar errors or single-SELECT enforcement). ARC-1 automatically chunks simple long literal `IN (...)` lists into smaller freestyle calls. If parsing still fails, simplify to one SELECT and split complex logic into staged queries.

See: [SAPQuery Freestyle Capability Matrix](https://github.com/marianfoo/arc-1/blob/main/docs/research/sapquery-freestyle-capability-matrix.md)

**Examples:**
```
SAPQuery(sql="SELECT carrid, COUNT(*) as cnt FROM sflight GROUP BY carrid ORDER BY cnt DESCENDING")
SAPQuery(sql="SELECT * FROM mara WHERE matnr LIKE 'Z%'", maxRows=50)
```

**Note:** Not available by default (free SQL blocked). Enable with `SAP_ALLOW_FREE_SQL=true` / `--allow-free-sql=true`. User also needs the `sql` scope (or API-key profile `viewer-sql`/`developer-sql`/`admin`).

---

## SAPTransport

Manage CTS transport requests (SE09/SE10 equivalent): list, get details, create, release, delete, reassign owner, recursive release, check transport requirements, and object transport history (reverse lookup). `create` uses the ADT `CreateCorrectionRequest` endpoint, which works on both NetWeaver 7.50+ and S/4HANA.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | Yes | `list`, `get`, `create`, `release`, `delete`, `reassign`, `release_recursive`, `check`, or `history` |
| `id` | string | No | Transport request ID, e.g. `A4HK900123` (for get/release/delete/reassign/release_recursive) |
| `description` | string | No | Transport description text (required for create) |
| `name` | string | No | Object name (for check/history actions, e.g. `ZCL_ORDER`) |
| `package` | string | No | Package name. For `create`: optional — defaults to `$TMP`, pass an explicit package to influence the transport route. For `check`: required. |
| `user` | string | No | SAP username to filter by (for list). Defaults to the current SAP user. Use `*` to list all users. |
| `status` | string | No | Transport status filter (for list). `D`=modifiable (default), `R`=released, `*`=all statuses. |
| `type` | string | No | Object type for `check`/`history` actions (`PROG`, `CLAS`, `DDLS`, etc.). Not used by `create` — the SAP backend infers transport type (K/W/T) from the package's TADIR route on the `CreateCorrectionRequest` endpoint. |
| `owner` | string | No | New owner SAP username (required for reassign) |
| `recursive` | boolean | No | Apply recursively to child tasks (for delete/reassign). `release_recursive` always recurses. |

**Actions:**

- **`list`** — List transport requests. Defaults to current user, modifiable (status D), all types (Workbench, Customizing, Transport of Copies).
- **`get`** — Get transport details including tasks and objects.
- **`create`** — Create a new transport request. Requires `description`. Optional `package` (defaults to `$TMP` — pass an explicit package to influence the transport route, which determines K/W/T type). Uses the ADT `CreateCorrectionRequest` endpoint (`POST /sap/bc/adt/cts/transports`); legacy NW 7.50 systems are supported.
- **`release`** — Release a single transport or task.
- **`delete`** — Delete a transport. Use `recursive=true` to delete tasks first.
- **`reassign`** — Change transport owner. Requires `owner`. Use `recursive=true` for tasks too.
- **`release_recursive`** — Release all unreleased tasks first, then the transport itself.
- **`check`** — Check if a transport number is required for creating an object in a specific package. Requires `type`, `name`, and `package`. Returns whether transport recording is required, whether the package is local, existing transports, and any locked transport. **Does NOT require `--allow-transport-writes`** — this is a read-only pre-flight check.
- **`history`** — Reverse lookup: given an object (`type` + `name`), list the transport requests that reference it. Returns the locked transport (if any), all related transports, and candidate transports for assignment. Read-only; does NOT require `--allow-transport-writes`.

**Check action output:**
```json
{
  "package": "ZDEV",
  "transportRequired": true,
  "isLocal": false,
  "deliveryUnit": "HOME",
  "existingTransports": [
    { "id": "A4HK900123", "description": "My transport", "owner": "DEVELOPER" }
  ],
  "summary": "Package \"ZDEV\" requires a transport for object creation."
}
```

**History action output:**
```json
{
  "object": { "type": "CLAS", "name": "ZCL_ORDER", "uri": "/sap/bc/adt/oo/classes/zcl_order" },
  "lockedTransport": "A4HK900123",
  "relatedTransports": [
    { "id": "A4HK900123", "description": "", "owner": "", "status": "D" }
  ],
  "candidateTransports": [
    { "id": "A4HK900124", "description": "Refactor", "owner": "DEVELOPER" }
  ],
  "summary": "Object ZCL_ORDER is locked in transport A4HK900123."
}
```

**List defaults:** Without parameters, `list` returns modifiable transports (status D) for the current SAP user, across all transport types (Workbench, Customizing, Transport of Copies). Query params follow sapcli's `workbench_params()` pattern (`requestType=KWT`, `requestStatus`).

**Protocol compatibility:** ARC-1 uses startup ADT service discovery (`/sap/bc/adt/discovery`) to proactively select endpoint MIME types, with endpoint-specific CTS media types and a one-retry 406/415 fallback as defense-in-depth.

**Note:** Transport mutations (`create`, `release`, `release_recursive`, `reassign`, `delete`) require `write` + `transports` scopes and both `SAP_ALLOW_WRITES=true` and `SAP_ALLOW_TRANSPORT_WRITES=true`. `list`, `get`, `check`, and `history` are read actions and work without `--allow-transport-writes`.

---

## SAPGit

Git-based ABAP repository workflows with backend auto-selection: **gCTS** is preferred when available, otherwise ARC-1 uses the **abapGit ADT bridge**.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | Yes | `list_repos`, `whoami`, `config`, `branches`, `external_info`, `history`, `objects`, `check`, `stage`, `clone`, `pull`, `push`, `commit`, `switch_branch`, `create_branch`, `unlink` |
| `backend` | string | No | Optional backend override: `gcts` or `abapgit` |
| `repoId` | string | No | Repository ID/key (required by most repo-scoped actions) |
| `url` | string | No | Remote Git URL (required for `clone`, and for abapGit `external_info`) |
| `branch` | string | No | Branch name (for switch/create branch) |
| `package` | string | No | ABAP package (required for clone/create on package-bound backends) |
| `transport` | string | No | Transport request (backend-dependent) |
| `commit` | string | No | Commit SHA (for gCTS `pull` by commit) |
| `message` | string | No | Commit message (for gCTS `commit`) |
| `objects` | array | No | Commit/staging object list (`[{type,name,...}]`) |
| `user` | string | No | Optional remote Git username |
| `password` | string | No | Optional remote Git password |
| `token` | string | No | Optional remote Git token (gCTS) |
| `limit` | number | No | Limit for history queries (gCTS) |

**Backend support matrix:**

- **Both backends:** `list_repos`, `clone`, `pull`, `switch_branch`, `create_branch`, `unlink`
- **gCTS only:** `whoami`, `config`, `branches`, `history`, `objects`, `commit`
- **abapGit only:** `external_info`, `check`, `stage`, `push`

**Safety and scope rules:**

- Read actions require `read` scope (HTTP auth mode).
- Write actions (`clone`, `pull`, `push`, `commit`, `stage`, `switch_branch`, `create_branch`, `unlink`) require `write` scope.
- All write actions are blocked unless `--allow-git-writes` / `SAP_ALLOW_GIT_WRITES=true` is set.
- Package-bound create/clone operations must pass the configured package allowlist.

**Examples:**
```
SAPGit(action="list_repos")
SAPGit(action="whoami", backend="gcts")
SAPGit(action="config", backend="gcts")
SAPGit(action="history", backend="gcts", repoId="ZARC1", limit=20)
SAPGit(action="external_info", backend="abapgit", url="https://github.com/abapGit-tests/CLAS.git")
SAPGit(action="switch_branch", repoId="000000000006", branch="main", backend="abapgit")
SAPGit(action="clone", backend="abapgit", package="$TMP", url="https://github.com/org/repo.git")
```

---

## SAPContext

Get compressed dependency context for an ABAP object, or look up reverse dependencies (who uses a given object).

SAPContext has three modes controlled by the `action` parameter:

**Quick decision rule:**
- *"What breaks if I change `<CDS view>`?"* / *"Who consumes `I_*`?"* / *"Impact of `<DDLS>`"* → **`action="impact"`**
- *"What does `<object>` depend on?"* / dependency context before editing → **`action="deps"`** (default)
- *"Who calls `<object>`?"* (requires cache warmup) → **`action="usages"`**

> **Do not** hand-roll CDS impact analysis by querying `DDDDLSRC`, `ACMDCLSRC`, `DDLXSRC_SRC`, or `SRVDSRC_SRC` via `SAPQuery`. Those text-scans produce substring-match noise and package group nodes. `action="impact"` uses SAP's where-used index and returns deduplicated, RAP-classified results.

### action="deps" (default) — Dependency context

Returns only the public API contracts (method signatures, interface definitions, type declarations) of all objects that the target depends on — NOT the full source code. Typical compression: 7-30x fewer tokens.

**What gets extracted per dependency:**
- **Classes:** `CLASS DEFINITION` with `PUBLIC SECTION` only. `PROTECTED`, `PRIVATE` sections and `CLASS IMPLEMENTATION` are stripped.
- **Interfaces:** Full interface definition (interfaces are already public contracts).
- **Function modules:** `FUNCTION` signature block only (`IMPORTING`/`EXPORTING` parameters). Function body is stripped.

**Filtering:** SAP standard objects (`CL_ABAP_*`, `IF_ABAP_*`, `CX_SY_*`) are excluded by default. Custom objects (`Z*`, `Y*`) are prioritized in the output.

**Dependency detection:** Uses `@abaplint/core` AST parsing to find `TYPE REF TO`, `NEW`, `CAST`, `INHERITING FROM`, `INTERFACES`, `CALL FUNCTION`, `RAISING`, `CATCH`, and static method calls (`=>`).

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | No | `"deps"` (default), `"usages"`, or `"impact"` |
| `type` | string | Yes (for deps), optional for impact | Object type: `CLAS`, `INTF`, `PROG`, `FUNC`, `DDLS` |
| `name` | string | Yes | Object name (e.g., `ZCL_ORDER`) |
| `source` | string | No | Provide source directly instead of fetching from SAP |
| `group` | string | No | Required for `FUNC` type. The function group name. |
| `maxDeps` | number | No | Maximum dependencies to resolve (default 20) |
| `depth` | number | No | Dependency depth: 1 = direct only (default), 2 = deps of deps, 3 = max |
| `includeIndirect` | boolean | No | Only for `action="impact"` (DDLS): include indirect downstream where-used entries (default `false`) |
| `siblingCheck` | boolean | No | Only for `action="impact"`: run sibling metadata-extension consistency analysis (default `true`) |
| `siblingMaxCandidates` | number | No | Only for `action="impact"`: max sibling DDLS candidates to compare (default `4`, hard cap `10`) |

**Examples:**
```
SAPContext(type="CLAS", name="ZCL_ORDER")
SAPContext(type="CLAS", name="ZCL_ORDER", depth=2, maxDeps=10)
SAPContext(type="INTF", name="ZIF_ORDER", source="<already fetched source>")
SAPContext(action="deps", type="CLAS", name="ZCL_ORDER")
```

**Output format:**
```
* === Dependency context for ZCL_ORDER (3 deps resolved) ===

* --- ZIF_ORDER (intf, 4 methods) ---
INTERFACE zif_order PUBLIC.
  METHODS create IMPORTING order TYPE t_order.
  ...
ENDINTERFACE.

* --- ZCL_ITEM (clas, 3 methods) ---
CLASS zcl_item DEFINITION PUBLIC.
  PUBLIC SECTION.
    METHODS get_price RETURNING VALUE(result) TYPE p.
    ...
ENDCLASS.

* Stats: 5 deps found, 3 resolved, 0 failed, 25 lines
```

**Cache indicator:** When the dependency graph is served from the hash-keyed dep-graph cache (no further ADT calls beyond the source revalidation), the header changes to:
```
* === Dependency context for ZCL_ORDER (3 deps resolved) [cached] ===
```

The `[cached]` label here is for **dependency graph hits** (hash-keyed, naturally correct without server validation). It is distinct from `[cached:revalidated]` which appears on `SAPRead` source responses after SAP confirms freshness via `304 Not Modified`. See [Caching System → Response Indicators](caching.md#response-indicators) for details.

### action="impact" — CDS upstream + downstream impact (DDLS only)

Returns a single JSON payload with:
- **upstream** dependencies from CDS AST extraction (`tables`, `views`, `associations`, `compositions`)
- **downstream** where-used consumers classified into RAP-relevant buckets (`projectionViews`, `bdefs`, `serviceDefinitions`, `serviceBindings`, `accessControls`, `metadataExtensions`, `abapConsumers`, `documentation`, etc.)
- **consistencyHints** (additive): human-readable hints when sibling DDLS variants in the same package have asymmetric DDLX coverage
- **siblingExtensionAnalysis** (additive): structured details about sibling candidate filtering and metadata-extension counts

Use this to answer: "If I change this CDS view, what breaks?"

**Example:**
```
SAPContext(action="impact", type="DDLS", name="ZI_ARC1_I33_ROOT")
SAPContext(action="impact", type="DDLS", name="ZI_ARC1_I33_ROOT", includeIndirect=true)
SAPContext(action="impact", type="DDLS", name="ZI_ARC1_I33_ROOT", siblingCheck=false)
SAPContext(action="impact", type="DDLS", name="ZI_ARC1_I33_ROOT", siblingMaxCandidates=6)
```

**Output (shape):**
```json
{
  "name": "ZI_ARC1_I33_ROOT",
  "type": "DDLS",
  "upstream": {
    "tables": [{ "name": "ZTABL_ARC1_I33" }],
    "views": [],
    "associations": [],
    "compositions": []
  },
  "downstream": {
    "projectionViews": [{ "name": "ZI_ARC1_I33_PROJ", "type": "DDLS/DF" }],
    "bdefs": [],
    "serviceDefinitions": [],
    "serviceBindings": [],
    "accessControls": [],
    "metadataExtensions": [],
    "abapConsumers": [],
    "tables": [],
    "documentation": [],
    "other": [],
    "summary": { "total": 1, "direct": 1, "indirect": 0, "byBucket": { "projectionViews": 1 } }
  },
  "summary": { "upstreamCount": 1, "downstreamTotal": 1, "downstreamDirect": 1 },
  "consistencyHints": [
    "Possible sibling metadata-extension inconsistency: ..."
  ],
  "siblingExtensionAnalysis": {
    "stem": "ZI_ARC1_I33_ROOT",
    "maxCandidates": 4,
    "consideredCandidates": 2,
    "checkedCandidates": [
      { "name": "ZI_ARC1_I33_ROOT2", "packageName": "ZARC1", "metadataExtensions": 1, "downstreamTotal": 3 }
    ]
  }
}
```

Sibling analysis is best-effort and bounded. Any sibling-search or sibling where-used failures are returned as warnings while the primary impact result still succeeds.

### action="usages" — Reverse dependency lookup

Returns all objects in the cached index that depend on the given object (i.e., "who calls/uses this?"). This is the inverse of `deps`.

**Requires cache warmup** (`ARC1_CACHE_WARMUP=true`). Without warmup, the edge index is empty and the tool returns an error with setup instructions. As a live alternative, use `SAPNavigate(action="references")`.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | Yes | `"usages"` |
| `name` | string | Yes | Object name to look up (e.g., `ZCL_ORDER`, `ZIF_ORDER`) |

**Example:**
```
SAPContext(action="usages", name="ZIF_ORDER")
```

**Output:**
```json
{
  "name": "ZIF_ORDER",
  "usageCount": 3,
  "usages": [
    { "fromId": "ZCL_ORDER", "type": "CLAS", "relation": "IMPLEMENTS" },
    { "fromId": "ZCL_ORDER_EXTENDED", "type": "CLAS", "relation": "IMPLEMENTS" },
    { "fromId": "ZCL_ORDER_FACTORY", "type": "CLAS", "relation": "USES" }
  ]
}
```

**When warmup is not available:** Returns `isError: true` with step-by-step instructions to enable warmup, and suggests `SAPNavigate(action="references")` as a live fallback.

---

## SAPLint

Run local abaplint rules on ABAP source code. System-aware: auto-selects cloud or on-prem rules based on detected system type. For server-side checks (ATC, syntax check, unit tests), use SAPDiagnose instead.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | Yes | `lint`, `lint_and_fix`, `list_rules`, `format`, `get_formatter_settings`, or `set_formatter_settings` |
| `source` | string | No | ABAP source code (for `lint`, `lint_and_fix`, and `format`) |
| `name` | string | No | Object name (used for filename detection) |
| `indentation` | boolean | No | PrettyPrinter indentation toggle (for `set_formatter_settings`) |
| `style` | string | No | PrettyPrinter keyword style: `keywordUpper`, `keywordLower`, `keywordAuto`, or `none` (for `set_formatter_settings`) |
| `rules` | object | No | Rule overrides: `{ "rule_name": false }` to disable, `{ "rule_name": { "severity": "Warning" } }` to configure |

**Actions:**

- **`lint`** — Check ABAP source for issues. Returns errors and warnings with line/column positions.
- **`lint_and_fix`** — Lint + auto-fix all fixable issues (keyword case, obsolete statements, etc.). Returns the fixed source code alongside remaining unfixable issues.
- **`list_rules`** — List all available rules with current config (preset, enabled/disabled status, severity). No source needed.
- **`format`** — Pretty-print ABAP source via SAP ADT PrettyPrinter using the SAP system's global formatter settings. Returns formatted source text.
- **`get_formatter_settings`** — Read SAP global PrettyPrinter settings (indentation + keyword style).
- **`set_formatter_settings`** — Update SAP global PrettyPrinter settings. Provide at least one of `indentation` or `style`. Requires `write` scope and `SAP_ALLOW_WRITES=true`.

**System-Aware Presets:**

The lint rules auto-configure based on the detected SAP system:
- **BTP/Cloud**: `cloud_types` (Error), `strict_sql` (Error), `obsolete_statement` (Error) — enforces ABAP Cloud constraints
- **On-premise**: `cloud_types` (disabled), `obsolete_statement` (Warning) — more relaxed, allows classic ABAP

**Pre-Write Validation:**

When `--lint-before-write` is enabled (default: true), SAPWrite automatically runs a strict subset of lint rules before writing to SAP. Parser errors and cloud violations block the write. Style issues (keyword case, indentation) never block writes.

**Execution mode note:**

`lint`, `lint_and_fix`, and `list_rules` run locally in ARC-1. `format` and `*_formatter_settings` actions call the SAP system (ADT PrettyPrinter endpoints).

**Custom Configuration:**

Use `--abaplint-config /path/to/abaplint.jsonc` to load custom rules. The file uses the [abaplint config format](https://abaplint.org):

```jsonc
{
  // Override specific rules
  "rules": {
    "line_length": { "severity": "Error", "length": 80 },
    "abapdoc": true,           // re-enable a disabled rule
    "obsolete_statement": false // disable a rule
  },
  // Optional: override syntax version
  "syntax": { "version": "v757" }
}
```

Rules from the config file are merged on top of the auto-detected preset (cloud/on-prem). Per-call overrides via the `rules` parameter take precedence over the config file.

**Response shapes:**

- **`lint`** returns: `[{ rule, message, line, column, endLine, endColumn, severity }]`
- **`lint_and_fix`** returns: `{ fixedSource, appliedFixes, fixedRules, remainingIssues }` — use `fixedSource` as the corrected code
- **`list_rules`** returns: `{ preset, abapVersion, enabledRules, disabledRules, rules }` — shows active config
- **`format`** returns: plain text (formatted ABAP source)
- **`get_formatter_settings`** returns: `{ indentation, style }`
- **`set_formatter_settings`** returns: `{ indentation, style }` (effective merged settings)

**Examples:**
```
SAPLint(action="lint", source="DATA lv_test TYPE string.\nlv_test = 'hello'.")
SAPLint(action="lint_and_fix", source="data lv_x type i.\nadd 1 to lv_x.", name="ZCL_TEST")
SAPLint(action="list_rules")
SAPLint(action="format", source="report ztest. data lv type string.")
SAPLint(action="get_formatter_settings")
SAPLint(action="set_formatter_settings", style="keywordLower")
SAPLint(action="lint", source="...", rules={"line_length": {"severity": "Error", "length": 80}})
```

---

## SAPDiagnose

Server-side code analysis: syntax check, ABAP unit tests, ATC checks, active/inactive object state, short dumps (ST22), and ABAP profiler traces.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | Yes | `syntax`, `unittest`, `atc`, `object_state`, `quickfix`, `apply_quickfix`, `dumps`, or `traces` |
| `name` | string | No | Object name (required for syntax/unittest/atc/object_state/quickfix/apply_quickfix) |
| `type` | string | No | Object type: `PROG`, `CLAS`, `INTF`, `FUNC` (required for syntax/unittest/atc/object_state/quickfix/apply_quickfix) |
| `source` | string | No | Current source code (required for `quickfix` and `apply_quickfix`) |
| `line` | number | No | Source line number (required for `quickfix` and `apply_quickfix`) |
| `column` | number | No | Source column number (optional for `quickfix` and `apply_quickfix`, default `0`) |
| `proposalUri` | string | No | Quickfix proposal URI from `quickfix` response (required for `apply_quickfix`) |
| `proposalUserContent` | string | No | Opaque proposal state from `quickfix` response (required for `apply_quickfix`) |
| `id` | string | No | Dump ID (for dump detail) or Trace ID (for trace analysis) |
| `user` | string | No | Filter dumps by user |
| `maxResults` | number | No | Max dumps to return |
| `variant` | string | No | ATC check variant name |
| `analysis` | string | No | For trace detail: `hitlist`, `statements`, or `dbAccesses` |

**Actions:**

- **`syntax`** — Run SAP syntax check on an object. Returns errors/warnings with line, column, and message. **Important:** Syntax check runs against the *active* (on-system) source, not proposed new source. After writing/updating an object, activate it first, then run syntax check.
- **`unittest`** — Run ABAP unit tests. Returns results per test class/method with status, alert messages, and execution time.
- **`atc`** — Run ATC (ABAP Test Cockpit) checks. Returns findings with priority, check title, message, URI, line number, plus quickfix metadata (`quickfixInfo`, `hasQuickfix`). Optional `variant` parameter for custom check variants.
- **`object_state`** — Compare active and inactive source versions for one object. For `CLAS`, ARC-1 checks main, definitions, implementations, macros, and testclasses includes (up to 10 parallel reads per class; sequence calls when sweeping many classes). Returns ETags, byte lengths, SHA-256 hashes, and divergence flags without returning full source. Useful for diagnosing activation failures where active and inactive class includes disagree.
- **`quickfix`** — Get SAP quickfix proposals for a specific source position (`name`, `type`, `source`, `line`, optional `column`). Returns proposal entries with `uri`, `type`, `name`, `description`, `userContent`.
- **`apply_quickfix`** — Apply one proposal (`proposalUri` + `proposalUserContent`) and return text deltas (range + replacement content). This does not write source; use `SAPWrite` to persist.
- **`dumps`** — List short dumps (ST22). Without `id`: returns recent dumps (filterable by `user`, `maxResults`). With `id`: returns full dump detail including error type, exception, program, stack trace, and formatted output.
- **`traces`** — List ABAP profiler traces. Without `id`: returns trace list. With `id` + `analysis`: returns trace analysis (`hitlist` = call hierarchy with hit counts and timings, `statements` = executed statements, `dbAccesses` = database access details).

**Examples:**
```
SAPDiagnose(action="syntax", type="CLAS", name="ZCL_ORDER")
SAPDiagnose(action="unittest", type="CLAS", name="ZCL_ORDER")
SAPDiagnose(action="atc", type="PROG", name="ZTEST_REPORT", variant="DEFAULT")
SAPDiagnose(action="object_state", type="CLAS", name="ZBP_DM_PROJECT")
SAPDiagnose(action="quickfix", type="CLAS", name="ZCL_ORDER", source="<current_source>", line=42, column=1)
SAPDiagnose(action="apply_quickfix", type="CLAS", name="ZCL_ORDER", source="<current_source>", line=42, column=1, proposalUri="/sap/bc/adt/quickfixes/...", proposalUserContent="<opaque_state>")
SAPDiagnose(action="dumps")
SAPDiagnose(action="dumps", user="DEVELOPER", maxResults=10)
SAPDiagnose(action="dumps", id="20260409_123456_DUMP_ID")
SAPDiagnose(action="traces")
SAPDiagnose(action="traces", id="TRACE123", analysis="hitlist")
SAPDiagnose(action="traces", id="TRACE123", analysis="dbAccesses")
```

### Quickfix Workflow

1. Run `SAPDiagnose(action="atc" ...)` or `SAPDiagnose(action="syntax" ...)`.
2. Check ATC findings for `hasQuickfix: true`.
3. Call `SAPDiagnose(action="quickfix", ...)` for the relevant line/column.
4. Select a proposal and call `SAPDiagnose(action="apply_quickfix", ...)` to receive deltas.
5. Apply those deltas to source and persist via `SAPWrite(action="update" | "edit_method", ...)`.

---

## SAPManage

Probe and report SAP system capabilities, inspect the object cache state, and manage package (DEVC) lifecycle operations.

**Actions:**
- `probe` — Re-probe the SAP system now (feature probes + auth checks + ADT discovery refresh). Detects optional features.
- `features` — Get cached feature status from last probe (fast, no SAP round-trip).
- `cache_stats` — Return object cache statistics: cached sources, dep graphs, edges, warmup state, and the per-username inactive-list session cache (`inactiveListCache.userCount`, `inactiveListCache.totalEntries`).
- `create_package` — Create a package (`DEVC`) via `/sap/bc/adt/packages`.
- `delete_package` — Delete a package via lock/delete/unlock.
- `change_package` — Move an existing object into a different package (DEVC reassignment).
- `flp_list_catalogs` — List FLP business catalogs.
- `flp_list_groups` — List FLP groups (`Pages`) from `/UI2/FLPD_CATALOG`.
- `flp_list_tiles` — List tiles/target mappings in a catalog.
- `flp_create_catalog` — Create an FLP business catalog.
- `flp_create_group` — Create an FLP group.
- `flp_create_tile` — Create a tile in an FLP catalog.
- `flp_add_tile_to_group` — Assign a catalog tile instance into a group.
- `flp_delete_catalog` — Delete an FLP business catalog.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | Yes | `probe`, `features`, `cache_stats`, `create_package`, `delete_package`, `change_package`, `flp_list_catalogs`, `flp_list_groups`, `flp_list_tiles`, `flp_create_catalog`, `flp_create_group`, `flp_create_tile`, `flp_add_tile_to_group`, `flp_delete_catalog` |
| `name` | string | No | Required for `create_package` and `delete_package` (package name) |
| `description` | string | No | Required for `create_package` (package description) |
| `superPackage` | string | No | Optional parent package for `create_package` (use `$TMP` for local packages) |
| `softwareComponent` | string | No | Optional software component for `create_package` (default: `LOCAL`) |
| `transportLayer` | string | No | Optional transport layer for `create_package` |
| `packageType` | string | No | Optional package type for `create_package`: `development`, `structure`, `main` (default: `development`) |
| `transport` | string | No | Optional transport request ID (`corrNr`) for `create_package`/`delete_package`/`change_package` |
| `objectName` | string | No | Required for `change_package` — name of the object to move (e.g., `ZCL_MY_CLASS`) |
| `objectType` | string | No | Required for `change_package` — ADT object type (e.g., `CLAS/OC`, `DDLS/DF`, `PROG/P`) |
| `objectUri` | string | No | Optional for `change_package` — ADT URI of the object. Auto-resolved from objectName + objectType if not provided |
| `oldPackage` | string | No | Required for `change_package` — current package of the object |
| `newPackage` | string | No | Required for `change_package` — target package to move the object to |
| `catalogId` | string | No | Required for `flp_list_tiles`, `flp_create_tile`, `flp_add_tile_to_group` |
| `groupId` | string | No | Required for `flp_create_group`, `flp_add_tile_to_group` |
| `domainId` | string | No | Required for `flp_create_catalog` |
| `title` | string | No | Required for `flp_create_catalog`, `flp_create_group` |
| `tileInstanceId` | string | No | Required for `flp_add_tile_to_group` |
| `tile` | object | No | Required for `flp_create_tile`. Fields: `id`, `title`, `semanticObject`, `semanticAction`, optional `icon`, `url`, `subtitle`, `info` |

**Probed features:** `hana`, `abapGit`, `rap`, `amdp`, `ui5`, `transport`, `ui5repo`, `flp`. Each returns `available` (bool), `mode` (auto/on/off), `message`, and `probedAt` timestamp.

**cache_stats output:**
```json
{
  "enabled": true,
  "warmupAvailable": false,
  "sourceCount": 42,
  "contractCount": 38,
  "edgeCount": 0,
  "nodeCount": 42,
  "apiCount": 0
}
```

| Field | Description |
|-------|-------------|
| `enabled` | Whether caching is active (`false` if `ARC1_CACHE=none`) |
| `warmupAvailable` | Whether warmup has completed — required for `SAPContext(action="usages")` |
| `sourceCount` | Cached source code entries (grows as objects are read) |
| `contractCount` | Cached dependency graphs (grows as `SAPContext(deps)` is called) |
| `edgeCount` | Dependency edges — non-zero only after warmup |
| `nodeCount` | Object metadata entries — non-zero only after warmup |

**Examples:**
```
SAPManage(action="probe")       → discover system capabilities
SAPManage(action="features")    → get cached results (no SAP call)
SAPManage(action="cache_stats") → check cache state and warmup status
SAPManage(action="create_package", name="ZRAP_TRAVEL", description="RAP Travel Demo")
SAPManage(action="create_package", name="ZRAP_TRAVEL", description="RAP Travel Demo", superPackage="ZRAP", softwareComponent="HOME", transportLayer="HOME", packageType="development", transport="K900123")
SAPManage(action="delete_package", name="ZRAP_TRAVEL")
SAPManage(action="change_package", objectName="ZCL_MY_CLASS", objectType="CLAS/OC", oldPackage="$TMP", newPackage="Z_PRODUCTION", transport="K900123")
SAPManage(action="flp_list_catalogs")
SAPManage(action="flp_list_groups")
SAPManage(action="flp_list_tiles", catalogId="ZARC1_SALES")
SAPManage(action="flp_create_catalog", domainId="ZARC1_SALES", title="Sales Catalog")
SAPManage(action="flp_create_group", groupId="ZARC1_SALES_GRP", title="Sales Group")
SAPManage(action="flp_create_tile", catalogId="ZARC1_SALES", tile={"id":"tile_sales","title":"Sales","semanticObject":"SalesOrder","semanticAction":"display"})
SAPManage(action="flp_add_tile_to_group", groupId="ZARC1_SALES_GRP", catalogId="ZARC1_SALES", tileInstanceId="00O2TO3741QLWH4GV74AHMWQE")
```

**Note:** The `probe`, `features`, and `cache_stats` actions are read operations that work without `--allow-writes` and require only `read` scope in HTTP auth mode. Mutating SAPManage actions require `write` scope and writable safety config.
