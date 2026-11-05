# Independent V4 pair-recovery review — NO-GO for execution

Candidate: `2536bdd7089f48e30bfe30d169d795931a99d4fb`; base: `99a375a16efd8891adbff9d2995d2684c5e550fb`.
Snapshot: `/Users/marianzeis/.local/state/arc1-review/pr1142-native-declarative-v4-recovery-review1-20261103-053809/source`.

One confirmed P2 blocks the native execution chain. No preparation, check, execution, credentials, SAP operation or actual recovery-root creation was performed. This is not public, PP, lifecycle-completion or whole-PR approval.

## F1 — P2: recheck the effective deadline after final synchronous proof validation

Location: `scripts/qualification/pr1142/native-declarative-v4-recovery-driver.ts:122–140`, particularly `RecoveryAttempts.consume()` at lines 126–128.

The new final-send budget runs the synchronous source/history validator and then charges the attempt without rechecking time. The direct sender has already constructed its deadline signal before the dispatcher calls this budget (`src/adt/request-attempt-budget.ts:68–71`); Connectivity likewise constructs the signal before `consume()` and then calls `client.request()` (`src/adt/http.ts:1507–1509`). The validator includes synchronous Git/source checks and rehashes the 622 original files plus inspection/receipt files. If that work crosses the deadline, the event-loop timeout cannot interrupt it and the DELETE can still dispatch. The entry's freshness exemption is already active because the DELETE request row was recorded before transport (`native-declarative-v4-recovery.ts:85–89`), so it does not close this gap.

The independent actual-driver reproduction advances the test clock during precisely that final validator. It observes a late BDEF DELETE on the first-owner case and a late DDLS DELETE after confirmed BDEF deletion on the second-owner case. Both reproduce through actual direct Fetch and actual Connectivity request construction; only the socket endpoint is mocked. Owning UNLOCK still succeeds. The result then reports failure/delete-unconfirmed, which is truthful but cannot undo the prohibited late send.

Required correction: enforce the **effective absolute request deadline after the validator and immediately before dispatch**, preserving original SM12 freshness, the shared and per-owner ceilings, and the native request clamp. Do not renew the deadline or weaken source checks. Keep the owning UNLOCK/session-close cleanup exception, once-only attempt claim, no-replay behavior and previously confirmed deletion facts. A re-review must rerun the unchanged four failures, the passing source/stop/cleanup controls, and affected transport checks if the correction changes shared HTTP code.

Evidence: `independent-driver-probes.test.ts` and `independent-driver-probes.log`. Four deadline failures are preserved; 18 other driver probes pass. The original single direct failure is separately retained as `independent-initial-deadline-probe.test.ts.txt` and `.log`. These are synthetic timing probes, not native observations.

## Phase decision

| Phase | Decision for this exact revision |
|---|---|
| Offline preparation | Its local-only design passes review, but hold the real permanent preparation claim until the corrected revision is reviewed. An intent prepared at this rejected revision would bind the wrong execution source. |
| Offline check | Its nonclaiming, nongranting design passes review. It cannot approve execution or compensate for F1. No real check was invoked. |
| One fixed BDEF-then-DDLS execution | **NO-GO** until F1 is corrected and independently re-reviewed. |

Any later approval must bind a root-only, clean execution checkout at the newly reviewed exact SHA, Node 22.21.1, and the fixed new recovery root. It still requires genuine post-prepare raw JPEG SM12 searches, both images independently inspected with the exact zero-lock filters and timestamps within their five-minute freshness period, no overlapping CI/native work, and an awake host. Existing consumed protocol roots and claims remain immutable. No alternative owner, new fixture, repair, activation, class deletion or old-root retry is authorized.

## Verified scope and evidence

- The exact order is BDEF `/sap/bc/adt/bo/behaviordefinitions/zarc1_v4a_013fecce68663763`, then DDLS `/sap/bc/adt/ddic/ddl/sources/zarc1_v4a_013fecce68663763`. Exact package `$TMP`, marker, identity, MARIAN author fields, current metadata/source hashes and owner lock are rechecked before deletion. Request checks reject other mutation families, changed owners, query/body expansion and replay.
- Native inspection proves an active generated BDEF shell plus a different inactive intended source. Their exact hashes remain distinct. The DDLS explicit inactive source is identical to active/default and has no counterpart metadata link; the candidate correctly calls it an active fallback. It does not invent a second DDLS draft.
- All **622** original V4 files and **21** fixed audit/inspection bindings were independently rehashed before and after review. All ten committed native metadata/source bodies are byte-identical to their captured counterparts. The original result remains `3cb95d1620f6dfad4402d61eba1171d955e02f375c7f7cb434c392f161afb940`.
- The referenced class is typed-absence-only evidence and never owned or mutated. All four other original owner absences, fresh pair receipts, current-principal inventory and final all-six-owner absence remain required. A class appearing after BDEF deletion blocks parent deletion without erasing the confirmed BDEF fact.
- Source drift and stop signals at final send prevent the next mutation while owning cleanup remains available. Late class presence, source drift or stop at the final tail retains both confirmed deletions and owning cleanup while refusing full success. Entry terminal verification preserves prior facts and earlier reasons.
- The preparation/check import boundary remains pure: an independent import probe fails on any attempted native runner, native driver, HTTP or environment-configuration import; it passes without loading those modules. Actual phases were never called. Injected temporary-root entry tests cover proof tampering, chronology, freshness, irreversible claim/replay and terminal persistence checks.

## Independent checks and integrity

- 18 affected test files: **666 tests passed** with MockAgent networking disabled and all Vitest artifacts outside the snapshot.
- Independent driver probes: **18 passed, 4 failed** as F1; independent import probe: **1 passed**. Total independent probes: 23, of which four fail for the one finding.
- All three TypeScript projects passed; lint passed with three existing informational diagnostics, no edits; policy validation and file/schema-size gates passed. No installation, global dotenv stub, actual native phase or unrelated full-suite rerun.
- First and final source actions were the snapshot verifier. Both verified exact revision and **4,750 unchanged files**; no source operation followed the final verification. Manifest SHA-256: `9bd8e43c9b17c9a0ff7292b65f92bcbf1cd1920b9eb43e982a1e8a960e07d609`.
- Author report SHA-256: `86ee961bb3d546c8ca66bb2e579fd0528caaadb9da313e3bcc083cee5f812f04`. Final historical rehash and absent-root proof are in `independent-final-history.json`; final verifier output is in `independent-final-verifier.log`.

Independence: I authored earlier unrelated package/RAP work and the retained V4 failure audit, but did not author this recovery candidate or its tests. The deadline finding is independently reproduced against the immutable candidate. No source fixes were made.
