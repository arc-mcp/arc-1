# Explicit API-release visibility

## Native contract and root cause

On owned classes, C1 metadata on 758/816 defaults Cloud visibility to true. BTP
920 SP04 defaults both flags to false, so an unchanged public release request
gets ARS_STATE_HANDLER/119. A controlled native PUT selecting Cloud=true and
KeyUser=false succeeds, reads back exactly, and can be revoked. All fixtures were
deleted. 750 has no API-release endpoint. The API exposes per-contract Default and
ReadOnly flags; it does not expose a universal list of supported visibility pairs.

## Small implementation and plan review

Add optional `apiVisibility: ["cloudDevelopment", "keyUserApps"]` selections to
SAPManage.set_api_state. It is a complete explicit selection: [] requests both
false and leaves SAP to return the contract-specific error. Omission retains the
current contract-default behavior. Drop inapplicable visibility on unrelated actions and NOT_RELEASED during argument
normalization, matching strict-schema client handling elsewhere. Reject duplicate and
unknown selections on releases before HTTP.

Pass the selection to the existing narrow GET/PUT/GET builder. Respect that
contract's native ReadOnly flags: explicit changes need editable metadata; fixed
flags can retain the current/default value. Missing visibility metadata refuses
an explicit selection. Keep native validation for all other C0–C4 requirements;
do not presume all contracts require a visibility or implement an AMDP validator.

Readback must match an explicit selection even when SAP says "No changes were
made"; the existing omission/no-op behavior remains compatible. Keep real-package,
write-scope, deny-action and safety gates. No new endpoint/cache/release workflow.

Test native C1 release, repeat/no-op, revoke, unsupported C0/C4 combinations,
permission/package refusals and exact readback on 758/816/BTP. Test 750 unavailable.
Add local failure controls for missing/read-only metadata and readback mismatch,
then all repository gates and final review.

## Implementation review and validation

The API-release parser, narrow builder and PUT/readback workflow now live together
in api-release.ts; the facade retains its operation safety check and the handler
retains the real-package check. This keeps the existing file-size budgets rather
than expanding the client/parser monoliths. Tool fields are one small shared object.
No metadata serializer, cache, visibility heuristic or AMDP validator was added.

8,079 tests pass, including explicit selection, empty selection, missing/read-only
metadata, schema refusal, native no-op mismatch, unsupported contract and read-scope
controls. Typecheck, lint, policy validation, build, file/schema budgets and docs
build pass. Tool snapshots reviewed after regeneration.

Compiled public-tool tests on 2026-10-09 UTC: 758, 816 and BTP920 SP04 release C1
with Cloud-only visibility, repeat successfully with exact readback, revoke and
delete; owner GET404 on every target. Empty selection refuses: 758 returns no
release, caught by readback; 816/BTP return ARS_STATE_HANDLER/119. Unsupported C0
refuses before PUT. C4 preserves native contract-specific validation/read-only
behavior. Real-package and read-only-scope controls refuse. 750 returns endpoint404
and its test class was deleted. C2/C3 and successful AMDP C4 are not qualified by
these class fixtures; existing behavior for omitted visibility is unchanged.

Local raw evidence: 816-validation/implementation/api-visibility-public-*.json.
Roadmap checked: no committed item changed; covers local audit recommendation R6.


## Final cleanup audit limitation

The original C4-after-C1 test left an APIS row on 816 and BTP after deleting its
class while C4 remained RELEASED. Owner 404 and empty post-deletion API_STATE do not
prove complete catalog cleanup. The old harness's partial revocation is corrected in
the follow-up validation; no catalog rows were edited. A supported recovery for the
existing residue remains unproven, separately from existing BTP SUSH entries.

Combined review with the other matrix fixes found a three-token BTP schema budget
overrun; trimmed redundant contract help and retained every input field and limit.

## Independent review follow-up (2026-10-10)

Two dispatcher-level reproductions confirmed that unrelated strict-client fields were
rejected and an accepted PUT with different visibility hid the applied release. The
small correction keeps the mismatch error but includes the confirmed state/visibility,
changed flag and explicit revoke/readback instruction. No automatic rollback is added:
it could overwrite another change and the caller must decide which release is intended.
A native no-op mismatch likewise reports changed=false and its actual state.

C4-after-C1 on 816 and BTP was **applied with different visibility**, not refused.
The original harness revoked only C1 before deleting, leaving C4 released at deletion.
APIS directory residue exists on both systems; an empty API_STATE after deletion does
not establish prior revocation. The mechanism remains a hypothesis. New validation
revokes every observed released contract and verifies that state before deletion.

## Second independent review (2026-10-10)

The disclosure covered only a mismatching read-back. A failed or unusable read-back
after an accepted PUT still surfaced as a plain read error (status only with minimal
errors), hiding that SAP had accepted the change. It now states the PUT outcome and
that the resulting state is unconfirmed, without claiming a confirmed state, and keeps
that guidance under `ARC1_MINIMAL_ERRORS`. The revoke instruction appears only when the
confirmed contract is RELEASED. Merged current main to resolve the roadmap conflict.
