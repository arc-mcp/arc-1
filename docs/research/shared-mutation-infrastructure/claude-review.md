## Verdict

From a static review, PR 1 stays inside its intended scope. I found no regression in either single-target or pinned behaviour, nothing that changes public surfaces, and no PR 2 work pulled in early. Nothing blocks this PR. There are two low-severity test gaps, one latent design hazard to fix before PR 2 builds on the new request-scoping wrapper, and one gap that predates this PR. Live PP qualification is still outstanding. This is not a merge or deploy approval.

**Inputs:**
- `review2.patch`: baseline `721755d5` → candidate. It contains only `src/` and `tests/` changes, no `docs/`.
- `gate-results.json`: all six checks exit 0. The JSON has no test count, so I couldn't confirm the 10,323 figure.
- The plan doc, plus 19 of my 20 allowed targeted reads. `crud.ts` and `pinned.ts` on disk match the patch.

## Before/after behaviour I verified

**Single-target (`safeUpdateSource`, `safeUpdateClassInclude`): same requests on the wire.**
- `withLockedMutation` passes `context.requestPolicy === undefined` to `lockObject` (`src/adt/crud.ts:122`).
  - `localityKnown` is only added when options are truthy (`crud.ts:81`), so an explicit `undefined` behaves exactly like no argument.
- The session is opened with a single argument (`src/adt/mutation-http.ts:32`), as before.
- `mutationHttp` returns the same object in single-target mode, so source transforms still receive the owning session.
- Unlock stays in a plain `finally` (`crud.ts:127-129`), preserving the legacy rule that an unlock error replaces the primary error.
- The new `checkOperation(..., 'MutationSession')` (`crud.ts:118`) has no side effects (`safety.ts:141-147`). An identical Update check always runs first (`UpdateSource`, or `pinned.ts:40`), so error messages and ordering don't change.
- The include sequence (lock → 404 probe → initialise → save → unlock → `{initialized}`) moved intact.

**Pinned path: same requests and outcomes.**
- `context.requestPolicy` holds the same values as the old inline options object.
- The order of phase updates, cancellation check, lock, locked-policy checks, save and readback is unchanged.
- Unlock still runs on the owning session with a fresh 30 s budget, no abort signal and no replay. A failed unlock is recorded without replacing the primary error (`crud.ts:130-142`).
- Session close keeps `{30 s, noReplay, onClose}` (`mutation-http.ts:34-42`).
- Freezing the policy object is safe: grep finds no code in `src` that modifies request options in place.
- The nested helpers already passed `options` through: `transport.ts:1221-1227`, `write-helpers.ts:942` and `:1310-1316`, `pinned-write-policy.ts:52,75,114,136,161`.
  - So routing them through the wrapper changes no request options today.
  - What the wrapper adds is a guarantee that nested code can't weaken the policy. It forces the no-replay flags, can only shorten the deadline (`Math.min`), rejects NaN/Infinity deadlines, and combines abort signals (`mutation-http.ts:45-58`).
- `AbortSignal.any` is safe on the required Node ≥22.19 (`package.json:14`).
- The transport's replay branches are gated by `noReplay`/`retryTransientErrors` (`http.ts:539-561`, plus 707/776/800 by grep).

**Cleanup runs on the owning session.**
- The wrapper is unwrapped back to the original transport before the session opens (`mutation-http.ts:15-20`).
- `closeStatefulSession` never throws (`http.ts:348-356`), so `onClose` always fires.

**Context checks (missing, copied or mismatched).**
- The context is a required parameter. Contexts are registered in a WeakSet, so a copied object is refused.
- A pinned context is tied to the `multiTargetWrite` policy object and its `enabled` flag, and this is rechecked on every request (`mutation-http.ts:68-71`).
- `owningHttp` throws if a wrapper is reused with a different context. This also stops a pinned wrapper being passed into `safeUpdateSource` with different safety settings.

**The new refusal in the legacy wrappers can't be reached in production.**
- Every config that carries `multiTargetWrite` also sets `multiTargetEndpoints` and `targetId` (`multi-target-runtime.ts:93,96,122`). `src/handlers/write.ts:65` sends all of those to the pinned handler.
- Disabled policies are already blocked by `safety.ts:124`.

**Shared state across requests:** none apart from WeakSet/WeakMap entries keyed by object identity.

**Results and activation:** `pinnedFailure` was moved unchanged. The activation file only changed an import.

**Production adoption is real:**
- `safeUpdateSource`: `create.ts:844,1164`, `update-delete.ts:187`
- `safeUpdateClassInclude`: `update-delete.ts:92`, `class-surgery.ts:169`
- `handlePinnedWrite`, reached via `write.ts:65`

## Findings

### F1: Sessions opened through the wrapper overwrite the owning session's cleanup status (low, latent, optional before PR 2)

- **Where:**
  - The wrapper's `withStatefulSession` (`mutation-http.ts:82-83`) goes through `:34-42`, which attaches `pinnedSessionCleanup(context)`.
  - That callback writes the shared `cleanup.sessionClosed` (`mutation-context.ts:88-90`).
  - `pinnedFailure` reports that field as "the owning session was closed" (`pinned-result.ts:37-40`).
- **Mechanism:**
  - Any pinned session opened through the wrapper overwrites the field. That includes nested calls (`session.withStatefulSession`) and sibling calls (`scopedHttp.withStatefulSession`).
  - Today's output is correct only because no pinned helper opens a session, and the owner's `onClose` always fires last.
  - A sibling session followed by a throw inside `withLockedMutation` before its session opens would report another session's status.
  - A nested session is also a new SAP context that does not hold the lock (`http.ts:299` drops `sap-contextid`). A PR 2 adapter could reasonably assume it does.
- **Classification:** not a regression; no PR 1 production path reaches it.
- **Optional fix:**
  - Let only `withLockedMutation`'s owning session write `cleanup.sessionClosed`.
  - Give nested sessions opened through the wrapper the bounded, no-replay close without the shared callback.
  - Refuse or document nested sessions while a lock is held.
- **Tests:**
  - Inside a pinned `withLockedMutation` operation, call `session.withStatefulSession` and make the nested close fail. Assert it gets a distinct `sap-contextid` and that `cleanup.sessionClosed` reflects only the owning session's close.
  - Open a sibling session, then fail before the owning session opens. Assert `sessionClosed` is absent from the `pinnedFailure` JSON.

### F2: The isolation test doesn't reach the evidence the acceptance matrix asks for (low, test completeness)

- **Where:**
  - `tests/unit/adt/mutation-isolation.test.ts:15-93`: contexts at `:36-57`, do-nothing policies at `:66-71`, status-only assertion at `:76`.
  - Plan acceptance row at `:186`.
- **Gaps:**
  - (a) The test skips `handlePinnedWrite`, `pinnedRecording` and `pinnedFailure`. So it never checks the transport-recording evidence (`transport` / `recording.request`) or the audit `target` / `requestId`, all of which that row names.
  - (b) Each context changes the target *and* the user at the same time. The same-target, two-user case is not covered. That is the case where both requests could share the one policy object that `assertMutationContext` checks against (`mutation-context.ts:72-79`).
  - (c) The cause of the first rejection isn't asserted. An error after the lock but before the PUT would still pass, because the unlock and close assertions also hold in that case.
- **Suggested tests:**
  - Assert `results[0].reason` is the cancellation.
  - Run two `handlePinnedWrite` calls concurrently in separate request contexts: same object name, one in a transportable package. Assert each result's `target`, `requestId` and `transport`, and that each host received its own transport-check, PUT and UNLOCK requests.
  - Add a same-target, two-user variant.
- **Optional hardening:** record the originating client on the context and refuse a different owner in `owningHttp`. That turns "the request owns its client" into a checked rule rather than a convention.

### F3: The no-replay test matrix has no "response lost" case (low, test completeness)

- **Where:** `tests/unit/adt/mutation-lifecycle.test.ts:141-157`, which covers HTTP statuses only. The plan's acceptance row at `:180` names "Mutation response loss".
- **Mechanism:** a lost response is where an automatic replay would do the most damage, especially through helpers that take no options parameter, such as `updateSource`. Reading the code, the forced flags should prevent a replay, but I did not inspect `doFetch`/`sendRequest` for retries on network errors.
- **Tests:**
  - Make `mockFetch` reject the PUT with `TypeError('fetch failed')`.
  - Separately, return a 500 with the database-connection-error body (the branch at `http.ts:560-565`).
  - Assert exactly one PUT in each case and the expected error type.

### F4: The package-hierarchy check under the lock runs without the request policy (pre-existing, outside PR 1)

- **Where:** `pinned.ts:126-132` calls into `write-helpers.ts:949`. There, `checkPackage(..., client.getPackageHierarchyResolver())` runs on the raw, stateless client with no `options`.
- **Effect:** any parent-package reads ignore the deadline and abort signal and keep the default read retries. `resolveObjectPackage` does receive `options` (`:942`). These are reads only, so no write is ever replayed. The baseline did the same, and the plan (`:80`) leaves package resolution in the shared helpers.
- **Action:** carry this into PR 2's "every adapter, including direct HTTP calls" requirement (plan `:103-104`). Test there: use an allowlist that needs hierarchy resolution, abort during `validateLock`, and assert no further hierarchy GET is sent.

## PR 2 scope check

- No new actions, types, inputs, schemas, config, roles, routing or activation behaviour. `pinnedMutationAllowed`, `handlePinnedActivation` and `devtools.ts` are untouched.
- The remaining lock/unlock implementations are correctly left for PR 2: `crud.ts:443`, class-edit, unit-surgery, metadata-update, create DTEL/MSAG, delete, server-driven, and others.
- The wrapper's coverage of `head`, `delete`, `fetchCsrfToken` and nested sessions isn't used by the PR 1 production flow. It is the plan's "cannot be weakened by a nested adapter" requirement (`:93-95`), not scope creep.
- `identityMode` and `activationPolicy` are context fields the plan requires. They carry no behaviour yet.

## Live-evidence limitations

- **Route:** only a direct Basic login (MARIAN) on A4H client 001, SAP_BASIS 758 SP02. This is **not a PP test**. It covers no XSUAA grants, destination or Cloud Connector, user mapping, `mapped-user-unverified` identity, or check of the object's author/responsible user.
- **Transport recording:** only `$TMP` was used, so `recording.request` was empty. Transport-check outcomes, request/task validation, `corrNr` on save, and `validatePinnedLock` against a lock in a transportable package were not run live.
- **Paths not run:** pinned `create`, `edit_method` and INTF. The `initialized` result of `safeUpdateClassInclude` isn't asserted.
- **Mock-only behaviours:** cancellation, deadline expiry, unlock failure, session-close failure, no-replay on 429/5xx/CSRF, and the two-target/two-user isolation.
- **Activation:** the test used the legacy `activate()` with non-pinned safety settings, not `handlePinnedActivation`.
- **Also not exercised:** the NW 7.50 session-close fallback (`http.ts:345-347`), and the shared request semaphore (`adtSemaphore`) that production deployments likely use.
- **Plan requirement:** the plan (`:203-206`) requires comparing single-target with pinned *PP*, including author and transport recording. That equivalence is still unverified and should say so in the qualification record.

## Limitations of this review

- I used 19 of 20 reads.
- **Not read:** `syntaxCheck` internals, the retry logic in `doFetch`/`sendRequest` beyond `http.ts:536-575`, the bodies of `pinned-writes.test.ts` and `crud.test.ts`, and any docs or qualification record (the patch contains no docs).
- Test files marked as staged-modified were reviewed from the patch only.
- Gate results come from the JSON; I ran nothing.