# Claude review 2 — final notebook review of arc-mcp/arc-1 PR #1009

| | |
|---|---|
| Reviewed commit | **`2f8c6600fbe9a3e691137ef20b7eb88050733bf0`** (`fix: address notebook review edge cases`; single commit) |
| Compared with | `ce1537fcab0b3d786a2b13ad1923378ec2beb111` (reviewed in [review 1](claude-review-1.md)) |
| Worktree | `/Users/marianzeis/.codex/worktrees/adt-next-stages/arc-1`, clean at `2f8c6600` on `codex/sql-notebook-runner` |
| Reviewer | Claude Code, model **Opus 5.5** (`claude-opus-5-5`), effort **max** |
| Date | 2026-10-17 |
| Method | Read-only. I read the 11-file delta and checked it in isolated `git archive` exports; the lockfile is unchanged, so I reused installed dependencies. No SAP calls, no credentials, nothing published or merged, and no shared worktree edited. |

Line numbers refer to `2f8c6600`.

## Verdict

**Approve after one small correction (N1).** Every other review-1 item is resolved, or its
documentation is updated as intended, and I found no regression.

N1 is the size-limit label. The fix does not work against the dispatcher's real reply shape, and
the validation log claims it does. It is a one-line change with a real-shape regression test, and
it needs no further review round beyond a quick check.

## Review-1 findings: verification

| # | Fix | Verified |
|---|---|---|
| F1 data-policy refusals labelled `error` | Four policy-code prefixes added to the classifier (`artifact.ts:9-12`) | **Fixed.** Through real `handleToolCall` with `runQueryBatch` throwing `DataSourcePolicyError`, the reply starts with `DATA_SOURCE_BLOCKED:` in both normal and minimal mode, and the cell is `blocked` (`zz-nb2-labels.test.ts`). The four codes match `DataSourcePolicyErrorCode`. |
| F2 empty reservation blocks retry | `runNotebook(...).catch` removes the reservation with `rmdir` (`notebook-cli.ts:59-63`) | **Fixed.** Through the CLI: a wrong target exits 2 and the directory is gone; the corrected run with the same `--output-dir` exits 0 and writes exactly `evidence.json` and `report.html` (`zz-nb2-dir.test.ts`). `rmdir` only removes an empty directory, so a populated one is preserved. |
| F3 import output over 1 MiB | Compact document size checked in `importAbapSql` (`notebook-document.ts:80`); formatted output checked before writing (`notebook-cli.ts:39-41`) | **Fixed.** My review-1 source of 1,047,561 bytes now fails instead of writing an unrunnable file; the 1,040,061-byte source still imports (1,047,642 bytes). The PR's CLI tests cover both the compact and the formatted overflow, with no file written. |
| F4 aggregate/DISTINCT completeness | Documentation only, `sql-notebooks.md` | **Done.** Conservative behavior kept and stated. |
| F5 size limits labelled `error` | `^DATA_RESPONSE_TOO_LARGE\b` or the exact 4 MiB workflow message → `incomplete` | **Partly fixed.** The 4 MiB workflow cap works. The server data-preview limit does not; see N1. |
| F6 cancellation through dispatch, 5-minute deadline | Cancellation test now goes through real `handleToolCall` and a live local socket; a new test mocks `AbortSignal.timeout` to check the 300,000 ms deadline composition | **Fixed.** Both tests are meaningful and pass. |
| F7 nits | No `startedAt`/`elapsedMs` for not-run cells; HTML shows “Elapsed: not run”; reserved `__proto__` keys documented; comment on the forward-compatible `truncated`/`complete` flags | **Done.** The fractional `rowNumber` message was left as is (optional). |
| F8 analyzer cost | Retained by design | **Accepted.** |

Also verified:

- the archived `evidence/notebook-claude-review-1.md` is byte-identical to my report;
- the follow-up table in the validation log matches the code, except for F5 (N1).

## Remaining finding

### N1 — The server size-limit label still reads `error` (must-fix, Low severity, one line)

**Where.** `src/workflows/artifact.ts:14`: `/^DATA_RESPONSE_TOO_LARGE\b/`.

**Why.** For a data-preview `AdtResponseLimitError`, the dispatcher replies with JSON
(`dispatch.ts:200-212`): `{"error":"DATA_RESPONSE_TOO_LARGE","message":"The SAP data-preview result
exceeded the 2 MiB server limit. …"}`. The anchored pattern never matches text that begins with
`{`, so the cell stays `error`.

The new regression in `sql-notebook.test.ts` passes only because it feeds the synthetic text
`DATA_RESPONSE_TOO_LARGE: the configured byte allowance was exceeded.`, which the dispatcher never
produces. The validation log states “Known server/local byte limits now report incomplete”. The
server half of that claim is not true in practice, and that is the more common of the two limits:
the 2 MiB server cap is usually reached before the 4 MiB workflow cap.

**Reproduction** (`claude-review-2-checks/zz-nb2-labels.test.ts`, real `handleToolCall`):

```text
limit  minimal=false → status "error",   reply {"error":"DATA_RESPONSE_TOO_LARGE","message":"The SAP data-preview result exceeded the 2 M…
limit  minimal=true  → status "error",   reply {"error":"DATA_RESPONSE_TOO_LARGE",…
policy minimal=false → status "blocked", reply DATA_SOURCE_BLOCKED: request denied before data execution …
policy minimal=true  → status "blocked", reply DATA_SOURCE_BLOCKED: the request was denied by the administrator's …
```

**Fix (validated in scratch):** `claude-review-2-checks/suggested-size-limit-label.diff`:

```diff
-        : /^DATA_RESPONSE_TOO_LARGE\b/.test(message) || message === 'Tool output exceeds workflow input budget.'
+        : /^(?:\{"error":")?DATA_RESPONSE_TOO_LARGE\b/.test(message) || message === 'Tool output exceeds workflow input budget.'
```

With this line, the real-shape replies become `incomplete` in both modes, and the existing
`sql-notebook.test.ts` plus my check pass (27/27). Replace the synthetic test input with the real
dispatcher shape, as in `zz-nb2-labels.test.ts`, and make the validation-log row accurate.

## Checks run (scratch export of `2f8c6600`, Node 22.21.1)

| Check | Result |
|---|---|
| Full unit suite, `--maxWorkers=4` | **319 files / 8,976 tests passed**, 144.7 s |
| `npm run typecheck` | pass |
| `biome check .` | pass |
| `npm run build` | pass |
| `npm run validate:policy` | pass |
| `npm run docs:build` (strict) | pass |
| `npm run check:sizes` | pass (file-size ratchet in a throwaway `git init` inside scratch, deleted afterwards: 670 files within budget; tool schema budget within limits) |
| Real-dispatch label check (`zz-nb2-labels.test.ts`) | policy refusals `blocked` (fixed); size limit `error` (N1) |
| CLI reservation check (`zz-nb2-dir.test.ts`) | pass |
| Import-size script from review 1 | the oversized source is rejected; the near-limit source still imports |
| N1 fix in a second scratch copy | real-shape replies `incomplete`; 27/27 tests pass |

Files: `/Users/marianzeis/.codex/reviews/arc1-notebook-review-20261017/claude-review-2-checks/`.

## Limitations

- No live SAP. The dispatcher reply shapes come from the real `handleToolCall`, with the SAPQuery
  client method stubbed to throw the real error classes.
- Node 22.21.1; Codex used Node 24.
- I didn't open the HTML in a browser; I checked it statically.

## Final verdict

**Approve PR #1009 at `2f8c6600fbe9a3e691137ef20b7eb88050733bf0` once N1 is corrected**: the
one-line classifier fix, a real-shape regression and an accurate validation-log row. There are no
other remaining findings.
