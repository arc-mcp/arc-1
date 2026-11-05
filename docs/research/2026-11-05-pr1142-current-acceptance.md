# PR #1142 current acceptance — 5 November 2026

**Blocked; keep the PR draft, ADR-0011 proposed and FEAT-93 open.** This is the current
acceptance ledger. The [plan](../plans/2026-10-26-broader-pinned-pp-writes.md#8-validation-and-release-gates)
retains the agreed requirements; archived dated reports retain their original results and limits.
Deletion, CTS, runtime controls and classic FLP remain in scope. Git/plugins remain excluded.

## Source and evidence boundary

The earlier bounded pass ended at `465f35c59` with the production tree of candidate `0ab3046e5`.
The subsequent production consolidation changes runtime modules and invalidates any blanket claim
that the final source is unchanged. Historical native/PP evidence retains its named revision and
route; no live operation or consumed claim was replayed during this refactor. Final qualification
must follow review and validation of the consolidated source.

## Acceptance ledger

| Gate | Current evidence and remaining work |
| --- | --- |
| Shared foundation and built-in implementation | PR #1138 merged. Explicit public admission and resource adapters are integrated. Source routing does not establish live qualification. |
| Earlier native representatives | Package/API, DDIC/procedural, enhancement, trace restoration and [RAP publication/reverse cleanup](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-04-native-rap-retained-v4.md#actual-native-outcome-4-november) completed for their named revisions/routes. The RAP gate must not be reopened from the plan's older snapshot. Generated-resource and recording limits remain. |
| Retained CTS | [v6](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-05-native-cts-released-pair-v6.md) adopts the already released A pair read-only. Independent review and fresh B recursive release/C empty-request deletion remain. v4/v5 failures stay failed; never replay their releases or reset claims. Preserve the no-downstream-import restriction. |
| Final-build PP | [Text-tail v2](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-05-current-pp-text-tail-v2.md) remains unexecuted: two distinct mapped writers, remaining text/recording proof and reverse cleanup need fresh source/artifact/identity controls. Earlier owner creation/activation must not replay. |
| Classic FLP and route denials | [Native-platform projection](2026-11-05-pinned-native-platform-projection.md) has source/controlled-wire evidence. Fresh deployed PP FLP and genuine Basic-target, aggregate, writes-off destination, raw-scope and exact-grant negatives remain. Direct native Basic tests do not prove PP or Basic-route denials. |
| Restoration | On 5 November, read-only CF queries confirmed the isolated app's current droplet and complete application environment match the saved originals; writes, transport writes and Basic targets are off. IAM/XSUAA/destination/SAP-role reconciliation and retained repository effects remain unverified; the BTP CLI session is expired. No live mutation was attempted in this bounded pass. |
| Local verification | Prior candidate full run: 20,188/20,190, two 10-second timeouts, no pending tests; **failed**. Both test files pass after setup isolation (165 tests). Build, three TypeScript targets, lint, policy, size/schema budgets and strict docs pass. Exact final full-suite and pushed-head CI results are recorded in the PR description; historical logs remain unchanged. |
| Independent review | One final fresh-context read-only review is required for the changed risk-bearing paths and open findings. Earlier component reviews are not final acceptance. |
| Final-head CI and governance | Remote `91b7ee45` has a CodeQL alert in a malformed-URI test fixture and cancelled integration/reliability jobs. The fixture correction requires final-head CodeQL verification. All required checks, release review and the remaining live/restoration gates must pass before ADR acceptance or readiness. |

The 3/4 November temporary-access approvals do not extend to a new live window. Verify current
permissions and saved originals first; obtain any new temporary grant once, with its exact effects
and restoration plan. No new experiment version, claim reset or relaxed acceptance gate is authorized
by this ledger. Missing 750/816/cloud evidence remains a named gap, distinct from native non-support.

## Production consolidation

Baseline: `465f35c59de2eb3e272d3ebf91091e16aa465fd2`; introduced-module comparison uses merge base
`5ec28e38fdad416e49115be88c97347d30cd85e9`. Counts include production TypeScript only.

| Measure | Before | After |
| --- | ---: | ---: |
| PR-introduced ADT modules | 76 | 47 |
| All ADT modules | 192 | 163 |
| All source modules | 429 | 400 |
| All source lines | 99,474 | 99,434 |

The net production change is **-40 lines**, with **29 modules retired**.
The largest consolidated family module is 426 lines. The 35–45 module range
was a design target, not a reason to collapse essential dependency boundaries; 47 remain.

Actual duplicated implementations removed, beyond relocating family code:

- Repository, declarative and quickfix selectors use one native descriptor table. Nine duplicated
  descriptor entries disappear; each caller retains its original explicit type subset and name/URI rules.
- Three standalone-owner readers share namespace-aware identity/own-package validation. Function
  children, DDIC parent ownership, generated resources and binding-specific exceptions keep their
  native contracts. The helper never follows a reference or authorizes a package.
- Eight metadata GET sites share fresh-read headers and the existing 1 MiB default budget behavior;
  caller budgets, Accept negotiation, operation guards and downstream package checks are retained.
- Mutation, quickfix and CTS request facades share one typed method mapper and receiver binding.
  Factory branding, source freshness, cumulative limits, cancellation/deadlines and owning-session
  cleanup remain in the existing lifecycle. CTS submission acknowledgement/expansion checks stay native.
- Binding metadata/patch/activation proof, CTS evidence, FLP entities/readback, ENHO preservation,
  KTD derived fields, RAP parsing/planning and class boundary evidence are maintained by family.
  No generic workflow engine, capability expansion or new public input is introduced.

Regression work exposed why two separations must remain: transport policy must not eagerly import
its HTTP sender, and pure quickfix input/evidence parsing must not eagerly import network execution.
Those boundaries were restored. Initial failing regression logs are retained; a pass is required
before this refactor is considered verified. The observable tool/schema fixtures are unchanged.

Source imports and current routing docs were updated; immutable historical research and native
journals remain available at their original revisions. The historical qualification source is preserved in the
[pre-cleanup snapshot](https://github.com/arc-mcp/arc-1/tree/1636bab36d86df10ba169f816d2bb4555b38419b/scripts/qualification/pr1142); it is not permission to execute consumed native claims.
FEAT-93 stays open and ADR-0011 remains proposed until current-source qualification and restoration.

## Repository cleanup

At the user's request, 293 PR commits were squashed into `1636bab36` with an identical tree.
The cleanup is a separate reviewable commit. The original history is also retained in a local
backup branch and verified Git bundle. No production `src/` file changes in this cleanup.

The PR changes **1,201 → 438 files**. Removed from the active tree:

- 292 one-off qualification files, including consumed experiment versions, fixed operator IDs,
  host-specific controllers and the formatter/deletion regression runners.
- 190 test/helper files devoted to that machinery, plus two orphaned shared test helpers.
  The baseline full passing run accounts for 163 retired test files and 4,033 cases.
- 243 repeated progress, review, gate-manifest and raw-dump research files; 50 useful native
  contracts, the current acceptance ledger and tested capability inventory files remain.
- 34 fixture files with no surviving reader. Product wire fixtures and tool/schema snapshots remain.

Five product test files keep their cases and assertions using direct source APIs and local test
inputs, removing their dependence on archived operators. The remaining unit CI stays in place;
only the CI/package command for the retired one-off qualification runners disappears.

Historical links now name the immutable snapshot rather than deleted current paths. The snapshot
retains every removed byte; the original run journals, mutation claims and raw evidence outside
the repository are untouched. A separate frozen recovery checkout is retained locally. Recovery
must use the original run's bound source, ownership and no-replay records; the archive snapshot
never overrides those bindings or authorizes another execution. The original `0ab3046e5` operator
checkout is also preserved. No live SAP/BTP operation was performed during this cleanup.

The cleanup removes **99,143 net lines**. All **537 remaining test files / 16,157 cases**
pass, with no failures or skips; the retained case names exactly match the baseline. All three
typecheck targets, build, lint, policy, sizes/schema and strict documentation checks pass.
The prior 20,190-case result describes the pre-cleanup tree. These deletions establish no live acceptance.
Further production simplification/review precedes final qualification.
