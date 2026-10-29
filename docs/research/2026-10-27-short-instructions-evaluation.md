# Full versus short server instructions (#957)

**Recommendation:** keep `full` as the conservative default for general SAP work. This is a product
decision, not evidence that full wins every task. Short's largest observed weakness was Codex test design
when requirements were missing; it also skipped requirements lookup more often in draft reviews. Most
other task scores tied. Consider short for narrow lookups tested with the actual model/client.

## What was tested

ARC-1 runtime `a58a364c52f5263b6cc840c7c3fa142f74be3f88`, collected October 27–29, 2026.
Eight synthetic tasks × three fresh sessions × two modes × two models = **96 scored answers**.
Only the initialize instructions changed within each comparison. The same system label, real
nine-tool catalog of a server with writes disabled, prompts and fixture facts were used. No model
accessed live SAP. Some tools still carry non-read-only/destructive annotations.

| Setting | Codex | Local Ollama |
|---|---|---|
| Model | `gpt-5.6-sol` | `qwen3.6:35b-mlx`, 35.1B, nvfp4 |
| Runtime | Codex CLI 0.144.0 | Ollama 0.33.2 |
| Sampling | Medium reasoning; no seed control | Thinking off; temperature 0.2; seeds 9571–9573 |
| Isolation | Fresh ephemeral sessions; user/project instructions disabled; fixture MCP only | Fresh conversations; same catalog injected directly |
| Limits | Eight tool calls, 350 requested words, 240 seconds per session | Eight calls, 350 requested words; 32,768 context, 3,000 output tokens; 180 seconds per turn |

The installed Codex CLI/login rejected the newer model names tried; these results apply only to
the tested model. Ollama model digest:
`1b50c6fdc2d4f75f94e6c19b49b20051bc6a7e73620d1ccdfc6687ec042ce754`.
Mode order alternated. Compare modes within each model, not models against each other.

The fixture has a documented minimum fee that the code omits, a draft that removes a negative-input
guard, and another class with no documented requirements. Other tasks test method/signature reads,
capped reference counts, and syntax success alongside unavailable ATC and zero unit tests.

## Results

Core-answer passes out of **three** per cell, after audit. This checks facts and material claims;
it does not certify compilable ABAP examples or a valid live SAP workflow.

| Task | Codex full | Codex short | Qwen full | Qwen short |
|---|---:|---:|---:|---:|
| Explain a known method's current result | 3 | 3 | 3 | 3 |
| Design tests using available requirements | 3 | 3 | 1 | 2 |
| Review active versus inactive source | 3 | 3 | 3 | 3 |
| Design tests when requirements are missing | 3 | 1 | 0 | 0 |
| Review against user-supplied requirements | 3 | 3 | 2 | 2 |
| Interpret capped where-used results | 3 | 2 | 3 | 3 |
| Distinguish unavailable checks from passes | 3 | 3 | 3 | 3 |
| List public signatures | 3 | 3 | 3 | 3 |

The clearest short-mode weakness was **unverified intent**: Codex full distinguished observed source
from business requirements in all three answers; short did so in one. All six performed a requirements
lookup: the difference was how they explained the lack of evidence. Another short answer gave
“2 distinct programs” as its headline despite an incomplete reference sample. Its generic coverage
caveat did not explain that the system-wide count was unknown.

There was no consistent advantage across all tasks. Qwen's test-design score favored short by one
answer (2/3 versus 1/3) after the non-blind audit; blind grading had both at 3/3. This is a small
observation rather than a reliable effect. Qwen misidentified passing
tests as failing in two full test-design answers, one short test-design answer and one short review
against supplied requirements. One full answer proposed `MIN` where a minimum fee requires `MAX`.
Qwen failed to qualify missing business intent in both modes.

Evidence acquisition differed even when the core finding was correct. In draft reviews, full
retrieved requirements 3/3 times in both models; short did so 2/3 in Codex and 0/3 in Qwen. The removed
guard was visible in the diff, so missing this lookup alone was not a core-answer failure.

Both modes also produced questionable or malformed ABAP examples. These were recorded separately
from the task-fact rubric and were **not compiled or run in SAP**. A correct table of expected values
does not make the surrounding generated code ready to use. Full instructions are not a quality guarantee.

## Saving and practical use

With the `Evaluation ERP` label, full sends 1,868 characters and short 172: **1,696 fewer characters**.
Tool definitions remain 45,490 serialized characters in both modes. In every matched Ollama task,
the first prompt was **371 tokens smaller**, about **2.9%** including the catalog. This is not a
speed benchmark, a startup improvement, or a reduction in tool-result size.

Codex loads server instructions with MCP tools: two no-tool control runs per mode used 12,238 input
tokens, and a probe confirmed that instructions arrive once tools load. **Codex's instruction-token
saving was not measured.** Do not apply Ollama's percentage to other clients or treat multi-turn
totals as instruction size alone.

For known-method reads and signature listings, both models passed all six runs per mode across
those two tasks. That supports trying short for **those narrow lookups with validation**, not
adopting it for open-ended analysis, test generation or unattended changes. Multiple connections
alone are not a reason to use short: a client may never load another instance's full instructions.

## Method, exceptions and limits

Claude Code **Opus 5.5 Max** graded every scored answer in mode-blind packets with model labels,
token counts and timings hidden; packets were grouped by model. Codex then audited the grades
against answers and traces **without blinding**. Five Qwen core grades changed from pass to fail
(three full, two short), with reasons retained. Core correctness and supporting evidence were graded
separately, accepting equivalent tool routes; all 96 passed the supporting-evidence rubric. This is
AI-assisted review, not independent human SAP-expert validation.

Exploratory runs exposed missing fixture routes and were excluded in full. The revised fixture
replayed 238 exploratory calls before the final collection; fixture and rubric hashes were frozen.
A later client-policy audit found cancelled diagnostic calls in 16 Codex sessions. All 18 sessions
from the three affected task cells were replaced, covering both modes/all repetitions, under the
predefined infrastructure-retry policy. The 30 unaffected Codex sessions and all 48 Ollama sessions
were retained. The retry only approved `SAPDiagnose` on the offline fixture; production annotations,
user configuration and sandbox permissions were unchanged. No client cancellations remained.

The fixture is not the full ARC-1 handler/runtime. **Deviation from the frozen retry policy:** sessions
with non-blocking fixture gaps were retained and scored, rather than declared unscorable. Five valid ATC batch
calls needed a supported single-object retry, and one optional Qwen hierarchy call was unrepresented.
One optional Codex unit-test call without `type` was answered too permissively. None supplied the
source/requirements evidence for the core finding, but they limit claims about tool-use reliability.
Two other unit-test batch calls were invalid under the actual runtime schema and recovered normally.
The requested facts were obtained through other calls; the affected Codex checks had already used
their infrastructure retry. This pragmatic exception limits confidence in tool-use comparisons.
The evidence archive retains these traces rather than silently correcting them.

All 96 scored sessions completed within their call limit, without runner failures. Ollama exceeded
the requested 350 words in 7/24 answers in each mode; its longest reported input was 13,860 tokens,
below the configured context, with normal stop reasons and no reported thinking. Fewer calls or
shorter answers were not counted as higher quality.

Tasks were selected to exercise guidance that short removes (requirements, uncertainty, check status,
reference counts and targeted reads). They test whether that guidance matters, not how frequently
these situations occur. These are repeated samples of **eight selected tasks**, not 24 independent workloads.
There is no universal “percentage worse,” statistical equivalence or model ranking. Mixed-instance
instruction sharing, native IDE navigation, hyperfocused mode, long conversations, SAP writes and
other models remain untested. npm/npx is unaffected.

## Evidence and validation

[Evidence archive](short-instructions-evaluation/evidence.zip) and
[SHA-256](short-instructions-evaluation/SHA256SUMS): exact prompts/instructions/catalog, fixture and
runners, settings, answers/tool traces, excluded client-policy sessions, blind grades and adjudications.
No private model reasoning or credentials are included. The archive README explains reproduction.

Documentation only in this follow-up: no production code, tool definitions or dependencies changed.
397 focused config/server tests passed; strict documentation build and whitespace checks passed.
The feature's earlier native SAP read/handshake and CI results remain recorded in PR #1117; this
model comparison adds no native SAP compatibility claim. Roadmap checked: **No roadmap impact**.

Metric definitions: [Ollama usage](https://docs.ollama.com/api/usage).
Client variability: [MCP server instructions](https://blog.modelcontextprotocol.io/posts/2025-11-03-using-server-instructions/).
