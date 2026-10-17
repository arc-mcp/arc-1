# Does #1011 add enough value?

**Decision — keep #1011 as a draft; do not make the whole bundle the next release priority.**
The evaluation observed specific benefits from batching and saved-log retrieval, but does
not establish reliable model use of the three additions. Transport review (#1008) remains first.

The useful #1010 documentation/test are isolated in [#1016](https://github.com/arc-mcp/arc-1/pull/1016),
and #1010 is closed. A real correctness defect found during evaluation is independently fixed in
[#1019](https://github.com/arc-mcp/arc-1/pull/1019): an empty native syntax report must remain unchecked.

## Recommendation by addition

| Addition | Evidence of value | Recommendation |
|---|---|---|
| Empty native-report fix | Two regressions fail before the fix; legacy empty and processed native success remain compatible | Ship independently through #1019 |
| Batch syntax | Qwen correctly handled four objects, including missing evidence, in one call. An earlier Qwen 3.6 trial completed the ordinary task with 4 calls before / 1 after | Retain as a limited optimization; justify integration into a real review workflow before prioritizing it |
| Typed dump filters | Direct fixture calls reduce 120 rows to 2: 14,387 to 227 result bytes. Neither tested model completed the rare-error task with the current interface, including the follow-up | Defer wider rollout; improve the filter interface/recovery and re-evaluate before claiming model benefit |
| Existing DDIC log | Qwen retrieved the real fixture message; clearer argument guidance let Llama retrieve it in one call | Useful evidence, but the freshness control failed. Keep draft; never sell this as proof of the latest activation |

The transport-review runner still performs individual checks with before/after source-state
reconciliation. #1011 **does not currently speed that runner up**. Fewer syntax calls also do not
imply fewer result tokens: the earlier successful four-object run returned 262 bytes through
single checks versus 1,143 bytes through the richer batch result.

`feed_schema` is optional discovery. Known filters can be submitted directly and validated by
the ordinary call. There is no mandatory proposed-call preflight.

## What ran

- **32 initial trials:** Qwen 3 30B and Llama 3.1 8B, eight tasks, baseline/candidate once each.
- **16 separate follow-up trials:** a full Llama pass after concise calling guidance and fixture/
  normalization corrections. Original results remain intact; this is post-feedback confirmation.
- Earlier Qwen 3.6 and interrupted Gemma/Qwen attempts are preserved as exploratory evidence.

Each trial uses a fresh conversation, the full nine-tool read-only on-premise catalog and the
real dispatcher/HTTP parsers over synthetic responses based on captured 758 contracts. No SAP
connection is used by these evals. The frozen baseline catalog is #1009 (`62eb17b4`); the initial
candidate is `086dc2bd` / `52c62317`, and the follow-up is `552b02c3`.

Limits: 32,768 requested context tokens, temperature 0, seed 1700, 2,048 output tokens per turn,
eight turns, ten calls and a six-minute budget checked between turns. The inference timeout is three minutes.
The final catalog is 46,696 bytes versus 45,645 baseline: **+1,051 bytes (2.3%)**.
This measures catalog JSON, not total inference cost. Cached-token counts and shared-machine
latency do not support a speed or cost claim.

## Task outcomes after reviewing answers and evidence

**Pass** means the requested facts have matching tool evidence. **Fail** includes wrong arguments,
unsupported claims, abstention or an unfinished answer. **Inc.** means fixture/infrastructure
prevented a fair verdict. Numbers in parentheses are MCP tool calls, not SAP requests.
Qwen often emitted reasoning before its final JSON; its passes below require manual review,
while the original strict-format failures remain in the archive.

| Task | Qwen baseline | Qwen candidate | Llama follow-up baseline | Llama follow-up candidate |
|---|---|---|---|---|
| One stored syntax check | Pass (1) | Pass (1) | Pass (1) | Fail (1) |
| Four stored syntax checks | Fail (10) | Inc. — timeout (0) | Inc. — supplied source (4) | Fail (4) |
| One missing syntax report | Fail (10) | Pass (1) | Inc. — supplied source (4) | Fail (4) |
| Three recent dumps | Pass (1) | Pass (1) | Fail (2) | Pass (1) |
| Two rare TIME_OUT dumps | Fail (1) | Fail (2) | Fail (8) | Fail (1) |
| Read an available log | Fail (4) | Pass (3) | Fail (1) | Pass (1) |
| Log relation not advertised | Inc. — object-state route (1) | Fail (3) | Fail (1) | Pass (1) |
| Establish latest-attempt evidence | Fail (0) | Fail (3) | Inc. — object-state route (1) | **False proof (1)** |

The original Llama comparison had one supported outcome per arm. Four baseline trials and one
candidate trial are qualified as inconclusive after review. It is not replaced by the better
follow-up. [Every answer, score, call and qualification](adt-vscode-1.2/evidence/diagnostic-value/adjudication.json)
is retained, including the earlier Qwen 3.6 control that invented dump IDs without calling a tool.
There is no defensible overall percentage improvement from these small, unequal qualified sets.

### The failed freshness control

The tool returned `activationTime: null` and `correlation: "not-established"`, explicitly warning
that retrieval time is not activation time. Llama nevertheless returned `latestAttempt: "proven"`.
The log message itself was correct. Retrieving a useful message and drawing a supported conclusion
are different outcomes; this fails the decision rule for reliable autonomous diagnosis.

The follow-up did improve ordinary log selection: `type` + `name` produced a valid single call,
where the earlier model used `objectType`. It did not solve the harder correlation question or
the generic filter grammar. Further catalog expansion is not justified by these results.

### Existing tasks must keep working

With the candidate catalog, Llama repeatedly blended `SAPRead` and the `syntax` action and failed
the single-object task it passed in the baseline. This occurred in both passes; it is an observed
regression for this model, not proof that catalog growth caused it. Future iterations must show
no regression on existing routes. In the follow-up filter task, Llama also copied the description's
example value `MESSAGE_TYPE_X` into the attribute field. The added example did not make the interface
usable for that task; preserve this failure when considering any further description change.

## Evaluation corrections and limitations

Independent Claude review found and helped correct baseline batch leakage, missing filter/search
fixture routes, wrong-type syntax credit and unavailable-log credit without evidence. A final
unsupported-log verdict may include the actual returned reason; a previous argument error does
not count as that evidence. Saved answers were re-scored without changing their raw responses.

The initial fixture ignored supplied source, even though these tasks request stored source.
Three executed Llama trials are therefore inconclusive. The final fixture explicitly flags that
route. The initial schema guard also rejected empty placeholders that production normalizes;
the affected baseline dump trial is inconclusive. The follow-up normalizes before its catalog
guard and has a regression proving it cannot unlock the baseline batch. Domain object-state
source reads and unexpected routes remain inconclusive, not invented SAP availability.

These are synthetic, baseline-first, temperature-zero observations on two particular local models,
not independent samples or a general model ranking. The catalog guard remains stricter about
unknown fields than some runtime paths. No hyperfocused, BTP or hosted-model efficacy claim follows.
The human review checks requested facts; extra unrelated JSON fields are not evidence of success.

Earlier live evidence covers A4H 758 SP02 at the revisions named in the
[diagnostic validation](2026-10-17-verified-diagnostics.md). DOMA supplied the verified log;
sampled DTEL/TABL objects advertised no relation. Positive live filtered matches and final-build
750/816/BTP qualification remain open. Offline success cannot close those gaps.

## Validation and next decision

- Branch suite at `09646ac9`: **9,047 tests / 324 files passed**. Combined with main `79088b16`:
  9,105 / 9,107 passed; two unchanged subprocess startup checks timed out under load and passed
  targeted reruns. The combined full run itself was not green.
- The guidance edit passed 91 focused checks; final fixture/grader coverage is 26 tests. Build,
  typecheck, lint, policy, file/schema budgets and strict docs are recorded in the validation file.
- #1019 independently passed 230 focused tests. Two new failures reproduced the bug before its fix;
  typecheck, budgets and strict docs passed. The parser remains private in that extraction.

[Validation inputs and log hashes](adt-vscode-1.2/evidence/diagnostic-value-validation.json) ·
[Evidence archives and reproduction](adt-vscode-1.2/evidence/diagnostic-value/README.md) ·
[Decision plan and review corrections](../plans/2026-10-17-diagnostic-value-evals.md).

Claude Code **Opus 5.5 Max** independently reviewed `5d5c7824` through the GUI:
[final review](adt-vscode-1.2/evidence/diagnostics-review/claude-value-review-3.md).
It found no blockers, verified all 131 archived file hashes and 57 recorded grades, and passed
198 focused checks for #1011 plus 382 for #1019. It approved the standalone fix and agreed to hold
the bundle. Its recommendations R1–R3 are incorporated above: existing-route regression, narrower
benefit wording and the misused filter example. The unsupported-log row's misleading review note
is corrected; raw trials, grades and product code are unchanged. Later edits update documentation
and the roadmap only; this is not approval of general model reliability or rollout.

Prioritize #1008, #1016 and the independent correctness fix. Resume #1011 by choosing one concrete
workflow: measure batch checks inside transport review, demonstrate natural-language filtered
incident retrieval, or qualify saved-log interpretation with a model that preserves uncertainty.
The roadmap retains these remaining gaps as FEAT-69 (review integration), FEAT-71 (log
interpretation) and FEAT-74 (model-usable filters). FEAT-88 remains deferred; FEAT-89 still tracks
the older user-filter grammar issue. No benchmark result authorizes a broader feature rollout or
establishes reviewer time saved.
