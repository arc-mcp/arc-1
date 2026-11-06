# Bounded syntax checks: extraction from #1011

## Decision

Keep one small addition: `SAPDiagnose(action="syntax", objects=[{type,name}], version?)`.
It reuses the existing bounded object-list input. Single-object checks, ATC and activation
remain separate. There is no collector, scheduler, source cache or automatic retry.

The [plan](../plans/2026-10-19-bounded-syntax-checks.md) records the reviewed contract.
Measurements used `e3a5fd95`, based on #1020 head `c23d6291`. After #1020 merged as
`b57006ff`, [draft #1029](https://github.com/arc-mcp/arc-1/pull/1029) was rebased onto main.
Published implementation `033ec8cc` has the same tree as `e3a5fd95`; rebased evidence commit
`e1752f3e` has the same tree as pre-rebase `f5140ebe`. Both comparisons passed. The validation
below therefore applies unchanged; the final follow-up only updates research status.

## Live SAP evidence

On 19 October (Berlin), `scripts/probe-syntax-batches.ts` exercised the real dispatcher on
A4H/001 via HTTPS 443 and the existing Basic identity. SAP_BASIS 758 SP02 was previously
recorded, not re-probed. Seven native syntax-check POSTs; no mutations or fixture writes.

| Check | Result |
|---|---|
| Active CLAS / PROG / INTF / DDLS batch | Four checked; results match all four individual checks. DDLS retained three warnings. |
| Same inactive batch | Existing program error retained; other objects passed. DDLS warnings retained. |
| Class plus absent program | Program failed with SAP's native message; never reported as passed. |

The earlier wire spike returned reports in DDLS/CLAS/INTF/PROG order. Public results preserve
request order by matching reporter and object URI. Missing, duplicate or foreign reports stay
incomplete; a known failure is retained even when another result is missing.

SAP marks the absent program report as processed with a syntax error. `checked` means the native
check was processed, not proof that the object exists. `requestedVersion` and `checkedAt` are
request evidence; SAP supplies no immutable source hash or independent version confirmation.

[Live summary](bounded-syntax-extraction/evidence/live-summary.json). Full SAP results remain private.
Digests below identify the saved responses, not source-code versions:

| Case | SHA-256 of serialized result |
|---|---|
| Active | `134d5efdb2c5285eda447df6d50ffb035a5cf32c4f465ac65a4f6752affe68ec` |
| Inactive | `a7aadab4cfe2696a313dbdcd57a969880d485e35b8e86b623398c36f883afa24` |
| Absent | `9e9e53ece17da91fd378914a3784e802009b93d9dd60b60ffe80225e3a791bc9` |

## Model comparison

The opt-in `scripts/eval-syntax-batches.mjs` compared each revision's built dispatcher and full
nine-tool read-only catalog against identical offline native fixtures. Two models, two tasks,
baseline/candidate, one trial each; temperature 0, seed 1700, requested context 32,768 and output
limit 2,048. No SAP credentials/network calls or batch hint in the prompt.

| Model / task | Baseline | Candidate |
|---|---|---|
| Qwen 3.6 35B MLX / single control | Correct; 1 call, 48 result bytes | Correct; 1 call, 458 bytes |
| Qwen 3.6 35B MLX / mixed four | Correct; 4 calls, 683 bytes | Correct; 1 call, 1,116 bytes |
| Llama 3.1 8B / single control | Failed; 1 call, no stored check | Same failure |
| Llama 3.1 8B / mixed four | Failed; 4 calls, no stored checks | Same failure |

Qwen preserved the error and missing-report verdicts. It also chose a one-item batch for the
single control, increasing output size. Llama supplied `source="active"` instead of `version`;
the stored-check fixture refused that proposed-source route. Its multi-object answers then made
unsupported pass/fail assertions. These trials are failures, not evidence about SAP's handling
of arbitrary supplied source. Maximum prompt count was 12,916, below the requested context limit.

This supports fewer round trips for explicit lists on Qwen, not universal reliability, lower
result bytes or a measured SAP latency improvement. One trial per case is not a benchmark.
[All eight raw trials and summary](bounded-syntax-extraction/evidence/local-models/) are preserved;
no failures were retried. The original harness is frozen at `e3a5fd95`. Successful type/name calls
and final answers were manually verified. Follow-up harness hardening matches exact type/URI,
and the live probe now compares full messages; the saved live messages already match in all
four cases. These changes do not add model trials or alter their recorded grades.

## Review and limits

- All 9,542 unit tests in 341 files pass. Build, all three typecheck projects, lint, policy,
  file/schema budgets and strict documentation build pass. No test timeout or assertion was relaxed.
- Runtime remains in one 138-line native batch module and the existing syntax handler.
  Native message mapping is shared directly; no XML reserialization or diagnostic framework.
- Bounds: 1–20 distinct objects, four qualified families, 30 seconds including CSRF,
  512 KiB, 100 reports and bounded parser nesting. Names and XML are validated/escaped.
- Read scope and existing syntax deny rules apply before I/O. Tests cover BTP schemas,
  pinned/aggregate per-user clients, audit identity, cancellation and response budgets.
- Full catalog: 74,960 bytes, 37 fewer than the baseline; no schema ceiling was raised.
  The existing schema-file ratchet grows by 17 lines for batch validation.
- Live BTP/PP and other releases are not qualified. Transport integration requires separate
  source reconciliation. FEAT-69 now records these remaining qualification gaps.
- Codex reviewed the plan, parser ownership, schema/handler alignment, policy, tests and docs.
  Claude Code Opus 5.5 Max GUI review remains pending: macOS denied assistive access.

## What remains from #1011

Dump filters are merged through #1020; this extraction preserves bounded syntax checks.
The broad diagnostic framework is unnecessary. DDIC logs remain deferred: a readable saved
log does not establish the latest activation attempt, and prior model controls misread it.
Keep FEAT-71 and the immutable [failed controls and decision](https://github.com/arc-mcp/arc-1/blob/5725fab6515f7a410e3e488003ae1a7aa3d8c249/docs/research/2026-10-17-diagnostic-main-decision.md).
Close the umbrella only after this focused extraction has completed review.
