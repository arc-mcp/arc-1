# Independent narrow public-input correction review — GO

Candidate: `327d4d8417f0404ac2ffaef0e5b4f13f3158178a`, base `ec7a98e2b25c2a6a6e137bd727d1cad4c1db3bb3`. Snapshot: this packet's `source/`. Initial and final verifiers confirm **4,802 bound files unchanged**. The final source action was `review-input/verify-snapshot.py`; no source action followed it.

**GO for this narrow source correction: the prior F1 and F2 input-preservation findings are closed. No further actionable finding was identified in the corrected behavior.** This is not public/native/PP/deployment/merge or whole-PR approval.

Independence disclosure: I authored the original broader public-admission wiring, but did not author this correction. Root authored the two-file correction reviewed here. The unchanged package_continue review1 verdict remains the independent assessment of the whole wiring; this review verifies only its corrective delta and relevant compatibility controls. It does not recast my earlier wiring as independently reviewed by me.

## Findings closed

**F1, P2 — raw revoke visibility.** `src/server/multi-target-write-surface.ts:59–65` rejects meaningful raw `apiVisibility` when the selected operation is API-state revocation. The check runs on the optional-empty-cleaned original input, before the legacy normalizer discards that field, at both existing selected-runtime and shared-dispatch boundaries. Empty arrays, actual selections and invalid selections no longer reach a PUT. Null/blank optional pollution remains omitted; real false/zero/arrays/objects remain meaningful and refuse. RELEASED visibility remains intact. The ordinary single-target normalizer is unchanged.

The original independent four-test API probe is unchanged except its source-path binding. All three previously failing refusal assertions now pass; the supported revoke control still performs exactly one API-release PUT successfully.

**F2, P2 — nested function processing fields, including the top-level sibling.** Lines 24–31 and 66–76 validate every raw batch item against its canonical FUNC type before destructive normalization, and reject `updateTaskKind` unless a FUNC create explicitly selects update processing. The same helper covers top-level create applicability. The later post-Zod unknown-input preservation guard remains. All items are inspected before native I/O, so a valid first item cannot commit before an incompatible later item is detected.

The original independent five-test batch probe is unchanged except path binding. All four previously failing refusal assertions now pass; the ordinary supported class batch still creates, saves and activates normally. Additional real public-dispatch checks refuse a later invalid class/function item before any HTTP call, including slash/whitespace aliases and false/zero values. Optional null/blank fields still allow a class batch to complete. Valid FUNC aliases and normal/RFC/explicit-update options reach the native package preflight; that particular control deliberately stops at a mocked read error and does not claim a completed native function lifecycle. Existing private function-create tests provide the complementary processing/readback regression coverage.

## Independent checks

- **10 suites / 492 tests pass**, including both unchanged original probes, sixteen additional review controls, committed correction/public tests, function-create, schemas, slash aliases, legacy API visibility, selected-runtime and pinned-admission cases. Original-probe total: **9/9 pass**, comprising seven corrected refusals and two successful controls.
- All three TypeScript projects pass. Full lint, ACTION_POLICY and file/schema budgets pass; lint retains the existing informational diagnostics only.
- The author’s larger 38-suite/1,921-test run and broader full-suite history remain prior evidence. No unrelated full-suite/build/docs repetition was needed for this narrow correction.
- Original probes are bound with hashes and path-only comparisons in `codex-original-probe-binding.json`. Commands, selected tests, source/report/diff hashes and log hashes are bound by `codex-source-binding.json`, `codex-focused-checks.json`, `codex-static-checks.json` and `codex-evidence.json`.
- Process and explicit Vitest-worker guards recorded **zero external network attempts and zero environment-file read attempts**. Two permitted TSX loader IPC observations were recorded; all SAP HTTP behavior was mocked. No SAP/native/cloud/browser/credential operation, installation or source edit occurred. The author checkout was released as soon as the independent snapshot passed its initial verifier.
- Retained review setup failure: the first additional positive-control loop incorrectly treated `processingType=update` without `updateTaskKind` as valid. The unchanged existing schema correctly requires the kind. Three alias cases failed for that fixture error. The initial file/log and diagnostic output are preserved. The final controls use valid explicit update options, and a separate negative test verifies the existing missing-kind refusal. This was not a product finding. Neither original independent probe was edited for this adjustment.

FEAT-93 and the original whole-wiring review's qualification/adapter gaps remain open. This correction does not change capability scope, weaken package/request/target policy, enable a mutation-free route, establish native behavior, or supply current-code two-writer PP evidence. Those acceptance decisions remain separate parent work.
