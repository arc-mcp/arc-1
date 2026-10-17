# Policy explanation validation — 17 October 2026

> **Superseded decision (17 October 2026).** Do not ship `explain_policy` or require
> it before normal calls. Existing denials and schema pruning cover the ordinary
> workflow. Only the deny-rule clarification and BOR regression are retained in
> [#1016](https://github.com/arc-mcp/arc-1/pull/1016). This document and its reviews
> preserve the historical experiment, not the current product contract.

[Plan and review](../plans/2026-10-17-policy-explanations.md) ·
[User contract](../../docs_page/authorization.md#explain-a-proposed-operation) ·
[Live results and source hashes](adt-vscode-1.2/evidence/policy-live-summary.json).

## Implementation review

The action reuses the execution schema, normalization, ACTION_POLICY, scope implications, deny
matching, target grant/ceiling, safety gates and static package evaluator. It does not call the
proposed handler. Simple existing-object package reads are gated before metadata retrieval.

| Regression spike | Result |
|---|---|
| Configured ceiling confused with caller-restricted safety | Separate checks; fail-before regression passes |
| Hierarchy traversal during an explanation | Keep hierarchy-dependent decisions unresolved; no traversal |
| Metadata read without a package restriction | Avoid unnecessary reads, matching existing enforcement |
| Unbounded proposed argument JSON | 64-KiB bound in runtime schema and direct helper |

Four new regression cases failed against the preserved prototype before correction. Focused tests
cover actual dispatcher parity, canonical/slash types, own action scope/deny, target denial without
metadata reads or grant disclosure, SQL/data and transport/Git gates, missing/failed package evidence,
caller-supplied package rejection and invalid/irrelevant inputs. Seven tool snapshots changed only
for the new action/help and two fields. Multi-target exposes only the new explicit read action.

## Checks

| Check | Result |
|---|---|
| Focused explanation and multi-target surface | 32 tests passed |
| Tool snapshots | 12 tests passed; seven expected fixtures reviewed |
| Full unit suite | 8,990 tests / 320 files passed (`--maxWorkers=4`) |
| Typecheck, build, Biome, policy/file/schema budgets, strict docs | Passed |
| Claude Opus 5.5 Max GUI review | Pending exact-commit review |

The first full run caught the missing action in the maintained multi-target documentation table.
That table was corrected; the final full run passed without changing product behavior.

The file ratchet increases by four lines for compact tool help/fields and gives the runtime schema
an explicit 1,509-line ceiling (nine above its former default). Wire/token ceilings are unchanged;
duplicate property help was removed instead of increasing token budgets. No standalone policy
framework or evaluator duplicate was introduced.

## Live checks

A4H, SAP_BASIS 758, client 001, HTTPS 443, existing Basic test identity. CLI calls have no inbound
MCP scope layer; HTTP/XSUAA scope and target behavior is covered by local tests, not claimed as a
new live IAM qualification. No proposed SQL or mutation was executed.

| Proposal | Relevant configuration | Result | CLI ms |
|---|---|---|---:|
| Read existing PROG | writes and SQL off | ARC-1 checks allowed; SAP authority unverified | 4923 |
| Free SQL | `allowFreeSQL=false` | denied with blocking flag | 4107 |
| Delete existing PROG | `allowWrites=false` | denied; no package read | 2623 |
| Delete existing PROG, metadata-only explanation | child process writes enabled; packages `$TMP` | actual package `ZARC1_DEMO_REVIEW` denied | 2730 |

The last case enabled writes only in that short-lived local test process to reach the explanation's
metadata branch. It performed no deletion, activation or other mutation, and changed no persistent
configuration. The actual metadata package, not the proposal's package, determined the result.
Private CLI logs remain in `test-results/policy/live/`; public evidence contains only sanitized
checks and artifact/source hashes. An explanation returning `denied` is itself a successful read,
so its CLI exit code is zero; consumers must inspect `decision`.

## Remaining limits

Creation, structural ownership, hierarchy-dependent package rules and SQL lineage stay unresolved.
Cached feature evidence is not SAP authorization. All guards run again on execution. FEAT-88 now
tracks only those remaining prerequisites, with repeated real troubleshooting cases as its resume
trigger. No live PP, multi-target or other-release acceptance is claimed for this new action.

## Independent review follow-up

[Claude Opus 5.5 Max report](adt-vscode-1.2/evidence/policy-claude-review-1.md) requested three
changes at `6a964ad5`. The reviewer independently passed 8,990 tests and all gates.

| Finding | Resolution |
|---|---|
| M1: internal data prerequisites | SOBJ requires free SQL; class hierarchy requires free SQL or preview. Reuse the safety evaluator; retain unresolved lineage. Runtime scope policy is unchanged. |
| M2: hyperfocused denials | Expand SAP proposals with the dispatcher helper; check delegator scope/deny before the concrete operation. Intent proposals also include that layer in hyperfocused mode. |
| M3: disclosure before scope | Scope denial now returns immediately, omitting later policy checks and metadata reads. |
| R1: configured versus effective ceiling | Retained for callers holding the proposed scope, as the agreed troubleshooting contract requires; under-scoped callers see neither. |
| R2–R5 | Report unknown field names, document outer target and hyperfocused forms, add parity tests, explain unresolved Git capability. |

Seven new tests failed before the fixes and all 29 policy tests then passed. Parent notebook review
fixes were merged normally, preserving the published stack. No proposed operation was executed.

After these corrections and the notebook parent update, **9,005 tests / 320 files passed**.
Typecheck, build, Biome, policy, file/schema budgets and strict docs all passed. Final independent
review is requested on the resulting commit; the earlier live evidence retains its original hashes.

## Second independent review

[Claude review 2](adt-vscode-1.2/evidence/policy-claude-review-2.md) approved `83d02146` with
no must-fix items; its clean full rerun passed 9,005 tests. We also fixed its low-severity N1:
explicit `SAP` proposals now retain the multi-target prohibition before checking the expanded intent.
The regression failed before the fix; 90 policy/dispatch tests and typecheck passed afterward.
A quick exact-commit verification follows.

The review also noted a pre-existing distinction: `SAP.read` denies the delegator route; a direct
intent call needs an intent-level rule. The user guide now states this instead of expanding this
PR into a tool-registration redesign.

[Final Claude verification](adt-vscode-1.2/evidence/policy-claude-review-3.md) approved product
`70388fa1`: 106 focused tests and source/test typechecks passed on Node 22.21.1. Its only optional
note was moving the hyperfocused deny-rule explanation out of References; done in this documentation
follow-up. No policy product changes followed that approval.
