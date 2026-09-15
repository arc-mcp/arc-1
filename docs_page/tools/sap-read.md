# SAPRead

Read ABAP source, a method, metadata, revisions, or table data. For an overview of an object and its dependencies, start with [SAPContext](sap-context.md).

```text
SAPRead(type="CLAS", name="ZCL_ORDER", method="get_name")
```

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | string | Yes | Object type from [Supported types](#supported-types). Availability depends on the SAP release and advertised endpoints. |
| `name` | string | No | Object name (e.g., `ZTEST_PROGRAM`, `ZCL_ORDER`, `MARA`) |
| `action` | string | No | `"diff"` — return a unified diff between two source versions on this system (only the hunks, not two full sources), using `from`/`to`. Source types only: `PROG, CLAS, INTF, FUNC, FUGR, INCL, DDLS, DCLS, BDEF, SRVD, DDLX, TABL` (CDS views are `DDLS`; classic DDIC `VIEW` is unsupported — it has no plain-text source). Note: SAP only snapshots a version on transport *release*, so `from`/`to` revision ids are sparse — `active` vs `inactive` (pending unactivated changes) is the most reliable use. |
| `from` | string | No | For `action="diff"`: OLD side — `"active"` (default), `"inactive"`, a revision id (from a VERSIONS response), or its canonical source/revision URI. URI inputs use the same endpoint, authority, traversal, query, fragment, and control-character checks as `versionUri`. |
| `to` | string | No | For `action="diff"`: NEW side — defaults to `"inactive"`. Same accepted values as `from`. |
| `fromLabel` | string | No | For `action="diff"`: optional display label for the OLD side in the summary and patch header, e.g. `DNT-6-6: Validate discounts (DS7K900123)`. Does not affect source resolution. |
| `toLabel` | string | No | For `action="diff"`: optional display label for the NEW side in the summary and patch header, e.g. `active` or `inactive draft`. Does not affect source resolution. |
| `format` | string | No | Output format: `"text"` (default) or `"structured"`. For `action="diff"`, structured returns a machine-readable diff envelope; for ordinary reads, structured supports CLAS metadata and DEVC package listings (see below). |
| `include` | string | No | For CLAS: `main`, `testclasses`, `definitions`, `implementations`, `macros`. With `method=`, an explicit include selects that exact source (including `main`) before method extraction. For DDLS: `elements` (extract CDS view elements). For TEXT_ELEMENTS: `symbols`, `selections`, or `headings` — one part of the text pool; omit for all of them. |
| `method` | string | No | For CLAS: method name to read (e.g., `get_name`), a qualified local-class method (e.g., `lhc_travel~accept`), or `*` to list methods. With no `include=`, `lhc_*`/`lcl_*` automatically read `implementations`, `ltc_*` reads `testclasses`, and other names read MAIN. |
| `grep` | string | No | Case-insensitive regex; returns only matching source lines (+3 lines of context, with line numbers) instead of the full object — token-efficient search over source-bearing types (`PROG, CLAS, INTF, FUNC, FUGR, INCL, DDLS, DCLS, BDEF, SRVD, SRVB, SKTD/KTD, DDLX, TABL, VIEW`). For CLAS, matches are annotated with the owning class/method; combine with `include=` to scope a section, but not with `method=`. Falls back to a literal search when the pattern is not valid regex. |
| `expand_includes` | boolean | No | For FUGR: expand include source inline |
| `group` | string | No | For FUNC: function group name |
| `versionUri` | string | No | For VERSION_SOURCE: canonical source/revision URI from a VERSIONS response (`revisions[].uri`). Only known source endpoint shapes are accepted; unrelated ADT endpoints, absolute URLs, authority changes, dot segments, queries, fragments, controls, encoded backslashes, and ambiguous nested encodings are rejected. Encoded slashes remain valid inside namespaced ABAP object names. |
| `maxRows` | number | No | For TABLE_CONTENTS/TABLE_QUERY: requested row cap (default 100, clamped to 10,000). Wide results can hit the server's cumulative byte ceiling at fewer rows. Known TABLE_CONTENTS limitation on 758: SAP can return `N+1`; prefer TABLE_QUERY when an exact cap matters. |
| `maxResults` | number | No | For DEVC: maximum package objects to list (default 200, clamped to 1–1000). SAP may truncate larger packages at the requested limit. |
| `sqlFilter` | string | No | Legacy TABLE_CONTENTS condition. Do not rely on it for portable automation: the 758 endpoint expects a different SELECT-shaped payload, so condition-only filters are unusable there. Prefer TABLE_QUERY `where`. |
| `columns` | array | No | For TABLE_QUERY: fields to project; omit for all columns. Example: `["MANDT","MATNR"]`. |
| `where` | array | No | For TABLE_QUERY: ANDed `{field,op,value?}` conditions. Operators: `=`, `!=`, `<>`, `<`, `<=`, `>`, `>=`, `LIKE`, `NOT LIKE`, `IN`, `NOT IN`, `IS NULL`, `IS NOT NULL`. IN values are bare comma-separated values; ARC-1 quotes/escapes them. On 758 use `<>`, because accepted `!=` is sent unchanged and SAP rejects it. |
| `objectType` | string | No | For API_STATE: object type (CLAS, INTF, PROG, FUGR, etc.), auto-detected if omitted. For TEXT_ELEMENTS: `PROG` (default), `CLAS`, or `FUGR`. |
| `version` | string | No | Object version: `active`, `inactive`, or `auto`. Source-bearing types default to `active`. For DTEL metadata, omitted and `auto` use SAP's developer view; explicit `active` or `inactive` is passed to SAP. See [Active vs Inactive Source](#active-vs-inactive-source) below. |
| `force_refresh` | boolean | No | For source reads: bypass the cached source AND the inactive-list cache before reading. Use when you know the object changed outside ARC-1 in a way conditional GET can't catch. |
| `includeSignature` | boolean | No | For `FUNC` only. When `true`, response is JSON `{source, signature: {importing[], exporting[], changing[], tables[], exceptions[], raising[]}, processingType?, updateTaskKind?}` — each parameter parsed into `{kind, name, type, byValue?, default?, optional?}`; `processingType` reports `normal`/`rfc`/`update` (a metadata read, so it may add `propertiesError` instead if that GET fails). Default `false` (returns plain source body). See [SAPWrite for FUNC](sap-write.md#sapwrite-for-func-create-update-with-structured-parameters) for the round-trip. |

## Supported types

| Type | Description |
|------|-------------|
| `PROG` | Program source |
| `CLAS` | Class source |
| `INTF` | Interface source |
| `FUNC` | Function module source |
| `FUGR` | Function group structure (function modules + includes). Uses `/functions/groups/{g}/objectstructure`, falling back to the generic `/repository/objectstructure` on releases that don't ship it (NW 7.50/7.51). |
| `INCL` | Include source |
| `DDLS` | CDS view source |
| `DCLS` | CDS access control source (authorization rules for CDS views) |
| `DDLX` | CDS metadata extension (UI annotations for Fiori Elements) |
| `BDEF` | Behavior definition |
| `SRVD` | Service definition |
| `SRVB` | Service binding (structured JSON: OData version, binding type, publish status) |
| `SKTD` / `KTD` | Knowledge Transfer Document as Markdown. `KTD` is an alias. See [Edit KTD nodes](#edit-ktd-nodes) for routing and round-trip rules. |
| `TABL` | DDIC TABL — covers both transparent tables (T000-style) and DDIC structures (BAPIRET2-style). Returns CDS-like source. ARC-1 auto-resolves the URL: tries `/sap/bc/adt/ddic/tables/{name}` first, falls back to `/sap/bc/adt/ddic/structures/{name}` on 404. There is no separate `STRU` type — `TABL` is the canonical short type for both, mirroring TADIR `R3TR TABL` and abapGit conventions. |
| `TTYP` | DDIC table type (on-prem only). Returns `{name, description, rowType, rowTypeKind, accessType, keyKind}`. Written via `SAPWrite(type="TTYP")` — the create POSTs a CHAR shell and a follow-up PUT sets the real row type. |
| `VIEW` | DDIC view |
| `DOMA` | Domain metadata (structured JSON: data type, length, fixed values, value table) |
| `DTEL` | Data element metadata (structured JSON: type, labels and their reserved lengths, search help and its parameter, SET/GET parameter, change-document and bidi flags, and `deactivateInputHistory`). Omitted `version` and `auto` return SAP's developer view so pending drafts remain visible; explicit `active` or `inactive` is passed to SAP. |
| `AUTH` | Authorization field metadata (structured JSON: role name, check table, domain, conversion exit, org-level info) |
| `FEATURE_TOGGLE` | Feature toggle states (structured JSON: toggle state per system from SAP switch framework). `FTG2` still accepted as deprecated alias for one minor release with stderr warning. |
| `ENHO` | Enhancement implementation metadata (structured JSON: BAdI technology, referenced object, implementation classes) |
| `VERSIONS` | Revision history for an ABAP object. Returns JSON: `{ object: { name, type }, revisions: [{ id, author, timestamp, transport?, uri }] }`. Optional `include` for CLAS and `group` for FUNC. On-prem only. |
| `VERSION_SOURCE` | Source code at a specific revision. Pass `versionUri` from a VERSIONS response. Returns raw source text. On-prem only. |
| `DESD` | CDS Logical External Schema — **server-driven object** (generic AFF read). Returns JSON: parsed `blue:blueSource` metadata (name, type, description, package, language, version, …) + the AFF JSON source. SAP_BASIS 8.16+ (ABAP Platform 2025), discovery-gated. |
| `EVTB` | RAP Event Binding — server-driven object. JSON metadata + AFF JSON source (`boName`, `boOperation`, `events[]`). Available on S/4HANA 2023 (758) **and** 8.16+. |
| `EVTO` | RAP Event Object — server-driven object. 8.16+. |
| `DTSC` | CDS Static Cache (table-entity buffer) — server-driven object. JSON metadata + **DDL text** source (`define static cache …`). 8.16+. |
| `CSNM` | Core Schema Notation Model (CSN) — server-driven object. 8.16+. |
| `COTA` | Communication Target — server-driven object. 8.16+. |
| `DSFD` | CDS Scalar Function Definition — server-driven object. JSON metadata + **DDL text** source (`define scalar function …`). Available on S/4HANA 2023 (758) and 8.16+. |
| `UIAD` | Launchpad App Descriptor Item (LADI) — server-driven object. SAP_BASIS 8.16+. The successor to the deprecated tile/target-mapping model and the unit SAP Build Work Zone content exposure v2 federates. AFF JSON source carries `generalInformation` (appType, catalogId, transaction), `navigation` (targetMappingId, semanticObject, action, form factors) and `tiles[]`. Find names via `SAPRead type=DEVC` on the owning package (listed as `UIAD/TYP` — pass the bare `UIAD`). |
| `DTDC` | CDS Dynamic Cache — server-driven object with its OWN metadata format (`<dtdc:dtdcSource>`, not `blue:blueSource`). JSON metadata + **DDL text** source (`define dynamic cache …`). Available on S/4HANA 2023 (758) and 8.16+. |
| `TRAN` | Transaction metadata (structured JSON: code, description, program) |
| `SOBJ` | BOR business object (list methods, or read specific method with `method` param) |
| `BSP` | BSP/UI5 filestore. List apps without `name`; browse or read with `name="<app>"` and optional case-sensitive `include="<path>"`. `name="<app>/<path>"` is also accepted. |
| `API_STATE` | API release state (clean core compliance — contract states C0-C4, successor info) |
| `TABLE_CONTENTS` | Legacy table preview. Useful for an unfiltered sample; filtering and exact row caps are backend-dependent (see parameters above). Prefer `TABLE_QUERY` for deterministic structured projection/filtering. With experimental `SAP_BLOCKED_DATA_SOURCES` active, only unfiltered requests are supported — a `sqlFilter` returns `DATA_SQL_UNSUPPORTED`, so use `TABLE_QUERY`. |
| `TABLE_QUERY` | Structured table/CDS query through data preview (`columns`, `where`, `maxRows`); requires the data-preview gate. A configured experimental source blocklist checks direct and transitive active CDS/replacement lineage before execution. |
| `DEVC` | Package contents |
| `SYSTEM` | System info (SID, release, kernel) |
| `COMPONENTS` | Installed software components |
| `MSAG` | Message class metadata (structured JSON with `number`, `shortText`, `longText` per message). `MSAG` is the canonical TADIR R3TR short type. |
| `MESSAGES` | Deprecated alias for `MSAG`. Still accepted for one minor release with stderr warning; use `MSAG` going forward. |
| `TEXT_ELEMENTS` | Text pools for programs, classes, or function groups; use `objectType` and optional `include` to select one part. |
| `VARIANTS` | Program variants |
| `INACTIVE_OBJECTS` | List all objects pending activation for the calling user (no `name` needed). Returns rich metadata: `name`, `type`, `uri`, `description?`, `user`, `deleted`, `transport`, `parentTransport`. |

For a global class declaration (`INTERFACES`, `INHERITING FROM`) or its implementation,
read MAIN: omit `include` or use `include="main"`. `definitions` and `implementations`
contain **local helper classes**, not the global declaration and implementation split apart.
An empty local include does not mean the global class has no declarations. For a targeted
check use, for example, `SAPRead(type="CLAS", name="ZCL_ORDER", grep="INTERFACES|INHERITING")`.
This checks source declarations; it does not enumerate subclasses or prove runtime calls.

## Edit KTD nodes

Knowledge Transfer Document attached to an ABAP object. Returns Markdown decoded from the ADT XML envelope, one `## <node id>` section per documented node when routing is needed (BDEF entities, savers, actions, functions, …). A heading that names a node — its id, or the node name the index prints — is reserved routing syntax; a colliding heading inside stored body text is reversibly shown with one leading `\`. Behind a reserved HTML-comment marker, the response lists populated per-node short texts and a compact index of EVERY writable node, each by the spelling that resolves back to it (the name, or the full id when only that does), with the empty ones on an `empty (n):` line. Add a `## <name>` section above the marker to document one; use `shortTexts` to update its short text. Start multi-node edits from the complete `SAPRead` result; a standalone `## <object name>` is refused when it could instead be a visible root title (use `# <object name>` for that title). `SAPWrite` ignores the marker and context below it; the writable Markdown still follows the requested active/inactive version semantics. Documented non-writable sections can pass through unchanged while attempted edits remain refused. `KTD` is a friendly alias; `SKTD` remains the canonical SAP object type.

## Package listings (DEVC)

`SAPRead(type="DEVC", name="ZPKG")` keeps the JSON array in the first text block
and adds a second JSON text block with `listing` metadata. Use
`format="structured"` for one JSON object, `{objects: [...], listing: {...}}`.
Existing first-block array consumers and the public client's `getPackageContents`
array API retain their contracts. Consumers that concatenate text blocks before
JSON parsing should switch to the structured format.

`listing` reports `returned`, `effectiveLimit` (default 200, clamped to 1–1000),
`limitReached`, `possiblyTruncated`, `completeness: "unknown"`, `total: null`,
`coverage: "adt-search"`, and an explanatory `note`. Reaching the cap suggests
possible truncation; it does not prove additional objects exist. Below the cap,
`possiblyTruncated: false` only means the requested limit was not reached. ADT
search can omit repository types, so even an empty result is not proof of a
complete inventory. There is no continuation token or fabricated total. Raise
the limit up to 1000 or use targeted searches when the cap is reached.

## Structured class format

When `format="structured"` is used with CLAS type, the response is a JSON object with:
- `metadata` — class metadata (description, language, category, package, fixPointArithmetic, abapLanguageVersion)
- `main` — main class source code
- `testclasses` — test class source (or null if none)
- `definitions` — local definitions (or null)
- `implementations` — local implementations (or null)
- `macros` — macros (or null)

## Examples

```text
SAPRead(type="CLAS", name="ZCL_ORDER", method="*")
SAPRead(type="CLAS", name="ZBP_TRAVEL", method="lhc_travel~accept")
SAPRead(type="CLAS", name="ZCL_ORDER", include="testclasses")
SAPRead(type="CLAS", name="ZCL_ORDER", grep="INTERFACES|INHERITING")
SAPRead(type="CLAS", name="ZCL_ORDER", format="structured")
SAPRead(type="FUNC", name="Z_GREET", group="ZUTILS", includeSignature=true)
SAPRead(type="FUGR", name="ZUTILS", expand_includes=true)
SAPRead(type="DDLS", name="ZI_TRAVEL", include="elements")
SAPRead(type="TABLE_QUERY", name="MARA", columns=["MATNR"], maxRows=10)
SAPRead(type="BSP", name="ZAPP", include="WebContent")
SAPRead(type="API_STATE", name="MARA", objectType="TABL")
SAPRead(type="VERSIONS", name="ZCL_ORDER")
SAPRead(type="VERSION_SOURCE", versionUri="<revisions[].uri returned by VERSIONS>")
SAPRead(type="CLAS", name="ZCL_ORDER", action="diff", from="00001", to="active")
SAPRead(type="INACTIVE_OBJECTS")
```

For `TABLE_QUERY` on 758, use `op:"<>"` for inequality. Although the current input schema also accepts
`!=`, ARC-1 sends it unchanged and that backend rejects it; use `<>` instead.

## Active vs Inactive Source

Source-bearing types accept a `version` parameter to choose between the activated source and the calling user's unactivated draft:

| `version` | Behaviour |
|-----------|-----------|
| `active` (default) | Reads the last activated source. If the user has an unactivated draft (created in Eclipse/SE80, not yet activated), the response is prefixed with a one-line note flagging the draft so the LLM knows there's a gap and can re-read with `version='inactive'` if appropriate. |
| `inactive` | Reads the user's draft directly. If no draft exists, SAP falls back to the active source and the response is prefixed with: *"No inactive draft exists for this object on the server. Returning the active version."* |
| `auto` | Resolves client-side via the cached inactive-objects list: returns the draft if one exists, otherwise active. No warning is prefixed (the caller explicitly opted into "show me my view"). |

DTEL metadata uses SAP's version-less developer view when `version` is omitted or set to `auto`, so a
plain read after `SAPWrite` returns the pending draft. Pass `active` to request the last activated metadata or
`inactive` to request the draft explicitly; SAP can return active metadata when no draft exists.

```
SAPRead(type="CLAS", name="ZCL_ORDER")                          — active source (default)
SAPRead(type="CLAS", name="ZCL_ORDER", version="inactive")       — your draft
SAPRead(type="CLAS", name="ZCL_ORDER", version="auto")           — draft if it exists, else active
```

## Cache Behaviour

ARC-1 caches every source read with the SAP-emitted `ETag`. On the next read, ARC-1 sends `If-None-Match` so the server itself confirms freshness:

- **`304 Not Modified`** → cached body is still authoritative; response is prefixed with `[cached:revalidated]`.
- **`200 OK` with new body and ETag** → cache is replaced; no prefix on the response.
- **`404` / `410`** → cache entry is invalidated and the error is propagated.

Conditional reads detect external changes when SAP updates its ETag. Pass `force_refresh=true`
to bypass the source and inactive-list caches for one read.

The full caching architecture (per-version cache keys, conditional GET, pure parse memoization, inactive-list session cache, write invalidation) is documented in [Caching System](../caching.md).

[All tools](../tools.md)
