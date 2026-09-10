# PR #772: assessment of Claude's 15 findings

Reviewed against `0448646e`, including the complete review supplied by the user,
the existing plan, source, tests and earlier live captures. Reproductions ran
before implementation. The initial test-development run recorded 23 failures and 56 passes across
the two files. This records that run, not a replay of the later committed test
assertions against the old source. Additional boundary tests were added
during review. This follow-up adds 33 tests in total.

The [second review follow-up](2026-09-10-pr772-rereview.md) corrects the exclusion
of possible child-object findings and adds TABL source-resource equivalence.

## Decisions

| # | Finding | Assessment and action |
|---|---|---|
| 1 | Empty arrays break unrelated calls | Confirmed. Normalize an empty `objects` placeholder away for unrelated actions or an existing single-object selector. Keep an actual empty ATC batch invalid. Removing the schema minimum or globally dropping arrays would weaken other contracts. |
| 2 | Unicode uppercase changes object identity | Confirmed. Fold only ASCII a–z in batch names. Unicode sharp-s, ligatures and dotless-i remain invalid and cause no SAP request. |
| 3 | Verification double-counts repeated objects | Confirmed with a response superset. Each run now contributes findings only for its explicit selection. A repeat of an already checked object in verification no longer inflates the batch. |
| 4 | Unrequested findings inflate totals | Confirmed with a response superset. Exclude findings for other objects from batch totals; retain the original run totals and an `excludedFindingCount`. Complete batch totals now agree with the requested coverage counts. No live superset was observed, so its frequency remains unknown. |
| 5 | URI spellings cause false missing coverage/retries | Partly confirmed: type/name alone cannot prove ownership, and the proposed echo is hypothetical. Recognize exact known editor roots, source/main subresources, and encoded/literal namespace spellings. Contradictory URIs make the first run incomplete and cannot trigger verification. Keep rejection of other types, queries, traversal and arbitrary descendants. |
| 6 | DDIC loses editor-URI equivalence | Confirmed asymmetry. Recognize known table/structure/domain/data-element metadata roots as equivalent echoes, without fetching them. Selection still uses ATC R3TR references for release compatibility. Alternative DDIC echoes have unit coverage; the live systems continued returning R3TR records. |
| 7 | Insufficient legacy verification budget | Confirmed avoidable work. Skip verification after a legacy run when at most ten seconds remain. This is a minimum feasibility guard, not a promise that network/SAP execution fits the remaining time. A reported row without terminal evidence still correctly has an unknown count. |
| 8 | Malformed worklist makes all counts unknown | Keep the conservative contract. A per-object count is a verified total, not merely the number of rows observed so far. Certifying unaffected objects would require a separate per-object completeness model. Valid observed findings remain available, the overall result stays incomplete, and the explanatory message now states this directly without suggesting a duplicate. |
| 9 | Broad catch hides cancellation and defects | Confirmed. Only recoverable SAP API/network failures retain a partial result. Cancellation, safety/response-limit failures and programming errors propagate. Recoverable verification failures log safe error class/status, initial worklist id and request correlation; raw error details are excluded. |
| 10 | BTP advertises PROG | Confirmed. Derive the BTP ATC subset from the existing read-availability registry; both the tool enum and runtime schema exclude PROG. DDIC remains available. This avoids duplicating a second BTP type matrix. |
| 11 | Examples imply successful DDIC coverage | The blanket claim that these types always fail is not established: examples use illustrative names, and applicability varies by system/variant. Improve the general example to CLAS/INTF; retain the requested DDIC example with structured output and an explicit complete/coverage check. The existing tool description already says unreported objects stay incomplete. |
| 12 | Slash truncation merges distinct object types | Confirmed mechanism, hypothetical SAP expansion. Reuse the repository's explicit alias normalizer: FUGR/F maps to FUGR, FUGR/FF to FUNC. Canonically equivalent duplicate records still fail; a function module is not counted as its same-named function group. |
| 13 | Multi-target inheritance lacks explicit review | Record the decision and freeze it with a test: bounded ATC selections are permitted under the already accepted workload contract. All entries share one selected target/identity and deadline; no nested target, identity fallback, repository write or per-object parallelism is added. Existing authorization, denial and global controls remain. |
| 14 | Repeated ownership wastes payload | Apply a small reduction: each finding retains object type/name and worklist provenance, while its owner's repeated URI is omitted. Keep the flat result and meaningful names instead of introducing grouping or numeric cross-references. Successful legacy/structured batch shapes being equal is intentional and already documented; incomplete error signaling differs. |
| 15 | Validation invents a SAP 400 | Correct the error kind and hoist the name regex. Retain inexpensive executor-boundary validation for this exported function, consistent with the repository's validation-at-sink rule. No network response/status is fabricated for local invalid input. |

## Implementation review

The fixes preserve the existing single-object/package executor and output, the
20-entry raw limit, one confirmed variant resolution, one request deadline and at
most one verification run. They add no metadata probes, caches, scheduler,
per-object retries or extra SAP calls.

Identity matching uses the same canonical type for coverage, duplicate detection
and finding selection. The URI guard remains independent: a row whose URI points
to another object cannot become complete solely because its type/name match.
Unowned or contradictory findings remain visible in an incomplete result. A valid
unrequested row contributes to run statistics but not to the requested batch.

Cancellation is distinguished from recoverable verification failure. The latter
still preserves initial findings, including in structured responses, while its
warning is correlated and contains no raw SAP response or error message. Safety
and response-budget errors are not softened.

The multi-target decision was reviewed against ADR-0006/0007 and recorded in the
normative implementation plan and setup documentation. The test freezes the
20-entry schema, strict item properties, read-only annotation and one aggregate
target field. Server action denial remains tested at dispatch, where it is
enforced, rather than in the narrower multi-target action-selection helper.

## Verification

- **5,966 unit tests passed across 199 files** (33 added).
- Typecheck, production build, Biome, policy validation and size/schema budgets
  passed. No budget was raised.
- Two BTP tool-definition snapshots changed only by removing PROG from the batch
  enum. Other snapshots are unchanged. Runtime/public schema parity and
  single/package, lifecycle, cancellation, read-only and multi-target regressions
  are included in the full unit suite.
- New tests exercise response supersets, overlap across worklists, total/count
  consistency, known URI equivalents and rejected URI variants, namespaces,
  FUGR/F versus FUGR/FF, malformed evidence, short legacy budgets, error classes,
  safe correlated logging, empty placeholders, Unicode names and BTP validation.

Live calls used production dispatch with read-only safety settings and existing
objects on HTTPS endpoints. ATC produces transient worklists; no repository
objects were created or edited.

| System / call | Result |
|---|---|
| 750, class plus missing class, 18-second budget | Returned in 11.90 s with the real class's one finding preserved, missing class unknown, and verification skipped because the remaining time cannot cover legacy settlement. |
| 758, original 20 classes | Complete in 18.25 s, 20/20 reported across two runs, 150 findings. The multiset of priority, check title, message title, URI and line exactly matches the previous production result. |
| 758, two tables | Complete in 5.60 s, 2/2 reported, zero findings. |
| 758, table plus missing DOMA/DTEL | Incomplete in 8.24 s after one verification; table has zero, missing objects have null counts. |
| 816, TABL/DS structure | Complete in 6.07 s, one reported structure, zero findings. |

The 20-class JSON response decreased from **83,480 to 73,774 bytes (11.6%)** while
retaining all 150 findings, object names, source locations and worklist provenance.
Timing values above are individual runs and do not establish a performance gain.

The prior DDIC limitation remains: successful live domain/data-element processed
records were not observed under the tested variants. Superset responses, alternate
metadata/source URI echoes and malformed evidence are tested with constructed SAP
responses. The 816 target is on-premises; no live BTP ABAP tenant verification is
claimed. Local probe scripts and captures remain outside the commit.
