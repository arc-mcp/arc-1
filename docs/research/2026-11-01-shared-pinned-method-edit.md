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
FEAT-93 and the broader PR remain open; IAM/XSUAA restoration and complete include qualification are
still pending.


Author validation passed **428 files / 11,557 tests**, all three typecheck projects, build, lint,
strict documentation, action-policy validation, file/schema budgets and all **59 offline
qualification simulations**. The first full run found one stale error-text assertion and one
source-hash fixture whose compact implementation shared the method's boundary lines; both were
corrected as described above, then the full suite passed. The requested independent Opus review
of this checkpoint is still pending.
