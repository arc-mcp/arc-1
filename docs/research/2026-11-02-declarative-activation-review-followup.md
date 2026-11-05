# Private declarative activation: review 21 follow-up

Actual Claude Code `claude-opus-5-5`, effort `max`, accepted `70d4e83b` as a development
checkpoint with **0 High / 0 Medium / 3 Low** findings. It closed all five review 20 findings.
The [verbatim review](broader-pinned-pp-writes/claude-declarative-activation-review-20261102.md)
has SHA-256 `49b0d8b19e62678617334b2824951cc5c671c62bf6ca666ce2f1e4da919a1d75`.
Reviewer first/last and author final verification confirmed **4,538 files unchanged**; the CLI
exited successfully. The launcher specified `--model claude-opus-5-5 --effort max`.

## Corrections

| Finding | Disposition |
| --- | --- |
| Low 1: no-draft owners reported activated | Declarative owners and FUNC now use the captured native version and inactive alternative to report `already-active`. A captured draft over an active version still reports `activated` after verification. Added all-five declarative rows and a FUNC row. |
| Low 2: missing guard/budget evidence | Added missing/unknown native version, foreign/duplicate state-link and all-five draft-over-active rows. Budget rows now observe the real `AdtResponseLimitError` thrown by the streaming budget, so XML parsing, a 503 or later source mismatch cannot substitute for cap enforcement. |
| Low 3: recording stability and reference wording | Retain the first pinned owner recording context and refuse locality/request changes before confirmation. The new row moves between two independently allowed requests. Native reference identity/deleted fields are described as validated when present. |

The corrected reproduction run failed exactly **seven** cases before production changes: five
declarative no-draft labels, the FUNC label and a change between allowed recording requests.
An earlier run also failed four overly specific message assertions: the result boundary deliberately
hides non-safety error messages. Those tests now observe the actual budget exception without changing
its implementation; the reproduction was rerun before production edits. No mutant ran.

The reviewer ran all **494 unit files / 13,301 tests**, 59 historical harness scenarios, three
TypeScript projects and file/schema budgets successfully. Its approved checks were sequential and
in separate batches. A mistyped path outside the snapshot and an oversized read were refused without
content; saved Vitest output was searched. No edits, live execution, network or delegation ran.
The report preserves the full limits, including unobserved state-link/version selection semantics.

## CI and next workflow

CodeQL on `70d4e83b` reported a high-severity incomplete-encoding alert in a negative test's deliberate
single replacement. Inspection confirmed it constructs a malformed URI for rejection, not runtime
escaping. The test now uses the same malformed URI literally. Current-revision CI must confirm this.

Six disposable CDS/RAP fixtures and dependency preservation have fifteen offline checks. This is
preparation only: no executing native runner, native compilation/mutation or public admission was
added. The [source-family record](2026-11-02-pinned-declarative-sources.md) states the syntax sources
and qualification limits. All prior native fixtures and temporary permissions remain restored.

## Author validation

**495 unit files / 13,332 tests** pass, along with all 59 historical harness scenarios, three
TypeScript projects, build, lint (three existing informational findings), policy, strict docs and
file/schema budgets. Typecheck initially caught a redundant comparison already excluded by the
outer branch; removing it preserved behavior and typecheck/build then passed. These changes and fixture preparation still require independent follow-up review.
Roadmap FEAT-93 remains open for the accepted broader implementation and qualification gaps.
