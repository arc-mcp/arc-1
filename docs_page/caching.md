# Caching

<a id="caching-system"></a>

Keep the default memory cache for repeated source reads. Choose SQLite for persistence or `none` to disable caching. SAP normally validates cached source freshness on each read; [recent activations](#after-activation) have a short exception. ARC-1 does not scan the repository at startup.

## Backends

| Mode | Backend | Lifetime | Source stored at rest |
|---|---|---|---|
| `auto` | Memory | Current process | No |
| `memory` | Memory | Current process | No |
| `sqlite` | SQLite | Across restarts | Yes |
| `none` | Disabled | — | No |

`auto` uses memory for both stdio and HTTP deployments. Select SQLite only when persistence across restarts is worth storing source bodies on disk.

```bash
# Default: request-driven, process-local cache
ARC1_CACHE=auto npx arc-1

# Persistent cache
ARC1_CACHE=sqlite ARC1_CACHE_FILE=/var/lib/arc-1/cache.db npx arc-1

# No cache
ARC1_CACHE=none npx arc-1
```

## Cached data

Only requested data enters the cache:

| Data | Key | Freshness |
|---|---|---|
| Source | Object type, name, and `active`/`inactive` version | Normally revalidated with SAP `ETag`; see the post-activation exception below |
| Parsed ABAP contracts/dependencies (memory only) | Source content hash, object identity and parser language version | Consulted after source retrieval under the normal cache/auth policy; no aggregate reuse |
| Released API metadata | Object name and type | Populated on demand |
| Function-group mapping | Function module name | Populated on demand; mappings rarely change |

The per-user inactive-object list is a separate memory-only cache with a 60-second lifetime. It is never written to SQLite.

Repository-wide node and dependency-edge indexes are not part of the normal cache. `SAPContext(action="usages")` and `SAPNavigate(action="references")` query SAP's live where-used index instead.

## Source freshness

Source entries include the body, a content hash, the SAP `ETag`, and a cache timestamp. On a hit with an `ETag`, ARC-1 sends:

```http
If-None-Match: <etag>
```

| SAP response | ARC-1 behavior |
|---|---|
| `304 Not Modified` | Return the cached source with `[cached:revalidated]` |
| `200 OK` | Replace the body and `ETag`, then return the fresh source |
| `200 OK` without `ETag` | Store the body; the next read performs a normal GET |
| `404` or `410` | Evict the entry and surface the ADT error |

Outside the post-activation window below, there is no source TTL: SAP validates freshness on each cached source read.

### After activation

For a shared SAP client, a successful activation can promote the cached draft to active source. ARC-1 serves that promoted body without a conditional GET for **120 seconds**, protecting it from SAP temporarily returning the old active body. A later ARC-1 write or `force_refresh=true` clears the guard.

External changes, including a Git pull, can therefore be hidden during this window. Use `SAPRead(..., force_refresh=true)` when you need to verify external changes immediately. Under PP, activation invalidates entries instead of promoting a shared cached draft.

### Active and inactive source

Source-bearing `SAPRead` operations accept `version`:

| Value | Behavior |
|---|---|
| `active` | Read the activated source; this is the default |
| `inactive` | Request the current draft |
| `auto` | Consult the caller's inactive-object list and select the appropriate version |

`force_refresh=true` evicts both versions for the object and refreshes the inactive-object list before reading.

## Dependency context

`SAPContext(action="deps")` rebuilds its dependency result on every call, including when the root source is unchanged.
Dependency sources can reuse bodies after SAP returns `304`; Principal Propagation dependency calls bypass that payload cache.

Unchanged ABAP source can reuse parsed contracts and dependency names. This memory-only cache keys results by source hash, object identity and parser language version. It is capped at 128 entries and 4 MiB of serialized keys/results per source-cache owner; oversized results bypass it.

Parsing reuse still requires normal source retrieval, freshness and authorization checks. `ARC1_CACHE=none` and Principal Propagation dependency calls bypass it. No new flag or migration is required.

[Live relations](live-relations.md) query SAP metadata on demand and retain no shared relationship results.

## Live usage lookup

`SAPContext(action="usages", type="CLAS", name="ZCL_ORDER")` performs a live SAP where-used lookup. It works with memory, SQLite, or no cache, and it runs with the current caller's SAP identity.

When `type` is omitted, ARC-1 first resolves the exact object name. The lookup continues only if exactly one object matches; ambiguous results return a bounded candidate list. Supplying `type` avoids that extra round-trip.

For CDS blast-radius analysis, prefer `SAPContext(action="impact", type="DDLS", ...)` because it adds upstream dependencies and RAP-aware classification.

## Invalidation

`SAPWrite` invalidates affected source entries and inactive-object state. `SAPActivate` invalidates or promotes entries as described above. Edits made outside ARC-1 are detected by the next conditional GET; during the activation guard, use `force_refresh=true` to force that request.

## Security

`ARC1_CACHE=sqlite` stores full SAP source in cleartext. ARC-1 creates the database with owner-only permissions (`0600`), but that is not encryption. Use memory/none for sensitive landscapes, or put SQLite on an encrypted volume with restricted backup access.

Under principal propagation, source cache hits are revalidated through the current per-user SAP client before a body is served. Live usage lookup likewise uses the current caller rather than a shared prebuilt index.

## Statistics and UI

`SAPManage(action="cache_stats")` returns request-driven cache counts:

```json
{
  "enabled": true,
  "apiCount": 0,
  "sourceCount": 42,
  "contractCount": 18,
  "inactiveListCache": {
    "userCount": 1,
    "totalEntries": 3
  }
}
```

The read-only web UI adds backend mode, persistence, source inventory summaries, and bounded sanitized activity counters. It never returns cached source bodies.
`contractCount` counts retained legacy aggregate rows, not the new memory-only parse memoization.
Fresh caches normally report zero; current dependency calls do not populate that legacy table.

## Migration from startup warmup

Startup repository warmup and its node/edge tables have been removed. On first open of an existing SQLite cache, ARC-1 drops only the retired `nodes` and `edges` tables and keeps normal source, dependency, API, and function-group entries.

Remove these retired settings before upgrading:

- `ARC1_CACHE_WARMUP`
- `ARC1_CACHE_WARMUP_PACKAGES`
- `--cache-warmup`
- `--cache-warmup-packages`

ARC-1 fails at startup with migration guidance if any retired setting is still present, even when it is set to `false`.

## Troubleshooting

### Repeated reads do not show a cache marker

The SAP endpoint may not return an `ETag`, or `ARC1_CACHE=none` may be active. Check `SAPManage(action="cache_stats")` and the cache activity view.

### SQLite cache does not survive restart

Use an absolute `ARC1_CACHE_FILE`, mount a persistent volume in containers, and ensure the service user can create and update the file.

### Usage lookup is slow

Usage lookup is live SAP work and can be slower for broadly used objects. Provide the object `type`, prefer CDS `impact` for CDS entities, and keep server-wide SAP concurrency sized below the available dialog work processes.

### Clear the cache

Stop ARC-1 and remove the SQLite file, or restart when using memory mode. Cache data is derived and rebuilds from normal requests.
