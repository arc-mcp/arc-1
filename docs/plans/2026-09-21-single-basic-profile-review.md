# Single-target Basic BTP profile review (#767)

## Root cause and scope

The base MTA enables Principal Propagation. Merely supplying a Basic destination does not select
shared authentication: a usable single-Basic profile must explicitly disable both PP flags while
retaining XSUAA for MCP callers. Existing guidance lacked that complete profile. Default gCTS,
FLP and UI5 Repository probes also request non-ADT paths, despite an ADT-only Connector mapping.

## Implemented plan

1. Merge current main, preserving #678's exact callback and upgrade instructions alongside the
   two single-target profiles' destination prerequisites.
2. Trace the profile through configuration, startup authentication and feature probing. Keep
   the existing three-profile examples, explicit off-values, shared-identity explanation and
   owner handoffs; remove misleading universal claims rather than add another setup guide.
3. Confirm the profile retains XSUAA, denies writes/data/SQL/test workloads and sends no optional
   non-ADT probes. Check that safe-read success and backend identity remain separate evidence.
4. Validate profiles and current descriptors, run focused/full tests and strict docs, and walk
   the human/LLM entry point through setup and acceptance. Push #767 after final diff review.

## Validation and limits

- Parsed base/profile overlay: PP/strict true → false; XSUAA remains true; writes false; all three
  non-ADT feature probes off. Actual configuration, probe and startup tests confirm the behavior.
- 188 focused tests and 6,970 full unit tests pass. Typecheck, lint, policy, size/schema budgets,
  all six MTA validation combinations and strict MkDocs pass.
- Walked Start Here → single-Basic profile → destination/owner handoff → callback instructions →
  Viewer read → separate backend identity verification. Preserved #678; corrected the legacy
  bootstrap path description and confined `SAPTargets` identity labels to multi-target mode.
- SAP's [Cloud Connector mapping guidance](https://help.sap.com/doc/00f68c2e08b941f081002fd3691d86a7/2023.20/en-US/3bdb65253c8046b2b8234c554072569f.html)
  confirms principal type None for username/password authentication; other products' service
  paths in that guidance do not replace ARC-1's scoped path table.

No production code changed and no live customer Cloud Connector/XSUAA deployment was performed.
No roadmap impact: DOC-02's broader Basis handbook and independent acceptance remain outstanding.
