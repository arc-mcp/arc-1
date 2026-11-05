# Native protocol probe: ninth- and tenth-review follow-up

**Historical pre-run checkpoints.** The subsequent [first native run and corrections](2026-11-02-native-function-protocol.md) record its failed readback and completed individual recovery.

This checkpoint addresses the [ninth Opus 5.5 max review](broader-pinned-pp-writes/claude-function-contract-review-20261102.md)
of `1d2022d020af8b2ba657ca22645dc98b1fc446ea`. That review found two Medium and eight Low issues
and explicitly advised against running the native probe at that revision. The report is copied
verbatim (SHA-256 `5b8bec79d87953e6e6f01a8d3b77a464da8b5c48c12418ed84b1bd2008eb77a7`).
The following are author dispositions pending another independent review. No live mutation was
performed for this follow-up, and no temporary access or cloud configuration remains from the
historical PP qualification. The native probe still has not run.

| Finding | Change and evidence |
| --- | --- |
| 1: startup safeguards | Reuse diagnostic-environment and real-workspace-root checks before reading `.env`; bind stored credentials to canonical HTTPS A4H origin. Actual CLI subprocess tests reject disabled TLS and an ignored copied source tree inheriting its parent Git HEAD. |
| 2: local guard refusals | Record `refused-before-send` with method, sanitized path and reason. A typed local-only error distinguishes an unsent mutation from a native rejection or an uncertain result. Guard reads use the owning session's observed transport; metadata is captured before identity assertions. Tests cross the actual shared creation, source-update and deletion boundaries. |
| 3: lock-handle logs | Central audit redaction now covers structured lock handles, relative request-path queries and free-text assignments. Native wire requests are unchanged. |
| 4: DELETE deadline | Refresh the per-request clamp after guard reads while preserving the outer deadline and the same attempt allowance. An expired outer deadline prevents the DELETE. |
| 5: internal replay | `noReplay` now prevents direct Fetch's internal HTTP 421 replay and automatic redirects even without an explicit attempt budget. CSRF bootstrap requests remain separate operations. Seven loopback cases failed on the previous code and pass after the fix. |
| 6: unknown creation | Pending creation survives immediate typed 404s, blocks parent cleanup and remains explicit in the final result. Lock/session cleanup issues also remain explicit. The actual runner test covers uncertain module creation followed only by 404s. |
| 7: source proof and parser | Prove prepared function source before metadata creation. Remove the initially reproduced parameter-name and trailing whitespace overlaps; a residual TYPE separator overlap is addressed below. The old parser exceeded a five-second child-process deadline on one malformed 200,000-space parameter line; the bounded regression covers that line and valid VALUE/OPTIONAL/DEFAULT variants. |
| 8: activation recovery | Recovery wording is conditional on SAP having received the activation request. Queue/CSRF failures cannot imply an activation was sent. |
| 9: boundary tests and inventory | Separate importable orchestration from credential/filesystem startup. Exercise real handlers with authored native responses, creation builders, the group identity branch, the 64 KiB frame refusal, preflight zero-PUT/unlock, mismatched readback and non-modifiable-lock cleanup failure. Replace the lossy function/include listing with the full returned tree plus active/inactive metadata, generated source and all three text parts. |
| 10: README | Correct the PP harness cross-reference and link this follow-up. |

## Cleanup evidence and limits

Before child creation, the probe requires 15 successful reads: the returned group structure,
active/inactive group metadata, main/TOP/UXX source and symbols/selections/headings. Only the two
generated includes and an optional pool entry are accepted in that structure. Immediately before
group deletion, the owning session and pool lock protect rechecking the baseline; an unavailable,
additional or changed item refuses deletion. Function cleanup also checks active source against
recorded generated or verified-save states. A separate author-run reproduction called the prior
`getFunctionGroup()` projection and showed that it missed an added screen; this reproduction is not
a committed or independently executed regression. The committed inventory tests reject that screen; the generic listing API is unchanged.

This is **not a transactional or complete SAP inventory**. Native structure mapping can omit
unmappable workbench entries, and text parts are limited to the current language. Unknown native
side effects, missing active versions, changed generated source or unexpected metadata preserve
fixtures for inspection. The first run may stop before completing the intended protocol capture.
Do not broaden guards or rerun the full probe to force cleanup. Journaling cannot guarantee
recovery after SIGKILL, storage failure or host loss. Signal handling is cooperative.

GET-only A4H/001 checks on 2 November confirmed `ExceptionResourceNotFound` for a missing group
and a missing module, and vendor content types for the three active text parts of `SU_USER`.
The latter bodies matched the earlier active/inactive GET captures. Private receipts are under
`pr1142-function-guard-get-readonly-2026-11-02T02-34-35.426Z`; they contain no mutation evidence.
The raw tree/multi-version observations and mapper source inspection remain private research.

## Qualification status

At `abcb541a`, author checks passed: **473 files / 12,720 unit tests**, all three TypeScript projects, build,
135-entry policy validation, lint (four existing informational notices), size/schema checks,
strict documentation and 59 historical harness simulations. The source benchmark also passes.
The new runner tests are authored simulations, not SAP or PP qualification. The last live PP
artifact remains `77e41fdcd`; current bytes still require fresh two-writer and recording-transport
qualification. Public function-family admission, native activation completion, the remaining
object/management families and whole-PR acceptance remain open. FEAT-93 and PR #1142 stay open/draft.


## Tenth review and further author correction

The [tenth Opus 5.5 max review](broader-pinned-pp-writes/claude-native-probe-hardening-review-20261102.md)
of `abcb541a38d5217f2865fd0d69778b1c7e88fb2d` reported no High or Medium findings and eight Low
findings. Its verbatim report has SHA-256
`43b6f5f0107126d4f7a5d513c5a52a244dd5e5c583e022fb55f5c715ba3a5ee4`.
The review allowed one native run of those exact bytes, subject to its conditions. **That run was
not performed.** Subsequent author testing reproduced an additional cleanup problem, so the
following changes need another review before a native run:

| Finding | Correction and evidence |
| --- | --- |
| 1: clean installation test | The copied-script refusal test creates its temporary directory directly inside the existing ignored `node_modules` directory. Both CI and the review had failed because `.cache` was absent. |
| 2: remaining parser overlap | Reproduced the TYPE + 200,000 spaces + embedded CR stall with a five-second child-process deadline. The parameter type capture must now start with a non-whitespace character. The bounded regression adds CR, U+2028 and U+2029. |
| 3: delete journal | Omit source-write state/phase fields for deletion; the real deletion result remains authoritative. Runner assertions cover the journal shape. |
| 4: uncertain LOCK | Record refused 3xx and response-limit failures as unknown locks. Actual lifecycle tests assert no mutation, redirect follow or invented-handle UNLOCK. |
| 5: embedded credentials | Scrub embedded URL userinfo in relative audit paths, preserving the native wire path. A regression checks both secret removal and retained harmless context. |
| 6: near-expired DELETE | Require at least five seconds after guard reads; boundary tests cover exactly five seconds, less than five seconds and expiry. Preserve the original deadline and allowances. |
| 7: response size | Apply a 2 MiB streaming response allowance, including error responses, before buffering. Guard reads and the subsequent DELETE share the same allowance; tighter caller budgets are retained. Real loopback tests cover chunked 200 and 500 responses. |
| 8: evidence wording | Distinguish the author-run projection reproduction from committed tests and record the remaining parser issue explicitly. |
| Additional author finding | A failed source save followed by a typed current 404 could skip the module and delete its parent. The pre-fix runner reproduction sent one parent DELETE. Uncertain module work now blocks parent cleanup; an explicit `inspectionRequired` ledger survives even when both current owners return 404. Both cases execute real shared handlers with authored native responses and assert zero DELETEs. |

These tests remain simulations or local loopback checks, not native SAP or PP qualification.
No new cloud, role or destination changes were made. The accepted broader PR scope and fresh
PP qualification remain outstanding; neither review grants whole-PR acceptance.

Author checks for this follow-up pass: **474 files / 12,730 unit tests**, all three TypeScript
projects, build, lint (four existing informational notices), policy/schema/size validation, strict
documentation and the 59 historical harness simulations. Independent review and CI are pending.
