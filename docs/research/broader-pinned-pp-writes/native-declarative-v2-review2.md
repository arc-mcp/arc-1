# Independent native execution review — declarative v2 corrections

Exact candidate: **`a3a6ef551b5e3160caa47f3fc748ebdf218e1f5f`**.
Base: rejected candidate `5884adc722f5dba8f85cd6c425b51840b4785880`.
Reviewer: Codex fallback, independent of the harness, declarative profiles and these fixes.

**R1, R2 and R3 are closed. No new actionable findings. Bounded GO for the three phases below at this exact candidate, subject to the stated real prerequisites.** This is approval to conduct one fixed experiment, not a claim that the native lifecycle has passed.

| Phase | Verdict and limit |
| --- | --- |
| Offline permanent-intent preparation | **GO once**, using the fixed v2 entry and exact SHA above in a real clean frozen checkout. The fixed v2 state root must be unclaimed; inspect the saved six-owner intent before proceeding. This phase remains local-only and does not load credentials. |
| Fixed GET-only preflight | **GO** after the approved intent exists and is inspected, in the same checkout/runtime. Only the saved six owners and inactive inventory are sampled. Retain the actual emitted preflight ID and receipt hashes. A failed sample is not prerequisite proof; any authorized refresh must be a separate retained GET-only sample, never overwrite a prior one or remove a running sentinel. |
| One six-owner native lifecycle | **GO for exactly one attempt**, only after an actual successful fresh preflight and both genuine complete zero-lock SM12 observations described below. Scope is direct HTTPS Basic-native **A4H/001, MARIAN, `$TMP`**, with the fixed sources/dependencies. No other owner, source, phase, target or execution profile is approved. |

This GO does not transfer to a later commit, a dirty source tree, another checkout binding, altered dependencies/runtime configuration, reset claim or different fixture design. No real v2 intent, suffix, preflight ID, timestamp, screenshot hash or observed native result was created or invented during this review. The parent reports that no real v2 phase or credential load has run. Its read-only browser-session refresh is not prerequisite evidence.

## Closure evidence

**R1 — closed.** `scripts/qualification/pr1142/native-observed-http.ts` now repeats `validateRequest(method, path, body)` immediately after the awaited `beforeDelete` callback and before request journaling or dispatch. The selected-owner/path/source policy, composite source/intent/prerequisite binding and stop rule are re-evaluated after both the independent owner-receipt reads and dependency-absence reads. Existing deadline/attempt/response accounting and the five-second deletion reserve remain afterward; the correction neither replenishes budgets nor introduces a retry.

The committed real-driver tests invalidate the binding during owner reads and child reads for both v1 and v2. They verify zero DELETE for the selected owner, a `source-binding` refusal, preserved remaining-owner uncertainty, no false confirmed deletion, and successful own unlock/session close. I also reran my original external driver probes unchanged except for their absolute source path: both now prevent DELETE and release owning locks. The validated own UNLOCK exception and independently bounded session close remain available on source/evidence drift. Revalidation has no asynchronous gap before the observer records and hands off the request.

**R2 — closed.** `scripts/qualification/pr1142/native-declarative-runner.ts` now rechecks the composite binding after the awaited independent absence phase and before setting `independentAbsence` to `confirmed`. A changed intent, baseline receipt or PNG becomes `independentAbsence: "unconfirmed"`, `failure: true`, and `cleanupUnconfirmed: true`. The workflow's separate observations remain retained; the claim remains consumed and replay is refused. The committed temporary-file tests check both returned and persisted results and replay behavior. My original independently written final-baseline-drift probe now passes against the actual v2 entry and shared runner, using injected offline execution/HTTP edges.

**R3 — closed.** `assertDeclarativeV2Runtime` now rejects any defined `ARC1_LOG_HTTP_DEBUG` value before binding or credential access, including `true`, `false`, empty and `1`. This matches the stricter documented experiment contract. My original runtime probe and the four committed value cases pass. As in the first review, this is not a claim that the previous code leaked a secret.

I inspected the complete delta and current observer/runner/runtime integration. A byte comparison of 49 relevant native-script, private-write, native-owner, HTTP, instruction and lockfile paths found only the three intended code changes above. The prior detailed review is reused specifically for the unchanged fixture graph, native source selection, transport fence, workflow, evidence parser, source/lockfile binding, private activation integration and historical failure/recovery interpretation. Its committed raw report is byte-identical to the prior result, SHA-256 `6dd8cf4cb6320dca4b74f77c9e06e6287f1aa2e40ca483b8bdac46ff95c46679`. I reread the current protocol and affected shared consumers and tests; this verdict is not based solely on the author's claimed checks.

The shared observer change also reaches the historical function/recovery consumers. Their request shapes, no-replay and secret/body handling are unchanged; the recovery path retains its narrow own-unlock exception and repeated continuation checks. The complete offline suites below pass. **No historical consumed command is approved for replay.** There is no production `src/` or public capability change in this delta. Declarative activation still requires the private declarative grant and exact selected owner; other private grants and public closure remain intact.

## Exact operating conditions

Use the same real clean frozen checkout for all three phases, at `a3a6ef551b5e3160caa47f3fc748ebdf218e1f5f`, with its existing real dependencies, Node **22.21.1**, and exactly `node --import tsx`. Keep the reviewed runtime exclusions: unset `NODE_OPTIONS`, all `GIT_*`, HTTP debug, extra trust-root/module/TSX overrides and unsafe diagnostics; TLS verification must stay enabled. Source/index/shadow and lockfile checks must pass without bypass. Installed third-party dependency bytes remain an explicit attestation limitation. Do not commit further source changes into the execution checkout during the phase chain, including this review report.

The approved commands are the protocol's existing fixed entry, with the exact SHA:

```sh
node --import tsx scripts/qualification/pr1142/native-declarative-v2.ts --prepare-reviewed-declarative-v2 a3a6ef551b5e3160caa47f3fc748ebdf218e1f5f
node --import tsx scripts/qualification/pr1142/native-declarative-v2.ts --preflight-reviewed-declarative-v2 a3a6ef551b5e3160caa47f3fc748ebdf218e1f5f
```

For execution, use `--execute-reviewed-declarative-v2` with that same SHA and **the actual preflight ID emitted by the successful approved GET-only phase**. No executable command with an invented sample value is supplied here.

Before the single execution, the operator/reviewer must inspect and retain the complete successful preflight receipt and both real SM12 searches taken **after** that preflight completes:

- Client `001`, all tables `*`, all users `*`, argument `*<actual intent suffix>*`: **zero locks**.
- Client `001`, all tables `*`, user `MARIAN`, all arguments `*`: **zero locks**.

Save the actual unmodified PNG captures and the protocol-specified SM12 baseline document at their required private paths with owner-only permissions. Use hashes calculated from those actual files and the saved intent, and genuine observation times. The complete preflight and both observations must be no more than five minutes old until the first mutation. The harness validates fields, time order, PNG signatures and digests; it cannot interpret SM12 or prove the observer's assertion. A session refresh, old screenshot, failed/partial search or stale receipt is insufficient. Do not invoke the one-attempt entry merely to discover missing prerequisites: its exclusive claim is consumed before prerequisite and credential loading.

Keep the host awake and prevent concurrent activity on the fixtures and reviewed checkout. The approved six-owner sequence is fixed: view DDLS, separate abstract DDLS, DCLS, DDLX, abstract BDEF and SRVD. It completes create/activate/comment-update/activate per owner and deletes in reverse dependency order. It creates no implementation class, service binding/publication, table data, helper or execution endpoint. It performs no BTP/destination/role/permission change. A metadata/syntax/active-state uncertainty remains a stopped or failed experiment with dependency preservation, not permission to edit the fixture or retry.

After exit, inspect all receipts and take fresh external suffix and MARIAN-wide SM12 controls again. A native pass requires all six completed owners, confirmed reverse deletions, workflow and independent typed absence/inventory evidence, confirmed owning-session cleanup, and both zero-lock controls. Preserve uncertainty and any remaining resources. No source repair, activation repeat, force DELETE, SM12 lock deletion, claim removal/rename or second v2 attempt is approved. Any further cleanup needs its own reviewed exact scope.

## Independent checks

All checks ran against this snapshot with the explicit Node 22.21.1 PATH and existing dependencies. No source edit, install, manual Git operation, SAP/native CLI/preparation/preflight, browser, credential access or external-network operation was performed. Tests used existing mocks/injected edges and temporary test state. Review probe files and logs are outside `source`.

| Check | Result | Log |
| --- | --- | --- |
| First snapshot verifier | Exact revision; **4,634 files unchanged** | Initial tool result |
| Focused driver/entry/runtime/binding/recovery tests | **7 files / 268 tests passed** | `codex-focused.log` |
| Four original independent failure probes | **4 passed** against the corrected source | `codex-probes.log` |
| Full unit suite | **524 files / 14,643 tests passed** | `codex-full-unit.log` |
| All three TypeScript projects | Passed | `codex-typecheck.log` |
| Lint | Passed; three existing informational suggestions, no fixes | `codex-lint.log` |
| Policy | 135 entries / 14 schemas passed | `codex-policy.log` |
| File/schema budgets | 1,044 tracked source/test files; all 12 scenarios passed | `codex-sizes.log` |
| Historical offline qualification harness | All 59 scenarios passed | `codex-qualification.log` |
| **Final source action: snapshot verifier** | Exact revision; **4,634 files unchanged** | Final tool result |

No further source action followed the final verifier. This report was written outside the snapshot afterward. Source/scripts/tests typechecking and the complete offline suites were independently rerun; the author's build/strict-doc results were not independently rerun as part of this immutable follow-up.

This approval is only for the reviewed local **Basic-native A4H/001 MARIAN `$TMP` experiment**. It is not PP qualification, public mutation/read-profile admission, a deployment approval, or a whole-PR merge verdict. Exact A4H compilation/metadata behavior is still to be observed; local parsing and mocked lifecycle success do not establish it. Current-code two-writer PP, recording transports, other families/releases and the remaining accepted PR scope remain separate.
