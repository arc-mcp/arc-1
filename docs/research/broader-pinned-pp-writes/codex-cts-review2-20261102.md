# CTS correction review 2

Independent parent Codex review of `91314dd72d5593b0f390cc4fccbc517bd5319508` against `0ceb45fde67ce9ff575138804bd5ea703a43bbeb`. Reviewer authored neither the implementation nor the correction/tests. Codex follows the confirmed actual Claude capacity limit.

**Private integration: GO. No new finding in the correction.** All three independently reproduced P2s are closed:

1. The inactive reader now checks the known root and nested shape, rejects unknown completeness/paging metadata, validates canonical assignment names and exact provided URI/parent references before classifying an entry as unrelated. Empty qualified and explicitly unrelated inventories remain accepted; unknown markers, malformed identities and selected child assignments produce zero mutation submissions. Native completeness remains a qualification requirement, not something these synthetic cases establish.
2. Namespace-bound native description is retained and compared exactly for both create routes. Missing, changed, padded, foreign or ambiguous values leave one acknowledged creation incomplete, without retry, PUT or rollback. Escaped and numeric-looking strings retain their textual meaning.
3. Every organizer GET after membership freezing contributes to a monotonic expansion set, including legacy convergence reads. The mutation wrapper stops further explicit mutations once expansion is observed; terminal/final failures retain the IDs and prior confirmed effects. Release cannot regain overall confirmation when a later snapshot omits the child. Other management paths still require exact refreshed membership before confirming their postcondition.

Read the production delta, relevant complete handler/HTTP/evidence flow, all added regressions, original independent verdict, author report and roadmap context. Independently ran six focused/private/legacy/runtime/descriptor suites: **327 tests passed** on Node 22.21.1. Author reports 30 expected failures before correction, then 143 focused and 507 files / 13,724 full tests plus all other checks; those broader checks were not repeated in this focused review. No custom additional failure probe was executed.

First/final snapshot verifiers confirmed all 4,567 attested files unchanged. No source edits, installs, manual Git, credentials, native/network/browser actions or delegation occurred during review. Some broad output was truncated; full decisive handler/HTTP and test ranges were then read separately. A research search initially used the wrong filename; the author report and retained review provide the contract/qualification context. No source reads followed final verification.

Private admission only: native K/W/T contracts, rich inventory/terminal/entry-lock evidence, both create routes and downstream CTS effects, current-build two-writer PP, realistic role composition, refusal controls, public schema/capability admission and whole-PR readiness remain open.
