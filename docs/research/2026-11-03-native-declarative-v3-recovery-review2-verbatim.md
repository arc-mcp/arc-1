# Independent exact-source DDLS recovery re-review

**Candidate:** `9c103ab74852d75db5f518e4d0f93e777d5cf8ca`  
**Correction base:** `1e067ab1174b043733420e858b961b2c6f0eaf10`  
**Actual execution checkout:** `/Users/marianzeis/.codex/worktrees/pinned-ddic-sdo/arc-1`  
**Frozen branch:** `codex/native-declarative-v3-recovery-fix`

**Verdict: conditional GO for the three fixed phases below, solely to remove the one retained DDLS.** No remaining integration or execution blocker was found in the reviewed scope. This replaces the operational NO-GO at `67b01c60` only for the corrected exact revision and execution path. It does not reopen the consumed v3 attempt or authorize another lifecycle, other owner, PP/public admission or merge.

| Phase | Verdict and limit |
| --- | --- |
| `--prepare-reviewed-v3-ddls-cleanup` | **GO** to create the one new fixed recovery intent/root with the full candidate SHA. This is offline preparation, without native modules, credentials or SAP requests. Its permanent claim must remain preserved on any failure. |
| `--check-reviewed-v3-ddls-cleanup` | **GO** after genuinely fresh prerequisite capture. This is a local non-claiming check, with no credential/native access, mkdir, index writes or execution grant. A successful check does not replace execution-time revalidation. |
| `--execute-reviewed-v3-ddls-cleanup` | **GO for one attempt only**, conditional on the exact frozen source/runtime and the fresh operational prerequisites below. It may take its own lock, issue one no-replay DELETE of the fixed owner, and perform its own unlock/session close and bounded verification. Any ambiguity stops the attempt; its claim remains consumed. |

Use Node **22.21.1**, the existing dependencies, the fixed entry `scripts/qualification/pr1142/native-declarative-v3-recovery.ts`, and the full SHA above from the actual execution checkout. This review did not invoke any real phase. The actual recovery root remained absent during independent evidence verification.

## Fixed scope and prerequisites

The only removable owner is **DDLS `ZARC1_V2V_F4C656905A65AA61`**, in `$TMP`, on **A4H / client 001 / Basic-native MARIAN**. Current native reads must still prove its exact active original and inactive updated source/metadata, marker, package and native identity, and typed absence of all five other original owners. These checks run before the lock and again immediately before DELETE under the owning lock, without treating the lock as permission to widen scope. No create, save, activation, repair, unrelated object deletion or arbitrary child cleanup is allowed.

After the new intent is saved, capture actual new raw JPEG SM12 evidence and matching receipts for **client 001, table `*`, user `*`, argument `*F4C656905A65AA61*`** and **client 001, table `*`, user `MARIAN`, argument `*`**. Both complete search results must show zero locks without an error and be manually visually inspected. Correct JPEG signatures, bytes/hashes, receipt identity, intent binding, chronology and five-minute freshness remain required through the observed DELETE boundary. Do not convert, relabel or reuse historical images. Keep the host awake and exclude concurrent CI/native activity for the bounded attempt. These are existing operational prerequisites, not facts established by this source review.

The source, original failure proof, intent and receipt/image bytes are revalidated throughout the execution, including the corrected terminal boundaries. Immutable bytes never receive a freshness exemption. Only the time expiry of unchanged SM12 evidence is exempt after an actual observed DELETE. Own UNLOCK and session close remain available when source/proof drift or stopping prevents any further mutation. Successful cleanup requires typed owner absence, other-owner absences, clean suffix inventory and confirmed owning-session cleanup; no inferred absence or replay is introduced.

## F1 closure

The sole previous finding is closed in both necessary places:

- The shared recovery driver now calls `verifySource()` after its independent final owner absence, all other-owner absence reads and final inventory await. A late binding failure cannot return success. Confirmed deletion and confirmed session cleanup remain retained, with failure and the fixed owner marked for inspection.
- The entry independently verifies the exact source, original proof, intent and receipt/image bytes immediately after the awaited driver resolves and before synchronous result persistence. It preserves known native facts and any earlier failure reason while journaling the late binding failure and marking inspection required.

The original independent tail probes were reused with only absolute source-root import redirection; reversing that substitution reproduces the original file byte-for-byte. Both formerly failing cases now pass. The new author regressions cover terminal owner/each-other-owner/inventory drift and source/original-proof/intent/receipt/both-image changes across the entry boundary. Additional independent positive/negative controls confirm that freshness exemption requires the recorded DELETE observation, rather than a returned result flag, and that the attempt stays consumed.

The narrow owned DDLS relative-state-link recognition remains strict. It does not follow arbitrary links or weaken ordinary activation's refusal of an inactive counterpart. Full current entry, shared driver, observer, fixed profile, proof/receipt readers, source/runtime binding and the five-file correction diff were inspected. The prior exact-source review's unchanged native contracts and preserved failure audit remain applicable. Parent-reported independent FLP integration between `67b` and the correction base is separate; this is not a new approval of that feature or the whole PR.

## Independent evidence

| Check | Result |
| --- | --- |
| First and last source action: immutable verifier | **4,723 files unchanged**, exact candidate SHA (`independent-first-verification.log`, `independent-final-verification.log`) |
| Ten relevant current/historical suites plus original independent probe suite | **11 files / 360 tests passed** (`independent-focused.log`): includes the unchanged 42-case probe file, 47 actual-driver tests, 39 actual-entry tests, link/activation, import purity, original proof, binding, lock and historical recovery controls |
| Additional independent terminal-entry controls | **2 passed** (`independent-entry-probes.log`; copied baseline cases filtered out) |
| TypeScript | All three source/scripts/tests projects passed (`independent-typecheck.log`) |
| Delta Biome | Passed for the two eligible files; qualification scripts are excluded by the existing configuration (`independent-delta-lint.log`) |
| Original failed-v3 evidence | Independently rehashed **all 117 files**, exact names/bytes unchanged; original result still `3b448b37cd7fbfeaf6aa6710fdae756f1af90bc15c156738ca1182f0d5a9408d` (`independent-original-evidence.json`) |

The original probe SHA is `c646f2fb91b453ffa711e3cc84c76a26afd011f5e2540bf21968affeb3092b47`; redirection is recorded in `independent-probe-binding.json`. The preceding exact review independently verified the complete fixed original 95-row proof chain and actual dual-version metadata/source fixture match. This re-review rehashed all original files and reviewed the unchanged bindings, without recopying private inventory or proprietary source.

Author-reported build, full lint, policy/schema-size checks, strict docs and 59 historical scenarios pass; the parent-reported base full suite was 542 files / 15,626 tests. I did not redundantly repeat unrelated full-suite/build gates after the meaningful affected checks passed. Installed dependency bytes remain outside the source attestation, as explicitly recorded by the binding; the existing runtime/dependencies and package lock must be retained.

No source/repository edit, manual Git command, install, native CLI/phase, SAP/network, browser, credential/.env, delegation or push occurred. Tests used mocked native transports and isolated temporary filesystem fixtures. One orchestration call had a JavaScript syntax error before any command ran; the corrected read-only check call succeeded. All probes/configuration/logs are outside the immutable source. FEAT-93 was checked and remains open for broader lifecycle/native/PP/public qualification. The final verifier completed before writing this report; no further source operation was performed.
