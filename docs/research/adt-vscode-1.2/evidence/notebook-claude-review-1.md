# Claude review 1 — arc-mcp/arc-1 PR #1009 (bounded SQL notebook import and execution)

| | |
|---|---|
| PR | https://github.com/arc-mcp/arc-1/pull/1009 (draft, stacked on PR #1008) |
| Reviewed head | **`ce1537fcab0b3d786a2b13ad1923378ec2beb111`** (`feat: add bounded SQL notebook import and execution`, the only commit) |
| Base | `56c1d5186f3f3d48f134842ef11f2b19a15e5c6b` (PR #1008 docs head; contains the reviewed `f7598c33`) |
| Head verified | The shared checkout `/Users/marianzeis/.codex/worktrees/adt-next-stages/arc-1` is clean at `ce1537fc` on `codex/sql-notebook-runner`. |
| Reviewer | Claude Code, model **Opus 5.5** (`claude-opus-5-5`), effort **max** |
| Date | 2026-10-17 |
| Method | Read-only. I read the 24-file diff and the code the notebook depends on: SAPQuery, data-preview parsing, IN-list chunking, the dispatcher context, the CLI runtime and the safety messages. I reviewed `git archive` exports of head and base in scratch space; the lockfile is unchanged, so I reused installed dependencies. No checkout, SAP system, credential, setting, commit, remote or PR was touched. No live SAP calls. |
| Read | `AGENTS.md`, `docs_page/roadmap.md`, `docs/plans/2026-10-17-adt-followups.md`, `docs/research/2026-10-17-sql-notebook-validation.md`, `docs_page/sql-notebooks.md`, the CLI guide, the transport pilot notes and evidence JSON |

Line numbers refer to `ce1537fc`.

## Verdict

**Approve, with three small fixes recommended before marking ready (F1–F3). There are no must-fix
items.** I found no false `success`, no result-string alteration, no policy bypass and no
unbounded work.

The core contract holds:

- **Import is pure.** There is no CLI-wide hook; the import action never touches the runtime. A
  fresh import reproduces the shipped example's IDs and SQL cell exactly, and unknown fields stay
  inert.
- **Validation comes before SQL.** Every cell's target and assertion are checked before any SQL
  runs.
- **Policy is reused.** Only SAPQuery is called, through the existing dispatcher and its
  SQL/data/deny gates.
- **Strings are exact.** The XML parser keeps tag values as strings without trimming, and
  assertions compare exactly.
- **Uncertain results never pass.** A saturated page, malformed metadata or a multi-row "scalar"
  is never `success` or `passed`.
- **Cancellation works end to end.** I confirmed it through the real dispatcher, which the PR's own
  cancellation test does not cover.
- **Artifacts are private and never overwrite** existing files.

The findings are about status labels, one CLI ordering problem and one size edge case.

| # | Severity | Finding | Recommendation |
|---|---|---|---|
| F1 | Medium-Low | `SAP_BLOCKED_DATA_SOURCES` refusals are reported as `error`, not `blocked` | Fix (one regex) |
| F2 | Low-Medium | `notebook run` reserves the output directory before validating; a rejected document leaves an empty directory that blocks the retry | Fix (reorder) |
| F3 | Low | A valid import close to 1 MiB writes a document that `notebook run` refuses as oversized | Fix (size check) |
| F4 | Low (design) | When `totalRows` is present, a short aggregate/DISTINCT detail result is never `complete` | Document, or decide |
| F5 | Low | ARC-1's own response-size limits are labelled `error`, but the docs say limits mean `incomplete` | Optional |
| F6 | Low | Test gaps: cancellation through the dispatcher, the 5-minute deadline, F1–F3 | Add regressions |
| F7 | Nit | Dead `truncated`/`complete` result fields; `__proto__` key dropped; raw Zod dump for a fractional `rowNumber`; `startedAt` on not-run cells | Optional |
| F8 | Info | Assertion SQL analysis costs up to ~1 s per 64 KiB assertion (existing analyzer), run twice | None |

---

## Findings

### F1 — Data-source blocklist refusals are labelled `error` instead of `blocked` (Medium-Low)

**Where.** `src/workflows/artifact.ts:9` (the shared `WorkflowCallError` classifier) and
`src/workflows/sql-notebook.ts:120-126`.

The classifier recognises `blocked by safety`, `Insufficient scope`, `denied by server policy` and
`not allowed by … policy`. A data-source policy refusal (`DataSourcePolicyError`) reads
`DATA_SOURCE_BLOCKED: request denied before data execution …`, or in minimal-error mode
`… denied by the administrator's data-source policy …`. Neither matches, so the notebook cell
becomes `error`.

`docs_page/sql-notebooks.md` defines `blocked` as “Existing ARC-1 policy refused the call” and
`error` as “Backend failure or malformed/contradictory evidence”. An operator reading the report is
therefore told a SAP backend failed when ARC-1's own policy refused the call. The same applies to
`DATA_POLICY_UNAVAILABLE` and `DATA_SQL_UNSUPPORTED`. The run is still `partial`, so this is a
mislabel, not a false success.

**Reproduction** (`claude-review-1-checks/zz-nb-review.test.ts`, R8): a real
`DataSourcePolicyError.clientMessage(false)` and `clientMessage(true)` → cell statuses
`["error","error"]`, while an `SAP_DENY_ACTIONS` refusal → `blocked`. Also
`claude-review-1-checks/classify.mts`.

**Suggested fix:** extend the regex, for example with
`|request denied before data execution|denied by the administrator's data-source policy`, or match
the `DATA_(SOURCE_BLOCKED|POLICY_UNAVAILABLE|SQL_UNSUPPORTED):` prefix. The classifier is shared, so
transport-review checks benefit too.

### F2 — `notebook run` reserves the output directory before validating the document (Low-Medium)

**Where.** `src/workflows/notebook-cli.ts:48-52`: read, resolve config,
`reserveArtifactDirectory(opts.outputDir)`, then `runNotebook(...)`. `runNotebook`
(`sql-notebook.ts:74-81`) throws on schema, mapping or assertion-shape errors. When it does, no
evidence is written, but the new directory remains.

**Reproduction** (R1, real `main()` with mocked dependencies; nothing is dispatched): `--target
other` → exit 2 with `No authorized connection mapped to dev.`, leaving the directory empty. The
corrected rerun with `--target dev` and the same `--output-dir` → exit 2 with `EEXIST: file
already exists, mkdir …`.

The docs promise that each run creates `evidence.json` and `report.html` in a new directory.
Instead a rejected document leaves an empty “reserved” directory and the user must choose another
name.

**Suggested fix:** run the pure prevalidation (schema, target mapping, assertion shape) before
reserving the directory. For example, split `runNotebook` into `validateNotebook(input, targets)`
plus execution, or call the schema and target checks in the CLI first. Reservation still happens
before any SQL.

### F3 — An import near 1 MiB produces a document that `notebook run` refuses (Low)

**Where.** Import caps the *compact* source at 1 MiB (`notebook-document.ts:84-88`), then writes
*pretty-printed* JSON with added `id`/`target`/`maxRows`/`imported` fields
(`notebook-cli.ts:39`). `run` caps the *file size* at 1 MiB (`notebook-cli.ts:14`).

**Reproduction** (`claude-review-1-checks/import-size.mts`): a valid 50-cell `.abapsql` of
1,047,561 bytes imports successfully into a 1,055,142-byte document. That is over 1,048,576, so
`notebook run` rejects it with “Notebook must be a regular file of at most 1 MiB.” A 1,040,061-byte
source still works (1,047,642 bytes).

**Suggested fix:** refuse the import when the serialized output exceeds `MAX_NOTEBOOK_BYTES`
(one check before `writeFile`), or write compact JSON.

### F4 — Detail completeness ignores a short result whenever `totalRows` is present (Low, design trade-off)

**Where.** `src/workflows/notebook-query.ts:38-46`. For non-scalar results:
`complete = totalRows !== undefined ? totalRows === rows.length : rows.length < maxRows`.

**Reasoning.** SAP's `totalRows` is not always an output-row count. The PR's own 758 fixture shows a
scalar `COUNT` returning one row with `totalRows` 0 or 40, the matched input records. The PR
special-cases only the single-column `COUNT/SUM/AVG/MIN/MAX … AS alias` shape. If SAP reports
matched input records for other shapes, such as several aggregates without `GROUP BY`
(`SELECT MIN( x ) AS lo, MAX( x ) AS hi …`) or `DISTINCT`, then a complete result is labelled
`incomplete`, even though SAP returned fewer rows than requested. The live `GROUP BY` run did report
`success`, so `GROUP BY` appears to count groups.

I could not verify SAP's semantics for these other shapes without SAP. R3 shows the rule with
synthetic replies: 1 of 20 rows with `totalRows` 40 → `incomplete`; 18 of 20 with `totalRows` 400
→ `incomplete`; the same 18 rows without `totalRows` → `success`. Because SAP never returns more
than `rowNumber` rows, `rows.length < maxRows` alone is strong completeness evidence. The PR's
stricter rule additionally guards against an unknown server-side shortfall.

**Recommendation:** keep the conservative rule, but say in `sql-notebooks.md` that
multi-aggregate/DISTINCT detail cells may report `incomplete` and should use a scalar assertion.
Alternatively, decide deliberately to accept `rows.length < maxRows` as sufficient. Either way, no
false `success` is possible today.

### F5 — ARC-1 response-size limits are labelled `error` (Low)

**Where.** `artifact.ts:18` and `sql-notebook.ts:120-126`. Two limits end as `error`:

- the server's data-preview byte cap (dispatch returns `DATA_RESPONSE_TOO_LARGE … Submit a new
  request with lower maxRows …`);
- the 4 MiB workflow reply cap (`Tool output exceeds workflow input budget.`).

The docs say `incomplete` covers “limited/unknown rows … or collection limit”, and these are size
limits rather than backend failures. Reproduced in R4. The run is `partial` either way; this is
only the label.

### F6 — Test gaps (Low)

- **Cancellation through the dispatcher:**
  `tests/unit/workflows/notebook-cancellation.test.ts:43-45` calls
  `client.runQueryWithMetrics` directly, so it never exercises the dispatcher's context inheritance
  (`dispatch.ts` passes `signal ?? inherited?.signal` into its request context, which the
  data-result scope hands to HTTP). My R2 shows the real path works: with `handleToolCall(...,
  'SAPQuery', ...)` against a stalled local SAP, the socket closes, there is 1 POST, and the cells
  end `["incomplete","not-run"]`. Worth committing as a regression.
- **Five-minute run deadline:** no test covers its composition.
- F1–F3 above have no regressions yet.

### F7 — Nits

- **Dead fields:** `notebook-query.ts:12-13` accepts `truncated`/`complete` flags that SAPQuery
  never emits (only `rowLimitClamped`, which cannot occur at ≤ 10,000 rows). The “explicit
  truncation” tests feed synthetic flags. Either drop the fields for simplicity or comment that they
  are forward-compatibility only.
- **Dropped key:** a source key named `__proto__` is dropped from `imported` (no prototype
  pollution, verified). The docs say unknown fields are preserved.
- **Fractional `rowNumber`:** a value like 2.5 fails import with a raw Zod JSON dump
  (`notebook-document.ts:75`). Flooring it or giving a short message would be friendlier.
- **`startedAt` on not-run cells:** cells that never ran still get a timestamp
  (`sql-notebook.ts:142`), which reads as if they started.

### F8 — Info: assertion SQL analysis cost

`assertScalarAggregate` calls the existing `analyzeSqlDataSources`. For a 64 KiB assertion with
5,400 predicates, analysis takes about 1.0 s (16 KB: 0.45 s; 32 KB: 0.58 s), while masking takes
about 2 ms. It runs at prevalidation and again when parsing each single-column result. The 1 MiB
document cap limits the worst case to about 16 such cells. No action needed.

---

## Edge cases checked and found sound

- **SQL shapes the scalar gate rejects:**
  - `"` and `*` comments;
  - `;` multi-statements;
  - `INTO @DATA(...)`;
  - host variables;
  - subqueries;
  - `GROUP<tab>BY`;
  - `FIELDS` syntax;
  - `GROUP BY` after a doubled quote inside a string (`'it''s'`).
- **SQL shapes it correctly accepts:** `GROUP BY` text inside a literal, backquoted literals, joins
  with `COUNT( DISTINCT a~id )`, and `ORDER BY`.
- **No false pass through chunking:** an assertion split into two rows by SAPQuery's IN-list
  chunking is `incomplete`. `executeDataPreviewStatements` requests the remaining rows per chunk,
  so a truncated chunk fills the cap and a chunked short result cannot be falsely complete.
- **Zero rows:** a zero-row detail result with `totalRows: 0` is `success`. Column metadata comes
  from the result's column descriptors, independent of the rows.
- **No silent row clamp:** SAPQuery's row ceiling is 10,000, the notebook's maximum, so
  `rowLimitClamped` cannot occur.
- **Input hardening:** prototype pollution, FIFOs, devices, directories, invalid UTF-8 and files
  over 1 MiB are refused before parsing; a UTF-8 BOM is tolerated.
- **Output files:** written with `wx` and `0600` inside a new `0700` directory; import refuses an
  existing output file.
- **Policy reuse:** with free SQL off, the cell is `blocked` (`blocked by safety configuration`
  matches). Deny actions are `blocked`. The assertion never runs after a blocked or failed detail
  cell.
- **Docs and routing:** `sql-notebooks.md` limits match the code. The AGENTS.md and dev-guide rows
  are terse and accurate. FEAT-87 was removed from the roadmap overview and details as implemented.
  The mkdocs nav is updated. The pilot and live-summary JSON contain no emails, local paths or owner
  names.

## Checks run (scratch export of `ce1537fc`, Node 22.21.1)

| Check | Result |
|---|---|
| Full unit suite, `--maxWorkers=4` | **319 files / 8,968 tests passed**, 129.2 s |
| `npm run typecheck` | pass |
| `biome check .` | pass |
| `npm run build` | pass |
| `npm run validate:policy` | pass |
| `npm run check:sizes` | Tool schema budget passed. The file-size ratchet needs `git ls-files`, so I ran it in a throwaway `git init` inside the scratch copy (since deleted): all 670 tracked files within budget. |
| `npm run docs:build` (mkdocs 1.6.1, strict) | pass |
| Reviewer checks `zz-nb-review.test.ts` (R1–R8) | 8/8 reproduce the behavior described above |
| Scripts: `import-size.mts`, `classify.mts`, `perf.mts`/`perf2.mts`, `example-roundtrip.mts` | results as reported |

Reproduction files: `/Users/marianzeis/.codex/reviews/arc1-notebook-review-20261017/claude-review-1-checks/`.
Put `zz-nb-review.test.ts` under `tests/unit/`. Run the `.mts` scripts with
`npx tsx <script> <checkout-root>` from a checkout.

## Limitations

- No live SAP calls. The allowed and denied A4H runs are Codex's records. The aggregate/DISTINCT
  `totalRows` semantics (F4) are inferred from the PR's 758 fixture and were not re-measured.
- Node 22.21.1; Codex used Node 24.
- The scratch export is not a git repository (see the size-check note above).
- I did not open the HTML in a browser; I checked it statically, as the PR's tests do.

## Final verdict

**Approve, with no must-fix items, for PR #1009 at `ce1537fcab0b3d786a2b13ad1923378ec2beb111`.**
I recommend F1 (blocklist label), F2 (validate before reserving the directory) and F3 (import output
size) as small fixes in this PR, plus regression tests for them and for dispatcher-path cancellation
(F6). F4 needs one sentence of documentation or a deliberate decision. F5, F7 and F8 are optional.
