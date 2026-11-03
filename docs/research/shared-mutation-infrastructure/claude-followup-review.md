**No blocking findings.** F1, F2 and F3 are closed. F4 is properly deferred. The delta leaves single-target and pinned production behaviour unchanged. This was a static review: it is not a merge or deploy approval, and not PP qualification.

**What I used:**
- My prior findings, `review3.patch`, and all 8 allowed targeted reads.
- `review3-gate.json` shows all six checks exiting 0. It contains no counts, so "378 files / 10,329 tests" is your figure; I couldn't confirm it from the file.
- I ran nothing.

## Existing behaviour: unchanged

- **Single-target:** `crud.ts:156` passes `undefined`, and `mutation-http.ts:27` returns `withStatefulSession(fn)` with one argument before `cleanup` is read. Same as before.
- **Pinned owning session:**
  - `pinnedSessionCleanup` returns exactly `{timeoutMs: 30_000, noReplay: true, onClose}` (`mutation-context.ts:82-91`). The transport's cleanup type has only those three fields (`http.ts:289`), so dropping the spread loses nothing.
  - The effective close options are still 30 s, `noReplay: true`, and `onClose` → `sessionClosed`.
  - The factory has no side effects, so building it as an argument changes no ordering. `assertMutationContext` and `checkOperation` still run before the session opens (`crud.ts:122-123`).
  - The finite-budget check at `mutation-http.ts:28` now also runs for the owning session. `30_000` always passes it.
- **Where the change can reach:**
  - `withMutationSession` has only two callers: `crud.ts:151` and the wrapper at `mutation-http.ts:76`.
  - `pinnedSessionCleanup` is used only at `crud.ts:156`.
  - No pinned handler opens a session through the wrapper.
  - So the one change in behaviour, that wrapper sessions no longer write the owner's status, can't be reached from PR 1 production code. That is the intended fix.

## F1: closed

- The fix is at `mutation-http.ts:29-33`, with the lock-ownership comment at `:73-74`.
- **Nested test (`mutation-lifecycle.test.ts:214-244`):**
  - The child close reports `false`, and the owner's status stays `undefined` during the operation, then becomes `true`.
  - Close requests arrive as `['child','owning']`. That shows the child ran in a separate SAP session and the failed 503 close was not retried.
- **Sibling test (`:246-264`):** `:251` would fail against the old code, because the sibling's close used to write the shared status.
- The changed expectation at `:206` matches the new intended behaviour.

## F2: closed

- **(c) Rejection cause:** `mutation-isolation.test.ts:90-91` now requires an `AdtNetworkError` caused by `AbortError`. An API or safety error after the lock would now fail the test.
- **(b) Same target, two users:** `:36-69` share one policy object, host and `target` between two users. Each user's unlock cookie, close header and cleanup state are asserted.
- **(a) Concurrent handler test (`pinned-write-isolation.test.ts`):**
  - It goes through the real dispatch, with a barrier at LOCK (`:42-51`) so both requests overlap.
  - Per host it checks two CTS checks, one PUT with that host's own `corrNr` and source, and an UNLOCK on that host's own session.
  - It also checks the result's target, transport and hash, and two audit events with matching `requestId`, target and user.
  - Checking `requestId` only in the audit is correct; the response shape stays as it is.

## F3: closed

- **Database-error case:** this test does catch a regression. The body matches `http.ts:1171`, and that retry branch only runs when `retryTransientErrors` is on (`:539`, `:561`). Without the wrapper's forced flags, `updateSource` (which takes no options) would reach it.
- **Lost-response case:** network errors are raised once at `http.ts:936-937`. I found no retry branch for them, so this test guards against one being added later. That is what the acceptance row asks for.

## F4: deferred appropriately

- The PR 2 plan (`docs/plans/2026-10-26-broader-pinned-pp-writes.md:184-187`) now names:
  - the package-hierarchy resolver that uses the raw client,
  - the requirement to pass the request policy to it,
  - the cancellation regression test.
- The delta doesn't touch the validation code in `write-helpers.ts` or `pinned.ts`.
- The gap predates PR 1 and involves reads only.
- The isolation test shows that an abort inside `validateLock` blocks the next request through the wrapper. So a cancellation during hierarchy lookup can't lead to a save. What's left is extra time holding the lock while hierarchy GETs that can't be cancelled finish.

## Optional, non-blocking

1. **The delta made one check meaningless.**
   - `mutation-isolation.test.ts:23` now works out `target` from the Basic-auth username. Every client uses the password `test`, so the Authorization check at `:100-106` can never fail.
   - As a result, the different-target variant no longer checks that requests reach the right host or that credentials stay separate. The old hostname-based attribution did check this.
   - The handler test still covers PUT/UNLOCK host routing, but it doesn't record credentials.
   - Fix: also record the hostname and assert `new URL(request.url).hostname === \`${sameTarget ? 'shared' : target}.example.com\``.
   - In the same-target variant, also assert that each user's modifying requests carry `csrf-${target}`. Per-host state such as the CSRF token is what would collide there.
2. **`pinned-write-isolation.test.ts:124`:** the `corrNr` value comes from both the input `transport` (`:100`) and the lock's `CORRNR` (`:47`). So it doesn't prove each request kept its own lock result. Assert `lockHandle=lock-${host}` on the PUT and UNLOCK paths.
3. **`mutation-http.ts:30`:** it repeats the `30_000` from `mutation-context.ts:86`. If the owner budget is ever raised there, `Math.min` would silently cap it at 30 s. A shared constant avoids that.

## Evidence limits

- **Live evidence:** direct Basic login on A4H only, with the rerun still pending. This is not deployed PP qualification.
- **Earlier limits still apply:**
  - Not run live: transport recording, `corrNr` on save, and lock validation in a transportable package.
  - Tested against mocks only: cancellation, deadlines, the no-replay behaviour and two-user isolation.