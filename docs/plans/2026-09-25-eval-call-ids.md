# Stable eval tool-call IDs (#852)

## Root cause

The Anthropic adapter drops native tool-use IDs and invents a new random ID when replaying history.
The harness independently numbers tool results. The Ollama adapter has the same correlation gap:
it drops native IDs and serializes every separate assistant call as `call_0`. The harness also splits
a parallel assistant turn into separate assistant messages. A local captured-payload reproduction
on `202ad566` proves the mismatch without an API request.

## Plan and review

1. Carry an optional provider ID on `LLMToolCall`; preserve it in both HTTP adapters. The harness
   assigns a deterministic ID once when a provider supplies none, before storing conversation history.
2. Keep one assistant turn together, then append matching tool results. Serialize all parallel
   Anthropic results in one user message. Never regenerate IDs while replaying history.
3. Respect the remaining scenario call allowance when processing a parallel response, so local/live
   execution cannot exceed `maxToolCalls`; no further request is sent with the truncated final turn.
4. Test three outgoing requests with parallel calls, preserved IDs and replay stability, plus the
   ID-less provider fallback and call cap. Keep scoring and provider abstraction otherwise unchanged.

The [Anthropic contract](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls)
requires results to refer to their tool-use IDs. Local payload assertions directly test this contract;
they are not evidence of a live provider/API run. ID-less providers use the shared fallback; CLI integration adapters are unchanged.
This is eval-only; production SAP handlers and tool schemas do not change. Roadmap checked: no impact.

Validation: all four new regressions fail on original main and pass after the fix. Full suite:
7,194 tests / 238 files; typecheck, lint, policy, size budgets, build and strict docs pass. No live
Anthropic run: the local environment has no ANTHROPIC_API_KEY. HTTP payload tests cover both
Anthropic and Ollama; no live Ollama result is claimed.
