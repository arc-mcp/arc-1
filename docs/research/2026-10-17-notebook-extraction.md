# What to keep from notebook PR #1009

## Decision

Keep native notebook authoring guidance, a portable example and one existing-query
regression. Retire the alternate notebook format and runner. Creating a JSON file
does not need another MCP action, CLI command, generator or execution framework.

The user explicitly rejected #1009's additions and requested a reviewed extraction,
merge and closure. [Plan](../plans/2026-10-17-notebook-extraction.md) ·
[User guide](../../docs_page/sql-notebook-authoring.md).

## Baselines

| Source | Inspected revision / qualification |
|---|---|
| ARC-1 main | `37fece94359c8a48523af56b0ff71f52359a7c21`, version 1.6.0 |
| #1009 | `62eb17b456cd57908cdac2a508082027ed5d88f7`, stacked on #1008; 29 notebook-specific files |
| Installed SAP extension | `SAPSE.adt-vscode` 1.2.0, darwin-arm64 |
| Current upstream page | [SAP Marketplace](https://marketplace.visualstudio.com/items?itemName=SAPSE.adt-vscode), checked October 17; lists the SQL Notebook |

The live Marketplace description confirms the feature, not a wire-format guarantee
or exact latest version. SAP Help's SQL-console page was unavailable to the text
fetcher. The installed manifest and serializer are the format evidence; no SAP
implementation code is redistributed.

## Extraction review

| #1009 component | Disposition |
|---|---|
| `Flight_Capacity_Showcase.abapsql` | Adapt its proven airline query into `examples/notebooks/flight.abapsql`. Remove the personal destination; add a separate count cell and interpretation notes. |
| Native-format knowledge | Document the five supported fields and real editor commands. Unknown metadata and results are not persisted by the inspected serializer. |
| Scalar-count evidence | [Keep the original sanitized fixture](https://github.com/arc-mcp/arc-1/blob/62eb17b456cd57908cdac2a508082027ed5d88f7/tests/fixtures/json/notebook-scalars-758.json) on the source branch. Add only the zero-match case through the public dispatcher, real XML parser and query handler. |
| `flight.notebook.json`, document schema/importer | Reject. Native `.abapsql` already expresses the needed Markdown/SQL cells. |
| Runner, CLI, assertions, result export and HTML | Reject. They duplicate editor execution and add a new completeness contract without measured user benefit. |
| Runner plumbing | Drop its AGENTS.md/dev-guide rows, `sql-notebooks.md`, CLI-guide additions, navigation entry and size budgets with the runner. They do not serve native notebook authoring. |
| Scalar aggregate detector | Reject. Existing SAPQuery preserves native metrics; a partial SQL parser would add maintenance and semantic risk. Explain the counts instead. |
| Workflow error classifier / private-file helpers | No consumer on main. Their fixes serve the unmerged workflows, not existing query behavior. Frozen source remains available for #1008 review. |
| Eight-transport pilot | Useful historical evidence for #1008, unrelated to authoring. [Preserved pilot](https://github.com/arc-mcp/arc-1/blob/62eb17b456cd57908cdac2a508082027ed5d88f7/docs/research/2026-10-17-transport-pilot.md); do not repeat its SAP calls or claim customer savings. |
| Old plan, reviews and broad research index | Preserve on the source branch. They describe the rejected runner and are not approval of this extraction. |

No production source, schema, authorization, dependency or CLI changes are required. Existing
whitespace tests already cover exact cell strings; the new case adds the uncovered
`totalRows=0` versus one scalar output row distinction. It passes on unchanged
production code and is contract coverage, not a claimed bug fix. Its XML is a
minimal reconstruction from recorded public responses, not a captured SAP body.

The current roadmap has reused FEAT-86/87 for stored-text coverage and repeated
SQL-literal spaces. Neither is a notebook item now. Checked: **no roadmap impact**;
do not carry #1009's old deletions into main. ABAP object creation is also outside
this extraction; the PR contains no object-creation improvement.

## Validation

| Check | Result |
|---|---|
| Frozen candidate | `7387683f4fb5c29f6147a890f9d149bc973da585`; subsequent changes only record review/results and qualify documentation |
| [CI](https://github.com/arc-mcp/arc-1/actions/runs/39073805807) | **9,234/9,234 tests, 327 files**, on both Node 22 and 24, in normal and coverage runs; all applicable checks pass |
| Local focused checks | **372/372** across public dispatcher, XML parser, whitespace and grouped-count errors |
| Build, typecheck, lint, policy, size/schema budgets, strict docs | Pass; production files and tool snapshots unchanged |
| Final local full run | **9,230/9,234 passed**; four existing subprocess startup failures, not a green run |
| Local control | Candidate and clean main `37fece94` both pass **50/54** in the same CLI/runtime and shutdown files, failing the same four startup cases; no timeout changes |
| Earlier local full run | Before simplification (`92aa167e`), **9,235/9,235 passed**, Node 24.11.1 / four workers |
| [Native serializer](notebook-extraction/serializer.json) | Installed 1.2.0 serializer round-trips the example byte-for-byte with minimal VS Code data/cell stubs; three ordered cells, no destination, unknown fields dropped |
| Native editor open/save | Unverified: the shared VS Code window changed during selection. No notebook cell was executed there. |

The isolated main control explains why the four local startup failures are not
attributed to this docs/test change. CI supplies passing whole-suite validation
on the reviewed code. The first exploratory test run also had one malformed
synthesized-XML fixture (unescaped `<`); it was corrected, then replaced by the
smaller public-dispatcher case. No fail-before product bug is claimed.

### Fresh SAP check

[Aggregate evidence](notebook-extraction/live-summary.json): A4H/001, HTTPS 443,
local real dispatcher, existing Basic identity. Previously recorded SAP_BASIS
758 SP02; release not queried again. The unchanged production source is `37fece94`.

- Airline query: six output rows and `totalRows=6`.
- Count query: one row containing `"40 "`, with `totalRows=40`.
- Zero-match predicate: one row containing `"0 "`, with `totalRows=0`.
- Three query POSTs, zero mutations; free SQL disabled refused before another POST.

An initial probe setup typo left SQL disabled and was refused before SAP, then
corrected locally. The only subsequent example change removed its final newline;
SQL hashes are unchanged. These calls are not an editor run and do not qualify
other extension versions, 750, 816 or BTP.

### Independent review and disposition

[Claude Opus 5.5 Max plan review](notebook-extraction/claude-plan-review.md) approved
the scope and found no further extraction. Applied its useful refinements: one
missing case through `handleToolCall`, labeled synthesized XML, explicit separate
controls/row limits, canonical sample bytes and untouched roadmap IDs. The initial
direct-handler test also exercised serialization; public dispatch is stronger.
The short guide remains separate from the large tools reference.

[Final review of `7387683f`](notebook-extraction/claude-final-review.md): **no must-fix
defects; ready to merge and close #1009 afterward**, subject to final checks. Claude
independently passed 372 focused tests, 72 docs/snapshot tests, typecheck, Biome
on the changed test, size/policy checks and strict docs. It did not run the build
or full-repository lint; those passed in our checks.
In separate private copies, dropping zero-count rows or deriving a `truncated`
flag from unequal counts made only the new regression fail (371/372 still passed).
This substantiates its value without claiming a production bug was fixed.

[Evidence follow-up](notebook-extraction/claude-evidence-review.md) accepted green
dual-Node CI plus the unchanged-main reproduction in place of a green local full
run. Its two documentation corrections are applied: enumerate runner plumbing
and name only the checks Claude actually ran. The local full run did not pass.
Optional doc refinements name 758, record the grouped count and correct the plan's
test scope. GUI open/save remains an optional, explicitly unverified check.

The reviewer corrected its earlier statement about an unbound cell: Run and Check
Cell Syntax first prompt for a system. The guide never relied on the earlier
"only an error" claim. The initial plan report remains verbatim as historical evidence.

Raw local outputs remain private. Only count-only fixtures, aggregate summaries
and review reports belong in the repository. The original 67-file working tree,
11 research inputs and #1009 source branch are preserved.
