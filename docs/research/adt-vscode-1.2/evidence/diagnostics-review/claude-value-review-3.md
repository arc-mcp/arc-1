# Claude value review 3 — final evidence and patch verification

| | |
|---|---|
| #1011 commit | **`5d5c7824d66eba048baafe6d30d5efb06b437205`** (`docs: record diagnostic value limits and model outcomes`) |
| Delta since value review 2 (`086dc2bd`) | `52c62317` grader/fixture fixes, `552b02c3` argument hints, `5d5c7824` report and evidence |
| #1019 commit | **`bb984bd419040551d5dd6ab50ad0d9d7e4e6bfc7`** on base `79088b16c6fe64f2b07802646a769607335f4d5d` |
| Reviewer | Claude Code, model **Opus 5.5** (`claude-opus-5-5`), effort **max** |
| Date | 2026-10-17 |
| Method | Immutable `git archive` exports, read in scratch. Evidence ZIPs were read in memory only. No models, SAP, GitHub actions or shared edits, and no full suite; scratch is kept. |

## Verdict

**No blocking issue for either PR.**

- **#1011 eval:** F1–F3 are fixed. The case table and the specific exclusions you asked about match
  the archived evidence. All 57 adjudicated rows re-grade identically with the committed grader,
  and every number I checked reproduces exactly. The report does not overstate benefits, but it
  omits one negative observation (R1); I recommend adding that sentence.
- **#1019:** a faithful, minimal extraction. Approve.

## F1–F3 and harness corrections

| Item | Change | Verified |
|---|---|---|
| F1 wrong-type credit | The fixture returns `notProcessed` ("Resource does not exist.") for any non-program URI. The grader requires a PROG check of the named object, for both verdicts and honesty. | Unit tests; all 57 rows re-grade identically |
| F2 search | Anchored, escaped `*` wildcard | Unit test |
| F3 unavailable credit | Completion requires a successful `activation_log` result of `unsupported` for `DOMA ZEVAL_DOMAIN`. A message must equal the returned `reason`, and an earlier argument error never counts. | Rule read in `cases.ts`; matching rows below |
| Baseline refusal | Production `normalizeTypeArgsForValidation` runs **before** Ajv and the guard. The guard returns the old runtime's exact text. | The `objects: []` placeholder is stripped, while the ATC-property batch is still refused (unit test) |
| Supplied source | A check carrying `<chkrun:artifacts>` is flagged `unsupported` (inconclusive) instead of being given a stored-source verdict. | Unit test |
| Post-failure hints (`552b02c3`) | Three text-only changes: the `activation_log` arguments, a `dumps` filter example, and a `feed_schema` pointer in the filter error. Snapshots were updated. | Small. Initial and follow-up results are kept as separate runs in the adjudication, and the report labels the follow-up as post-feedback. |

## Evidence audit

**Archive integrity**

- All 131 archive members match their manifest SHA-256 hashes:
  - `initial-comparison.zip`: 68
  - `confirmation.zip`: 34
  - `exploratory-runs.zip`: 29
- Of the 57 adjudication rows:
  - **46** match their raw trial `answer` and full trace exactly.
  - **11** (Qwen 3 "reviewed") are verbatim extractions of the final JSON after `</think>`, with
    identical traces.
- The adjudication's grader hash (`08cd07a4…`) equals the committed `cases.ts`. Re-running
  `grade()` over every row reproduces all 57 recorded `finalAnswerGrade` results.

**Case table (32 cells: Qwen initial and Llama follow-up)** — every cell matches its row's
outcome, call count and qualification. The specific items you asked about:

- **Three supplied-source exclusions:** the initial Llama run's baseline `syntax-four`, baseline
  `syntax-missing` and candidate `syntax-missing`. Each passed `source:"active"` with
  `version:"active"`, and the old fixture returned stored-source verdicts. The two follow-up
  baseline cells with the same pattern are flagged by the final fixture and shown as "Inc."
- **Placeholder exclusion:** initial Llama baseline `dumps-target`. Its call carried `objects: []`
  filler, the old guard refused it, and production would have stripped it. The trial is
  inconclusive; the follow-up normalizes first.
- **Unsupported-log reason:**
  - The Llama follow-up candidate passes with one successful `activation_log` call returning
    `unsupported`, and its answer quotes that exact reason.
  - The Qwen candidate fails because every `activation_log` call failed validation and its
    message reuses an argument error.
  - *Nit:* that row's review note says "Correct unavailability". Unavailability was never
    established, although the outcome is correctly scored as a failure.
- **False proof:** in the Llama follow-up candidate `log-freshness` row, the tool returned
  `activationTime: null` and `correlation: "not-established"`. The answer says
  `latestAttempt: "proven"`, so it is honest:false, not completed, and shown in bold in the table.
- **Initial Llama summary:** "one supported outcome per arm" (baseline `syntax-one`, candidate
  `dumps-recent`) and "four baseline and one candidate inconclusive" are both correct.

**Numbers reproduced**

- Catalog: **45,645 → 46,696 bytes (+1,051, 2.3%)**.
- Dumps: 120 rows (14,387 bytes) → 2 rows (227 bytes) with the typed filter.
- Exploratory four-object check: 4 calls / 262 bytes → 1 call / 1,143 bytes.
- The Qwen 3.6 control invented `0001`–`0003` with zero tool calls.
- Fixture/grader coverage: 26 tests.

## Overstatement check

The decision (hold #1011 as a draft; #1008, #1016 and #1019 first), the per-addition limits and
the disclaimers (no overall percentage, productivity, reliability, release coverage or hosted-model
claim) all follow from the evidence.

**R1 — add the missing negative observation (recommended, not blocking).** In **both** Llama
passes, the simplest existing task — one stored syntax check — passes in the baseline arm and
fails in the candidate arm:

- **Initial run:** baseline `SAPRead {type:"SYNTAX", objectType:"PROG", …}` succeeds; candidate
  `SAPRead {action:"syntax", type:"PROG", …}` is refused.
- **Follow-up:** the same pattern.

The candidate `syntax-four`/`syntax-missing` cells fail the same way. The table shows the follow-up
cell, but neither the narrative nor the batch-syntax recommendation mentions that the candidate
catalog coincided with a regression on an existing route for this model. At temperature 0 this is
one deterministic observation, not proof of cause.

Suggested sentence: "With the candidate catalog, Llama repeatedly blended `SAPRead` and the
`syntax` action and failed the single-object task it passed in the baseline. Any future iteration
must show no regression on existing routes."

**R2 — wording (optional).** "Demonstrates specific benefits from batching" rests on one Qwen 3
trial and one exploratory Qwen 3.6 trial. Qwen 3's baseline failure came from `objectType` and
`type` confusion that consumed the ten-call budget. "Observed" fits better. The recommendation row
itself is already appropriately narrow.

**R3 — optional.** In the follow-up, Llama copied the new `dumps` description example
(`values=[MESSAGE_TYPE_X]`) as an *attribute* name. That example would ship with #1011, so note it,
or reconsider the example, before any re-evaluation.

## #1019 review (`bb984bd4`)

| Check | Result |
|---|---|
| Scope | `src/adt/devtools.ts` (+4/−1), new `tests/unit/adt/empty-syntax-report.test.ts` (4 public `syntaxCheck` cases), a three-line `tools.md` note |
| Parser visibility | `parseSyntaxCheckResult` stays private (`devtools.ts:1021`). Its body is identical to #1011's apart from the `export` keyword. |
| Fail before, pass after | On base `79088b16`, the new file gives **2 failed** (both empty envelopes) and **2 passed** (legacy `<checkMessages/>`, processed native report). At the head, 4/4 pass. |
| Focused tests (head) | **8 files / 382 tests passed**: empty-report, devtools, UIAD check, read-only syntax, structure syntax, write UIAD, server-driven routing, lint diagnose |
| Gates | `tsc` (src and tests), Biome, strict docs build, file-size ratchet (652 files) and tool-schema budget: pass |
| Dependencies | `package.json` and lockfile differ from my installed set only in the version fields |

The other callers are unchanged in outcome, as I reported for #1011: the write-path checks return
`''` either way, and UIAD already required exactly one report. **Approve.**

## Pre-existing observations (not part of either PR)

- `objectBasePath()` falls back to the program route for unknown types. `object_state` with
  `type:"DOMAIN"` therefore queried `/programs/programs/ZEVAL_DOMAIN` (the same at `62eb17b4`).
  Rejecting unknown types would be clearer.
- The legacy SAPDiagnose rules reject strict-client filler on unrelated fields, for example
  `includeReportXml:false` and `packages:[]` on `dumps`. The follow-up Llama baseline
  `dumps-target` exhausted its budget on these. This is the same client class as review-1 M1 and
  could join FEAT-89.

## Checks run

| Check | Result |
|---|---|
| #1011 focused tests: eval grader/world (26), ADT and handler diagnostic contracts, snapshots, key sync, Zod/JSON parity, multi-target | **7 files / 198 tests passed** |
| #1011 gates: `tsc` (src and tests), Biome (changed files), strict docs, ratchet (683 files), tool-schema budget | pass |
| Evidence: manifest hashes, rows against raw trials, full re-grade (`claude-value-review-3-checks/`) | 131/131 hashes, 57/57 rows, 57/57 grades |

## Limitations

- I re-ran no models. Model behavior is taken from the archived transcripts.
- Codex's full-suite and combined-tree figures are as recorded; I did not rerun them.
- No SAP. The fixture's limits are as the report states.
- Node 22.21.1.

## Final verdict

**#1011 at `5d5c7824`:** F1–F3 are verified, the evidence and case table are accurate, and there
are no blockers. Add R1 to the report. R2 and R3 are optional, and holding the bundle remains the
right call.

**#1019 at `bb984bd4`:** approve.
