# ARC-1 Caching

ARC-1 caches source reads and dependency context to reduce repeated ADT work without serving stale source.

## Cache Backends

`ARC1_CACHE=auto` uses the in-process memory backend for every transport:

| Mode | Backend | Lifetime |
|---|---|---|
| `auto` | Memory | Current process |
| `memory` | Memory | Current process |
| `sqlite` | SQLite | `ARC1_CACHE_FILE` |
| `none` | Disabled | No cache |

SQLite persistence is explicit opt-in because it stores source bodies at rest. Cache files are rebuildable. If ARC-1 sees an old `sources` table without the current `version` or `etag` columns, it drops and recreates only that table.

## Source Cache Freshness

Source cache entries are keyed by `(object type, object name, version)`, where version is `active` or `inactive`. Each entry stores the source body, a hash, the SAP `ETag`, and the cache timestamp.

On a cache miss, ARC-1 fetches the source from ADT and stores the returned `ETag`.

On a cache hit with an `ETag`, ARC-1 sends:

```http
If-None-Match: <etag>
```

SAP then decides freshness:

| SAP response | ARC-1 behavior |
|---|---|
| `304 Not Modified` | Return the cached body and mark the tool response with `[cached:revalidated]` |
| `200 OK` with body | Replace the cached body and `ETag`, then return the fresh source |
| `200 OK` without `ETag` | Store the body without a validator; the next read performs a plain GET |
| `404` or `410` | Drop the cache entry and surface the ADT error |

There is no source TTL. The SAP backend is the freshness authority on every cached source read.

## Active And Inactive Source

`SAPRead` source-bearing types accept:

| `version` | Behavior |
|---|---|
| `active` | Default. Reads the last activated source. If an inactive draft exists, ARC-1 prepends a note explaining that the source is the activated version. |
| `inactive` | Reads the inactive draft. If no draft exists, SAP returns active source and ARC-1 prepends a note. |
| `auto` | Uses the session's inactive-object list: inactive when a draft exists, otherwise active. |

The inactive-object list is cached in memory per SAP username for 60 seconds. `SAPWrite` and `SAPActivate` invalidate it because those operations can create, consume, or delete inactive drafts. The list is not persisted to SQLite.

Use `SAPRead(..., force_refresh=true)` to drop the cached active/inactive source entries for that object and refresh the inactive-object list before reading.

## Dependency Context Cache

`SAPContext(action="deps")` uses source hashes. If the source hash is unchanged, ARC-1 reuses the resolved dependency graph and returns `[cached]`. This is separate from source-cache revalidation:

- `[cached:revalidated]` means a source body came from cache after SAP returned `304`.
- `[cached]` means a dependency graph came from the hash-keyed context cache.

`SAPContext(action="usages")` is intentionally not backed by a repository-wide cache. It performs a live SAP where-used lookup with the current caller's identity and works when caching is disabled.

## Invalidation

`SAPWrite` and `SAPActivate` invalidate both active and inactive source entries for affected objects. That matters because activation turns the inactive body into the new active body and consumes the old inactive draft.

Manual edits made outside ARC-1 do not rely on invalidation. They are caught by the next conditional GET because SAP returns either `304` for unchanged source or `200` with the new source and `ETag`.

## Considered Alternatives

**TTL-only cache:** rejected because it can still serve stale source inside the TTL window and adds clock tuning.

**Always bypass cache for source:** correct but loses the latency and token-efficiency benefit for repeated reads.

**Persist inactive-object lists:** rejected because the list is per user, small, and cheap to refetch; persisting it would risk stale user-specific draft state.
