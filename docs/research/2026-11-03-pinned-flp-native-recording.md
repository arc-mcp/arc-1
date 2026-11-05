# Private native-governed classic FLP recording

This independently reviewed private implementation remains unqualified natively and under PP; public admission is closed.
`handlers/pinned-flp-native-recording.ts` adds an internal entry through the existing
`adt/pinned-flp.ts` lifecycle. Ordinary single-target calls and the separate disposable observation
entry retain their behavior. Neither dispatch nor the capability matrix admits the new entry.

## Source-backed contract

The captured active A4H/758 PAGE_BUILDER_CUST implementation obtains configuration transport data
for the exact key/scope and passes TRKORR_CUST to the factory with `mode_no_dialog` when no FDM usage
context is bound. Its transport settings use `-` as the no-request sentinel. The inherited transport
handler is decisive: for client-customizing objects, no-dialog mode permits completion with empty
or sentinel transport context. A supplied nonsentinel request goes directly to native CTS handling;
failure cancels without an interactive fallback. Native authority, enqueue and changeability checks
precede content editing. There is no requirement in the accepted plan that every FLP change must be
recorded; the requirements are known native recording behavior and allowed selection.

The normal CTS path calls native insertion and can return success with no recording. The special
customizing-W branch suppresses the native chooser dialog and handles invalid request/type,
user-not-owner and other native errors. The outer handler does not propagate the actual returned
request or use its no-recording flag as a recording receipt. Completion, a supplied/default request,
and HTTP success therefore cannot prove the actual recording request/task.

The four decisive private active-source hashes are:

| Class | SHA-256 |
| --- | --- |
| `/UI2/CL_EDM_PERS_WD_UTIL` | `bebff192f53f75d89e1c017d77b6fe4b5ce08224b91cc14ab5ec4b01d19836bc` |
| `/UI2/CL_WDR_TRANSP_SETTINGS` | `9b63f03e68d40a1dd1ea7f7c179897e0d64de13e3b04d56fec2132b06cf35f1c` |
| `/UI2/CL_WDR_CFG_TRANSP_HNDL_D` | `be4c3c0e3c4a33e00bb07862a837c3513444f505c88754b3f2f0019b321f2fdf` |
| `/UI2/CL_WDR_CFG_TRANSP_HNDL_B` | `2a769966f4188b251e483a554151437838ca02afd9298b63eeb7cdef34261c71` |

Target/client-bound GET manifests, collector copies and proprietary source remain private. These
are source observations, not mutation evidence. The prior create-only source chain remains the
basis for [duplicate-safe creation](2026-11-03-pinned-flp-create-only.md). No new native fixture was
created for this follow-up.

## Private selection policy

ADR-0011 permits native selection proven constrained to allowed requests. Explicit `*` in both
registered server and destination request lists covers every possible native request/task before
execution. Both are required independently: missing/empty, narrower, malformed and deny-all lists
refuse before SAP I/O. The legacy empty-global-list convention is not this opt-in. Extra canonical
request/prefix rules alongside `*` are permitted. No guessed header, endpoint or request selector
is introduced. Native SAP checks provide authority; ARC-1 policies provide membership. Neither
substitutes for the other. Implicit recording does not grant CTS management or require its scope.

The profile is factory-registered against the request's pinned context, not a tool argument. It
requires raw write plus read capability, the same enabled policy object in client/context/config,
strict PP, target/client consistency, existing feature/action gates and explicit internal on-premise
758 coverage. Scope/grant projection remains the existing runtime's responsibility; real-builder
tests show aggregate, Basic, missing exact write grant and missing verified raw write scope cannot
mint an enabled context. The runtime deliberately does not inherit the global release override;
an unknown release refuses. An internal qualification harness must supply independently established
selected-target coverage through the existing config, never a tool argument or claimed receipt.
Release metadata alone is not evidence that an FDM, cloud, no-transport or custom-handler override
matches this ordinary CUST profile. Those variants remain outside this candidate's qualification.

The profile revalidates at the existing final direct/proxy send allowance, after CSRF, token,
session and concurrency waits. A child registered context preserves the original deadline,
cancellation and cleanup, shares a bounded all-response allowance (at most 8 MiB), and charges both
its 32-send cap and any parent's allowance. Nested adapters cannot replace those controls. No
shared HTTP change or separate mutation engine is introduced. Policy/profile modules stay pure;
schema imports do not load the native HTTP implementation through them.

## Reporting and remaining qualification

Results say `recording: native-governed-unverified`, explicitly disclaim a request/task receipt and
warn that submitted failures may include CTS effects. No automatic CTS compensation runs. Content
readback remains independent: native604 is still unknown lookup state, not absence; create uses
native duplicate protection, and accepted catalog DELETE followed by604 remains unconfirmed.
A pre-send policy failure after an asynchronous mutation invocation may conservatively retain an
unconfirmed outcome rather than falsely claiming nothing could have happened.

Before any public admission, qualify the exact ordinary
CUST runtime with an owned disposable lifecycle, permitted recorded/unrecorded behavior, native
refusals, actual CTS effects and cleanup. Confirm both-wildcard selection under current-code PP
for two mapped identities and negative routes. Establish a real selection contract before narrow
lists can use this alternative. Group cleanup/absence and authoritative catalog deletion absence
remain separate unresolved contracts. No native execution, cleanup authorization or whole-PR
readiness follows from these offline tests.

## Independent review and combined checks

The [independent review](2026-11-03-pinned-flp-native-recording-review1-verbatim.md) approved private
integration of `687fc44b487892487b766dc0ac3a099f360f9cf7`: 331 affected tests, 14 additional
actual-HTTP probes and one new-profile import-purity check passed. All three TypeScript projects,
policy, size and delta-lint checks passed, with all 4,727 snapshot files unchanged. A broader
import-purity probe encountered an unchanged legacy trace-to-HTTP import; this was recorded as an
existing graph limitation, not a new native call or regression.

Integrated `3a231558f16f6e538a5f4e9cc0f945f4acec8e09` preserves all four reviewed source/test files
byte for byte. Its combined **545 unit files / 15,796 tests**, three TypeScript projects, build,
lint, policy, file/schema budgets and strict documentation passed. Private logs and the byte
comparison are retained under `pr1142-flp-recording-integration1`. Native lifecycles, actual CTS
effects/cleanup, current-source two-writer PP and public admission remain open. Narrow request
policies do not gain this alternative.
