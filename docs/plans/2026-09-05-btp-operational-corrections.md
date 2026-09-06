# BTP documentation corrections — implementation plan

## Summary

Correct misleading capability and XSUAA recovery instructions, and run a credential-free strict
documentation build on pull requests. No runtime, IAM or deployment change. Approved as PR 01 of
the BTP setup improvement series; implemented independently from the later example/navigation PRs.

## Baseline and refined scope

Rechecked `origin/main` at `5c36f2a734870081780a5d4be734f605b1036318` (package 1.2.0).
The specialist multi-target guide already describes the right capability boundary; only summaries
disagree. Unit CI already runs for docs PRs. `docs:build` passes in strict mode on the baseline.

1. Preserve specialist guidance; add a compact action table checked against the runtime schema.
2. Correct the deployment and acceptance summaries, distinguishing mutations from ATC/Unit workloads.
3. Route MTA users to inspection/assignment; label manual creation/binding as an advanced alternative.
4. Diagnose unknown scope, missing/empty roles, wrong origin, stale SSO and cached client state
   separately. Preserve role assignments/mappings; remove destructive generic recovery recipes.
5. Share MkDocs dependencies between publication and a new read-only PR build; pin new actions.
6. Test source/table parity, workflow safety and a deliberately invalid table/link; review rendered
   pages and the MTA/unknown-scope/stale-session scenarios before opening the PR.

## Verification and boundaries

Run focused multi-target/policy/docs tests, strict docs build, formatting, type checking and diff
review. Verify negative cases actually fail. Record exact results in the PR description. Human/LLM
benchmarking is optional; no measured usability improvement or live customer readiness is claimed.
No cloud credentials, browser login, role changes or deployment are required.

## Final review checklist

- Public page URLs and existing linked step anchors remain usable.
- A read role is never presented as permission to mutate or as proof of SAP access.
- Unknown scope names do not lead to cookie deletion or wider roles.
- New PR workflow has no secrets, deployment, or write permissions.
- Changes remain documentation, documentation tests and CI only.

## Review refinement (2026-09-06)

Use the observed CF/custom public route throughout the OAuth examples; space-qualified XSUAA names
do not define the route. Migration instructions make URL changes conditional. Add a regression for
the actual-route command and remove the remaining derived-host examples; retain the existing
correctness/strict-build checks without expanding the operator documentation.

## Implementation evidence

- Full unit suite: 193 files / 5,760 tests passed; focused contracts: 58 tests passed.
- Type checks and strict MkDocs build passed on Node 24.11.1.
- Deliberately missing/invented actions fail the parity guard. A temporary nonexistent local link
  made MkDocs abort in strict mode; the fixture was removed and the clean build repeated.
- Rendered ownership and recovery sections inspected in the local browser. Walkthroughs for
  MTA-owned service, unknown scope and stale session lead to different, non-destructive actions.
- No live SAP/BTP or paid-model evaluation performed; no customer deployment claim.
