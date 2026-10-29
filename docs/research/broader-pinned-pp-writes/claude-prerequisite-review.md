No security or blocking findings for this chunk. It is fine as the PR2 package-hierarchy prerequisite once the plan-required cancellation test (test gap 1) is added. I found three low-severity issues. I reviewed the six frozen inputs plus the linked code, read-only; the working tree matches the diff. I didn't run tests or recompute the manifest hashes, and I'm not claiming any live evidence.

## Findings introduced by this chunk

**1. Low: every pinned check now walks the whole subtree with no cache, once per gate.**
Where: `src/adt/package-hierarchy.ts:39` (`ttlMs: 0`), `src/adt/safety.ts:260-265`, `src/adt/package-hierarchy.ts:136-159`.
- **What happens:** `checkPackage` passes one resolver to both the server gate and the destination gate. With no reuse, a root used by both gates (e.g. both `ZROOT/**`) is walked twice per check. Each walk covers the entire subtree before checking membership: one sequential nodestructure POST per package, up to 10,000.
- **Cost per call:**
  - A write does up to 4 full walks (preflight at `pinned.ts:84`/`:86`, then under the lock at `pinned.ts:126`). Two of them run while the ADT lock is held.
  - An activation does up to 6 (`pinned-activation.ts:45`, then `devtools.ts:233` and `:259` via `pinned-activation.ts:52`).
- **Before:** multi-target clients are created per request (`server.ts:387-390`), so the old cache only ever spanned checks within one request: one walk per root per request.
- **Impact:** it fails closed (an expired deadline means a denial), so this costs availability and lock-hold time, not security. A large subtree can use up the 300 s budget.
- **Fix:** cache per `checkPackage` decision, e.g. wrap the resolver inside the `multiTargetWrite` branch so both gates share one snapshot. Keep `ttlMs: 0` on the instance so a reused resolver can't carry a stale "allowed" result into the under-lock check. Optionally stop the walk early once the package is found.

**2. Low, hardening (no current impact): the copied request policy carries unrelated options into hierarchy reads.**
Where: `src/adt/package-hierarchy.ts:38`.
- `{ ...options, retryTransientErrors: false }` passes `attemptBudget`, `responseBudget`, `discardResponseBody`, `probe` and `fetchTimeoutMs` through to every hierarchy POST and its CSRF fetch.
- Today's callers only pass deadline, signal, noReplay and retry (`mutation-context.ts:64`, `pinned-activation.ts:39-44`), so nothing goes wrong yet.
- PR2 will route more combined policies through `enforceAllowedPackageForObjectUrl`. Then hierarchy reads could use up a mutation's send allowance, or a discarded body could be read as "no subpackages". Both fail closed but cause false denials.
- **Fix:** build the copy from an explicit list: `{ deadline, signal, noReplay: true, retryTransientErrors: false }`. The caller's policy itself is not modified: the copy is new and frozen.

**3. Low: docs are out of date.**
`docs/dev-guide.md:326` (the row AGENTS.md points to) and the header at `src/adt/package-hierarchy.ts:11-24` still say all checks use a time-limited cache shared across clones. Pinned checks no longer use that shared cache: they build a fresh resolver per check, bound to the request policy. One clause in each place fixes it.

## Preexisting issues (not introduced; track for PR2)
- **Activation has its own budget:** `activate()` starts a fresh 300 s budget (`devtools.ts:182-188`, `:215`) instead of using the outer pinned deadline (`pinned-activation.ts:39-44`). Plan §4 item 4 requires nested activation to share the outer budget. Hierarchy reads inside `validateReferences` use the earlier outer deadline, so this chunk doesn't widen the gap.
- **Cancellation reads like a policy refusal:** a cancel or timeout during the walk is rewrapped as an `AdtSafetyError` (`package-hierarchy.ts:119-127`, `safety.ts:301-305`) and reported as `PINNED_WRITE_REFUSED`. The state is still accurate and the cause text is kept. What's new is that a cancellation can now happen during the walk.

## Checked, nothing found
- **Single-target regression:** none. `multiTargetWrite` is only set by `buildMultiTargetConfig` (`multi-target-runtime.ts:122`). The legacy shared resolver and the original 4-argument POST are unchanged (`client.ts:340-345`, `:1297-1299`). Outside pinned mode the hierarchy check ignores the new `options` argument (`write-helpers.ts:949`).
- **Deadline and cancellation:** they don't escape the walk or the CSRF fetch. The frozen policy reaches every POST.
  - Cancellation is checked before a request waits for a slot (`http.ts:368`).
  - The slot wait, the session gate, token fetches and the CSRF fetch (including its 503 retry sleep) all respect the budget (`http.ts:372-375`, `security-session-gate.ts:34-38`, `http.ts:1458-1463`, `:439-441`, `:1016-1100`).
  - Sends use `requestSignal` (`http.ts:1419`, `:1494`), so a cancel between levels stops at the next request.
  - `noReplay` blocks 401, CSRF-403, content-negotiation and transient retries (`http.ts:539`, `:703-708`, `:776`, `:800`).
- **Stale cached positives / identities:** none. Each check gets a new resolver; the shared cache is never filled in pinned mode; the fetcher uses the per-request principal-propagation client. The new handler test shows the preflight "allowed" result isn't reused under the lock (`checks === 2`).
- **Missing policy:** no bypass. The resolver is built before `checkPackage` runs, so a missing or replayable policy throws before any SAP request, even when the package matches exactly. All resolvers come from `getPackageHierarchyResolver` (`client.ts:339`, `:341`). Older callers that pass no options would now throw in multi-target mode, but `write.ts:65` and `activate.ts:115` send every multi-target call to the pinned handlers first. That makes it a useful tripwire for PR2.
- **Server/destination gates:** still evaluated independently (`safety.ts:257-266`), and both now get fresh, time-bounded data.
- **Capabilities:** none expanded. `getSubpackages` is in the extension read-only API (`read-only-client.ts:51`); its new optional `options` argument matches `resolveObjectPackage` and grants nothing new.

## Test gaps
1. **Required by plan §4 line 187 (also PR1 review F4):** a handler-level test that aborts *during* the walk.
   - In preflight: assert no LOCK, source GET or PUT follows.
   - Under the lock: assert no further hierarchy request, no PUT, and that UNLOCK is still attempted.
   - `pinned-package-hierarchy.test.ts:79-94` only shows that no child request is sent.
2. `handlePinnedActivation` with a subtree rule: the policy reaches all three checks, and if the package moves out of scope before `validateReferences`, no activation POST is sent.
3. Create preflight (`pinned.ts:84`) with a subtree rule.
4. A subtree rule on the server gate. The new handler test only exercises the destination gate (the server gate there is an exact `$TMP` match). Add server `ZG/**` with destination `ZD/**` (package only under ZD: deny), plus a case where both gates use the same root.
5. Signal identity: run the new test inside `requestContext.run({ signal })` and assert the hierarchy calls get that signal. `pinned-writes.test.ts:251-252` only checks noReplay and the deadline.
6. Clone isolation: fill the legacy cache on a single-target client, clone it with `withSafety({ …multiTargetWrite })`, and assert the pinned check fetches again.
7. CSRF within the budget:
   - Abort during the CSRF fetch: no nodestructure POST.
   - Nodestructure returns 403: exactly one POST, then a denial.
   - `pinned-package-hierarchy.test.ts:57-68` mocks `http.post`, so it never reaches the CSRF fetch.
8. Tighter assertions: check `phase: 'locked-policy'` and `state: 'unchanged'` in the new handler test, and the error class instead of a bare `.rejects.toThrow()` at `pinned-package-hierarchy.test.ts:75` and `:92`.

## Verdict
Acceptable for this chunk once test gap 1 is added. I'd also fix Finding 1 before subtree rules are used more widely.