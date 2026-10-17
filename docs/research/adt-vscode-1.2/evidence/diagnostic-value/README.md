# Diagnostic value evidence

Read [the decision report](../../../2026-10-17-diagnostic-value-evaluation.md) first.
All model inputs/results are synthetic. The raw artifacts are preserved separately from later
scoring and manual interpretation.

| File | Contents |
|---|---|
| `initial-comparison.zip` / `initial-files.json` | 32 completed initial trial records, raw responses, partial checkpoints, manifests, schemas and SHA-256 hashes; Qwen's original two-repeat manifest is qualified by STOPPED.md |
| `confirmation.zip` / `confirmation-files.json` | 16 Llama follow-up trials at `552b02c3`, with explicit production normalization and the concise descriptions |
| `exploratory-runs.zip` / `exploratory-files.json` | Earlier Qwen 3.6, Gemma and Qwen attempts, including failed/incomplete attempts and stop reasons |
| `adjudication.json` | 48 initial/follow-up rows plus nine original exploratory rows: raw grades, final-grader results, reviewed answers, calls and explicit qualifications |

Unzip into a temporary directory to inspect individual trials. Manifests include exact model
digests, tool catalogs, source/file hashes, limits and seeds. Original model messages are in
`responses`; `trace.arguments` is normalized only in the final follow-up protocol, as its
manifest states. JSON format failure alone is not treated as a false factual claim.

To collect a new full comparison with installed models:

```bash
DIAGNOSTIC_VALUE_EVAL=1 DIAGNOSTIC_EVAL_REPEATS=1 \
  npx vitest run --config vitest.eval.config.ts tests/evals/diagnostic-value.test.ts
```

Run from the repository root. See `tests/evals/README.md` for model/case selection. A passing
Vitest process means evidence was collected; it does not mean the new features passed the tasks.
The final grader is `tests/evals/diagnostic-value/cases.ts`; its SHA-256 is recorded alongside the
adjudication. No paid service, model download or SAP access is needed.
