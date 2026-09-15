# SAPNavigate

Find definitions, references, completions, and class relationships.

```text
SAPNavigate(action="references", type="CLAS", name="ZCL_ORDER", maxResults=20)
```

An [experimental `relations` action](../live-relations.md) adds bounded live metadata
networks for qualified ABAP object types. It is listed automatically unless denied or SAP discovery
has established that the capability is absent. Invocation still checks SAP's advertised endpoint and media type.


## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | Yes | `definition`, `references`, `completion`, or `hierarchy` |
| `uri` | string | No | Source URI of the object. Optional for `references` if `type`+`name` are provided. |
| `type` | string | No | Object type (PROG, CLAS, INTF, FUNC, etc.) — alternative to `uri` for `references`. |
| `name` | string | No | Object name — alternative to `uri` for `references`. |
| `objectType` | string | No | For `references`: keep only results of this ADT type, slash format (`CLAS/OC`, `PROG/P`, `FUGR/FF`). A bare prefix (`CLAS`) matches every subtype. Applied client-side. |
| `maxResults` | number | No | For `references`: max entries (default 100, max 1000). `total` counts every match of the filter. |
| `line` | number | No | Line number (1-based) |
| `column` | number | No | Column number (1-based) |
| `source` | string | No | Current source code |

## Experimental relations parameters (when available)

Present automatically in single-target standard mode, unless `SAP_DENY_ACTIONS` or discovery
establishes that the capability is absent. These rows add to or qualify the table above; existing
actions keep their behavior. Strict-client relation-only placeholders on other actions are ignored.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | Yes | `definition`, `references`, `completion`, `hierarchy`, or `relations` (when available) |
| `type` | string | For relations | `CLAS`, `INTF`, `DDLS`, `DCLS`, `TABL`, `TTYP`, `DTEL`, `DOMA`, `PROG`, `INCL`, `FUNC`, `FUGR`, `VIEW`, `ENHO`, `ENHS`, `MSAG`, `BDEF`, `SRVD`, `TRAN`, `SHLP`, `SKTD`, `ENQU`, `TYPE`, `EVTB`, `DSFD`. Only BAdI implementation/spot subtypes are qualified for ENHO/ENHS. See [type-specific limits](../live-relations.md#qualified-object-types). |
| `name` | string | For relations | Root object name, including namespaced names such as `/BOBF/CL_FRW_FACTORY`. |
| `direction` | string | No | For `relations`: `outgoing` (default, dependencies) or `incoming` (usages). |
| `depth` | integer | No | For `relations`: expansion depth, 1–3 (default 1). Native edges do not establish exact call distance. |
| `maxResults` | integer | No | For `relations`: maximum returned nodes, including the root, 1–100 (default 50). |
| `expandPackages` | string[] | No | For `relations`: up to 8 exact package names controlling deeper expansion. Boundary nodes remain visible; no wildcards. |

For `relations`, use only `action`, `type`, `name` and its four optional parameters above. Other
navigation parameters (`uri`, `objectType`, `line`, `column`, `source`) are rejected. See the
[experimental guide](../live-relations.md) for coverage limits and examples.

**References action (Where-Used):** Uses the full scope-based Where-Used API, returning detailed results with package info. Falls back to the simpler reference lookup on older SAP systems that don't support the scope endpoint.

Returns a paged envelope — `{total, countMeaning, shown, truncated, hint?, warning?, references}` — to bound the result returned to the caller.
**`total` counts matching reference entries before paging, not distinct consumer objects or runtime
calls.** The `countMeaning` field states this explicitly. Tree/container rows and multiple references
to one object can appear; even an untruncated or empty page is not proof of system-wide completeness.
If optional interface-implementer enrichment fails, native results are retained with a `warning`.
An absent warning does not prove that enrichment ran or that the result is complete.

Paging and `objectType` filtering happen client-side. SAP still computes and transfers the full
reference set; the limit bounds what reaches the caller.

**Hierarchy action:** Returns the class inheritance chain via `SEOMETAREL`: superclass (or null), implemented interfaces, and direct subclasses. Requires `name` parameter (class name). It needs either table preview (`SAP_ALLOW_DATA_PREVIEW=true` + `data` scope) or freestyle SQL (`SAP_ALLOW_FREE_SQL=true` + `sql` scope). ARC-1 uses SQL when available and falls back to named table preview.

Without changing permissions, inspect the global class declaration using
`SAPRead(type="CLAS", name="ZCL_ORDER", grep="INTERFACES|INHERITING")`. Omit `include` to read MAIN:
`include="definitions"` is for local helper classes, not the global declaration. This fallback does
not enumerate subclasses or prove a complete inheritance/implementation list.

## Examples

```
SAPNavigate(action="definition", uri="/sap/bc/adt/programs/programs/ztest", line=10, column=5)
SAPNavigate(action="references", uri="/sap/bc/adt/oo/classes/zcl_order")
SAPNavigate(action="references", type="CLAS", name="ZCL_ORDER")
SAPNavigate(action="references", type="CLAS", name="ZCL_ORDER", objectType="PROG/P")
SAPNavigate(action="completion", uri="/sap/bc/adt/programs/programs/ztest", line=10, column=15, source="...")
SAPNavigate(action="hierarchy", name="ZCL_ORDER")
```

[All tools](../tools.md)
