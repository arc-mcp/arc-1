# Independent publication correction re-review

Candidate **412e10b78e47845fe10c54e4eb42c59815b912ae**; correction base **8e0ef608b5f97f6e638b714aa501dd511e5e5bd5**.

**GO for composite private integration of the native-governed publication candidate plus this correction at 412e10b7. No actionable blocker remains from this review.** This is not native execution, current-code PP, public admission, generated-owner cleanup or whole-PR/merge approval.

This is Codex fallback following the confirmed Claude limit. I authored neither this publication candidate nor its tests. I authored a separate local-root package candidate that uses the exact same pure request-policy helper copied from the publication base; the two helper/FLP files are byte-identical. This review does not independently approve that separately authored root candidate. The root branch/worktree was preserved unchanged.

## F1 — matching getter completion: closed

The shared executor removes `already-reported` and its no-job success path. At `src/adt/pinned-publication-execute.ts:188`, both recording profiles now create the same one-use publication authority and submit the explicit native job even when the initial getter matches. Native ERROR remains `native-failed`; uncertain HTTP failures remain `submitted-unconfirmed`; missing/mismatched readback remains unverified. The native-governed profile reports `native-state-observed`, preserving its weaker recording/branch claims. The distinct trusted-reader profile retains its original qualified status. The ordinary single-target sender is unchanged.

The original eight external probes were copied with **only the old snapshot/output prefix replaced**. Assertions and mocks are unchanged, and reversing the prefix replacement reproduces the original bytes. All **8 pass**, including direct and Connectivity false-getter reproductions and the positive explicit-unpublish controls. Original probe SHA-256 remains `e477b482ad65a64595a8867ea4ec5de68c100a0d51d5c7c5a4b290c228a544b1`; provenance is in `probe-provenance.json`. The original four-failure history and raw observations are untouched. New observations in this packet show the previously skipped jobs being submitted; they are synthetic runtime controls, not SAP evidence.

The affected committed tests also cover matching false/unpublish and matching true/publish for both profiles and both HTTP branches, including native ERROR and uncertain failures. They assert one POST, no replay, honest item state and distinct recording labels rather than merely changing expected prose.

## F2 — minimalErrors projection: closed

Both wrappers apply `publicationClientResult` before serialization: `src/handlers/pinned-publication-native-governed.ts:103` and `src/handlers/pinned-publication.ts:59`. The new helper has a type-only executor import. With minimalErrors enabled it constructs a new result/items/status projection retaining native severity and structural/submission/partial-state evidence while omitting native short and long diagnostic text. It leaves the raw executor evidence untouched; with minimalErrors disabled it returns the original diagnostic result.

The unchanged direct/Connectivity diagnostic probes now pass. The affected tests cover both wrappers, both transports, minimalErrors on/off, native OK and ERROR text in a three-owner partial batch, and unsubmitted later owners. A frozen actual mock-HTTP executor result verifies the projection does not mutate source evidence. Inspection confirms native request errors use fixed/generic messages at this boundary rather than copying native response text into another result field.

## Preserved boundaries and composite scope

Only four production files differ from 8e: the shared executor, both wrappers and the new pure projection. `source-comparison.json` records the complete 12-path delta. The low-level shared sender, one-use publication authority, native-governed recording profile, complete-owner preflight, generated-binding deletion guard, schemas and public admission are byte unchanged.

The composite still requires both explicit unrestricted request policies for the native-governed profile, independent actual-package authorization, raw scopes and exact selected target/client/context admission. Its guarded direct/Connectivity sends retain policy checks after authentication/semaphore awaits. The original 30-second membership/configuration lease is not renewed by waits; the outer deadline, cancellation and cumulative response/attempt budgets remain. All batch owners are preauthorized before mutation; each binding is reread before its one-use submission. Later failures retain earlier successful observations and unsubmitted items. Generated-owner cleanup remains refused without the separate proof.

The trusted current-principal non-recording configuration reader remains distinct and has no production implementation. The both-wildcard alternative does not manufacture a CTS receipt or universal non-recording guarantee. Native job OK plus matching metadata remains branch-dependent sequential evidence, not frontend/all-alias availability or generated-state absence. Native/PP and public qualification stay open. FEAT-93 and associated documentation preserve those limits and the original review is retained verbatim with its bound hash.

## Independent checks and source integrity

All checks used explicit Node **22.21.1** and the immutable snapshot working directory.

- Original rebound external MockAgent probes: **8/8 passed**, `independent-probes.log`. External connections disabled, synthetic tokens/invalid-domain endpoints only.
- Affected publication executor/wrappers, private FLP and legacy devtools: **397 tests / 4 files passed**, `affected.log`.
- All three TypeScript projects: passed, `types.log`.
- Full lint: passed, `lint.log`.
- Policy validation: passed, `policy.log`.
- File/schema budgets: passed, `sizes.log`.
- First helper verification and final `review-input/verify-snapshot.py`: **4,749 files unchanged**, exact candidate 412e10b78e47845fe10c54e4eb42c59815b912ae. Final receipt: `final-verification.log`.
- `.env` absent. Original verdict and probe hashes verified; preserved verbatim review hash is `784823449a5056f16a4a846ba11a3aa7583284aa95f30d753bdec3ba26b74415`.

No new full suite/build/documentation build was needed for this bounded correction review; the author's current affected/build/docs/static results and previous full-suite results are author/history evidence, not fresh independent whole-suite results. No claim is made about inherited process environment contents, which were not inspected. No real network/SAP/native phase, browser, credentials/environment-file access, installation, delegation, push or source edit occurred. Probe files/configurations/results and this verdict remain outside the immutable source. The final verifier was the last source operation.
