# SAPContext

Get dependency contracts, CDS impact, DDIC structure, or where-used evidence. Start with an object
whose purpose or dependencies you need to understand:

```text
SAPContext(action="deps", type="CLAS", name="ZCL_ORDER")
```

## Choose an action

| Need | `action` |
|---|---|
| KTD documentation and selected dependency API contracts | `deps` (default) |
| Includes and append structures of a DDIC table/structure | `structure` |
| Upstream dependencies and downstream impact of a CDS view | `impact` |
| Objects referencing a known object | `usages` |

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | No | `"deps"` (default), `"usages"`, `"impact"`, or `"structure"` |
| `type` | string | Yes for deps/structure, even with source; optional for impact/usages | Object type: `CLAS`, `INTF`, `PROG`, `FUNC`, `DDLS`, `TABL` |
| `name` | string | Yes, even with source | Object name (e.g., `ZCL_ORDER`) |
| `source` | string | No | Provide source directly instead of fetching from SAP |
| `includeKtd` | boolean | No | Only for `action="deps"`. Defaults to `true`; prepends the object's KTD (`SKTD`/`KTD`) when one exists. Set `false` to skip the KTD lookup. Ignored when `source` is supplied. |
| `group` | string | No | Required for `FUNC` type. The function group name. |
| `maxResults` | number | No | For `usages`: maximum entries (default 100); for `impact`: maximum per downstream bucket (default 50), hard max 1000. Totals remain uncapped counts. |
| `maxDeps` | number | No | Maximum dependencies to resolve (default 20) |
| `depth` | number | No | Dependency depth: 1 = direct only (default), 2 = deps of deps, 3 = max |
| `includeIndirect` | boolean | No | Only for `action="impact"` (DDLS): include indirect downstream where-used entries (default `false`) |
| `siblingCheck` | boolean | No | Only for `action="impact"`: run sibling metadata-extension consistency analysis (default `true`) |
| `siblingMaxCandidates` | number | No | Only for `action="impact"`: max sibling DDLS candidates to compare (default `4`, hard cap `10`) |

<span id="actiondeps-default-dependency-context"></span>

## Dependency contracts

`deps` returns the target's Knowledge Transfer Document (KTD), when available, followed by selected
source-derived API contracts. Use requirements and targeted [SAPRead](sap-read.md) calls together
when assessing behavior or designing tests. Contracts omit implementation; without requirements,
intent remains unverified.

| Dependency | Returned content |
|---|---|
| Class | Public declaration; protected/private sections and implementation removed |
| Interface | Full interface definition |
| Function module | Signature; body removed |

ARC-1 detects references such as `TYPE REF TO`, `NEW`, `CAST`, inheritance, interfaces, function
calls, exceptions, and static calls using the ABAP syntax tree. Custom objects are prioritized;
SAP standard objects such as `CL_ABAP_*`, `IF_ABAP_*`, and `CX_SY_*` are filtered by default.

```text
SAPContext(type="CLAS", name="ZCL_ORDER", depth=2, maxDeps=10)
SAPContext(type="INTF", name="ZIF_ORDER", source="<already fetched source>")
```

The text response contains a KTD section, named contract sections, and coverage statistics.
Root candidates and recursive attempts have different scopes: do not subtract all-level resolved
or failed counts from the root candidate total. “Not fetched” counts unattempted root names only;
deeper unexpanded work is unknown. Results are neither a complete relationship inventory nor
proof of runtime calls.

A failed dependency read does not establish absence. Resolve the type with `SAPSearch` before
trying a different reader. Missing KTD documents (404/410) are omitted; other KTD errors propagate.
`includeKtd=false` skips that lookup, as does providing `source`.

Each call recomputes dependencies and revalidates source reads with SAP. Parsing can be memoized
by content hash after retrieval; PP calls bypass that memoization. See
[dependency caching](../caching.md#dependency-context).

<span id="actionstructure-ddic-includes-append-structures-tabl-only"></span>

## DDIC structure

Use `type="TABL"` for a transparent table or DDIC structure:

```text
SAPContext(action="structure", type="TABL", name="BAPIRET2")
```

The response contains `name`, `type`, `includeExtensions`, a `tree`, and a `summary`.
Each tree node has `structure`, `attribute`, `kind`, and `children`. Node kinds distinguish root,
include, and append structures. Summary counts report `totalNodes`, `includes`, `appends`,
`cyclic`, `unresolved`, and `truncated`.

Includes come from the TABL source (`include`, named includes, and classic `.INCLUDE`). Append
candidates come from ADT where-used and are included only after their source confirms
`extend type <base> with`. ADT does not emit `.APPEND` entries in the base source.

<span id="actionimpact-cds-upstream-downstream-impact-ddls-only"></span>

## CDS impact

Use `type="DDLS"` to assess a CDS change:

```text
SAPContext(action="impact", type="DDLS", name="ZI_ORDER")
SAPContext(action="impact", type="DDLS", name="ZI_ORDER", includeIndirect=true)
SAPContext(action="impact", type="DDLS", name="ZI_ORDER", siblingMaxCandidates=3)
```

| Result field | Content |
|---|---|
| `upstream` | Source-derived `tables`, `views`, `associations`, and `compositions` |
| `downstream` | Where-used consumers grouped into `projectionViews`, `bdefs`, `serviceDefinitions`, `serviceBindings`, `accessControls`, `metadataExtensions`, `abapConsumers`, `tables`, `documentation`, and `other` |
| `downstream.summary` | `total`, `direct`, `indirect`, and `byBucket` counts before result slicing |
| `summary` | `upstreamCount`, `downstreamTotal`, and `downstreamDirect` |
| `consistencyHints` | Possible metadata-extension differences between sibling DDLS variants |
| `siblingExtensionAnalysis` | `stem`, `maxCandidates`, `consideredCandidates`, and `checkedCandidates` with names, packages, extension counts, and downstream totals |

Each downstream bucket has its own `maxResults` cap. Unsliced counts describe the lookup's results,
not every dependency on the system. Sibling checks are bounded and best-effort; failures add warnings
while retaining the primary result. Set `siblingCheck=false` to skip that analysis.

Use this lookup instead of querying source-text tables such as `DDDDLSRC` or `DDLXSRC_SRC` for
substring matches. It combines SAP's where-used index with RAP classification.

<span id="actionusages-reverse-dependency-lookup"></span>

## Where-used

```text
SAPContext(action="usages", type="INTF", name="ZIF_ORDER", maxResults=20)
```

`usages` queries the live where-used index as the caller, with any cache mode. Provide `type` when
known. If omitted, exact-name resolution must identify one object; ambiguous names return
candidates and require an explicit type.

| Result field | Meaning |
|---|---|
| `resolvedObject` | Root `type`, `name`, and `uri` |
| `usageCount` | Matching reference entries before paging |
| `shown`, `truncated` | Returned page size and whether results were cut |
| `usages` | Referencing object entries (`name`, `type`, `uri`) |
| `countMeaning` | Clarifies that entries are not distinct objects or runtime calls |
| `source`, `fallbackUsed` | Live lookup and fallback metadata |
| `warning` (optional) | Failed interface-implementer enrichment; native results are retained |

An empty result or absent warning does not prove complete coverage. For a class-only filter, use
`SAPNavigate(action="references", type="INTF", name="ZIF_ORDER", objectType="CLAS/OC")`.
SAPNavigate returns the same lookup in a navigation envelope using `total` and `references`;
`SAPContext.usages` has no result-type filter.

[All tools](../tools.md)
