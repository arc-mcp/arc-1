# Claude review 2 — follow-up of arc-mcp/arc-1 PR #1008

| | |
|---|---|
| PR | https://github.com/arc-mcp/arc-1/pull/1008 (draft) |
| Reviewed head | `d83cf19b4c5b3abd0dd8013324af4f29fbe06c2b` (`docs: record whole-object coverage in the SAP replay`; adds 4 lines to the validation log) |
| Product fix | `b2183c6f3c93ba07aee2f7ecb320a1421fcd6e25` (`fix: address transport review coverage and continuation findings`) |
| Compared with | `0244d4cc1ff13038f3c9be3677f4dcf1e6647732` (my [first review](claude-review-1.md)) |
| Reviewer | Claude Code, model **Opus 5.5** (`claude-opus-5-5`), effort **max**, same session as review 1 |
| Date | 2026-10-17 |
| Method | Read-only. Read the follow-up diff (31 files) and the surrounding code from the shared object store. I checked out the new head in isolated `git archive` exports in scratch space; the lockfile is unchanged, so I reused the cloned `node_modules`. The reviewed checkout was confirmed clean at `d83cf19b` and was not modified. No SAP calls, no credential, setting or GitHub changes, nothing committed. |

Line numbers below refer to `d83cf19b`.

## Verdict

**Approve from the review side. There are no must-fix items.**

- All three must-fix findings (F1–F3) and the recommended F4, F5 and F11 are fixed. F6, F7, F8,
  F10 and F12 are addressed.
- Each fix matches its finding. My first-review defect reproductions now fail on the new head (that
  is, the defects are fixed), while the safety properties I checked still hold.
- Keeping F9 is a reasonable, documented decision.
- The compact/structured split (F6) works as described: normal replies are about half the size, and
  the collector still saves complete provenance with no token. I verified this at runtime, including
  how Zod 4's `.extend()` treats passthrough fields.

I found five small issues in the follow-up. None is a blocker; two are worth a one-line fix (N1, N2).

## First-review findings: verification

| # | Disposition | Verified |
|---|---|---|
| F1 budget cut-off skipped an object | Fixed | `transport-review.ts:102` drops a budget-truncated object unless it is the page's first. My original repro (13 whole classes) no longer reports budget gaps and pages `[[0, 11], [11, 2]]`. The regression suite adds a mid-object deadline continuation test, and the old “bounds a page of whole classes” test now asserts no budget notes. Pages always make progress: the first object always lands, and the budget cannot be exhausted before the first object (exhaustion is only set on a thrown read, and an inventory read that throws aborts the call). |
| F2 whole-object PROG/CLAS could be `complete` | Fixed | `transport-diff.ts:663` keys the gap on the logical PROG/CLAS type, so a whole-object include (`R3TR PROG` with `PROG/I`) stays `complete`; both cases are tested. Codex's 758 replay confirms the demo request's `ZARC1_TD_REPORT` is exactly this case: its status changed from complete to partial. |
| F3 inventory limit gave SQL advice | Fixed | `dispatch.ts:200-202`, plus a real HTTP+dispatch regression (`tests/unit/handlers/transport-review-limits.test.ts`) and the new “Inventory” row in the `review-workflows.md` bounds table. |
| F4 per-process HMAC key | Fixed | `transport-review.ts:79` uses a plain SHA-256. A module-reload test passes for the same caller and rejects a different caller. The error text and docs are updated (“consistency check, not an access token”). |
| F5 REPT-only fan-out | Fixed | `transport-diff.ts:659-661`: no source reads, an `inventoryReason`, and no double count. TD-03 is rewritten accordingly. |
| F6 heavy default payload | Fixed | See the next section. |
| F7 undated in-between snapshot | Fixed, extended | `transport-diff.ts:216-230`. Also covers work-state current revisions (`currentIsWorkState`), with a failing-before regression. Live-fixture comparison below. |
| F8 minimal mode hid local limits | Fixed, with a precision gap | Local budget and CPU notes are fixed text (`:37`, `:621`). A genuine SAP 403 under minimal mode still reads `SAP request failed (status 403)`. See N1/N2. |
| F9 speculative 404 counted unavailable | Retained (accepted) | Documented in `review-workflows.md` and as a FEAT-86 follow-up in `roadmap.md`. |
| F10 out-of-range offset looked complete | Fixed | `transport-review.ts:86-87`. Checked: offset = length → error; the last valid page is fine; an empty inventory stays `complete` with its “not a release verdict” note. Page scope is documented in `tools.md` and `review-workflows.md`. |
| F11 documentation drift | Fixed | AGENTS.md has a single row. The dev-guide row is restored with current file names and all live wire facts. `tools.md` covers `summary`/`resultFormat`. The version wording is fixed (`bin/arc1-cli.js` exists). The demo is in Biome and its default path is fixed. Placement nit in N3. |
| F12 test gaps | Fixed | Real 180-send cap including CSRF HEAD and a 429 retry (`request-attempt-budget.test.ts`), the 30-second boundary (`review-bounds.test.ts`), mid-object deadline continuation, and the METH note assertion. |

### F6: compact vs structured format, and collector evidence

Measured with the same fixture as review 1: 20 single-`METH` class changes, default mode.

| Reply | Bytes |
|---|---|
| base `ce649ca9` | 9,374 |
| `0244d4cc` (always full) | 33,903 |
| `d83cf19b` compact (default) | **16,084** (−53% vs structured) |
| `d83cf19b` `resultFormat:"structured"` | 34,087 |

- **Compact output:** keeps identical hunks, `coverage`, `status`, raw `components`, `coverageGaps`
  and `inventoryReason`. It keeps the per-part evidence labels (`baselineStatus`, `selectionMethod`,
  `selectionOrigin`, `attribution`, `sourceState`, `historyCompleteness`, `statisticsComplete`,
  `change`, plus `note`, `diffTruncated` and `hunksOmitted` when present). It drops only
  `revisions`, `sourceHashes`, `retrievedAt`, `comparisonMode`, `activationStatus` and the
  per-object `scopeNote`, which appears once in the page-level `scopeNotes` instead. Coverage is
  computed before compaction, so it is identical in both formats.
- **Collector requests:** `transport-review.ts:47,89` always requests `structured`.
  `review-schema.ts:47` requires `resultFormat: 'structured'`, so a compact or older reply cannot be
  saved as evidence.
- **Saved evidence is complete:** I checked at runtime that Zod 4 `.extend()` keeps the passthrough
  setting. Saved pages retain `comparison`, `continuationVerified`, `coverage`, `metrics`, `note`,
  `retrievedAt`, `scopeNotes`, `sourceStability` and `status`; parts keep `revisions` and
  `sourceHashes`; the continuation token value never appears in the artifact JSON.
- **The `ReviewPageEvidence` type** derived from the schema is a sound replacement for `Omit` over
  an index signature.
- **Demo script:** writes `complete`, `partial` and `stale` JSON+HTML with structured pages, no
  token and no `<script>`.

### F7: live-fixture chronology comparison

I ran every request ID found in the five revision-feed fixtures (three captured on 758, two older
captures), plus an unrelated ID, through all four modes on both heads (`claude-review-2-checks/`).
**Only one result changed:** an *unrelated-request* `active` fallback on the 758 class feed, which
went from `prior-revision-unverified` to `baseline-ambiguous`. The active 00000 predates the
foreign `00002` release, so “ambiguous” is the more accurate label. Attributed open-request pairs
(`revision-feed-prog.xml`) and released pairs are unchanged.

## New observations in the follow-up (none blocking)

**N1 (Low): an oversized single response is reported as page-budget exhaustion.**
`describeError` (`transport-diff.ts:36-37`) returns the generic budget text whenever
`budget.exhausted` is true. A source larger than 1 MiB on a page's first object therefore reads
`source read failed: ARC-1 review page budget exhausted; remaining source evidence was not
collected.` The same happens on every later page, because a retried object becomes first. The note
implies a timing or count stop that a retry might clear, but this object can never fit within the
limit. Suggestion: a fixed local text when `err instanceof AdtResponseLimitError` (for example
“a source response exceeds the 1 MiB review limit; review it in SAP”). It is reproduced in
`zz-followup.test.ts`.

**N2 (Low, edge case): the note reflects budget state, not the cause of the error.**
A genuine SAP error on the read that crosses the 180-read limit (or that arrives after the deadline)
is labelled as budget exhaustion. For a non-first object this is harmless: F1 retries it and the
real error surfaces on the next page. For a page's first object the SAP error is masked;
`zz-followup.test.ts` reproduces this with a 403 at read 180. Suggestion: test the error itself
(the budget's own error, `AdtRequestBudgetError`, or a deadline failure) rather than
`budget.exhausted`.

**N3 (Nit): misplaced paragraph in `tools.md`.** The new paragraph on page-scoped status, the
format choice and VERSIONS behavior (`tools.md:1592-1596`) sits after SAPTransport's closing `---`,
just above `## SAPGit`. It belongs in the `action="diff"` subsection (`tools.md:1481`).

**N4 (Nit): the output guard measures the structured shape for compact replies.**
`transport-review.ts:103,113` measures structured objects for every reply. Compact replies can
therefore omit hunks slightly earlier than their own size requires (about 0.8 KB of structured
overhead per part, so at most about 160 KB of hunks at 200 parts). This keeps page boundaries
identical across formats, which is a reasonable trade-off.

**N5 (Nit):**
- The inventory error inherits “exceeded the configured 1048576-byte limit”, but the limit is not
  configurable.
- The `resultFormat` description for release lost “(default)”.
- The archived `evidence/claude-review-1.md` points to repro files that exist only locally. That is
  consistent with the archive's local-path policy, but readers cannot open them.

## Checks run

| Check | Result |
|---|---|
| Full unit suite at `d83cf19b` (Node 22.21.1, `--maxWorkers=2`) | **316 files / 8,933 tests passed**, 158.3 s |
| `npm run typecheck` (src + scripts + tests) | pass |
| `biome check .` | pass (2 infos, both outside this PR: deprecated key in `biome.json:22`, `package-contents.ts:48`) |
| Tool schema budget | pass; SAPTransport 6,418 → 6,462 B |
| First-review repros on the new head | all 6 defect repros (F1, F2, F4, F5, F7, F8) now fail; F9 repro unchanged by design; out-of-range offset now errors |
| Fix-validation tests from review 1 (5) and the fixed inventory-limit test | pass |
| Follow-up checks (`zz-followup.test.ts`, 3 tests; offset bounds; Zod `.extend()` probe; live-fixture chronology diff; demo script run) | pass, with the measurements above; N1/N2 reproduced |
| Evidence archive integrity | 11/11 files match `archive-sha256.json` |

Not run: `npm run build`, `validate:policy`, the file part of `check:sizes`, `docs:build`, and
integration/E2E tests (no SAP calls by instruction). The SAP 758 replay is Codex's recorded result;
I did not repeat it.

Check files: `/Users/marianzeis/.codex/reviews/arc1-transport-review-20261017/claude-review-2-checks/`
(`zz-followup.test.ts` goes under `tests/unit/`; `live-chronology.mts` and `extend-check.ts` run with
`npx tsx` from a checkout root; the chronology outputs for both heads are included).

## Limitations

- This was a targeted review of the follow-up diff and the code it touches. I reviewed the base
  implementation fully in review 1.
- No SAP access. Live behavior relies on the existing 758 fixtures and Codex's replay record.
- I used Node 22.21.1; Codex's runs used 24.11.1.
- Scratch exports are not git repositories, so Biome's VCS integration was inactive there.

## Final verdict

**Approve. There are no must-fix items for PR #1008 at `d83cf19b`.** N1 and N2 are worthwhile
one-line clarifications of the budget notes; they can land here or later. N3–N5 are cosmetic.
