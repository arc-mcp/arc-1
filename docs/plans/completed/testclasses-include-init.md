# Auto-initialise class-local includes on write (testclasses / CCAU, issue #303 follow-up)

## Overview

PR #307's [author feedback](https://github.com/marianfoo/arc-1/pull/307#issuecomment-4574252428) reported that ARC-1 cannot initialise the `testclasses` include: on a freshly-created class the CCAU include does not exist, and `SAPWrite(action="update", type="CLAS", include="testclasses", source=…)` fails with a cryptic **HTTP 500 `ExceptionResourceSaveFailure: "…CCAU does not have any inactive version"`** because the PUT path assumes the include already exists.

Live verification on a4h (S/4HANA 2023) established the exact mechanism: inside a locked stateful session, an **empty `POST /sap/bc/adt/oo/classes/{name}/includes/{include}?lockHandle=<LH>` returns 201** and creates the include (SAP generates an empty skeleton); the include is then GET-able (200) and PUT-able. A bare POST without a lock returns 423 (`"Resource CLASS_INCLUDE …/TESTCLASSES is not locked"`).

The fix is **transparent auto-initialisation inside the existing `update include=` write path**: lock the class → if the target include is missing, POST-create it (same lock handle) → PUT the content → unlock, all in one stateful session. This is strictly better UX than a separate "init" operation (the LLM just writes the test-class source and it works) and turns the cryptic 500 into a no-op success. A defense-in-depth error classification maps the 500 marker to an actionable hint for any path that bypasses auto-init.

## Context

### Current State

- `update include=…` for CLAS (PR #257) calls `safeUpdateSource(http, safety, classObjectUrl, classIncludeUrl(name, include), source, …)` ([src/handlers/intent.ts:3658](../../src/handlers/intent.ts)). `safeUpdateSource` ([src/adt/crud.ts:210](../../src/adt/crud.ts)) does `withStatefulSession` → `lockObject` → `updateSource` (PUT) → `unlockObject`.
- On a fresh class, `definitions`/`implementations`/`macros` may auto-exist, but **`testclasses` (CCAU) does not** — `GET …/includes/testclasses` → 404 (verified live). The PUT then 500s with `"…CCAU does not have any inactive version"`.
- `classIncludeUrl(name, include)` ([intent.ts:3452](../../src/handlers/intent.ts)) builds `/sap/bc/adt/oo/classes/{name}/includes/{include}`.
- `src/adt/http.ts` exposes `post(path, body?, contentType?, headers?)` and `get(path, …)`. `isNotFoundError(err)` ([src/adt/errors.ts:642](../../src/adt/errors.ts)) detects 404. `classifySapDomainError(...)` ([errors.ts:346](../../src/adt/errors.ts)) maps SAP error bodies to a `SapErrorClassification { category, hint }` union.

### Target State

- A new crud helper `safeUpdateClassInclude(http, safety, classObjectUrl, includeUrl, source, transport?, abapRelease?)` that, in one stateful session: locks the class, GET-probes the include, POST-creates it if missing (`initClassInclude`, using the same lock handle), PUTs the content, unlocks. Returns `{ initialized: boolean }`.
- The `update include=` branch in `intent.ts` calls `safeUpdateClassInclude` instead of `safeUpdateSource` and reflects auto-init in the success message (e.g. "(initialised the testclasses include first)").
- A new `classifySapDomainError` category `'include-not-initialized'` mapping the `"does not have any inactive version"` 500 marker to a hint pointing at the include= write path (defense-in-depth for direct CLI / non-auto-init callers).
- All four optional includes (`definitions`/`implementations`/`macros`/`testclasses`) flow through the same auto-init logic uniformly — the GET-probe makes it a no-op when the include already exists.

### Key Files

| File | Role |
|------|------|
| `src/adt/crud.ts` | New `initClassInclude(http, safety, includeUrl, lockHandle)` (empty POST → create include; `checkOperation(Create)`) and `safeUpdateClassInclude(...)` (lock → GET-probe → POST-if-missing → PUT → unlock; returns `{initialized}`). |
| `src/adt/errors.ts` | New `'include-not-initialized'` category in `classifySapDomainError` (the 500 `"does not have any inactive version"` marker → actionable hint). |
| `src/handlers/intent.ts` | `update include=` branch (~line 3658) calls `safeUpdateClassInclude`; success message notes auto-init when it happened. |
| `tests/unit/adt/crud.test.ts` | `safeUpdateClassInclude` + `initClassInclude` unit tests (exists-skip, missing-init, non-404 propagation, safety gate). |
| `tests/unit/adt/errors.test.ts` | `'include-not-initialized'` classification test. |
| `tests/unit/handlers/intent.test.ts` | `update include=testclasses` auto-init success-message tests. |
| `tests/integration/adt.integration.test.ts` | Live a4h: fresh class → `update include=testclasses` auto-inits + writes + activates → `SAPRead(version=inactive)` shows the test class. |
| `CLAUDE.md` | Update the "Modify CLAS include writes" Key Files row to mention auto-init + the new crud helpers. |
| `docs_page/tools.md` | SAPWrite `include` param note: testclasses (and any missing include) auto-initialises on first write. |
| `compare/00-feature-matrix.md`, `docs_page/roadmap.md` | One-line note. |

### Design Principles

1. **Transparent auto-init beats a separate operation.** The LLM writes the test-class source via the existing `update include=testclasses` and it just works — no new action to discover, no two-step dance. This directly closes the author's "can't initialise" gap.
2. **One lock for init + write.** The POST-create and the PUT share the single class lock inside one `withStatefulSession`. Verified live: `POST …/includes/testclasses?lockHandle=<LH>` (empty body) → 201, then PUT with the same handle succeeds.
3. **GET-probe for missing-include detection, not 500-marker sniffing.** Inside the locked session, `GET includeUrl` → 404 means "not initialised". 404 is release-agnostic; the `"does not have any inactive version"` text is English-only and could shift by login language. The probe costs one extra round-trip on include writes (a deliberate, non-hot-path operation) for deterministic, release-robust behaviour.
4. **Uniform across includes.** definitions/implementations/macros/testclasses all run the same probe→init→write. When the include already exists, the probe returns 200 and init is skipped — so it's safe for the includes that auto-exist.
5. **POST-init is a `Create` mutation.** `initClassInclude` calls `checkOperation(safety, OperationType.Create, 'InitClassInclude')` — gated by `allowWrites` like every other mutation; package gating already happened in the handler before the write.
6. **The hint is defense-in-depth, not the primary fix.** Auto-init means the cryptic 500 no longer surfaces on the include= path. The new `'include-not-initialized'` classification covers any path that hits the raw 500 (direct CLI source PUT, future callers).
7. **No new tool action, no new config flag.** Behaviour is on by default, gated by existing `allowWrites` + package allowlist. A standalone `init_include` action is intentionally NOT added — auto-init covers the use case; revisit only if a "create empty include without content" need emerges.
8. **No auto-activate.** The include write produces an inactive draft, same contract as today; caller runs `SAPActivate`.

## Development Approach

- TDD-ish: crud helper + its unit tests first (mock GET 404 → expect POST → expect PUT), then error classification, then the intent.ts wiring + handler tests, then live a4h integration.
- Branch is off `origin/main` (this work is independent of PR #307's class-section surgery — it extends the pre-existing `update include=` path from #257). When #307 merges, its `edit_class_definition include=` path can adopt `safeUpdateClassInclude` in a later rebase.
- Live-verify on a4h. NW 7.50 writes remain blocked by the pre-existing SAP Note 2727890 lock-handle bug (same baseline as the rest of the include= feature) — the integration test classifies that 423 and moves on.
- Mock pattern: `vi.mock('undici', …)` + `mockResponse()` from `tests/helpers/mock-fetch.ts`. The crud test mocks the GET/POST/PUT/lock/unlock sequence and asserts call order + URLs.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run test:integration` (requires `TEST_SAP_URL`)

### Task 1: crud helpers — `initClassInclude` + `safeUpdateClassInclude`

**Files:**
- Modify: `src/adt/crud.ts`
- Modify: `tests/unit/adt/crud.test.ts`

Add the core auto-init write helper. This is what makes a missing `testclasses` (or any) include get created transparently before the content PUT, in one locked session.

- [ ] In `src/adt/crud.ts`, add `export async function initClassInclude(http: AdtHttpClient, safety: SafetyConfig, includeUrl: string, lockHandle: string): Promise<void>`: `checkOperation(safety, OperationType.Create, 'InitClassInclude')`; build `url = `${includeUrl}?lockHandle=${encodeURIComponent(lockHandle)}``; `await http.post(url, '', undefined)` (empty body, no content-type — verified live to return 201). Add a jsdoc noting the live-verified mechanism (empty POST + lock handle → 201, SAP generates an empty skeleton).
- [ ] Add `export async function safeUpdateClassInclude(http, safety, classObjectUrl, includeUrl, source, transport?, abapRelease?): Promise<{ initialized: boolean }>`. Implementation mirrors `safeUpdateSource` but inside the session: `lockObject` → probe `http.get(includeUrl, undefined, { suppressNotFoundLog: true })` in a try/catch (catch `isNotFoundError` → missing; rethrow others) → if missing, `await initClassInclude(session, safety, includeUrl, lock.lockHandle)` and set `initialized = true` → `updateSource(session, safety, includeUrl, source, lock.lockHandle, effectiveTransport)` → `finally { unlockObject(...) }`. Return `{ initialized }`. Reuse `lock.corrNr` transport fallback exactly as `safeUpdateSource` does.
- [ ] Add unit tests (~6 tests) in `tests/unit/adt/crud.test.ts`: (a) include exists (GET 200) → exactly one PUT, no POST, `initialized=false`; (b) include missing (GET 404) → POST to `…/includes/testclasses?lockHandle=…` then PUT, `initialized=true`; (c) GET returns non-404 error → propagates, no POST/PUT; (d) lock→unlock always called (unlock fires even when PUT throws); (e) `initClassInclude` posts empty body to the lockHandle URL; (f) safety: `checkOperation(Create)` blocks when writes disabled (synthetic safety) → throws `AdtSafetyError`.
- [ ] Run `npm test` — all tests must pass

### Task 2: error classification — `include-not-initialized` hint

**Files:**
- Modify: `src/adt/errors.ts`
- Modify: `tests/unit/adt/errors.test.ts`

Defense-in-depth: any path that hits the raw 500 (e.g. a direct source PUT that bypasses auto-init) should get an actionable message instead of "transient server error, retry".

- [ ] In `src/adt/errors.ts`, add `'include-not-initialized'` to the `SapErrorClassification['category']` union. In `classifySapDomainError(...)`, add a detection branch (before the generic 500 handling): when the body matches `/does not have any inactive version/i` (optionally also confirm `ExceptionResourceSaveFailure` exception type), return `{ category: 'include-not-initialized', hint: 'This class-local include (e.g. testclasses/CCAU) is not initialised yet. Write to it via SAPWrite(action="update", type="CLAS", include="testclasses", source=…) — ARC-1 auto-creates the include before writing. (Direct source PUTs to an un-initialised include fail this way.)' }`.
- [ ] Add a unit test (~2 tests) in `tests/unit/adt/errors.test.ts`: the CCAU 500 body classifies as `include-not-initialized` with the testclasses hint; an unrelated 500 body does NOT match this category.
- [ ] Run `npm test` — all tests must pass

### Task 3: wire auto-init into the `update include=` handler branch

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

Replace the `safeUpdateSource` call in the CLAS `update include=` branch with `safeUpdateClassInclude`, and surface auto-init in the success message so the caller knows the include was created.

- [ ] In `src/handlers/intent.ts`, import `safeUpdateClassInclude` (alongside the existing `safeUpdateSource` import). In the `case 'update'` CLAS `include=` branch (~line 3658), replace `await safeUpdateSource(client.http, client.safety, objectUrl, classIncludeUrl(name, include), source, transport, cachedFeatures?.abapRelease)` with `const { initialized } = await safeUpdateClassInclude(client.http, client.safety, objectUrl, classIncludeUrl(name, include), source, transport, cachedFeatures?.abapRelease)`. Keep `invalidateWrittenObject(type, name)`. Update the success message to append, when `initialized`, e.g. ` (initialised the ${include} include first)`.
- [ ] Add unit tests (~4 tests) in `tests/unit/handlers/intent.test.ts` (reuse/extend the existing include= mock pattern around the `update include` tests): (a) `update include=testclasses` on a class whose include GET returns 404 → success message mentions auto-init, and a POST to `…/includes/testclasses` happened before the PUT; (b) `update include=definitions` on an existing include (GET 200) → normal success message, NO POST; (c) the PUT still targets `…/includes/<inc>`; (d) non-CLAS / missing source guards unchanged (regression).
- [ ] Run `npm test` — all tests must pass

### Task 4: live integration test (a4h)

**Files:**
- Modify: `tests/integration/adt.integration.test.ts`

Prove auto-init end-to-end on a real class: a fresh class has no CCAU include, and a single `update include=testclasses` call creates it, writes the test class, and activates.

- [ ] Add a `describe('CLAS testclasses include auto-init (issue #303 follow-up)')` block using `getTestClient()` + `requireOrSkip(ctx, process.env.TEST_SAP_URL, …)` + `generateUniqueName('ZARC1_TCI')` + `handleToolCall`. Steps in one `it`: create empty CLAS in `$TMP`; `SAPRead(type=CLAS, include=testclasses)` → assert it's absent/empty (the include doesn't exist yet); `SAPWrite(action=update, type=CLAS, include=testclasses, source=<a valid ltc_* FOR TESTING class>, lintBeforeWrite=false)` → assert success + message mentions auto-init; `SAPActivate`; `SAPRead(type=CLAS, include=testclasses, version=inactive|active)` → assert the test class source is present. Cleanup the class in `finally` (`// best-effort-cleanup`).
- [ ] On NW 7.50, the write trips the SAP Note 2727890 lock-handle 423 — wrap with `expectSapFailureClass(err, [423], [/invalid lock handle/i])` so the suite classifies rather than hard-fails (mirror the existing include= integration tests).
- [ ] Run `npm run test:integration` against a4h — the new test PASSES (`TEST_SAP_URL=http://a4h.marianzeis.de:50000`).
- [ ] Run `npm test` — unit tests still pass.

### Task 5: documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs_page/tools.md`
- Modify: `compare/00-feature-matrix.md`
- Modify: `docs_page/roadmap.md`

User-visible behaviour change → update the artifact surface. No code changes.

- [ ] `CLAUDE.md`: update the "Modify CLAS include writes" Key Files row to note that `update include=` auto-initialises a missing include via `safeUpdateClassInclude` (`src/adt/crud.ts`), with the live-verified empty-POST-with-lock → 201 mechanism, and the new `include-not-initialized` error category.
- [ ] `docs_page/tools.md`: in the SAPWrite `include` parameter description, add that writing to an un-initialised class-local include (notably `testclasses`/CCAU on a fresh class) auto-creates it on first write — no separate init step.
- [ ] `compare/00-feature-matrix.md`: prepend a dated note (testclasses/CCAU include auto-init on write) and bump "Last Updated"; `docs_page/roadmap.md`: extend the relevant CLAS-write entry.
- [ ] Run `npm test` and `npm run lint` — no errors.

### Task 6: Final verification + new PR

- [ ] Run full unit suite: `npm test` — all pass
- [ ] `npm run typecheck` — no errors
- [ ] `npm run lint` — no errors
- [ ] Integration on a4h: `TEST_SAP_URL=http://a4h.marianzeis.de:50000 TEST_SAP_USER=MARIAN TEST_SAP_PASSWORD=<from .env> TEST_SAP_CLIENT=001 npm run test:integration -- adt.integration` — auto-init test PASSES
- [ ] Commit on branch `feat/testclasses-include-init` (off `origin/main`); push; open a NEW PR (do NOT touch PR #307). PR body: links the author comment, summarises the verified mechanism (404 → empty-POST-with-lock → 201) and the transparent auto-init design.
- [ ] Move this plan to `docs/plans/completed/testclasses-include-init.md`
