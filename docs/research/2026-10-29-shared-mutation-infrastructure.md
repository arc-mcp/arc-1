# PR 1: shared mutation implementation and qualification

Date: 29 October 2026. Implementation baseline: `721755d51b9fa955becc50673f420eb3916c69f9`.
This implements the [reviewed PR 1 plan](../plans/2026-10-26-shared-mutation-infrastructure.md).
The [PR 2 expansion](../plans/2026-10-26-broader-pinned-pp-writes.md) remains unimplemented.

## Implementation

`src/adt/crud.ts::withLockedMutation` owns the shared session/lock/cleanup sequence. Production
consumers are single-target `safeUpdateSource`, single-target `safeUpdateClassInclude`, and the
existing pinned CLAS/INTF source adapter. Package checks, CTS evidence, hash checks, source
transforms, readback and phase classification remain in their existing adapters.

`mutation-context.ts` requires factory-created contexts derived from actual safety state. A
multi-target client cannot enter a legacy wrapper, and mismatched or reconstructed contexts fail
before opening a session. The pinned context carries the existing recording policy and explicit
unverified mapped-user / separate-owner-activation states; those fields do not grant permission.

`mutation-http.ts` propagates deadlines, cancellation and no-replay behavior to nested HTTP calls
and stateful facades. It never mutates the underlying client's read policy. The coordinator
retains the owning session for independent unlock/close budgets. Legacy request-options absence,
lock-result shape and unlock-error precedence are retained. Pinned cleanup retains the primary
outcome and reports cleanup status. Pinned failure serialization moved unchanged to its own
module; activation's only change is that import.

No new tool actions/types, roles, scopes, destination properties, configuration, caches or
public schemas are introduced. No metadata/delete/transport/FLP adapter was added. WeakSet/WeakMap
bookkeeping records context/facade object identity, with no global selected target or session store.

## Author review and regression loop

1. Installed locked dependencies and passed the original six-check gate before extraction.
2. Added characterization tests before refactoring, including absent options, owning-session
   identity, `localityKnown`, optional hashes, and legacy unlock failures after success/error.
3. Extracted the shared path, then passed the existing pinned, CRUD, source-precondition and
   activation tests and the complete gate.
4. Reviewed nested policy composition and cleanup ownership. Added tests for no replay after
   401/403/406/415/429/500/503, tighter child deadlines, combined cancellation, cancelled/expired
   operations with independent cleanup, missing/disabled/mismatched contexts and lock validation.
5. Fixed an author-review finding: `Math.min(outerDeadline, NaN)` could erase the finite outer
   deadline. Nonfinite nested request/cleanup budgets now fail before HTTP. Regression included.
6. Added an overlapping two-user/two-target transport test: cancellation on one request does not
   stop the other, and each unlock/close retains its own credentials and SAP context cookie.
7. Added and ran a real SAP disposable-fixture test of both production adapters.

At implementation commit `80532d05`, all six checks pass: `npm test` (378 files, 10,329 tests),
`npm run typecheck`, `npm run lint`, `npm run validate:policy`, `npm run build`, and
`npm run check:sizes`. All 11 tool-definition fixture files retain their baseline SHA-256 hashes.
Authorization, server configuration, tool-schema and XSUAA role-template sources are unchanged.

## Live SAP evidence and limits

- Endpoint: `https://a4h.marianzeis.de`, client `001`, normal certificate verification.
- Native identity response: SAP user `MARIAN`; direct Basic test connection, not PP.
- Installed component response: SAP_BASIS `758`, SP `0002` (`SAPK-75802INSAPBASIS`).
- Final production implementation tested: `80532d05`; initial extraction also passed at `941425fc`.
- Test: `tests/integration/mutation-lifecycle.integration.test.ts`, one passing case, 28.25 seconds
  on the final source revision (14.7 seconds on the initial extraction).
- A unique `$TMP` class was created; the legacy main and test-include helpers saved successfully;
  the pinned adapter saved a new main source and rejected a stale hash without changing it;
  a subsequent pinned save reacquired the lock; whole-owner activation succeeded; deletion
  succeeded and a final metadata read returned 404. The fixture was removed.
- An intermediate repeat on `c9813330` failed during locked-policy validation; session close
  and teardown also failed, with an ADT network error reported by teardown. The result reported
  `unchanged`, `cleanupFailed: true`, and `sessionClosed: false`. After connectivity recovered,
  the disposable class was deleted in a new owning session and its absence verified by 404.
  The subsequent final-revision test passed. No fixtures remain from these runs.

Reproduce against an explicitly authorized test system with its private test credentials:

```sh
TEST_SAP_URL=https://a4h.marianzeis.de TEST_SAP_CLIENT=001 TEST_SAP_INSECURE=false \
  npx vitest run --config vitest.integration.config.ts \
  tests/integration/mutation-lifecycle.integration.test.ts
```

This proves the shared mechanics against SAP through a direct identity. The test-only pinned
policy does **not** prove XSUAA grants, selected-destination resolution, PP user mapping or real
transportable-package recording. A fresh comparison through the deployed PP route was not run:
the management preflight for the isolated `arc1-ta-677-test` app failed refreshing CF login at
`login.cf.us10-001.hana.ondemand.com` with a TCP timeout. No deployment or destination/role change
was made. Earlier PR #1080 live evidence is not counted as evidence for this refactor.
The live test covers CLAS update and legacy activation, not pinned create, method edit, INTF,
pinned activation, NW 7.50 cleanup fallback, or multiple live identities. Those paths retain
automated regression coverage; no broader live claim is made.

## Security and roadmap disposition

I1/I3/I7: existing scope/route/safety/package/recording gates remain in force; new shared calls
require explicit contexts and cannot fall back from pinned to legacy. Read-only aggregate,
Basic and pinned-reader denial tests remain part of the passing complete suite. I2: clients,
cookies and cleanup stay request-owned; the overlapping-request test verifies separation.
No new logging fields, user-controlled sinks or argument loops affect I4/I5/I6. The extraction
does not replace SAP authorization or the pinned route's permission checks.

FEAT-93 remains open for PR 2's complete capability expansion. The roadmap records the shared
foundation and retains the new ADR, per-operation policies and real PP qualification requirements.

## Independent review

The [first completed review](shared-mutation-infrastructure/claude-review.md), using Claude Code
Opus 5.5 at max effort, found no blocking regression. Its three actionable infrastructure/test
findings were addressed and re-tested; the pre-existing read-policy gap is assigned to PR 2.
See the [disposition](shared-mutation-infrastructure/review-dispositions.md).
The [follow-up review](shared-mutation-infrastructure/claude-followup-review.md), using the same
model and effort, confirms F1–F3 are closed, F4 is appropriately deferred, and there are no
blocking findings. Two optional test-assertion improvements were then added and checked; runtime
source remains exactly the reviewed/live-tested `80532d05` revision. An initial attempt was stopped
because restricted mode could not read the temporary diff outside the repository; that attempt
is not counted as a completed review. The replacement review uses an identical baseline diff
inside the workspace, with the author's subsequent fixes and tests included.
