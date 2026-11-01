# Claude evidence verdict — notebook extraction (#1023)

| | |
|---|---|
| Candidate | **`4bf6657d1ad96de51a8158d9b7308f8e55be2d1f`**: one docs-only commit on the reviewed `7387683f` |
| Main | Checks below also ran on the squash result with current main **`6af98474`** (#1021, docs-only) |
| Reviewer | Claude Code, model **Opus 5.5** (`claude-opus-5-5`), effort **max** |
| Date | 2026-10-18 |
| Method | Read the named logs and diffed fixed commits. Built the squash result in a private scratch repo that borrows objects read-only. No full suite, SAP, network, GitHub or shared edits. |

## Verdict

**The merge conditions are met once one line in the research note is corrected.**

Green dual-Node CI plus the unchanged-main reproduction is sufficient instead of a green local full
run:

- **Unrelated failures.** The four local failures are subprocess startup timeouts in
  `cli/runtime.test.ts` and `server/shutdown.test.ts`. The PR changes no code these tests execute.
- **Same on main.** A clean archive of unchanged main, with the same dependencies, fails exactly
  those four tests (50/54) on the same machine.
- **Green in CI.** CI ran the whole suite four times on the PR merge commit (Node 22 and 24, each
  normal and coverage). All 9,234 tests passed, including those four.

**#1009 can be closed after #1023 merges.**

| Condition from my final review | Status |
|---|---|
| PR head is the reviewed code | Pending: confirm the head is the final successor and its CI rerun is green |
| Full suite green | Met through CI plus the main reproduction (above) |
| `docs:`/`test:` squash title | Met per your report: `docs: keep native SQL notebook authoring and query evidence` |
| No-roadmap-impact and unverified-GUI disclosures | Met per your report (I can't see GitHub) |

## Required before merge (docs accuracy, one edit)

**1. Runner plumbing claim.** The research note says the optional refinements now "enumerate
runner plumbing", but no such row was added. The disposition table is unchanged at `4bf6657d`, and
the working tree is clean. Either:

- add the row: AGENTS.md/dev-guide rows, `sql-notebooks.md`, the CLI-guide additions, the nav
  entry and the size budgets, all dropped with the runner; or
- delete the phrase.

**2. Static gates claim.** In the same edit, fix "Claude independently passed … all static gates",
which overstates what I ran:

- I ran typecheck, Biome on the changed test, size, policy and strict docs.
- I did not run `build` or the full-repository lint.

Name the checks I ran, or say "the static gates it ran".

This is not a code or test blocker. Re-review needs only a diff check.

## Evidence checked

| Claim | Evidence | Result |
|---|---|---|
| The delta is docs-only | 5 files under `docs/` and `docs_page/`. No source, test, example, schema or dependency change. | ✓ |
| Final review archived verbatim | Byte-identical to my report | ✓ |
| 758 named in the user docs | Guide and `tools.md` now say "Observed on SAP_BASIS 758" | ✓ |
| Plan scope corrected | The plan now names one zero-match scalar case | ✓ |
| Grouped count recorded | The note records `totalRows=6` for the grouped query | ✓ |
| Runner plumbing enumerated | Not present | ✗ (see above) |
| CI: 9,234/9,234 tests, 327 files, Node 22 and 24, normal and coverage | Both logs show two runs, each `327 passed` / `9234 passed`, with no errors. The checkout is `refs/pull/1023/merge`, i.e. `7387683f` merged into main `6af98474`. | ✓ This tested the merge with current main, which is stronger evidence. |
| Local full run: 9,230/9,234 | Log shows `4 failed \| 9230 passed`, in two files. The runtime test timed out at 10 s; three shutdown tests never saw `post-started`. | ✓ Correctly reported as not green |
| Same four failures on candidate and main | Both isolated logs show `4 failed \| 50 passed (54)`, with the same test names | ✓ |
| The baseline is unchanged main | Sampled files match `37fece94`: `query.ts`, `search-navigate.test.ts`, both failing test files and the lockfile. The guide is absent. `node_modules` is the candidate's, with the same lockfile. | ✓ |
| Earlier 9,235/9,235 at `92aa167e` | No log provided | Not verified; labelled as earlier |

## Current main (#1021)

`6af98474` changes only AGENTS.md, ADR-0009, `architecture.md`, `extensions.md` and the roadmap.

- None of those are the candidate's files.
- Its roadmap change has no notebook or FEAT-85..89 line, so "no roadmap impact" still holds.
- The squash result merges cleanly and differs from main by exactly the candidate's 11 files.

On that merged tree:

- **9 files / 248 tests passed.** These include `docs-tools-parity` (the only test that reads a
  changed doc, `tools.md`), the new scalar-count test, the docs-contract tests and the tool
  snapshots.
- **Strict `mkdocs build` passed.**

## Limitations

- No full suite, as requested.
- No GitHub access: the CI facts come from the two saved logs.
- Node 22.21.1 locally.
