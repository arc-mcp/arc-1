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

### Functional follow-up

`10551314` and final error-only follow-up `905b6200`: **6,424 unit tests / 209 files pass**, plus
typecheck, lint, 126-entry policy validation, build, strict docs, whitespace and file/schema gates.
The existing Biome configuration deprecation notice is informational. No budget was raised:
the largest standard surface is **71,993 bytes / 17,999 estimated tokens** (seven bytes below the
wire wall). The extra evidence is test/documentation-only; the 26 JSON fixtures total 57,017 bytes.

Nine intentional snapshot changes are confined to SAPNavigate's description and type-description
strings. General SAPRead/SAPContext definitions and initialize instructions were not retuned in
this follow-up. The final SOBJ error clarification changes no tool-list bytes.

### Read-only live SAP rerun

At the functional follow-up on A4H/001, SAP_BASIS 758:

- **104 calls: 96 bounded graphs and eight expected refusals**. The retained-root matrix is
  identical to the pre-review run after omitting observation timestamps and elapsed/byte/attempt
  metrics. This is exact structured-output comparison, not just equal counts.
- Refusals: inactive DCLS (two directions), new TABL (two), inactive SKTD (two), oversized PROG
  outgoing response, and conflicting native identities in the FUNC incoming expansion.
- **All 25 absent roots rejected before native network POST**. SOBJ rejection-before-any-SAP-I/O
  and returned-maintenance-boundary behavior are separately covered by dispatch/walker tests.
- Maximum observed successful-metadata bytes: **162,086**; at most ten HTTP attempts and eight
  expansions. These are observed request metrics, not peak RSS, total traffic or storage estimates.
- No SAP writes, execution, data-content reads, SQL execution or BTP provisioning.

Private evidence identifiers: `type-qualification/2026-09-10T06-13-14.055Z` (matrix),
`2026-09-10T06-15-15.902Z` (absent roots), compared with `2026-09-09T23-21-53.136Z`.
The last error-only follow-up leaves retained-root behavior unchanged; the full matrix was not
silently relabeled as a fresh rerun of that final error string.

### Actual model comparisons

Pinned before: `13bd3fb5` (source/tool surface identical to reviewed `3ef8c316`). After:
`10551314`. Six identical read-only live prompts (CLAS, TTYP, namespaced FUNC, removed SOBJ,
ENQU, TYPE) were run with GPT-5.6 Sol medium and Ollama Qwen3.6 35B, with shipped tools and
initialize instructions, no injected routing hints. The harness allowed four read-only tools,
requested at most six calls and enforced an eight-call hard ceiling. All 24 sessions completed;
completion is **not** an answer-quality pass.

| Case | Observed before/after result |
|---|---|
| GPT retained roots | Native routing remained correct for all five retained roots. TTYP reported the actual expansion cap; FUNC kept the function/group distinction; ENQU did not claim held locks. CLAS still used two calls, other retained roots one. |
| Qwen CLAS | Both versions chose source-derived SAPContext rather than the requested native map. Both overstated metadata-only provenance; the after answer added unsupported behavioral interpretations. Not cleared. |
| Qwen TTYP / FUNC | Native routing succeeded, but both versions misstated some counts/limits. The after TTYP answer called expansion exhaustion a 20-node cap despite 13 returned nodes. FUNC also incorrectly said the node cap was reached. Not a non-regression pass. |
| Qwen ENQU | Correct table link and separation from runtime locks in both answers. |
| Qwen TYPE | Before chose FUGR and failed; after chose TYPE and obtained the real graph. Its explanation of self-reference remained speculative. One observed routing improvement, not a reliability guarantee. |
| Removed SOBJ | Before obtained the maintenance graph; after correctly could not. GPT tried BOR first (SQL was blocked by the existing ceiling), then refused after five calls. Qwen retried without type and conflated BOR/maintenance terminology. This motivated the final error-only clarification below. |

Three additional ordinary-workflow GPT pairs used the same deterministic SAP fixtures and actual
shipped schemas/instructions: business explanation, inactive draft review and precise definition.
Five of six sessions completed; the **before** draft review exhausted the call guard. Both completed
business/definition pairs retained the central findings. The after draft answer correctly rejected
the removed negative-amount check and did not claim syntax execution. This small, noisy sample does
not clear previously documented broader/weak-model regressions. Fixture outputs were frozen; this
control is not a live replay of the compressor's changed disclaimer.

Private run IDs: GPT `2026-09-10T06-14-49.774Z`, Qwen `2026-09-10T06-14-50.908Z`, ordinary
GPT `2026-09-10T06-15-37.901Z`. Answers were reviewed against actual tool payloads, not just whether
the model returned text. No transcript/source dump is committed.

### Error-guidance follow-up

The SOBJ regression now explains that native SOBJ/MO is a maintenance object, while SAPRead SOBJ
is a different BOR identity; it explicitly warns against substituting BOR or dropping the root
type. Both SOBJ spellings are tested. This is error-path guidance only, without a global type alias
or additional normal schema text. The updated SOBJ evidence page also removes obsolete `intent.ts`
references and the disproven inference that native SOBJ metadata did not exist.

Final SOBJ repeats at `905b6200` completed with both models and the pinned before build (four
sessions). GPT's final answer distinguished BOR from maintenance and avoided claiming a program
connection. Qwen recognized unsupported relations but **still tried a BOR read despite the warning**
and blurred its meaning. Both after runs used two calls; both BOR attempts were stopped by the
existing SQL ceiling. Thus the error is clearer, but instruction-following is not fixed and must
not become an authorization mechanism. No additional permissions were enabled to make the test pass.
Private repeat IDs: GPT `2026-09-10T06-21-27.810Z`, Qwen `2026-09-10T06-21-29.008Z`.

## Final review disposition

The actionable code/evidence/doc findings are addressed. Retained guards have concrete regression
coverage and documented reasons; the default-on decision is the owner's, not a new assumption.
Current main `c55adcb8` is included without a new merge. Dependency/configuration files are unchanged
by this review, and changed-file known-credential checks pass. The new evidence documents and
fixtures contain no credentials or source bodies. Temporary comparison servers are stopped after use.

Local verification is green; fresh GitHub status belongs to the pushed PR head and must not be
inferred from the previous head's successful checks. **Do not merge automatically.** Functional
correctness of these fixes does not resolve the earlier ordinary/weak-model acceptance concerns,
live BTP PP/Cloud Connector qualification, or cross-release coverage limits.
