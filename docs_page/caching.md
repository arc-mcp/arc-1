# Caching System

## Overview

ARC-1 includes a built-in caching layer that sits between the intent handler and the ADT client. Its purpose is to reduce redundant HTTP calls to the SAP system, speed up responses for repeated operations, and enable features like reverse dependency lookup.

The cache is **server-validated**: every cached source carries the SAP-emitted `ETag`, and every read sends `If-None-Match` so the SAP backend itself decides freshness. There is no TTL, no clock dependency, and no system-type detection — the same mechanism works on every supported SAP release (verified live on S/4HANA 2023 and NW 7.50 SP02).

The cache stores six types of data:

- **Source code** — raw ABAP source keyed by `(objectType, objectName, version)`, with the SAP `ETag` and a SHA-256 content hash. Active and inactive views never collide.
- **Dependency graphs** — compressed dependency contracts keyed by source hash.
- **Dependency edges** — directional relationships between objects (CALLS, USES, IMPLEMENTS, INCLUDES).
- **Node metadata** — object type, name, package, and source hash for each cached object.
- **Function group mappings** — which function module belongs to which function group.
- **Inactive-objects list** — per-username session cache of pending drafts (in-memory only, 60s TTL with explicit invalidation on writes).

The system operates in three tiers of increasing capability:

| Tier | Transport | Backend | Lifetime | Features |
|------|-----------|---------|----------|----------|
| 1 | stdio (Claude Desktop) | Memory | Single session | Dedup fetches within session, ETag revalidation |
| 2 | http-streamable (server) | SQLite | Persists across sessions | Shared warm cache, ETag revalidation, draft awareness |
| 3 | Docker + warmup | SQLite + pre-warmer | Persists + pre-indexed | Reverse dependency lookup, sub-second dep resolution |

## Configuration

All cache settings follow the standard ARC-1 configuration priority: CLI flags > environment variables > `.env` file > defaults.

| Env Variable | CLI Flag | Values | Default | Description |
|-------------|----------|--------|---------|-------------|
| `ARC1_CACHE` | `--cache` | `auto`, `memory`, `sqlite`, `none` | `auto` | Cache backend selection. `auto` picks memory for stdio, SQLite for http-streamable. |
| `ARC1_CACHE_FILE` | `--cache-file` | File path | `.arc1-cache.db` | Path to the SQLite database file. Relative paths resolve from the working directory. |
| `ARC1_CACHE_WARMUP` | `--cache-warmup` | `true`, `false` | `false` | Run the pre-warmer on startup (enumerates TADIR, fetches all custom objects). |
| `ARC1_CACHE_WARMUP_PACKAGES` | `--cache-warmup-packages` | Comma-separated patterns | (empty = all custom) | Package filter for warmup. Supports wildcards. |

### Auto mode behavior

When `ARC1_CACHE=auto` (the default):

- **stdio transport** — uses in-memory cache. No files created, no persistence. The cache dies with the process.
- **http-streamable transport** — uses SQLite. The database file is created at the path specified by `ARC1_CACHE_FILE`.

To disable caching entirely, set `ARC1_CACHE=none`. (Disables source caching, dep-graph caching, and the inactive-list session cache.)

## Server-Validated Source Cache (ETag / If-None-Match)

The single most important property of ARC-1's cache: **the SAP backend is the source of truth for freshness on every cached source read.**

### How it works

1. **Cache miss** — first read of an object fetches the source from ADT and stores the body together with the `ETag` returned by SAP.
2. **Cache hit** — every subsequent read of the same object sends the cached ETag in `If-None-Match`. The server inspects it and replies:
    - **`304 Not Modified`** (~50 bytes, no body) if the source is unchanged. ARC-1 returns the cached body and prefixes the response with `[cached:revalidated]`.
    - **`200 OK` with new body and ETag** if anything changed externally (SE38/Eclipse activation, gCTS pull, etc.). ARC-1 replaces the cache entry and returns the fresh source.
    - **`200 OK` without an ETag** if the resource handler doesn't emit one. ARC-1 stores the body without a validator; the next read does a plain GET.
    - **`404 Not Found` / `410 Gone`** if the object was deleted externally. ARC-1 invalidates the cache entry before re-throwing the error so the database stays in sync with the backend.
3. **No TTL.** Cache freshness comes from the server, not from a clock. There is no staleness window.

### Why this works on every SAP release

The ETag mechanism in ADT predates SAP_BASIS 7.50 — see SAP Notes 1760222 (2012-09-06), 1814370 (2013-05-24), and 1940316 (2013-11-14) which all reference the `cl_adt_utility=>calculate_etag_base` API used today. Every supported release emits ETag headers on `/sap/bc/adt/.../source/main` and honours `If-None-Match` → 304. Verified live on a4h.marianzeis.de (S/4HANA 2023) AND npl.marianzeis.de (NW 7.50 SP02).

### ETag format

The server-side `cl_adt_utility=>calculate_etag_base` produces ETags shaped like `YYYYMMDDHHMMSS<3-digit-version-flag>[<unification-string>]`. Examples observed live:

| Object | Version | ETag |
|--------|---------|------|
| `RSPARAM` (PROG, S/4 2023) | active | `202308011726360011` |
| `RSPARAM` (PROG, NW 7.50) | active | `201507241141090011` |
| `ZC_FbClubTP` (BDEF) | active | `20260414131223001text/plain_n+6xHFdziJcgDc+DpmHd6QYEcfk=` |
| `ZC_FbClubTP` (BDEF) | inactive | `20260414131223000text/plain_n+6xHFdziJcgDc+DpmHd6QYEcfk=` |

Note the trailing 3-digit discriminator: `001` for active, `000` for inactive. The cache keys both views separately.

### What gets the conditional GET

All source-bearing types that go through the cache:

- ABAP source: PROG, CLAS, INTF, FUNC, INCL, FUGR
- CDS family: DDLS, DCLS, BDEF, SRVD, DDLX
- DDIC metadata: TABL (covers transparent tables and DDIC structures), VIEW
- Service binding: SRVB
- Knowledge transfer: SKTD

Other read types (DOMA, DTEL, AUTH, FTG2, ENHO, MESSAGES, etc.) are not cached because they don't go through `/source/main`.

## Active vs Inactive Source

`SAPRead` accepts an optional `version` parameter on every source-bearing type:

| `version` | Behaviour |
|-----------|-----------|
| `active` (default) | Reads the last activated source. If the user has an unactivated draft, the response is prefixed with a one-line note explaining that the source is the activated version (so the LLM knows there's a gap). |
| `inactive` | Reads the user's unactivated draft directly. If no draft exists, SAP falls back to the active source and ARC-1 prefixes the response with a note: *"No inactive draft exists for this object on the server. Returning the active version."* |
| `auto` | Resolves client-side via the inactive-list session cache. Returns the draft if one exists, otherwise active. No warning is prefixed (the caller explicitly opted into "show me my view"). |

**The default preserves all existing behaviour.** Adding the parameter doesn't break callers; it just gives them a way to act on the warning when they see one.

### Why two cache keys

The server's ETag encodes the version (`...001` active, `...000` inactive). Sending an active ETag against an inactive request is a guaranteed mismatch — the cache must key both dimensions to avoid wasted misses. Active and inactive cache entries coexist for the same `(type, name)` pair without colliding.

### Per-username inactive-list session cache

To support `auto` and the draft-awareness warning, ARC-1 caches the user's pending-drafts list (from `/sap/bc/adt/activation/inactiveobjects` with vendor MIME `application/vnd.sap.adt.inactivectsobjects.v1+xml`). This cache:

- Is keyed by **SAP username** so Principal Propagation deployments give each user their own view.
- Is **lazy** — fetched on first source read of a session (~415 ms one-time per user, verified live).
- Has a **60-second TTL** to catch external Eclipse activations done mid-session.
- Is **invalidated** on every `SAPWrite`, `SAPActivate`, or explicit `force_refresh: true` (those operations mutate the user's draft set).
- Is **memory-only** — never written to SQLite. The list is small and per-user; persisting it would risk stale cross-session draft state.

## SAPRead `force_refresh` Parameter

Every source-bearing `SAPRead` accepts an optional `force_refresh: true` flag that bypasses both the source cache (active and inactive) AND the inactive-list session cache for that object. Use when you know the object changed outside ARC-1 in a way conditional GET can't catch (e.g., a fresh deployment to the same name from a different source repository where the server timestamp is identical).

```json
{
  "type": "PROG",
  "name": "ZARC1_FOO",
  "force_refresh": true
}
```

In normal operation the conditional-GET mechanism makes `force_refresh` rarely necessary — it exists as a defensive escape hatch.

## How It Works (Internals)

### Source code caching with ETag

Every time ARC-1 fetches source code from SAP, the response is stored in the cache keyed by `OBJECTTYPE:OBJECTNAME:VERSION` (uppercased). The SAP-emitted `ETag` and a SHA-256 hash of the source content are stored alongside it.

On subsequent requests for the same object, ARC-1 sends the cached ETag in `If-None-Match`. SAP returns either `304` (cached body still authoritative — prefix `[cached:revalidated]`) or `200` with new body + ETag (replace cache, no prefix).

### Hash-on-fetch mechanism

The SHA-256 hash serves a dual purpose:

1. **Dependency graph cache key** — dependency graphs are keyed by the source hash, not by the object name. If the source code hasn't changed, the hash is the same, and the entire dependency resolution is skipped — no AST parsing, no downstream fetches.
2. **Delta detection during warmup** — when the pre-warmer re-runs, it compares the hash of freshly fetched source against the cached hash. If they match, the object is skipped entirely.

### Dependency graph caching

When `SAPContext(action="deps")` resolves dependencies for an object, the result is a list of contracts. This list is stored keyed by the source hash. On the next request the dep graph is reused **if the source hash is unchanged** — independent of whether the source-cache layer revalidated via 304 or fetched a fresh body.

When a dep graph is served from cache, the response prefix is `[cached]` (different label from source-cache hits, because dep graphs are hash-keyed and naturally correct without server validation).

### Function group resolution caching

Function modules in SAP belong to function groups, but the mapping is not encoded in the module name. ARC-1 must search ADT to resolve which group a function belongs to. These mappings are cached permanently (they rarely change) to avoid repeated search calls.

### Write invalidation

When `SAPWrite` modifies an object, the cache invalidates **both the active and inactive entries** (`version: 'all'`) for that object. Activation consumes the inactive draft (it becomes the new active body), so leaving either entry stale would be incorrect. The same applies to `SAPActivate` and gCTS sync.

The per-username inactive-list cache is also invalidated whenever the writing user's draft set changes.

### Read-side 404 invalidation

If the source-cache layer holds an entry for an object that has been deleted externally, the next read sends `If-None-Match` against a now-missing resource. SAP returns `404 Not Found` with `<exc:type id="ExceptionResourceNotFound"/>`. ARC-1 invalidates the active cache entry before re-throwing the error so the cache database stays in sync with the backend (defense-in-depth on top of the conditional-GET correctness).

## Response Indicators

| Prefix | What it means |
|--------|---------------|
| `[cached:revalidated]` | Source body came from the cache after SAP confirmed via 304 Not Modified. Common case for source reads. |
| `[cached]` | Dependency graph (from `SAPContext`) came from the hash-keyed context cache — reused because the source hash is unchanged. |
| (no prefix) | Fresh fetch from SAP, or first read in the session, or response that didn't pass through the cache. |

**Source reads never emit unprefixed `[cached]` post-PR.** Plain `[cached]` is reserved for dep-graph hits in the context compressor. This makes the wire-level mechanism observable from the response.

## Cache Strategies by Deployment

| Aspect | stdio (Claude Desktop) | http-streamable (server) | Docker + warmup |
|--------|----------------------|------------------------|-----------------|
| **Backend** | Memory | SQLite | SQLite |
| **Persistence** | None (session-scoped) | Across restarts | Across restarts |
| **Config needed** | None (zero config) | None (auto-detects) | `ARC1_CACHE_WARMUP=true` |
| **First request** | Always cold | Warm after first session | Pre-warmed on startup |
| **Reverse deps** | Not available | Not available | Available (`SAPContext(action="usages")`) |
| **Multi-user** | N/A (single user) | Shared cache | Shared cache |
| **Inactive lists** | Per-user, in-memory | Per-user, in-memory (PP-aware) | Per-user, in-memory (PP-aware) |
| **Typical setup** | `npx arc-1` | `arc-1 --transport http-streamable` | See Docker section below |

### stdio (Claude Desktop)

No configuration required. The memory cache eliminates duplicate fetches within a single conversation. When the process exits, the cache is gone.

```json
{
  "mcpServers": {
    "arc1": {
      "command": "npx",
      "args": ["-y", "arc-1"],
      "env": {
        "SAP_URL": "http://sap-host:50000",
        "SAP_USER": "developer",
        "SAP_PASSWORD": "secret"
      }
    }
  }
}
```

### http-streamable (server)

SQLite cache is selected automatically. The database persists across server restarts, so the second session benefits from the first session's fetches. With Principal Propagation, each user has their own inactive-list view; the source/dep-graph cache is shared because content is per-object, not per-user.

```bash
arc-1 --transport http-streamable \
      --url http://sap-host:50000 \
      --user developer \
      --password secret
```

### Docker with warmup

Full-strength caching with pre-indexed dependency graph and reverse lookup support.

```bash
docker run -d \
  -e SAP_URL=http://sap-host:50000 \
  -e SAP_USER=developer \
  -e SAP_PASSWORD=secret \
  -e SAP_TRANSPORT=http-streamable \
  -e ARC1_CACHE_WARMUP=true \
  -e ARC1_CACHE_WARMUP_PACKAGES="Z*,Y*" \
  -v arc1-cache:/app/cache \
  -e ARC1_CACHE_FILE=/app/cache/arc1.db \
  -p 8080:8080 \
  ghcr.io/marianfoo/arc-1
```

## Pre-Warmer

The pre-warmer runs at startup when `ARC1_CACHE_WARMUP=true`. It populates the cache with all custom objects so that the first user request is fast and reverse dependency lookups are available.

### Pipeline

1. **Enumerate** — queries TADIR for all objects of type CLAS, INTF, and FUGR where the object name starts with `Z*`, `Y*`, or `/*` (namespaced).
2. **Fetch** — retrieves source code for each object in parallel batches of 5 concurrent requests. Stores body + ETag.
3. **Delta check** — compares the SHA-256 hash of fetched source against the cached hash. If unchanged, the object is skipped (no re-parsing).
4. **Extract** — runs the local AST parser (`@abaplint/core`) on each changed source to extract dependencies. No additional ADT calls are needed for this step.
5. **Index** — stores source, node metadata, and dependency edges in the cache. For function groups, individual function modules are enumerated and indexed separately.
6. **Enable reverse lookup** — sets the `warmupDone` flag, which enables `SAPContext(action="usages")`.

After warmup completes, subsequent reads of warmed objects use conditional GET — so a re-read against a server with the same content costs ~50 bytes per object.

### Package filter syntax

The `ARC1_CACHE_WARMUP_PACKAGES` value is a comma-separated list of patterns. Each pattern maps to a SQL `LIKE` clause on the TADIR `DEVCLASS` column. The `*` wildcard maps to `%`.

| Filter | Effect |
|--------|--------|
| (empty) | All custom objects (Z*, Y*, /*) |
| `ZPROJECT` | Only package ZPROJECT (exact match) |
| `Z*` | All packages starting with Z |
| `Z*,Y*` | All Z and Y packages |
| `/COMPANY/*` | All packages in the /COMPANY/ namespace |
| `ZMOD1,ZMOD2,/NS/*` | Specific packages plus a namespace |

### Timing estimates

Estimates assume 5 concurrent requests (the default `WARMUP_CONCURRENT` value) and typical on-premise network latency:

| System size | Objects | Estimated time |
|------------|---------|---------------|
| Small | ~500 | 2-3 minutes |
| Medium | ~2,000 | 8-12 minutes |
| Large | ~5,000 | 20-30 minutes |

Delta re-runs are significantly faster because unchanged objects are skipped after hash comparison. Only objects with modified source are re-fetched and re-parsed.

The maximum number of objects per warmup run is capped at 10,000 (`WARMUP_MAX_OBJECTS`).

### Docker cron example

To keep the cache fresh on a running Docker container, schedule periodic re-warmup via cron or an external scheduler:

```bash
# Re-run warmup every 4 hours via docker exec
# (the server handles this as a SAPManage action, or restart the container)
0 */4 * * * docker restart arc1-container
```

Alternatively, mount the SQLite database on a persistent volume so that restarts with `ARC1_CACHE_WARMUP=true` perform a delta update rather than a full re-index:

```bash
docker run -d --name arc1 \
  -v arc1-cache:/app/cache \
  -e ARC1_CACHE_FILE=/app/cache/arc1.db \
  -e ARC1_CACHE_WARMUP=true \
  -e ARC1_CACHE_WARMUP_PACKAGES="Z*" \
  # ... other env vars ...
  ghcr.io/marianfoo/arc-1
```

## Reverse Dependency Lookup

### What it does

`SAPContext(action="usages", name="ZCL_MY_CLASS")` returns all objects that depend on the given object — i.e., "who calls/uses this class?"

This is a reverse lookup on the edge index: find all edges where `toId` matches the target object.

### Requirements

Reverse dependency lookup is only available after the pre-warmer has run. The `warmupDone` flag must be set to `true`. Without warmup, the edge index is empty and there is nothing to reverse-look-up.

### How it works

1. The pre-warmer extracts dependencies from every indexed object and stores them as directed edges (`fromId -> toId`).
2. When `getUsages(objectName)` is called, the cache queries all edges where `toId = objectName.toUpperCase()`.
3. Results include the calling object (`fromId`) and the relationship type (`CALLS`, `USES`, `IMPLEMENTS`, `INCLUDES`).

### Fallback when warmup is not available

If warmup has not run, `SAPContext(action="usages", ...)` returns an `isError: true` response with setup instructions — telling the caller to start ARC-1 with `--cache-warmup` (or `ARC1_CACHE_WARMUP=true`), wait for indexing to complete, then retry.

## Performance Impact

| Scenario | Description | Estimated savings |
|----------|-------------|-------------------|
| A | Single session, no warmup (memory cache) | 80-95% bandwidth on repeat reads (304 with no body), ~30% RTT savings on dep graphs |
| B | Same session with warmup (SQLite, pre-indexed) | 85-95% — most source served via 304, all deps from cache |
| C | Productive system, multiple users (shared SQLite) | Sub-linear scaling — each user benefits from objects fetched by others; per-user inactive lists isolated |

**Cache hits still make HTTP calls** — they're conditional GETs that return 304 with no body. The savings are bandwidth (no body transfer on 304) and dep-graph resolution (skipped when source hash unchanged), not RTT count. This trade is intentional: structurally correct freshness beats round-trip optimisation.

The biggest savings still come from dependency graph caching. A single `SAPContext` call for a class with 15 dependencies would normally require 16+ ADT calls (1 for the class + 1 per dependency). With a warm cache and unchanged source, this drops to 1 conditional-GET (the source) + 0 dep calls.

## Disk Space

### What is stored

| Data type | Storage per object | Notes |
|-----------|-------------------|-------|
| Source code + ETag | Varies (typically 2-50 KB) | Full ABAP source text + ~50 byte ETag string |
| Dependency graphs | ~1-5 KB per object | JSON-serialized contract list |
| Edges | ~100 bytes each | One row per dependency relationship |
| Node metadata | ~200 bytes each | Object type, name, package, hash |
| Function group mappings | ~100 bytes each | Function name to group name |
| Inactive-objects list | 1-15 KB per user (up to ~120 KB heavy users) | In-memory only, never persisted |

### Typical database sizes

| System size | Custom objects | Approximate SQLite size |
|------------|---------------|------------------------|
| Small | ~500 | 35-50 MB |
| Medium | ~2,000 | 60-100 MB |
| Large | ~5,000 | 100-150 MB |

### CPU overhead

- **SHA-256 hashing**: negligible (~0 ms per object for typical source sizes).
- **AST parsing** (`@abaplint/core`): approximately 10 ms per object. This only runs on cache misses or during warmup for changed objects.
- **SQLite I/O**: single-digit milliseconds for reads; writes are batched during warmup.
- **Conditional-GET overhead**: ~50 bytes per cache hit on the wire, no parsing cost (304 has empty body).

## Limitations and Caveats

### External writes ARE detected

The conditional-GET mechanism catches external writes from any source — Eclipse ADT, SE38, transaction ABAP Workbench, gCTS pulls, abapGit imports, or another ARC-1 instance. The cached ETag becomes stale; SAP returns 200 with a new body and ETag on the next read; ARC-1 transparently replaces the cache entry.

**This is a behaviour change from earlier versions.** Pre-PR-#186 caches relied on local invalidation only; that behaviour is gone.

### Inactive drafts are surfaced

When a developer has an unactivated draft in Eclipse/SE80 and asks Claude to read the same object, ARC-1 returns the *active* version by default but prepends a one-line warning so the LLM knows about the draft. This is the user-visible part of the inactive-list session cache.

To read the draft directly: pass `version: 'inactive'` to `SAPRead`, or `version: 'auto'` for "show me my view" semantics.

### Force refresh as escape hatch

If the conditional-GET mechanism somehow misses a change (e.g., a server with a buggy ETag implementation on a specific resource type), pass `force_refresh: true` to `SAPRead` to drop both source-cache views (active + inactive) AND the inactive-list cache for that user, then refetch. This rarely needs to be invoked in practice.

### Warmup covers CLAS, INTF, and FUGR only

The pre-warmer enumerates TADIR and only indexes objects of type `CLAS` (classes), `INTF` (interfaces), and `FUGR` (function groups). Programs (`PROG`), includes (`INCL`), CDS views (`DDLS`), behavior definitions (`BDEF`), and other types are **not** pre-indexed.

This means:

- `SAPContext(action="usages")` only finds callers among indexed object types (classes, interfaces, function groups).
- Programs that call a class won't appear in usages results.
- On-demand caching (reading PROG/DDLS/etc.) still works — those types are cached the first time they're read, with conditional-GET freshness for repeat reads. They just aren't in the edge index.

### SQLite requires a native addon

The SQLite backend uses `better-sqlite3`, a native Node.js addon compiled for the host platform. If the addon is missing or compiled for a different platform, ARC-1 automatically falls back to an in-memory cache and logs a warning:

```
WARN SQLite cache unavailable (better-sqlite3 not loaded) — falling back to memory cache
```

This happens automatically — the server still starts and caches in memory. To verify which backend is active, use `SAPManage(action="cache_stats")`.

### Warmup does not block server startup

The pre-warmer runs concurrently in the background. The server starts accepting MCP requests immediately, even if warmup is still running. During warmup:

- Source reads are served normally (cache misses go to SAP, hits return immediately).
- `SAPContext(action="usages")` returns a "warmup not complete" error until warmup finishes.
- `SAPManage(action="cache_stats")` shows `warmupAvailable: false` while in progress.

### SQLite schema migration is destructive

When SqliteCache opens a database file with an old schema (no `etag` or `version` columns), the `sources` table is dropped and recreated. Other tables (nodes, edges, apis, dep_graphs, func_groups) are preserved. Users lose at most one re-fetch worth of latency to repopulate source bodies — these are rebuildable from SAP.

## Considered Alternatives

The PR-#186 design rejected four other approaches; documented here so future readers don't burn cycles re-discovering the rationale.

**Disable cache by default (the original "quick fix" instinct)** — kills the dep-graph cache, which is the killer feature for `SAPContext` (10–30× speedup on dependency-resolution workflows). Trades a fixable correctness bug for a permanent performance regression on the headline token-efficiency feature. Also: doesn't fix the within-session case.

**TTL-based revalidation** — gambles on freshness. Any value > 0 means a window where stale source can be served; any value of 0 means the cache is disabled. Structurally inferior to ETag: same RTT count, no bandwidth savings, requires admin tuning (always wrong by default for some user). HTTP gives us a content-validated mechanism for free.

**Versions-feed lazy revalidation** (parsing `/source/main/versions` Atom feed and comparing the latest revision timestamp) — only updates on activation, so it cannot catch un-activated drafts. Requires Atom XML parsing (extra code surface). Same RTT cost as ETag conditional GET. ETag wins on every dimension.

**Transport-system timestamp comparison** (looking up when each object was included in a transport, comparing against `cached_at`) — requires multiple ADT calls per cache check (transport list, transport contents, timestamp parsing), high token cost on shared service-account deployments, and still doesn't catch un-activated drafts or workbench-direct edits that bypass transports. Strictly inferior to ETag.

**Why ETag wins**: the server is the source of truth for freshness, the round-trip is cheap (~50 bytes on cache hit), and the mechanism predates SAP_BASIS 7.50 (Notes 1760222 from 2012, 1814370 from 2013) so there's no per-release feature gating.

## Monitoring

Use `SAPManage(action="cache_stats")` to inspect the current state of the cache:

```json
{
  "enabled": true,
  "warmupAvailable": true,
  "nodeCount": 1523,
  "edgeCount": 8742,
  "apiCount": 0,
  "sourceCount": 1523,
  "contractCount": 1401,
  "inactiveListCache": {
    "userCount": 3,
    "totalEntries": 87
  }
}
```

| Field | Description |
|-------|-------------|
| `enabled` | Whether caching is active (`false` when `ARC1_CACHE=none`) |
| `warmupAvailable` | Whether the pre-warmer has completed (enables reverse dep lookup) |
| `sourceCount` | Number of cached source code entries (active + inactive views counted separately) |
| `contractCount` | Number of cached dependency graphs |
| `edgeCount` | Number of dependency edges (used for reverse lookup) |
| `nodeCount` | Number of cached object metadata entries |
| `apiCount` | Number of cached released API entries (for clean core checks) |
| `inactiveListCache.userCount` | Number of distinct SAP users with cached inactive-objects lists |
| `inactiveListCache.totalEntries` | Total inactive-object entries across all users |

When `enabled` is `false`, caching is disabled and only `enabled` and `message` are returned.
