# Independent retained V5 execution audit — stopped before mutation; wiring correction required

Exact consumed attempt: `pr1142-native-declarative-v5-retained-v1`, revision `3a1743da101b453fa74f8226a44a616dfbc1bf81`, preflight `0BE07130959BBF26`. Native result SHA-256: `5729e99676ec7a831d7f5989170396bf22e69974ca9741e150fd146d211c58da`.

The attempt did not complete any stage or delete either retained owner. The evidence supports a stop before any native mutation submission: its 82 journal rows contain exactly **32 actual GET dispatches**, 27 HTTP200 responses and five typed404 responses; no HEAD, POST, PUT, DELETE, LOCK, CTS check, source-save or activation occurred. Both original retained owners remain unresolved by this continuation. The last reads verified the original inactive service source and unchanged active view immediately before the stop. This is not a new successful lifecycle or cleanup qualification.

## Confirmed P2 — entry constructs the wrong mutation safety profile

`native-v5-retained.ts:73` constructs the native client with `defaultSafetyConfig`, `allowWrites` and `$TMP`, but omits the enabled `multiTargetWrite` policy required by the private driver. At stage `correct`, `native-v5-retained-driver.ts:128` calls the real `pinnedMutationContext`; its guard rejects that client before the write executor can start.

The sanitized original exception recovered through offline reproduction is:

```text
AdtSafetyError: Missing enabled pinned mutation policy or finite request budget.
    at pinnedMutationContext (<review-source>/src/adt/mutation-context.ts:66:11)
    at runRetainedContinuation (<review-source>/scripts/qualification/pr1142/native-v5-retained-driver.ts:128:25)
```

The existing `declarativeFailureRow` intentionally maps non-`DeclarativeFailure` exceptions to `reason: unclassified`, explaining why the permanent native journal lacks this message. The permanent records have not been rewritten.

The reproduction uses the actual AdtClient, real continuation and real production mutation helpers against isolated MockAgent responses. It verifies and replays **31 captured native response bodies**, with the same **32 read paths in the same order** as the live attempt. The one inventory body was deliberately hash-only in the native journal, so the replay uses an explicit synthetic owned-only inventory matching its observed `ownedInventory`; it does not pretend to reproduce unrelated users' inventory. The live/replayed service and view source/metadata receipts agree. Reproducing the entry's actual safety construction yields the same failure, zero non-GET requests and the same remaining-owner result. A second control proves that the existing reviewed `recoveryConfig` is accepted by the actual context factory. Both controls passed; no source correction has been made.

The smallest established correction pattern already exists in `native-declarative-runner.ts:75` and `native-declarative-recovery.ts:61`: merge the fixed reviewed policy into the native client's safety. Keep preflight mutation-free and preserve the specific target, local package, recording, deadline, actual-send and owning-cleanup boundaries. Do not weaken the production context guard or introduce a caller bypass.

The coverage gap is concrete: the retained entry tests injected the executor, while the real-driver harness constructed a client with `recoveryConfig` from the outset. Neither exercised the actual entry-created client with the real driver. The next candidate needs that composed regression. My earlier correction review independently closed the namespace-confirmation finding, but did not catch this entry/driver composition defect; its original verdict remains historical and unchanged. The present attempt does not establish continuation eligibility without this further correction.

## Evidence and control audit

- The intent, attempt manifest, exact entry source and package-lock hashes agree with the immutable reviewed revision; Node is `v22.21.1`.
- The successful GET-only preflight ran 10:23:54.487–10:24:02.834Z. Actual baseline observations are suffix 10:24:23.501Z and caller 10:24:28.993Z. The earliest original prerequisite expiry is 10:28:54.487Z, after the attempt's 10:24:47.853–10:24:57.737Z journal interval. This was not an expired-baseline failure.
- All prerequisite hashes and all four pre/post raw JPEG hashes match. I visually inspected the images: A4H/001, table `*`, caller MARIAN/argument `*`, and all users/argument `*3481C958A6CA5AC1*`; all show Lock Table (0). Post observations are caller 10:25:21.945Z and suffix 10:25:30.447Z. Observation times come from the operator controls; images substantiate the displayed filters and zero rows. No cleanup session was opened by this attempt, so `cleanupConfirmed: false` is not evidence of a leaked owning lock.
- The pure real historical verifier passed again: the original V5 failure and all prior bound history remain intact. No credential loader or native entry phase was invoked by this audit.
- Final hash verification confirms **all 217 files in the consumed retained root and all seven operator files unchanged**. The source verifier confirms **4,827 reviewed files unchanged**. No file/claim repair, removal or reset occurred.
- Offline reproduction: **one file / two controls passed**; process/worker guards recorded zero blocked network or environment-file attempts, and the MockAgent/OS-socket assertions prohibit external access. No dotenv mock was introduced. No broader suite was repeated for this proven wiring failure.

## Required next step and limits

Keep this consumed root and its failure permanently. Prepare a separate corrected source candidate and a new fixed once-only attempt root that binds this failure as history; re-review it and obtain fresh native prerequisites. Do not rerun/reset the existing claim. The same two owners were last verified unchanged and remain the intended bounded continuation scope; a new preflight must establish their then-current state. This audit is not permission to execute that future protocol.

The raw helper exception, replay paths, exact commands, body hashes and before/after file bindings are retained in this private audit directory. Proprietary/native bodies stay private. No SAP/browser/deployment/credentials access, source/repository edit, installation, Git mutation or push occurred. The frozen checkout can be released by the owner after preserving its snapshot and this consumed evidence; the source/evidence themselves were not altered by this audit. Native SRVD completion, current-code PP/public qualification and whole-PR readiness remain open.
