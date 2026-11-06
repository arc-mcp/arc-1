# Claude plan review — #1009 notebook extraction

| | |
|---|---|
| Plan | `docs/plans/2026-10-17-notebook-extraction.md`, **untracked** in `/Users/marianzeis/.codex/worktrees/notebook-value-extraction/arc-1` (SHA-256 `f0fb722f…a8fd4ba`) |
| Base | main **`37fece94359c8a48523af56b0ff71f52359a7c21`** |
| Source | #1009 at **`62eb17b456cd57908cdac2a508082027ed5d88f7`**. The notebook-only commits are `ce1537fc`…`62eb17b4`, stacked on #1008 (`56c1d518`). |
| Reviewer | Claude Code, model **Opus 5.5** (`claude-opus-5-5`), effort **max** |
| Date | 2026-10-18 |
| Method | Read-only `git show`/`git grep` at fixed commits, plus the installed ADT for VS Code 1.2.0 manifest and bundle. From the extension I took only command titles, file keys and limits, and copied nothing. No tests, SAP, models, network or GitHub. |

The worktree already has uncommitted implementation files:

- modified: `docs_page/tools.md`, `mkdocs.yml`, `tests/unit/adt/freestyle-query.test.ts`;
- new: `docs_page/sql-notebook-authoring.md`, `examples/notebooks/`, `tests/fixtures/json/query-scalars-758.json`.

I did not review them. Please send the frozen diff.

## Verdict

**Approve the scope, with five small changes.** Rejecting the runner, importer, ARC-1 document
format, assertions and CLI is right. None of that code has a consumer on main.

What remains is modestly useful, and it can be smaller than planned:

- **The example and guide are worth keeping.** They record facts an agent or user cannot easily
  guess: the cell keys, that results and unknown keys are dropped on save, the row defaults, and
  that execution happens outside ARC-1.
- **Most of the planned regression coverage already exists on main.** Only one shape is new:
  `totalRows: 0` with one returned row.

## Needed changes

### 1. Test only the uncovered shape

Main already covers two of the planned cases:

- **Padded values.** `data-preview-whitespace.test.ts` (#982) keeps `'7 '` and `'0001'` in both XML
  formats, and `RC: '0 '` in the trace test.
- **`totalRows` above the returned row count.** `search-navigate.test.ts:645` runs real XML through
  `handleToolCall`: 511,927 matched, 2 returned. The COUNT `40` case has the same shape.

**The new case is a scalar COUNT with no match: `totalRows: 0`, while one row `{ N: '0 ' }`
returns.** Nothing on main covers `totalRows` below `rowsReturned`.

- **Location.** Add one case beside `search-navigate.test.ts:645`, through `handleToolCall`. That
  is the handler serialization path the plan names; a client-level test in
  `freestyle-query.test.ts` does not exercise it.
- **Assertion.** Use `toEqual` on the parsed output. Any later field derived from `totalRows`, such
  as an empty or truncated flag, must then change this test deliberately.
- **No separate whitespace regression.** Drop "padded values stay strings"; the exact `'0 '` in this
  assertion is enough.

### 2. Label the XML as synthesized

The plan says "Exercise real XML parsing", but no raw response exists:

- `notebook-scalars-758.json` is parsed SAPQuery output;
- `notebook-live-summary.json` holds only hashes, counts and configuration.

Either:

- build the modern `dataPreview:` envelope the 511,927 test uses, and say so: "values observed on
  A4H 758 SP02, client 001, 2026-10-17; XML envelope synthesized"; or
- capture raw XML in the optional live run.

Don't describe a synthesized envelope as a capture.

### 3. Write the guide from verified facts, scoped to 1.2.0

#1009 has no native-authoring guide to carry over: `sql-notebooks.md` and the `cli-guide.md`
additions describe the runner. The guide is new text.

Facts I verified in the installed extension:

| Topic | Observed in 1.2.0 |
|---|---|
| Availability | Notebook type `abap-sql-notebook` for `*.abapsql` files. The installed 1.1.2 has no notebook contribution. |
| Commands (category `ABAP`) | "SQL Notebook" (new file), "Set Cell System", "Set Cell Max. Rows", "Check Cell Syntax" |
| File shape | `{"cells":[{"kind","value","destination"?,"rowNumber"?}]}`. `kind` is `markdown` or `sql`; any other value opens as SQL. |
| Save | Writes only those four keys, as 2-space JSON with no trailing newline. `destination` is written only when set, `rowNumber` only when numeric. Other keys and all results are dropped. |
| No system selected | Running the cell shows a select-system error; nothing executes. |
| Rows | Default 100 when unset. "Set Cell Max. Rows" accepts integers 1–100,000. SAPQuery's `maxRows` is separate and clamps at 10,000. |
| Malformed JSON | Opens as one empty SQL cell. Editing and saving from that state replaces the original JSON. |

The guide itself must state the boundary that plan line 53 requires; the plan is not enough:

- Cells run through the extension's own ADT connection, with the user's SAP identity.
- ARC-1's controls therefore don't apply: free-SQL and data-preview gates, the data-source
  blocklist, deny rules, scopes and audit.
- SAP authorizations still apply.
- Review agent-written SQL before running it.

Also:

- **Version.** Name the inspected version. If the Marketplace recheck finds a newer release,
  re-inspect it or keep the wording "observed in 1.2.0".
- **What to cite.** Command titles and file keys only. Don't describe the extension's internals or
  copy the #1009 screenshot.

### 4. Make the example check real

- **"No query runs on open" proves nothing for a destination-less file.** Execution is always
  explicit, and a cell without a system shows an error instead of running. Check instead that:
  - each SQL cell shows that no system is selected;
  - Run does not execute.
- **Commit the bytes the extension writes**, so a save round trip leaves no `git diff`. The PR can
  check this offline:
  - the file parses;
  - `JSON.stringify(parsed, null, 2)` equals the file;
  - only the four keys appear;
  - `rowNumber`, if present, is an integer from 1 to 100,000.

  The GUI open/save check then becomes optional.
- **SQL provenance.** #1009's showcase query ran on 758 through the runner and returned six rows,
  per its research note. The live summary hashes the runner sources, not the notebook. So:
  - keep that SQL unchanged, or re-check it;
  - say "758 only";
  - note that it needs the `/DMO/` flight demo data.

### 5. Roadmap and release hygiene

I verified the roadmap ID history:

| | FEAT-86 | FEAT-87 | FEAT-88 |
|---|---|---|---|
| Old main `ce649ca9` | — | — | — |
| #1008 stack (`56c1d518`) | Broader historical transport coverage | Reusable SQL notebook runner | Current-caller policy explanations |
| #1009 `ce1537fc` | unchanged | **deleted** | unchanged |
| Main `37fece94` (#1012) | Additional stored-text profiles and persistence | Preserve repeated spaces in general data queries | — |

Main has no notebook mention anywhere (`git grep -i notebook` is empty).

- **Port no roadmap hunk from #1009.** Today `ce1537fc`'s deletion would remove main's FEAT-87.
  Don't park the rejected runner either. State "No roadmap impact (checked)" in the PR.
- **Don't cite the `"0 "`/`"40 "` padding as FEAT-87 progress.** FEAT-87 concerns SQL literals in
  predicates being condensed on 816. This observation is about returned values on 758.
- **Commit type.** Use `docs:`/`test:` for the commits and PR title, not `feat:` as #1009 did.
  Release-please would cut a minor release for a docs-and-test change.

Aside for the other extractions: #1008's FEAT-86 now collides with main. FEAT-88 is still free on
main.

## Missed-extraction check

Nothing else needs extracting.

- **Product code.** The notebook-only commits change no product source outside `src/workflows/`,
  and main has no `src/workflows/`.
- **Reject as planned:** `flight.notebook.json` (ARC-1 format), the runner tests,
  `sql-notebooks.md` and the CLI guide additions.
- **Link, don't port:**
  - the research note;
  - the three runner reviews;
  - the live summary;
  - the transport pilot files;
  - the SAP UI screenshot.
- **The broad follow-up plan.** Its other stages live elsewhere:

  | Stage | Where it lives |
  |---|---|
  | Dump filters | The dump-filter extraction (#1020) |
  | Batch syntax and activation logs | #1011 |
  | Policy explanations | The policy review |
  | Pilot and historical research | #1008 |

  Closing #1009 loses no idea while those stay open. I didn't check GitHub.

## Optional suggestions

1. **Guide location.** Make the guide a short SAPQuery subsection in `docs_page/tools.md` instead
   of a new page and nav entry, unless it grows past about 30 lines.
2. **No fixture file.** Inline the two values with a one-line provenance comment.
3. **The `40` case.** Keep it only as a second `it.each` row beside the `0` case. It adds
   documentation, not coverage.
4. **A `totalRows` note.** Add one sentence to the `tools.md` SAPQuery section, limited to the
   observed case: a scalar `COUNT( * )` returns one row, while `totalRows` is the matched count (0 or
   40 on 758). No tool-description change.
5. **Permalinks.** Link #1009 evidence by commit permalink (`blob/62eb17b4…/`) in the decision
   record and the closing comment, so it survives a branch deletion.
6. **State the interpretation.** Say in the PR that "creation" was interpreted as native
   `.abapsql` authoring (plan line 8), so the user can object.

## Proportionate validation

| Check | Needed? |
|---|---|
| The new test, plus the `search-navigate`, `data-preview-whitespace` and `xml-parser` tests | Yes |
| `tsc --noEmit`, Biome, strict `docs:build`, `check:sizes` | Yes |
| Offline example check (item 4) | Yes |
| Full unit suite | Through PR CI, as planned |
| `validate:policy`, `build` | Harmless; nothing changes them |
| GUI open/save, live A4H, models | Optional. A live run is useful only to capture raw XML or re-check the SQL. |

## Limitations

- This is a plan review only. I ran no tests and did not review the uncommitted implementation.
- The extension facts come from the installed 1.2.0 bundle (dated 2026-10-16), not from SAP
  documentation or the current Marketplace.
- I didn't check the GitHub state of #1008, #1011 or the extraction PRs.
