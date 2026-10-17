# Claude value review 1 — #1011 follow-up: policy removal, empty-report fix, comparative eval

| | |
|---|---|
| Reviewed commit | **`09646ac94f0649808094f6de85aabffefea1929f`** (`test: compare diagnostic task value with local models`) |
| PR base | `62eb17b4` (#1009). The net diff `62eb17b4..09646ac9` (64 files) is what lands after a squash merge. |
| Since my approval (`b89bebd0`) | `57194aee` docs, `af8a955f` policy-preflight removal, `6ef6e65f` empty native report fix, `09646ac9` eval |
| Repository | `/Users/marianzeis/.codex/worktrees/verified-diagnostics/arc-1`, clean, local branch two commits ahead of origin (read only) |
| Reviewer | Claude Code, model **Opus 5.5** (`claude-opus-5-5`), effort **max** |
| Date | 2026-10-17 |
| Method | Immutable `git archive` export, tested offline with the real dispatcher and the PR's fixture world. No SAP calls, no model runs, no GitHub actions, no shared edits, nothing deleted. A throwaway Git repository inside my scratch export served the file-size ratchet. |

## Verdict

**Changes requested. Each item is small.**

- **Product:** the `explain_policy` removal is clean, and the single-object fix is correct and
  narrow. One CI gate is red at this commit (P1).
- **Eval:** proportionate, pre-registered and honest about its limits. Three issues bias or
  mislabel outcomes (E1–E3) and should be fixed before the definitive run's results are used:
  - the baseline arm can reach the new batch;
  - one of the candidate's documented filter forms is unmodeled;
  - format failures and abstentions are scored as dishonest, and budget failures are hidden as
    inconclusive.

## Must-fix

### P1 — The file-size ratchet fails (product gate)

`npm run check:sizes` reports `tests/unit/adt/devtools.test.ts: 3021 lines (budget 3000)`, the
default test budget at `scripts/ci/check-file-sizes.mjs:93`.

The file had 2,999 lines at `62eb17b4`, `b89bebd0` and `af8a955f`; `6ef6e65f` added 22. The
reported six-gate pass on `5a2def19` predates that commit.

**Fix:** move the three new cases into `tests/unit/adt/diagnostic-contracts.test.ts` or a small
new file. Don't raise the budget.

### E1 — The baseline arm can use the new batch

The baseline catalog rejects new inputs only through Ajv against the old JSON schema. JSON Schema
cannot express the old cross-field rule. At `62eb17b4`, `schemas.ts:1148-1153` refused `objects`
on anything but `atc` ("objects is only supported for atc …"). The baseline SAPDiagnose schema
still advertises `objects` for ATC.

Repro (`claude-value-review-1-checks/zz-value-leak.test.ts`): baseline Ajv **accepts**
`SAPDiagnose {action:"syntax", objects:[ZEVAL_A..D]}`. The current dispatcher then runs one
`POST /sap/bc/adt/checkruns` and returns `failed`, 4 checked,
`A:passed B:failed C:passed D:passed`, which the grader scores `completed:true, honest:true`.

The other new capabilities are correctly refused for the baseline: SAPRead `objects`, `filters`,
`feed_schema` and `activation_log`. Any baseline trial that tries the ATC `objects` route
therefore gets batch credit, so the syntax comparison is contaminated.

**Fix:** add one baseline-arm guard in the runner that mirrors the old rule (refuse
`SAPDiagnose` with `objects` unless `action === "atc"`), reusing the existing invalid-call
response, plus a unit test. Then check the in-progress transcripts for baseline
`SAPDiagnose syntax` calls with `objects`, and rerun any affected cells.

### E2 — Documented candidate filter forms make trials inconclusive (candidate only)

The fixture models only two exact query strings: `and(equals|contains(runtimeError,TIME_OUT))`
(`world.ts:40`). The candidate tool description says "datetime uses UTC YYYYMMDDHHMMSS",
`feed_schema` advertises `datetime` with `between`, and the `dumps-target` prompt says "on
2026-10-17 UTC". The natural candidate query is therefore `runtimeError` plus
`between(datetime,…)`, which is also the user guide's example.

Repro (case W1): that combination, in either order, gives HTTP 400, an `unsupported` entry, and
an **inconclusive** trial. Only the candidate arm can produce typed filters, so this removes
candidate trials asymmetrically from its key task. `runtimeError` alone, with or without legacy
`from`/`to`, works.

**Fix:** model the advertised terms the tasks need: `runtimeError` equals/contains,
`datetime` between/greaterOrEquals/lessOrEquals/equals, and optionally `equals(user,EVAL_USER)`.
Keep any other term inconclusive. Add a unit test. Record it, like the dump-detail correction, as
a review-driven fixture correction made before reading outcomes.

### E3 — Scoring mislabels format failures, abstentions and budget failures

Repro (case G1, real `grade()`):

```text
plain natural-language answer          → completed:false, honest:false ("Final answer is not JSON.")
prose followed by the JSON object      → completed:false, honest:false
dumps answer without dumpIds (abstain) → completed:false, honest:false
dumps answer with dumpIds: []          → completed:false, honest:true
syntax "unknown" / log "unavailable"   → completed:false, honest:true
```

- **(a)** `cases.ts:61` counts a format failure as dishonesty. You plan to review JSON compliance
  separately; the summary should not report it as an unsafe claim.
- **(b)** `cases.ts:97-98` makes abstaining on dump tasks "dishonest", unlike every other task.
- **(c)** The runner (`diagnostic-value.test.ts:164`, `:189`, `:200-201`) turns
  "Tool-call budget exceeded", "No final answer within turn budget" and an empty final answer into
  `inconclusive: true`. Those are model outcomes (looping, giving up). Excluding them can hide
  exactly the inefficiency the comparison measures.

**Fix:**

- (a) Return a separate `format: "invalid"` with `honest` unset.
- (b) Treat a missing `dumpIds` as no claim.
- (c) Score budget exhaustion and empty answers as not completed, with an explicit failure
  reason. Keep `inconclusive` for Ollama/HTTP failures, the shared-GPU time limit and unmodeled
  endpoints.

Add three grader/runner unit tests.

## Optional

1. **Durability.** The runner reads the baseline catalog with `git show 62eb17b4…`, and the README
   requires that commit in history. arc-1 squash-merges, so a fresh clone of main will not contain
   `62eb17b4` after #1009/#1011 land. Vendor the 60 KB snapshot with its hash, or label the eval a
   one-off tied to the branch.
2. **Uncertainty.** At `temperature: 0`, repeats differ only by seed and arm order, so they are
   close to replays, not independent samples. Report per model × task × arm, with inconclusive
   counts and their endpoints. The plan's "smoke evaluation, not efficacy" wording is right;
   describe repeats the same way.
3. **Shared unmodeled routes.** Source reads (`SAPRead PROG`), `SAPSearch`, `object_state` on a
   domain, and the legacy `user` filter all make trials inconclusive in both arms (case W1).
   `object_state` is a plausible baseline move for the log tasks. Model these only from captured
   shapes; otherwise report them.
4. **Context truncation.** Ollama silently drops the oldest messages beyond `num_ctx` (32k). The
   full catalog plus a 120-entry dump list stays below that, but a run that reads many dump details
   can approach it. Flag trials whose `prompt_eval_count` nears `num_ctx`.
5. **Retained #1010 docs.** About 865 lines of #1010 plan, validation and review evidence remain.
   They are clearly marked "Superseded decision" and are not contradictory. Moving or trimming
   them is optional.
6. **Single-object output wording.** The single-object `notChecked` reply sets `hasErrors: true`.
   A baseline model may therefore call the unchecked `ZEVAL_D` "failed", and the grader correctly
   treats that as unsupported. When attributing results, separate this output-design difference
   from batching itself.
7. **Synthetic, pre-existing.** A native envelope with messages but no `checkReport` is still
   treated as checked; an `E` message still sets `hasErrors`. SAP does not produce this shape.

## Verified without findings

**Policy removal**

- `policy-explanation.ts`, its tests and the hyperfocused, navigate and authorization changes are
  gone. `hyperfocused.ts`, `navigate.ts` and `authorization.md` are identical to `62eb17b4`.
- No references to `explain_policy`, `proposedTool`, `proposedArgs` or
  `resolveHyperfocusedAction` remain in `src`, `tests`, `docs_page`, `mkdocs.yml`, `AGENTS.md` or
  the dev guide.
- The remaining `dispatch`, `policy`, `multi-target` and `read` deltas against the base are
  diagnostics-only.
- `validate:policy` passes (132 entries, 14 tool schemas), and the snapshots and docs no longer
  list the action.
- The roadmap defers FEAT-88 with a resume trigger, and FEAT-89 parks review item O6 and the
  `maxResults: 0` quirk.
- #1016 (`69736695`) touches only `authorization.md` and a new test, with no overlap with #1011's
  net diff.

**Empty-report fix (`devtools.ts`)**

- Only an empty native `checkRunReports` (no reports, no messages) becomes `checked:false`, with a
  status text. The legacy `<checkMessages/>` shape stays checked.
- Other callers keep their outcome: `write-helpers.ts:1307` and `:1340` return `''` either way, and
  the UIAD JSON path already required exactly one report.
- The batch path always builds a report, so both arms receive the fix, as intended.

**Eval design**

- Hypotheses, the decision rule and the limits were written before the run. There is no LLM
  judge, and prompts never name new actions.
- The candidate catalog deep-equals the current read-only snapshot. Against the baseline it
  differs only in SAPRead `+objects` and SAPDiagnose `+filters`, two actions and descriptions
  (+995 bytes, +2.2%).
- Both arms share the dispatcher, configuration, world, seed and budgets, and the arm order
  alternates per repeat.
- Ollama is restricted to localhost, and no dependency is added.
- The eval is opt-in. The model runner is excluded unless `DIAGNOSTIC_VALUE_EVAL=1`, and the main
  test config includes only `tests/unit/**`.
- Trial artifacts record model digests, catalog and source hashes, and full transcripts.
- Fixture routes work for:
  - legacy dump paging (2 GETs, 120 entries, with error type) and dump detail;
  - single and batch syntax, including the missing-report case;
  - both activation-log states.
- About 640 lines, all under `tests/` and docs; proportionate for a decision experiment.

**Archives:** `diagnostics-review/claude-review-1.md` and `-2.md` are byte-identical to my
reports.

## Checks run (scratch export of `09646ac9`, Node 22.21.1)

| Check | Result |
|---|---|
| Focused tests: diagnostics, devtools, UIAD, syntax/read/schema/snapshot/parity, hyperfocused, action-policy, dispatch, ATC batch, live relations, multi-target, authz, eval grader | **28 files / 1,661 tests passed** |
| `tsc --noEmit` (src; tests including `tests/evals`) | pass |
| Biome on the 25 changed code files | pass (one info-level hint) |
| `validate:policy`, strict `docs:build` | pass |
| `check:sizes` | **fail**: `devtools.test.ts` 3,021 / 3,000 (P1) |
| Offline audit (`zz-value-audit.test.ts`, `zz-value-leak.test.ts`; no model) | Reproduces E1–E3 and the routes above |

## Limitations

- I did not run a model, and I have not seen the in-progress run's transcripts. The findings come
  from code reading and offline dispatch through the PR's fixture world.
- No SAP. The fixture's realism and coverage limits are as the plan states.
- Node 22.21.1.

## Files

In `claude-value-review-1-checks/`:

- `zz-value-audit.test.ts` (C1 catalogs, L1 leak, W1 routes, G1 grader)
- `zz-value-leak.test.ts`
- `baseline-onprem-readonly-62eb17b4.json`

To run them, copy them into `tests/unit/evals/` and set `BASELINE_CATALOG` to the JSON file's
path.

Scratch is kept: `dg-v3` under
`/private/tmp/claude-501/-Users-marianzeis-DEV-arc-1--claude-worktrees-arc1-transport-pr-review-b24d1c/29107839-8912-4998-9d5d-8d61b1d3fd68/scratchpad/`.

## Final verdict

**Request changes on `09646ac94f0649808094f6de85aabffefea1929f`.**

- **Before merge:** fix P1.
- **Before using the definitive eval results:** fix E1–E3, and rerun the affected cells or the
  whole matrix.

The product removal and the empty-report fix need no other change. With those fixes, I expect a
short final verification to suffice.
