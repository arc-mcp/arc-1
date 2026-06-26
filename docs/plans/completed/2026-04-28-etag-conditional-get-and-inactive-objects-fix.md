# ETag Conditional GET + Inactive Objects + Version Parameter

## Overview

Fixes [GitHub issue #183](https://github.com/arc-mcp/arc-1/issues/183) (stale source after external edits) AND closes the adjacent UX gap where ARC-1 silently hides the developer's unactivated drafts. Three integrated changes:

**1. HTTP-standard `If-None-Match` conditional GET** on the source-fetching code path. Each cached source carries the SAP-emitted `etag`; every read sends `If-None-Match: <etag>`; server returns 304 Not Modified (~50 bytes) if unchanged or 200 with new body+etag if anything changed. No TTL, no clock dependency, no system-type detection. Verified live on a4h (S/4HANA 2023) and NPL (NW 7.50 SP02) — both emit ETag, both honour `If-None-Match` → 304. SAP Notes 1760222 (2012), 1814370 (2013), 1940316 (2013) confirm the server-side mechanism predates SAP_BASIS 7.50. Closes #183's reproducer.

**2. Inactive-objects listing improvement**. ARC-1 already falls back from `/activation/inactive` to `/activation/inactiveobjects` (`src/adt/client.ts:464-478`) so the listing *works* on modern systems. This plan: skip the wasted 404 roundtrip, request the vendor MIME (`application/vnd.sap.adt.inactivectsobjects.v1+xml`) to get the rich `<ioc:object>` shape with `user`/`deleted`/`transport` metadata, extend the parser to handle BOTH shapes (rich + flat — flat fixture preserved as NW 7.50 + legacy regression coverage).

**3. `version` parameter on SAPRead** (`active`/`inactive`/`auto`, default `active`) plus inactive-draft awareness. Closes the silent "Claude doesn't see my Eclipse edits" UX gap that #183 doesn't address. The default preserves existing behaviour. When the developer has an unactivated draft on a read object, the response prepends a one-line warning so the LLM knows about the gap and can re-read with `version='inactive'` if appropriate. The `auto` mode resolves client-side via the cached inactive-objects list — "give me my view" semantics matching Eclipse's `SwitchActiveInactiveHandler`. Live-verified on a4h with ZC_FbClubTP (active etag `...001`, inactive etag `...000`); the per-version cache key is structurally correct because the server-side `cl_adt_utility=>calculate_etag_base()` encodes the version into the trailing 3 digits of the etag.

Task 1 is the standalone PR 1 (small, low-risk path/Accept/parser improvement). Tasks 2-7 build the conditional-GET pipeline. Task 8 adds the version parameter + inactive-list session cache + warning prepending — all wired together at the handler level so they form one coherent UX. Tasks 9-11 cover tests, docs, and verification.

## Context

### Current State

**Inactive endpoint (wasted roundtrip + missing rich data):**
- `src/adt/client.ts:464-478` already has a fallback: it tries `/sap/bc/adt/activation/inactive` first, catches the 404, then retries `/sap/bc/adt/activation/inactiveobjects`. The endpoint listing therefore *works* on modern systems via this fallback — the diagnosis in earlier drafts of this plan ("404s on every system newer than 7.40") was wrong. What the current code actually does is waste one 404 roundtrip on every list call against any system newer than ~7.40.
- Both attempts use `Accept: application/xml`, which causes the server to return the flat `<adtcore:objectReferences>` shape — a list of object URIs/names with no metadata. Live verification confirmed the same endpoint returns the rich `<ioc:inactiveObjects>` shape (with `ioc:user`, `ioc:deleted`, sibling `<ioc:transport><ioc:ref>` for transport context) when the request specifies `Accept: application/vnd.sap.adt.inactivectsobjects.v1+xml`. The vendor MIME is content-negotiated and works on both S/4HANA 2023 and NW 7.50 SP02.
- `src/adt/xml-parser.ts:1035-1055` (`parseInactiveObjects`) only handles the flat `<adtcore:objectReference>` shape. It silently returns an empty list when given the rich ioc shape — so even if the client switched to vendor MIME, the parser would discard the new fields.
- `src/handlers/intent.ts:1235-1249` catches a 404 and returns *"Inactive objects listing is not available on this SAP system"* — only triggered if BOTH endpoint paths fail, which is rare in practice. The message is misleading rather than always-firing.
- The fixture at `tests/fixtures/xml/inactive-objects.xml` is in the flat shape (same shape NW 7.50 returns when given the generic Accept). It is not "fictional" — keep it as the legacy/flat-shape coverage. The plan adds a NEW fixture for the rich ioc shape.

**Cache freshness (the issue #183 reproducer):**
- `CachedSource` schema in `src/cache/cache.ts:62-69` has `cachedAt` but no `etag` field. `Cache.putSource` and `Cache.getSource` accept only `(objectType, objectName)` — no `version` dimension.
- `MemoryCache` and `SqliteCache` both store source forever once written. No TTL check, no etag round-trip, no conditional GET. `cached_at` column in SQLite is written but never read back.
- `CachingLayer.getSource` at `src/cache/caching-layer.ts:62-77` always returns cached source on hit without revalidation. `invalidate` is called only from write paths in `intent.ts` (12 sites). External activations done in SE80/Eclipse leave the cache stale forever within the session (and forever in the SQLite file for `http-streamable` deployments).
- The ADT source-fetching methods (`getProgram`, `getClass`, `getInterface`, `getFunction`, `getInclude`, `getDdls`, `getDcl`, `getBdef`, `getSrvd`, `getDdlx`, `getFunctionGroupSource` in `src/adt/client.ts:113-310`) all return `Promise<string>` — they do not expose etag or accept `If-None-Match`.
- Live probe on a4h confirmed every source-bearing endpoint emits `etag` and `last-modified` headers and honors `If-None-Match` with HTTP 304. The mechanism is unused on the client side today.

**Documentation alignment:**
- `README.md:50-57` describes "Built-in Object Caching" and links to `docs/caching.md`. That file does not exist — broken link.
- `CLAUDE.md` "Architecture: Request Flow" section mentions CSRF, content negotiation, cookies, etc., but says nothing about ETag/`If-None-Match`.
- `docs/compare/00-feature-matrix.md:182` row "Inactive objects list" shows ARC-1 with ✅ — false positive given the path bug.
- The user-facing skill `.claude/commands/implement-feature.md:163` recommends `SAPRead(type='INACTIVE_OBJECTS')` as a remediation hint after RAP activation failures. The recommendation is correct but the command currently never returns anything useful — fixed by Task 1.

### Target State

**Task 1 (standalone PR 1):**
- `getInactiveObjects()` calls `/sap/bc/adt/activation/inactiveobjects` directly (no leading 404) with `Accept: application/vnd.sap.adt.inactivectsobjects.v1+xml`, getting the rich `<ioc:inactiveObjects>` shape.
- `parseInactiveObjects` handles both the rich `<ioc:object><ioc:ref>` shape (new code path) and the existing flat `<adtcore:objectReference>` shape (preserved for NW 7.50 + legacy systems and existing fixture coverage).
- `InactiveObject` interface gains optional `user`, `deleted`, and `transport` fields populated from the `ioc:` attributes when present.
- The "not available on this SAP system" message at intent.ts:1242 is removed (it was misleading and only ever fired in genuine total-failure cases).

**Tasks 2-7 (conditional GET pipeline):**
- ETag plumbed through Cache types, both backends, ADT client (16 source-fetching methods), CachingLayer with 404-invalidation and `'all'` write-invalidation.
- `handleSAPRead`'s `cachedGet` helper drives the conditional-GET flow.
- Source reads emit `[cached:revalidated]` on hit; plain `[cached]` reserved for dep-graph hits.

**Task 8 (version parameter + inactive-draft awareness):**
- `SAPRead` schema accepts `version: 'active' | 'inactive' | 'auto'` (default `'active'`).
- A session-cached **inactive-list** (per-username for PP mode) backs both the warning-prepending logic AND the `auto`-resolution path. Refreshed on write/activate, plus a 60-second TTL for catching external Eclipse activations mid-session.
- Read paths:
  - **`version='active'` (default)**: cache hit → conditional GET → 304/200. **If the object is in the user's inactive list, the response is prefixed with a one-line note**: *"You have an unactivated draft of this object. The source below is the LAST ACTIVATED version. To work with your draft, activate it first or re-run with version='inactive'."* This is the fix for the silent "Claude doesn't see my edits" case.
  - **`version='inactive'`**: fetches the user's draft. If no draft exists (object not in list), the server falls back to active source — ARC-1 detects this client-side and prefixes the response: *"No inactive draft exists for this object. Returning active version."* Honest signal.
  - **`version='auto'`**: handler checks the inactive list; if object is present, resolves to `inactive`; otherwise resolves to `active`. The cache key always reflects the resolved version. No warning is prefixed in this mode (the user explicitly opted in to "show me my view").
- `SAPManage(action='cache_stats')` extended to surface the inactive-list state (size, last refresh).
- Hyperfocused mode's wrapped `SAPRead` exposes the same `version` parameter.

**Tasks 2-7 (conditional GET pipeline) — additional design notes:**
- Each `CachedSource` carries the etag returned by SAP. Cache is keyed by `(type, name, version)` so active and inactive views never collide.
- Every cached source-read path sends `If-None-Match: <etag>`. On 304: return cached body, refresh `cachedAt`, do not call any further parsing. On 200 with new etag: replace cache, return fresh body. On 200 with no etag (graceful fallback for objects whose handlers don't emit one): store body without etag, next read fetches plain.
- The `[cached:revalidated]` indicator on source reads marks server-validated cache hits (304). Plain `[cached]` is reserved for dep-graph hits in `compressor.ts` (hash-keyed; naturally correct without server validation). Source reads never emit unprefixed `[cached]` post-PR.
- Cache works the same on SAP_BASIS 7.50 SP02 and S/4HANA 2023 — the ETag mechanism predates 7.50 (notes 1760222 from 2012, 1814370 from 2013).
- `README.md` mentions the conditional-GET model. `CLAUDE.md` Request Flow describes the ETag round-trip. `docs/caching.md` exists and documents the caching architecture (fixes the broken link).

### Key Files

| File | Role |
|------|------|
| `src/adt/client.ts` | `getInactiveObjects()` URL + Accept header (Task 1); source-fetching methods plumb etag through `opts.ifNoneMatch` and return `{ source, etag, notModified, statusCode }` (Task 5) |
| `src/adt/xml-parser.ts` | `parseInactiveObjects()` updated to handle real server shape + legacy shape (Task 1) |
| `src/adt/types.ts` | `InactiveObject` interface gains optional fields (Task 1); `CachedSource` referenced from cache types |
| `src/handlers/intent.ts` | Remove 404 fallback for INACTIVE_OBJECTS (Task 1); update `cachedGet` helper to use conditional-GET-aware path (Task 7); add `version` parameter handling, inactive-list session cache, warning prefix logic (Task 8); switch SAPWrite invalidation calls to `'all'` (Task 6) |
| `src/handlers/schemas.ts` | Extend SAPRead schema with `version: 'active' \| 'inactive' \| 'auto'`, default `'active'` (Task 8) |
| `src/handlers/tools.ts` | Document the `version` parameter in the SAPRead tool description (Task 8) |
| `src/handlers/hyperfocused.ts` | Mirror the `version` parameter exposure on the wrapped SAPRead operation (Task 8) |
| `src/cache/inactive-list-cache.ts` | New file — per-username inactive-objects list cache with TTL + invalidation triggers (Task 8) |
| `src/cache/cache.ts` | `CachedSource` gains `etag` and `version` fields; `Cache` interface methods accept `version` (Task 2) |
| `src/cache/memory.ts` | Multi-version Map keying, store/return etag (Task 3) |
| `src/cache/sqlite.ts` | Schema migration: `etag` and `version` columns, recreate cache_key derivation (Task 4) |
| `src/cache/caching-layer.ts` | `getSource()` invokes fetcher with `ifNoneMatch`, handles 304 vs 200 vs no-etag (Task 6) |
| `tests/fixtures/xml/inactive-objects.xml` | Preserve as flat-shape regression fixture for NW 7.50 + legacy systems (Task 1 — do not modify) |
| `tests/fixtures/xml/inactive-objects-ioc.xml` | New fixture for the rich `<ioc:object><ioc:ref>` shape (Task 1) |
| `tests/unit/adt/xml-parser.test.ts` | Update `parseInactiveObjects` tests for both shapes (Task 1) |
| `tests/unit/adt/client.test.ts` | Update `getInactiveObjects` URL assertion (Task 1); add etag round-trip tests for source methods (Task 5) |
| `tests/unit/cache/memory.test.ts` | Etag + version round-trip tests (Task 3) |
| `tests/unit/cache/sqlite.test.ts` | Etag + version round-trip + schema migration tests (Task 4) |
| `tests/unit/cache/caching-layer.test.ts` | Conditional GET flow tests: 304-hit, 200-replace, no-etag-fallback (Task 6) |
| `tests/integration/cache.integration.test.ts` | Live a4h test: read object twice, assert second read uses 304; inactive-list cache + version-parameter integration tests (Task 9) |
| `tests/e2e/cache.e2e.test.ts` | E2E: SAPRead twice, assert `[cached:revalidated]` indicator and conditional-GET correctness; SAPRead INACTIVE_OBJECTS returns valid list; version-parameter end-to-end (Task 9) |
| `tests/unit/cache/inactive-list-cache.test.ts` | Unit tests for the per-username inactive-list session cache (Task 8) |
| `README.md` | Update "Built-in Object Caching" section to mention conditional GET + version parameter + inactive-draft awareness (Task 10) |
| `CLAUDE.md` | Update Architecture: Request Flow + Key Files for Common Tasks table (Task 10) |
| `docs/caching.md` | New file — architecture doc that fixes the broken README link, includes "Considered alternatives" section (Task 10) |

### Design Principles

1. **HTTP-standard mechanism, no SAP-specific gates.** The fix uses `If-None-Match` and the server's `etag` header — defined in `IF_HTTP_HEADER_FIELDS` in the SAP HTTP framework, independent of release. No `SAP_BASIS` version checks, no system-type branching. Verified live on a4h and confirmed by SAP Notes 1760222 (2012-09-06) and 1814370 (2013-05-24) to predate SAP_BASIS 7.50.

2. **Server is source of truth for freshness.** No TTL, no clock comparison, no internal "stale window." On every cache read the server validates via 304/200. The cache never gambles.

3. **Opportunistic, not required.** Some specific resource handlers historically had ETag emission bugs (notes 1915257, 2641168). The implementation falls back to a plain GET when the response carries no `etag` header — never errors, just stores body without a validator. Next read on that same object does a plain re-fetch.

4. **Cache key is `(type, name, version)`.** ETag includes a version discriminator (`001` active, `000` inactive) per `cl_adt_utility=>calculate_etag_base` on the server. Sending an active ETag against an inactive request is a guaranteed mismatch; cache must key both dimensions to avoid wasted misses. The version axis is also user-facing on SAPRead (Task 8) — the same value flows through to the cache key, so the surface and the cache layer share one source of truth.

5. **Inactive endpoint is a real fix.** Don't paper over the 404 with a fallback message. The endpoint exists and works; ARC-1 calls the wrong path. Same applies to the parser: don't reject the real response shape silently — accept both real and legacy forms defensively.

6. **`version` parameter default preserves existing behaviour.** The new `version` field on SAPRead defaults to `'active'`, so every existing caller and existing SAPRead invocation continues to work identically. The parameter is opt-in for power users (read your draft) and for LLM-driven flows that received the inactive-draft warning. `'auto'` exists for callers that want "show me my view" semantics (mirrors Eclipse's default behaviour) but is not the schema default — too magic for newcomers; explicit is better than implicit.

7. **Inactive-list cache is per-username, lazy, TTL'd at 60s.** With Principal Propagation each user sees only their own drafts. With shared service account everyone sees the same drafts. The list is fetched lazily on first source read of a session (cost: ~415ms one-time per user, verified live), refreshed on any SAPWrite/SAPActivate (which mutates the user's drafts), and falls back to a 60-second TTL to catch external Eclipse activations done mid-session. The list is stored in-memory only — never persisted to the SQLite cache file — because it is small (KB to ~120 KB), per-user, and inexpensive to re-fetch.

8. **Warnings are prefixed, not embedded.** When the response carries a draft-awareness warning, it is prepended as a separate paragraph BEFORE the `[cached:revalidated]` indicator (if any) and before the source body. This keeps existing `[cached:revalidated]` regex assertions working and gives the LLM clear "warning then content" structure. Warnings only fire when reading `version='active'` AND a draft exists; reading `version='inactive'` against an object with no draft fires its own (different) note.

9. **Cache is rebuildable; migration is destructive.** When SqliteCache encounters a pre-migration schema (no `etag` or `version` column), drop the `sources` table and recreate. The cache is a performance optimization, never authoritative; users lose at most one re-fetch worth of latency.

## Development Approach

Tasks 1 and 2 are foundation work — Task 1 is fully independent (PR 1) and Task 2 only adds types/interface declarations without behaviour changes. Tasks 3 and 4 implement those interfaces in the two cache backends; they can be done in either order. Task 5 widens the ADT client method signatures and is the largest single task; it must come before Task 6 (which uses those signatures) and Task 7 (which depends on the new fetcher contract via the caching layer). Task 8 adds the version-parameter UX (schema + handler + inactive-list cache + draft warnings) — depends on Tasks 5/6/7 having landed. Tasks 9-10 add integration/E2E tests and documentation. Task 11 is final verification.

Each task's checklist is self-contained — every task references the file paths, line numbers, function names, and patterns the agent needs. Each code-changing task includes a final `npm test` checkbox. Integration-touching tasks reference `INFRASTRUCTURE.md` for the live test system credentials.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run test:integration` (when SAP credentials are configured per `INFRASTRUCTURE.md`)
- `npm run test:e2e` (when an MCP server is running, see `docs/setup-guide.md`)

---

### Task 1: Fix `/activation/inactiveobjects` endpoint URL, parser, and handler

**Files:**
- Modify: `src/adt/client.ts`
- Modify: `src/adt/xml-parser.ts`
- Modify: `src/adt/types.ts`
- Modify: `src/handlers/intent.ts`
- Modify: `tests/fixtures/xml/inactive-objects.xml`
- Modify: `tests/unit/adt/xml-parser.test.ts`
- Modify: `tests/unit/adt/client.test.ts`

ARC-1's `getInactiveObjects()` at `src/adt/client.ts:464-478` already has a fallback from `/sap/bc/adt/activation/inactive` to `/sap/bc/adt/activation/inactiveobjects` (catches 404, retries). The fallback works correctly on modern systems but wastes one 404 roundtrip per call. Both attempts use `Accept: application/xml` which returns the flat `<adtcore:objectReferences>` shape — missing the rich user/transport/deleted metadata that the same endpoint returns when given `Accept: application/vnd.sap.adt.inactivectsobjects.v1+xml`. The parser at `src/adt/xml-parser.ts:1035-1055` only handles the flat shape, so even with vendor Accept the rich data would be discarded. This task: (1) call `/inactiveobjects` directly without the leading 404, (2) request the vendor MIME, (3) extend the parser to handle BOTH the rich ioc shape and the existing flat shape (preserve the existing fixture for NW 7.50 + legacy coverage; add a new fixture for the rich shape).

- [ ] In `src/adt/client.ts:464-478`, replace the entire `getInactiveObjects()` body with a single direct call: `const resp = await this.http.get('/sap/bc/adt/activation/inactiveobjects', { Accept: 'application/vnd.sap.adt.inactivectsobjects.v1+xml, application/xml;q=0.5' });`. The dual Accept header lets older systems that ignore the vendor MIME fall through to `application/xml`. Drop the try/catch fallback — `/inactiveobjects` works on every release ARC-1 supports (verified live on S/4HANA 2023 and NW 7.50 SP02).
- [ ] In `src/adt/types.ts:714-720`, extend the `InactiveObject` interface with optional fields: `user?: string` (from `ioc:user` on `<ioc:object>`), `deleted?: boolean` (from `ioc:deleted` on `<ioc:object>`), `transport?: string` (from `adtcore:name` on the sibling `<ioc:transport><ioc:ref>` element when `ioc:linked="true"`), and `parentTransport?: string` (from `adtcore:parentUri` when present). Existing fields (`name`, `type`, `uri`, `description?`) stay as-is.
- [ ] In `src/adt/xml-parser.ts`, extend `parseInactiveObjects` (line ~1036). The new implementation must handle BOTH shapes:
  - **Rich ioc shape** (new code path): walk all top-level `<entry>` elements (after XML parsing strips the `ioc:` namespace prefix), find each `<object>` child with a nested `<ref>` element. Skip entries whose only child is `<transport>` (those represent transport requests with no source object). Capture `name` (from `@_name`), `type` (from `@_type`), `uri` (from `@_uri`), `description` (from `@_description` if present), `user` (from `<object>`'s `@_user`), `deleted` (parse `<object>`'s `@_deleted` as boolean: true iff string equals `'true'`), `transport` (from sibling `<transport><ref>`'s `@_name`), `parentTransport` (from sibling `<transport><ref>`'s `@_parentUri`).
  - **Flat shape** (existing code path): walk `<entry><object><objectReference>` elements (or top-level `<objectReference>` for the very-old shape). Capture only `name`, `type`, `uri`, `description` — the flat shape doesn't have user/deleted/transport metadata. This branch is what NW 7.50 returns when given `application/xml`, and what `tests/fixtures/xml/inactive-objects.xml` contains.
  - Detection rule: if the parsed XML has any `<object>` element with a nested `<ref>` (not `<objectReference>`), use the rich path. Otherwise fall through to the flat path. Both paths can coexist in the same parser without ordering ambiguity.
  - Return `[]` for empty/whitespace-only XML (existing behaviour; preserve).
- [ ] **Keep the existing fixture** `tests/fixtures/xml/inactive-objects.xml` as-is. It's the flat-shape coverage that NW 7.50 emits with generic Accept and serves as legacy-system regression coverage. Do not modify or replace it.
- [ ] Create a new fixture `tests/fixtures/xml/inactive-objects-ioc.xml` with the rich ioc shape captured live from a4h:
  ```xml
  <?xml version="1.0" encoding="utf-8"?>
  <ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects">
    <ioc:entry>
      <ioc:object/>
      <ioc:transport ioc:user="MARIAN" ioc:linked="false">
        <ioc:ref adtcore:uri="/sap/bc/adt/cts/transportrequests/A4HK901086" adtcore:type="/RQ" adtcore:name="A4HK901086" adtcore:description="Test transport" xmlns:adtcore="http://www.sap.com/adt/core"/>
      </ioc:transport>
    </ioc:entry>
    <ioc:entry>
      <ioc:object ioc:user="MARIAN" ioc:deleted="false">
        <ioc:ref adtcore:uri="/sap/bc/adt/bo/behaviordefinitions/zc_fbclubtp" adtcore:type="BDEF/BDO" adtcore:name="ZC_FbClubTP" xmlns:adtcore="http://www.sap.com/adt/core"/>
      </ioc:object>
      <ioc:transport ioc:user="MARIAN" ioc:linked="true">
        <ioc:ref adtcore:uri="/sap/bc/adt/cts/transportrequests/A4HK901087" adtcore:type="/RQ" adtcore:name="A4HK901087" adtcore:parentUri="/sap/bc/adt/cts/transportrequests/A4HK901086" xmlns:adtcore="http://www.sap.com/adt/core"/>
      </ioc:transport>
    </ioc:entry>
    <ioc:entry>
      <ioc:object ioc:user="MARIAN" ioc:deleted="false">
        <ioc:ref adtcore:uri="/sap/bc/adt/ddic/ddl/sources/zarc1_test" adtcore:type="DDLS/DF" adtcore:name="ZARC1_TEST" adtcore:description="Test CDS" xmlns:adtcore="http://www.sap.com/adt/core"/>
      </ioc:object>
    </ioc:entry>
  </ioc:inactiveObjects>
  ```
- [ ] In `tests/unit/adt/xml-parser.test.ts:995-1029`, **keep the existing tests for the flat shape** (they verify backwards-compat with NW 7.50 output and the legacy fixture). Add a new `it('parses rich ioc shape with user/deleted/transport metadata', ...)` test that loads `inactive-objects-ioc.xml`, asserts:
  - `objects` has length 2 (the transport-only entry is skipped).
  - First: `name='ZC_FbClubTP'`, `type='BDEF/BDO'`, `uri='/sap/bc/adt/bo/behaviordefinitions/zc_fbclubtp'`, `user='MARIAN'`, `deleted=false`, `transport='A4HK901087'`, `parentTransport='/sap/bc/adt/cts/transportrequests/A4HK901086'`. No `description`.
  - Second: `name='ZARC1_TEST'`, `type='DDLS/DF'`, `description='Test CDS'`, `user='MARIAN'`, `deleted=false`, no `transport`, no `parentTransport`.
- [ ] In `tests/unit/adt/client.test.ts:950-973`, update the `getInactiveObjects` test:
  - Change the mocked URL assertion: assert the fetch call URL is `/sap/bc/adt/activation/inactiveobjects` (no leading `/inactive` 404).
  - Update the mocked Accept header expectation to include `application/vnd.sap.adt.inactivectsobjects.v1+xml`.
  - Change the mocked response body to the rich `<ioc:object><ioc:ref>` shape.
  - Assert the parsed result includes the new fields (`user`, `deleted`, `transport`).
- [ ] In `src/handlers/intent.ts:1235-1249`, simplify the `INACTIVE_OBJECTS` case. Remove the `try/catch` with the "not available on this SAP system" 404 fallback. New body: `const objects = await client.getInactiveObjects(); return textResult(JSON.stringify({ count: objects.length, objects }, null, 2));`. Real 404s from genuinely unavailable systems will surface naturally as `AdtApiError` and be formatted by the existing error path.
- [ ] Run `npm test` — all tests must pass (existing flat-shape tests still pass + new rich-shape tests pass).

---

### Task 2: Extend `Cache` interface and `CachedSource` for `version` + `etag`

**Files:**
- Modify: `src/cache/cache.ts`

The cache currently keys source by `(type, name)`. To support conditional GET correctly, the key must include a version dimension (active vs inactive — different ETags per the server-side `cl_adt_utility=>calculate_etag_base` formula), and each entry must carry the etag for the next `If-None-Match` round-trip. This task extends the type definitions only — the two cache backends and the caching layer are updated in subsequent tasks.

- [ ] In `src/cache/cache.ts:62-69`, extend the `CachedSource` interface with two new fields: `version: 'active' | 'inactive'` (required, defaults to `'active'` at write sites) and `etag?: string` (optional, undefined when the server didn't return one).
- [ ] Update `Cache` interface methods at lines 113-116:
  - `putSource(objectType: string, objectName: string, source: string, opts?: { version?: 'active' | 'inactive'; etag?: string }): void`
  - `getSource(objectType: string, objectName: string, version?: 'active' | 'inactive'): CachedSource | null` (default version is `'active'`)
  - `invalidateSource(objectType: string, objectName: string, version?: 'active' | 'inactive' | 'all'): void`. Semantics: `'active'` (default) clears the active entry only — preserves existing behaviour for the 12 SAPWrite invalidate sites. `'inactive'` clears the inactive entry only — used by future inactive-aware code. `'all'` clears both — used by SAPWrite/SAPActivate paths so that activating a draft invalidates BOTH the old active body AND the now-consumed inactive draft. Activate consumes the inactive version (it becomes the new active), so leaving a stale inactive entry in cache is wrong. Invalidating with `'all'` is the correct symmetric default for write paths.
- [ ] Update the `sourceKey()` helper at lines 139-142 to take an optional version parameter: `export function sourceKey(objectType: string, objectName: string, version: 'active' | 'inactive' = 'active'): string { return `${objectType.toUpperCase()}:${objectName.toUpperCase()}:${version}`; }`. Existing callers that don't pass version get `'active'` by default — preserves keying for code that hasn't migrated yet, and the active/inactive split is a new dimension so no migration is needed for callers reading active.
- [ ] Run `npm run typecheck` — expect compile errors in `memory.ts`, `sqlite.ts`, and `caching-layer.ts` (those are intentionally fixed in Tasks 3-6).
- [ ] Run `npm test` — same expectation: this task changes types, the implementations are updated next. If `npm test` still passes (because the type errors are only surfaced by `tsc`, not vitest), that's fine.

---

### Task 3: Update `MemoryCache` for `version` + `etag`

**Files:**
- Modify: `src/cache/memory.ts`
- Modify: `tests/unit/cache/memory.test.ts`

`MemoryCache` stores sources in a `Map<string, CachedSource>`. With the new `(type, name, version)` key shape, the existing `sources.set(sourceKey(type, name), …)` calls need to pass the version through, and `putSource` / `getSource` / `invalidateSource` must accept the new optional parameters. The class otherwise stays simple — the in-memory representation does not need a schema migration.

- [ ] In `src/cache/memory.ts:95-112`, update the source cache methods:
  - `putSource(objectType, objectName, source, opts)`: include `opts.version ?? 'active'` in the key, and store `version` and `etag` (from `opts.etag`) in the `CachedSource` value.
  - `getSource(objectType, objectName, version)`: pass `version ?? 'active'` to `sourceKey()`. Return value already carries the `version` field if it was stored.
  - `invalidateSource(objectType, objectName, version)`: with `version` defaulting to `'active'`, delete that one key. With `version === 'inactive'`, delete only the inactive key. With `version === 'all'`, delete BOTH keys: `this.sources.delete(sourceKey(t, n, 'active')); this.sources.delete(sourceKey(t, n, 'inactive'));`.
- [ ] In `tests/unit/cache/memory.test.ts:98-118`, extend the `sources` describe block with new tests (~6 tests):
  - `stores and retrieves source with active version by default` — `putSource(type, name, body)` then `getSource(type, name)` returns the entry with `version='active'`.
  - `stores etag when provided` — `putSource(type, name, body, { etag: '20231201001' })` then `getSource` returns `etag: '20231201001'`.
  - `keeps active and inactive separate` — store body A under active, body B under inactive (via `{ version: 'inactive' }`), assert both return distinct entries.
  - `invalidateSource defaults to active version` — store both, invalidate without version arg, assert active is gone but inactive remains.
  - `invalidateSource with explicit 'inactive' clears that view only` — store both, `invalidateSource(type, name, 'inactive')`, assert inactive is gone but active remains.
  - `invalidateSource with 'all' clears both views` — store both, `invalidateSource(type, name, 'all')`, assert BOTH are gone (this is the SAPWrite/SAPActivate path).
- [ ] Run `npm test` — all MemoryCache tests pass.

---

### Task 4: Update `SqliteCache` schema for `version` + `etag` (with destructive migration)

**Files:**
- Modify: `src/cache/sqlite.ts`
- Modify: `tests/unit/cache/sqlite.test.ts`

`SqliteCache` writes a SQLite database file (default `.arc1-cache.db`) for `http-streamable` deployments. The `sources` table needs two new columns (`etag`, `version`) and the `cache_key` derivation must include the version. Existing cache files from previous ARC-1 versions don't have these columns — we handle this by detecting the missing column on startup and dropping/recreating the `sources` table only (keeping `nodes`, `edges`, `apis`, `dep_graphs`, `func_groups` intact). The cache is a performance optimization, not authoritative — a one-time loss of cached source bodies is acceptable.

- [ ] **Migration must run BEFORE `createTables()`** to avoid a chicken-and-egg failure: the new `idx_sources_objname_version` index references the new `version` column, so attempting to create the index against an old `sources` table without that column fails before migration can drop it. Reorder the constructor:
  ```typescript
  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.dropOldSourcesTableIfNeeded();  // 1. Drop sources table if old schema (must run first)
    this.createTables();                 // 2. Create all tables (sources gets recreated fresh)
  }
  ```
- [ ] Add a private helper `dropOldSourcesTableIfNeeded()`:
  ```typescript
  private dropOldSourcesTableIfNeeded(): void {
    // PRAGMA table_info returns empty array if the table doesn't exist (fresh install) — that's fine, createTables will create it.
    const cols = this.db.prepare("PRAGMA table_info('sources')").all() as Array<{ name: string }>;
    if (cols.length === 0) return;  // fresh install
    const hasEtag = cols.some((c) => c.name === 'etag');
    const hasVersion = cols.some((c) => c.name === 'version');
    if (!hasEtag || !hasVersion) {
      this.db.exec('DROP TABLE IF EXISTS sources;');
      // Note: we deliberately drop, not ALTER. Cache is rebuildable; a destructive migration is simpler than column-add + backfill.
    }
  }
  ```
  Other tables (`nodes`, `edges`, `apis`, `dep_graphs`, `func_groups`) are unaffected — they keep their data.
- [ ] Update `createTables()` at lines 25-84:
  - Change the `sources` CREATE TABLE statement to include `etag TEXT` and `version TEXT NOT NULL DEFAULT 'active'` columns (keep `cached_at TEXT NOT NULL` for stats).
  - The `cache_key` PRIMARY KEY stays — but its content now includes the version (constructed by `sourceKey()`).
  - Add an index `CREATE INDEX IF NOT EXISTS idx_sources_objname_version ON sources(object_name, object_type, version)` (used for invalidation by name+version when `cache_key` derivation changes are not desired). Because migration ran first, the index creation is now safe — the table either is fresh (this is the first start) or was just dropped+recreated.
- [ ] Update `putSource()` at lines 165-178 to accept `opts?: { version?: 'active' | 'inactive'; etag?: string }`. The INSERT statement now includes `etag` and `version` columns; `cache_key` is derived from `sourceKey(type, name, opts?.version ?? 'active')`.
- [ ] Update `getSource()` at lines 180-193 to accept optional `version`, derive the right `cache_key`, and return the `etag` and `version` fields in the returned `CachedSource`.
- [ ] Update `invalidateSource()` at lines 195-198 to accept optional `version: 'active' | 'inactive' | 'all'` (default `'active'`):
  - For `'active'` or `'inactive'`: derive the version-aware `cache_key` via `sourceKey(t, n, version)` and `DELETE FROM sources WHERE cache_key = ?`.
  - For `'all'`: drop the cache_key derivation and use `DELETE FROM sources WHERE object_type = ? AND object_name = ?` (the index `idx_sources_objname_version` covers this query). Both rows go in one statement.
- [ ] In `tests/unit/cache/sqlite.test.ts:104-122`, extend the source caching tests with the same six test cases as Task 3 (including the `'all'` case) — same assertions, just using `SqliteCache` instead of `MemoryCache`. Use `:memory:` for the test DB (existing pattern at line 22).
- [ ] Add a migration test (~1 test) using a fresh-old-schema setup pattern — DO NOT use `ALTER TABLE … DROP COLUMN`, which is brittle and only available on recent SQLite versions:
  ```typescript
  it('migrates an old sources table by dropping and recreating', () => {
    const dbPath = path.join(os.tmpdir(), `arc1-migrate-test-${Date.now()}.db`);
    // 1. Set up an OLD schema directly via better-sqlite3 (no SqliteCache), simulating a pre-PR cache file
    const rawDb = new Database(dbPath);
    rawDb.exec(`CREATE TABLE sources (cache_key TEXT PRIMARY KEY, object_type TEXT, object_name TEXT, source TEXT, hash TEXT, cached_at TEXT);`);
    rawDb.prepare('INSERT INTO sources VALUES (?,?,?,?,?,?)').run('PROG:Z_OLD', 'PROG', 'Z_OLD', 'REPORT.', 'h1', '2025-01-01');
    rawDb.close();
    // 2. Open via SqliteCache — migration should detect missing etag/version columns and drop+recreate
    const cache = new SqliteCache(dbPath);
    // 3. Assert the table now has both columns and the old row is gone (migration is destructive)
    const cols = (cache as any).db.prepare("PRAGMA table_info('sources')").all().map((c: any) => c.name);
    expect(cols).toContain('etag');
    expect(cols).toContain('version');
    expect(cache.getSource('PROG', 'Z_OLD')).toBeNull(); // old row was dropped
    cache.close();
    fs.unlinkSync(dbPath);
  });
  ```
  This setup creates an OLD-schema sources table directly, then verifies SqliteCache's constructor migrates it. No fragile `ALTER TABLE` involved.
- [ ] Run `npm test` — all SqliteCache tests pass.

---

### Task 5: Update ADT client source-fetching methods to accept `If-None-Match` and return etag

**Files:**
- Modify: `src/adt/client.ts`
- Modify: `tests/unit/adt/client.test.ts`

The source-fetching methods on `AdtClient` currently return `Promise<string>`. To enable the caching layer to do conditional GETs, each method must accept optional `opts.ifNoneMatch` (which becomes the `If-None-Match` request header) and return both the body and the ETag from the response, plus a flag indicating 304 Not Modified. The HTTP layer already returns `AdtResponse` with `headers` and `statusCode` — `handleResponse` at `src/adt/http.ts:653-684` lets 304 fall through (it's not `>= 400`), so 304 simply returns an `AdtResponse` with status 304 and empty body. No `http.ts` changes are needed.

This is the widest single task. The method signatures change but the existing callers in `intent.ts` are wrapped through the `cachedGet` helper (Task 7), so most tests can be updated once the new shape lands.

- [ ] Define a shared result type at the top of `src/adt/client.ts` (right under the imports): `export interface SourceReadResult { source: string; etag?: string; notModified: boolean; statusCode: number; }`.
- [ ] Define a shared options type: `export interface SourceReadOptions { ifNoneMatch?: string; version?: 'active' | 'inactive'; }`.
- [ ] Add a private helper `private async fetchSource(path: string, opts?: SourceReadOptions): Promise<SourceReadResult>` that:
  - Takes the path (already including `/source/main`), appends `?version=<active|inactive>` if `opts?.version` is set (and not already in the path).
  - Builds extra headers: when `opts?.ifNoneMatch` is set, adds `'If-None-Match': opts.ifNoneMatch`.
  - Calls `this.http.get(path, headers)` — note `http.get` already returns `AdtResponse`.
  - Returns `{ source: resp.body, etag: resp.headers['etag'] ?? undefined, notModified: resp.statusCode === 304, statusCode: resp.statusCode }`.
- [ ] Update each source-fetching method to accept `opts?: SourceReadOptions` and return `Promise<SourceReadResult>` instead of `Promise<string>`. The full set is **every method that goes through `cachedGet` in either `handleSAPRead` or `compressor.ts`** — verified by grep:
  - `getProgram(name, opts?)` (line 113) — PROG
  - `getInterface(name, opts?)` (line 209) — INTF
  - `getFunction(group, name, opts?)` (line 216) — FUNC
  - `getInclude(name, opts?)` (line 251) — INCL
  - `getDdls(name, opts?)` (line 258) — DDLS
  - `getDcl(name, opts?)` (line 265) — DCLS
  - `getBdef(name, opts?)` (line 272) — BDEF
  - `getSrvd(name, opts?)` (line 279) — SRVD
  - `getDdlx(name, opts?)` (line 297) — DDLX
  - `getFunctionGroupSource(name, opts?)` (line 244) — used by FUGR with `expand_includes`.
  - `getKtd(name, opts?)` (line ~286) — SKTD. This method already uses a custom `Accept: application/vnd.sap.adt.sktdv2+xml` header. Extend `fetchSource(path, opts)` to take an `opts.accept?: string` field that overrides the default Accept; pass the SKTD MIME through.
  - `getSrvb(name, opts?)` (line 304) — SRVB. Custom Accept (`application/vnd.sap.adt.businessservices.servicebinding.v2+xml`). The method calls `parseServiceBinding(resp.body)` to convert XML → JSON-stringified metadata. The etag still validates the underlying server resource regardless of parsing. Return `{ source: parseServiceBinding(resp.body), etag, notModified, statusCode }`. On 304, `parseServiceBinding` is not called (no body to parse) — the caller (CachingLayer) returns the cached parsed JSON.
  - `getTable(name, opts?)`, `getView(name, opts?)`, `getStructure(name, opts?)` — TABL, VIEW, STRU. Each uses a specific Accept header for DDIC metadata (verified live: `application/vnd.sap.adt.tables.v2+xml` etc. emit etag). Same pattern as `getKtd`/`getSrvb`: pass the per-type Accept through `opts.accept`.
  - `getClass(name, include?, opts?)` (line 120) — **special case**: multi-include logic. Plumb opts through to the `/source/main` call only (the default `!include` branch at line 124-128 and the `inc === 'main'` branch at line 147). The other includes don't need conditional-GET support (cache layer doesn't track them — see `src/handlers/intent.ts:1292-1297` which only caches the no-include CLAS path). For the multi-include path, return `{ source: parts.join('\n\n'), notModified: false, statusCode: 200, etag: undefined }`.

  For each method, replace the existing `const resp = await this.http.get(...); return resp.body;` body with a `fetchSource` call that forwards the `opts`. For methods with custom Accept headers, pass the header through `opts.accept`. For methods that parse the response (getSrvb), apply the parser only when `result.notModified === false` — `SourceReadResult.source` becomes the parsed string for those types.
- [ ] **Audit ALL caller sites first** — these methods are called from more than just `handleSAPRead`. Run this before editing:
  ```
  grep -rnE 'client\.(getProgram|getClass|getInterface|getFunction|getInclude|getDdls|getDcl|getBdef|getSrvd|getDdlx|getFunctionGroupSource)\(' src/
  ```
  Expected sites (verified during plan research):
  - `src/handlers/intent.ts` — many sites in `handleSAPRead` (around lines 1264-1360 — go through the `cachedGet` helper which is rewritten in Task 7) PLUS direct `cachingLayer.getSource(...)` call sites at lines 2932 (CLAS), 3020 (BDEF), 4745 (compressor-style fetch). All of these must unwrap `.source` and forward `ifNoneMatch` correctly.
  - `src/context/compressor.ts` — 8 sites: lines 235 (CLAS), 237 (INTF), 243 (FUNC), 256+263 (bare FUNC fallback), 271 (CLAS), 273 (INTF), 433 (DDLS), 440 (TABL), 447 (STRU). The lines wrapped in `cachedGet(...)` (all except 256+263) need the same fetcher signature update as Task 7's handler. The bare `client.getFunction(match[1], name)` at lines 256 and 263 must just unwrap `.source`. **Lines 440 (`client.getTable`) and 447 (`client.getStructure`) confirm Task 5 must extend the wide refactor to `getTable`/`getStructure` (and `getView` and `getKtd`/`getSrvb` for handler symmetry) — not just the original 11 ABAP-source methods.**
  - `src/cache/warmup.ts` — 3 source-fetching sites: lines 225 (`getClass`), 227 (`getInterface`), 298 (`getFunction`). Warmup is a first-time pre-population path — no benefit from conditional GET (cache is empty). These callers just need `.source` unwrapping. Pass through `opts: { ifNoneMatch: cached?.etag }` if a cached entry already exists (warmup at line 236 / 299 already does a `getCachedSource` lookup before fetching) — this lets re-running warmup against an unchanged system skip body transfers.
- [ ] For each caller site identified above, update the call site to use the new return shape. Two patterns:
  - **Cached path** (call goes through `cachedGet` or `cachingLayer.getSource`): the fetcher closure becomes `(ifNoneMatch) => client.getProgram(name, { ifNoneMatch })`. The caller code that destructures `{ source, hit }` continues to work — the wrapping returns the same shape.
  - **Bare path** (direct `client.getX()` call without caching): unwrap `.source` directly: `const { source } = await client.getDdlx(name); return textResult(source);`.
- [ ] In `tests/unit/adt/client.test.ts:46-238`, update the `source code read operations` describe block to assert the new return shape:
  - `getProgram returns source code` (line 47): change `expect(source).toBe(...)` to `expect(result.source).toBe(...)`. Also assert `result.notModified === false` and `result.statusCode === 200`.
  - Add new tests (~6 tests):
    - `getProgram captures etag from response header` — mock response with `{ etag: '20231201001' }` headers, assert `result.etag === '20231201001'`.
    - `getProgram returns notModified=true on 304` — mock response with status 304 and empty body, assert `result.notModified === true`, `result.source === ''`.
    - `getProgram sends If-None-Match when opts.ifNoneMatch is set` — pass `{ ifNoneMatch: 'abc123' }`, inspect `mockFetch` call arguments to verify the header was sent.
    - `getProgram appends ?version=inactive when opts.version is 'inactive'` — pass `{ version: 'inactive' }`, inspect the URL.
    - `getClass without include returns SourceReadResult` — same shape assertions as `getProgram`.
    - `getDdls returns SourceReadResult` — same.
- [ ] Run `npm test` — all client tests pass. Run `npm run typecheck` — should pass cleanly now that all callers are updated.

---

### Task 6: `CachingLayer.getSource` does conditional GET

**Files:**
- Modify: `src/cache/caching-layer.ts`
- Modify: `tests/unit/cache/caching-layer.test.ts`

`CachingLayer.getSource` currently runs a strict cache-then-fetch flow. With ETag support, it must: on cache hit, invoke the fetcher with the stored etag and inspect the result for 304/200; on 304 use cached body; on 200 with new etag replace cache; on 200 with no etag store body without etag (graceful fallback); on 404 (object deleted externally) invalidate the cache entry before re-throwing so the database stays in sync with the backend. On cache miss, do a plain fetch and store. The `fetcher` signature becomes etag-aware.

The 404-invalidation behaviour was specifically requested in [issue #183 follow-up comment](https://github.com/arc-mcp/arc-1/issues/183#issuecomment) by the original reporter ("If the element is not there, aka the read completely fails, then I'd say it's OK to also delete the cache entries… as a way to be completely 'in sync' with the backend"). Live probes against a4h confirmed: ADT returns HTTP 404 with `<exc:type id="ExceptionResourceNotFound"/>` for both never-existed and externally-deleted objects, regardless of `If-None-Match`. There is no 410 Gone in the ADT contract, but this implementation handles 410 defensively in case some future endpoint emits it. ARC-1 already has `isNotFoundError(err)` at [errors.ts:551](src/adt/errors.ts:551) — reuse it.

- [ ] In `src/cache/caching-layer.ts:62-77`, replace the `getSource` implementation. The new signature: `async getSource(objectType: string, objectName: string, fetcher: (ifNoneMatch?: string) => Promise<{ source: string; etag?: string; notModified: boolean; statusCode: number }>, opts?: { version?: 'active' | 'inactive' }): Promise<{ source: string; hit: boolean; revalidated: boolean }>`.
  - `revalidated: true` means cache hit and server confirmed via 304 (the [cached] indicator becomes more transparent).
  - Behaviour:
    1. Look up cache by `(objectType, objectName, version)` (default `'active'`).
    2. If cache miss → call `fetcher(undefined)` (no `If-None-Match`). On success: store via `cache.putSource(type, name, source, { version, etag })`, return `{ source, hit: false, revalidated: false }`. On error: just re-throw (no cache entry to invalidate).
    3. If cache hit and entry has no etag → call `fetcher(undefined)` (can't do conditional fetch). On success: replace cache via `putSource`, return `{ source: result.source, hit: false, revalidated: false }`. On error: see step 5.
    4. If cache hit with etag → call `fetcher(cached.etag)`:
       - If `result.notModified` (304): return `{ source: cached.source, hit: true, revalidated: true }`. Do not refresh `cachedAt` — the existing entry is fine; rewriting it would just churn SQLite.
       - If `result.statusCode === 200`: replace cache via `cache.putSource(type, name, result.source, { version, etag: result.etag })`, return `{ source: result.source, hit: false, revalidated: false }`.
       - On error: see step 5.
    5. **Error path with cached entry present:** wrap the fetcher call (steps 3 and 4) in a try/catch. On `AdtApiError` with `statusCode === 404` or `statusCode === 410`, call `this.cache.invalidateSource(objectType, objectName, version)` before re-throwing. On any other error, just re-throw. The invalidation must happen *before* re-throwing so callers and tests see consistent state. Import `AdtApiError` from `'../adt/errors.js'` if not already imported (existing imports start at line 25).
- [ ] Update `invalidate(type, name)` at line 145-148 to accept optional `version: 'active' | 'inactive' | 'all'`. The default for SAPWrite/SAPActivate paths should be `'all'` — activation consumes the inactive draft and replaces the active body in one step, so leaving either cache view stale is incorrect. Update the 12 SAPWrite invalidation call sites in intent.ts (lines 2650, 2664, 2688, 2805, 2810, 2879, 2898, 2935, 3135, 3193, 3357 plus any others added in the meantime) to pass `'all'` explicitly: `cachingLayer?.invalidate(type, name, 'all');`. Read-side 404 invalidation in `CachingLayer.getSource` (the new code added by codex's #1 finding) uses `'active'` only because we only know the active view was deleted — the inactive view, if any, may still exist on the server and be accessible via `?version=inactive`.
- [ ] Add a new method `getCachedSourceWithEtag(objectType: string, objectName: string, version?: 'active' | 'inactive'): { source: string; etag?: string } | null` that the caller can use to retrieve cached info without fetching — returns the active version by default. Existing `getCachedSource` keeps its current signature and behaviour for backwards compat.
- [ ] In `tests/unit/cache/caching-layer.test.ts:28-70`, replace the `source caching` describe block with new tests reflecting the conditional-GET flow (~10 tests):
  - `cache miss calls fetcher with undefined ifNoneMatch and stores result with etag` — fetcher mock returns `{ source: 'body', etag: 'e1', notModified: false, statusCode: 200 }`; assert `hit=false, revalidated=false`, then assert subsequent `getCachedSourceWithEtag` returns `{ source: 'body', etag: 'e1' }`.
  - `cache hit with etag sends If-None-Match and returns cached on 304` — pre-populate cache via fetcher, then call again; second fetcher call must receive `'e1'` as `ifNoneMatch`, mock returns `{ source: '', etag: 'e1', notModified: true, statusCode: 304 }`; assert `hit=true, revalidated=true, source='body'`.
  - `cache hit with etag fetches fresh on 200 (etag changed)` — first call stores `etag=e1`; second fetcher returns `{ source: 'newbody', etag: 'e2', notModified: false, statusCode: 200 }`; assert `hit=false, revalidated=false, source='newbody'`; assert cache now has `etag=e2`.
  - `cache hit with no etag falls back to plain GET and replaces cache` — directly populate cache via `cache.putSource(type, name, 'old')` (no etag); fetcher returns `{ source: 'fresh', notModified: false, statusCode: 200 }` with no etag; assert `hit=false, source='fresh'`, cache replaced.
  - `cache miss when fetcher returns no etag stores entry without etag` — fetcher returns 200 with body but no etag; assert next call's stored entry has no etag.
  - `active and inactive entries do not collide` — put `{ version: 'active' }` then `{ version: 'inactive' }`, both retrievable independently via `getCachedSourceWithEtag`.
  - `invalidate(type, name) defaults to active version` — populate both, invalidate without version, assert active is gone but inactive remains.
  - `getSource invalidates cache and re-throws when conditional GET returns 404` — pre-populate via fetcher returning `{ source: 'body', etag: 'e1', ... }`; second fetcher rejects with `new AdtApiError('Resource ... does not exist.', 404, '/sap/bc/adt/...', '<exc:type id="ExceptionResourceNotFound"/>')`; assert the call rejects with the same error AND assert `getCachedSourceWithEtag(type, name, version)` returns `null` afterwards. Use `expect(getSource(...)).rejects.toBeInstanceOf(AdtApiError)` with status 404. Import `AdtApiError` in the test file.
  - `getSource invalidates cache and re-throws on 410 Gone` — same shape, status 410. Verifies the defensive 410 branch.
  - `getSource does NOT invalidate cache on transient errors (e.g., 503)` — pre-populate via successful fetcher; second fetcher throws `AdtApiError` with status 503; assert the call rejects but `getCachedSourceWithEtag` still returns the cached entry. Confirms only 404/410 trigger invalidation.
- [ ] Run `npm test` — all CachingLayer tests pass.

---

### Task 7: Wire conditional GET into `handleSAPRead`

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts` (if it exists; otherwise unit-test coverage stays at the lower layers)

The `cachedGet` helper at `src/handlers/intent.ts:1244-1252` currently invokes a fetcher that ignores `If-None-Match`. After Task 5 the underlying `client.getProgram` etc. accept etag opts, and after Task 6 the caching layer drives the conditional flow. This task wires them together at the handler level, including updating the `[cached]` indicator to distinguish between server-validated cache hits and plain hits.

- [ ] In `src/handlers/intent.ts:1244-1252`, update the `cachedGet` helper inside `handleSAPRead`:
  - Change the fetcher signature to accept `ifNoneMatch?: string` and return `SourceReadResult` (the type defined in Task 5).
  - **Do NOT do a separate cache lookup in the handler.** `CachingLayer.getSource` already owns the lookup and passes the cached etag to the fetcher via the `ifNoneMatch` argument. Calling `getCachedSourceWithEtag` from the handler before invoking `getSource` would create two sources of truth (handler reads cache, then layer reads cache again) and is a redundancy bug.
  - The new helper body is just: `const { source, hit, revalidated } = await cachingLayer.getSource(objType, objName, (ifNoneMatch) => fetcher(ifNoneMatch), { version: 'active' });`.
  - Update the return shape to `{ source: string; cacheHit: boolean; revalidated: boolean }`. (`getCachedSourceWithEtag` from Task 6 stays in the API for non-handler callers like compressor.ts that need to peek at the etag for other reasons, but is unused by `cachedGet` itself.)
- [ ] Update each call site that uses `cachedGet` (PROG, CLAS no-include, INTF, FUNC, INCL, DDLS, DCLS, BDEF, SRVD, DDLX, SRVB, SKTD, TABL, VIEW, STRU branches in `handleSAPRead` around lines 1264-1360 — these are ALL types that go through cachedGet, not just the 6 from earlier draft). The fetcher closure now receives `ifNoneMatch` and forwards it: `(ifNoneMatch) => client.getProgram(name, { ifNoneMatch })`.
- [ ] Update the `cachedTextResult` helper at line 1255-1257 with the cleaner indicator semantics:
  - `cacheHit && revalidated` → prefix `[cached:revalidated]` (server confirmed via 304 — the only "served from cache" state for source reads post-PR).
  - `!cacheHit` → no prefix. This includes the case where a stored entry had no etag and was therefore re-fetched without conditional GET (Task 6 step 3 returns `hit=false` in that path because we cannot guarantee the cached body is current — the cache is replaced with the fresh body and the response counts as a miss).
  - The state `cacheHit && !revalidated` is **unreachable** under the Task 6 design: any cache hit either gets validated via 304 (revalidated=true) or triggers a body-replacing fetch that returns hit=false. There is no third "cache hit but unvalidated" path. Therefore no `[cached:unvalidated]` label is needed.
  - The unprefixed `[cached]` is reserved for **dep-graph cache hits** in `src/context/compressor.ts` (hash-keyed; naturally correct without server validation — different mechanism, different label). Source reads should never emit plain `[cached]` post-PR.
- [ ] Audit and update existing E2E test expectations that assert `[cached]` for source reads:
  - `tests/e2e/cache.e2e.test.ts:63` ("SAPRead — second call for same object is served from cache") — change expectation to accept `[cached:revalidated]` (the new label for source reads).
  - `tests/e2e/cache.e2e.test.ts:107` ("SAPContext deps — second call returns [cached] output") — keep `[cached]` expectation (this is the dep-graph hit path which retains the unprefixed label).
- [ ] Run `npm test` — all unit tests pass.

---

### Task 8: Add `version` parameter to SAPRead + inactive-list session cache + draft warnings

**Files:**
- Create: `src/cache/inactive-list-cache.ts`
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `src/handlers/intent.ts`
- Modify: `src/handlers/hyperfocused.ts`
- Modify: `src/handlers/intent.ts` (cache_stats action — extend with inactive-list state)
- Create: `tests/unit/cache/inactive-list-cache.test.ts`
- Modify: `tests/unit/handlers/schemas.test.ts` (if it exists, otherwise schema validation gets covered by integration tests)

This task wires the `version` parameter into SAPRead and adds the inactive-draft awareness UX. It depends on Tasks 5 (ADT client accepts `version` opt) and 6 (CachingLayer keys by version). The work is grouped into one task because the schema, the per-session inactive-list cache, the handler routing, and the warning logic are all parts of the same UX surface — splitting them creates ordering hazards (e.g. an isolated schema change without the handler logic produces a parameter that does nothing).

The inactive-list endpoint emits NO etag (verified live), so this cache cannot use conditional GET; it uses TTL + explicit invalidation. Per-username keying covers Principal Propagation; in stdio mode there is one username and the keying is effectively a singleton.

- [ ] Create `src/cache/inactive-list-cache.ts`. Class `InactiveListCache` with the following surface:
  ```typescript
  interface CachedInactiveList {
    username: string;
    objects: InactiveObject[];           // imported from src/adt/types.js
    fetchedAt: number;                   // Date.now()
  }

  export class InactiveListCache {
    private byUsername = new Map<string, CachedInactiveList>();
    private ttlMs = 60_000;              // 60 seconds — catches external Eclipse activations

    /** Get the cached list for a user, or fetch and cache if expired/missing. */
    async getOrFetch(client: AdtClient): Promise<InactiveObject[]> { ... }

    /** Synchronous lookup — returns null if not cached (no fetch). Used for warning checks where a fresh fetch isn't desired mid-handler. */
    getCached(username: string): InactiveObject[] | null { ... }

    /** Clear the cache for a specific user. Called from SAPWrite/SAPActivate paths. */
    invalidate(username: string): void { ... }

    /** Clear all entries (used by force_refresh and tests). */
    clear(): void { ... }

    /** Stats for SAPManage cache_stats. */
    stats(): { userCount: number; totalEntries: number } { ... }
  }
  ```
  Implementation notes:
  - `getOrFetch` checks `byUsername.get(client.username)`; if present and `Date.now() - fetchedAt < ttlMs`, return cached. Otherwise call `client.getInactiveObjects()`, store, return.
  - `username` comes from `AdtClient.username` (already exposed at line 71).
  - The cache is held by `CachingLayer` (extend it with a `inactiveLists: InactiveListCache` field). This keeps cache lifecycle aligned with the existing source/dep-graph caches.
- [ ] In `src/handlers/schemas.ts`, extend the SAPRead Zod schema (around line 165 or wherever the SAPRead `args` schema lives) with:
  ```typescript
  version: z.enum(['active', 'inactive', 'auto']).optional().default('active'),
  ```
  Add at the top-level args object alongside `type`, `name`, `format`, etc. Defaulting to `'active'` preserves all existing callers.
- [ ] In `src/handlers/tools.ts`, extend the SAPRead tool description string (around line 105-115) with one sentence about the `version` parameter:
  > Optional `version` parameter (default `'active'`): set to `'inactive'` to read the user's unactivated draft (Eclipse/SE80 working copy), or `'auto'` for "show me my view" — falls back to active when no draft exists. When reading the active version of an object that has an unactivated draft, the response will include a one-line note flagging the draft so you can re-read with `version='inactive'` if appropriate.

  Add a parallel sentence to the BTP-mode description (line ~109) since BTP also supports the parameter (BTP ABAP Environment uses the same ADT contract).
- [ ] In the SAPRead `inputSchema` JSON Schema in `src/handlers/tools.ts` (around line 380-440), add the `version` property:
  ```typescript
  version: { type: 'string', enum: ['active', 'inactive', 'auto'], description: "Source version to read. 'active' (default) returns the last activated version. 'inactive' returns the user's unactivated draft (or active if no draft exists). 'auto' returns the draft if one exists, else active." }
  ```
- [ ] In `src/handlers/intent.ts:1230-1257`, refactor `handleSAPRead` to use the inactive-list cache:
  - Read `args.version ?? 'active'` into a `requestedVersion` local at the top of `handleSAPRead`.
  - Extract a helper `resolveVersionAndDraftInfo(client, type, name, requestedVersion)` that:
    1. Calls `cachingLayer?.inactiveLists.getOrFetch(client)` to get the list (lazy + TTL'd internally — first call in a session pays ~415ms; subsequent calls within 60s are O(1)).
    2. Looks for the object: `const draft = list.find(o => o.type.toUpperCase().split('/')[0] === type.toUpperCase() && o.name.toUpperCase() === name.toUpperCase())`. (The `type.split('/')[0]` strip is because list entries use `BDEF/BDO`, `DDLS/DF` etc. — drop the suffix for matching.)
    3. Resolves: if `requestedVersion === 'auto'`, return `{ effectiveVersion: draft ? 'inactive' : 'active', draft }`; else return `{ effectiveVersion: requestedVersion, draft }`.
  - When `cachingLayer` is undefined (i.e. `ARC1_CACHE=none`), skip the inactive-list lookup entirely. `effectiveVersion = requestedVersion === 'auto' ? 'active' : requestedVersion` (degrades gracefully — `auto` falls through to `active` without the list lookup).
- [ ] Update the `cachedGet` helper inside `handleSAPRead` (the one already updated in Task 7) to take and forward a `version: 'active' | 'inactive'` argument:
  ```typescript
  const cachedGet = async (
    objType, objName, version,
    fetcher: (ifNoneMatch?: string) => Promise<SourceReadResult>,
  ) => cachingLayer.getSource(objType, objName, fetcher, { version });
  ```
  Pass the resolved `effectiveVersion` from `resolveVersionAndDraftInfo` into every `cachedGet` call site. The fetcher closure also forwards it: `(ifNoneMatch) => client.getProgram(name, { ifNoneMatch, version: effectiveVersion })`.
- [ ] Update the `cachedTextResult` helper to accept and prepend the warning text:
  ```typescript
  function cachedTextResult(source, cacheHit, revalidated, warning?: string): ToolResult {
    const indicator = cacheHit && revalidated ? '[cached:revalidated]\n' : '';
    const note = warning ? `${warning}\n\n` : '';
    return textResult(`${note}${indicator}${source}`);
  }
  ```
  Compute the `warning` argument in `handleSAPRead` based on `effectiveVersion` and `draft`:
  - `effectiveVersion === 'active' && draft` → warning: *"Note: You have an unactivated{draft.deleted ? ' deletion' : ''} draft of this object{draft.transport ? ` (in transport ${draft.transport})` : ''}. The source below is the LAST ACTIVATED version. To work with your draft, activate it first via SAPActivate or re-run with version='inactive' to read it directly."*
  - `effectiveVersion === 'inactive' && !draft` → warning: *"Note: No inactive draft exists for this object on the server. Returning the active version."*
  - All other combinations → no warning.
- [ ] Wire SAPWrite/SAPActivate paths to invalidate the inactive-list cache for the user. After every existing `cachingLayer?.invalidate(type, name, 'all')` call, also call `cachingLayer?.inactiveLists.invalidate(client.username)`. Reasoning: writes/activations mutate the user's draft set. Because invalidation is per-username, cross-user activations don't disturb each other.
- [ ] Wire `force_refresh` (the per-call escape hatch from PR 5 — handled here as a small piece of plumbing): if `args.force_refresh === true`, call `cachingLayer?.inactiveLists.invalidate(client.username)` AND `cachingLayer?.invalidate(type, name, 'all')` BEFORE the cached read, ensuring fresh data + fresh inactive-list state.
- [ ] In `src/handlers/hyperfocused.ts`, mirror the `version` parameter exposure on the wrapped SAPRead operation. Hyperfocused mode is a single-tool wrapper that re-exposes a subset of SAP operations; ensure the `version` argument flows through to the underlying handler. Test: `npm run dev:hyperfocused` and call the wrapped SAP tool with `version='inactive'`.
- [ ] Extend `SAPManage(action='cache_stats')` at `src/handlers/intent.ts:5278-5294` to include the inactive-list cache state. Add to the JSON output:
  ```json
  {
    "enabled": true,
    "warmupAvailable": ...,
    "sourceCount": ...,
    "contractCount": ...,
    "inactiveListCache": {
      "userCount": <num users with cached lists>,
      "totalEntries": <sum across users>
    }
  }
  ```
- [ ] In `tests/unit/cache/inactive-list-cache.test.ts`, add tests (~7 tests):
  - `getOrFetch fetches from client on first call and caches` — mock `client.getInactiveObjects()` to return a fixed list; assert first call invokes it once, second call (within TTL) does not.
  - `getOrFetch refetches after TTL expiry` — set `Date.now()` past the 60s mark via vitest fake timers; assert second call invokes the client again.
  - `invalidate(username) clears that user's entry only` — populate two users, invalidate one, assert the other still cached.
  - `getCached returns null when not cached` — no prior call; assert null.
  - `getCached returns cached list when present` — populate via getOrFetch; assert subsequent getCached returns same list synchronously.
  - `clear() drops all entries` — populate two users, clear, assert both gone.
  - `stats() reports counts correctly` — populate two users with N+M entries; assert `userCount=2` and `totalEntries=N+M`.
- [ ] In `tests/unit/handlers/intent.test.ts` (or extend an existing handler test if present), add unit tests for the version-resolution + warning logic (~6 tests):
  - `version='active' default with no draft → no warning, active fetched` — mock empty inactive list; assert fetcher called with `version='active'`, response has no warning prefix.
  - `version='active' with draft in list → active fetched + warning prepended` — mock list containing the object; assert response starts with the "You have an unactivated draft" note, full source follows.
  - `version='inactive' with draft → inactive fetched, no warning` — mock list containing the object; assert fetcher called with `version='inactive'`, no warning.
  - `version='inactive' without draft → inactive fetched + "no inactive draft" note` — mock empty list; assert fetcher called with `version='inactive'`, response has the "No inactive draft exists" note.
  - `version='auto' with draft → resolves to inactive` — mock list with object; assert fetcher called with `version='inactive'`, no warning.
  - `version='auto' without draft → resolves to active` — mock empty list; assert fetcher called with `version='active'`, no warning.
- [ ] Run `npm test` — all tests pass.

---

### Task 9: Add integration + E2E tests for conditional GET and inactive list

**Files:**
- Modify: `tests/integration/cache.integration.test.ts`
- Modify: `tests/e2e/cache.e2e.test.ts`

The unit tests cover the conditional-GET flow with mocked HTTP. The integration and E2E tests verify the live ADT contract on a4h (S/4HANA 2023). Before adding tests, read `INFRASTRUCTURE.md` for SAP system credentials — the host is `http://a4h.marianzeis.de:50000`, user `MARIAN`, client `001`. Tests must follow the skip taxonomy in `docs/testing-skip-policy.md` (`requireOrSkip` for missing credentials, `expectSapFailureClass` for error assertions).

- [ ] **First, audit and update existing assertions that no longer hold post-PR.** The current `tests/integration/cache.integration.test.ts` tests around lines 95-145 and `tests/e2e/cache.e2e.test.ts` lines 63-105 implicitly assume "second cache hit makes ZERO HTTP calls" (the test for "cache hit is significantly faster" works by comparing call counts or timing). Post-PR, every cache hit makes ONE conditional-GET roundtrip (which returns 304 with ~50 byte body). Update:
  - `cache hit is significantly faster than miss` (cache.integration.test.ts:107) — keep the test, but update the expectation: a 304 response is still substantially faster than fetching a full source body, so the timing comparison should still pass. Adjust the assertion margin if needed.
  - `returns MISS then HIT for same object` (cache.integration.test.ts:95) — keep, but update the implementation note: the second call is now a 304-validated hit, not a zero-HTTP cache hit. Verify the call count via mock fetch spy if the test inspects fetch invocations. If the test currently asserts `mockFetch` was called only once across both reads, change to assert it was called twice with the second call having an `If-None-Match` header.
  - `SAPRead — second call for same object is served from cache` (cache.e2e.test.ts:63) — update to accept `[cached:revalidated]` prefix instead of `[cached]` (per Task 7's indicator change). The semantic of "served from cache" is preserved; the wire-level mechanism changed.
- [ ] Add new integration tests under a new describe block `describe('Conditional GET (ETag-driven freshness)')` (~3 tests):
  - `SAPRead PROG returns 304 on second read with valid etag` — read `RSPARAM` once, capture the cached entry's etag via `cachingLayer.getCachedSourceWithEtag('PROG', 'RSPARAM', 'active')`, read again, assert the second call result has `revalidated=true`. Use `getTestClient()` factory at top of file.
  - `write invalidation returns fresh body on next read` — uses `SAPWrite` + `SAPActivate` against a `$TMP` test object to mutate it, then reads again. The existing `cachingLayer.invalidate(...)` call in the SAPWrite path means the second read is a cache MISS (not a conditional GET returning 200), and that's correct — this test verifies the write-invalidation path, NOT the 200-replacement path. Renamed accordingly to remove ambiguity. The pure 200-replacement path (cached etag, server returns 200 with new etag) is exercised in unit tests at the CachingLayer level, where mocking the fetcher's response is straightforward; reproducing it in an integration test would require a separate AdtClient instance for the mutation, which is heavyweight test-setup for a path already covered by unit tests. Use `generateUniqueName()` from `tests/integration/crud-harness.ts`. Skip with `requireOrSkip` if write capability is not available (`SAP_ALLOW_WRITES != 'true'`).
  - `cache key separates active and inactive views` — only practical to verify if a known inactive object exists; otherwise skip with reason `NO_FIXTURE`. The test reads the same object with `version: 'active'` and `version: 'inactive'` opts, asserts the etags differ (the server's `cl_adt_utility=>calculate_etag_base()` encodes the version in the trailing 3 digits — `001` active, `000` inactive). Verified live on a4h with ZC_FbClubTP; on systems without inactive drafts (NW 7.50 SP02 verified with DDIC), skip with `NO_FIXTURE`.
- [ ] Add a separate describe block `describe('404 cache invalidation (external delete simulation)')` with ~1 test that **must NOT use SAPWrite to do the delete** (because SAPWrite already invalidates the cache via the write path, which would mask any failure of the read-side 404 invalidation). Implementation:
  ```typescript
  // 1. Create a transient $TMP program via SAPWrite. Cache will be empty for it.
  // 2. Read it via SAPRead — this populates cache with body + etag.
  // 3. Capture cached etag via cachingLayer.getCachedSourceWithEtag(...).
  // 4. Delete the program by calling the ADT REST endpoint DIRECTLY via raw http.delete on a SECOND AdtClient instance configured WITHOUT a cachingLayer. This bypasses the SAPWrite invalidation path entirely — the cache under test still has the stale entry.
  // 5. Read it via SAPRead on the FIRST (cached) client. This triggers the conditional GET against a now-deleted object → 404 → CachingLayer.getSource invalidates the cache entry before re-throwing.
  // 6. Assert: the SAPRead call rejects with AdtApiError(404) AND cachingLayer.getCachedSourceWithEtag(...) returns null afterwards (the entry is gone).
  ```
  Use `expectSapFailureClass(err, [404], [/not exist/i])` from `tests/helpers/expected-error.ts` for the rejection assertion. Cleanup is irrelevant — the object is already deleted. Skip with `requireOrSkip` if `SAP_ALLOW_WRITES != 'true'`.
- [ ] In the same file, add a new describe block `describe('Inactive objects endpoint')` (~2 tests):
  - `getInactiveObjects returns 200 (not 404) on supported systems` — use `getTestClient().getInactiveObjects()`, expect a non-throwing call, assert result is `Array.isArray()`. The list may be empty (no drafts) or non-empty (drafts exist) — both are valid.
  - `INACTIVE_OBJECTS handler returns valid JSON listing` — call the MCP handler at the integration test layer (see existing patterns in `cache.integration.test.ts` for handler-level tests), assert the result text parses as `{ count: number, objects: Array }`.
- [ ] In `tests/e2e/cache.e2e.test.ts`, add new tests under the existing `describe('E2E Cache Tests')` (~3 tests):
  - `SAPRead — second call uses conditional GET (304)` — call `SAPRead` twice for the persistent fixture `ZARC1_TEST_REPORT`, assert the second result text starts with `[cached:revalidated]`. (Per Task 7's indicator simplification, source reads emit only `[cached:revalidated]` on hit; plain `[cached]` is reserved for dep-graph hits which this test does not cover.)
  - `SAPRead — INACTIVE_OBJECTS returns valid response` — call `SAPRead({ type: 'INACTIVE_OBJECTS' })`, parse the response text as JSON, assert it has `count: number` and `objects: Array` keys. Do not assert non-empty; the list may be empty depending on system state.
  - `SAPRead — second call after external mutation returns fresh body` — use the `ZARC1_TEST_REPORT` fixture: read once, modify via `SAPWrite` + `SAPActivate` (changes the etag), read again, assert the third read body matches the modified body (not the original). Cleanup: restore original body in `finally`. Use `generateUniqueName()` for any transient objects. Skip with `requireOrSkip` if write capability is unavailable.
- [ ] Add a new describe block `describe('SAPRead version parameter')` to `tests/e2e/cache.e2e.test.ts` with E2E tests (~4 tests):
  - `version='active' (default) returns active version with no draft warning when none exists` — read `ZARC1_TEST_REPORT`, assert no "unactivated draft" prefix in the response.
  - `version='inactive' on object with no draft returns active body with note` — read `ZARC1_TEST_REPORT` with `version='inactive'`, assert the response begins with the `"No inactive draft exists for this object on the server. Returning the active version."` note.
  - `version='auto' on object with no draft returns active` — same fixture, `version='auto'`, assert no warning prefix and source returns normally.
  - `version='inactive' against a known inactive object returns the draft + warning when read as active` — only runs if a known-inactive object exists in the test fixtures. The test creates a transient `$TMP` object, leaves it inactive (skips `SAPActivate`), reads with `version='active'` and asserts the draft-awareness warning appears, then reads with `version='inactive'` and asserts no warning + draft body returned. Skip with `requireOrSkip` if write capability is unavailable.
- [ ] Add a new describe block `describe('Inactive-list session cache behaviour')` to `tests/integration/cache.integration.test.ts` (~2 tests):
  - `inactive-list cache: second call within TTL does not re-fetch from server` — populate the cache via a SAPRead (which triggers `getOrFetch` internally), spy on `client.getInactiveObjects()`, call SAPRead again, assert the spy was called only once.
  - `inactive-list cache invalidates on SAPWrite` — populate the cache, run a SAPWrite (which calls `inactiveLists.invalidate(client.username)`), assert the next SAPRead causes a re-fetch (spy called twice total).
- [ ] Run `npm run test:integration` (with credentials configured per `INFRASTRUCTURE.md`) — new tests pass against a4h.
- [ ] Run `npm run test:e2e` (with MCP server running per `docs/setup-guide.md`) — new tests pass.
- [ ] Run `npm test` — full unit suite still passes; no regressions introduced by integration/E2E test additions.

---

### Task 10: Update documentation — README, CLAUDE.md, create docs/caching.md

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Create: `docs/caching.md`
- Modify: `docs/compare/00-feature-matrix.md`

The README's "Built-in Object Caching" section claims "repeated reads return instantly without calling SAP" — true within a session, but post-PR the stronger claim is "repeated reads stay correct even after external activations, with one ~50-byte conditional GET per read." CLAUDE.md's "Architecture: Request Flow" section omits the ETag round-trip; adding a step preserves architectural accuracy. The README links to `docs/caching.md` which doesn't exist — create it as part of this task to fix the broken link. The feature matrix row 182 ("Inactive objects list") shows ARC-1 with ✅ but the path bug had it returning empty for years; refresh the row to reflect the genuine state post-fix.

- [ ] In `README.md` at lines 50-57 ("Built-in Object Caching"), rewrite to mention the conditional-GET model and the version parameter. Suggested replacement bullets:
  - **Server-validated freshness** — every cached source is tagged with the server's ETag. Repeated reads send `If-None-Match`; SAP returns HTTP 304 (~50 bytes) if unchanged or 200 with fresh body if anything changed externally. Cache stays correct across SE80/Eclipse activations.
  - **In-memory or SQLite** — automatic per-process in stdio, persistent SQLite for `http-streamable` and Docker.
  - **Dependency graph caching** — `SAPContext` dep resolution keyed by source hash; unchanged objects skip all dependent ADT calls.
  - **Inactive-draft awareness** — when the developer has unactivated changes in Eclipse/SE80, ARC-1 surfaces this on every related `SAPRead`. Optional `version='inactive'` reads the draft directly; `version='auto'` returns the developer's view (draft if it exists, else active).
  - **Pre-warmer** (existing bullet, keep as-is).
  - **Write invalidation** (existing bullet, keep as-is).
- [ ] Create `docs/caching.md`. Structure:
  - **Overview** (1 paragraph): the cache is correct by construction via HTTP `If-None-Match`; no TTL.
  - **Two backends** (table): MemoryCache (stdio), SqliteCache (http-streamable + Docker), warmup overlay for reverse-dep lookup.
  - **Source cache** subsection: keyed by `(type, name, version)`. Stores body + etag. Default version is active.
  - **Conditional GET flow** (sequence diagram in plain text):
    ```
    Read 1 (cache miss):
      handler → CachingLayer.getSource → fetcher(undefined)
      fetcher → http.get(/source/main) → 200 + etag=E1 + body
      cache.putSource(type, name, body, { etag: E1 })
      return body

    Read 2 (cache hit, server says unchanged):
      handler → CachingLayer.getSource → has cached etag=E1 → fetcher(E1)
      fetcher → http.get(/source/main, { 'If-None-Match': E1 }) → 304 + empty body
      return cached body, hit=true, revalidated=true  →  [cached:revalidated]

    Read 3 (external activation; server returns new body):
      handler → CachingLayer.getSource → has cached etag=E1 → fetcher(E1)
      fetcher → http.get(/source/main, { 'If-None-Match': E1 }) → 200 + etag=E2 + new body
      cache.putSource(type, name, new body, { etag: E2 })
      return new body, hit=false  →  fresh content, no [cached] prefix
    ```
  - **Dep graph cache**: keyed by source SHA-256 hash. Naturally correct — when source changes the hash changes and the dep graph misses. Safe to keep across external activations because the source-cache layer above ensures the hash is always fresh.
  - **Why no TTL**: HTTP `If-None-Match` is structurally correct; TTLs gamble on freshness. ETag predates SAP_BASIS 7.50 — works on every supported release. SAP Notes 1760222 (2012), 1814370 (2013) document the server-side mechanism.
  - **Inactive vs active** (new subsection): cache key includes a `version` dimension because the server emits distinct ETags per `cl_adt_utility=>calculate_etag_base()` (`...001` for active, `...000` for inactive). The cache layer keeps both views isolated; reads route to the correct one based on the resolved `version` parameter (Task 8).
  - **`version` parameter on SAPRead** (new subsection): the user-facing parameter accepts `'active'` (default), `'inactive'` ("show me my draft"), or `'auto'` ("show me my view — draft if I have one"). The handler resolves `'auto'` client-side using the inactive-list session cache, so the cache always sees a concrete `'active'` or `'inactive'` key. When reading the active version of an object that has an unactivated draft, the response is prefixed with a one-line note flagging the draft so the LLM can re-read with `version='inactive'` if appropriate. When reading the inactive version of an object that has no draft, the response is prefixed with a confirmation note ("No inactive draft exists for this object on the server. Returning the active version.") — the server falls back to active body in this case, and the note makes that fallback honest. This closes the "Claude doesn't see my Eclipse edits" UX gap that #183 didn't directly address.
  - **Inactive-list session cache** (new subsection): per-username in-memory cache keyed by SAP user, populated lazily on first source read of a session, refreshed on any SAPWrite/SAPActivate/`force_refresh`, falls back to a 60-second TTL for catching external Eclipse activations. Cost: one ~415ms HTTP call per user per session (verified live). Memory cost: typically 1-15 KB per user, occasionally up to ~120 KB for users with many test artifacts. Never persisted to SQLite — small enough to live entirely in memory.
  - **What invalidates**: SAPWrite/SAPActivate mutations call `cachingLayer.invalidate(type, name, 'all')` to clear BOTH active and inactive cache views — activation consumes the inactive draft (it becomes the new active body), so leaving either entry stale is incorrect. gCTS sync calls `invalidate(type, name, 'all')` per-synced-object for the same reason. External activations done in SE80/Eclipse are caught by the next conditional GET (304 → cached, 200 → replaced). External deletions are caught by the next conditional GET returning 404 — `CachingLayer.getSource` calls `invalidateSource(type, name, 'active')` before re-throwing the `AdtApiError`, keeping the cache database in sync with the backend ([requested in #183 follow-up](https://github.com/arc-mcp/arc-1/issues/183)). Read-side 404 handling clears only the active version because we have no signal about the inactive view; an inactive draft that survives an active deletion is uncommon but possible.
  - **Considered alternatives** (new subsection): document why the four other approaches we evaluated were rejected, so future readers don't burn cycles re-discovering the rationale. Each alternative gets one paragraph:
    - **Disable cache by default (the original #183 quick-fix instinct)** — kills the dep-graph cache, which is the killer feature for `SAPContext` (10–30× speedup on dependency-resolution workflows). Trades a fixable correctness bug for a permanent performance regression on the headline token-efficiency feature. Also: doesn't actually fix anything for the within-session case.
    - **TTL-based revalidation** — gambles on freshness. Any value > 0 means a window where stale source can be served; any value of 0 means the cache is disabled. The `cached_at` column was already in the SQLite schema for this design but it is structurally inferior to ETag: same RTT count, no bandwidth savings, requires admin tuning (always wrong by default for some user). HTTP gives us a content-validated mechanism for free; TTL would be reinventing the worse version.
    - **Versions-feed lazy revalidation** (parsing `/source/main/versions` Atom feed and comparing the latest revision timestamp) — only updates on activation, so it cannot catch un-activated drafts. Requires Atom XML parsing (extra code surface). Same RTT cost as ETag conditional GET on every revalidation. ETag wins on every dimension.
    - **Transport-system timestamp comparison** (looking up when each object was included in a transport, comparing against `cached_at`) — suggested in passing in the [#183 follow-up](https://github.com/arc-mcp/arc-1/issues/183) before the reporter walked themselves out of it. Requires multiple ADT calls per cache check (transport list, transport contents, timestamp parsing), high token cost on shared service-account deployments, and still doesn't catch un-activated drafts or workbench-direct edits that bypass transports. Strictly inferior to ETag.
    - Conclude with: ETag conditional GET wins because the server is the source of truth for freshness, the round-trip is cheap (~50 bytes on cache hit), and the mechanism predates SAP_BASIS 7.50 (notes 1760222, 1814370) so there's no per-release feature gating.
- [ ] In `CLAUDE.md`, update the "Architecture: Request Flow" diagram in the "Architecture" section (look for `## Architecture: Request Flow` heading). Add the ETag step under "HTTP Request" — between "Cookie/session management" and "Stateful sessions for lock→modify→unlock sequences" add: "ETag round-trip (`If-None-Match` on cached source reads → 304 Not Modified)".
- [ ] In `CLAUDE.md`, update the "Key Files for Common Tasks" table by adding a row: `| Add cache freshness mechanism | src/cache/caching-layer.ts (getSource), src/cache/cache.ts (CachedSource etag/version), src/cache/memory.ts + sqlite.ts (storage), src/adt/client.ts (source-fetching methods) |`.
- [ ] In `docs/compare/00-feature-matrix.md` line 182, update the "Inactive objects list" row to add a footnote or comment indicating the path was fixed in PR #N (will be filled by ralphex when the PR ships). Example: change `✅ |` to `✅ (fixed PR #XXX) |` in the ARC-1 column. Refresh the "Last Updated" date at the top of the file to today.
- [ ] Run `npm run lint` (linter sees `.md` indirectly via repository structure but won't fail) and verify no broken code references in the new doc.
- [ ] Run `npm test` — full unit suite still passes; no regressions introduced by edits to documented code paths.

---

### Task 11: Final verification

- [ ] Run full unit test suite: `npm test` — all tests pass.
- [ ] Run typecheck: `npm run typecheck` — no errors.
- [ ] Run lint: `npm run lint` — no errors.
- [ ] Run integration tests against a4h: `npm run test:integration` (requires `TEST_SAP_*` env vars per `INFRASTRUCTURE.md`) — all new conditional-GET and inactive-list tests pass.
- [ ] Run E2E tests: `npm run test:e2e` (requires running MCP server — see `docs/setup-guide.md`) — all new e2e tests pass.
- [ ] Manual smoke test: with `ARC1_CACHE=memory` and `ARC1_LOG_FORMAT=json`, run `arc-1` against a4h, call `SAPRead(type='PROG', name='RSPARAM')` twice via an MCP client, verify the second response has `[cached:revalidated]` indicator and the audit log shows the second HTTP call returned status 304.
- [ ] Manual smoke test 2: call `SAPRead(type='INACTIVE_OBJECTS')` against a4h with the test user MARIAN (who has known inactive drafts) — assert the response contains a non-empty `objects` array with `BDEF/BDO`, `DDLS/DF`, etc. entries (not the "Inactive objects listing is not available" message). Also assert the rich fields (`user`, `deleted`, `transport`) are populated.
- [ ] Manual smoke test 2b (version parameter UX): with `ARC1_CACHE=memory` against a4h as user MARIAN:
  - `SAPRead(type='BDEF', name='ZC_FbClubTP')` (default `version='active'`) — assert the response begins with the draft-awareness note: *"You have an unactivated draft of this object..."*. The active source body follows.
  - `SAPRead(type='BDEF', name='ZC_FbClubTP', version='inactive')` — assert the response is the inactive draft body with NO warning note.
  - `SAPRead(type='BDEF', name='ZC_FbClubTP', version='auto')` — assert the response resolves to the inactive draft (because MARIAN has one), with no warning note.
  - `SAPRead(type='PROG', name='RSPARAM', version='inactive')` — RSPARAM has no inactive draft for MARIAN; assert the response begins with *"No inactive draft exists for this object on the server. Returning the active version."*
  - `SAPManage(action='cache_stats')` — assert the response includes `inactiveListCache: { userCount: 1, totalEntries: > 0 }`.
- [ ] Manual smoke test 3 (404-invalidation cycle): the goal is to verify the read-side 404-invalidation path actually fires. The naive approach of using `SAPWrite(delete)` from the same MCP server is a **false positive** — SAPWrite already calls `cachingLayer.invalidate(...)` which removes the cache entry before any read can trigger the 404 path. The deletion must bypass the cache layer entirely. With `SAP_ALLOW_WRITES=true` against a4h, run this exact sequence (all curl variables come from `INFRASTRUCTURE.md`):

  ```bash
  # Set up env (read from /Users/marianzeis/DEV/arc-1/.env or INFRASTRUCTURE.md)
  export SAP_URL=http://a4h.marianzeis.de:50000
  export SAP_USER=MARIAN
  export SAP_PASSWORD='6j9GylaIHh5yaMXosSAjjRHqD'
  export SAP_CLIENT=001
  COOKIES=/tmp/arc1-smoke-cookies.txt
  rm -f "$COOKIES"

  # 1. Establish session + capture CSRF token
  CSRF=$(curl -sS -c "$COOKIES" -i -u "$SAP_USER:$SAP_PASSWORD" \
    -H "X-CSRF-Token: Fetch" \
    "$SAP_URL/sap/bc/adt/discovery?sap-client=$SAP_CLIENT" \
    | awk -F': ' 'tolower($1)=="x-csrf-token"{print $2}' | tr -d '\r\n')

  # 2. Start ARC-1 in another terminal: ARC1_CACHE=memory SAP_ALLOW_WRITES=true npm run dev
  #    Connect via an MCP client (Claude Desktop, mcp-inspector, etc.)

  # 3. Create transient $TMP program via SAPWrite. In the MCP client:
  #    SAPWrite(action='create', type='PROG', name='ZARC1_TMP_404TEST',
  #             source='REPORT zarc1_tmp_404test.', package='$TMP')

  # 4. Read it via SAPRead. In the MCP client:
  #    SAPRead(type='PROG', name='ZARC1_TMP_404TEST')
  #    Verify SAPManage(action='cache_stats') shows sourceCount=1

  # 5. Delete the object directly via curl — bypassing ARC-1's cache:
  #    a) Lock the object
  LOCK_RESP=$(curl -sS -b "$COOKIES" \
    -H "X-CSRF-Token: $CSRF" \
    -H "Accept: application/vnd.sap.as+xml;dataname=com.sap.adt.lock.result" \
    -X POST \
    "$SAP_URL/sap/bc/adt/programs/programs/ZARC1_TMP_404TEST?_action=LOCK&accessMode=MODIFY&sap-client=$SAP_CLIENT")
  LOCK_HANDLE=$(echo "$LOCK_RESP" | grep -oE '<LOCK_HANDLE>[^<]+</LOCK_HANDLE>' | sed 's/<[^>]*>//g')
  echo "Lock handle: $LOCK_HANDLE"

  #    b) Delete with the lock handle (URL-encode any special chars in the handle if present)
  curl -sS -b "$COOKIES" \
    -H "X-CSRF-Token: $CSRF" \
    -X DELETE \
    "$SAP_URL/sap/bc/adt/programs/programs/ZARC1_TMP_404TEST?lockHandle=$(printf %s "$LOCK_HANDLE" | sed 's/[^A-Za-z0-9._~-]/\\&/g')&sap-client=$SAP_CLIENT"

  # 6. Read again via the SAME MCP session. ARC-1 still has the cached entry but
  #    the object is gone server-side. In the MCP client:
  #    SAPRead(type='PROG', name='ZARC1_TMP_404TEST')
  #    Expect: error response with 404 / "ResourceNotFound" / "does not exist".

  # 7. Verify cache invalidation. In the MCP client:
  #    SAPManage(action='cache_stats')
  #    Expect: sourceCount=0 (the 404-invalidation path in CachingLayer.getSource
  #            removed the stale entry).
  ```

  This sequence demonstrates the issue #183 follow-up requirement that "if the element is not there, the database entries should be deleted as well." A test that uses `SAPWrite(delete)` from the same MCP server cannot verify this code path — SAPWrite's invalidation runs before any read-side 404 is observed. Alternative: instead of curl, use SE80/Eclipse to delete (works if you have GUI access). The principle is the same: the deletion must bypass ARC-1's cache layer.
- [ ] Move this plan to `docs/plans/completed/2026-04-28-etag-conditional-get-and-inactive-objects-fix.md`.
