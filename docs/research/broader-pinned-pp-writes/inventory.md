# Pinned mutation research

This index keeps native findings that explain non-obvious parser/lifecycle rules. It does not
repeat the public capability matrix, review transcripts, test totals or one-off execution plans.

| Question | Source of truth |
| --- | --- |
| What may a pinned caller do? | [Write guide and matrix](../../../docs_page/multi-target-writes.md); runtime capability tables in src/server |
| What security boundaries hold? | [ADR-0011](../../adr/0011-broader-pinned-pp-mutations.md) and [accepted plan](../../plans/2026-10-26-broader-pinned-pp-writes.md) |
| What remains before acceptance? | [Acceptance ledger](../2026-11-05-pr1142-current-acceptance.md) |
| Why are source checks family-specific? | [Source contracts](native-source-contracts.md): ownership, ranges, signatures, pools, RAP and batches |
| Which metadata differences are permitted? | [Metadata contracts](native-metadata-contracts.md): DDIC, MSAG, ENHO, SKTD and exact derived/state-link rules |
| Why separate package/service operations? | [Service contracts](native-service-contracts.md): non-cascade deletion, API state, binding getters and publication |
| Which runtime claims need native proof? | [Runtime contracts/scenario IDs](native-runtime-contracts.md): CTS, profiler/ST05, quickfix and classic FLP |

The notes primarily describe A4H/001 SAP_BASIS 758. Linked historical records identify exact captures,
source revisions and limits. Read-only observations, synthetic controls, Basic-native execution and
final strict-PP execution are distinct evidence classes. None implies another release/route or
current-build qualification.

Original reports remain in the
[immutable snapshot](https://github.com/arc-mcp/arc-1/tree/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research).
Private SAP packets, consumed claims and unfinished recovery keep their original bindings; merging
notes changes neither that evidence nor live authorization.

The unchanged [capability inventory](../../../tests/fixtures/pinned-writes/inventory.json) and
[nested-input contracts](../../../tests/fixtures/pinned-writes/nested-input-contracts.json) are
independent test fixtures, not runtime authorization. Their existing
[drift guard](../../../tests/unit/server/pinned-mutation-inventory.test.ts) remains; the candidate
catalog test still checks every runtime scenario ID against the runtime note above.
