# PP setup examples — implementation plan

## Summary

Ship two checked, conservative BTP examples and an optional input/result worksheet. The existing
deployment runbook owns the ordered steps; example READMEs only explain their files and differences.
No runtime, IAM, wizard, generator or cloud changes.
PR 02 is approved independently; PR 01's correction PR is recommended first but not a code dependency.

## Baseline and implementation sequence

Rechecked main `5c36f2a734870081780a5d4be734f605b1036318` (package 1.2.0).

1. Add `examples/btp/single-pp` and `multi-pp`, each with one complete property-only MTA extension,
   two destination JSON templates and a short file-reference README.
2. Use fictional QAS/001 and QAS/100. Single PP pairs Basic startup and PP request destinations
   for QAS/001; multi PP marks two PP targets and leaves the single route unconfigured.
3. Keep all mutation/data/SQL flags off, strict PP on, UI/plugins off, cache none. Deny ATC/Unit
   in these conservative examples; this is an explicit profile choice, not a runtime restriction.
4. Test the actual files with the config parser and full destination registry. Assert client string
   preservation, identity pairing, no Basic multi-target opt-in, conflicts and safe placeholders.
5. Extend MBT validation; exclude examples and private `.arc1/` operator files from the MTA payload.
6. Add an optional worksheet with pre-setup inputs and post-deployment results, not another task map.
   Integrate profile selection into the runbook; clarify sample user versus CA/system certificates.
7. Run focused tests, full unit suite, typecheck/lint, MBT validation and strict docs build. Inspect
   rendered links/worksheet; final diff review, then create the PR.

## Review constraints and acceptance

- Supported starting point is a new MTA-owned deployment, not conversion of an existing topology.
- Each example is structurally complete but fictional; no claim it can connect unchanged.
- URL/client intent must match; a shared label/SID alone cannot prove physical backend equivalence.
- Secret fields remain conspicuous placeholders supplied securely by owners, never requested in chat.
- No service adoption, SAP client copy, role grants, proposed target ACL, UI or shared-Basic pack.
- Positive offline checks prove syntax/policy only. Live identity/authorization acceptance stays
  with the customer; optional usability/LLM trials are not required for this change.

## Review refinement (2026-09-06)

- Remove the profile-copy/runbook overwrite conflict; assert the exact non-overwriting commands
  and absence of the subsequent generic overwrite. Keep OS subprocesses out of these unit tests.
- Prepare single-PP destinations before deployment; keep file-specific notes in examples and
  ordered setup/acceptance in the runbook. Do not require the optional worksheet first.
- Replace the overview's second numbered deployment sequence with a runbook handoff, preserving
  old section anchors. Put the optional worksheet under administration, not ahead of deployment.
- Correct SYSTEM identity claims in the runbook and PP guide. Its user comes from configured
  identity/token claims; safe-read success is separate from SAP-side, request-correlated evidence.
- SM20 verification is conditional on recorded events; missing evidence stays unverified rather
  than triggering broad tracing or elevated SAP permissions. Check SAP's audit/filter references.
- Validate each PR and the combined tree; review HTML and raw Markdown walkthroughs. Existing test
  counts below describe the initial implementation, not the revised PR's results.

## Initial implementation evidence (2026-09-05)

- Six actual-file profile tests pass, including malformed client values, accidental PP credentials,
  duplicate targets and instance-level destination shadows. Tests use the real config parser and
  registry; they do not provision destinations or prove cloud connectivity.
- All 193 unit files / 5,763 tests pass; typecheck and lint pass (existing Biome configuration
  notices remain). All five MTA descriptors/extensions pass MBT 1.2.47 validation.
- Strict MkDocs build passes. Rendered worksheet headings, ownership table and navigation were
  reviewed in the local browser. No customer usability or LLM improvement score is claimed.
- Final source review corrected the preparation order: the single startup destination resolves
  during startup and must exist first; multi can start empty and requires restart after additions.
- No runtime source, dependency lockfile, cloud, IAM or SAP changes. Live acceptance remains a
  separately authorized owner task, with identity/negative evidence required per client.
