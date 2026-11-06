# Claude final review — #1009 notebook extraction

| | |
|---|---|
| Reviewed commit | **`7387683f4fb5c29f6147a890f9d149bc973da585`** (`test: retain only the missing scalar-count contract`) |
| Parent | `92aa167e570ce83684e0f104f0709c72ffae4977` (`docs: retain native SQL notebook authoring from rejected runner`), whose parent is main **`37fece94359c8a48523af56b0ff71f52359a7c21`** |
| Scope | 10 files, +526/−0. No changes to `src`, schemas, CLI, dependencies, lockfile or tool snapshots. |
| Reviewer | Claude Code, model **Opus 5.5** (`claude-opus-5-5`), effort **max** |
| Date | 2026-10-18 |
| Method | Private `git archive` of the exact commit, not the working tree or PR head. `node_modules` was cloned from an earlier export with an identical lockfile. A scratch git index was created inside the archive for the size ratchet only. From the installed ADT for VS Code 1.2.0 I used the manifest and bundle for facts and hashes only. No SAP, models, network, GitHub, GUI or shared edits. |

## Verdict

**Ready to merge. There are no must-fix defects.** The remaining conditions are process steps, not
code changes:

1. **Push and confirm the head.** The remote draft #1023 still has the first commit. Push this
   commit and confirm the PR head is `7387683f`, or a docs-only successor that only archives this
   review.
2. **Wait for green runs.** Your final full unit suite and the PR's CI must both pass on that head.
3. **Squash title.** Use `docs:` or `test:`. arc-1 squash-merges and release-please reads the PR
   title. I could not see the title (no GitHub).
4. **PR description.** State "No roadmap impact (checked)" and that GUI open/save is unverified.

**#1009 can be closed once #1023 merges.**

- Every notebook-specific file in #1009 has a recorded disposition, and the useful parts are in
  this PR.
- #1009's other ADT follow-up stages are tracked in #1008, #1011, #1020 and the policy review.

## Documentation facts

Every factual claim in the guide and the `tools.md` addition matches its source.

| Claim | Source | Result |
|---|---|---|
| Name "ABAP Development Tools for VS Code"; Marketplace id `SAPSE.adt-vscode` | Manifest `displayName`, `publisher`, `name` | ✓ |
| **ABAP: SQL Notebook**, **Set Cell System**, **Set Cell Max. Rows**, **Check Cell Syntax** | Manifest command titles, category `ABAP` | ✓ |
| **Reopen Editor With… → ABAP SQL Notebook** | Notebook `displayName`, `*.abapsql` selector | ✓ |
| Fields `cells`, `kind`, `value`, `destination`, `rowNumber`; nothing else is saved | Installed serializer | ✓ |
| `rowNumber` defaults to 100; the editor accepts 1–100,000 | Installed bundle | ✓ |
| ARC-1's separate cap is 10,000 | `MAX_TABLE_QUERY_ROWS` | ✓ |
| Malformed JSON opens as one empty SQL cell | Deserializer fallback | ✓ |
| Opening does not execute SQL | Cells run only through the notebook controller's run handler. Opening only syncs the document to the language server. | ✓ |
| Extension execution is outside ARC-1's controls | Guide lines 20–22 | ✓ Stated in the guide itself |
| `totalRows` "can" count matching input records | Live summary: scalar COUNT reports 40 or 0 with one row. The grouped query reports `totalRows` 6, equal to its 6 returned rows. | ✓ The hedge is right: the input-count reading holds only for the non-grouped aggregate. |
| Link to `tools.md#freestyle-sql-behavior` | Anchor present in the built site; strict build passes | ✓ |

## Test value

The new test calls `handleToolCall` beside the existing metrics test. It compares the whole output
with `toEqual`, records its provenance, and labels the XML envelope as synthesized.

I ran two plausible regressions against the four focused files:

| Mutation in `src/handlers/query.ts` | Result |
|---|---|
| Drop rows when `totalRows` is 0 | **Only the new test fails** (1 failed, 371 passed) |
| Add a derived `truncated` flag when `totalRows` ≠ returned rows | **Only the new test fails.** The existing 511,927 test checks properties one by one, so it misses the added field. |

The test adds real contract coverage rather than duplicating existing tests.

My plan-review remark concerned a client-level test. Your initial direct-handler test would also
have exercised serialization; placing it at the dispatcher is fine.

## Example safety and format

- **Safe defaults.** No destination. SELECT-only on `/DMO` demo tables. Row cap 20. The Markdown
  cell says the row cap can omit airlines and that the two queries are not an atomic snapshot.
- **Exact serializer bytes:**
  - `JSON.stringify(parsed, null, 2)` equals the file;
  - only the allowed keys appear;
  - there is no trailing newline;
  - line endings are LF, as `.gitattributes` requires.

  Lint-staged doesn't touch `.abapsql`, and no CI step enforces a final newline.
- **Proven SQL.** The grouped SQL is byte-identical to #1009's live-verified showcase query.

## Evidence integrity

| Item | Result |
|---|---|
| `serializer.json` bundle SHA-256 | Matches the installed 1.2.0 bundle |
| `serializer.json` and `live-summary.json` current-example hash | Matches the committed example |
| Probe-time example hash | Equals the current file plus one newline, consistent with "removed final newline" |
| Three SQL hashes | Match the two example cells and the test's exact SQL |
| Live counts | 6 rows / `totalRows` 6; 1 row `"40 "` / 40; 1 row `"0 "` / 0. Three POSTs, no mutations, denied before POST. All consistent with the research note. |
| Permalinks to `62eb17b4` | Both files exist at that commit |
| Archived plan review | Byte-identical to my report |
| Main version 1.6.0, the 29-file count | ✓ (32 files changed by #1009's own commits, minus 3 transport files) |

I could not verify the Marketplace check (no network), the live run itself (taken from the records)
or GUI behavior. The note discloses all three.

## Extraction disposition

The research note's table covers all 29 notebook files by group:

| #1009 component | Disposition |
|---|---|
| Showcase notebook | Adapted into the new example |
| Native-format knowledge | Guide |
| Count fixture | Linked by commit permalink |
| ARC-1 notebook format and importer | Rejected |
| Runner, CLI, assertions, export and scalar detector | Rejected |
| Workflow helpers | No consumer on main |
| Transport pilot | Linked by commit permalink |
| Old plan, reviews and research index | Preserved on the branch |

- **Runner plumbing.** The AGENTS.md/dev-guide rows, `sql-notebooks.md`, the CLI-guide additions,
  the nav entry and the size budgets go with the runner. The table implies this rather than naming
  it.
- **Roadmap.** Unchanged, which is correct; no #1009 hunk was ported.

## Must-fix

None.

## Optional suggestions

1. **Update the research note when archiving this review.** Replace "Frozen-diff review is pending"
   and record the final full-suite result; the note currently cites the run before simplification
   (9,235 tests).
2. **Plan wording.** Plan line 38 says "zero/nonzero scalar counts", but only zero is unit-tested.
   The nonzero case is covered live and by the existing larger-count test shape.
3. **Record the grouped result.** Note that the grouped query reported `totalRows` = 6, its
   returned row count. That is why the docs say "can".
4. **Name the release.** Name 758 in the user-facing `totalRows` sentences; the research note
   already does.
5. **GUI check.** Do one open/save in the GUI once VS Code is free. It can follow the merge, since
   the change is docs-only.
6. **Disposition row.** Add one row to the disposition table naming the runner plumbing.

## Correction to my plan review

I wrote that running a cell without a system only shows an error. In fact, Run and Check Cell
Syntax first prompt for a system, and the error appears only if none is chosen. This PR does not
rely on my earlier wording, so no change is needed.

## Checks run (private archive of `7387683f`, Node 22.21.1)

| Check | Result |
|---|---|
| Focused: `search-navigate`, `xml-parser`, `data-preview-whitespace`, `query-count-group-error` | **372/372**, matching the note |
| Two handler mutations (separate private copies) | Each: 1 failed / 371 passed, and only the new test fails |
| Docs-scanning tests and tool-definition snapshots (7 files) | 72/72 |
| `npm run typecheck` (src, scripts, tests) | pass |
| Biome on the changed test | pass. The evidence JSON is outside Biome's configured includes. |
| `check:sizes` | pass (682 files; schema budgets unchanged) |
| `validate:policy` | pass (132 entries, unchanged) |
| Strict `mkdocs build` (1.6.1) | pass; new page built, anchor present |

## Limitations

- I didn't run the full suite; yours and CI's are pending.
- Node 22.21.1 locally; your 9,235-test run used Node 24.11.1.
- No SAP, network, GitHub or GUI checks. The live and Marketplace results come from the committed
  records.
