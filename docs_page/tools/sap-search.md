# SAPSearch

Find ABAP objects by name, resolve exact names across packages, or search source text.

```text
SAPSearch(query="ZCL_ORDER*", maxResults=20)
```

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | No | Search pattern (e.g., `ZCL_ORDER*`, `Z*TEST*`), source text, or comma/whitespace-separated names for `tadir_lookup` |
| `maxResults` | number | No | Maximum results (default 100) |
| `searchType` | string | No | `object` (default, name search), `tadir_lookup` (exact cross-package object lookup), or `source_code` (text search within ABAP source) |
| `names` | array | No | For `tadir_lookup`: exact object names to resolve across packages |
| `objectTypes` | array | No | For `tadir_lookup`: optional ADT/TADIR type filters such as `TABL`, `DDLS`, `BDEF`, `SRVB`, `CLAS/OC` |
| `objectType` | string | No | For normal/object search: SAP applies this ADT type filter before `maxResults`; slash subtypes such as `CLAS/OC` stay intact. Older releases (verified on 7.50) may ignore the subtype portion. For `source_code`: filter by object type. For `tadir_lookup`: single type filter |
| `source` | string | No | For `tadir_lookup` only: `adt` (default), `db`, or `both`. `db`/`both` require the `sql` scope and `SAP_ALLOW_FREE_SQL=true`. See [TADIR lookup `source` modes](#tadir-lookup-source-modes) below. |
| `packageName` | string | No | For `source_code` search: filter by package |

**Returns:** Object type, name, package, and description for each match. `tadir_lookup` groups exact matches by requested name and includes a `missing` list. Source code search also returns line numbers and code snippets. When `source='both'` reveals divergence between the ADT and DB views, the response adds a `splitBrain: [name, ...]` array and a `warnings: [...]` array explaining each diverging name.

## Examples

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

**Field names:** Object search matches repository object names. To find tables containing a field
such as MATNR, query DD03L with authorized `SAPQuery` or `SAPRead(type="TABLE_QUERY")` access.
`source_code` can find text occurrences but does not inventory DDIC fields.

**TADIR lookup:** Use `searchType="tadir_lookup"` for reset/create preflights that need to know whether objects exist anywhere, regardless of package. The default `source='adt'` uses ADT repository quick search, which avoids long `IN (...)` parser limits and works in read/search-only configurations. The endpoint deliberately filters out TADIR rows that don't resolve to a live workbench resource, so orphan/ghost entries (left behind by aborted create/delete cycles) are invisible to the default path — see the source modes section below.

## TADIR lookup source modes

| `source` | Underlying call | Scope required | When to use |
|----------|-----------------|----------------|-------------|
| `adt` (default) | `GET /sap/bc/adt/repository/informationsystem/search?operation=quickSearch&query=...` (one per name) | `read` | Default; workbench-resolvable objects only. Skips TADIR ghost rows by design. |
| `db` | `POST /sap/bc/adt/datapreview/freestyle` with `SELECT pgmid, object, obj_name, devclass FROM tadir WHERE obj_name IN (…)` | `sql` (server-side: `SAP_ALLOW_FREE_SQL=true`) | One SQL query for the name list; surfaces orphan TADIR rows. Row, byte, and backend SQL-list limits still apply, so split large selections explicitly. |
| `both` | Parallel `adt` + `db` calls; merge by `(base type, name)` with dedupe | `sql` | Explicit split-brain detection. Returns `splitBrain: [name, ...]` and a `warnings` array when the two sources disagree (e.g. a TADIR ghost from an aborted create/delete). |

Every match in the result set is stamped with an `_origin: 'adt' | 'db'` field so callers can colour-code or filter rows by provenance. The `'db'` path also covers legacy SEGW types (`IWSV`/`IWMO`/`IWPR`) that the ADT info-system does not return; the URL is left empty for types that aren't addressable via a single ADT base URL (e.g. function modules, which need the parent group).

**Source code search availability:** Depends on SAP release and SICF service activation. If
unavailable, ARC-1 returns an error; it does not automatically run an SQL fallback.

[All tools](../tools.md)
