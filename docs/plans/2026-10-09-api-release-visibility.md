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
current contract-default behavior. Reject unrelated actions, duplicates, unknown
values and NOT_RELEASED+visibility before HTTP.

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
