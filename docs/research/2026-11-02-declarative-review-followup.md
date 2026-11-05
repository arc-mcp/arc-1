# Private declarative profiles: review 20 follow-up

Actual Claude Code `claude-opus-5-5`, effort `max`, accepted `243a7d40b` as a development
checkpoint with **0 High / 0 Medium / 5 Low** findings. It closed the six listed review 19 findings
and accepted the private CRUD profiles subject to adding missing deletion coverage before live
execution. The [verbatim review](broader-pinned-pp-writes/claude-declarative-crud-review-20261102.md)
preserves all limits and deviations. Its SHA-256 is `046641eb4106ac3c93acf2a7d846d19415af6161f427f97f60c1732c613a78fb`.

Reviewer first/last and author final verification confirmed **4,527 files unchanged**. The launcher
passed `--model claude-opus-5-5 --effort max`; the CLI exited successfully. One mistyped out-of-snapshot
read was refused without content. Approved checks ran sequentially, although some shared tool batches
with reads. Saved Vitest output was read; no source edit, mutation experiment or external research ran.

## Corrections

| Finding | Disposition |
| --- | --- |
| Low 1: insufficient independent guards | Added delete preflight/locked identity, denied/drifting package, recording refusal, cancellation and all-five recorded-delete `corrNr` checks; update preflight identity; direct create input checks; real configured lint/RAP/CDS rejections for create/update; BDEF extension creation; public create/delete refusal. Added the local-child/recorded-group and captured inactive-alternative cases. |
| Low 2: discarded post-save work | Pinned saves skip the DDLS where-used hint and BDEF extension hint. Their confirmed shared readback remains authoritative; single-target hints remain enabled. The former where-used call and a 503 from the BDEF hint reproduced the two failures. |
| Low 3: already-active include with a native activation flag | Classify a previously active include with no inactive alternative as `already-active` for either native group execution flag. An inactive alternative still requires a verified transition and is not classified as already active. |
| Low 4: whitespace-only creation source | Refuse nonempty input that trims to nothing before any HTTP. Omitted/empty input retains generated-skeleton creation semantics. Newline, tab and space cases reproduced the old acceptance. |
| Low 5: ambiguous test count | Label the original CRUD test count by its original checkpoint and record subsequent checks separately. |

The revised reproduction run failed exactly six cases before the fixes and passed afterward.
Its first run also caught an incomplete test URL matcher for the BDEF hint's uppercase URI; the
fixture was corrected and the reproduction rerun before changing production behavior. No mutant
was run. The new negative rows assert absence of the relevant native mutation, not only an error.

## Evidence and remaining scope

All five original GET-only metadata body hashes were recomputed by the author and matched both the
private receipts and committed fixture fields. This closes the author's digest cross-check; it does
not convert the reviewer's comparison of recorded hash fields into an independent recomputation.
The missing historical exact-group generation request/response were included in review 20. They
remain old evidence and prove neither a current group-include transition nor PP.

A separate private exact-owner activation profile for DDLS/DCLS/DDLX/BDEF/SRVD was implemented after
the reviewed snapshot. It reuses the shared orchestrator and adds bounded preaudit/active-state/source
proof. Its tests and these corrections require follow-up review. Public admission remains closed;
no live mutation, fresh PP test or cleanup was performed in this follow-up.

## Author checks on the combined follow-up

**494 files / 13,301 unit tests**, all 59 historical offline harness scenarios, three TypeScript
projects, build, lint (three existing informational findings), policy and strict documentation pass.
The complete source and test file/schema budgets are checked with this commit. CI for the previously
pushed `243a7d40b` is green, including native integration and E2E; that is not evidence for this delta.

Subsequent [read-only checks](2026-11-02-pinned-declarative-sources.md#current-read-only-native-contracts)
on clean `246b98b05` verified current native owner/source reads and observed active-version fallback.
They do not supply mutation evidence or change public admission.
