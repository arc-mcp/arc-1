# Claude review 3 — notebook PR #1009 final verification

| | |
|---|---|
| Reviewed commit | **`df8e642f34a149c06e3c340431e00a3b5283d65d`** (`fix: classify actual dispatcher response limits in notebooks`) |
| Compared with | `2f8c6600fbe9a3e691137ef20b7eb88050733bf0` ([review 2](claude-review-2.md)) |
| Reviewer | Claude Code, model **Opus 5.5** (`claude-opus-5-5`), effort **max** |
| Date | 2026-10-17 |
| Method | Read-only `git archive` scratch copy; no shared edits, SAP calls, credentials, commits, pushes or merges. |
| Note | The worktree `/Users/marianzeis/.codex/worktrees/adt-next-stages/arc-1` is clean and now at `a72a81df`, which descends from `df8e642f` through a parent-branch parser-budget merge (`19c72872`; 3 docs/budget files). That later commit is outside this verification. |

## Verdict

**Approve. N1 is fixed, and there is no actionable residual.**

## What changed and how it was verified

- **The fix.** `src/workflows/artifact.ts:14-15` now matches the actual dispatcher reply,
  `/^(?:\{"error":")?DATA_RESPONSE_TOO_LARGE\b/`. That is exactly the line validated in review 2. The
  local `Tool output exceeds workflow input budget.` case and the four policy-code prefixes are
  unchanged.
- **New regression, real dispatcher.** `tests/unit/workflows/notebook-errors.test.ts` runs the real
  `handleToolCall` with `runQueryBatch` rejecting with `AdtResponseLimitError` (data-preview family)
  and with `DataSourcePolicyError`, in both normal and minimal-error modes. It expects `incomplete`
  and `blocked` respectively, and asserts that both queries were attempted.
- **Synthetic test corrected.** The synthetic limit case in `sql-notebook.test.ts` now uses the JSON
  reply shape instead of an invented plain-text message.
- **Validation log.** The row now reads accurately (local limit fixed first; the real server JSON
  reply corrected after review 2), with a short N1 note.
- **Archived review 2.** `evidence/notebook-claude-review-2.md` is byte-identical to my report.

My review-2 real-dispatch check (`zz-nb2-labels.test.ts`) now reports:

```text
limit  minimal=false → incomplete   reply {"error":"DATA_RESPONSE_TOO_LARGE",…
limit  minimal=true  → incomplete
policy minimal=false → blocked      reply DATA_SOURCE_BLOCKED: request denied before data execution …
policy minimal=true  → blocked
```

The classifier is shared with the transport-review collector, so I also re-ran those tests; a
`WorkflowCallError` can now carry `incomplete`, which those checks report as is.

## Checks run (scratch copy of `df8e642f`, Node 22.21.1)

| Check | Result |
|---|---|
| Focused tests: `notebook-errors`, `sql-notebook`, `notebook-cancellation`, CLI `notebook`, transport-review collector, CLI `review`, plus my `zz-nb2-labels` and `zz-nb2-dir` checks | **8 files / 52 tests passed** |
| `tsc --noEmit` (src and tests configs) | pass |
| Biome on the changed files | pass |

No full-suite rerun: the change is one regex plus tests and docs, review 2 already ran the full
suite at `2f8c6600` (8,976 passed), and Codex reports the full suites green.

## Actionable residuals

None.
