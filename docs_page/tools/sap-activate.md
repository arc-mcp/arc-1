# SAPActivate

Activate one ABAP object or a dependent batch. Requires `SAP_ALLOW_WRITES=true` and an allowed package.

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

Use batch activation for RAP stacks where objects depend on each other (DDLS, BDEF, SRVD, DDLX, SRVB must be activated together). Batch responses include per-object status (`active`, `warning`, `error`) with attached messages, so failed members can be retried selectively.

For failed `DDLS` activation, ARC-1 appends CDS dependency impact buckets and a concrete batch re-activation template derived from where-used results.

## Examples

```
SAPActivate(type="CLAS", name="ZCL_ORDER")
SAPActivate(type="INCL", name="LZFGTOP", group="ZFG")
SAPActivate(objects=[{type:"DDLS",name:"ZI_TRAVEL"},{type:"BDEF",name:"ZI_TRAVEL"},{type:"SRVD",name:"ZSD_TRAVEL"}])
SAPActivate(action="publish_srvb", type="SRVB", name="ZUI_TRAVEL_O4", service_type="odatav4")
```

**Note:** Not available by default (read-only mode). Enable with `SAP_ALLOW_WRITES=true` / `--allow-writes=true`.

[All tools](../tools.md)
