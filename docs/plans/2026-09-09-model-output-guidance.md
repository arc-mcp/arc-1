# Evidence-driven tool guidance and context output

## Objective

Improve the answers that models produce with ARC-1 without adding a deployment, model dependency,
database, new tool, or broader SAP permission. Live relations remains experimental and default-off.
The change is built on PR #769; comparison main is `c55adcb8`, and the original branch is `360b63e3`.

## Evidence and research

The initial live evaluation used ten identical prompt pairs with GPT-5.6 Sol. It showed correct
cache widening on the branch and useful package-scoped exploration, but no general tool-call saving.
The model often ignored relations, confused root dependency counts with recursive totals, and made
eight rejected DDIC `format=structured` requests. A tiny graph sample contained no class to inspect.

Source inspection explains plausible contributors: SAPRead, SAPContext and initialize instructions
all unconditionally recommend dependency context for understanding behavior. Adding a competing
relations sentence is insufficient. A first Qwen/Ollama prototype confirmed this: the map task
exceeded eight calls, and another task produced an answer without evidence. Those trials are failures,
not discarded samples. A second prototype removes the conflicting instructions before retesting.

OpenAI recommends keeping tool-specific usage guidance in the tool description and measuring
reasoning/prompt changes against representative examples.[1] Anthropic recommends evaluating complete
tool trajectories, preserving valid alternative workflows, and checking tool errors as well as final
answers.[2][3] Ollama supports direct function schemas and an explicit model/tool-result loop, allowing
the same live MCP tools to be tested without introducing Ollama into ARC-1 itself.[4]

These sources support the experiment design; they do not establish that any proposed wording improves
ARC-1. That decision depends on recorded local model answers and deterministic tests.

## Scope and alternatives

| Option | Decision | Reason |
|---|---|---|
| Consistent source/context/relations descriptions | Test, then implement | Smallest fix for observed wrong tool selection; no runtime authority change |
| Context count/provenance labels | Implement with regression tests | Current root-versus-recursive arithmetic permits false completeness claims and negative `depsFiltered` |
| Clear DDIC format guidance and retry hint | Implement, preserve rejection | Avoid needless calls without silently coercing arguments or changing result shapes |
| Automatic type lookup for every failed dependency | Defer | Adds SAP calls, authorization and budget complexity; not needed to clarify a failed read |
| Graph node ranking / new type filter | Defer | Existing typed where-used serves small class-consumer samples; preserve graph semantics |
| Compact graph URI-ID encoding | Defer | Breaks output compatibility; offline byte savings have not proved better model answers |
| Model-specific code, prompts, or Ollama integration in core | Reject | Runtime remains vendor-neutral; local evaluation harness only |
| Hide or enable data-gated hierarchy automatically | Reject | Keep existing permissions and discovery behavior; describe the limitation accurately |

## Implementation contract

1. Replace conflicting recommendations, not append more policy. Behavior/known links use targeted
   source; public dependency contracts use SAPContext; CDS impact retains its specialized workflow.
   Remove blanket token-saving claims from the generic routing advice.
2. Recommend native metadata neighborhoods only inside the existing enabled relations definition.
   CLAS/INTF roots only; DDIC nodes remain visible boundaries. Use selected source follow-ups rather
   than fetching context and graph automatically. Prefer typed references for class-only tiny samples.
3. Keep all tool names, action enums, parameter types, safety gates, scope rules, query budgets,
   cache revalidation and live-relation serialization unchanged. Default descriptions can improve;
   default clients must not acquire graph parameters or graph guidance. Review snapshot text changes.
4. Preserve the context first summary line and individual contracts/error evidence. Clearly identify
   source-derived evidence, root candidates after filtering, root candidates not fetched, and totals
   across explored levels. Do not infer global coverage or an exact pending count for deeper levels.
   Correct `depsFiltered` to count unattempted root candidates, never root count minus recursive total.
   Count actual output lines, not the number of string chunks appended to an array.
5. State that a failed class/source read does not prove the name is absent as another object type.
   Do not invent a DDIC type or suppress the error. No automatic retries or extra lookups.
6. Ordinary non-CLAS `format=structured` remains rejected before fetching the object. Explain the
   valid retry (`format=text` or omitted). Preserve JSON diff support and existing early metadata paths.
7. Update human/LLM-facing docs and focused tests together; no generated SAP source in Git.

## Experiment sequence

1. Retain the original 20-answer GPT baseline. Verify current main remains pinned to the same fetched
   commit. Keep original branch and main worktrees unchanged; implement in a third worktree.
2. Run actual Qwen and Gemma calls through the local Ollama endpoint. Record installed model names,
   digest, requested settings, exact prompts, schemas/instructions, tool results, final answers, failures
   and truncation. Do not count aliases of the same model digest as different models.
3. Prototype description/output-label changes in the private evaluation adapter, labeled as simulated
   output presentation—not shipped server behavior. Preserve raw results separately. Include maps,
   package boundaries, tiny samples, exact source links and sequential cache widening.
4. Review all results, including regressions. Replace contradictory wording; do not tune to fixture
   names or hardcode expected answers. Freeze the candidate before the final comparison.
5. Implement the selected small change, run focused and complete unit gates, typecheck, lint, policy,
   build, file-size and schema-token ratchets. Review every changed snapshot/property and default-off
   relations guard. Existing external dependency findings must not trigger unrelated upgrades.
6. Run actual model loops against candidate versus main with identical prompts per model. Use the
   original ten tasks plus held-out prompts about other existing objects or a different question.
   No prototype overlays in final tests. Repeat important failure cases across model families.
7. Inspect answers against source/metadata, not merely fluent prose or tool-call counts. Save unedited
   answers and publish aggregate findings with caveats. Leave local instances ready for manual testing.

## Acceptance and stop rules

- Deterministic tests must prove unchanged retrieval/authorization behavior and correct scope-aware
  counts, including depth > 1, limits, empty results, failed reads, case-insensitive names and CDS.
- Model comparison must show useful evidence-backed outcomes for maps and boundaries without turning
  exact source questions into graph traversals. Tool use is a diagnostic, not the objective itself.
- Check invalid-format calls, fabricated no-call answers, runtime/implementation overclaims, missing
  truncation caveats, count subtraction, unverified package expansion, and call/word-budget adherence.
- A failed sample stays in the report. One sample/model is exploratory, not a significance test;
  improved model behavior cannot substitute for runtime safety.
- Stop when the small implementation passes full gates and cross-model checks support the intended
  improvements with no unresolved implementation defect. Document residual model limitations rather
  than adding a framework or endlessly polishing one prompt until it passes.
- No SAP writes, business-data queries, new BTP resources, public model endpoints, merge, or force-push.

## Sources

1. OpenAI. [Model guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.6), accessed 2026-09-09.
2. Anthropic. [Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents), 2025-09-11.
3. Anthropic. [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents), accessed 2026-09-09.
4. Ollama. [Tool calling](https://docs.ollama.com/capabilities/tool-calling) and [chat API](https://docs.ollama.com/api/chat), accessed 2026-09-09.
