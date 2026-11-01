# Implementation review disposition

First completed reviewer: Claude Code 2.1.308, `claude-opus-5-5`, effort `max`.
Reviewed source: `c9813330` against `721755d51`; fixes: `80532d05`.
The review was static and read-only; it did not run tests or qualify live PP.

| Finding | Disposition | Evidence |
| --- | --- | --- |
| F1: independent sessions could overwrite owning-session cleanup status | Fixed. Only `withLockedMutation` supplies the callback that updates the shared owner status. Facade sessions have their own bounded callback. Independent contexts and lock ownership are documented. | Nested close-failure/owner-success test; sibling close followed by refusal before opening the owner. |
| F2: concurrency coverage lacked same-target users, cancellation cause, CTS and audit attribution | Fixed. Added the same-target/shared-policy-object variant and exact AbortError assertion; added concurrent dispatch/handler coverage of separate transport checks, save `corrNr`, source/hash, result target/transport and audit target/user/requestId. Successful payloads retain their existing shape. | `mutation-isolation.test.ts`, `pinned-write-isolation.test.ts`. |
| F3: no-replay matrix omitted response loss and the database-recovery branch | Fixed. Both fail through the scoped legacy helper with exactly one PUT and the expected error class/status. | `mutation-lifecycle.test.ts`. |
| F4: package-hierarchy reads ignore mutation deadline/cancellation | Pre-existing read-only behavior, deliberately preserved in PR 1. The PR 2 adapter section now names the gap and the required subtree/cancellation test. | `2026-10-26-broader-pinned-pp-writes.md`, shared-adapter section. |

The author also fixed the nonfinite nested-budget case before this review and added its regression.
After the review fixes, the six-check gate passes (378 files / 10,329 tests). The final source
revision's direct SAP lifecycle test passes; the earlier connectivity failure and recovered
fixture are disclosed in the qualification record. Deployed PP/transportable-package equivalence
is still unverified and is not inferred from these tests.

The [follow-up review](claude-followup-review.md), by the same model and effort, confirms F1–F3
closed, F4 appropriately deferred, and no blocking findings. Its optional test suggestions were
adopted after review: assert actual host and CSRF/user attribution, and assert each host's own
lock handle on PUT/UNLOCK. These strengthen the tests without changing runtime source.

The optional shared-constant suggestion is deferred: the owner default and independent-session
ceiling are separate policy roles, both currently 30 seconds. A future budget change must consider
both sites; this is not a current behavior or qualification gap.
