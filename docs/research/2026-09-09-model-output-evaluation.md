# Model output evaluation and minimal guidance improvements

## Recommendation

Keep the small output/guidance patch. It corrects objectively misleading dependency counts and
helps a capable model choose useful evidence, without a new tool, database, provider dependency,
permission, or SAP request. Do **not** claim that it makes every model reliable or that graphs are
always preferable. The local Qwen/Gemma tests expose substantial remaining interpretation errors.

Implementation runtime: `eb4728ba`, based on original PR #769 at `360b63e3`. Comparison main:
`c55adcb8`, fetched and pinned on 2026-09-09. Subsequent documentation-only commits do not change
the measured runtime. The [plan](../plans/2026-09-09-model-output-guidance.md) records the alternatives
and acceptance criteria; no merge or public deployment was performed.

## Research translated into decisions

Evaluate the task, observed tool calls, and final answer together. A completed answer or fewer calls
is not a correctness score; representative cases, retained failures and evidence review are needed.
This follows [OpenAI's evaluation guidance](https://developers.openai.com/api/docs/guides/evaluation-best-practices)
and [Anthropic's agent-evaluation guidance](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).

Put relevant guidance next to the tool, remove contradictory instructions, and preserve legitimate
alternative workflows. This is consistent with [OpenAI's model guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.6)
and [Anthropic's tool-design guidance](https://www.anthropic.com/engineering/writing-tools-for-agents).
These are design inputs, not evidence that our particular wording works.

Use Ollama as an external evaluator, not an ARC-1 dependency. Its documented
[tool-call loop](https://docs.ollama.com/capabilities/tool-calling) and
[chat API](https://docs.ollama.com/api/chat) let a local model choose actual MCP calls and consume
their real responses. Existing ARC-1 eval infrastructure already has an Ollama provider; do not add
another production framework just for this experiment.

## What changed

| Change | Why | What stays unchanged |
|---|---|---|
| Source for behavior/known references; contracts when dependency APIs matter | Universal context-first instructions encouraged unnecessary reads and implementation guesses | All existing actions and inputs |
| Relations guidance at the start of the opt-in navigation description | Make native OO/package maps discoverable; keep typed where-used preferable for tiny class-consumer samples | Default-off/discovery/deny/scope gates, graph serialization and limits |
| Explicit DDIC format and root-type guidance; actionable retry messages | Models confused `structured`, root `type`, and result `objectType` | Unsupported formats still fail before source access; no automatic type guessing |
| Root candidates versus all-level resolution counts | Root minus recursive attempts could become negative or imply false completeness | Exact reads, contract bodies and original error evidence |
| Provenance, failed-read and coverage labels | A class-source 404 is not absence as another type; metadata is not runtime evidence | No fallback reads or broader permissions |

`depsFiltered` now counts unattempted root candidates, excluding failed attempts and unknown deeper
work. `depsFound` remains root-scoped; resolved/failed counts cover all explored levels. `totalLines`
counts actual output lines. The initial context summary is preserved; the human-readable footer is
intentionally changed. Consumers parsing the old footer must adapt.

The patch adds **11 net source lines across seven existing files** versus the original PR, plus
tests and documentation. No changes to dependencies, ADT transport, authorization or cache modules.
The main-versus-candidate cache benefit below was already implemented in PR #769; it is not newly
created by this guidance patch.

## Test setup

- Owner-authorized trial: A4H client 001 through its validated HTTPS reverse proxy. Both instances
  independently returned SAP_BASIS 758, SP02. No business data queries, fixture creation or mutations.
- Read-only, localhost-only HTTP MCP instances, independent memory caches, fresh sessions per task.
  Main and candidate used the same account and connection configuration. Source and metadata evidence
  remained in a private local lab, not committed to the repository.
- Only SAPRead, SAPSearch, SAPNavigate and SAPContext were offered to the tested models. No shell,
  web, other SAP connector, previous answer, reviewer notes or prototype overlay in final tests.
- GPT-5.6 Sol: actual Codex CLI calls, medium reasoning, low verbosity, existing ChatGPT login.
  Qwen/Gemma: actual Ollama 0.33.2 calls, temperature 0, seed 42, context 32,768, output 1,800,
  thinking off. Installed models only; no download. Full digests were retained in the local manifest.
- Installed labels: `qwen3.6:35b-mlx` (digest prefix `1b50c6fdc2d4`, nvfp4) and `gemma4:31b`
  (`6316f0629137`, Q4_K_M). Qwen's second installed alias has the same digest and is not another model.
- Maximum eight calls and 400 words, with tighter limits in selected prompts. The harness saves
  failures. CLI termination can leave only some in-flight call results; started calls remain counted.
- GPT pairs ran concurrently. Ollama cases ran serially on separate MCP processes so restarts did
  not disturb GPT caches. Each server allowed three concurrent SAP requests; up to nine combined
  during cross-provider runs. Timing is observational, not a latency benchmark.

## Final paired results

48 sessions, without presentation overlays: 13 prompt pairs for GPT, eight for Qwen, three for Gemma.
"Complete" below means a final answer with tool evidence, not that its claims were correct.

| Model / task set | Main complete | Candidate complete | Calls main → candidate | Tool errors main → candidate |
|---|---:|---:|---:|---:|
| GPT-5.6 Sol, original 10 | 9/10 | 10/10 | 45 → 36 | 6 → 4 |
| GPT-5.6 Sol, 3 held-out | 3/3 | 3/3 | 9 → 9 | 2 → 1 |
| Qwen, 5 original + 3 held-out | 7/8 | 8/8 | 27 → 23 | 6 → 3 |
| Gemma, 3 original | 2/3 | 2/3 | 16 → 16 | 12 → 13 |

Every completed final paired answer stayed within 400 words. Qwen's main DDIC task nevertheless
used eight calls against that task's four-call limit. Other semantic/task failures are below.
One GPT main and one Qwen main run exceeded the general call allowance; both Gemma cache tasks
repeated missing-type errors until their allowance was exhausted. These were not discarded.

For the nine original GPT tasks completed on both sides, calls fell from 36 to 28, but captured
tool-result bytes **increased** from 134,226 to 152,814. The candidate retrieved broader evidence;
there is no general token, disk, SAP-traffic or cost-saving claim. These bytes measure serialized
MCP results, not backend network traffic or complete model input cost.

### GPT answer review, not just completion

| Task | Observed result |
|---|---|
| 1. Explain calculation behavior | Both correct. Candidate avoided contracts but used four source reads/greps versus main's three calls; no efficiency win. |
| 2. Object neighborhood | Candidate used relations first: 12 native nodes with packages and successful DDIC follow-ups. Main's smaller source map included blocked hierarchy and a rejected format. |
| 3. Distinct consumers | Candidate produced six defensible consumers, distinguishing tree rows from objects and references from implementations. Main exceeded the budget. Candidate still made three rejected structured TABL reads. |
| 4. Two-step paths | Both produced three source-backed paths with intermediate objects; five calls each. Candidate explicitly reported graph node/expansion caps. |
| 5. Exact package boundaries | Candidate obtained 25 nodes in four calls with separate package/type boundaries; main manually assembled a 21-node account in seven calls. Different evidence/counting units: not a recall ratio. |
| 6. Tiny incoming sample | Candidate still selected graph: no class, honest caveat, one call. Main's two calls supplied a source-verified class. Candidate was cheaper but less useful for choosing a class. |
| 7. Known reference | Both proved constant access. Candidate used two targeted greps versus main's six calls, including a blocked hierarchy request. |
| 8. Empty where-used | Both refused to treat zero references as safe-deletion evidence. Two calls each. |
| 9. Missing object | Both stopped after the first 404 and did not manufacture an empty graph. |
| 10. Narrow then wide context | Candidate correctly explained 1 → 4 resolved, ten failed, root scope and failed-type uncertainty. Main correctly identified its stale cached scope. |
| 11. New class, small implemented method | Both accurately explained `IS_AUTHORITY_CHECK_EXPECTED` in `/BOBF/CL_FRW_AUTHORITY_HANDLER`, without claiming whole-class authorization enforcement. Candidate added an unnecessary directory lookup. |
| 12. New interface neighborhood | Candidate distinguished native DDIC relationships and source-backed OO contracts for `/BOBF/IF_FRW_BUFFER`; three versus four calls. It still fetched both graph and contracts and proposed a permission-blocked hierarchy check. |
| 13. DDIC row type | Both correctly distinguished field `KEY` from its declared `/BOBF/CONF_KEY` type. Both first tried unsupported structured TTYP and recovered; no format-selection improvement on this held-out case. |

Across all 13 GPT pairs, invalid ordinary structured-format requests were **3 on main versus 4 on
candidate**. Clearer guidance and retry messages are correct, but this sample does not demonstrate
a general reduction in that error. Retain runtime validation; do not silently coerce arguments.

### Local model limitations

Qwen was useful on the known-reference task (candidate one call versus main three) and observed the
cache widening difference. It also made serious errors: claimed a constants interface was implemented,
guessed unresolved DDIC types, called the field `CONF_KEY` when the declaration says `KEY`, and answered
an outgoing-neighborhood question using incoming references. The package answer completed but violated
the requested expansion boundary. These are not acceptable autonomous analysis results.

Gemma improved a missing-type-heavy map workflow from seven calls to one, but produced less breadth.
Its tiny-sample workflow regressed from one call to seven, and both cache tasks failed by repeatedly
omitting type. It still confused reference counts with distinct objects. Single task times ranged
from approximately 55 to 146 seconds on this local setup; fewer calls did not guarantee lower latency.

Qwen's final original-task contexts peaked at 19,204 tokens versus the requested 32,768; responses
were not length-truncated. Its observed errors cannot simply be attributed to exhausting that budget.
These findings concern the installed quantizations, runtime settings and prompts—not every Qwen/Gemma
version or every deployment. No independent human grading or statistical significance is claimed.

An additional explicit-recipe Qwen pair isolated evidence interpretation from autonomous routing.
Candidate used one native lookup and accurately listed all 11 returned neighbors with types/packages,
but overinterpreted a superclass follow-up and did not fully state unknown coverage. Main ignored the
capability condition, tried the unavailable action, then recovered with context—two calls despite the
one-call instruction. Keep this pair separate from the 48-session results; explicit recipes help
but are not a substitute for runtime gates or reviewing claims.

Earlier baseline/prototype attempts, including no-tool fabricated answers, exceeded budgets and
a thinking-enabled Qwen probe, are retained separately. A GPT-5.4-mini availability check was rejected
by the existing ChatGPT-authenticated CLI before any model/tool answer; it is not an evaluated model.

## Verification and review

- 6,130 unit tests; typecheck; lint; 126-entry/14-schema policy validation; build; file-size and
  schema budgets all pass. Strict MkDocs build passes. Existing Biome/plugin notices are not new defects.
- Nine snapshot fixtures intentionally change descriptions only: parameter names/types, enums and
  validation shapes are identical after stripping descriptions. Hyperfocused snapshots are unchanged.
  Disabled/denied/unsupported relations still adds neither graph arguments nor graph-specific guidance.
- 45 offline ABAP/CDS differential cases compared original PR and candidate: identical read sequences,
  contract text and failed-read evidence across depth, limits, cycles, shared children and missing sources.
  Added unit tests protect nonnegative root counts and actual multiline output length.
- Fresh live controls reproduced main's stale narrow→wide result; candidate's warm-wide output exactly
  matched cold-wide output. Targeted source responses were byte-identical across builds.
- Default standard schema: 45,950 → 45,691 bytes versus original PR. Full standard+relations:
  71,937 → 71,938. Full BTP+relations: 68,391 → 68,519. **No budget increases.**
- Final review found two stale README recommendations and one landing-page recommendation;
  documentation-only follow-up aligns those with the measured tool guidance.

## What not to add now

Do not add an automatic type-resolution loop, graph ranking API, compressed-ID wire format, model
router, Ollama dependency, or database to solve these model mistakes. They introduce behavior and
maintenance that these results do not justify. Do not enable SQL/data permissions to make hierarchy
requests succeed. Native graphs stay experimental/default-off; use them for maps, not as the mandatory
first call for behavior, exact references, tiny consumer samples, or deletion decisions.

For broader rollout, add these failure patterns to the **existing** eval infrastructure and obtain
human SAP-expert grading across additional models/releases. Repeat paired trials before claiming a
general quality or efficiency improvement. Live BTP principal propagation/Cloud Connector, other SAP
releases and production workloads remain outside this local trial's evidence.

## Reproduction and evidence index

Use independent worktrees/instances pinned to the commits above. Keep identical safety configuration,
fresh model sessions, per-task cache resets, actual tools/list, and the same user prompt on each side.
Do not run fixture-syncing E2E commands to reproduce this read-only experiment. The repository's
`npm run test:eval` already supports provider selection; its tool-selection scenarios are separate
from this open-ended live answer/trace comparison.

The private local lab preserves the exact 10 common prompts, three held-out prompts, model schemas,
settings, raw responses, unedited answers and checks. Run IDs:

| Evidence | Run ID |
|---|---|
| GPT original ten pairs | `2026-09-09T12-36-43.812Z` |
| GPT held-out three pairs | `2026-09-09T12-49-29.170Z` |
| Qwen five pairs | `2026-09-09T12-43-18.226Z` |
| Qwen held-out three pairs | `2026-09-09T12-46-18.152Z` |
| Gemma three pairs | `2026-09-09T12-47-32.115Z` |
| Explicit-recipe Qwen pair, separate | `2026-09-09T12-57-31.908Z` |

Raw trial source and authentication material are not repository artifacts. The local lab's
`evaluation/answers.md`, `metrics.json`, `models.json`, `context-equivalence.json`, and
`live-controls.json` provide traceable evidence to the system owner.
