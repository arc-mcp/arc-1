# Dump-filter extraction validation

Source: #1011 `5725fab6`; independent base: main `498c12bb`.
The filter-only extraction preserves ordinary calls and adds optional schema discovery.

## Plan and review

[Plan](../plans/2026-10-17-dump-filter-extraction.md) ·
[Claude plan review](dump-filter-extraction/claude-plan-review.md).
The four required conditions are implemented: unchanged legacy request options, diagnostic limit
advice, filter-only dependencies, and a single query encoder with narrower typed values.

One review assumption needed correction: the shared HTTP client already serializes BOTH legacy
and typed queries with `URLSearchParams` when adding SAP context. Reusing the old helper still
simplifies the code; it does not establish a difference in the final query-key encoding. A test
checks both helper input and the final decoded HTTP query. No client-side matching engine is added.

The new filter property exceeded existing wire limits in its first form. Duplicate wording was
trimmed from SAPDiagnose while retaining action requirements and the filter example. Wire/token
ceilings stay unchanged; only the expected description count rises by one.

## Implementation review

[Claude Opus 5.5 Max review](dump-filter-extraction/claude-review-1.md) found two deterministic
failures at `44d649da`: an assertion pinned old wording, and the multi-target action table omitted
`feed_schema`. Both are corrected, including the normative plan. Two further regression cases
failed before `571c0a0f` and pass afterward: harmless cross-action `false`/`[]` defaults no longer
trigger unrelated refinements on schema/filtered-list calls.

The review also caught answer leakage in the filter example. `290622c8` changes it from
`TIME_OUT` to `MESSAGE_TYPE_X`, restores newest-first ordering and restores the detail description
in the human guide. The first model run is preserved separately; the corrected comparison follows
the [declared protocol](../plans/2026-10-17-dump-filter-extraction.md).

We retain the shortened unrelated action descriptions to keep the existing ceilings. Their
constraints remain documented and unit-tested, but those actions were not model-evaluated.
Before the main merge: full catalog 74,420 bytes / approximately 18,605 tokens; BTP 70,591 / 17,648.
The optional unknown-datatype message improvement is deferred; unsupported types already fail closed.

[Final Claude Opus 5.5 Max review](dump-filter-extraction/claude-final-review.md) of `027159e3`:
**ready for a draft; no must-fix defects**. Its immutable export passed 915 focused tests in 14
files, typecheck, lint, policy, budgets and strict docs. It reproduced the two fail-before cases
and verified all outer/inner hashes and 24 manual classifications. The full-suite caveat remains.

Review of the review: Llama's earlier use of `MESSAGE_TYPE_X` as an attribute belongs to the
[older #1011 evaluation](https://github.com/arc-mcp/arc-1/blob/5725fab6515f7a410e3e488003ae1a7aa3d8c249/docs/research/2026-10-17-diagnostic-value-evaluation.md),
not these two runs. Claude supplied that missing citation during the merge review; we verified it
in the older adjudication. Here the exploratory trace uses `runtimeError`, the corrected trace
`MESSAGE_TYPE`. Keep those observations separate rather than treating them as one trial history.

## Live qualification

The [pre-merge probe](dump-filter-extraction/evidence/live-290622c8.json) used `290622c8`,
A4H/001 over HTTPS 443, the local real dispatcher and the existing Basic identity. A positive
runtime-error predicate returned the same existing dump ID/error; the negative predicate returned
no rows. Five GETs, zero mutations; writes, SQL and data preview stayed disabled.

Last recorded release: SAP_BASIS 758 SP02, not re-queried in this bounded probe. No live proof for
750/816, BTP, principal propagation, every operator, or heavy live paging. Only counts/hashes are
published; raw SAP dumps stay private. Synthetic tests cover date bounds, multiple pages and failures.

## Automated validation

The first full Node 24 run: 8,995/9,001 passed. The two deterministic failures above are fixed.
Four subprocess startup timeouts also reproduced on unchanged main `498c12bb` (50/54 passed);
CLI startup took 7.25 seconds and a server-only import 5.86 seconds locally. No timeout was raised.
Claude's Node 22 isolated rerun passed those 54 tests.

The final full run at `290622c8` passed **8,998/9,003 tests across 316 files**. The same four
startup timeouts remain; one additional HTTP-body admission test timed out under load, then its
whole file passed in isolation (23/23). The full run itself is not green. All 56 new filter tests,
snapshot checks and the corrected documentation contract pass. [Check record](dump-filter-extraction/evidence/checks.json).

Build and all three TypeScript projects passed at `571c0a0f`; subsequent production changes are
catalog wording only. Biome (two informational suggestions), policy validation, schema/file budgets
and strict docs passed. The two new default-placeholder tests have recorded fail-before evidence.

## Model controls

Both runs use synthetic data at the HTTP boundary, actual main `498c12bb` and extraction catalogs,
and the production dispatcher. This compares catalog/workflow behavior; it is not two live servers.
Each run has two installed models × three tasks × two arms, one trial per cell. No prompt tuning,
success-driven retries, pooled success rate, token-cost or latency claim.

The first twelve trials (`571c0a0f`) have a matching-example confound. Qwen retrieved the correct
rare-error IDs in one candidate call and excluded both adjacent days in prose, but failed the JSON
format. Its baseline ran into an unmodeled route/context limit and is inconclusive. Both models
passed the syntax status control; recent-dump and small-model rare-error failures are retained.
These observations are exploratory, not the corrected comparison.

### Corrected comparison (`290622c8`, twelve trials)

| Model/task | Main → filters | What the evidence supports |
|---|---|---|
| Qwen3.6 35B MLX, syntax | Correct JSON, 1 → 1 call | Single-object control preserved |
| Qwen, recent dumps | Incomplete, 1 → 1 call | Both omit date bounds, discard the adjacent-day row and stop at two IDs |
| Qwen, rare error | Correct facts, 4 → 1 call; 32,694 → 453 returned bytes | Both reject adjacent-day rows in prose; both fail the strict JSON grade |
| Llama3.1 8B, syntax | Correct status, 1 → 1 call | Both add an unsupported `latestAttempt=proven`; grader only assesses requested syntax |
| Llama, recent dumps | Wrong time window, 2 → 2 calls | Neither completes the task |
| Llama, rare error | Wrong IDs → invalid filter argument, 1 → 1 call | No demonstrated benefit; candidate sends a string instead of an array and invents an attribute |

Only the four syntax trials pass the strict grader. Manual fact review does not replace those
grades. Qwen ran with 16,384 effective context despite 32,768 requested; its rare-error baseline
crossed the 90% context flag, so truncation cannot be excluded. Llama reported 32,768. Installed
model digests, requests, answers, checkpoints and failures are archived. Both runs finished within
their fixed 15-minute limits (229/211 seconds); concurrent local activity prevents latency claims.
The harness's `candidatePatchHash` field hashes an archive label, not a diff; identify source by
`candidateHead` and the separately recorded catalog/file hashes.

**Decision:** retain the narrow filter feature: the live match and one corrected model pair show
a useful reduction in retrieval work. This is not reliable autonomous incident diagnosis, and no
benefit is established for the smaller model. Keep date/evidence checks and optional recovery.

[Manual review of all 24 answers](dump-filter-extraction/evidence/manual-review.json) ·
[Corrected raw archive](dump-filter-extraction/evidence/models-neutral-290622c8.zip) ·
[Exploratory raw archive](dump-filter-extraction/evidence/models-exploratory-571c0a0f.zip) ·
[Hashes](dump-filter-extraction/evidence/sha256.json).

To reproduce offline, export the archive's recorded candidate commit into a scratch checkout,
install its locked dependencies, then copy the ZIP's `harness/tests/evals` into `tests/evals` there.
Run the four `dump-filter-fixture.test.ts` checks with `vitest.eval.config.ts`. With those two
models already installed, run `diagnostic-value.test.ts` using the same config and
`DIAGNOSTIC_EVAL_MODELS=qwen3.6:35b-mlx,llama3.1:8b`, `DIAGNOSTIC_EVAL_REPEATS=1`,
`DIAGNOSTIC_EVAL_CASES=syntax-one,dumps-recent,dumps-target`, and a fresh
`DIAGNOSTIC_EVAL_OUTPUT` directory; stop after 15 minutes and retain partial checkpoints. The
archives are research evidence, not a second maintained product test harness. No SAP access occurs.

Original research and earlier failures remain at
[the immutable #1011 decision](https://github.com/arc-mcp/arc-1/blob/5725fab6515f7a410e3e488003ae1a7aa3d8c249/docs/research/2026-10-17-diagnostic-main-decision.md).

## Remaining #1011 work

Batch syntax still has observed value (FEAT-69) and is not included. Saved activation logs remain
deferred (FEAT-71). #1011 stays open as an extraction source; this PR does not meet the user's
condition to close it only after no useful work remains. No transport/notebook dependency is added.

## Main advanced during validation

Main merged stored-text support (#1012, `37fece94`) while #1020's first CI run was in progress.
That earlier head passed all 9,003 tests on Node 22/24, including coverage runs; SAP integration
passed 260 tests with 97 skips, and end-to-end passed 143 with four skips. These are earlier-head
results, not verification of the merge. Skips are not live coverage.

Merge conflicts affected only the file-size and description-count ratchets. The resolution combines
LONG_TEXT's eight descriptions with the filter's one, and retains the extracted query schema's lower
file budget. The combined catalog exceeded the wire ceiling by 92 bytes. Removing 100 bytes of
duplicated dump/discovery wording preserves the filter example, AND/eight-term limit, newest-first
ordering and optional discovery. No wire/token ceiling is raised. Combined full surface: 74,492
bytes / approximately 18,623 tokens; BTP: 69,596 / 17,399.

The 24 model trials remain historical comparisons against main `498c12bb`. Neither the new main's
stored-text surface nor this final wording trim was model-evaluated. No new reliability claim or
success-driven model rerun is made. Focused tests cover both dump and stored-text routes after the merge.

At merge commit `5af87695`, **all 9,289 local tests / 329 files pass**, as do build, all three
TypeScript projects, lint (two infos), policy, schema/file budgets and strict docs. The earlier
timeout failures are retained above; they did not recur in this run. All 470 focused checks and
13 snapshot checks pass. The [new live probe](dump-filter-extraction/evidence/merge-5af87695/live.json)
again passes both positive and negative controls through the real dispatcher (five GETs, zero
mutations). [Merged-head checks](dump-filter-extraction/evidence/merge-5af87695/checks.json).

[Claude's merge review](dump-filter-extraction/claude-merge-review.md), again Opus 5.5 Max in the
GUI, found no must-fix defects. It independently passed 1,204 tests in 20 files and the static
gates, verified preservation of main and the exact 100-byte trim. Its pending-validation caveat
is resolved by the merged-head checks above. The older-example citation is clarified above.
The new PR head's CI is a separate run; its current status is recorded on
[draft #1020](https://github.com/arc-mcp/arc-1/pull/1020).

## Final main reconciliation

Runtime review at `4f7813ae`, against main `2827948e` (18 October):

- The filter parser/compiler, paging hook, validation and handler are unchanged from the
  previously Claude-reviewed implementation. Main's application-log and where-used additions remain.
- Resolved file/schema ratchets and shortened dump guidance; the existing 75,000-byte catalog
  ceiling is unchanged (combined full catalog: 74,997 bytes).
- Renamed the legacy dump-user research item to FEAT-91 because merged main already uses
  FEAT-89 for data-cluster work. The DDIC-log roadmap now retains the verified saved-log GET
  and the unresolved latest-attempt correlation.
- Full Node 24 unit suite: 339 files / 9,488 tests passed. Build, typecheck, lint, policy,
  file/schema budgets and strict docs passed. No runtime assertions or timeouts were relaxed.
- Repeated the bounded A4H/001 real-dispatcher probe: positive filter returned the same existing
  dump; negative control returned no rows. Five successful GETs, zero mutations. Release remains
  the previously recorded 758 SP02; no new BTP/PP or wider-operator qualification is claimed.

This reconciliation was reviewed by Codex. The earlier Claude GUI reviews are preserved above;
a fresh Claude GUI review was not available because macOS denied assistive access. Final CI and
merge state are recorded in [#1020](https://github.com/arc-mcp/arc-1/pull/1020).
