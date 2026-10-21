# Extract bounded dump filtering from #1011

## Scope and reason

Base: current main `498c12bb`. Source: #1011 at `5725fab6`.
Add target-validated filters to `SAPDiagnose action="dumps"` and optional `feed_schema`
discovery for recovery. Preserve ordinary list/detail calls, time bounds and paging.
No syntax batching, activation logs, transport/notebook dependency, mandatory preflight,
shared schema cache, new tool or generic query engine.

The [prior decision](https://github.com/arc-mcp/arc-1/blob/5725fab6515f7a410e3e488003ae1a7aa3d8c249/docs/research/2026-10-17-diagnostic-main-decision.md)
records one model's 6→3-call rare-error retrieval and positive/negative A4H matches,
alongside smaller-model failures and context limits. This is observed task value;
it does not establish universal reliability or cross-release support.

## Implementation and plan review

1. Extract the existing dumps-only schema reader/compiler. Retain its fixed endpoint,
   strict metadata parsing, operand/grammar validation and flat AND limit of eight terms.
2. Wire only filter input and optional recovery discovery through schema, tool definition,
   handler, policy and mutation-free multi-target catalog. Review the visible fixture diff.
3. Pass the new request options only when filters are present; retain exactly `(path, headers)`
   for ordinary lists. Port only dump/schema response-limit advice, tested in both error modes.
   Share one deadline/cancellation/response budget across schema retrieval and filtered pages.
   Keep the legacy unfiltered path's wire behavior and request count. Validate dates before
   any schema request. Compose legacy `user` with filters rather than replace it.
4. Reuse the existing query encoder (literal `$query`, percent-encoded value). Refuse wildcard
   and whitespace values in typed filters until their matching semantics are qualified.
5. Add short human-facing examples and a developer routing note. Keep native wire details
   in the research record. Update FEAT-74 to the remaining qualification gap.

Plan-review questions: Does any code depend on unrelated #1011 features? Can an invalid filter
silently broaden the query? Are all pages still filtered and date bounded? Are denials checked
before I/O? Does discovery stay optional? Are input and response bounds clear and tested?

## Tests and bounded spike

| Area | Required evidence |
|---|---|
| Parser/compiler | Real sanitized 758 fixture; malformed/duplicate metadata, unknown operators, operand count, query depth, delimiter injection, date rollover/reversed range |
| Listing/dispatcher | Positive and negative matches, multiple days, paging/deduplication, user conjunction, invalid-operator recovery, unsupported schema/403 without unfiltered fallback |
| Compatibility/policy | Existing list/detail/date behavior; detail+filters refusal; placeholder normalization; read scopes, deny actions, BTP and multi-target catalog |
| Limits | Shared byte budget, deadline/cancellation and bounded page count |
| Model check | Frozen actual-main and extraction catalogs; mixed-day fixture, existing rare-error/control prompts, installed models only, bounded runtime; preserve all answers/failures |
| Live | Existing A4H/001 identity, HTTPS 443; recent row, matching predicate, negative control; no writes or generated dumps; publish aggregate evidence only |

Run focused tests first, then full unit suite, build, typecheck, lint, policy/schema budgets,
and strict documentation. Record failures honestly; only rerun affected tests when justified.
Review the immutable implementation with Claude Code Opus 5.5 Max in the GUI, address findings,
and request a focused follow-up if corrections affect behavior. Create an independent draft PR.

## #1011 disposition

Batch syntax still has observed value and remains a separate extraction candidate (FEAT-69).
Saved logs remain deferred (FEAT-71). Keep the original research and failed controls reachable
through immutable links. Close #1011 only once no useful unextracted work remains; extracting
filters alone does not meet that condition. Do not merge the new draft without a merge request.

Plan review: Claude Opus 5.5 Max approved the scope with four explicit conditions above: legacy
transport compatibility, diagnostic limit advice, filter-only dependencies, and one proven wire
encoding with narrower values. Optional equality result rechecking is deferred: it would assume
SAP case/matching semantics. Positive and negative live controls remain required.

## Fixed model check protocol (before execution)

Use the existing #1011 harness in a scratch export of `571c0a0f` (the default-placeholder
correction committed before the run), with the actual main
`498c12bb` catalog and candidate catalog. The baseline executes only old catalog inputs through
the unchanged production routes; this is a catalog/workflow comparison, not two deployed servers.
Add exactly two adjacent-day TIME_OUT rows to the synthetic world. Keep the original prompts,
strict grader, seed 1700, temperature 0, 32k requested context and 2,048 output tokens.
Run installed Qwen3.6 35B MLX and Llama3.1 8B once per arm for `syntax-one`, `dumps-recent`, and
`dumps-target` (12 trials). Stop the entire run after 15 minutes; retain any partial trial.
No prompt tuning or success-driven reruns. Report JSON grades separately from manual fact review.

### Review correction, declared before the second run

Claude's implementation review found that the filter example used the evaluation's `TIME_OUT`
predicate. Preserve the first run as contaminated exploratory evidence. Replace only the catalog
example with `MESSAGE_TYPE_X`, restore the documented dump ordering, and repeat the same twelve
trials once on that frozen revision. Keep prompts, mixed-day world, grader, models and budgets
unchanged. Report both runs separately; do not pool them or rerun failures to obtain success.
