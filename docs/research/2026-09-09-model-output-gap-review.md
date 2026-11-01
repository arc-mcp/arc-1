# Model-output gaps: follow-up findings and verification

## Outcome

The initial pass at `cdb74195` fixes lost incompleteness warnings and improves evidence
labels without changing retrieval, input shapes, permissions, dependencies or caches. Four net
source lines across five existing files; eleven additional unit cases. Graphs remain experimental
and default-off. No push or merge was performed at that stage. The final follow-up below records
the additional changes and verification prepared for PR #769.

This follows the [initial evaluation](2026-09-09-model-output-evaluation.md) and
[gap-review plan](../plans/2026-09-09-model-output-gap-review.md). The earlier report remains a
record of its earlier runtime, not a claim about these new samples.

## Concrete findings addressed

1. `lookupLiveUsages` already returned a sanitized warning when optional interface-implementer
   enrichment failed, but both `SAPNavigate.references` and `SAPContext.usages` discarded it.
   Both now preserve it alongside native results. An offline replay through both built revisions
   reproduced the loss before and preservation after, with identical mocked calls. Neither raw
   exception messages nor private policy diagnostics are included.
2. Both envelopes now include `countMeaning`: reference entries, not distinct objects or runtime
   calls, and not a complete inventory. Existing totals, arrays, filters and pagination are unchanged.
   Tests cover repeated entries from one class, empty results and truncated results with warnings.
3. SAPRead now puts DDIC default-format guidance near its start. Runtime rejection remains intact:
   there is no silent format coercion, guessed type or automatic fallback read.
4. Navigation states hierarchy's data/SQL prerequisites. Its denial and internal policy guidance
   offer MAIN-source declaration inspection without changing permissions. The old suggestion used
   `include="definitions"`, which reads local helper classes rather than the global declaration.
   The warning now names the real tools, not the nonexistent `SAPWhereUsed` tool.
5. Opt-in relation guidance distinguishes outgoing neighborhoods from incoming class candidates.
   Documentation removes claims that reference counts measure the full blast radius, describes the
   additive response fields, and fixes an inconsistent example (`usageCount=3`, shown=2, not truncated).

## Method

Twenty actual model sessions (ten pairs), retained locally with complete answers and tool traces:
four GPT pairs against the previous build, three against main, two Qwen pairs against the previous
build, and one Qwen pair against main. One sample per prompt/configuration, not a statistical benchmark.
Review considered tool choice, evidence and answer correctness, not merely completion. This follows
[OpenAI's evaluation guidance](https://developers.openai.com/api/docs/guides/evaluation-best-practices).
Tool-specific hints stayed next to the tools, consistent with
[OpenAI's tool-guidance recommendations](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.5).
Neither source establishes that our particular wording will generalize.

Main `c55adcb8` was checked against the remote on this run and remained current. The previous build
was pinned separately at `ea177502`; candidate was `cdb74195`. All used the same read-only A4H 2023
trial/client 001, HTTPS, independent memory caches and fresh sessions. GPT-5.6 Sol used the actual
ChatGPT-authenticated Codex CLI, medium reasoning and low verbosity. Installed Qwen `qwen3.6:35b-mlx`
used Ollama, thinking off, temperature 0, seed 42, context 32768 and output limit 1800. No downloads.
Only four read-only ARC-1 tools were supplied; no prototype overlays, reviewer notes or previous
answers. The limit was eight calls/400 words, four calls for the DDIC task. No real SQL/table-data
queries, SAP mutations, BTP provisioning or principal-propagation test were performed.

## Results and limitations

| Paired task set | Calls baseline → candidate | Tool errors baseline → candidate | Assessment |
|---|---:|---:|---|
| GPT vs previous build: map, tiny sample, interface map, DDIC | 17 → 14 | 5 → 0 | All eight answers complete; unsupported ordinary structured reads 4 → 0 |
| GPT vs main: map, DDIC, class candidates | 11 → 10 | 3 → 0 | All six answers complete; invalid structured reads 2 → 0 |
| Qwen vs previous build: tiny sample, DDIC | 5 → 5 | 1 → 1 | All four answers complete, but meaningful interpretation errors remain |
| Qwen vs main: class candidates | 8 → 1 | 1 → 1 | Neither delivered candidates: main exhausted the budget; candidate stopped after failed source search |

GPT's dependency map used seven calls on both previous/candidate builds, but candidate spent them
on useful reads instead of blocked hierarchy and invalid formats. The interface map improved from
four to three calls and proposed filtered references instead of an unavailable hierarchy operation.
The DDIC answer used the saved failed-format call to resolve the data element, correctly separating
field `KEY`, its `/BOBF/CONF_KEY` type and declared `RAW(16)` properties from actual stored values.
These are small-sample observations, not causal certainty or a guarantee about every model.

The tiny incoming graph still contained no class. Both GPT versions chose it and explained its
limits; the candidate used one call rather than three but obtained less source verification.
Do not score that as an unconditional quality improvement. A new held-out prompt explicitly
prioritizing five class candidates made both main and candidate choose filtered references in one
call and return the same five classes. Candidate explicitly distinguished 65 rows from unique
consumers. Both answers' proposed "definition section/include" follow-up remained imprecise: MAIN
must be used, not the local definitions include. No follow-up was executed in that task.

Qwen's candidate DDIC answer correctly named `KEY`, unlike the preceding build's `CONF_KEY` field
claim, but still guessed the row object as DDLS before recovering. Its tiny-sample answer confused
the number of DDIC rows and applied component evidence to a class/container row. The class-candidate
task selected an unavailable source-search path; one failure-only final answer is not task success.
Gemma was not retested: the earlier negative findings remain. No generic model-reliability claim.

Captured GPT result bytes increased: 67,513 → 74,485 against the previous build, and 24,558 → 31,749
against main. More useful reads can mean more evidence bytes; these are MCP result sizes, not total
model tokens, backend traffic or cost. Pair timing is observational, not a latency benchmark.

## Final verification

- Full unit suite: 6,141 tests across 207 files. Typecheck, lint, policy validation, build,
  file/schema budgets and strict docs build pass. No budget increase. Existing Biome/docs notices remain.
- Nine changed tool snapshots differ only in descriptions; parameter types, enums and input
  requirements are identical. Hyperfocused and default-off graph containment are preserved.
- Forty-five offline differential context cases retain identical reads and contract/error evidence.
- Live reference/usages payloads match main after removing the new count label. Typed references
  return five CLAS/OC entries; both source controls are byte-identical, including MAIN declarations.
  Hierarchy remains blocked without data access; candidate gives the read-only fallback.
- Live narrow→wide context still reproduces main's stale cache; candidate warm-wide equals cold-wide.
  That cache improvement belongs to the underlying PR, not this follow-up.
- Artifacts remain in the private comparison lab. No known saved credentials or group/other file
  permissions were found in the artifact scan. Raw SAP source/model evidence is not committed.

No ranking service, model router, database, new tool, automatic type guessing or broader permission
was justified. The deterministic warning/count fixes are worth keeping; the remaining reasoning and
sample-selection limitations are documented rather than hidden behind additional production machinery.

## Final follow-up: implementation and release verification

Runtime `00b7709d` clarifies that a global class declaration and implementation live in MAIN;
`definitions`/`implementations` are local helper-class includes. It also makes truncated-reference
hints acknowledge an existing object-type filter. Explicit include routing, empty local includes,
reference arrays, counts and filtering are unchanged. Nine regression cases cover the guidance,
empty/local source routing, and absent/blank/padded filters.

The larger model pass exposed an unnecessary class-only filter on a general unused-code question.
Runtime `1a526344` adds explicit guidance to omit `objectType` for all consumer types, with two more
unit cases and retests of general usage, tiny samples and class-only declaration verification.
This is wording, not forced model routing or an additional SAP lookup. Both runtime commits together
add three net production lines across three existing files. No dependencies or safety gates changed.

### Actual model evidence

There were **44 new model sessions**: 36 at `00b7709d`, then eight focused retests at `1a526344`.
All compare against main `c55adcb8`, with identical paired prompts, independent caches and the
same read-only SAP_BASIS 758 trial. The earlier eight-call/400-word harness and evidence policy
remain in effect. The two new tasks inspect a global declaration and actually verify a class
candidate's declaration; expected answers were not supplied. These are exploratory single samples,
not an independent statistical quality benchmark.

| Comparison | Calls main → candidate | Tool errors main → candidate | Observed result |
|---|---:|---:|---|
| Original ten GPT tasks, `00b7709d` | 42 → 36 | 6 → 2 | Both completed 10/10; unsupported structured reads 4 → 0 |
| Two GPT declaration follow-ups, `00b7709d` | 4 → 4 | 0 → 0 | Correct source evidence; candidate's complete MAIN verification increased output bytes |
| Three GPT retests, `1a526344` | 7 → 7 | 0 → 0 | General usage unfiltered; class-only verification reaches MAIN in two calls versus three on main |
| Qwen 3.6, thinking off, two follow-ups | 7 → 3 | 1 → 0 | Fewer failed/wrong-section reads, but runtime overclaims remain |
| Qwen 3.6, thinking on, two follow-ups | 8 → 3 | 1 → 0 | Thinking did not reliably improve accuracy; invalid hierarchy advice and type-count mistakes remain |
| Qwen 3.5, two follow-ups | 2 → 2 | 0 → 0 | One of two sessions per build invented observations without calling a tool: failures, not successes |
| Qwen 3.6, final general-usage retest | 2 → 2 | 0 → 0 | Unfiltered, but its answer still overstates empty-result evidence and recommends an unscoped search |

GPT used GPT-5.6 Sol/medium; Ollama used the already-installed `qwen3.6:35b-mlx` and `qwen3.5:27b`.
Ollama temperature/seed/context were 0/42/32768; thinking-off output cap 1800, thinking-on 6000.
Digests: Qwen 3.6 `1b50c6fdc2d4f75f94e6c19b49b20051bc6a7e73620d1ccdfc6687ec042ce754`;
Qwen 3.5 `7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e`.
No model downloads or global client-setting changes. Raw traces and unedited answers stay private.

The two errors shared by the original GPT pair sets were the intentional missing-object 404 and
an unsupported global source search. Completion is not correctness: some local-model answers violate
the four-call follow-up bound or misinterpret static evidence. Generic tiny samples still sometimes
select a low-salience graph; the final GPT retest did so and candidly reported no class candidates.
Explicit class-only requests worked better. Known-link answers were correct on both builds, but
candidate sometimes used an extra grep. There is no universal token, latency or correctness win.
For example, original-ten tool-result bytes were 161,068 → 157,580, while the two declaration
follow-ups grew from 3,015 → 20,155. These are tool-result bytes, not billable tokens or SAP traffic.

### Larger live checks and final review

- **118 read-only MCP checks**: 45 paired cases (90 calls) over namespaced classes, MAIN/local
  includes, DDIC metadata, three reference roots, five filters and two page limits; eight graph
  boundary traversals; twenty source/context/cache/permission controls. All passed.
- Main/candidate returned source/metadata and reference data are identical; only the intentional count label
  and paging guidance differ. Graphs remain absent on main. Blocked hierarchy still does not fetch
  data. Candidate narrow→warm-wide equals cold-wide; main still replays the narrow aggregate.
- Largest retained graph: **100 nodes / 100 edges / 8 expansions / 10 SAP sends** with explicit
  node, edge and expansion truncation. Successful metadata was **176,993 bytes**, not total traffic
  or peak RSS. All eight graph runs respected their bounds and reported unknown coverage, including
  untruncated runs. No source collection, SQL/data queries, SAP writes or BTP provisioning.
- **6,152 unit tests / 207 files** pass after the last fix. Typecheck, lint, policy validation,
  build, strict docs and file/schema budgets pass. The earlier 6,150-test full pass also passed.
  Default schema is 45,596 bytes; full opt-in is 71,859, below 72,000. No budget was raised.
- Nine tool snapshots differ only in descriptions from the original PR head `360b63e3`; existing
  input shapes, hyperfocused behavior and default-off containment remain intact. Forty-five offline
  ABAP/CDS differentials preserve reads and contract/error evidence; the synthetic parser benchmark
  also passes equality checks. Its timings under concurrent model work are not a latency claim.
- Final review covered the unpushed production diff, cache/source authorization boundaries,
  transport accounting, traversal caps, description-only snapshots and operator documentation.
  No additional confirmed core defect remains. Known-credential and private-artifact permission
  checks pass. Existing Biome/docs informational notices are unchanged.

Retain experimental/default-off status. Live BTP principal propagation/Cloud Connector, additional
SAP releases, SAML-only login and native unresolved-reference semantics remain explicit validation
limits. These tests do not establish production-wide correctness. Update PR #769; do not merge.
