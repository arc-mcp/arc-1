# ATC object batches — issue #770

## Goal and evidence

Accept the objects from one activation batch in one `SAPDiagnose atc` call. Native
ADT object references reuse one variant lookup, worklist and run lifecycle. Prior
three-round measurements on SAP_BASIS 758: five objects took median 8.53 s batched,
31.19 s sequentially, and 17.11 s two at a time. Native runs also worked on 750
and 816 on-premises. These are measurements, not a universal latency guarantee.

SAP sometimes omits requested objects from a completed worklist. A 20-class run
returned 13 records and 150 findings; one batch of the seven unreported classes
returned seven records and no findings. Nonexistent objects can also be omitted.
An absent record therefore proves neither a clean object nor a failed object.

Sources: [issue #770](https://github.com/arc-mcp/arc-1/issues/770),
[SAP Project Piper's native reference-list construction](https://github.com/SAP/jenkins-library/blob/dd557a0ddf8869501782f793a3a1aab99f125528/cmd/gctsExecuteABAPQualityChecks.go#L688),
and local experiments summarized in the [implementation verification note](../research/2026-09-09-issue-770-implementation-verification.md).

## Focused implementation

1. Add `objects: [{type,name}]`, exclusive with top-level name/type/url and valid
   only for `atc`. Limit raw input to 1–20 entries (the measured workload), trim
   and normalize aliases/case, then deduplicate. Use an explicit set of object
   types with established object-root routes. Exclude package expansion and
   types requiring parent/group context. Reject unknown item properties.
2. Reuse the existing executor for one or several URI references. Keep the
   existing single-object API/output and all async/legacy completion rules.
   Encode URI segments and escape XML attributes. Retain object ownership only
   for batch results so findings in class includes still belong to their class.
3. Resolve the variant once and use one absolute request deadline. Reconcile
   requested type/name/URI identities against schema-scoped worklist records.
   Return ordered, deduplicated coverage with `reported`/`notReported`, nullable
   finding counts, and worklist provenance. Missing evidence is incomplete.
4. If the first run is complete but coverage is missing, perform at most one
   native verification batch for only those objects. Require a known variant,
   remaining time and no cancellation. Preserve first-run findings if verification
   fails. Never retry a failed, malformed, timed-out or ambiguous first run.
5. Batch output always includes coverage, completion and per-run metadata. Keep
   findings flat with object and worklist attribution. Default incomplete batches
   are tool errors; structured mode returns the same evidence with complete=false,
   matching existing structured ATC semantics. Multi-run evidence represents
   separate execution instants; no atomic source snapshot is claimed.
6. Document usage and limits. Keep generic CLI JSON input, existing auth policy,
   SAP request throttling and selected-system identity. No new tool, scheduler,
   cache, public-API migration, automatic chunking or per-object retry machinery.

## Plan review before implementation

- Reduced the provisional 100-entry cap to 20: larger requests lack workload and
  response-size evidence and are unnecessary for the issue's stated use case.
- Reuse the lifecycle, not a copied polling implementation: preserves the tested
  750 quiet interval and modern terminal-status validation.
- A second run gets the original deadline and resolved variant, not fresh defaults.
  If the variant cannot be pinned, return the honest coverage gap.
- Findings need their enclosing object identity, not inference from a finding's
  include URI. Keep individual run metadata rather than merge worklist identities
  or informational FINDING_STATS counters into a fictitious run.
- An incomplete run may contain findings worth retaining, but must never supply
  a confident zero finding count for a requested object.

## Verification and review gates

- Unit tests: native XML selection/encoding, alias and duplicate handling, limits,
  strict item schemas, mixed selectors/actions, complete and missing coverage,
  wrong identities, duplicate evidence, include ownership, second-run failure,
  no-progress verification, unknown variants, deadline and cancellation.
- Regression: existing single/package ATC and async/legacy lifecycle tests; schema
  parity/snapshots and read-only authorization/multi-target routes.
- Live: repeat missing/clean and 20-object observations before implementation;
  test production batch orchestration on 758, compatibility on 750 and 816,
  mixed types and existing single-object output. Do not claim BTP tenant testing.
- Review diff against this plan; fix findings and rerun affected tests. Finish
  with full unit tests, typecheck, build, Biome, policy and size/schema budgets;
  inspect final staged diff and secret exposure before committing and opening PR.

## Completion review

Implemented the six steps above. Review found and fixed batch-only ambiguity in
returned duplicate identities, orphan findings and malformed finding containers;
also explicitly propagated MCP cancellation into the batch budget. Regression
tests cover each case. The original single/package response and lifecycle are
unchanged. Public input schema snapshots were reviewed and documentation parity
passes. Small, documented line/token ratchet increases accommodate the actual
new schema; hard wire-byte ceilings remain unchanged. See the linked verification
note for live outcomes, full checks and remaining evidence limits.
