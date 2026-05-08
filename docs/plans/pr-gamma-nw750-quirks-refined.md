# PR-γ — NW 7.50 Quirks (refined): Lock-conflict reclassification + MSAG transport guard

## Overview

This PR ships the genuinely NW-7.50-specific runtime behavior bundled in [PR #196](https://github.com/marianfoo/arc-1/pull/196), refined per the layered-detection design (ADR-0002 in [PR #199](https://github.com/marianfoo/arc-1/pull/199)):

- **Lock-conflict reclassification.** NW 7.50's ICM transforms `CX_ADT_RES_NO_ACCESS` (lock conflict on `lockObject` / `createObject`) into a 401 HTML "Logon Error Message" page. PR #196 reclassifies these 4xx HTML responses into a clean 409 lock conflict so the LLM doesn't chase auth red herrings. This PR keeps the intent but replaces the fragile body-string heuristic with a layered detection strategy: structured exception type first, body-marker fallback gated by a release feature signal.
- **MSAG transport-vs-task guard.** NW 7.50's `CL_ADT_MESSAGE_CLASS_API=>create()` silently ignores task numbers passed as `corrNr` — TADIR records the entry but T100/T100A are never written, leaving a phantom MSAG. The behavior is "confirmed on NW 7.50, unclear elsewhere" per the PR comment. Validate the transport-id-is-a-request before MSAG create on every release; cache the result within the request to avoid extra HTTP roundtrips on every MSAG batch_create.

This PR is the third of three "ship-now" splits of [PR #196](https://github.com/marianfoo/arc-1/pull/196). The cookie hot-reload work ships in PR-α; the universal sync + write guards ship in PR-β. The release-gated tool enums and TABL→STRU routing **do not ship here** — they are deferred until ARCH-01 (discovery-driven routing) lands. The full architectural rationale (ADR-0001 / ADR-0002) lives in [PR #199](https://github.com/marianfoo/arc-1/pull/199); this PR does not depend on #199 merging first.

## Context

### Current State

- [src/adt/crud.ts](../../src/adt/crud.ts) `lockObject` (lines 23–63) catches errors and reclassifies any 400/401/403 + body-contains-`"Logon Error Message"` as a synthetic 409 lock-conflict. The check is inline and not reused.
- [src/adt/crud.ts](../../src/adt/crud.ts) `createObject` (lines 87–119) does **not** apply the same reclassification today. PR #196 factored the inline check into a helper (`rethrowIfNw750LockConflict`) and reused it in `createObject`.
- The body-marker heuristic is fragile in two ways:
    1. Live probe (2026-04-28) of A4H 758 SP02 confirmed its 401 response title is `Anmeldung fehlgeschlagen`, no `Logon Error Message` anywhere — so the heuristic happens to fire only on NPL because of a UI-language difference, not because of a SAP_BASIS-version difference.
    2. The same body marker covers both *locked* and *already-exists* cases on `createObject`, but PR #196's error message says only "locked by another session", which is misleading when the actual cause is "already exists".
- [src/adt/errors.ts](../../src/adt/errors.ts) `extractExceptionType` already extracts `<exc:exception><type id="…"/>` from structured ADT XML errors. The `classifySapDomainError` machinery already handles `ExceptionResourceLockedByAnotherUser` and `ExceptionResourceInvalidLockHandle`. The lock-conflict-via-`CX_ADT_RES_NO_ACCESS` flavor (which surfaces as `ExceptionResourceNoAccess`) is **not** currently in the classifier.
- [src/handlers/intent.ts](../../src/handlers/intent.ts) `handleSAPWrite` MSAG path does not validate the transport ID against the request-vs-task distinction. PR #196 added a `getTransport(client.http, client.safety, effectiveTransport)` call before MSAG create; if `null` is returned, the call is rejected with a clear error.

### Target State

- A renamed helper `convertHtmlConflictToProperError(err, objectUrl, cachedFeatures?)` in [src/adt/crud.ts](../../src/adt/crud.ts) returns `AdtApiError | undefined`. Caller throws explicitly: `const conv = convertHtmlConflictToProperError(err, objectUrl, cachedFeatures); if (conv) throw conv; throw err;`.
- Layered detection per ADR-0002:
    1. Structured exception path: when `extractExceptionType(body)` returns a known lock-conflict type (`ExceptionResourceNoAccess`, `ExceptionResourceLockedByAnotherUser`), reclassify regardless of HTTP status.
    2. HTML fallback path: only when content is HTML, status is 4xx, **and** `cachedFeatures?.abapRelease` parses to `< 751` (or is undefined for CLI/test entry points), use the body-marker heuristic with a neutral message: *"Operation conflicted on `{name}` — object may be locked or already exist. Run SAPSearch to verify, then either update the existing object or wait for the lock to release (SM12)."*
- Both `lockObject` and `createObject` use the helper. The helper is added to `classifySapDomainError`'s known categories so the existing LLM-formatting machinery picks it up.
- MSAG transport guard runs on every release, with the `getTransport(...)` result cached within the request scope (not at module level) to avoid the HTTP roundtrip on every object inside a `batch_create`.
- 5 unit tests cover the four detection paths plus a structured-exception positive case.
- Documentation: `CLAUDE.md` Key Files row for "Add SAP version-quirk workaround" updated to point at the new layered detection helper instead of the old body-marker example.

### Key Files

| File | Role |
|------|------|
| `src/adt/crud.ts` | Replace `rethrowIfNw750LockConflict` with `convertHtmlConflictToProperError`; reuse in `lockObject` and `createObject`; pass `cachedFeatures?.abapRelease` (read via a new optional parameter) to scope the HTML fallback |
| `src/adt/errors.ts` | Optional: add a known-types entry for `ExceptionResourceNoAccess` to `classifySapDomainError` lock-conflict path so the message is consistent with the existing `ExceptionResourceLockedByAnotherUser` flavor |
| `src/handlers/intent.ts` | Pass `cachedFeatures` (or just `cachedFeatures?.abapRelease`) into the `lockObject` / `createObject` call path; add MSAG transport-vs-task guard in `handleSAPWrite` `case 'create'` and inside `batch_create` loop with per-batch transport-cache |
| `tests/unit/adt/crud.test.ts` | Replace the 4 PR #196 tests with 5 layered-detection tests |
| `tests/unit/handlers/intent.test.ts` | Add MSAG transport-vs-task guard tests |
| `CLAUDE.md` | Update "Key Files for Common Tasks" row for "Add SAP version-quirk workaround" + add a note about the layered detection invariant |

### Design Principles

1. **Structured exceptions first, heuristics last.** Layer 1 (structured exception type) is the authoritative signal — works on every release that emits ADT structured errors. Layer 2 (HTML body-marker) is dormant unless we know we're on a system that needs it.
2. **The `cachedFeatures` guard narrows, never expands.** When `cachedFeatures?.abapRelease >= 751`, the HTML fallback is disabled. When `cachedFeatures` is `undefined` (CLI / test paths before startup probe), the fallback runs defensively. This guarantees modern systems never have the fragile branch in their hot path.
3. **Neutral messaging when the cause is ambiguous.** The HTML fallback fires on both lock-conflict and already-exists cases (NPL emits the same body for both). The error message reflects this honestly: *"object may be locked or already exist"*. The structured-exception path uses the existing `lock-conflict` message because the type id disambiguates.
4. **MSAG transport guard is universal.** Per the PR #196 comment, the bug is confirmed on NW 7.50 and "unclear whether later releases fixed it, so validate everywhere." The cost is one HTTP roundtrip per MSAG create; the cache-within-request mitigates batch_create overhead.
5. **No `isRelease750()` helper required outside the lock-conflict helper.** The release check lives only inside `convertHtmlConflictToProperError`. Other parts of the codebase do not learn about NW 7.50 specifics.

## Development Approach

Implement in three small passes: refactor and refine the helper, wire it into both call sites with the feature-aware parameter, add the MSAG guard, then tests and docs. The structured-exception detection reuses the existing `extractExceptionType` from [src/adt/errors.ts](../../src/adt/errors.ts) — no new XML parsing.

For the MSAG transport-cache, scope the cache to a per-call `Map<string, TransportRequest | null>` passed into the batch loop. Cache size is bounded by the number of unique transport IDs in a single batch; no module-level state is added.

## Validation Commands

- `npm test`
- `npm test -- tests/unit/adt/crud.test.ts`
- `npm test -- tests/unit/adt/errors.test.ts`
- `npm test -- tests/unit/handlers/intent.test.ts`
- `npm run typecheck`
- `npm run lint`

### Task 1: Refactor lock-conflict helper into layered detection

**Files:**
- Modify: `src/adt/crud.ts`

Replace the inline body-marker check in `lockObject` and the PR-196 helper in `createObject` with a single shared layered-detection function.

- [ ] Add a helper at the bottom of `src/adt/crud.ts` (below `extractXmlValue`):
    ```ts
    /**
     * Convert an ICM-intercepted lock/exists conflict into a clean AdtApiError.
     *
     * Two-layer detection:
     *   1. Structured exception: <exc:exception><type id="ExceptionResourceNoAccess"/>
     *      → reclassify regardless of status.
     *   2. HTML fallback: HTML body + 4xx status + abapRelease<751 (or unknown).
     *      Use neutral phrasing because the ICM intercept loses cause info
     *      (lock vs already-exists are indistinguishable here).
     *
     * Returns the reclassified AdtApiError (caller throws), or undefined when
     * the original error should be rethrown unchanged.
     */
    export function convertHtmlConflictToProperError(
      err: unknown,
      objectUrl: string,
      abapRelease?: string,
    ): AdtApiError | undefined {
      if (!(err instanceof AdtApiError)) return undefined;
      const body = err.responseBody ?? '';
      const name = objectUrl.split('/').pop() ?? objectUrl;

      // Layer 1: structured exception type
      const typeId = extractExceptionType(body);
      if (typeId === 'ExceptionResourceNoAccess' || typeId === 'ExceptionResourceLockedByAnotherUser') {
        return new AdtApiError(
          `Object ${name} is locked by another session. Close the editor (Eclipse, SE80) or release the lock in SM12, then retry.`,
          409,
          objectUrl,
          body,
        );
      }

      // Layer 2: HTML fallback, scoped by release
      const release = parseReleaseNum(abapRelease);
      const fallbackEligible = release === 0 || release < 751;
      const isHtml4xx =
        (err.statusCode === 400 || err.statusCode === 401 || err.statusCode === 403) &&
        body.includes('<html') &&
        body.includes('Logon Error Message');
      if (fallbackEligible && isHtml4xx) {
        return new AdtApiError(
          `Operation conflicted on ${name} — object may be locked by another session or already exist. ` +
          `Run SAPSearch to verify the object exists, then either update the existing object or wait for the lock to release (SM12).`,
          409,
          objectUrl,
          body,
        );
      }

      return undefined;
    }

    function parseReleaseNum(abapRelease?: string): number {
      if (!abapRelease) return 0;
      const num = Number.parseInt(abapRelease.replace(/\D/g, ''), 10);
      return Number.isFinite(num) ? num : 0;
    }
    ```
    Import `extractExceptionType` from `'./errors.js'` at the top of the file.
- [ ] In `lockObject`, replace the inline body-marker `try/catch` block with:
    ```ts
    } catch (err) {
      const conv = convertHtmlConflictToProperError(err, objectUrl /* abapRelease passed via caller */);
      if (conv) throw conv;
      throw err;
    }
    ```
    For the initial step, do not yet pass `abapRelease` — that wires through Task 2. The Layer-1 (structured exception) path still functions without it.
- [ ] In `createObject`, replace the inline `rethrowIfNw750LockConflict` call with:
    ```ts
    const conv = convertHtmlConflictToProperError(err, objectUrl);
    if (conv) throw conv;
    ```
    Place this **before** the existing `CONTENT_TYPE_FALLBACKS` block so the conflict reclassification takes precedence.
- [ ] Run `npm test -- tests/unit/adt/crud.test.ts` — existing tests should pass once the new helper is in place.

### Task 2: Wire `cachedFeatures.abapRelease` into the helper call path

**Files:**
- Modify: `src/adt/crud.ts`
- Modify: `src/handlers/intent.ts`

The HTML fallback is dormant on modern systems. Pipe the `abapRelease` string from `cachedFeatures` to the helper through optional parameters on `lockObject` and `createObject`.

- [ ] In `src/adt/crud.ts`, add an optional `abapRelease?: string` parameter to `lockObject(http, safety, objectUrl, accessMode='MODIFY', abapRelease?)`. Pass it to `convertHtmlConflictToProperError(err, objectUrl, abapRelease)` in the catch block.
- [ ] Same for `createObject(http, safety, objectUrl, body, contentType, transport?, packageName?, abapRelease?)`. Pass it to the helper.
- [ ] In `src/handlers/intent.ts`, locate every call to `lockObject(...)` and `createObject(...)` (search the file). Append `cachedFeatures?.abapRelease` as the new last argument. Examples:
    - `lockObject(session, client.safety, objectUrl)` → `lockObject(session, client.safety, objectUrl, 'MODIFY', cachedFeatures?.abapRelease)`
    - `createObject(client.http, client.safety, objectUrl, body, contentType, transport, pkg)` → `createObject(client.http, client.safety, objectUrl, body, contentType, transport, pkg, cachedFeatures?.abapRelease)`
- [ ] Run `npm run typecheck` — no errors.
- [ ] Run `npm test` — all tests pass.

### Task 3: Add `ExceptionResourceNoAccess` to the lock-conflict classifier

**Files:**
- Modify: `src/adt/errors.ts`
- Modify: `tests/unit/adt/errors.test.ts`

The existing `classifySapDomainError` lock-conflict branch handles `ExceptionResourceLockedByAnotherUser`. Add `ExceptionResourceNoAccess` so the LLM-facing classification is consistent across both code paths.

- [ ] In `classifySapDomainError`, in the lock-conflict branch (around line 80), extend the typeId check:
    ```ts
    if (
      typeId === 'ExceptionResourceLockedByAnotherUser' ||
      typeId === 'ExceptionResourceNoAccess' ||
      ((statusCode === 409 || statusCode === 403) && lockPattern)
    ) {
    ```
- [ ] Add a unit test in `tests/unit/adt/errors.test.ts`:
    - **Test**: `classifySapDomainError(409, '<exc:exception><type id="ExceptionResourceNoAccess"/></exc:exception>')` returns `category: 'lock-conflict'`.
- [ ] Run `npm test -- tests/unit/adt/errors.test.ts` — all tests must pass.

### Task 4: Tests for layered detection

**Files:**
- Modify: `tests/unit/adt/crud.test.ts`

Replace the four PR #196 tests with five tests covering the layered detection contract.

- [ ] Under a new `describe('convertHtmlConflictToProperError', …)` block, add (~5 tests):
    - **Test 1 (structured exception, any status)**: `<exc:exception><type id="ExceptionResourceNoAccess"/></exc:exception>` body with statusCode `403` → returns AdtApiError(409) with message containing "locked by another session". `abapRelease` not passed.
    - **Test 2 (structured exception on modern release)**: same body, statusCode `403`, `abapRelease='758'` → still returns AdtApiError(409) (Layer 1 fires regardless of release).
    - **Test 3 (HTML fallback, NW 7.50, lock case)**: HTML body containing `<title>Logon Error Message</title>`, statusCode `401`, `abapRelease='750'` → returns AdtApiError(409) with message containing "may be locked or already exist" (neutral phrasing).
    - **Test 4 (HTML fallback NOT triggered on modern release)**: same HTML body, statusCode `401`, `abapRelease='758'` → returns `undefined` (caller will throw the original error).
    - **Test 5 (real auth 401)**: plain-text non-HTML body `Authentication required`, statusCode `401`, no marker → returns `undefined` (no reclassification).
- [ ] Update existing `lockObject` tests in `tests/unit/adt/crud.test.ts` to pass `abapRelease` where appropriate (mostly: omit it, since the new layered helper still defaults to "fallback eligible" when release is unknown — preserves current behavior on test paths).
- [ ] Run `npm test -- tests/unit/adt/crud.test.ts` — all tests must pass.

### Task 5: MSAG transport-vs-task guard with per-call cache

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

Validate that the transport ID passed to a MSAG create is a request, not a task — silently-ignored task numbers leave phantom MSAGs on NW 7.50 and possibly later releases.

- [ ] In `handleSAPWrite` `case 'create'` for `type === 'MSAG'`, before the lock+create chain, add:
    ```ts
    if (type === 'MSAG' && effectiveTransport) {
      const tr = await getTransport(client.http, client.safety, effectiveTransport);
      if (!tr) {
        return errorResult(
          `Transport "${effectiveTransport}" is not a valid transport request. ` +
          `MSAG creation requires a transport request number, not a task number. ` +
          `Use SAPTransport(action="get", id="<request>") to verify, or SAPTransport(action="list") to find modifiable requests.`,
        );
      }
    }
    ```
- [ ] In `batch_create`, before the per-object loop, declare `const transportCache = new Map<string, TransportRequest | null>();`. Inside the loop for MSAG entries, use the cache:
    ```ts
    if (objType === 'MSAG' && objTransport) {
      let tr = transportCache.get(objTransport);
      if (tr === undefined) {
        tr = await getTransport(client.http, client.safety, objTransport);
        transportCache.set(objTransport, tr);
      }
      if (!tr) {
        results.push({ type: objType, name: objName, status: 'failed', error: `Transport "${objTransport}" is not a valid transport request. MSAG creation requires a transport request number, not a task number.` });
        continue;
      }
    }
    ```
- [ ] Add unit tests (~3 tests) in `tests/unit/handlers/intent.test.ts`:
    - **Test 1**: `SAPWrite(action='create', type='MSAG', name='ZTEST', transport='TASK')` where `getTransport` returns `null` → returns error result whose text contains "not a valid transport request".
    - **Test 2**: Same but `getTransport` returns a real transport object → proceeds to lock+create (mock returns success).
    - **Test 3**: `batch_create` with three MSAG objects sharing the same transport → `getTransport` is called exactly once (cache hit on entries 2 and 3).
- [ ] Run `npm test -- tests/unit/handlers/intent.test.ts` — all tests must pass.

### Task 6: Documentation

**Files:**
- Modify: `CLAUDE.md`

Update the "SAP version-quirk workaround" Key Files row to point at the layered detection helper as the canonical pattern, replacing the old body-marker example.

- [ ] In `CLAUDE.md` Key Files for Common Tasks table, update the row labeled "Add SAP version-quirk workaround (NW 7.50 / S/4 gating)":
    > Prefer structured-exception detection (`extractExceptionType` in `src/adt/errors.ts`) when SAP emits an XML error body. Fall back to body-marker heuristics only when wrapped in a release-scoped guard — see `convertHtmlConflictToProperError` in `src/adt/crud.ts` for the canonical pattern (Layer 1 = structured exception type, Layer 2 = HTML body marker scoped to `cachedFeatures.abapRelease < 751`). Inline-comment WHY the heuristic self-scopes so future readers don't hunt for context.
- [ ] Run `npm run lint` — no new lint errors.

### Task 7: Final verification

- [ ] Run `npm test` — all unit tests pass (target: ~5 layered-detection tests, ~3 MSAG guard tests, +1 errors classifier test).
- [ ] Run `npm run typecheck` — no errors.
- [ ] Run `npm run lint` — no errors.
- [ ] When `TEST_SAP_URL` is configured for both A4H and NPL: smoke-test `SAPWrite(action='create', type='DDLS', name='ZARC1_DUP', package='$TMP', source='…')` twice in a row — first creates, second should now return the neutral conflict message instead of an auth error.
- [ ] Move this plan to `docs/plans/completed/`.
