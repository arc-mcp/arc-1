# Issue #932: stop treating NHI discovery as HANA proof

## Research and reproduction

- Current main (`907b02c0`) still promotes an unsuccessful HANA probe to `available: true`
  whenever ADT discovery contains `/sap/bc/adt/nhi/` collections.
- Issue #932 reports this on two Oracle-backed ECC 7.50 SP23 systems. Our fresh
  `SAPManage(probe)` reproduces the same NHI-only positive on NPL 750 SP02; the local
  system setup dossier records its ASE database. A4H 758 SP02 confirms HANA through S4FND.
- The original #195 argument establishes NHI presence on one HANA installation, not
  exclusivity to HANA. A release threshold would introduce another unproven assumption.
- Existing unit tests explicitly require the false positive, including after an HTTP 401.
- No existing issue-932 PR was open when checked. Create a focused new fix PR.

## Proposed implementation

1. Keep discovery parsing and its `nhiPresent` metadata. Remove NHI's ability to enable HANA.
   When no stronger evidence exists, retain the failed probe reason and explain that an NHI
   workspace does not identify the database.
2. For unconfirmed automatic HANA results, use `HANA database is not confirmed` rather than
   claiming the database is absent. Keep the existing boolean result and on/off overrides.
3. Remove the unused `detectHanaFromDiscovery` identity helper and its implementation-mirroring
   tests. Correct the misleading discovery comment. Do not add endpoints, SQL, caches, flags,
   release guesses, or a new feature-state model.
4. Replace false-positive expectations with regression coverage for NHI plus non-HANA/empty
   components and missing/unauthorized hanainfo. Preserve confirmed components, direct probe,
   explicit on/off, MIME discovery and unrelated feature behavior. Verify the new regression
   fails before changing runtime code.
5. Explain the loss of the speculative fallback in the HANA configuration documentation:
   operators of known HANA systems without confirming metadata may explicitly set it on.

## Alternatives and scope

Dropping all NHI metadata is broader than necessary because the discovery return contract is
used by probe tests. Retaining it as diagnostic context makes the change small and explains the
reporter's observed signal. HANA-only treatment of generic 400/500 endpoint statuses is a
separate question; this patch removes the demonstrated NHI promotion and does not invent a new
database detection contract. The feature currently informs models, not authorization.

## Verification and review

- Independent plan review before runtime edits; record findings and resolution below.
- Focused feature/discovery tests, then typecheck, lint, policy validation, size/schema budgets,
  build and full unit suite with supported Node 24.
- Compare the built CLI/current client on NPL 750 and A4H 758 before and after. Use verified
  HTTPS and local Basic credentials without logging secrets. No SAP mutations are necessary.
- Oracle SP23/BTP principal propagation is reporter evidence, not our own live coverage.
- Independent implementation review, fix findings, repeat relevant tests, final review, then
  create the PR. Check roadmap at start/end: no existing idea represents this narrow bug.

## Review record

Independent reviewer approved the plan before runtime edits: preserve original failed-probe
context and explicit overrides, avoid claiming the database is absent, and distinguish local
ASE/758 coverage from the reporter's Oracle/PP evidence. Four regression cases failed against
unchanged runtime code before implementation (NHI with empty or non-HANA components; 401/403).

Implementation and independent final review are complete, with no remaining actionable
findings. The [verification record](../research/2026-10-07-issue-932-hana-evidence.md)
records the live 750/758 comparison, 7,843 passing unit tests, required checks and
coverage limits. Final roadmap check: no roadmap impact.
