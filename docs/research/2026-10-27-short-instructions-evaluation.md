# Short server instructions: decision for #957

**Decision (October 29, 2026): do not ship short mode.** Keep the existing full server
instructions. The proposed `ARC1_SERVER_INSTRUCTIONS` setting is not available.

The Windows startup problem has a practical alternative: the release executable, with
[setup and update instructions](../../docs_page/local-development.md#windows-setup-and-updates).
[Claude Code timeout guidance](../../docs_page/local-development.md#claude-code-startup-timeout)
explains how to allow a slower launch. Neither changes npm/npx itself.

## Evaluation behind the decision

We compared the unmerged prototype at `a58a364c52f5263b6cc840c7c3fa142f74be3f88`:
eight selected synthetic tasks, three repetitions per mode, using Codex `gpt-5.6-sol`
and Ollama `qwen3.6:35b-mlx` — **96 scored answers**, with no live SAP access.

- Known-method reads and signature listings passed in both modes. Most task scores tied.
- When requirements were missing, Codex full distinguished current behavior from business
  intent in 3/3 answers; short did so in 1/3. Qwen failed this distinction in both modes.
  Full also prompted more requirements lookups during draft reviews. Neither mode guaranteed
  correct answers or usable ABAP examples.
- Ollama saved **371 input tokens (about 2.9%, including the tool catalog)** per initial
  prompt. No speed improvement was established. This single-connection result does not
  measure savings in the reporter's proposed one-full/eight-short setup.

These tasks deliberately exercised guidance removed by short mode. They do not establish a
universal quality penalty or a model ranking. Claude graded answers blind to the mode;
a subsequent unblinded audit corrected five Qwen grades. Client-policy retries and retained
fixture gaps limit claims about tool-use reliability. Generated ABAP was not compiled or run.

For now, the demonstrated benefit does not justify another setting and the lost guidance.
Reconsider if a real multi-connection setup shows worthwhile savings while preserving answer
quality. Mixed-instance instruction sharing was not tested here.

The [evidence archive](short-instructions-evaluation/evidence.zip)
([SHA-256](short-instructions-evaluation/SHA256SUMS)) retains the full historical report in
`REPORT.md`, prompts, settings, answers, tool traces, grading and methodological limitations.
Roadmap checked: **No roadmap impact**.
