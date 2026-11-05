# Independent publication correction review

**Candidate:** `4bd4a4c86864c6e5cbe499e85d0cd521129fe4f6`  
**Base:** `612c4ee36b155fc97f4aa744b2227048590850a9`  
**Verdict: GO for private integration of this correction. F1 is closed; no new actionable blocker found.**

This is independent Codex fallback review. I authored neither the publication implementation nor this correction; my separate declarative-recovery authorship is unrelated. The prior publication failure report, probe and failing log remain unchanged. This verdict does **not** approve native execution, PP qualification, public admission or the whole PR.

## Why F1 is closed

The final configuration revalidation now returns its original `observedAt + 30_000` expiry (`src/adt/pinned-publication-execute.ts:151–161`). The single-use sender requires a finite expiry and passes `min(outer deadline, evidence expiry)` to the job request (`src/adt/publication-profile.ts:78–98`). The observation is not retimestamped or granted a new lifetime after queueing.

I traced that policy through the registered mutation facade and actual HTTP implementation. `composeOptions` preserves the narrower deadline while retaining the owning response/attempt budgets, signal and no-replay policy. The actual semaphore uses the deadline signal; request entry and the direct send recheck it. Asynchronous authentication preparation is awaited within the same bound. The proxy path also preserves the bound through its token wait and request signal; that last statement is source inspection, not live PP proof.

The immutable owning context is not narrowed or replaced. Subsequent reads retain its outer deadline, and `pinnedSessionCleanup` retains its independent 30-second allowance. Grant consumption still occurs before asynchronous work. Invalid or expired evidence cannot reuse a grant. Expiry after the sender has handed the operation to the HTTP path remains conservatively `submitted-unconfirmed`, without claiming that SAP changed or replaying the operation.

## Independent executable checks

All checks used existing Node 22.21.1/dependencies. HTTP transport was mocked; queue/authentication tests use the actual HTTP client and semaphore. No SAP/native/browser/credentials/.env/external-network/install/delegation/push or source/dependency editing occurred.

| Check | Result and local evidence |
| --- | --- |
| First immutable-source verification | 4,711 files unchanged; `initial-verification.log` |
| Committed focused suites | **277 passed**, 3 files: publication 54, legacy devtools 188, SRVB 35; `baseline.log` |
| Original independent semaphore reproduction | **1 passed**, 63 unrelated copied cases filtered out; `original-reproduction.log` |
| Additional independent expiry/budget controls | **13 passed**, 64 unrelated copied cases filtered out; `boundary-probes-final.log` |
| All three TypeScript projects | Passed; `reviewer-typecheck.log` |
| Policy and file/schema budgets | Passed; `reviewer-validate-policy.log`, `reviewer-check-sizes.log` |
| Final immutable-source verification | **4,711 files unchanged**; `final-verification.log` |

The original reproduction is byte-identical after reversing only its snapshot-import redirection. It now waits 31 seconds in the real semaphore and observes **zero POSTs**, `ok:false`, `retryable:false`, and `submitted-unconfirmed`, instead of the prior false confirmed result. `original-artifact-hashes.json` binds the preserved old report/probe/failing log.

The 13 additional controls prove:

- Missing, NaN, infinite, already expired and exact-expiry authority values refuse before POST and remain consumed.
- The actual queue and authentication paths permit submission at 29,999 ms and refuse it at exactly 30,000 ms.
- Both paths also expire naturally while their dependency remains blocked, without waiting for its release. Releasing it afterward produces no delayed POST; the semaphore queue is cleared.
- A 29-second-old observation supplies only its original remaining second to the job. Response/attempt budget objects and cancellation signal are retained, readback retains the outer deadline, and the owning policy/cleanup object is unchanged. Independent reads still work after the evidence lease expires without renewing/replaying the publication grant.
- The committed actual-transport cases additionally cover a 29-second-old observation plus a two-second wait and a shorter ten-second outer deadline plus an eleven-second wait, for both queue and authentication. Immediate positive controls still succeed.

The first boundary-probe run had four failures solely because my independent-read assertion used `status` instead of the actual response field `statusCode`. All four had already passed their publication deadline assertions. Only that outside-snapshot assertion was corrected; the original `boundary-probes.log` is retained. No candidate source change was required.

## Scope and remaining limits

Review covered the complete narrow diff and necessary unchanged transport/context code. The previous detailed review remains the assessment of unchanged batch preauthorization, exact scope/authority, native status handling, partial outcomes, legacy compatibility and public closure. The new committed suite rechecks those controls. No schema/admission, generated-binding deletion, native fixture or configuration-reader implementation is introduced by this delta.

The trusted **production current-principal configuration reader is still absent**. Native generated-owner cleanup, real supported wire/readback behavior, current-code two-writer PP and explicit public admission remain open. V2/cloud and coexisting-draft variants remain unqualified. Passing mocks and source inspection do not establish those facts. The author-reported broader full-suite/build/lint/docs results were not rerun as independent results; the focused checks above suffice for this localized correction. FEAT-93 was checked at start and finish and continues to describe these open gaps.

Snapshot source, diff and bound dependencies remained untouched. All review probes/configuration/logs and this report are outside `source/`. Final verification preceded writing this verdict; source work is complete.
