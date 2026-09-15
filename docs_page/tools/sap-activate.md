# SAPActivate

Activate one ABAP object or a dependent batch. Requires `SAP_ALLOW_WRITES=true`, the
[`write` user scope](../authorization.md), and an allowed package. The same requirements apply
to publishing or unpublishing a service binding.

```text
SAPActivate(type="CLAS", name="ZCL_ORDER")
```

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | No | `activate` (default), `publish_srvb`, or `unpublish_srvb`. Publish/unpublish makes an SRVB OData binding available/unavailable. |
| `name` | string | No | Object name (for single activation) |
| `type` | string | No | Object type (`PROG`, `CLAS`, `DDLS`, `DDLX`, `BDEF`, `SRVD`, `SRVB`, etc.) |
| `group` | string | No | Parent function group for `FUNC` or a function-group structural `INCL`. May also be set per batch item. |
| `version` | string | No | Service version for SRVB publish/unpublish (default `0001`). |
| `service_type` | string | No | `odatav2` or `odatav4` for SRVB publish/unpublish routing; auto-detected from binding metadata when omitted. |
| `preaudit` | boolean | No | Request pre-activation audit from SAP (default: `true`). Set `false` to skip pre-audit for faster activation. |
| `objects` | array | No | For batch: array of `{type, name, group?}` objects to activate together |

## Batch activation and recovery

Use a batch for interdependent objects, such as a RAP stack containing DDLS, BDEF, SRVD, DDLX,
and SRVB. ARC-1 checks every object's real package before activating any member. One package
denial stops the whole batch before activation.

| Per-object status | Meaning |
| --- | --- |
| `active` | The batch succeeded and this object has no warning or error |
| `warning` | The batch succeeded with a warning for this object |
| `error` | SAP reported an error for this object |
| `unknown` | The batch failed without an error specific to this object; SAP may have cancelled its activation too |

Messages are matched to the object's URI or its source/include paths. Global messages appear
separately. After a failure, read active and inactive source with `SAPRead` before choosing which
objects to retry; an object without its own error is not confirmed active.

For failed `DDLS` activation, ARC-1 appends CDS dependency impact buckets and a concrete batch re-activation template derived from where-used results.

## Examples

```text
SAPActivate(type="CLAS", name="ZCL_ORDER")
SAPActivate(type="INCL", name="LZFGTOP", group="ZFG")
SAPActivate(objects=[{type:"DDLS",name:"ZI_TRAVEL"},{type:"BDEF",name:"ZI_TRAVEL"},{type:"SRVD",name:"ZSD_TRAVEL"}])
SAPActivate(action="publish_srvb", type="SRVB", name="ZUI_TRAVEL_O4", service_type="odatav4")
```

UIAD source saves are already active on the verified system; see the
[UIAD save behavior](sap-write.md#uiad-create-and-update).

[All tools](../tools.md)
