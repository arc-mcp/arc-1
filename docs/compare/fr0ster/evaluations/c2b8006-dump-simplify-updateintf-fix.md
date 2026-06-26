# Simplify Dump Reading + Fix UpdateInterface on BTP Cloud

> **Priority**: Medium
> **Source**: fr0ster v6.0.0 — commit c2b8006 (2026-04-16), issues #61, #62
> **ARC-1 components**: `src/adt/diagnostics.ts`, `src/adt/crud.ts`, `src/handlers/intent.ts`

## What fr0ster did

**BREAKING CHANGE** — v5.2.0 → v6.0.0 (14 files, +93/-362 lines)

### 1. Removed RuntimeListDumps tool

Consolidated dump listing into `RuntimeListFeeds(feed_type='dumps')`. The separate `RuntimeListDumps` tool (with `inlinecount`, `skip`, `orderby` params) is gone. Compact handler `HandlerDumpList` now delegates to `RuntimeListFeeds` with `user`, `max_results`, `from`, `to` params.

### 2. Removed datetime+user lookup from RuntimeGetDumpById

The ±60-second fuzzy matching added in v4.8.0 (commit 459f961) has been removed. `RuntimeGetDumpById` now accepts only `dump_id`. The `datetime` and `user` parameters, along with the `resolveDumpId()` function and timezone handling code, are all deleted (~90 lines removed).

**Root cause** (issue #62): Timezone inconsistencies between ADT feed display and dump search. The ±60s client-side window often missed dumps. Even trying multiple datetime formats failed. The feature was fundamentally broken.

### 3. Fixed UpdateInterface missing transportRequest on BTP Cloud

Issue #61: `UpdateInterface` didn't pass `transportRequest` to the ADT endpoint. On BTP Cloud (where transport is mandatory), this caused "Parameter corrNr could not be found". The fix adds `transportRequest` to the interface update call, matching how `UpdateClass` already worked.

## ARC-1 current state

### Dump reading
`src/adt/diagnostics.ts`:
- `listDumps(options?)` — Atom feed parsing with optional `user` and `maxResults` filters
- `getDump(dumpId)` — requires dump ID (XML metadata + formatted text, parallel fetch)

ARC-1 never implemented datetime+user lookup. The `listDumps → getDump(id)` flow works correctly.

### Interface update with transport
`src/adt/crud.ts`:
```typescript
// Line 156 — safeUpdateSource()
const effectiveTransport = transport ?? (lock.corrNr || undefined);
```

ARC-1's centralized CRUD pattern:
1. `safeUpdateSource()` / `safeUpdateObject()` handle ALL object types (PROG, CLAS, INTF, DDLS, etc.)
2. Transport is always resolved: explicit `transport` param OR `lock.corrNr` from lock response
3. INTF updates go through the exact same code path as CLAS updates

fr0ster's bug was caused by per-handler transport wiring — `UpdateInterface` was missing what `UpdateClass` had. ARC-1's centralized approach prevents this entire bug class.

## Assessment

### Dump simplification — validates ARC-1's defer decision

In our evaluation of commit 459f961 (2026-04-02), we wrote:
> "The datetime+user lookup adds complexity for marginal gain. ARC-1's existing dump flow (list → get by ID) is sufficient."
> Decision: **Defer**

fr0ster proved this correct by removing the feature 2 weeks later due to timezone bugs. ARC-1's simpler `listDumps() → getDump(id)` design was the right call.

**One minor gap**: fr0ster's `from`/`to` time filters on dump listing could be useful on busy systems. ARC-1's `listDumps` only supports `user` and `maxResults`. Low priority to add.

### UpdateInterface fix — ARC-1 is not affected

ARC-1's centralized `safeUpdateSource()` in `crud.ts` handles transport for all types uniformly. The `effectiveTransport = transport ?? (lock.corrNr || undefined)` pattern on lines 156 and 179 ensures transport is always passed when available, regardless of object type.

**Verify**: Run INTF update on BTP Cloud integration test to confirm. Expected: already works.

### Secondary insight — LLM tool confusion

Issue #62 mentions the LLM tried `GetTableContents(SNAP)` and `GetSqlQuery` instead of `RuntimeGetDumpById`. With 316+ tools, the LLM can't reliably pick the right one. ARC-1's 11 intent-based tools avoid this entirely — `SAPDiagnose` with `action: "dumps"` is unambiguous.

## Decision

**verify** — Confirm ARC-1's INTF update works on BTP Cloud (likely already fine due to centralized CRUD). No implementation needed. The dump API simplification validates our existing design.

**Updated evaluations**: This supersedes `459f961-dump-datetime-lookup.md` — the datetime+user feature we deferred has been removed by its own author.
