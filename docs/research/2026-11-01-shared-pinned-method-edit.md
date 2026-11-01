# Shared pinned method editing

PR #1142 now routes the already admitted pinned CLAS main-source `edit_method` through the same
class-action handler as single-target writes. Its native policy remains explicit: a registered
request-owned mutation context, exact editable hash, fresh package and recording checks before and
under the lock, one main-source save, same-session read-back, bounded cleanup and no replay.
The common dispatcher does not admit additional actions. Pinned metadata surgery, method edits in
includes and RAP remain closed until their separate adapters and qualification are complete.

## Implementation and observable behavior

`write/class-surgery-dispatch.ts` selects the existing class-action handlers. `SapWriteContext` now
requires a factory-created mutation context. `withClassEdit` keeps the legacy lifecycle for a
single-target context and selects `pinned-class-lifecycle.ts` only for a registered pinned adapter.
An absent, copied or legacy context cannot let pinned safety enter the legacy path.

`pinned-class-context.ts` owns transient per-call state in a weak map; it is not a user or target
cache. The pinned profile refuses structure reads, includes and repeated saves. `pinned-class-surgery.ts`
keeps the pinned JSON outcome contract: confirmed inactive save/hash, definitive native rejection,
unknown outcome, and cleanup status. A failed unlock or session close cannot hide a confirmed save.
Source equivalence still normalizes only CRLF and terminal newlines; other differences refuse
confirmation. The helper is shared with the existing main/include adapters.

Single-target success text, cache invalidation and cleanup precedence remain unchanged. The shared
handler now passes its existing lint/syntax warnings to the pinned result. Tool schemas, capability
rows and route gates are unchanged. The write-orchestrator size budget is lowered with its shrink.

## Author review and regression fixes

A new fault test supplied `method=value` with `source=METHOD other. ENDMETHOD.` and showed that the
old shared splicer accepted a renamed replacement when lint was disabled. This pre-existing behavior
was shared by both profiles. A complete replacement now must contain exactly one selected method
block with its actual name, including the resolved interface name. Local-class selectors still match
the bare method name in their block. Body-only edits preserve multiline AMDP headers and comments.

Whole-line extraction could also include an adjacent class or method statement. The previous
body-only guard did not cover complete replacement blocks. Both forms now refuse an ambiguous
boundary before saving. The existing source-precondition test had put an entire implementation on
one line; its success case now uses separate class-boundary lines and asserts that they survive.
Explicit negative tests retain the shared-line refusal.

The declaration-chain guard now uses the native start column, including when a chain shares a line
with another statement. This remains recognition of the observed keyword/colon range shape, not a
complete metadata validator. Before admitting signature/delete/visibility adapters, require the
selected declaration name and owner/source/range agreement and refuse other ambiguous shapes.

## Validation and limits

The handler fault tests cover hash/input refusal before submission, package/recording drift under
the lock, cancellation with independent cleanup, 403/422/429/503 and network failure without replay,
read-back failure/mismatch, and verified-save preservation on unlock/close failures. Parser tests
cover renamed/multiple blocks, shared boundaries, compact methods, interface/local selectors and
AMDP headers. Existing single-target class/RAP tests remain part of the full suite.

This change has no new live SAP or PP result. The refactored source requires a new artifact and
review before the next controlled run. Historical PP evidence remains bound to its original source.
FEAT-93 and the broader PR remain open; complete include qualification is still pending.
The original IAM/XSUAA configuration was restored and verified at 13:44:21 UTC on 1 November.


Author validation passed **428 files / 11,557 tests**, all three typecheck projects, build, lint,
strict documentation, action-policy validation, file/schema budgets and all **59 offline
qualification simulations**. The first full run found one stale error-text assertion and one
source-hash fixture whose compact implementation shared the method's boundary lines; both were
corrected as described above, then the full suite passed. The requested independent Opus review of this checkpoint is recorded below.


## Opus review at `b06ffdee6` and follow-up

The [verbatim actual Opus 5.5 max review](broader-pinned-pp-writes/claude-shared-method-review-20261101.md)
retained the checkpoint with no High/Medium finding and five Low findings. It independently passed
11,557 tests, all 59 simulations, typechecks and size/schema budgets. The 2,601-file snapshot was
unchanged before and after, and was verified again by the author. The command used
`--model claude-opus-5-5 --effort max`; the initialization event confirmed the model. The review's
statement that it cannot itself observe the effort setting is preserved.
Report SHA-256: `b29aefb860416111b6b63370a4c066ebb4763df5f192cfaad4546c720f656f18`.

| Finding | Disposition |
| --- | --- |
| Direct quality/CTS/CSRF coverage | New actual-handler tests block two real lint errors before PUT; carry lint warnings and native syntax notes through success and both cleanup failures; assert the syntax request and submitted source under the owning lock; record a verified task through its allowed parent in `corrNr` and the result; and exercise edit_method's bootstrap HEAD 503 refusal. Warning generation is stubbed only for the warning pass-through tests; native syntax parsing and the rest of the handler run. |
| Warnings lost on cleanup failure | Failure details now retain warnings alongside the verified source hash and state. Both unlock and close failure tests assert their presence. |
| Close-only outcome asymmetry | Retain the stricter edit_method refusal, with a verified-save state and hash. Other pinned main/update paths still need separate cleanup-result alignment; this follow-up does not silently broaden that behavior. |
| Start-column chain bypass | Test both the whole-line and column-sliced declaration for the observed chain opener. All three edit helpers have an off-by-one regression. Complete source/structure validation remains outstanding. |
| Other shared-line metadata helpers | Recorded separately as a remaining prerequisite below. They remain inaccessible on pinned routes. |

Additional regressions cover the exact old compact include fixture at handler level (no PUT,
unchanged source, unlock), complete AMDP blocks with matching and renamed methods, and a leading
space before a local-class selector. The pinned factory now refuses that selector before SAP.

One review claim was disproved by its suggested test: a body without its final period does **not**
fail the shared boundary parser. The splicer preserves the boundary text, but ABAP's statement
terminator rules may consume that text into the unfinished statement; this is not proof of valid
ABAP boundaries. A pure test records this limit. Real-lint handler tests block the input with the
tested default v702 parser configuration and save a valid paired control. This is not a general
syntax guarantee: releases above SAP_BASIS 758 downgrade parser errors to warnings, custom lint
configuration can override rules, lint exceptions fail open, and an administrator can disable lint.
The guard checks selected names and replacement shape, not complete ABAP syntax. Activation remains
separate; no SAP activation result is claimed for this malformed input.

Phase labels also became more precise at `b06ffdee6`: package failures report `package-preflight`
instead of `validation`; source reads and edit preparation report their own phases instead of
`locked-policy`. These `unchanged` failures still mean no save was submitted.

The offline harness simulations exercise their mock backend, not the refactored production route.
Direct handler tests exercise the route; the next real PP run remains required. Successful GitHub
Node 22/24 tests and the other completed CI checks were observed at `b06ffdee6`; SAP integration
was still running when checked. This is not whole-PR acceptance.

## Remaining metadata-surgery prerequisite

Independent of this main-method adapter, the native-range signature/delete/visibility helpers use
whole-line replacements. A line such as `PUBLIC SECTION. METHODS x.` or a shared implementation
boundary can still include neighboring statements. This is a pre-existing single-target issue
identified by code reading, not newly demonstrated live behavior. Do not admit these helpers on
pinned routes until owner/source/name/range checks and a shared safe splice or explicit refusal
cover those shapes. The declaration-chain opener check is not a substitute for that validator.

Author validation of this follow-up passed **428 files / 11,572 tests**, all three typecheck
projects, build, lint, strict docs, file/schema budgets and all **59 offline qualification
simulations**. It adds 15 regressions without a new admitted action. Follow-up Opus review and a
fresh artifact-bound PP run remain required.


## Opus review at `771aff1c6`

The [verbatim Opus 5.5 max review](broader-pinned-pp-writes/claude-method-quality-review-20261101.md)
retained this checkpoint with no High/Medium finding and five Low findings. All 11,572 tests,
59 simulations, typechecks and size checks passed independently. Its 2,605-file snapshot was
unchanged before/after review and on the author's subsequent verification. The launcher used
`--model claude-opus-5-5 --effort max` and the initialization confirmed the model.

The follow-up qualifies the missing-period claim above, adds an unstubbed lint success case and
`parser_error` assertions, replaces the syntax fixture with the processed native `/checkruns`
shape, and corrects cloud evidence timestamps and retrospective script-hash wording. Transport
reporting on incomplete saves remains part of the already identified cleanup-result alignment.
GitHub checks at this revision, including SAP integration and end-to-end tests, passed; these are
not the pending two-identity pinned PP qualification. No new capability is admitted by this follow-up.
