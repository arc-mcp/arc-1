# Retained V5 entry wiring correction and separate v2 attempt

The v1 retained continuation at `3a1743da101b453fa74f8226a44a616dfbc1bf81` stopped before any native mutation. Its 82 journal rows contain 32 GET dispatches. The actual CLI client omitted `multiTargetWrite`, so the production mutation-context guard refused the first source edit. Both original owners remain: the inactive SRVD and active DDLS view. The original and retained-v1 failures/claims remain permanent.

The independent execution audit is retained verbatim in [the audit](2026-11-03-native-v5-retained-prewrite-audit-verbatim.md), SHA-256 `c336ace51aebc5360a8c64555303c425d5b8857afa4d2e4f5af2fb8a78801c77`. Actual pre/post SM12 checks showed zero locks. This was a runner composition defect, not an expired preflight or a successful native lifecycle.

The corrected entry applies the already reviewed fixed recovery safety profile only for execution: target A4H/001, both package policies `$TMP`, no recording requests, and the existing deadline/send/cleanup guards. Preflight remains mutation-free. Production guards are unchanged. A composed regression constructs an actual client from the entry's options and runs the real continuation through an isolated synthetic HTTP transport; dropping the policy reproduces the pre-mutation refusal.

A new fixed root, `pr1142-native-declarative-v5-retained-v2`, binds all 217 retained-v1 files, seven operator files and both independent audit documents through a hash-fixed ledger, in addition to the original V5 history. It cannot reset or reuse the v1 claim. The selected owners, six stages and comment-free fixture sources are unchanged. Prepare/preflight/check/execute retain their existing flags; every phase requires the new exact reviewed source revision. Fresh GET-only state inspection and fresh actual SM12 JPEGs remain required after independent review. No v2 native phase has been run by this source change.

Historical permissions remain unchanged. The two already readable nonsecret operator reports and independent audit documents have explicit exceptions; their exact bytes remain hash-bound. Raw protocol evidence stays owner-only. The audit directory must remain owned by the operator, a real directory, and unwritable by other users.

Roadmap impact: FEAT-93 remains open; this corrects its qualification runner and preserves the outstanding SRVD continuation, current-build PP and wider native workflow requirements. Source validation and independent review are recorded separately from any later native result.

## Actual v2 execution and independent audit

The exact reviewed candidate `18985372f68fe81acecad0826d8edcdb80ab059a` ran once on 3 November 2026. All six stages completed: corrected source save/activation, revised-label save/activation, then service/view deletion. Native typed absence and owning cleanup were confirmed; no selected owner remains. The second activation produced a native warning for a 44-character annotation label against String(40), while active-source and state verification passed. This is not warning-free evidence.

The [source review](2026-11-03-native-v5-retained-v2-review-verbatim.md) hashes to `636baaec8d20fe91ed2fb20da32964da5c06352062ed49b75d686ec0638b4570`. The [independent actual-execution audit](2026-11-03-native-v5-retained-v2-audit-verbatim.md) hashes to `bb5296c71a5e509094a110029fac07512d6a0716368e51e1bcbee7a8eea5e1a7`; result `6eb1011ee22c57e2885ad4451d0bdb46523c59672161b1ad7198615f74caa753`. All 689 protocol and seven operator files remain unchanged. The first post-run WebGUI observation expired and was excluded; new searches after refreshing the session showed zero user/suffix locks. Identical zero-result pixels alone do not prove their freshness.

All three historical claims remain consumed. This completes the retained native continuation and cleanup, not current-build PP, public admission or the remaining distinct native workflows.
