# Current-caller policy explanations

> **Superseded decision (17 October 2026).** Do not ship `explain_policy` or require
> it before normal calls. Existing denials and schema pruning cover the ordinary
> workflow. Only the deny-rule clarification and BOR regression are retained in
> [#1016](https://github.com/arc-mcp/arc-1/pull/1016). This document and its reviews
> preserve the historical experiment, not the current product contract.

## Scope

Add `SAPDiagnose action=explain_policy` with `proposedTool` and `proposedArgs`. Explain one
operation on the already selected connection. No new permissions, target selection, user lookup,
SQL execution, mutation or authorization probe. Stack on notebook draft #1009.

Final upstream recheck: main is `041a9e48`, with #1006, #1007 and release 1.6.0 (#970). Those
independent legacy-response and source-search fixes do not implement this action. This stage
changes no HTTP/parser behavior; keep the stack based on the reviewed transport foundation.

## Plan review

| Decision | Reason |
|---|---|
| Reuse normalization, runtime schema, ACTION_POLICY, scope/deny/target/safety evaluators | Explanation must not invent a parallel permission engine |
| Separate configured ceiling and effective caller safety | A profile/scope restriction is different from the administrator's ceiling |
| Resolve real package only for simple existing-object update/delete and only after local gates pass | Never trust supplied package or fetch denied-object metadata |
| Leave hierarchy-dependent package decisions unresolved | Avoid a potentially large hierarchy traversal just to explain a proposal |
| Leave creation, structural ownership, lineage and action prerequisites unresolved | Their real enforcement remains in existing handlers |
| Cached feature evidence is availability, not SAP authority | No capability guess or permission-testing mutation |
| Add only this action to the multi-target diagnostic allowlist | Proposed operations remain subject to the existing mutation-free ceiling |
| Bound proposed JSON to 64 KiB and reject irrelevant explanation fields | Keep the LLM surface small and prevent silent input misuse |

## Acceptance and tests

1. Reproduce prototype gaps: configured versus effective ceiling, unknown actions, absent/hierarchy
   package evidence, invalid proposals, direct target denial and no reads after any local denial.
2. Exercise parity with actual dispatch for scope, canonical/slash types, deny patterns, SQL/data,
   transport/Git and multi-target ceilings. The explanation must never invoke the proposed action.
3. Verify outer action scope/deny, schema/tool snapshots, exact multi-target exposure and no target
   grant enumeration. No raw proposal, token, principal claims or backend error body in the report.
4. Live local CLI on 758: explain an allowed read, denied SQL and denied mutation; optionally resolve
   an existing object's package with writes enabled only in the local test process, never execute it.
5. Focused/full unit suite, typecheck/build/lint/policy/schema/file/docs gates; independent Claude
   Opus 5.5 Max GUI review, evaluate findings, fix and retest before final review.

## Deliberate limits

An allowed ARC-1 explanation is not SAP authorization, object existence, readiness or a future
execution guarantee. Every execution repeats all guards. Unknown state stays unresolved. The
original b945 prototype remains untouched. FEAT-88 will narrow to any remaining useful gap after
this action is validated; do not claim broad create/lineage/package preflight support.

Implementation, local gates and four read-only live explanations passed. Three independent GUI
review rounds approved final product `70388fa1`; the optional documentation placement was corrected. See [validation](../research/2026-10-17-policy-explanation-validation.md).
