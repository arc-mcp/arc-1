# SAPManage

Inspect system capabilities and manage packages, API release state, and launchpad content. Available actions depend on the SAP system and server permissions.

```text
SAPManage(action="features")
```

## Actions

- `probe` — Re-probe the SAP system now (feature probes + auth checks + ADT discovery refresh). Detects optional features.
- `features` — Get cached feature status from last probe (fast, no SAP round-trip).
- `cache_stats` — Return request-driven cache statistics: cached sources, legacy dependency-graph rows, released APIs, and the per-username inactive-list session cache (`inactiveListCache.userCount`, `inactiveListCache.totalEntries`).
- `create_package` — Create a package (`DEVC`) via `/sap/bc/adt/packages`.
- `delete_package` — Delete a package via lock/delete/unlock.
- `change_package` — Move an existing object into a different package (DEVC reassignment).
- `set_api_state` — Set one supported API release contract to `RELEASED` or `NOT_RELEASED`. ARC-1
  reads the contract, transforms only its writable subset, writes it, then reads it back. Supported
  contracts and visibility defaults come from SAP and are not broadened by ARC-1.
- `flp_list_catalogs` — List FLP designer catalogs. The `flp_*` actions target the classic tile/target-mapping model, deprecated as of S/4HANA 2023 and not federated by Work Zone content exposure v2 — the successor is the Launchpad App Descriptor Item (`SAPRead type=UIAD`). Business catalogs are a separate model (`/UI2/FLPCM_CUST`) and are not managed here.
- `flp_list_groups` — List FLP groups (`Pages`) from `/UI2/FLPD_CATALOG`.
- `flp_list_tiles` — List tiles/target mappings in a catalog.
- `flp_create_catalog` — Create an FLP designer catalog.
- `flp_create_group` — Create an FLP group.
- `flp_create_tile` — Create a tile in an FLP catalog.
- `flp_add_tile_to_group` — Assign a catalog tile instance into a group.
- `flp_delete_catalog` — Delete an FLP designer catalog.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | Yes | `probe`, `features`, `cache_stats`, `create_package`, `delete_package`, `change_package`, `set_api_state`, `flp_list_catalogs`, `flp_list_groups`, `flp_list_tiles`, `flp_create_catalog`, `flp_create_group`, `flp_create_tile`, `flp_add_tile_to_group`, `flp_delete_catalog` |
| `name` | string | No | Package name for `create_package`/`delete_package`; object name for `set_api_state` when `objectUri` is omitted. |
| `description` | string | No | Required for `create_package` (package description) |
| `superPackage` | string | No | Parent for `create_package`: optional on-premises (`$TMP` for local packages), required on BTP ABAP (a structure package, for example `ZLOCAL`). |
| `softwareComponent` | string | No | For `create_package`: default `LOCAL` on-premises, `ZLOCAL` on BTP ABAP. |
| `responsible` | string | No | Package-responsible ABAP user (XUBNAME, max 12 characters). On-premises defaults to a valid connection username; pass explicitly under principal propagation. BTP uses an explicit value or the internal ABAP user resolved by a prior object create. Email identities are rejected. |
| `transportLayer` | string | No | Optional transport layer for `create_package` |
| `recordChanges` | boolean | No | Record package changes in transports. BTP defaults false. On-premises defaults true for a non-LOCAL software component or a supplied transport layer, otherwise false. |
| `packageType` | string | No | Optional package type for `create_package`: `development`, `structure`, `main` (default: `development`) |
| `transport` | string | No | Optional transport request ID (`corrNr`) for `create_package`/`delete_package`/`change_package`/`set_api_state` |
| `objectName` | string | No | Required for `change_package` — name of the object to move (e.g., `ZCL_MY_CLASS`) |
| `objectType` | string | No | Required for `change_package`; optional type for `set_api_state` with `name` (otherwise inferred from the name). Examples: `CLAS/OC`, `DDLS/DF`, `PROG/P`. |
| `objectUri` | string | No | ADT object URI for `change_package` or `set_api_state`. If omitted, resolved from the action's name/type fields. |
| `oldPackage` | string | No | Required for `change_package` — current package of the object |
| `newPackage` | string | No | Required for `change_package` — target package to move the object to |
| `apiState` | string | No | For `set_api_state`: `RELEASED` (default) or `NOT_RELEASED`; visibility follows SAP's contract defaults. |
| `contract` | string | No | For `set_api_state`: `C0`–`C4` (default `C1`). Support varies by type/release; inspect `SAPRead(type="API_STATE")` and SAP's supported-contract response. |
| `catalogId` | string | No | Required for `flp_list_tiles`, `flp_create_tile`, `flp_add_tile_to_group` |
| `groupId` | string | No | Required for `flp_create_group`, `flp_add_tile_to_group` |
| `domainId` | string | No | Required for `flp_create_catalog` |
| `title` | string | No | Required for `flp_create_catalog`, `flp_create_group` |
| `tileInstanceId` | string | No | Required for `flp_add_tile_to_group` |
| `tile` | object | No | Required for `flp_create_tile`. Fields: `id`, `title`, `semanticObject`, `semanticAction`, optional `icon`, `url`, `subtitle`, `info` |

**Probed features:** `hana`, `abapGit`, `rap`, `amdp`, `ui5`, `transport`, `ui5repo`, `flp`. Each returns `available` (bool), `mode` (auto/on/off), `message`, and `probedAt` timestamp.

## cache_stats output

```json
{
  "enabled": true,
  "sourceCount": 42,
  "contractCount": 38,
  "apiCount": 0,
  "inactiveListCache": {
    "userCount": 1,
    "totalEntries": 3
  }
}
```

| Field | Description |
|-------|-------------|
| `enabled` | Whether caching is active (`false` if `ARC1_CACHE=none`) |
| `sourceCount` | Cached source code entries (grows as objects are read) |
| `contractCount` | Legacy dependency-graph rows; current `SAPContext(deps)` neither reads nor populates them. Does not count memory-only parse memoization. |
| `apiCount` | Released API metadata entries populated by requests |
| `inactiveListCache` | Aggregate user/session draft-list cache counts |

## Examples

```
SAPManage(action="probe")       → discover system capabilities
SAPManage(action="features")    → get cached results (no SAP call)
SAPManage(action="cache_stats") → check request-driven cache state
SAPManage(action="create_package", name="ZRAP_TRAVEL", description="RAP Travel Demo", superPackage="$TMP")
SAPManage(action="create_package", name="ZRAP_TRAVEL", description="RAP Travel Demo", superPackage="ZRAP", softwareComponent="HOME", transportLayer="HOME", packageType="development", transport="K900123")
SAPManage(action="delete_package", name="ZRAP_TRAVEL")
SAPManage(action="change_package", objectName="ZCL_MY_CLASS", objectType="CLAS/OC", oldPackage="$TMP", newPackage="Z_PRODUCTION", transport="K900123")
SAPManage(action="set_api_state", name="ZCL_MY_CLASS", objectType="CLAS", contract="C1", apiState="RELEASED")
SAPManage(action="flp_list_catalogs")
SAPManage(action="flp_list_groups")
SAPManage(action="flp_list_tiles", catalogId="ZARC1_SALES")
SAPManage(action="flp_create_catalog", domainId="ZARC1_SALES", title="Sales Catalog")
SAPManage(action="flp_create_group", groupId="ZARC1_SALES_GRP", title="Sales Group")
SAPManage(action="flp_create_tile", catalogId="ZARC1_SALES", tile={"id":"tile_sales","title":"Sales","semanticObject":"SalesOrder","semanticAction":"display"})
SAPManage(action="flp_add_tile_to_group", groupId="ZARC1_SALES_GRP", catalogId="ZARC1_SALES", tileInstanceId="00O2TO3741QLWH4GV74AHMWQE")
```

**Note:** The `probe`, `features`, and `cache_stats` actions are read operations that work without `--allow-writes` and require only `read` scope in HTTP auth mode. Mutating SAPManage actions require `write` scope and writable safety config.

[All tools](../tools.md)
