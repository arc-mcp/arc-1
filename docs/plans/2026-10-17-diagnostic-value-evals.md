# Does #1011 earn its tool surface?

Decision plan, written before running the model comparison. #1010's proposed-call
explanation is removed; its useful denial documentation and BOR regression are in
[#1016](https://github.com/arc-mcp/arc-1/pull/1016).

## Hypotheses

| Addition | Potential benefit | Existing alternative | Reason to drop or defer |
|---|---|---|---|
| Batch syntax | Fewer MCP and SAP calls for several named objects | Single-object syntax checks | Models miss the batch or falsely declare unchecked objects clean |
| Typed dump filters | Less irrelevant incident data | Existing time bounds, user filter and paging | Discovery costs more than it saves on realistic lists |
| DDIC activation log | Read an advertised diagnostic without activating again | Metadata reads; ask the operator for the log | Models mistake an old log for proof of the latest attempt |

These are independent decisions. A new action is not valuable merely because it
passes unit tests or an LLM can select it.

## Small controlled comparison

- Baseline: full read-only on-premise tool snapshot at `62eb17b4` (before #1010/#1011).
- Candidate: the same full catalog with #1011 and without `explain_policy`.
- Both execute the current real dispatcher, validators, parsers and HTTP client
  against an offline HTTP fixture. Baseline schemas reject new capabilities first.
  This is a feature ablation, not a binary benchmark of an old release.
- Synthetic names, messages and incidents use the captured 758 XML contracts.
  Nothing connects to SAP. Unexpected fixture endpoints make a trial inconclusive.
- Run installed Qwen 3.6 35B and Gemma 4 31B sequentially, two repetitions per arm,
  reversing baseline/candidate order on the second repetition. Fixed generation
  options; record model digests, source/schema hashes and complete transcripts.
- Eight tasks: one/four syntax checks, a missing syntax report, three recent dumps,
  two rare TIME_OUT dumps among 120 incidents, an available DDIC error log, an
  unadvertised log, and an old log that cannot prove the latest activation.
- Natural task prompts do not name the new actions. A common compact JSON answer
  format permits deterministic grading; all reported facts need tool evidence.

## Measures and decision rule

Record supported task completion, correct uncertainty, invalid tool calls,
MCP/backend calls, returned bytes, token usage and elapsed time separately.
Correctly admitting missing evidence is honest, but does not complete a request
for a diagnostic message. Check transcripts manually as well as machine scores.

Keep an addition only if it demonstrates new useful evidence or lower calls/data
on its intended task, without a false-success regression in the controls. Report
per-model failures; do not average away unsafe claims. Failure to find a feature
may justify shorter guidance, followed by a clearly separate confirmation run.
Do not tune prompts or fixtures after seeing scores to manufacture a win.

Two repetitions are a smoke evaluation, not a statistical efficacy study. Local
models share a machine with other work, so latency is descriptive only. The
fixture cannot establish SAP release coverage, real incident prevalence or ROI.
Existing live evidence and tests remain necessary. No LLM-as-judge is used.

## Plan review

Keep this scoped to one fixture world, one runner and explicit graders. Reuse the
existing tool snapshots, dispatcher, HTTP mock and test configuration. Do not add
a production eval API, another general harness, paid provider dependency or SAP
write permissions. Unit-test the grader against guessed answers and incomplete
evidence before running models. Archive failures as well as successes.

## Preliminary fixture correction

The first run stopped after nine completed trials: a model used valid legacy dump
detail reads absent from the fixture. Add these responses and rerun the unchanged
task matrix; retain the preliminary failures. The run also exposed an empty native
single-object check being labeled clean. Fix this independently of batching and
apply the correction to **both** arms of the definitive ablation. Do not credit
batching with a safety improvement available to the ordinary single-object tool.

## Model availability adjustment

The Gemma 4 31B attempt took approximately four minutes for its first turn with
this full catalog and did not complete a trial before stopping. Preserve its
manifest and partial console log. Run the complete unchanged matrix with installed
**Qwen 3 30B and Llama 3.1 8B** instead. The earlier Qwen 3.6 preliminary results
remain exploratory. This is a runtime-budget change, not selection by task score.

Run each catalog's eight tasks together, reversing catalog order in repetition 2.
The first Qwen 3 trial took 154 seconds including cold prompt evaluation; alternating
the 12k-token catalogs after every task repeatedly discards the reusable prefix.
Grouping preserves fresh independent conversations, identical tasks and both orders.
It changes scheduling, not acceptance criteria. Save partial responses after each
turn so cancellation does not discard the completed portion of a trial.

## Independent review corrections

Claude Opus 5.5 Max reviewed `09646ac9` without viewing model outcomes. Before using
any scores, address [P1 and E1–E3](../research/adt-vscode-1.2/evidence/diagnostics-review/claude-value-review-1.md):

- Move three parser regressions out of the full devtools test file; retain the size budget.
- Mirror the old runtime restriction on `SAPDiagnose.objects`; the baseline JSON
  schema alone allowed the new syntax batch through the old ATC property.
- Model the task's advertised datetime and user filters, in either order, as well
  as ordinary source inspection and search. Unknown endpoints remain inconclusive.
- Separate invalid answer formatting from honesty; missing dump IDs are abstention.
  Empty answers and exhausted tool/turn budgets are model failures, not exclusions.
- Vendor the exact baseline snapshot and flag near-context-limit responses.

Preserve all exploratory output directories and rerun the same full task matrix.
The final run uses Qwen 3 30B and Llama 3.1 8B with catalog-grouped scheduling.
Temperature-zero repeats are consistency checks, not independent statistical samples.

## Final runtime budget

Before inspecting any corrected candidate results, reduce the definitive matrix to
**one complete pass per arm on each of Qwen 3 30B and Llama 3.1 8B: 32 trials**.
The first four Qwen baseline tasks took minutes each; the original 64-trial schedule
would spend substantial additional time on temperature-zero consistency repeats.
Keep the same tasks, tools, limits and acceptance criteria. Stop the Qwen run after
its first complete pair of eight-task groups, then run Llama once. Retain any
interrupted next trial separately. Report the fixed baseline-first order as a
limitation; do not claim counterbalanced evidence or independent repetitions.

## Second independent review

[Claude review 2](../research/adt-vscode-1.2/evidence/diagnostics-review/claude-value-review-2.md)
verified P1/E1–E3 and found F1–F3: wrong-type syntax credit, missing wildcard search
semantics and unsupported-log completion without evidence. Correct the fixture and
grader; require a PROG check and an actual unsupported DOMA-log result. Preserve
raw scores and re-score saved answers with the final grader. Flag or rerun any trial
whose model saw a wrong-type success or an incorrectly empty search. Existing
unmodeled routes remain inconclusive, including domain object-state source reads.

Qwen's running process keeps the frozen `086dc2bd` fixture for both arms. Llama
will use the corrected fixture for both arms. Record exact manifests separately;
do not pool their raw machine scores. Also restore the baseline's specific ATC-only
refusal message. A malformed `dumpIds` field is a formatting issue, not evidence of
a false factual claim. Placeholder validation remains stricter than the production
normalizer in both arms; report affected calls rather than silently correcting them.

## Separate confirmation after the 32-trial comparison

The original comparison completed all 32 trials. Its failures justify two small
model-facing edits: spell out `type` + `name` for activation logs; show a typed dump
filter example using MESSAGE_TYPE_X (the task still asks for TIME_OUT); and point
invalid-filter errors to optional `feed_schema` discovery. No new API or fallback.

Llama also supplied `source: "active"` instead of requesting stored source. The
fixture previously ignored that supplied source; flag those three executed trials
inconclusive, despite the grader already refusing to credit them. Future fixtures
explicitly reject this unmodeled route. Strict Ajv validation also rejected empty
placeholders which production normalizes. Normalize before the catalog guard for
future runs, with a regression proving this cannot unlock the baseline batch.

Run **one further complete Llama 3.1 8B baseline/candidate pass (16 trials)** using
the corrected normalization/fixture and concise descriptions. This fast local model
uses the same prompts, seed, limits and final grader. This is an explicitly
post-feedback confirmation, not a replacement for the original 32 trials or an
independent statistical replication. Retain both protocols and all raw results.

Final scoring accepts an actual unsupported-log reason as useful explanation, provided the
matching unsupported result was retrieved. It still rejects an unrelated earlier argument error.
Both forms are regression-tested. [Results and decision](../research/2026-10-17-diagnostic-value-evaluation.md).
