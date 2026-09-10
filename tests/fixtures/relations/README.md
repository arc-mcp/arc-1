# Recorded Relation Explorer identity fixtures

These are **sanitized projections of real SAP_BASIS 758 responses**, captured on 2026-09-09 UTC
and published during the 2026-09-10 review. They are not synthesized from `RELATION_OBJECTS`.

Each JSON retains the metadata GET's original element/attribute names and identity values,
plus the original native network envelope/context and one observed edge with its endpoint
references. Unrelated fields, authors, descriptions, component trees and other edges were
removed. Duplicate copies of an endpoint reference were collapsed. Names and native type
values were not substituted. No source code, data rows, credentials or HTTP headers are included.

The SHA-256 values identify the original private bodies, not these reduced projections.
`observedNodes` / `observedEdges` describe those original bodies; they must not be interpreted
as the size or completeness of the projected graph. A graph with one selected edge is not a
claim that SAP returned only one edge. The exact-search wrapper in the replay test is synthetic;
its identity fields come from the recorded search match, while metadata/network XML comes from
the recorded responses.

`tests/unit/adt/relation-evidence.test.ts` owns the independent `RELATION_OBJECT_EVIDENCE` citation
map. It enforces exact registry/fixture key equality, readable per-type evidence documents,
observed GET metadata roots and native identities, and adapter replay. Mutated-root and missing
citation tests guard against the guard becoming vacuous. Synthetic namespace, denial and
malformed-input tests remain separate in `relation-types.test.ts`.

Adding a type requires new **observed** evidence, not changing the registry and its synthetic
test together. The fixtures establish only these observed shapes, not completeness or other
SAP releases. `SOBJ/MO` is deliberately excluded: ARC-1 already uses `SOBJ` for unrelated BOR
reads, so native maintenance objects remain unexpanded boundary evidence.
