# Independent V4 pair-recovery correction review — conditional GO

Exact candidate: `04826cc7e0d942fb43eaa86de14520bd05efc4f9`; parent: `2536bdd7089f48e30bfe30d169d795931a99d4fb`.
Snapshot: `/Users/marianzeis/.local/state/arc1-review/pr1142-native-declarative-v4-recovery-review2-20261103-060000/source`.

**F1 is closed. No further actionable finding was identified in this bounded re-review.** The corrected source is suitable for the fixed phase chain below, subject to the actual execution/prerequisite conditions. This is not a completed native recovery, a new lifecycle approval, PP/public qualification or whole-PR readiness.

## Exact phase decision and conditions

| Phase | Verdict |
| --- | --- |
| Offline preparation, `--prepare-reviewed-v4-pair-cleanup` | **GO**, once, after the root operator verifies a clean exact-04826 checkout at the execution path below. Bind the new intent to this SHA, not rejected 2536. No native client/credential loading belongs to preparation. |
| Offline prerequisite check, `--check-reviewed-v4-pair-cleanup` | **GO**, using the genuine new post-prepare proofs. It remains read-only, nonclaiming and explicitly grants no execution authority. |
| One fixed recovery, `--execute-reviewed-v4-pair-cleanup` | **Conditional GO**, once only, after all conditions below hold. No automatic retry even if prerequisites or the attempt subsequently fail. |

The root-only execution checkout is `/Users/marianzeis/.codex/worktrees/pinned-ddic-sdo/arc-1`, clean and frozen at exact `04826cc7e0d942fb43eaa86de14520bd05efc4f9`, with Node **22.21.1** and the reviewed dependency/runtime controls. The reviewer did not alter or verify a later checkout transition; the operator must establish that condition before preparation. The fixed new root is `/Users/marianzeis/.local/state/arc1-qualification/pr1142-native-declarative-v4-recovery-v1`, absent during this review. Every actual invocation must bind the full reviewed SHA. Old lifecycle/recovery roots and claims remain consumed and immutable.

Execution is limited to Basic-native A4H at `https://a4h.marianzeis.de`, client `001`, user `MARIAN`, package `$TMP`, and these owners in order:

1. BDEF `/sap/bc/adt/bo/behaviordefinitions/zarc1_v4a_013fecce68663763`, with its exact active generated shell and different inactive intended source.
2. DDLS `/sap/bc/adt/ddic/ddl/sources/zarc1_v4a_013fecce68663763`, only after confirmed BDEF deletion and owning cleanup. Its inactive-source GET remains an active fallback, not an inferred draft.

Before execution, obtain genuinely new raw JPEG SM12 searches **after preparation**, with receipts bound to this intent, revision and original failed result. Independently inspect both actual images: client `001`, table `*`; suffix search user `*`, argument `*013FECCE68663763*`; user search `MARIAN`, argument `*`; each complete and visibly zero locks without session/error overlays. Both timestamps must meet the five-minute freshness rules; the original expiry still limits each actual DELETE. Complete the nonclaiming check, retain no overlapping CI/native work, and keep the host awake. The source revalidates the history, source, intent, images, native versions/hashes and owning preconditions rather than treating that check as a reusable grant.

No class mutation, source repair, create/activation, alternative owner, replacement fixture, force deletion, old-claim edit or replay is approved. A native refusal/uncertain outcome stops normal progression; preserve all per-owner facts and owning cleanup. Actual all-six-owner plus referenced-class typed absence, clean inventory, owning UNLOCK/session-close evidence and fresh post-run zero-lock searches still need to be recorded and independently audited after execution.

## Why the F1 correction is sufficient

`src/adt/request-attempt-budget.ts` now checks the actual request deadline and composed signal **after** the final synchronous validator/attempt charge and immediately before direct dispatch. `src/adt/http.ts` does the same before Connectivity `client.request()`. There is no new await or budget renewal between proof and send. Direct Fetch unwraps typed `AdtNetworkError` refusals, including the deadline/cancellation and existing attempt/replay errors; normal transport failures retain their existing handling.

The effective options retain the original prerequisite expiry, shared 180-second limit, per-owner 90-second ceiling and native 30-second request clamp. The check does not merely compare against an outer cutoff. The original four failures now pass for both owners and both transports. Additional exact-boundary probes independently exercise the original six-second expiry, native 30-second limit, owner 90-second limit and a second-owner shared 180-second limit narrower than that owner's later deadline. They all block the late DELETE, preserve earlier BDEF facts and still perform owning cleanup.

The recovery driver, entry, fixed owners/evidence, history and JPEG prerequisite contracts, fixture bytes and package lock are unchanged. Rechecked effective paths retain the before/under-lock pair receipts, exact scope, four other owner and referenced-class absence controls, no replay, separate cleanup allowance, final all-owner/inventory checks and terminal proof verification before durable result persistence. The unchanged source/stop/tail probes preserve confirmed partial deletion/cleanup facts while refusing full success on late drift or class appearance.

Shared HTTP/session/CSRF/negotiation tests pass, including legacy calls without the guarded proof, ordinary cancellation during awaited authentication, independent UNLOCK and typed local refusals. No public input/capability or identity model is widened.

## Explicit auxiliary limitation

The author retained one exploratory test that called `AbortController.abort()` synchronously **inside** Undici's dispatcher/attempt callback. Undici's already-installed abort listener asserts that its Fetch controller has been assigned; assignment occurs after that synchronous construction path returns. The preserved log shows the assertion occurring inside the callback before the added post-consume check. This is not the elapsed-deadline failure and is not claimed fixed.

The actual fixed recovery validator rehashes source/history and checks a stop flag; it does not synchronously abort a signal inside the dispatcher. Ordinary cancellation at real awaited-auth boundaries and final source/stop changes pass. The new deadline check introduces no such self-abort and no new await. I inspected the preserved failed log and the relevant installed Undici construction path; I did not repeat an unrelated unhandled-assertion experiment or treat it as native evidence. This limitation does not block this exact recovery chain and does not constitute approval of arbitrary self-aborting custom budget callbacks.

## Independent verification

- Original external driver and import probe files copied **byte-for-byte**, resolving only through the new snapshot/output root: **23 tests passed**. `independent-probe-provenance.json` binds their hashes; rejected original logs remain untouched.
- Additional effective-deadline probes: **14 tests passed** on both direct and Connectivity transport construction.
- Affected committed recovery/shared HTTP suites: **23 files / 928 tests passed**. Overall independent run: **26 files / 965 tests passed**. MockAgent networking was disabled; proxy socket behavior was explicitly mocked; no native phase or fixed-root invocation occurred.
- All three TypeScript projects, full lint, policy validation and file/schema-size gates passed. Lint reported three existing informational diagnostics, with no fixes. No installation, global dotenv stub, build output in the snapshot or unnecessary whole-suite repetition.
- Independently rehashed **622 original V4 files** and **21 inspection/audit bindings**, exact file set, byte counts and SHA-256 values. All **ten** committed native metadata/source bodies match the captured files. The failed result remains `3cb95d1620f6dfad4402d61eba1171d955e02f375c7f7cb434c392f161afb940`; the new recovery root remains absent. Binding details are in `independent-bindings.json`.
- First and final source actions were the verifier: exact revision and **4,752 files unchanged**. Snapshot manifest SHA-256: `91bee18d0bc1ff512b0d6d447fda7445344a24a813c848ddf8484ae8fae74a8b`. Author-report SHA-256: `07fedc9902995969dbce070740c1081a1283ee1bc973c963e77178d1dc52533e`.
- The original NO-GO is preserved verbatim in source with SHA-256 `fd9f535b9077adfcb3cc4f7c350debed3ab5dbc4b6ad4a50dc4ca317d5e9cf21`. No source operation followed the final verifier.

I authored neither this recovery implementation nor its correction. Earlier unrelated package/RAP work and the retained failure audit do not substitute for this independently executed exact-source review. No source edits, credentials, environment-file inspection, browser/SAP activity, installation, push, actual protocol invocation or delegation occurred.
