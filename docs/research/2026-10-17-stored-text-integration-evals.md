# Stored-text MCP integration and LLM evaluation

Date: 2026-10-17. Implementation: [PR #1012](https://github.com/arc-mcp/arc-1/pull/1012).
This follows the [codec investigation](2026-10-17-stxl-typescript-spike.md),
[SAP semantics](2026-10-17-stxl-read-text-semantics.md), and
[use-case research](2026-10-17-stxl-use-cases.md).

## Integration decision

The production entry point is `SAPQuery(action="long_text", longText=...)`. Saved business text is
data, so it belongs with query operations; SAPRead remains focused on development objects. The nested request has
three modes: discover headers by known object/literal name prefix; read an ordered exact-key
batch; or search a literal phrase within supplied keys. Discovery returns the same key shape
accepted by reads, so the model can copy identities instead of constructing SAP composite names.
The [usage guide](../../docs_page/tools.md#stored-sapscript-long-texts) provides concrete examples.

One existing intent tool keeps the permission and key contract together. Separate discovery/read
tools would duplicate the same fields and guidance. Raw table
queries plus model-side decoding would expose binary mechanics and encourage broader SQL access.
These tradeoffs are recorded in the [design note](../plans/2026-10-17-stored-text-integration.md).

Runtime code is split into small TypeScript modules for key validation, chunk assembly, binary
decoding, guarded extraction, and stored-text semantics. The handler maps these to stable JSON
keys, per-item errors, and recovery hints. Research scripts import the production implementation;
there is one codec to maintain. The MIT reference attribution remains in distributed JavaScript.

## Authorization and operational behavior

`data` scope, `SAP_ALLOW_DATA_PREVIEW=true`, table blocklists, and the caller's SAP authorization all
apply. The operation is disabled by default. `SAP_ALLOW_FREE_SQL` and `sql` scope govern the separate
SQL action: long-text access does not require or grant either. Existing SQL calls may still omit
`action`; they resolve to `sql`, including deny-rule enforcement.
No RFC, free SQL, helper installation, or SAP mutation is used. The complete action/property/guidance
is removed when data preview is disabled or BTP is selected/discovered. Authenticated listings also
apply scope and deny-rule pruning. Multitarget definitions follow the selected target's ceiling.
Hyperfocused dispatch uses the same validated handler. Runtime deny rules apply to every call,
including stdio, where there are no user scopes.

The request shares admission, cancellation, and cumulative response accounting through serialization.
Limits are 25 keys, eight reference hops, 60 seconds/120 table queries, and 2 MiB/10,000 decoded
lines per batch. Existing data response limits can stop a smaller request. Audit start events
retain only mode and key count for this action; sink tests verify that keys, phrases, and returned
business text stay out of logs. The model still receives the requested text.

Only classic persisted ITF/TLINE with the qualified FF06/4103 little-endian profile is supported.
Text memory, archives, custom/upgrade persistence, legacy ITCRF references, non-ITF formats, and
rendered forms are excluded. Missing classic storage does not prove absence elsewhere. Header and
cluster rereads detect observed changes without claiming snapshot consistency or authenticated bytes.

## Public-handler SAP verification

After moving the route to SAPQuery, all nine integration calls below were rerun through public
`handleToolCall` with writes, helper writes, and free SQL disabled.
It uses existing authorized test texts, without installing or modifying SAP objects.

| Target SAP_BASIS | Calls | Outcome |
|---|---:|---|
| 758 | 4 | Exact read (3 lines), discovery (1 candidate), ordered existing/missing/duplicate batch, phrase match |
| 816 | 4 | Same four operations passed |
| 750 | 1 | Missing preview endpoint reported as `UNSUPPORTED_PLATFORM`, not missing text |

This supplements the earlier independent kernel/native READ_TEXT comparisons; it does not replace
them or establish support for every installation of those releases. Sanitized stage counts are in
[the evidence file](2026-10-17-stxl-evidence.json). Existing business text and raw SAP responses remain
private. The current integration probes made no SAP changes; earlier disposable oracle cleanup is
documented in the codec report.

The final 758/816 public reads also compared every returned `TDFORMAT` and `TDLINE` against the
previously captured private native `READ_TEXT` oracle. Both matched exactly after removing only
fixed-width ASCII-space padding. This checks the public projection as well as the codec.

## Evaluation method

The existing harness primarily graded the first tool selection. Stored-text evaluation now requires
ordered calls across turns, exact case-sensitive identity values, valid production arguments, and
final-answer assertions. It checks forbidden calls throughout the trace, including proposed calls
beyond the execution cap. Invalid arguments cannot pass merely because a model later invents a
plausible answer. Providers unable to observe the required trajectory refuse the scenario explicitly.

The model sees ARC-1's real tool definitions with distractor tools enabled. Tool responses come from
the production dispatcher and decoder over synthetic kernel-produced table fixtures. A wrong key
therefore receives the real missing-key result. No model receives private SAP data or can execute
mutations in the fixture backend. The fixture scenarios are separate from live SAP verification.

Independent review found and corrected misleading static batch/search responses, a grader that
could hide excess calls, and first-call-only CLI grading of trajectory scenarios. Pilot scores from
those intermediate graders are not release evidence. Final-answer assertions are explicit and
testable, but finite regex checks cannot prove arbitrary semantic correctness; traces still need
human review. A finite passing run also cannot establish perfect model understanding.

Tool design references: [Anthropic's tool-design guidance](https://www.anthropic.com/engineering/writing-tools-for-agents)
and [agent-evaluation guidance](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
support task-shaped contracts and whole-trajectory evaluation. The
[MCP tools specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
defines the schema and read-only annotations exposed to clients.

## Current SAPQuery model result

One fresh ten-case run used Qwen3.5 27.8B/Q4_K_M through Ollama with a temporary 32k-context,
temperature-zero configuration. All cases used the final SAPQuery contract, the same production
fixture dispatcher, and all 12 standard tools. Prompts, on-prem tool definitions, and grading were
frozen throughout the run. The OpenAI tool payload is 74,053 bytes, SHA-256
`4a70bbc33f4503b9c895ec5e6a44653a46b6639c248bc45947209fc06282701f`.
The maximum reported individual prompt was 20,525 tokens, within the configured 32k context.

The unchanged automated result is **8/10**. The purchase-order-number case guessed object/ID values
instead of asking for a verified mapping, then made an invalid discovery call. The missing-key case
used the correct tool/key and explicitly qualified absence, but Markdown bold markers interrupted
the phrase expected by the answer regex. Its explanation also introduced unsupported archive-table
and text-pool details. Neither result was regraded or dropped from the denominator.

Manual review found errors beyond those two automated failures: the exact-space case preserved the
key but changed literal `&amp;` to `&` in its body; the batch answer confused text name with text
object in its suggested next step and called an ITF paragraph comment-style; the unsaved-editor
answer refused retrieval correctly but overclaimed storage behavior and suggested an incorrect
object example. Eight automated passes therefore do not mean eight fully correct answers.

[Complete recorded evidence](2026-10-17-stored-text-sapquery-model-evidence.json) preserves the original
report, all ten traces/answers, model settings, hashes, automated grades, and manual findings. The
unique temporary alias was removed and the base model retained. This single run does not establish
reliability or a causal improvement over the earlier routing. The draft remains pending actual
client/model qualification; exact-content consumers should use returned line values directly.

## Earlier SAPRead-surface model results

The following three runs tested the **earlier SAPRead LONG_TEXT surface**, before the routing change.
Their schema hash and outcomes remain historical evidence; they do not qualify the current SAPQuery
contract. These are single runs per local model configuration, not a model leaderboard or a statistical
reliability estimate. These fixed prompts were also used during development, not a blind holdout.
All ten selected scenarios count in the denominator, including provider
errors and timeouts. Scores require the complete expected workflow and asserted answer; they are
not just first-call selection accuracy. A model may select the correct tool and still fail through
wrong identities, extra calls, missing final answers, or unsupported claims.

All runs expose the same 12 production tools, including write/query distractors, serialized as
74,041 bytes in OpenAI tool format. The tool-schema SHA-256 is
`bcb5a18b2a1ed87af75f0116bbb8b856c6a5a9bed29ae3f0fa14736f96d7eb7c`.
The production MCP wire format is 74,456 bytes; neither existing wire nor estimated-token ceilings
were raised. This is the full developer surface. Smaller scope-filtered and hyperfocused surfaces
were unit-tested, but were not empirically compared in these model runs.

Qwen3.6 MLX reported an 8,192-token loaded context while completion usage reported prompts around
20,000 tokens. That discrepancy was not resolved, so its failures cannot be attributed solely to
the tool contract or to model capability. The Llama and Qwen3.5 GGUF runs used temporary local model
aliases with `num_ctx=32768`; Qwen3.5 also used temperature zero. Llama inherited its model defaults.
No base model, global Ollama setting, or model download was changed. Ollama's OpenAI-compatible
endpoint requires a model configuration for the local context size; it does not accept that
setting through the ordinary OpenAI request fields
([official documentation](https://docs.ollama.com/api/openai-compatibility#setting-the-local-context-size)).

| Configuration | Original automated pass | Corrected automated pass | Main observed failures |
|---|---:|---:|---|
| Qwen3.6 35.1B MLX/NVFP4, provider defaults | 3/10 | 3/10 | Four provider tool-parser HTTP 500 errors; guessed mapping; split batch; empty answer |
| Llama3.1 8B GGUF/Q4_K_M, 32k context | 1/10 | 1/10 | Missing type/fields, stringified keys, tool-call text without an actual call; its one automated pass fails manual review |
| Qwen3.5 27.8B GGUF/Q4_K_M, 32k context, temperature 0 | 6/10 | 7/10 | Guessed PO mapping; two exact reads with invalid extra fields before a correct retry |

Qwen3.5 passed discovery followed by English reading, language clarification, exact-space key
selection, injection-as-data, supplied-key search, mixed-success batching, and refusal to read an
unsaved editor. Its batch answer was the independently identified cross-item regex false rejection.
Both exact-read failures corrected their arguments after the validation hint, but still fail the
strict one-call trace; the two-call execution cap ended those cases before a final answer. They
are not evidence that the underlying read failed. Its per-request prompts were 20,089–20,525 tokens,
below the reported 32k context. Latency includes local runtime/load conditions and is not a service
benchmark. [Recorded model evidence](2026-10-17-stored-text-model-evidence.json) retains every original
trace, answer, score, corrected grade, schema hash, and available inference settings.

Manual review is a separate check. For example, Llama's unsaved-text response satisfied the original
lexical assertions while falsely suggesting a fabricated call could read the unsaved editor.
That automated pass is not a correct task outcome. Qwen3.6's otherwise correct phrase-search answer
called STXL the header store (the header table is STXH), and its unsaved-text explanation overclaimed
where editor memory lives. Those details are not certified by passing lexical assertions.
Qwen3.5 preserved the requested key spaces but changed literal `&amp;` to `&` in the displayed body;
that fails manual exact-content fidelity even though its lexical space check passed. It also
misdescribed the ITF `*` paragraph format as a comment, and its unsaved-text answer overclaimed
editor-memory placement and offered unimplemented long-text write/draft capabilities. The seven
automated passes therefore must not be presented as seven completely correct explanations.

Independent grader review also identified negation and cross-item false rejections, plus missing
word boundaries in the language assertion. The corrected grader is applied consistently to the
saved trajectories, without changing prompts, tool schemas, model outputs, or failed provider
outcomes. Original and corrected scores are retained in the evidence so this is visible. Regex
checks remain deliberately limited; free-form contradictions need manual review.

**Decision:** retain the integration as a reviewable draft with explicit stored-text scope. The
runtime contract and SAP results are verified; universal LLM usability is not. No tested local
configuration met all ten strict workflows, and manual review found additional answer errors.
Keep the failing cases as regressions and qualify actual deployment clients/models before making
an autonomous-workflow reliability claim. The API returns the original line values; consumers
requiring exact text should use those values rather than a model's paraphrase or rendering.

## Claude review follow-up

An independent Claude Code GUI review used Opus 5.5 Max against `98f2ddf`. It found no blocker
in the decoder, reader, permissions, audit handling, or routing. Two contract findings prompted
changes: remaining SQL-only admin documentation was corrected, and unique SAPRead instructions
removed during schema compression were restored. The shorter descriptions are intentional;
the full wire surface is now 74,459 bytes, below the unchanged 74,500-byte ceiling.

Follow-up coverage includes the internal data-source registry, successful reads through a
nonempty blocklist, minimal-error redaction, nested schema parity, the BTP action table, and
complex 25-key batches. References or distinct IDs can reach the 120-query limit before 25 keys;
10-key retries passed. Consistency rereads remain: removing them to reduce query cost would
weaken change detection. Query pruning now lives with the query definition instead of in a
misnamed long-text module. Further wrapper/response refactors were deferred to avoid scope growth.

The review's repeated-space prefix concern exposed a real live failure: SAP 7.58 and 8.16 reject
`LIKE` with the generated `CONCAT_WITH_SPACE` expression. The bounded compatibility path now
compares `LEFT(field, prefixLength)` with the preserved literal and checks `LENGTH(field)` to
exclude shorter blank-padded names. Ordinary prefixes retain escaped `LIKE`. Unqualified
space-preserving IN-list expressions are explicitly rejected. See SAP's
[SQL string functions](https://help.sap.com/docs/abap-cloud/abap-keywords-standard-abap/ABENSQL_STRING_FUNC.html).

`prefix-live.ts` passed six public discovery calls per release: internal, leading and trailing
spaces, wildcard/quote characters, many gaps, and spaces-only prefixes. All 12 returned zero
candidates, so these prove endpoint acceptance, not positive stored-name matches. No RFC,
free SQL, helper or mutation was used. Separately, `prefix-expressions-live.ts` requires an
explicit research-only free-SQL opt-in and compares synthetic positive/negative constants.
It passed 8/8 on 7.58 and 7/8 on 8.16; the remaining 8.16 case reports a grammar error. Expanding
every constant to `CHAR(70)` instead produced a statement-count error in that case. A longer
`SUBSTRING` form also failed during 8.16 query formatting, while the public `LEFT` form passed.
These backend parser limitations remain recorded, not regraded as successes. The runtime never
uses this free-SQL oracle. This qualification does not cover every valid SAP text name or query
layout.

A second Opus 5.5 Max review of `e9c7104c` accepted all fixes and found no remaining code blocker.
It independently ran 296 focused tests and the size gate. It classified the expanded-constant
oracle failure as a research-query limitation: the runtime applies LEFT/LENGTH to a field,
not to a nested constant expression. Merge recommendation: ready once final CI is green and the
PR discloses the schema compression and oracle failure. Opt-in pilot use on 758/816 is qualified;
autonomous-model reliability is not.

Follow-up live checks strengthen the field-form evidence: another 12 discovery requests with
varying prefix lengths passed on 816. `prefix-existing-live.ts` then found the expected existing
German text with two leading name spaces on **both 758 and 816**, using a shorter prefix and
the oracle's exact object/ID/language. These are positive stored-field matches. Together, the
new prefix checks total 26 public calls; all used no RFC, free SQL, helper or SAP mutation.
The nine public read/discover/search/capability smoke calls were also rerun successfully at
`e9c7104c` (750 correctly reports `UNSUPPORTED_PLATFORM`). Private names and bodies stay local.

Final local validation: **326 files / 9,229 tests pass** in a fresh two-worker run without retries.
An earlier four-worker run found three obsolete wording assertions (updated) and four CLI/shutdown
startup timeouts under load. Typecheck, build, lint, policy, schema/file budgets, strict docs build,
and package inspection pass. The distributed package contains the eight stored-text modules and
handler. No schema budget was raised.

The recorded 8/10 model run predates the description edits in `e9c7104c`; it is historical evidence,
not a score for the final payload. Qualify the final payload with the actual deployment model
before making an autonomous-workflow claim. Neither review certifies model answers.

## Pre-review SAPQuery integration checks

The migrated surface passes **324 files / 9,192 tests**, including 64 eval-harness/grader tests,
57 public-handler tests, SQL backward compatibility, data-only visibility, BTP schema parity,
per-target policy, hyperfocused delegator visibility, deny rules, and malformed-call audit redaction.
Typecheck, build, lint, policy validation (132 entries/14 schemas), package inspection, and
file/schema budgets pass. The full MCP wire surface is 74,468 bytes; existing wire/token ceilings
were not raised. Six tool-definition snapshots were intentionally reviewed and updated.

Review found and fixed stale hyperfocused query visibility and a malformed nested-call audit path.
The full suite also caught a BTP runtime/wire-schema mismatch and an obsolete data-only visibility
assertion; both were corrected before the passing full run. The old SAPRead route is rejected.
The nine live SAPQuery calls above used no RFC, free SQL, installed helper, or SAP mutation.

## Earlier integration checks

Before the SAPQuery migration, the full unit run passed **324 files / 9,166 tests** with four workers. This includes 64
eval-harness/grader tests, 46 public long-text handler tests, production codec/store tests, and
scope, deny, target-selection, audit-redaction, cancellation, and schema-snapshot checks.
Typecheck, build, lint, policy validation (131 policy entries/14 schemas), and the file/schema
budget gates passed. The package dry run contains all eight stored-text runtime modules and the
handler, with the MIT attribution retained in distributed decoder JavaScript.

Independent production review found no new blocker within the stated classic-store contract.
This does not qualify unsupported profiles or establish correctness of an LLM's interpretation.

## Reproduce and extend

```sh
npm run test:eval -- --provider ollama --model <installed-model-tag> --file stored-text --backend mock
npx vitest run tests/unit/evals tests/unit/handlers/long-text.test.ts
```

The model run uses synthetic texts and the production dispatcher; it never sends a model private
SAP business content. Configure enough context for the complete tool definitions and capture
model parameters, tool hash, failures, and raw trajectories. Inspect both passing and failing
answers. Repetitions and paraphrased/held-out tasks should precede a client-specific reliability
claim. The CLI integration providers currently reject these trajectory scenarios explicitly rather
than returning misleading first-call scores.

The remaining practical work is qualification of the actual client/model combinations used by
ARC-1 users, plus an empirical comparison with narrower tool surfaces. Business-object presets
need independently verified mappings before they can replace exact supplied/discovered keys.
Broader storage formats and persistence remain [FEAT-86](../../docs_page/roadmap.md#feat-86).
