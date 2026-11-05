# Independent native execution review — declarative v2

Reviewed exact revision: `5884adc722f5dba8f85cd6c425b51840b4785880`.
Comparison base: `98f2f63fbd86e0ee9a4ca5d4071edcac8b4396d5`.
Reviewer: Codex fallback after the reported Claude capacity limit; not the harness or declarative-profile author.

**NO-GO for the proposed phase chain. Two P2 execution/evidence defects and one P3 runtime-contract mismatch are confirmed.** This is an exact-source native execution verdict, not a private-adapter integration verdict or a whole-PR merge decision.

| Proposed phase at this exact revision | Verdict | Reason |
| --- | --- | --- |
| Offline `--prepare-reviewed-declarative-v2` | **NO-GO** | The preparation implementation is local-only and did not reveal an independent unsafe SAP path. However, it permanently claims the fixed v2 intent and binds it to this rejected revision. Do not consume that intent before the corrected exact revision is reviewed. |
| Fixed GET-only `--preflight-reviewed-declarative-v2` | **NO-GO** | The inspected interface is GET-only, uses read-only client safety and exact saved names, and has fresh bounded reads. It remains an unapproved step in the rejected phase chain; do not prepare an intent or take a sample at this revision to advance toward execution. |
| One six-owner native lifecycle after fresh SM12 evidence | **NO-GO** | R1 can submit DELETE after the source/evidence binding becomes invalid; R2 can publish success after the final evidence changes. Fresh SM12 screenshots do not close either code defect. |

The parent confirmed that no real v2 preparation, preflight, claim, credential load or native command has run, and explicitly retained all three phase-chain approvals as NO-GO until a corrected exact SHA is reviewed. No real runtime preflight ID or hash was supplied or invented by this review. Preserve all historical v1/recovery claims and receipts.

## Findings

### R1 — P2: revalidate the source/evidence binding after the awaited deletion guard

Locations: `scripts/qualification/pr1142/native-declarative-driver.ts:82–85` and `scripts/qualification/pr1142/native-observed-http.ts:65–89`.

The request validator checks `verifySource()` before `beforeDelete`. The deletion guard checks it again at entry, then awaits the independent native metadata, active metadata, source and child-absence reads. After those reads it rechecks only `shouldStop()`. The observer then refreshes request budgets and sends DELETE without calling its validator again. Thus a source, saved intent, preflight receipt or SM12 proof change during those reads is not caught at the last mutation boundary.

The external regression copies the existing real-driver mock test outside the immutable source and adds a fault that invalidates the supplied binding during the first stateless SRVD metadata read while its own deletion lock is held. For **both v1 and v2**, the actual integrated driver and production adapters send **one SRVD DELETE**, with no `refused-before-send` row for it. Subsequent work stops, the result is failed/unconfirmed, and the owning lock is released. Later failure does not undo the unauthorized-after-drift DELETE.

Required correction: repeat the closed request/source/evidence/stop validation after asynchronous guard reads and immediately before handing off the request; preserve exact-owner UNLOCK and bounded session close on drift. Add real-driver regressions for both families, covering drift during a receipt read and during a child-absence read, with zero DELETE and confirmed own cleanup. A shared observer correction should retain the old function/recovery guards and their cleanup behavior.

Evidence: `codex-delete-guard-probe.test.ts`, `codex-probes.log`. The two expected-zero-DELETE assertions fail on this exact source. This is mocked protocol evidence, not a native request.

### R2 — P2: recheck immutable evidence before publishing final success

Location: `scripts/qualification/pr1142/native-declarative-runner.ts:117–119` (success serialization follows at lines 125–132).

The shared runner verifies the binding before the awaited independent final-absence phase, but never afterward. V2's binding is also its saved-intent and SM12/preflight proof integrity check. If any of those files changes during the final GET sequence, the runner still sets `independentAbsence: "confirmed"` and writes a successful result.

The external v2-entry regression uses the real intent/preflight/baseline parsing and private temporary files, with injected offline execution/HTTP edges. Its `confirmAbsence` appends a byte to `sm12-baseline.json` and returns. The actual entry writes **`failure: false`, `independentAbsence: "confirmed"`, `cleanupUnconfirmed: false`** although the bound proof hash no longer matches. The existing tampering tests explicitly call `input.verifySource()` inside the injected workflow and therefore do not exercise this final window.

Required correction: verify the source/intent/prerequisite binding again after final absence and before reporting confirmation/success. Preserve honest native deletion/cleanup observations while making the overall qualification failed or unconfirmed; do not replay or reset the claim. Add regressions for final-read source and proof drift, including drift during the last read.

Evidence: `codex-final-evidence-probe.test.ts`, `codex-probes.log`. The expected-failure assertion fails on this exact source.

### R3 — P3: implement the documented HTTP-debug runtime refusal

Locations: `scripts/qualification/pr1142/native-declarative-v2.ts:15–18`; `docs/research/2026-11-02-native-declarative-v2.md:50–51`.

The protocol states that an HTTP-debug runtime override is refused. `assertDeclarativeV2Runtime({ ARC1_LOG_HTTP_DEBUG: "true" }, ["--import", "tsx"], "v22.21.1")` currently succeeds: neither inherited runtime checker examines that variable. The separate recovery entry does explicitly require it to be unset. Keep the v2 runtime contract and documentation consistent, preferably by refusing the variable before binding/credentials and testing that path.

This review did **not** establish a credential/handle leak through this setting: the current central audit redactor still suppresses payload bodies and sensitive headers. The mismatch is a missing promised defense and operational-contract issue, not a demonstrated secret disclosure. The expected-runtime-refusal assertion in `codex-final-evidence-probe.test.ts` fails.

## Boundaries and integration inspected

- Read the packet prompt and author report, governing AGENTS/accepted-plan/ADR/security guidance, current roadmap and v2 protocol, and the original failed DDLS lifecycle plus successful separate cleanup record. Reviewed the complete script delta and the current shared runner, workflow, driver, observer, native evidence, runtime/source binding and declarative adapter/activation integration.
- V2 has a disjoint `ZARC1_V2{V,A,D,X,S}_<16-hex>` family, fixed marker and fixed state root. Saved sources/dependencies are regenerated and compared exactly. There is no caller target, package, source, owner or arbitrary profile input. Both source variants use `ConnectionId`.
- Six owners span five families: view DDLS, abstract DDLS, DCLS, DDLX, abstract BDEF, SRVD. The DCLS/DDLX/SRVD depend on the view; BDEF depends on the separate abstract DDLS. Per-owner create/activate/comment-update/activate precedes the next owner. Reverse cleanup and uncertain-owner dependency closure are retained.
- The real common activation orchestrator selects only the private declarative symbol for these owners. The function, binding and DDIC grants remain distinct. It validates exact native references, captures/rechecks package, CTS and draft evidence, and verifies explicit active metadata and active source. An `active` query fallback or unknown/relative alternative is refused, not treated as native activation proof. Public declarative admission remains closed.
- Create/update/activation traverse the observed request validator after their driver/adapter preflight awaits. I traced the driver-local asynchronous transitions into mutation dispatch; R1 is the confirmed missing final check after the observer's asynchronous deletion guard. R2 concerns the later evidence/success boundary. The reviewed fixed Basic-native client does not select a bearer provider, PP proxy or externally shared request queue. This remains observational protection, not an atomic cross-process source or SAP snapshot guarantee.
- GET-only preflight verifies binding before each GET and after the complete sample. Its running sentinel and exclusive attempt claim prevent a successful overlapping mutation phase. Crashed/failed/consumed states are retained; claim creation precedes prerequisite or credential loading for execution. Changing the SHA cannot reset a claimed attempt.
- The entry binds a real clean checkout, loaded entry, Node 22.21.1, tracked source/index state, source-shadow absence and lockfile. The installed dependency bytes are explicitly not attested. The fixed target is HTTPS A4H/001, SAP user MARIAN, TLS verification on, local `$TMP`, with transport management/Git/plugins/publication/ABAP execution outside the experiment.
- Prerequisite files have strict schemas, identity/name/hash/time checks, private ownership/mode checks, bounded reads and final-component symlink refusal. Both PNGs are digest-bound and must have PNG signatures. Their visual contents and the SM12 observations still require operator/reviewer inspection; the parser does not interpret screenshots.
- Source mutations remain exact-owner/source fenced and no-replay, with 30-second HTTP bounds, all-response byte allowances, finite phases and a cleanup reserve. Stop and the narrow own UNLOCK/close exception are retained. Typed owner absence, valid inventory, active metadata/source, and own-session cleanup are separate evidence. No failure is translated into automatic rollback or retry.
- The historical v1 DT205 failure stays failed; the separate cleanup stays successful and consumed. Nothing in the v2 delta grants permission to replay either historical command or relabel their native observations as a successful lifecycle.

## Checks and snapshot integrity

All checks used the existing dependencies and explicit Node 22.21.1 PATH. No source edits, installs, manual Git operations, native CLI/preflight, SAP/browser/credential access or external-network operation was performed. Test-only exports used injected fake credentials/HTTP edges and private temporary state. The copied probe files and all review logs are outside `source`.

| Check | Observed result | Log |
| --- | --- | --- |
| First snapshot verifier | 4,632 files, exact revision, unchanged | Initial tool result |
| Focused native tests | 7 files / 282 tests passed | `codex-focused.log` |
| Full unit suite | **524 files / 14,632 tests passed** | `codex-full-unit.log` |
| Added independent probes | **4 assertions failed as expected**, establishing R1 twice, R2 and R3 | `codex-probes.log` |
| Source/scripts/tests typecheck | Passed | `codex-typecheck.log` |
| Full lint | Passed; three existing informational suggestions; no fixes | `codex-lint.log` |
| Policy | 135 entries / 14 tool schemas passed | `codex-policy.log` |
| Size/schema checks | 1,044 tracked source/test files; all 12 schema scenarios passed | `codex-sizes.log` |
| Historical offline qualification harness | All 59 scenarios passed | `codex-qualification.log` |
| **Final source action: snapshot verifier** | **4,632 files, exact revision, unchanged** | Final tool result |

The focused invocation named one non-existent historical filename, so seven matching files—not eight—ran. The full suite subsequently included the actual `pr1142-native-declarative-entry.test.ts` and all recovery/activation coverage. No build output or documentation generation was required for this immutable execution review; typechecking and the full offline suite were run. No further source action occurred after the final verifier; this report was written outside the source afterward.

## Conditions for a future approval

Fix the findings and review a new immutable exact revision before **any** of the three real v2 commands. Do not remove/reset/rewrite a consumed root. For a subsequently approved run, use a real clean frozen checkout and existing real dependencies at the approved Node/runtime settings; inspect the offline intent before native access. Obtain the preflight ID and hashes from the actual approved GET-only phase. Inspect both fresh client-001/all-table SM12 captures: suffix across all users and MARIAN across all arguments, both zero locks and observed after the successful preflight. The whole preflight and observations must remain within the five-minute prerequisite envelope until the first mutation.

After a separately approved single attempt, require all six completed owners, guarded reverse deletions, workflow and independent typed absence/inventory confirmation, own-session cleanup and fresh external suffix/user SM12 zero-lock controls. Preserve uncertainty and receipts without repairs, force deletion, SM12 lock deletion or replay; any remaining cleanup needs separate exact-source review.

These are prerequisites for reconsideration, **not execution authorization**. Even a future successful sample would qualify only this local Basic-native A4H/001 `$TMP` experiment. Exact A4H syntax/metadata behavior, current-code two-writer PP, transportable flows, other families/releases, public admission, deployment and PR merge readiness remain separate. Mock success is not native proof.
