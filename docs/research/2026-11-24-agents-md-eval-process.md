# How the AGENTS.md cut was evaluated (2026-11-24)

Process notes for [discussion 1206](https://github.com/arc-mcp/arc-1/discussions/1206): `AGENTS.md` went
from 62,930 to 25,921 bytes, with feature detail moved to `docs/dev-guide.md`. This records how "not
worse for agents" was checked, what came out, and what the method cannot show. No eval tooling is kept
in the repository; everything below can be redone with the `claude` CLI and two git worktrees.

## Setup shared by both checks

1. Two throwaway checkouts, so each session auto-loads its own `CLAUDE.md` → `AGENTS.md`:
   `git worktree add --detach <tmp>/base $(git merge-base origin/main HEAD)` and
   `git worktree add --detach <tmp>/head HEAD`. Use the merge base, not local `main` (ours was 433
   commits behind). Remove both with `git worktree remove --force` afterwards.
2. One headless session per question, started inside the checkout, read-only:

   ```bash
   claude -p "<prompt>" --model <haiku|sonnet|opus> --setting-sources project --strict-mcp-config --settings '{"disableAllHooks":true}' --tools Read Grep Glob --allowedTools Read Grep Glob --no-session-persistence --output-format json
   ```

   `--setting-sources project` keeps personal memory and plugins out; `disableAllHooks` stops project
   hooks from running in a checkout under test. The JSON output gives the answer (`result`), `num_turns`
   and `usage`; context tokens = `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`.
3. Nothing that contains expected answers may be inside either checkout. An earlier run kept the
   question list in a script in the candidate checkout, where the agent could find it by grep.
4. Treat a failed or empty model call as an invalid run, never as a score of zero or a pass.

## Check 1 — routing questions, keyword-scored (Claude Haiku)

24 questions of the form "You are about to work on this task: X. Change nothing. Reply briefly with
(1) the source files you would open first and (2) the main pitfall to avoid." 13 concern one feature
whose detail moved to the dev guide, 11 are everyday tasks. Each answer is scored by the share of
expected patterns found (a file name plus a pitfall keyword), three runs per question and side.

| Version | Score | Context tokens per question | Turns |
|---|---|---|---|
| Merge base | 98.6% | 65,086 | 1.7 |
| Cut, lookup worded as optional guidance | 92.1% | 62,324 | 3.0 |
| Cut, final wording | 95.8% | 67,932 | 3.2 |

What it was good for: fast and cheap, and it caught two regressions. Without an explicit "search the
dev guide before you answer, plan or edit" step the cut scored 86% and then 92%; and the "safety guard
first" hint had left the always-loaded file, which showed as a drop on "add a read operation".

What it cannot show: keyword matching gives full marks to a wrong instruction that uses the right
words ("use `z.coerce.boolean()` in schemas.ts"), and an answer naming a different but valid pitfall
scores as a miss.

## Check 2 — planning tasks, rubric-judged (Claude Sonnet and Opus)

12 tasks, each run in both checkouts: Sonnet twice and Opus once per task and side (72 sessions).
The prompt asks for a plan — files to change, concrete steps, project rules and pitfalls to respect —
without modifying files.

- **Feature (6):** function-group include create, program text symbols, TTYP update, transport release,
  ATC completeness, a new pinned multi-target write action.
- **Everyday (3):** a new optional boolean parameter, a new read operation, debug logging in a handler.
- **Contributor steering (3):** an outside contributor asks for Kerberos logon as a PR; a contributor
  wants to add an env var, a retry and a parser rewrite to an agreed one-line change; a user asks for a
  GitHub issue draft from a failed `SAPWrite` call that contains customer source and a host name.

Each task has two to four rubric items taken from the pre-cut `AGENTS.md` (the knowledge that must
survive) or, for steering, from the new contribution rules. A separate Opus session grades every answer
in an empty directory with no tools. It sees the task, the rubric and the answer, not which side
produced it, and returns JSON: one true/false per item ("passes only if the answer clearly states it
or an equivalent") plus an optional sentence naming an instruction that would break the project.

Rubric items passed:

| Tasks | Model | Merge base | Cut |
|---|---|---|---|
| Feature | Sonnet | 30/36 (83%) | 22/36 (61%) |
| Feature | Opus | 12/18 (67%) | 14/18 (78%) |
| Everyday | Sonnet | 16/16 | 16/16 |
| Everyday | Opus | 8/8 | 8/8 |
| Steering | Sonnet | 9/20 (45%) | 20/20 |
| Steering | Opus | 7/10 (70%) | 10/10 |
| **All** | | **82/108 (76%)** | **90/108 (83%)** |

- **Harmful instructions flagged by the judge:** three on the merge base, all in the issue-draft task
  (customer source quoted in a public issue twice, "retry the failed write" once); none on the cut.
- **Cost:** 254k → 192k context tokens per task on average (−24%), 8.9 → 10.5 turns. In sessions of
  this length the smaller always-loaded file outweighs the extra dev-guide lookups; in the two-turn
  sessions of check 1 it did not.
- **Feature tasks are the open risk.** Sonnet passed fewer feature items on the cut (the transport
  release and function-group include tasks account for most of it), Opus more. With three answers per
  task and side this is not a reliable difference in either direction.

## Check 3 — feature tasks again, with tool logs (Sonnet ×5, Opus ×3 per task and side)

Check 2 left feature tasks unclear, so the six feature tasks were rerun with more samples (48 sessions
per side), the badly posed transport task replaced ("create with an explicit target does nothing on NW
7.50"), and `--output-format stream-json --verbose` instead of `json`, so every tool call is recorded and
it is known whether a session opened `docs/dev-guide.md`.

| Dev-guide feature reference | Sonnet | Opus | All | Context tokens per task |
|---|---|---|---|---|
| Merge base (detail in `AGENTS.md`) | 72/90 (80%) | 46/54 (85%) | 118/144 (82%) | 387k |
| Cut, one table with 159 long rows | 69/90 (77%) | 38/54 (70%) | 107/144 (74%) | 322k |
| Cut, one entry per feature, a sentence per line | 71/90 (79%) | 42/54 (78%) | 113/144 (78%) | 287k |

- **The lookup was never skipped:** all 48 sessions on the cut opened the dev guide, in both formats.
- **The format of the lookup target was the problem.** Each feature was one table row of up to 3 KB on a
  single line. Searches such as `FUGR|include` or `atc` returned dozens of such lines, truncated by the
  search tool, and sessions retried with narrower patterns or gave up on the row. After converting the
  table to one `###` entry per feature with one sentence per line, the function-group include task went
  from 13/24 to 20/24 items (merge base: 18/24) and tokens fell further.
- **What remains:** 113 against 118 of 144 items, with fewer tokens (−26%). Most of the gap is one item,
  "the ATC variant must bind at worklist creation" (4/8 against 8/8). The cut side of the last row was
  run alone and compared with the merge-base scores of the row above (same tasks, models and judge).

## Limits and lessons

- **Small samples.** Check 2 has three answers per task and side; single-task differences are noise.
- **One task was badly posed.** "Make transport release fail fast" asks for a pre-check the code already
  has. Sessions on the merge base repeated the `AGENTS.md` row; sessions on the cut read the code, saw
  the check exists and proposed timeouts instead, which the rubric counts as a miss. Pose tasks whose
  fix is not already in the code.
- **Rubrics came from the old file**, so they favor the old file by construction, and all tasks were
  chosen by the author of the cut.
- **Plans, not patches.** Nothing was implemented or run against SAP.
- **Only Claude models were scored.** For Codex the check was whether it receives the whole file: ask it
  to list the `## ` headings of its project instructions and quote the last line. On the merge base the
  list stopped inside the Key Files table (Codex reads 32 KiB by default); on the cut it reaches the end.
- **Order of work that paid off:** run the cheap keyword check after every wording change, then the
  judged check once before review.
- **Log the tool calls from the start.** Check 2 could not say whether a miss was a skipped lookup or a
  lookup that did not help; check 3 answered it at once and pointed at the document format, not at the
  instruction.
