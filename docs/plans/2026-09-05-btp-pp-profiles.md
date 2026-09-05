# PP setup packs — implementation plan

## Summary

Ship two checked, conservative BTP examples and one shared owner/input worksheet. Keep the existing
MTA and specialist guides authoritative. No runtime, IAM, wizard, generator or cloud changes.
PR 02 is approved independently; PR 01's correction PR is recommended first but not a code dependency.

## Baseline and implementation sequence

Rechecked main `5c36f2a734870081780a5d4be734f605b1036318` (package 1.2.0).

1. Add `examples/btp/single-pp` and `multi-pp`, each with one complete property-only MTA extension,
   two destination JSON templates and a short preparation/acceptance README.
2. Use fictional QAS/001 and QAS/100. Single PP pairs Basic startup and PP request destinations
   for QAS/001; multi PP marks two PP targets and leaves the single route unconfigured.
3. Keep all mutation/data/SQL flags off, strict PP on, UI/plugins off, cache none. Deny ATC/Unit
   in these conservative examples; this is an explicit profile choice, not a runtime restriction.
4. Test the actual files with the config parser and full destination registry. Assert client string
   preservation, identity pairing, no Basic multi-target opt-in, conflicts and safe placeholders.
5. Extend MBT validation; exclude examples and private `.arc1/` operator files from the MTA payload.
6. Add a public worksheet with owners, inputs, pending evidence and handoffs; link it and the packs
   from Start Here/PP. Clarify sample user certificate versus CA/system trust material.
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

## Implementation evidence (2026-09-05)

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
