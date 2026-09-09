# Model-output gap review

## Scope and acceptance

Follow-up to the [first model evaluation](../research/2026-09-09-model-output-evaluation.md).
Keep retrieval, safety gates, dependencies and input schemas unchanged. Improve only observed
misleading output or guidance. No SAP writes, SQL/table-data tests, deployment or merge.

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

## Deliberately excluded

No model-specific routing, automatic type guessing, silent format coercion, graph ranking,
new cache, new database, extra source fetches, or automatic permission changes. Quantized-model
hallucinations are evidence to retain, not a reason to keep growing the production code.
