# Declarative fixtures and shared activation: review 22 follow-up

Actual Claude Code `claude-opus-5-5`, effort `max`, accepted `63303383` as a development checkpoint
with **0 High / 0 Medium / 5 Low** findings and closed all three review 21 findings. The
[verbatim report](broader-pinned-pp-writes/claude-declarative-fixtures-review-20261102.md) has SHA-256
`3968d37f963cbc648ffc8cc126b4538878204db5e6ce26a34c9b2c1b36b7ce88`.
Reviewer first/last and author final checks confirmed **4,542 files unchanged**; the CLI exited
successfully. The launcher specified `--model claude-opus-5-5 --effort max`.

## Corrections

| Finding | Disposition |
| --- | --- |
| Low 1: saved draft with an active alternative | Five additional cases capture `inactive` with an exact `version=active` link, then verify activation through two POSTs. This tests a known FUNC shape without claiming it has been observed on these types. |
| Low 2: public recorded activation | CLAS and PROG now each have stable and between-allowed-request drift cases through the public pinned handler. Group INCL has a child drift case while the group itself is unlocked; it reaches the shared recording comparison. |
| Low 3: dependency edge coverage | Assert the exact six-resource/four-edge map, so an omitted DDLX/BDEF/SRVD edge cannot leave cleanup tests green. |
| Low 4: preflight overclaim | Check initial and updated sources, declarations and referenced targets. Document that only DDLS reaches a parser; BDEF/DDLX get narrow pattern checks and DCLS/SRVD get no grammar check. |
| Low 5: unlabelled historical count | Label the original 494-file/13,301-test result by `246b98b05`. |

These are coverage/documentation corrections; no new production runtime behavior was needed.
The positive recorded PROG fixture initially omitted its legitimate text-pool read; supplying that
native active-pool response completed the test. No mutant or live experiment ran.

## Independent and author evidence

Review 22 independently passed **495 unit files / 13,332 tests**, all 59 historical harness scenarios,
three TypeScript projects and size/schema budgets. Its one mistyped out-of-snapshot read was refused
without content. Approved checks ran sequentially in separate batches; saved Vitest output was
searched. The report preserves native-state/fixture-source uncertainty and all execution deviations.
CI at `63303383` is now fully green, including the test-only CodeQL correction, integration and E2E.

The [new native harness](2026-11-02-native-declarative-qualification.md) was built after that snapshot.
Its workflow, transport guards, real-adapter mocked lifecycle and entrypoint are offline tested;
its source and these review corrections still require independent review before native execution.
No new live writes or permission changes have occurred. Roadmap FEAT-93 remains open.

Author checks passed: 500 unit files / 13,394 tests before the last test-only corrections, then
60 focused tests after correcting an argument-table typing issue and adding four independent receipt
refusals. All three TypeScript projects, build, 59 historical harness scenarios, policy, strict docs
and size/schema budgets passed (984 files / 12 scenarios). Type checking found that the new CLI
negative table spread argument arrays; it now passes explicit named arrays and verifies the intended
argument rejection. The four new cases preserve a create when its independently read marker,
author, source MIME or source content does not match. No runtime production code changed.
