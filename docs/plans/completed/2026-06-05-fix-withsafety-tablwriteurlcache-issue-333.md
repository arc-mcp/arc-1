# Fix `withSafety()` Clone Dropping `tablWriteUrlCache` (issue #333)

## Overview

`AdtClient.withSafety()` builds a per-request safety clone with `Object.create(AdtClient.prototype)`, which **bypasses the constructor**. Every instance field must therefore be re-attached by hand via `Object.defineProperty`. The method currently re-attaches 5 of the 6 instance fields — `http`, `safety`, `username`, `tablUrlCache`, `packageHierarchyResolverHolder` — but omits `tablWriteUrlCache`. The clone's `tablWriteUrlCache` is consequently `undefined`, and the first TABL write/activate on that clone throws `TypeError: Cannot read properties of undefined (reading 'get')` at `src/adt/client.ts:712` (`this.tablWriteUrlCache.get(upper)`).

This is a confirmed regression introduced in PR #286 / commit `b0981400` (issue #285, "refuse TABL/DT writes on NW 7.50/7.51"), first shipped in v0.9.6 and still present in v0.9.7, v0.9.8, and on `main`. That PR added the new `tablWriteUrlCache` field plus `resolveTablObjectUrlForWrite()` and rerouted the TABL write/activate call sites from `resolveTablObjectUrl()` (which reads the *copied* `tablUrlCache`) to `resolveTablObjectUrlForWrite()` (which reads the *uncopied* `tablWriteUrlCache`) — but did not update `withSafety()`. Before #286 the equivalent paths used the copied read cache, so TABL writes on a clone worked; after #286 they crash.

The fix is a one-block addition mirroring the existing `tablUrlCache` line: share the same `Map` instance with the clone (correct semantics — TABL/DT-vs-TABL/DS resolution is about object addressing, independent of per-request safety scope, exactly like `tablUrlCache`). The change is code-only (in-memory clone wiring; no SAP interaction changes), so it is covered by unit tests only. A guard-rail comment and a `CLAUDE.md` Key Files row are added so future field additions to `AdtClient` don't silently regress the same way.

## Context

### Current State

- `src/adt/client.ts:265` — `AdtClient` declares 6 instance fields: `http`, `safety`, `username` (readonly, public), `tablUrlCache` (`:273`, private), `tablWriteUrlCache` (`:278`, private), `packageHierarchyResolverHolder` (`:282`, private).
- `src/adt/client.ts:318` — `withSafety(safety)` clones via `Object.create(AdtClient.prototype)` and re-attaches `http`, `safety`, `username`, `tablUrlCache`, `packageHierarchyResolverHolder`. **`tablWriteUrlCache` is NOT re-attached** → `undefined` on every clone.
- `src/adt/client.ts:707` — `resolveTablObjectUrlForWrite(name, options)` calls `this.tablWriteUrlCache.get(upper)` at `:712` (and `.set(...)` at `:764`/`:768`). On a clone, the `.get()` call throws `TypeError: Cannot read properties of undefined (reading 'get')`.
- `src/handlers/intent.ts:3661` (SAPWrite update/delete TABL), `:5760` (SAPActivate batch TABL), `:5822` (SAPActivate single TABL) — all call `client.resolveTablObjectUrlForWrite(...)`. When `client` is a `withSafety()` clone, all three crash.
- `src/server/server.ts:683-694` — the clone is produced on two HTTP auth paths: API-key-with-profile (`:689`) and XSUAA/OIDC scopes (`:693`). Stdio mode (no `authInfo`) uses the constructor-built client directly and is unaffected.
- `tests/unit/adt/client.test.ts:1309` — the `withSafety` describe block tests safety replacement, shared `http`, preserved `username`, safety enforcement, and `instanceof`. `tests/unit/adt/client.test.ts:1083` tests that clones share the same package-hierarchy resolver instance. **No test exercises either TABL URL cache (`tablUrlCache` or `tablWriteUrlCache`) on a clone** — which is why the regression shipped undetected. CI never caught it because all unit/integration tests build the client through the constructor, never through `withSafety()`.

### Target State

- `AdtClient.withSafety()` re-attaches `tablWriteUrlCache` to the clone (same `Map` instance as the original), placed immediately after the existing `tablUrlCache` line.
- A guard-rail comment in `withSafety()` states that every instance field must be re-attached because `Object.create` skips the constructor.
- `resolveTablObjectUrlForWrite()` runs without crashing on a `withSafety()` clone; TABL update/delete/activate work over authenticated HTTP connections again.
- Unit tests assert clones share both `tablWriteUrlCache` and `tablUrlCache`, and that `resolveTablObjectUrlForWrite()` does not throw on a clone.
- `CLAUDE.md` has a Key Files row documenting the clone-field invariant.

### Key Files

| File | Role |
|------|------|
| `src/adt/client.ts` | `AdtClient` class. `withSafety()` at `:318` (the fix); `tablWriteUrlCache` field at `:278`; `resolveTablObjectUrlForWrite()` at `:707` (the crash site). |
| `tests/unit/adt/client.test.ts` | Unit tests. `withSafety` describe block at `:1309`; resolver-sharing test at `:1083` (the prior-art pattern to mirror); `resolveTablObjectUrlForWrite` describe block at `:433`. |
| `CLAUDE.md` | Autonomous-agent guidance. Add a Key Files row for the `withSafety()` clone-field invariant. |
| `src/server/server.ts` | (Read-only reference) `:683-694` produces the clone on HTTP auth paths. Not modified. |
| `src/handlers/intent.ts` | (Read-only reference) `:3661`, `:5760`, `:5822` call the crashing resolver. Not modified. |

### Design Principles

1. **Share, don't copy.** The clone must reference the *same* `Map` instance as the original (via `Object.defineProperty(clone, 'tablWriteUrlCache', { value: this.tablWriteUrlCache, ... })`), exactly like `tablUrlCache`. TABL/DT-vs-TABL/DS resolution is a property of the SAP object, not of the per-request safety scope, so resolutions cached on the original (or a sibling clone) should be visible everywhere. Allocating a fresh empty `Map` on the clone would "fix" the crash but discard caching and diverge from the `tablUrlCache` contract.
2. **Match the existing idiom.** Use the same `{ writable: false, enumerable: false }` descriptor shape as the `tablUrlCache` and `packageHierarchyResolverHolder` lines. Non-enumerable keeps it off `JSON.stringify`/`Object.keys` like the other internal caches.
3. **Code-only change → unit tests only.** No SAP interaction, transport, or auth behavior changes — only in-memory clone wiring. Per the test-tier policy, this needs unit tests only; no integration or E2E tests required.
4. **Prevent recurrence.** Add a guard-rail comment in `withSafety()` and a `CLAUDE.md` Key Files row so the next field added to `AdtClient` is also re-attached. This is the second near-miss of this class (the resolver holder was added later and remembered; this cache was forgotten).
5. **No manual version bump.** Release is automated via release-please; a `fix:` commit yields a patch release. Do not edit `package.json` or the `VERSION` constant.

## Development Approach

This is a focused, single-symbol regression fix, so the plan is intentionally short (3 tasks). The fix and its regression tests are tightly coupled to a ~6-line change and belong in one task; isolating them would fragment trivial work and force the test session to re-derive context. Task 2 is a low-risk documentation-hygiene addition that prevents recurrence. Task 3 is the standard final verification.

Follow existing conventions: ESM `.js` import extensions, Biome formatting (auto-fixed on commit), and the vitest mocking pattern (`vi.mock('undici', ...)` + `mockResponse()` from `tests/helpers/mock-fetch.ts`). Private fields are accessed in tests via a typed cast (e.g. `(clone as unknown as { tablWriteUrlCache?: Map<string, string> }).tablWriteUrlCache`).

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Re-attach `tablWriteUrlCache` in `withSafety()` and add regression tests

**Files:**
- Modify: `src/adt/client.ts`
- Modify: `tests/unit/adt/client.test.ts`

`AdtClient.withSafety()` (at `src/adt/client.ts:318`) clones the client with `Object.create(AdtClient.prototype)`, which skips the constructor, so each instance field is re-attached via `Object.defineProperty`. The `tablWriteUrlCache` field (declared at `:278`) is missing from this list, so it is `undefined` on every clone. The first TABL write/activate on a clone then throws `TypeError: Cannot read properties of undefined (reading 'get')` at `:712` inside `resolveTablObjectUrlForWrite()`. This task adds the missing re-attachment and locks the behavior in with tests.

- [ ] In `src/adt/client.ts`, in `withSafety()`, immediately after the existing `Object.defineProperty(clone, 'tablUrlCache', ...)` line (`:325`), add a block that re-attaches `tablWriteUrlCache`, sharing the same `Map` instance: `Object.defineProperty(clone, 'tablWriteUrlCache', { value: this.tablWriteUrlCache, writable: false, enumerable: false });`
- [ ] Extend the comment above the `tablUrlCache`/`tablWriteUrlCache` lines so it covers both caches (the read-path resolver cache and the write-path resolver cache), and add a one-line guard-rail note in `withSafety()` stating that every `AdtClient` instance field must be re-attached here because `Object.create` bypasses the constructor.
- [ ] In `tests/unit/adt/client.test.ts`, add tests to the existing `describe('withSafety', ...)` block (at `:1309`). Use the existing `createClient()` helper and `unrestrictedSafetyConfig()`. Access the private caches via a typed cast.
- [ ] Add unit tests (~4 tests). Reuse the `searchResponse(uri, type, name)` mock helper already defined in the `describe('resolveTablObjectUrlForWrite (issue #285)', ...)` block at `tests/unit/adt/client.test.ts:434` (it returns an `adtcore:objectReferences` XML carrying `adtcore:type`); `tablWriteUrlCache` is only populated when search reports `TABL/DT` or `TABL/DS`. Tests: (1) clone's `tablWriteUrlCache` is defined and is the **same `Map` instance** as the original's (access the private field via a typed cast, e.g. `(c as unknown as { tablWriteUrlCache?: Map<string, string> }).tablWriteUrlCache`); (2) clone's `tablUrlCache` is also the same instance as the original's (closes the adjacent untested gap); (3) **regression** — `resolveTablObjectUrlForWrite('BAPIRET2', { tablesEndpointAvailable: false })` on a clone resolves to `/sap/bc/adt/ddic/structures/BAPIRET2` and does **not** throw `TypeError` (mock one `searchResponse('/sap/bc/adt/ddic/structures/BAPIRET2', 'TABL/DS', 'BAPIRET2')`); (4) **shared-not-copied** — mock one `searchResponse('/sap/bc/adt/ddic/tables/T000', 'TABL/DT', 'T000')`, create the clone, call `resolveTablObjectUrlForWrite('T000', { tablesEndpointAvailable: true })` on the **original** (populates the shared cache, 1 HTTP call), then call the same on the **clone** and assert it returns the same URL with **no second HTTP call** (`mockFetch.mock.calls` length stays 1 — proves the `Map` is shared, not a fresh copy).
- [ ] Run `npm test` — all tests must pass.
- [ ] Run `npm run typecheck` — no errors.

### Task 2: Document the `withSafety()` clone-field invariant in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

The root cause of issue #333 is that `withSafety()` hand-rolls a clone via `Object.create`, so adding a new `AdtClient` instance field silently regresses unless the field is also re-attached in `withSafety()`. `CLAUDE.md` is the primary guidance autonomous agents (and humans) consult before editing this codebase, but it has no entry capturing this invariant. This task adds one so the next field addition doesn't repeat the bug.

- [ ] In `CLAUDE.md`, add a row to the "Key Files for Common Tasks" table: a task like "Add an `AdtClient` instance field / modify `withSafety()` clone" pointing to `src/adt/client.ts` (`withSafety()` + the field declarations) and `tests/unit/adt/client.test.ts`, with a note that `Object.create(AdtClient.prototype)` bypasses the constructor so **every** instance field must be re-attached via `Object.defineProperty` in `withSafety()` (cite issue #333 as the regression that motivated the rule, and that caches like `tablUrlCache`/`tablWriteUrlCache` are shared by instance, not copied).
- [ ] Verify no other doc, README, roadmap, feature matrix, or skill references `withSafety` or `tablWriteUrlCache` in a way that needs updating (research confirmed only `docs/research/` and `docs/plans/` mention them — these are historical and need no change). This is a verification step; no file edits expected beyond `CLAUDE.md`.
- [ ] Run `npm test` — confirm no tests assert on `CLAUDE.md` contents (none should); all tests must still pass.

### Task 3: Final verification

- [ ] Run full test suite: `npm test` — all tests pass.
- [ ] Run typecheck: `npm run typecheck` — no errors.
- [ ] Run lint: `npm run lint` — no errors.
- [ ] Confirm `src/adt/client.ts` `withSafety()` now re-attaches all 6 instance fields (`http`, `safety`, `username`, `tablUrlCache`, `tablWriteUrlCache`, `packageHierarchyResolverHolder`).
- [ ] Confirm the new unit tests fail without the fix and pass with it (sanity-check the regression is genuinely covered — e.g. temporarily revert the one-block change, observe the new tests fail, then restore).
- [ ] Confirm no manual version bump was made (`package.json` version and `src/server/server.ts` `VERSION` unchanged — release-please handles versioning from the `fix:` commit).
- [ ] Move this plan to `docs/plans/completed/`.
