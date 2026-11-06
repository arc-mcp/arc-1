# Keep native notebook authoring; retire the runner

## Decision

Review #1009 at `62eb17b456cd57908cdac2a508082027ed5d88f7` against main
`37fece94359c8a48523af56b0ff71f52359a7c21`. The user rejects the runner and asks to
extract demonstrated value, validate it, merge the extraction, then close #1009.
Interpret creation as native `.abapsql` authoring unless the user clarifies otherwise.

## What to retain

| Candidate | Decision and reason |
|---|---|
| Native Markdown/SQL file example | Keep a connection-neutral example in SAP's observed format. Agents can write JSON; no generator or new MCP action is needed. |
| Creation instructions | Keep a short guide with the real extension commands, destination selection, row caps and format limits. |
| Scalar result observations | Keep the missing zero-match regression: one returned row can accompany `totalRows=0`. Existing tests cover padding and larger match counts. Link the original count-only fixture. |
| Alternate ARC-1 document, importer, runner, assertions, reports | Reject. No demonstrated need to maintain a second notebook product or SQL completeness parser. |
| Workflow error classification and file helpers | Do not extract: main has no workflow consumer. Keep the frozen source available to the separate #1008 review. |
| Transport pilot | Retain a source link in the decision record; its findings belong to #1008, not notebook authoring. |
| Broad follow-up plan and old reviews | Preserve on #1009; do not copy obsolete plans or historical approvals as approval of this extraction. |

## Small implementation

1. Recheck installed SAP extension 1.2.0, current Marketplace and existing ARC-1
   query tests/docs. Inspect the serializer locally; do not redistribute SAP code.
2. Add one native example with no destination binding or stored results and a short
   guide linked from the tools reference. Use existing native editing/execution.
3. Add one synthesized XML case to existing public-dispatcher query tests, using
   the observed zero-match count. Preserve the exact result without changing production behavior.
4. Document every keep/reject decision and provenance. Check the current roadmap:
   historical #1009 IDs have since been reused; do not remove today's FEAT-86/87.

## Validation and review

- Check the example with the installed extension's actual serializer: Markdown/SQL
  order, text and row limits survive round-trip, including exact saved bytes.
  Editor open/save is optional; record whether it was actually verified.
- Test the existing SAPQuery result path with a zero-match scalar count and its
  exact string. Reuse existing whitespace, aggregate-error and query policy tests.
- Run typecheck, build, lint, size/policy checks and strict docs. Run full unit CI
  before merge; record any failures, retries or skips accurately.
- If a fresh live query is useful, use only existing demo data on authorized
  A4H/001 over HTTPS 443. Never create SAP objects for this documentation change.
- Ask Claude Code Opus 5.5 Max in the GUI to review this plan, then the frozen diff.
  Assess its findings, fix valid issues and repeat review when needed.
- Create a focused PR, wait for required checks, merge the reviewed head, then
  close #1009 with the extraction link. Preserve the old branch and all user work.

## Plan review

No new runtime, file format, parser, CLI command, tool schema or dependency is
needed. Existing query behavior already supports these observations; tests protect
it rather than claiming a bug fix. The native format is an observed 1.2.0 contract,
not a promised stable SAP API. Documentation must distinguish extension execution
from ARC-1 authorization, and `totalRows` from the returned scalar value.
