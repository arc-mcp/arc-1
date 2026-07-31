# Tool-description optimization loop

> **Read this first.** Three review rounds found the benchmark's semantic oracle broken at
> progressively deeper levels. The current state is honest about what it measures, but it is **not**
> a validated gate. Everything below the "Open work" section is historical narrative, including
> results that were later retracted.

## Status

**Shipped to the tool surface** (documentation merit, no measured-improvement claim):

1. SAPWrite leads with its purpose instead of ~1,100 characters of payload hygiene.
2. `TTYP` added to SAPRead's type inventory — a supported type that was undocumented.
3. "rename" removed from the SAPWrite lead — no repository-object rename action exists.

**Benchmark: usable for coverage and large regressions only.** Its detection floor is ~7 cases
(measured: 153/149/153 on byte-identical input), which is larger than every delta this work
produced. It does not certify that a passing call would be accepted by the server.

## Open work before this is a gate

| # | gap | why it matters |
|---|---|---|
| 1 | **Schema validation is not semantic validation.** `safeParse` passes `SAPLint({action:"lint"})`, `SAPGit({action:"branches"})`, `SAPTransport({action:"remove_object", id})` and `SAPWrite` edit_method without type/source — all rejected by their handlers. | A "pass" does not mean the call works. Needs a semantic contract shared by handlers and benchmark. |
| 2 | **No dispatch normalization.** The bench skips the normalization `dispatch.ts` applies before validating, so lowercase types and `CLAS/OC` aliases can fail here though dispatch accepts them. | False failures. |
| 3 | **Coverage is narrower than the name suggests.** Only multi-valued `action`/`type` enums. Singleton modes (`SAPRead action=diff`), `SAPSearch.searchType`/`source`, and transport `target`/`summary` are unmeasured — one generic SAPSearch case exists. | Search-description regressions would not be caught. |
| 4 | **Some cases cannot be satisfied in one call.** `VERSION_SOURCE` needs a `versionUri` from a prior VERSIONS call; SAPLint/quickfix need raw source; `SAPGit.external_info` needs a URL; FUNC/INCL creates need the function group. | Multi-step work belongs in an agentic eval, not a forced single call. |
| 5 | **The optimizer ignores the measured nondeterminism.** One baseline run, one candidate run — with a 4-case spread on identical input, it can accept a regression or reject an improvement on noise alone. Needs paired repeated runs with a non-inferiority rule, or refusal of nondeterministic backends. | Automatic optimization is unsafe today. |

## What was fixed in the latest round

- **Multi-field oracle.** The scorer checked one discriminator, so `SAPWrite.type.CLAS` ("Create a
  global class…") scored a PASS for `{action:"delete", type:"CLAS"}`. Every SAPWrite type case now
  pins its implied action, with tests asserting no case pins an action contradicting its prompt.
- **Environment allowlist** instead of a prefix denylist, which had left `VCAP_SERVICES`,
  `TEST_BTP_ACCESS_TOKEN`, `NPL_*`, `GITHUB_TOKEN` and the AWS variables in place.
- **`--readonly`** filters by reachable target IDs, not tool names (23 write-action cases were
  surviving and dragging every comparison down by a constant).
- **Overclaims removed** from module headers, the schema-budget comment, and this document.

---

## The measured detection floor — and what it means for every result here

Three runs of the benchmark on **byte-identical input** (claude-haiku-4-5, 182 cases):

| | run 1 | run 2 | run 3 | spread |
|---|---|---|---|---|
| overall | 153 | 149 | 153 | **4** |
| SAPWrite | 33 | 30 | 34 | **4** |
| SAPContext | 6 | 6 | 4 | 2 |

sd ≈ 2.3; a two-sample comparison needs roughly **7 cases** to clear 2σ. `claude -p` exposes no
temperature control, which is the likely source.

**Every delta measured in this work is smaller than that.** The "+5 on SAPWrite", the "+5 overall vs
main", the "+3", the "−3 on SAPContext" — all inside the noise of a single run. They were reported
as findings; they are not.

The three "replications" of SAPWrite's +5 were also across three *different* corpora, so they never
were independent confirmations of one magnitude. A consistent direction is not a measured effect.

### What the harness is actually good for

- **Coverage** — 182/182 discriminator values scored, which nothing else in the repo provides.
- **Catching large regressions** — a description change that breaks a tool outright moves far more
  than 7 cases (deleting SAPRead's descriptions cost 3 on a 48-case subset; a real break is bigger).
- **Validity** — calls are scored against the same Zod schemas `dispatch.ts` runs, so a "pass" is a
  call the server would accept.

It is **not** an instrument for justifying a small win. To resolve a 3-case effect, run each arm 5+
times and compare means; the runners now say so and flag anything under 7 cases as below the floor.

### What ships, and on what basis

| change | basis |
|---|---|
| SAPWrite leads with its purpose instead of ~1,100 chars of payload hygiene | **Documentation.** Directionally positive in every run, never resolvable. |
| `TTYP` added to SAPRead's type inventory | **Documentation.** A supported type was undocumented. |
| "rename" removed from the SAPWrite lead | **Correctness.** No repository-object rename action exists. |

Reverted after measurement: the SAPRead disambiguation glosses (no effect, and justified by
mislabeled cases) and the SAPContext edit (negative in every run, and its premise was a misreading —
"before specs, reviews, explanations, or changes" already scopes "changes" under "before").

## STATUS: all benchmark numbers are WITHDRAWN

Two rounds of external review found the corpus unfit to measure with. A first audit quarantined 21
of 182 cases; a second — prompted by review pointing at handler source rather than at my SAP
knowledge — quarantined **21 more, for 42 of 182 (23%)**.

The second pass is the important one. It failed because the first audit checked cases against what I
believed the type codes meant, not against what the handlers do:

| case | expected | what the handler actually does |
|---|---|---|
| `SAPRead.type.COMPONENTS` | class methods/attributes | `getInstalledComponents()` — installed SAP software components |
| `SAPRead.type.AUTH` | a class's authorization checks | `getAuthorizationField()` — authorization-field metadata |
| `SAPRead.type.VARIANTS` | a named variant | expects the PROGRAM name |
| `SAPWrite.generate_behavior_implementation` | a BDEF | requires `type=CLAS` and a behavior-pool class |
| `SAPManage.change_package` | reparent a package | moves an OBJECT between packages |
| 12 of 14 `SAPGit` cases | class/package names | handlers require `repoId`, url, branch, commit message |

**Consequences:**

- Every reported number is void: 60.2%, 75.1%, 83.1%, and the +5/+3 deltas on SAPWrite.
- The "SAPGit is weak (64%)" finding was almost pure artifact — 12 of its 14 cases were invalid.
- Active coverage is now 140/182 targets, and `SAPGit` has 2 scored cases. The benchmark does not
  currently deliver the "100% discriminator coverage" it was built for.

**Before any number from this harness is quoted again:** rewrite the quarantined cases against the
handler contracts, replace the presence-based required-argument map with validation against the
runtime Zod schemas (a hand-written map produced both false passes and false failures), and re-run
both arms with zero unscored cases.

The shipped description changes now rest on documentation merit alone:

1. **SAPWrite leads with its purpose** rather than ~1,100 characters of payload hygiene.
2. **SAPContext states it is analysis-only** — it is read-only and previously advertised itself for
   "changes".
3. **`TTYP` added to SAPRead's inventory** — a supported type that was undocumented.
4. **"rename" removed** from the SAPWrite lead: no repository-object rename action exists.

The SAPRead disambiguation glosses were removed when they measured 33 → 33; that removal stands,
since their justification was mislabeled cases either way.

## CORRECTION: earlier results were measured against a broken oracle

Everything below the next heading was measured before an external review (Codex) found that the
generated corpus contained objectively mislabeled cases. A full manual audit confirmed it and
quarantined **21 of 182 cases (12%)**. Treat the older numbers as void.

The two failures used as the centrepiece of the "genuine cross-model surface defect" claim were
cases where **the model was right and the benchmark was wrong**:

| case | prompt | why it was unwinnable |
|---|---|---|
| `SAPRead.type.TRAN` | "Show me the objects in transport A4HK900123" | that is SAPTransport, not a transaction code |
| `SAPRead.type.DCLS` | "…the CDS data source ZDS_SALES_DATA" | a data source is DDLS, not access control |
| `SAPWrite.type.{DESD,DTSC,CSNM,DSFD,DTDC,DCLS}` | all "Create a CDS view…" | that is DDLS; the generator did not understand server-driven types |
| `SAPQuery` | "structure and fields for table T001" | that is `SAPRead(type=TABL)` |
| `SAPContext.type.{CLAS,TABL}` | duplicates of `action.deps` / `action.structure` | at most one of each pair can pass |

Two independent models agreeing on `DCLS→DDLS` was read as confirmation of a real defect. It was
evidence the oracle was wrong. **Cross-model agreement against your expected answer should raise
suspicion of the expectation first.**

Quarantined cases are retained in the corpus with a `quarantined` reason and excluded from scoring —
the prompt is still evidence about the surface, and deleting it hides the mistake.

## Corrected results (clean 160-case corpus, isolated CLI, claude-haiku-4-5)

The surface is in materially better shape than the contaminated runs suggested:

| tool | contaminated | clean |
|---|---|---|
| SAPWrite | "61%" | **81%** (30/37) |
| SAPRead | "71%" | **80%** (33/41) |
| SAPManage / SAPTransport / SAPActivate | 93–100% | **100%** |
| SAPDiagnose | 90% | 95% |
| SAPContext | 80% | **50%** (4/8) — genuinely weak |
| SAPGit | 69% | **64%** (9/14) — genuinely weak |
| **overall** | 75.1% | **83.1%** (133/160) |

"SAPWrite loses its own canonical requests" was substantially an artifact: SAPWrite carried 7 of the
21 bad cases. The two tools that are genuinely weak — SAPContext and SAPGit — are ones no effort went
into.

### A/B of the shipped changes vs `main`

HEAD 133/160 vs main's descriptions 130/160 (**+3**), built by materialising `main`'s actual handler
sources rather than reconstructing them:

| tool | main | HEAD | |
|---|---|---|---|
| SAPWrite | 27 | 30 | +3 — the reorder |
| **SAPRead** | **33** | **33** | **zero — the disambiguation glosses did nothing** |
| SAPContext | 5 | 4 | −1 |

So of the three shipped edits:

1. **SAPWrite leading with its purpose: kept.** +3 here, +5 on the contaminated corpus. Consistent in
   direction across two corpora, though +3 is barely above the ±2 noise floor — call it weak
   positive, not proven.
2. **SAPRead disambiguation glosses: REMOVED.** Zero measured effect (33 → 33), and the failures that
   motivated them were the mislabeled `DCLS`/`TRAN` cases. Both the evidence and the benefit
   evaporated. Only the genuine gap is kept: `TTYP` is a supported type that was missing from the
   inventory entirely.
3. **SAPContext read-only boundary: kept** on factual grounds (it is analysis-only and previously
   advertised itself for "changes"), at −1, inside noise at n=8.

Removing the glosses put description tokens back under the original 12,400 budget; only SAPWrite's
opening line needed a bump, 17,300 → 17,500.

### Placement beat wording

The first attempt at #3 put "to actually change an object use SAPWrite" early, and SAPContext fell
8/10 → 4/10 on the contaminated corpus — the model routed away from the tool on requests that
belonged to it. Same fact as a closing clause, and it recovered. Worth keeping as a design lesson
even though its measurement corpus was flawed.

---

# Earlier analysis (VOID — measured against the broken oracle, retained for the method)

## Applied changes and their measured effect

Three edits shipped, verified on `claude-haiku-4-5` over the full 181 cases.

**Overall 136/181 -> 140/181.** Per tool:

| tool | before | after | |
|---|---|---|---|
| **SAPWrite** | 27/44 (61%) | **32/44 (73%)** | **+5, replicated in two runs** |
| SAPDiagnose | 19/21 | 20/21 | +1 |
| SAPGit | 11/16 | 12/16 | +1 |
| SAPNavigate | 1/4 | 2/4 | +1 |
| SAPContext | 8/10 | 6/10 | -2 (accepted, see below) |

1. **SAPWrite leads with its purpose.** It used to open with ~1,100 characters of payload hygiene.
   This is the one change that moved the number, and it moved it on the largest and worst tool.
2. **SAPRead documents its look-alike codes.** `DCLS`/`DDLX`/`VIEW`/`TRAN` were bare tokens and
   `TTYP` was undocumented entirely; each now says what the object IS.
3. **SAPContext stops advertising itself for changes.** It is read-only.

### Placement beat wording

The first attempt at #3 put "to actually change an object use SAPWrite" early, and SAPContext fell
**8/10 -> 4/10** — the model routed away from the tool on requests that belonged to it. Same fact,
moved to a closing clause, recovers to 6/10. The residual -2 is inside the noise band at n=10 and is
accepted for the factual correction.

### This narrows the earlier conclusion

The section below concluded from qwen3.5:27b that description text is not the routing lever. On
Haiku a near-identical reorder is worth +5 on SAPWrite. The honest scope: **the ablation result is
qwen-specific, and description edits DO move the model ARC-1 actually ships to.** What survives is
that gains are small, specific, and require per-tool measurement — not that descriptions are inert.

## Cross-model result: routing is not improvable by editing tool definitions (qwen3.5:27b)

Two models, six interventions, one control. `qwen3.5:27b` (local, temp 0, seed 42) and
`claude-haiku-4-5` (via the authenticated CLI).

**Baselines:** qwen 109/181 (60.2%) · Haiku **136/181 (75.1%)**

| tool | qwen | Haiku |
|---|---|---|
| SAPManage / SAPTransport / SAPActivate / SAPSearch | 93–100% | **100%** |
| SAPDiagnose | 81% | 90% |
| SAPContext / SAPLint | 67–70% | 80–83% |
| SAPRead | 56% | 71% |
| SAPGit | 75% | 69% |
| SAPWrite | 25% | 61% |
| SAPNavigate | 25% | 25% |

SAPWrite's alarming 25% was largely a small-model artifact — on Haiku it is 61%. But four failures
reproduce **identically on both models**: `DCLS→DDLS`, `DDLX→DDLS`, `TRAN→SAPTransport`,
`TABLE_CONTENTS→SAPQuery`.

### Every intervention failed

| # | intervention | model | result |
|---|---|---|---|
| 1 | SAPWrite: hygiene to the end + explicit identity line | qwen | 13 → 13 |
| 2 | SAPWrite claims its ground + SAPContext drops "or changes" | qwen | 13 → 14 |
| 3 | SAPWrite description 3,684 → 450 chars | qwen | 13 → 12 |
| 4 | SAPRead: disambiguation glosses for every confused code | qwen | 27 → 28 |
| 5 | **Control: SAPRead descriptions REMOVED (−7,657 B, 77%)** | qwen | **27 → 24** |
| 6 | SAPRead: readable enum aliases (`DCLS`→`access_control`, …) | Haiku | 32 → 31 |

Experiment 5 explains 1–4: deleting essentially all of a tool's descriptive text costs ~3 cases in
48, so the prose was never carrying the routing signal. Experiment 6 then tested the obvious
follow-on — that the enum *token* is the lever instead — and it is not either.

**Nothing in the tool definition that can be edited measurably changes routing.**

### Two caveats that limit how hard this can be pushed

- **Run-to-run variance.** Stock SAPRead scored 34/48 and then 32/48 on identical inputs, because
  `claude -p` exposes no temperature control. With ~2 cases of drift, only effects of roughly **5+
  cases** were ever detectable. These are "no large effect" results, not "no effect".
- **The bench scores one right answer.** `TABLE_CONTENTS→SAPQuery` is counted as a failure, but
  reading table rows via SAPQuery is defensible; the agentic `tests/evals` suite has an
  `acceptable` tier for exactly this and the routing bench does not. Some portion of the 25% gap is
  bench strictness rather than defect. **Add an acceptable tier before treating 75% as a bug count.**

### What this means for 1.0

- **Do not spend 1.0 effort rewriting descriptions for quality.** Six attempts across two models and
  two mechanisms (prose, enum tokens) produced nothing.
- **Token reduction is the safe, worthwhile path** — the exact opposite of the initial assumption.
  Removing 77% of a tool's text cost ~3/48. Gate it on this bench and proceed.
- **If routing must improve**, the remaining lever is tool-boundary surgery, not wording: SAPRead
  discriminates 49 types and SAPWrite 14 actions × 30 types from one schema. That is an API-shape
  decision, and it should be prototyped behind this benchmark before 1.0 freezes the surface.

## Earlier single-model analysis (superseded by the cross-model table above)

Five experiments on the fixed instrument, `qwen3.5:27b`, temp 0, seed 42:

| # | experiment | cases | result |
|---|---|---|---|
| 1 | `sapwrite-lead` — hygiene moved to the end + explicit identity line | 30 | 13 → 13 |
| 2 | `sapwrite-plus-context` — SAPWrite claims its ground, SAPContext drops "or changes" | 30 | 13 → 14 |
| 3 | `sapwrite-minimal` — description 3,684 → 450 chars | 30 | 13 → 12 |
| 4 | `sapread-disambiguated` — glosses for every confused type code (+919 B) | 48 | 27 → 28 |
| 5 | **`sapread-ablated` — descriptions REMOVED (−7,657 B, 77% of the tool)** | 48 | **27 → 24** |

Experiment 5 is the control that interprets the other four. Deleting essentially all of SAPRead's
descriptive text costs about **three cases**. So the prose was never carrying much routing signal:
the tool **name** and the **enum values** do nearly all the work, and rewriting the text — longer,
shorter, reordered, or disambiguated — cannot move a number it barely controls.

That is why four unrelated rewrites all landed inside noise. Not one bad hypothesis; the wrong lever.

### What this means for 1.0

- **Quality cannot be fixed by rewording.** SAPWrite's and SAPRead's real routing weaknesses are
  not editorial problems. Improving them means structural change: clearer enum *values*, fewer
  types per tool, or splitting SAPWrite — not better sentences.
- **Reduction is far safer than feared.** Removing 77% of a tool's descriptive text cost ~3/48 on a
  mid-tier model. The token-savings goal is much less risky than the "descriptions dominate
  selection" literature implies — though it should be re-measured per tool rather than assumed.
- The two goals stop competing. They were both aimed at the wrong target.

### Caveats that matter before acting on this

- **One model.** `qwen3.5:27b` only. The tool-interface literature reports that descriptions
  dominate selection, and this contradicts it — which is itself a reason to suspect model
  specificity. Claude is ARC-1's primary consumer and Haiku confirmation is still owed.
- A −3 effect at n=48 (SE ~7 pp) is *small*, not *zero*. This rules out descriptions being the
  dominant factor here; it does not license stripping them in production.
- Single-turn routing only. Descriptions plausibly matter more for multi-step recovery, argument
  construction, and avoiding destructive mistakes — none of which this bench scores.

### Statistical power: what these samples can and cannot show

At n=30 with a ~46% baseline the standard error is ~9 pp, so only a difference of roughly **6 cases
or more** is distinguishable from chance. The "±2 noise" band used in the runners is a floor for
obvious junk, not a significance test. Every "no effect" below therefore means *no effect larger
than ~6 cases* — it does not establish that wording is irrelevant.

This is why the SAPRead experiment matters more than the SAPWrite ones: 48 cases, and a fix aimed at
specific repeated confusions rather than at general framing. If the glosses work, the effect should
be large enough to see.

### Measured (on the broken instrument): the positional theory looked wrong

The diagnosis above predicted that fixing position and territory would fix SAPWrite's routing. It
did not. On 30 sampled SAPWrite + SAPContext cases (qwen3.5:27b, temp 0, seed 42):

| variant | pass | SAPWrite | SAPContext |
|---|---|---|---|
| stock | 13/30 | 10 | 3 |
| `sapwrite-lead` — hygiene moved to the end **and** an explicit identity line added | 13/30 | 10 | 3 |
| `sapwrite-plus-context` — both sides: SAPWrite claims its ground, SAPContext drops "or changes" | 14/30 | 11 | 3 |

+1 case is inside the ±2 noise band. Moving the hygiene block, stating the tool's identity first,
and disarming the competing description **changed nothing measurable**. The theory was well supported
by the literature and by an obvious-looking diff, and the benchmark refuted it — which is the whole
reason to have the benchmark.

The cases are not at fault: they read "Create a new global class ZCL_ORDER_MANAGER in package $TMP",
"Delete the ZCL_PAYMENT_VALIDATOR class", "Move calculate_total from private to protected". If those
do not route to SAPWrite, the wording is not the variable.

(One genuine case-design flaw: `scaffold_rap_handlers` and `generate_behavior_implementation` both
generated "Generate behavior implementation for ZBDEF_…", which are indistinguishable. SAPWrite's
ceiling is 43/44, not 44/44.)

**Next hypothesis under test:** SAPWrite is not mis-framed, it is overwhelming — 3,684 characters of
per-type reference at selection time. `sapwrite-minimal` cuts the description to 450 characters
(−3,294 B) while keeping identity, boundaries, and a pointer to the parameter descriptions where the
detail already lives. If that wins, quality and size stop pulling in opposite directions for this
tool, and the per-type wall belongs on the parameters rather than the tool.

### The ceiling is ~178/181, not 181

Three case pairs are unanswerable because the tool surface genuinely aliases them — at most one of
each pair can ever pass:

| pair | why |
|---|---|
| `SAPWrite.type.SKTD` / `SAPWrite.type.KTD` | KTD is a documented alias of SKTD |
| `SAPRead.type.MSAG` / `SAPRead.type.MESSAGES` | MESSAGES is a deprecated alias of MSAG |
| `SAPWrite.action.scaffold_rap_handlers` / `.generate_behavior_implementation` | both generate RAP behavior handlers |

They are kept rather than deleted: a pair the generator cannot tell apart is evidence that two enum
values are not distinguishable from a user request either, which is a design signal about the
surface, not a defect in the bench.

### Read the baseline before trusting the gate

Generated cases use the natural SAP noun for the target — "report" for `PROG`, "function group" for
`FUGR`, "interface" for `INTF`. That is genuinely how developers phrase it, but it means the noun
often maps 1:1 onto the enum value, and the enum value alone can carry the routing decision without
the description contributing anything.

**So the baseline number is itself a diagnostic:**

- Baseline near 100% → the bench has no headroom to detect a regression. It will green-light
  aggressive compression it cannot actually judge. Treat those tools as ungated and lean on the
  agentic suite plus hand review.
- Baseline ~70–90% → informative; regressions have room to show.
- A tool at 0% → suspect the generated cases, not the description. Read them before concluding
  anything.

The per-tool breakdown in `routing-bench.ts run` exists for exactly this triage.

### Other honest caveats

- Prompts are generated **from the current descriptions**, so they inherit that vocabulary. This
  measures "does a rewrite preserve the routing the original achieved", not "is the original good".
- Single-turn only. It cannot see error recovery or multi-call sequencing — that is what the agentic
  suite is for.
- Generation is resumable by construction (writes after every case, skips ids already present). The
  first run threw at case 120 of 182 on undici's 300 s headers timeout and lost all 120; a reasoning
  model can exceed that on a single completion, so `complete()` sets an explicit 15-minute timeout.

## Cost and concurrency

A 182-case gate run sequentially takes ~15 minutes, and the loop runs dozens of them — that is the
difference between impractical and merely slow. `runBench` uses a fixed worker pool (`BENCH_CONCURRENCY`,
default 4, matching ollama's default `OLLAMA_NUM_PARALLEL`); going wider than the server's own limit
only queues. Failures are re-sorted into case order afterwards so two runs diff cleanly.

Case **generation** is the slow one-time step (~45 min): it sends each tool's full JSON — SAPWrite is
21 KB — once per enum value, to a reasoning model. If it needs regenerating often, pass only the
description slice for the target value instead of the whole tool.

## Running it

```bash
npx tsx scripts/routing-bench.ts gen                       # once — writes tests/evals/routing-cases.json
```

```bash
npx tsx scripts/routing-bench.ts run --model qwen3.5:27b   # baseline a model
```

```bash
npm run optimize:descriptions -- --model qwen3.5:27b --rounds 3
```

**Model floor: Haiku class or above** (qwen3.5:27b, qwen3:30b, gemma4:31b, qwen3.6:35b-mlx). An 8B
model fails cases for reasons unrelated to wording, which turns the gate into noise.

Overnight sweep:

```bash
for m in qwen3.5:27b qwen3:30b gemma4:31b; do npm run optimize:descriptions -- --model "$m" --rounds 3 --out "test-results/desc-opt/$m.json"; done
```

## Before shipping a trimmed surface

1. Re-score on a second model — a rewrite tuned to one tokenizer's quirks does not always transfer.
2. `npm run test:eval -- --provider claude-code` — real client, real native-tool competition.
3. Hand-diff the overlay. A green gate is a floor, not proof: the SAPTransport episode is what a
   clean-looking number hides. Look specifically for dropped syntax, locking rules, and
   destructive-action warnings the bench never scores.
4. Regenerate the frozen surface and lower the budgets in the same commit:

```bash
npx vitest run -u tests/unit/handlers/tool-definitions-snapshot.test.ts && npm run check:sizes
```

## Sources

- [Anthropic — Writing effective tools for AI agents](https://www.anthropic.com/engineering/writing-tools-for-agents) · [Define tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools)
- [Looking Is Not Picking: An Attention-Segment Account of Tool-Selection Failures](https://arxiv.org/pdf/2606.16364)
- [ToolTweak: An Attack on Tool Selection in LLM-based Agents](https://arxiv.org/html/2510.02554) (description dominance over names)
- [TSCG: Deterministic Tool-Schema Compilation](https://arxiv.org/pdf/2605.04107) · [ToolSandbox](https://arxiv.org/pdf/2408.04682) (schema-component ablations)
- [Notation Matters: Token-Optimized Formats in Agentic AI](https://arxiv.org/html/2605.29676v1) (compression/accuracy tradeoffs)
- [Pydantic — engineering MCP tools for token efficiency](https://pydantic.dev/articles/engineering-mcp-tools-for-token-efficiency) · [StackOne](https://www.stackone.com/blog/mcp-token-optimization/) · [The New Stack](https://thenewstack.io/how-to-reduce-mcp-token-bloat/)
- [MCP 2026-07-28 spec release](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/) (`ttlMs` — HTTP caching, not token reduction)
