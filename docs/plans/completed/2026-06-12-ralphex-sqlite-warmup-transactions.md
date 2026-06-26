# Ralphex SQLite Warmup Transactions

## Overview

This plan addresses external feedback point 6: ARC-1 uses `better-sqlite3`, which is appropriate for the single-process stdio/server model, but synchronous writes can block the event loop when many warmup entries are written one statement at a time. The highest-leverage fix is to batch pre-warmer writes in SQLite transactions so the startup TADIR scan does not pay per-statement commit overhead.

The implementation adds a small transaction primitive to the cache interface. `SqliteCache` maps it to `better-sqlite3` transactions, while `MemoryCache` runs the callback inline. Warmup now fetches SAP objects outside any transaction, builds synchronous cache-write closures, and commits each parallel fetch batch in one transaction.

## Context

### Current State

`src/cache/sqlite.ts` performs each `putSource`, `putNode`, `putEdge`, and `putFuncGroup` as an individual `better-sqlite3` statement. `src/cache/warmup.ts` fetches objects in batches of five, but writes source, node metadata, function-group mappings, and dependency edges inside each object indexing flow. That means a warmup batch can still issue many independent SQLite writes.

The cache docs already state that warmup writes are batched, but the code did not enforce that. Warmup also received ETags from `getClass`, `getInterface`, and `getFunction`, but discarded them when storing source entries.

### Target State

Warmup performs all SAP/network work before opening a cache transaction. For each parallel fetch batch, successful indexing results contribute synchronous write closures. The batch then executes those writes through `Cache.transaction()`, so SQLite commits the batch atomically while memory cache behavior stays unchanged.

Warmup source entries also preserve ETags returned by ADT, matching the published caching documentation and enabling conditional GETs after pre-warm.

### Key Files

| File | Role |
|------|------|
| `src/cache/cache.ts` | Cache interface; adds `transaction<T>()` |
| `src/cache/sqlite.ts` | SQLite cache implementation; maps `transaction()` to `better-sqlite3` |
| `src/cache/memory.ts` | Memory cache implementation; runs transaction callbacks inline |
| `src/cache/warmup.ts` | TADIR warmup pipeline; batches cache writes per parallel fetch batch |
| `tests/unit/cache/sqlite.test.ts` | SQLite transaction rollback coverage |
| `tests/unit/cache/memory.test.ts` | Memory transaction behavior coverage |
| `tests/unit/cache/warmup.test.ts` | Warmup batch transaction coverage |
| `docs_page/caching.md` | Published caching behavior documentation |

### Verified Live Evidence

2026-06-12 live read smoke after implementation, using `node ./dist/cli.js call SAPRead --json '{"type":"COMPONENTS"}' --output json` with credentials parsed from `/Users/marianzeis/DEV/arc-1/.env.infrastructure`:

- NW 7.50 NPL: HTTPS endpoint returned `SAP_BASIS=750`.
- S/4HANA 2023: HTTP endpoint returned `SAP_BASIS=758`, `S4FND=108`.
- ABAP Platform 2025: HTTP endpoint returned `SAP_BASIS=816`, `S4FND=109`.

The transaction change is release-invariant because it only changes local cache write grouping after SAP responses have already been fetched and parsed. The smoke verifies the built CLI still performs read-only ADT round trips on all configured SAP releases.

### Design Principles

1. Never keep a SQLite transaction open across SAP HTTP calls or dependency extraction.
2. Batch only synchronous cache writes, preserving the existing warmup concurrency of five SAP requests.
3. Keep the cache abstraction simple: one generic `transaction<T>()` primitive instead of special warmup-only batch methods.
4. Preserve memory-cache semantics and existing cache keys.
5. Preserve ADT ETags during warmup because the source read result already exposes them and the docs claim warmup stores them.

## Development Approach

Add the cache transaction primitive first, then update warmup to return write closures instead of writing inline during object indexing. This keeps failure handling straightforward: fetch/index failures still return per-object status, while a batch storage failure is logged and counted as failed for that batch.

Tests cover the new abstraction and the warmup behavior. SQLite gets a rollback test to prove `better-sqlite3` transactions are active. Memory gets an inline callback test. Warmup gets a fake ADT client that returns two TADIR entries in one batch and a tracking cache that asserts only one cache transaction is used.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Add cache transaction primitive

**Files:**
- Modify: `src/cache/cache.ts`
- Modify: `src/cache/sqlite.ts`
- Modify: `src/cache/memory.ts`
- Modify: `tests/unit/cache/sqlite.test.ts`
- Modify: `tests/unit/cache/memory.test.ts`

Expose one transaction primitive that both cache implementations support.

- [x] Add `transaction<T>(fn: () => T): T` to the `Cache` interface.
- [x] Implement `SqliteCache.transaction()` with `this.db.transaction(fn)()`.
- [x] Implement `MemoryCache.transaction()` by running the callback inline.
- [x] Add SQLite rollback coverage for a throwing transaction callback.
- [x] Add memory-cache coverage that the callback result is returned and writes persist.

### Task 2: Batch warmup writes per parallel fetch batch

**Files:**
- Modify: `src/cache/warmup.ts`
- Create: `tests/unit/cache/warmup.test.ts`
- Modify: `docs_page/caching.md`

Refactor warmup so SAP I/O remains outside transactions and cache writes are committed per batch.

- [x] Introduce `WarmupIndexResult` with optional write closure.
- [x] Change CLAS/INTF indexing to compute source hash, node metadata, dependency edges, and an eventual cache write closure.
- [x] Change function-group indexing to collect mapping/source/node/edge writes for each function module.
- [x] Add `applyWarmupWrites()` to execute all result write closures inside one `cache.transaction()` call per warmup batch.
- [x] Preserve ADT ETags when warmup stores CLAS, INTF, and FUNC source entries.
- [x] Add a warmup unit test proving two fetched objects in one batch are stored in one cache transaction.
- [x] Update caching docs to state that writes from each parallel fetch batch are committed in one cache transaction.
- [x] Run focused cache tests: `npm test -- tests/unit/cache/sqlite.test.ts tests/unit/cache/memory.test.ts tests/unit/cache/warmup.test.ts`.

### Task 3: Final verification

- [x] Run full test suite: `npm test` - all tests pass.
- [x] Run typecheck: `npm run typecheck` - no errors.
- [x] Run lint: `npm run lint` - no errors.
- [x] Run build: `npm run build` - no errors.
- [x] Live SAP read-only smoke on 7.50 via HTTPS: `SAPRead COMPONENTS` returned `SAP_BASIS=750`.
- [x] Live SAP read-only smoke on 2023 via HTTP: `SAPRead COMPONENTS` returned `SAP_BASIS=758`.
- [x] Live SAP read-only smoke on 2025 via HTTP: `SAPRead COMPONENTS` returned `SAP_BASIS=816`.
