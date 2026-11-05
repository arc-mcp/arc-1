# Independent package/API/binding review 1

Candidate `8dd5dfa07402a36d5cc4c347e475b31406e35db7`, base `e2b08f3d984f8cd84a30038f74820932db36cf1a`. Reviewer: parent Codex, who did not author the implementation. Codex fallback follows the actual Claude session limit.

## Verdict

One P2 correctness finding should be fixed before accepting this private implementation as review-complete. No public capability admission is granted. Package deletion and publication execution are correctly documented refusals; native/PP qualification and end-to-end wiring remain outstanding. This is not a native-run or whole-PR merge verdict.

## P2 — Package create does not verify required descriptive/responsible fields

`src/adt/pinned-package.ts:255–263` verifies parent and selected component/layer/type/recording values, then reports `ok:true,state:created`. It never verifies the required `description` or explicit native `responsible`, and `readPinnedPackage` does not expose either native field. A missing or different native value is therefore accepted as complete success, although the caller explicitly requested those attributes. Preserve acknowledged creation as `created-unverified` when these postconditions cannot be established; do not roll back or retry.

This is visible in the executed existing positive regression: `tests/unit/adt/pinned-package.test.ts:13` requests description `Test package` and responsible `MARIAN`; its readback uses `packageXml` from `tests/unit/adt/pinned-managed-harness.ts:29–30`, which returns neither attribute. The test still requires and receives complete success at lines35–40. This is concrete missing-evidence acceptance, not a claim that SAP silently dropped these fields in a live run. The repository's native package-creation dossier records the real responsible attribute and its importance for cloud creation.

Expose the namespace-bound native description/responsible attributes in package evidence and compare them to the submitted values before complete success. Add absent, changed and correctly matching cases, proving one POST, no retry/deletion and the correct unverified outcome. Keep the existing cloud/on-premise evidence limits explicit.

## Other assessed boundaries

- Required factory-registered pinned context, common mutation policy and independent package/CTS constraints are retained. Native object/package identities are parsed with namespace binding; unsupported types/fields refuse.
- Package target absence is a typed ADT resource-not-found contract, not a bare HTML404. Child subtree checks are tied to the verified parent. Package deletion cannot reach LOCK/DELETE while emptiness/noncascade remains unqualified.
- Move validates exact one-owner preview, source/target packages and structural preview CTS selection, then refreshes policy before execute. Preview side effects and the absence of a lock are disclosed. Unknown execute outcomes are not replayed or reversed.
- API release binds APIS name/type/URI/package to the owner, uses native C0–C4 state/behaviour checks and existing visibility builder, refreshes owner/recording/document before PUT, verifies readback, and distinguishes uncertainty. Actual publication recording is not fabricated from owner transport checks.
- SRVB CRUD requires explicit unpublished/not-generated state; update validates caller metadata hash under the owning lock, preserves opaque XML, checks native inactive readback, and retains cleanup failures. Private activation validates exact references and both native active/default readbacks; the public entry remains closed.
- Publication and batch preflight validate selectors and active metadata but submit no jobs. This is an implementation gap honestly retained, not completed parity.
- Optional shared hooks preserve legacy call signatures when absent. The scoped HTTP facade retains deadline/cancellation/no-replay. The new package-browser error remains an AdtError subclass. No public schema, scope, grant or matrix row was added by this commit.

## Verification

Initial and final snapshot verifiers each confirmed all4560files unchanged. Relevant new and shared unit suites, three-project typecheck, policy and file/schema budgets passed; see adjacent logs for exact counts. Full505files/13621tests, build, lint and strict docs are author-reported, with preserved logs. The review ran no install, source edit, live test, credential access or external-service action; it did not execute a custom mutant/reproducer. Existing positive package tests demonstrate the missing-field acceptance described above. Some broad read output was truncated; decisive finding lines and test fixtures were subsequently inspected with bounded reads. FEAT93 was checked and remains open. No source reads followed the final verifier.
