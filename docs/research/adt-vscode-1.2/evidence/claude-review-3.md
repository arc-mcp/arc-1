# Claude review 3 — final targeted review of arc-mcp/arc-1 PR #1008

| | |
|---|---|
| PR | https://github.com/arc-mcp/arc-1/pull/1008 (draft) |
| Reviewed head | **`f7598c3338bff11711f70b0336d93682039831e0`** (`fix: distinguish transport review limit and SAP failures`) |
| Head verified | The shared checkout `/Users/marianzeis/.codex/worktrees/transport-review-first/arc-1` is at `f7598c33` with a clean status, and `origin` `refs/heads/codex/transport-review-evidence` points to `f7598c33` (read-only `git ls-remote`). |
| Compared with | `d83cf19b4c5b3abd0dd8013324af4f29fbe06c2b` (approved in [review 2](claude-review-2.md)); the only commit in between is `f7598c33` |
| Reviewer | Claude Code, model **Opus 5.5** (`claude-opus-5-5`), effort **max**, same session as reviews 1 and 2 |
| Date | 2026-10-17 |
| Method | Read-only. Read the 13-file delta and the error and HTTP code it depends on, then ran the tests in an isolated `git archive` export. The lockfile is unchanged, so I reused the cloned `node_modules`. No edits to any checkout, no commits, pushes, settings or credential access, and no SAP calls. |

## Verdict

**Approve. There are no must-fix items and no remaining actionable findings.**

The delta does what it says and introduces no regression:

- notes now name the actual cause of an error (N1/N2);
- minimal-error redaction is unchanged for SAP errors;
- the `resultFormat` default wording is restored;
- the N3 paragraph is moved.

Keeping N4 (equal page boundaries for both formats) and N5 (the shared response-limit wording and the
original review paths) is reasonable.

## Delta reviewed

| Area | Change | Assessment |
|---|---|---|
| `src/adt/transport-diff.ts:37-48` | `describeError` now classifies the error itself instead of reading `budget.exhausted` | See below; correct. |
| Call sites (`:574`, `:609`, FUNC lookup, part loop) | Pass only `minimalErrors` | Consistent; no call site still reads budget state. |
| `src/handlers/tools.ts` + 6 snapshot fixtures | `resultFormat`: “Default legacy: compact diff, text release. structured: full diff, JSON release.” | Restores the default for release and covers diff. Snapshots are regenerated, and the snapshot test passes 12/12. |
| `docs_page/tools.md` | Page-scope/format/VERSIONS paragraph moved into the `action="diff"` subsection, before **Parameters** | N3 is resolved. |
| `tests/unit/adt/transport-review-evidence.test.ts` | 6 new assertions: oversized response in both error modes, SAP 403 on the last allowed read in both modes with a redaction check, the send limit, and the deadline | Each targets one classification branch. |
| Validation log, README, `evidence/claude-review-2.md` | Dispositions recorded; review 2 archived | The archived copy is byte-identical to my report; the 11 original archive files still match `archive-sha256.json`. |

### `describeError` classification

The order is safe. `AdtApiError`, `AdtResponseLimitError` and `AdtNetworkError` are sibling
subclasses of `AdtError`. `AdtRequestBudgetError` (a subclass of `AdtNetworkError`) is matched
before the timeout branch.

| Error | Normal mode | Minimal mode |
|---|---|---|
| `AdtApiError` (any status, including the read that crosses a limit) | SAP message, as before | `SAP request failed (status N)`, no diagnostic (asserted) |
| `AdtResponseLimitError` | `ARC-1 response exceeded its N-byte review allowance; inspect this part in SAP.` (names the actual allowance, which can be below 1 MiB near the page limit) | same, local text |
| `AdtRequestBudgetError` | `SAP HTTP attempt limit (180) reached…` | same, local text |
| `AdtNetworkError` with `TimeoutError` cause | `ARC-1 review request time limit reached; …` | same, local text |
| Budget refusal (`Review collection budget exhausted.`) | page-budget text | same |
| Anything else | message | `request failed` |

Timeout detection holds on the real HTTP path, not only with a mocked clock. Fetch rejections are
wrapped as `AdtNetworkError(message, err)` (`http.ts:929-931`). Semaphore waits reject with the
signal's reason, which `request()` wraps the same way (`http.ts:368`). In Node 22,
`DOMException('…','TimeoutError') instanceof Error` is `true`. My end-to-end check uses a real
`AdtClient`, a local server that replies after 2 s, and a review deadline 150 ms away. In both modes
it returns `revision history unavailable: ARC-1 review request time limit reached; source evidence
was not collected.` within ~155 ms, so the abort reaches the socket.

My review-2 reproductions now give the cause-specific notes:

- **N1** (oversized first-object source): `source read failed: ARC-1 response exceeded its
  1048576-byte review allowance; inspect this part in SAP.`
- **N2** (SAP 403 on read 180): `revision history unavailable: ADT API error: status 403 at /x:
  Forbidden` in normal mode, and `SAP request failed (status 403)` in minimal mode (committed test).

## Checks run (exact head `f7598c33`, Node 22.21.1)

| Check | Result |
|---|---|
| Targeted suites (14 files): transport-review evidence/regressions/handler/limits, `transport.test.ts`, workflows, CLI review, review bounds, request-attempt budget, transport-diff, revision-feed, xml-parser, source-diff, plus my review-2 follow-up checks | **442/442 passed** |
| `tests/unit/handlers/tool-definitions-snapshot.test.ts` | 12/12 passed |
| Real-HTTP deadline classification (`claude-review-3-checks/zz-final.test.ts`, both modes) | 2/2 passed |
| `npm run typecheck` (src + scripts + tests) | pass |
| `biome check src tests scripts/demo-review-workflows.ts` | pass (1 info, the existing `package-contents.ts:48`) |
| Tool schema budget | pass; SAPTransport 6,457 B (review 2: 6,462) |
| Evidence archive integrity | 11/11 match |

Not rerun:

- the full unit suite: the delta is limited to note strings, one description and docs, and the
  affected suites plus snapshots pass. Review 2 ran the full suite at `d83cf19b` (8,933 passed), and
  your full rerun is in progress;
- `build`, `validate:policy`, the file part of `check:sizes`, `docs:build`;
- integration/E2E (no SAP calls by instruction).

## Optional (not actionable)

- The response-limit note says “ARC-1 response exceeded its … allowance”. Strictly, SAP's response
  exceeded ARC-1's allowance. The meaning is clear, and you chose to keep the shared wording.

## Limitations

- Targeted review of the delta only; the implementation was reviewed fully in reviews 1 and 2.
- No SAP access. The successful-path behavior relies on the recorded `d83cf19b` replay, which this
  diagnostic-only change does not touch.
- I used Node 22.21.1; Codex's runs used 24.11.1.

## Final verdict

**Approve PR #1008 at `f7598c3338bff11711f70b0336d93682039831e0`. There are no must-fix items.**
