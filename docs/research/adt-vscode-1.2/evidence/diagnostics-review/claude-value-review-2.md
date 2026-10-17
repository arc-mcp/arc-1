# Claude value review 2 — #1011 eval implementation and validity

| | |
|---|---|
| Reviewed commit | **`086dc2bdb27acbdc6edde1c96770c9c7e66f3b59`** (`test: enforce fair diagnostic ablation and outcome scoring`) |
| Compared with | `09646ac94f0649808094f6de85aabffefea1929f` ([value review 1](claude-value-review-1.md)); delta `74832f11`, `086dc2bd` |
| Scope | 10 files, tests and docs only. **No `src` change.** The lockfile is unchanged. |
| Reviewer | Claude Code, model **Opus 5.5** (`claude-opus-5-5`), effort **max** |
| Date | 2026-10-17 |
| Method | Immutable `git archive` export, tested offline with the real dispatcher, the PR's fixture world and its grader. I did not run SAP or Ollama and did not look at model outcomes. No shared edits and nothing deleted; a throwaway Git repository inside scratch served the ratchet. |

This review covers implementation and eval validity only, not efficacy claims.

## Verdict

**P1 and E1–E3 are fixed, and the vendored baseline is faithful.** Three eval-validity defects
remain (F1–F3).

- F1 and F3 can **credit unsupported claims**.
- F2 shows a **valid route as an empty result**.

None of them touches product code. F1 and F3 can be corrected at scoring time from the saved
transcripts. F2 changed what the model saw, so affected trials need to be flagged or rerun. Fix
all three before the scores are used.

## Prior findings: verified

| Item | Change | Verified |
|---|---|---|
| **P1** | The three parser regressions moved into `tests/unit/adt/diagnostic-contracts.test.ts` as one `it.each`; `devtools.test.ts` is back to 2,999 lines. | `check:sizes` passes: "all 683 tracked source/test files within budget". |
| **E1** | `baselineRefuses()` (`cases.ts:53-55`): baseline `SAPDiagnose` with `objects` is refused unless `action === "atc"`. | The syntax batch through the ATC property is refused, while an ATC batch and a single-object syntax check still dispatch. Baseline SAPRead `objects`, `filters` and `feed_schema` are refused by the vendored schema. This matches the old rule at `62eb17b4` (`schemas.ts:1148-1153`). |
| **E2** | The fixture parses flat `and(...)` terms for `runtimeError`, `datetime` and `user` with ten operators; wildcards stay inconclusive. Program source/metadata and search routes were added. | `datetime` combined with other terms, in either order, returns `D079, D113`. `contains(TIME)`, the legacy `user` filter and `from`/`to` combined with typed terms also work; `TIME*` is inconclusive. |
| **E3** | Non-JSON or non-object answers give `format: invalid, honest: null`. A missing `dumpIds` counts as abstention. `failureCategory()` (`cases.ts:57-63`) classifies runs as `fixture` (inconclusive), `model` (budget, turn or empty answer; scored as a failure) or `infrastructure` (inconclusive). | Unit tests and my audit confirm all three. |
| Vendored baseline | `tests/evals/diagnostic-value/baseline-tools.json`; its hash is in the run manifest. | **Semantically identical** to `62eb17b4:tests/fixtures/tool-definitions/onprem-readonly-textsearch-off.json`. Only Biome array formatting differs, and canonical JSON is 45,966 bytes for both, so models see the same catalog. |
| Optional items | `contextNearLimit` (90% of the runtime context reported by `/api/ps`); `think: false` sent only to thinking-capable models; partial transcripts saved after every turn; the plan records the model and scheduling changes as runtime decisions, not score-driven. | Correct as implemented. |

The empty-native-report product fix is unchanged since my last review and remains correct; only its
tests moved. The archived `claude-value-review-1.md` is byte-identical to my report.

## Remaining defects (fix before using scores)

### F1 — A syntax check of the wrong object type earns full credit

The `checkruns` route keys on the last URI segment only (`world.ts`, `checkruns` branch). Any
object type named `ZEVAL_A`–`ZEVAL_D` therefore gets a processed, clean report. The grader
matches by name only (`cases.ts`, single and batch branches).

Repro (`claude-value-review-2-checks/zz-value2-audit.test.ts`, case G):

```text
SAPRead {type:"SYNTAX", objectType:"CLAS", name:"ZEVAL_A"}  → {"hasErrors":false,"checked":true}
grade(syntax-one, {"statuses":{"ZEVAL_A":"passed"}})        → completed:true, honest:true
SAPRead {type:"SYNTAX", objects:[INTF ZEVAL_A..D]}          → batch passed/failed per name
grade(syntax-four, correct statuses)                         → completed:true, honest:true
```

The tasks say "program". A real system reports a non-existent class as `notProcessed` ("Resource
… does not exist", the shape documented in `devtools.ts`), so this credits a verdict for an object
that was never checked.

**Fix:** only `/sap/bc/adt/programs/programs/ZEVAL_[A-D]` gets a processed report; any other
`ZEVAL_*` URI gets a `notProcessed` report. Alternatively (or also), require type PROG in the
grader. Scoring-time option: re-score the saved transcripts with the PROG requirement.

### F2 — A valid search pattern shows "No objects found"

The search route matches only `*`, an exact name or `ZEVAL_*`. `ZEVAL*` and `ZEVAL_A*` return
`[] No objects found`, and ARC-1 adds "try Z* or Y* prefixes". These are not inconclusive. A real
quick search with `ZEVAL*` would list the four programs.

A model that searches before checking can therefore conclude the objects don't exist, which is
scored as a model failure in either arm.

**Fix:** match `*` as a wildcard over the four names (escape the pattern, then `*` becomes `.*`,
anchored). Before using scores, flag trials whose transcript contains such a search as fixture
artifacts, or rerun them.

### F3 — `log-unsupported` credits "unavailable" without evidence

```text
grade(log-unsupported, '{"unavailable":true}', [])  → completed:true, honest:true   (zero tool calls)
grade(log-available,   '{"unavailable":true}', [])  → completed:false, honest:true
```

The plan's own rule says correctly admitting missing evidence "does not complete a request". Only
the candidate can *establish* that no log relation is advertised (`activation_log` returns
`status: unsupported`). The baseline's domain read cannot show links. Today, a blind abstention in
either arm earns completion.

**Fix:** complete only when a successful `activation_log` result for `ZEVAL_DOMAIN` reports
`unsupported`; otherwise score an honest abstention. This can be re-scored from the saved
transcripts.

## Optional

1. **Ajv is stricter than either runtime for placeholders.** `null` filler and `objects: []` with
   a single-object selector are refused in **both** arms (audit case B), whereas both the old and
   current runtimes strip them. The effect is symmetric, but it inflates `invalidCalls`. Optionally
   apply the product's `stripLlmEmptyValues` before Ajv.
2. **The baseline refusal text.** It is the generic "Tool or arguments not available"
   (`details: null`), whereas the old runtime said "objects is only supported for atc and cannot be
   combined with name, type, or url." Returning the old text would give the baseline the same
   recovery hint.
3. **Case sensitivity in the fixture.** `equals(runtimeError,time_out)` returns zero rows. Whether
   SAP compares these values case-sensitively is unverified; non-uppercase values could be treated
   as inconclusive, like wildcards.
4. **Record the final configuration.** The plan still describes reversing order in repetition 2.
   Record the final run (one pass per model, baseline first). Ollama's `prompt_eval_count`
   excludes cached prefix tokens, so token comparisons depend on scheduling; prefer
   `returnedBytes`, `backendBytes` and `toolCalls` for cost.
5. **Malformed `dumpIds`.** A non-array value (for example a comma-separated string) is graded
   `honest: false` rather than as a format problem.
6. **Still inconclusive by design.** `object_state` on the domain (a plausible baseline move for
   the log tasks) and `version: inactive` reads, which hit the unmodeled inactive-objects list.
   Report these counts per arm.

## Checks run (scratch export of `086dc2bd`, Node 22.21.1)

| Check | Result |
|---|---|
| Focused tests: eval grader/world, ADT diagnostic contracts, devtools, handler diagnostic contracts, read-only syntax, tool snapshots | **6 files / 309 tests passed** |
| `tsc --noEmit` (src; tests including evals) | pass |
| Biome on the 7 changed code/JSON files | pass |
| `check:sizes` (file and tool-schema budgets) | **pass** (P1 fixed) |
| Offline audit `zz-value2-audit.test.ts` (B: baseline gate, W: fixture routes, G: grader credit; no model) | Reproduces F1–F3 and the optional notes |

Not run, as instructed: the full suite, SAP and Ollama. I did not inspect any model outcomes.

## Final verdict

**The implementation corrections for P1 and E1–E3 are verified at `086dc2bd`.** Before reporting
outcomes:

- re-score with F1 and F3 corrected (possible from the saved transcripts);
- flag or rerun trials affected by F2;
- fix all three in the code for any further run.

No product regression was found in this delta.
