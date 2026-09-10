# PR #769: expansion-review disposition

Review date: 2026-09-10. Reviewed input: Claude's complete review of `3ef8c316`, including its
two addenda and corrected verdict. This records verification and decisions, not blanket agreement
with the reviewer. PR [#769](https://github.com/arc-mcp/arc-1/pull/769) remains unmerged.

## Outcome and scope

Keep the owner's explicit decision to remove `ARC1_LIVE_RELATIONS`. Relations is automatically
available in single-target standard mode unless discovery establishes absence or the administrator
denies it. Invocation still verifies support; existing read scope, safety checks and SAP identity
apply. Listing tools makes no SAP request. This is not opt-in SQL, source collection or mutation.

The real correctness problem was `SOBJ`: ARC-1's existing SAPRead pseudo type means BOR, whereas
the new `SOBJ/MO` adapter meant a maintenance object. Remove that relation root instead of adding
another global type name. **25 root types / 26 native rows** remain (TABL has table and structure
rows). Both `SOBJ` and `SOBJ/MO` requests fail before SAP access. Returned native maintenance
objects remain visible, unexpanded boundaries. Existing BOR reads are unchanged.

No dependency, configuration option, database, SAP write or BTP service was added. Operator guidance:
[Live relations](../../docs_page/live-relations.md). Per-type history:
[qualification report](2026-09-10-live-relations-types.md).

## Claim-by-claim decisions

| Review claim | Verification and disposition |
|---|---|
| Default-on needs confirmation | Already explicitly requested by the owner. Preserve capability-based exposure and `SAP_DENY_ACTIONS=SAPNavigate.relations`; do not restore a redundant flag. The extra tool payload is a real cost, not zero-impact. |
| Experimental text precedes stable navigation | Applied: append it after the existing action guidance. Keep explicit provenance and unknown coverage. Snapshot tests assert the stable description stays the prefix. |
| Positional registry conflates XML root, routing and casing | Applied: named `type`, `native`, `path`, `metadataRoot`, `resolve`, `nameCase` fields. Independent test rows use named fields, eliminating six ad hoc type lists. |
| Root validation interleaves resolution and metadata checks | Applied: private `resolveRootUri` handles path/exact-search identity; `validateRoot` owns generic metadata validation. No new service or strategy hierarchy. |
| Function-pool reconstruction is difficult to read | Applied a worked namespace example. Retained full parent/name verification; suffix-only validation accepts a wrong pool with the correct function suffix, demonstrated by the existing test. The 160-character native-name allowance remains necessary for the padded representation. |
| Slash-separated root list looks like native slash types | Applied comma-separated list. Keep actual subtype forms such as `ENHO/XHB` distinct. |
| Walker reassigns root parameter | Applied local `rootPackage`, retaining the validated package update on its graph node. |
| XML prescan is redundant under the byte/record limits | Rejected. `<root>` plus 20,001 `<x/>` elements is about 80 KB, well below 1 MiB, yet exceeds the tag cap. Post-parse semantic record caps do not bound parser work or depth. Retain the prescan and its hostile-input tests. |
| Non-relations schema rejection is dead after normalization | Applied: remove the redundant `else`. The reviewer was incorrect that no test existed: one direct, unnormalized-schema assertion was removed. Actual dispatch/normalization regression tests remain. Relations validation/defaulting remains at its public boundaries. |
| Deadline classification and truncation maintenance are duplicated | Applied shared `isDeadlineFailure`, with authorization, caller cancellation and attempt-budget exclusions. Payload construction computes `truncated` once from a reason set instead of mutating the walk result. Seven classification cases cover the exclusions. |
| Compressor repeats parse-cache fallback | Applied shared `parseDependencies` / `parseContract` wrappers; parsing still happens only after normal source retrieval. Cache/no-cache parity tests cover both source versions. |
| Legacy `contractCount` is permanently zero | Rejected. An upgraded SQLite database can contain old `dep_graphs` rows embedding source. Existing regression inserts a legacy row, observes count 1 and verifies explicit clear removes it. Keep migration visibility and compatibility; memory's zero is not evidence about upgraded disk caches. |
| Walker bounds guard is unnecessary | Retained at the exported algorithm boundary. TypeScript number types do not encode numeric bounds; direct invalid-bound tests document the contract. The small guard prevents future internal callers bypassing schema bounds. |
| Tool docs list 17 roots while schema lists 26 | Applied current 25-root list and exact registry/doc type-list parity. Negative guard tests remove a qualified type and add SOBJ; both are detected. Parameter-name parity alone was insufficient. |
| Per-type evidence is circular or missing | Applied independent recorded GET/native fixtures, citation map, exact key/file equality, observed root/native identity checks and adapter replay. Six missing per-type files were added, not only the four cited in the review. Existing files now include ENHO/XHB and observed GET QNames. |
| SOBJ collides with existing BOR semantics | Applied removal from root/expansion registry, schemas, docs and snapshots. Explicit rejection-before-I/O and visible-boundary tests prevent silent semantic reuse. See [SOBJ evidence](abap-types/types/sobj.md). |
| General context guidance should not market relations | Applied neutral source-derived dependency/coverage disclaimer, without comparing to the new action. |
| Probe mutates MIME negotiation for all users | Narrower than claimed: a shared-client probe intentionally refreshes that client's discovery/MIME map, consistent with startup. Separate per-user clients do not inherit that mutation. Added regression checks for both probe modes and an independent client; corrected an outdated comment suggesting JWT fallback. |
| General prompt/cache/navigation changes expand PR scope | Confirmed scope, but explicitly requested in the preceding work. Keep them visible in PR description and consolidated record; do not rewrite/split published history without direction. Warning propagation is an independent user-visible fix and is called out separately. |
| Restore token-saving ranking and remove correctness caveat | Do not restore a historical 14–264× sample as universal guidance. Actual model tests motivated the distinction between source behavior and verified intent. Existing routing remains; no new server-instruction rewrite in this review. Weaker-model limitations remain documented rather than claimed solved. |

## Independently replayable evidence

The new [fixture README](../../tests/fixtures/relations/README.md) defines the projection and limits.
Each of 26 JSON files retains actual metadata element/attribute names and identity values plus one
observed native edge and its endpoint references. No source, authors, descriptions, credentials or
HTTP headers are published. SHA-256 values identify the original private captures, not the reduced
fixtures. Original edge counts are separately labeled; one retained edge is not completeness proof.

The protocol exposes `adtcore:type` as an **attribute**, not the `<adtcore:type>` element named in
the review. Evidence documents quote the real observed syntax, not a fabricated envelope. The
test-owned `RELATION_OBJECT_EVIDENCE` map incurs no runtime citation/file-reading overhead.
Recorded fixtures supplement, not replace, independent synthetic namespace, authorization,
wrong-identity, inactive-root, traversal, parser and request-budget regressions.

This validates observed SAP_BASIS 758 shapes only. It does not qualify other SAP releases, live BTP
principal propagation, Cloud Connector, complete incoming/outgoing coverage or business semantics.

## Validation record

The two behavior-preserving refactors were committed separately after full local gates:

- `c975a340`: 6,399 unit tests; typecheck, lint, policy validation, build and size/schema gates pass.
- `0b88db28`: 6,402 unit tests; the same gates pass. Tool fixtures remained byte-identical in both.

Functional follow-up, live rerun and final verification are recorded below after execution.
Tool snapshots intentionally change only SAPNavigate in this follow-up; general SAPRead and
SAPContext definitions and initialize instructions are not retuned here.
