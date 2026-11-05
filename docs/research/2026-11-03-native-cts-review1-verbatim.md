# Independent CTS candidate review — NO-GO

Candidate `8c7bbdb62e1c3f0ca47bf594a13f1d4c76244a94`, base `5aa7533d6bf71388318510abeae630483e33ba53`. Final source verification: **4,928 bound files unchanged**. No native phase, real claim, credential/environment-file access, source mutation or deployment occurred. Do not begin this candidate’s actual fixed-root phases until the two findings below are corrected and the exact replacement is reviewed.

I did not author this CTS candidate. I previously authored related DDIC/declarative/package qualification machinery, including preceding shared class-evidence behavior; that overlap limits independence for unchanged shared components. This is a functional/native-source review, not public/PP/whole-PR approval.

## F1 — P2: creation summary contents can bypass the exact empty-graph check

Locations: `scripts/qualification/pr1142/native-cts-evidence.ts:72–87` (`bindCreatedRequest`), `:125–141` (`assertCtsSummaries`); driver `:207–225` and the creation binding beginning `:373`.

The creation binder checks direct `parent.objects`/`task.objects`, but those arrays exclude `tm:all_objects`. The summary validator only checks allowed object identity, and is not applied while the returned parent is still unbound. Two actual-driver reproductions therefore pass the entire A lifecycle incorrectly:

1. Each creation-stage organizer GET has empty direct object lists but a summary row for the future fixture CLAS. The requested exact empty graph is unproved, yet reassign-away/back and all later mutations proceed.
2. Only the first native organizer response contains a summary row for `UNRELATED_FOREIGN_CLASS`; later responses omit it. That observed foreign row is neither refused nor retained. Later empty reads erase the contradiction and the round proceeds.

Both return `failure:false`, all nine A steps complete, `dispatchedMutations:10`, `remaining:[]` and `inspectionRequired:[]`; calls include the two owner reassignments, CLAS save/delete, object removal and task/parent release. These are synthetic fault injections into the real HTTP/handler/driver path, not claims that SAP produced the shapes during a native run.

**Correction:** validate every observed creation response’s summary content before adopting the empty request/task graph or continuing, including the adapter’s first independent GET. A nonempty/foreign summary must stop the round and retain the contradiction; a later omission cannot erase it. Enforce summary emptiness where emptiness is the actual stage prerequisite, while preserving legitimately recorded owned rows in later stages. Do not simply discard `all_objects` or broaden object ownership.

Reproductions: `independent-probes.test.ts` tests “nonempty native creation summary” and “transient foreign creation summary”; results/calls are `independent-nonempty-summary-*` and `independent-transient-summary-*`. Final failures are in `independent-probes-final.log` and `independent-transient-summary.log`.

## F2 — P2: a malformed newly observed member disappears from residual diagnostics

Location: `scripts/qualification/pr1142/native-cts-driver.ts:207–220`.

The driver extracts namespace-bound observed IDs, but preserves that raw observed set only before ownership is bound. For a bound parent it first calls `inspectCtsTree`, then adds unexpected IDs. If a new task has a canonical native ID but missing/unqualified target metadata, `inspectCtsTree` throws before the ID is retained.

The actual-driver probe adds task `A4HK999998` after `create-request` completes, omits its `target` attribute, then omits the task from all later reads. Forward work correctly stops with no PUT/DELETE, but the result lists only the original parent/task in `inspectionRequired`; the observed new member is lost. The response remains in the raw journal, so this is incomplete structured residual reporting, not unauthorized deletion of the task.

**Correction:** retain newly observed canonical namespace-bound IDs for inspection before stricter scope/target validation can throw, for bound and unbound responses. Such observation must never confer mutation/ownership authority. Preserve them even when later reads omit them. Keep the current refusal and no-replay behavior.

Reproduction: “retain a newly observed child even when its target metadata is unqualified”; `independent-unqualified-child-result.json` and `independent-unqualified-child-calls.json`; the final log shows the missing-ID assertion.

## Checks and positive controls

- **48 existing tests / 3 CTS suites passed**, including all six actions and modeled A/B/C rounds, source/policy/queue/auth/deadline boundaries, permanent claims, tampered prior receipts and current-vs-historical deletion states.
- **Eight independent cases: five passed, three failing assertions describe the two findings above.** The seven-case run has five passes/two failures; the additional targeted transient-summary case fails. No skipped case is counted as passing.
- Passing independent controls exercise the actual `nativeCtsRuntime.createClient` with the entry’s unchanged safety options (only origin redirected to `.invalid`) and the real private adapters for all three rounds; terminal source drift at actual entry result persistence; generic missing-parent404 remaining unknown after C; reappearing CLAS residuals after historical deletion; and refusal of an unproved LIMU prefix row before later mutations.
- All three TypeScript projects pass. Action policy, tracked file-size and schema budgets pass. Repository Biome check exits0, 1,438 files, no fixes, 14 informational findings. No full suite/build/native test was repeated.
- The initial independent terminal-drift test used the harness’s `record` hook even though the actual entry supplies its own journal callback, so its fault never fired. The corrected control wraps the actual driver record callback and passes. Initial source/log/report are preserved; this reviewer test setup failure is not a product finding.

Commands used Node22.21.1, `node --import ../offline-guard.mjs node_modules/vitest/vitest.mjs run --config ../vitest.config.mjs`, targeted test selection, `tsc --noEmit -p` for all three projects, and existing policy/budget/Biome commands. The configuration uses `envDir:false`, external cache/output paths, before-test worker guards and the inspected harness’s disabled-network MockAgent with both Agent and Client dispatch redirected. No real origin is used by the independent model.

The guarded test runs recorded no network or environment-file attempts. The policy/schema static tools produced four denied socket calls; a diagnostic rerun reproduced four calls explicitly targeting the local `/var/folders/.../T/tsx-501/60608.pipe` loader IPC path. The strict guard blocked them before OS connection; both tools still passed. Those events are preserved rather than called zero. No external/SAP connection or environment-file read was observed. No guard was relaxed. The test snapshot has no `.env`.

## Native prerequisites retained after correction

The missing-ID A4H/001 response remains unqualified. The production verifier accepts a successful namespace-bound empty organizer document; generic404 remains unknown, as the independent probe confirms. Root must supply the exact bounded native absence observation or equivalent retained receipt before approving C’s deletion contract; mocks do not establish it.

Release after recording the class deletion also remains a native observation to obtain, not a favorable assumption. Unproved additional rows, native refusal or uncertain release must stop and retain exact histories; do not remove rows to force release, replay claims or invent LIMU ownership. Actual released histories are permanent. The native release route must remain the explicitly empty target, with no import/downstream-route expansion.

After the fixes, any phase verdict still requires exact clean source/runtime binding, fresh package/preflight receipts, actual post-preflight raw-JPEG SM12 user/suffix controls, current no-overlap conditions, the once-only A→B→C sequencing, final native/lock audit and honest remaining evidence. A Basic native run would not prove current deployed PP or whole-PR readiness. Primary5aa, collections757 and all real native roots were untouched.

## Provenance

Author report SHA256 `d0ac22aed5e7aac24bb16076770e4bf0179d87383c1402b549ef953914f798d8` matches the supplied packet and bound copy. Snapshot manifest SHA256 `6649240afe807bdf04839063f5548b45acedb34a569960b4bae6979569dd8000`; candidate diff SHA256 `b8af3e5fcf8eb3039c7e74a20a34ea6b8250b3c0e186cd547316c33e8a6fffab`.

`review-evidence.json` binds the source manifest/diff/author report, unchanged probes, raw results/calls, passing/failing logs, guard files/events and final verifier. First and final source verification both reported the exact candidate and 4,928 unchanged files. The final verifier was the last source action; this report was written afterward outside the snapshot. Roadmap FEAT-93 was checked at the beginning/end; no source edit is warranted during immutable review.
