# Model-output gap review

Status: implemented and verified. Findings and retained limitations are in the
[gap-review report](../research/2026-09-09-model-output-gap-review.md).

## Scope and acceptance

Follow-up to the [first model evaluation](../research/2026-09-09-model-output-evaluation.md).
Keep retrieval, safety gates, dependencies and input schemas unchanged. Improve only observed
misleading output or guidance. No live SAP writes, SQL/table-data tests, deployment or merge.
Offline mocked data-access failures are included in regression tests.

1. Preserve optional interface-enrichment warnings in both where-used response envelopes.
   A rejected enrichment must not remove native evidence or expose raw diagnostics.
2. Label reference counts at the point of use: entries, not distinct objects or runtime calls.
   Preserve existing count fields, paging and result arrays, including empty results.
3. Put DDIC format guidance near the start of SAPRead; state hierarchy prerequisites and
   suggest class MAIN source without changing permissions. Local `definitions` is not MAIN.
4. Clarify incoming class-consumer versus outgoing graph selection. Retain the opt-in gate.
5. Run regression tests, compare actual model answers with a pinned pre-change build and
   main, and retain failures. Review correctness, not just completed sessions or fewer calls.
6. Run the full unit suite, typecheck, lint, policy, build, file/schema budgets and docs build.
   Keep only defensible improvements and record residual failures in the research report.

## Final follow-up acceptance

- Clarify global MAIN versus local helper-class includes without changing source routing.
- Make truncated-reference hints acknowledge an already-applied object-type filter.
- Repeat the original ten model comparisons against pinned main, add executed follow-up
  reads, and check two installed Ollama models. Record task failures, not just completion.
- Recheck live read-only behavior, cold/warm controls, all local gates and the complete
  unpushed diff. Push the existing PR only after review; do not merge.

## Deliberately excluded

No model-specific routing, automatic type guessing, silent format coercion, graph ranking,
new cache, new database, extra source fetches, or automatic permission changes. Quantized-model
hallucinations are evidence to retain, not a reason to keep growing the production code.
