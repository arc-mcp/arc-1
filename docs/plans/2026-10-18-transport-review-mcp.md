# Transport review through MCP

**18 October 2026 · refocus of PR #1008.** This replaces the earlier CLI/report scope.
The user wants useful transport evidence on BTP, with rendering left to the caller.

## Outcome

`SAPTransport.diff` returns the source changes it can establish and clearly identifies
what it could not review. It runs through the existing authenticated MCP server with
no local output files, stored review sessions, custom SAP helpers or new service.

## Smallest useful change

| Keep | Why |
|---|---|
| Every selected part, including failed reads | A missing class include must not disappear beside a successful main diff |
| Unattributed candidate diffs | An exact main match does not prove that other class parts were unchanged |
| Honest baselines and source states | Missing history is not creation; a released comparison must not silently use active/draft source |
| CTS components and non-source gaps | Text-only entries, whole-object scope and method keys need accurate interpretation |
| Bounded collection and output | Sequential reads, cancellation, existing HTTP byte/attempt limits and capped diff work protect a shared BTP process |
| Stable paging | Reuse offset/limit and return nextOffset when bounded work stops; clearly state that open-request pages are not a snapshot |
| One compact JSON response | Reuse current diff fields, add only evidence needed to interpret them; no report format switch |

Remove CLI commands, workflow collectors, artifact schemas, HTML rendering, report demos
and their tests. Remove duplicate state/provenance fields that do not help the MCP consumer.
Do not add an automatic syntax/ATC/unit orchestrator; existing tools already perform those checks.

## Plan review

Claude Code Opus 5.5 Max completed the independent design review. Accepted: no new
parameters, source states derived from transport status, one compact response, 64-KiB
output, no hashes/continuation/aggregate completeness label, and no speculative adapters.

Judgment after review:

- Keep every attempted class part visible, including speculative 404s: absence is not proven.
- Keep small dedicated handler/budget modules for readability and tested per-response plus
  cumulative bounds; avoid putting this back into the large transport handler.
- Keep unattributed active comparisons labeled as candidates; do not silently erase their hunks.
- Open-request pages are not snapshots; unchanged object counts cannot detect all inventory drift.
- Include `diff` explicitly in the BTP multi-target read allowlist only with matching normative
  docs and tests for target identity, policy, cancellation and existing mutation refusals.
- BTP CF hosting, its connectivity route and a SAP BTP ABAP backend are separate qualifications.

Claude's BTP follow-up accepted the architecture. Added a 20-second page deadline below the
30-second shared-target queue timeout, minimal multi-target part errors, immediate 401/cancel
exit, and shared-identity/target-grant regression tests. We retain existing backend attempts
rather than adding an unverified BTP-ABAP ban: a tool registry omission is not evidence that
all native history endpoints fail. Backend qualification remains explicit and incomplete.

Implementation review found a live active-baseline defect: `00000` can be older than the latest
snapshot. Active reviews now select from all historical snapshots, independently of that work-state
timestamp; conflicting historical dates/numbers remain uncertain. Pending drafts are explicit.
Safe parser errors survive minimal mode; speculative missing attribution has its own note.
Unused metrics and feed flags were removed. The research index stays because it preserves the
requested adoption inventory; schema-budget headroom was trimmed rather than raising the ceiling.

## Read-only spike

Use existing authorized systems and transports. Keep writes disabled; no creation, activation,
release or helper execution. Store raw source locally under ignored `test-results/transport-mcp/`;
publish only sanitized evidence, counts and approved demo snippets.

| Check | Evidence required |
|---|---|
| Main baseline: A4HK906371 | Preserve all three known changes: class main +1, helper *2→*3 and program literal; request/task and revision IDs |
| Mixed scope: A4HK906369, A4HK905229 | Classes, interface, CDS, program and unsupported Dictionary entries remain visible |
| Other existing requests | Text/language entries, FUGR, missing programs, oversized source and empty inventory are not called unchanged |
| Object-family coverage | Existing nine source-history mappings; live successes, unavailable feeds and unverified families stated separately |
| HTTP/BTP path | Real MCP HTTP call through normal dispatcher; auth, read scopes, deny rules, target isolation and cancellation tested |
| Deployment qualification | Record actual build, backend release and auth route; local HTTP tests are not a deployed Cloud Foundry/PP test |

## Implementation and verification

1. Reconcile #1008 with current main without rewriting published commits; preserve the original worktree.
2. Record the final keep/drop decision and simplified response contract after Claude's design review.
3. Remove report-only code; implement and test the selected MCP fixes.
4. Reproduce correctness failures against main, then verify the revised implementation.
5. Replay the representative transports through the public MCP path; inspect actual hunks and gaps.
6. Run focused tests, full unit tests, typecheck, build, lint, policy, size/schema budgets and strict docs.
7. Have Claude review the final implementation; validate findings, repair and retest until clear.
8. Update #1008 title/body and concise user documentation; check the current roadmap IDs again.

## Acceptance

No dropped failures, false creation/unchanged claims or hidden non-source scope. Existing source
changes remain readable. Work is bounded and independent of a local filesystem. Source-history
support is not confused with full object coverage or release readiness. Tests demonstrate the
behavior; the guide fits a short workflow plus an object-support table. No deployment or SAP mutation
is required to implement the feature. Record any live route that could not be verified.
