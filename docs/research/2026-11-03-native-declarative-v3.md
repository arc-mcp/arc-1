# Declarative qualification v3: offline prerequisites and raw JPEG evidence

Status: **offline candidate awaiting independent exact-revision review; no v3 phase has run**.
This remains one fixed A4H/001, MARIAN, `$TMP`, Basic-native experiment. It is not PP, public
admission, transportable-package or other-release qualification.

## The consumed v2 attempt

The v2 checkout was bound to `a0681f531efc452edaf8fca0777cfce0d0312ef6`. Its GET-only sample
`4D03B7895FEC3338` completed successfully at `2026-11-02T23:03:19.271Z`. The two operator SM12
searches showed zero locks and received independent visual review. Their actual capture bytes
were JPEG, but the operator saved them using `.png` names. The historical PNG-only validator
correctly refused them.

At `2026-11-02T23:05:11.361Z`, execute permanently consumed its claim and stopped at
`prerequisites`, reason `v2-baseline`, before credential loading, client construction or native
mutation. The result has `failure:true`, `mutationAttempted:false`, `cleanupUnconfirmed:false`,
`finalAbsenceConfirmed:false`, and `independentAbsence:"not-run"`. No object was created and no
cleanup is needed from this attempt. The raw result SHA-256 is
`c9958fdf2466255fa644e335e90f4bafb01556d75cd7db6f6ca98298f227a129`.

The private v2 root, intent, sample, images and result remain unchanged. Neither renaming its
images nor fixing its receipt allows another execution. V1 and its separately successful recovery
also remain consumed. V3 is a new fixed protocol, not a retry or relabeling of those attempts.

## Fixed contract and implementation

`native-declarative-v3.ts` binds only `pr1142-native-declarative-v3` under the existing private
persistent-state parent. It exposes prepare, GET-only preflight, offline check and once-only execute.
No argument selects a root, entry, target, fixture graph, image format or native operation.

V2 and v3 share factored phase/evidence orchestration. Historical v2 retains its PNG-only filenames,
signature rule, protocol identity and consumed-claim behavior. V3 fixes the two filenames to
`sm12-suffix.jpg` and `sm12-user.jpg`. The parser bounds each raw image to 8 MiB and checks JPEG
SOI/EOI, bounded marker segments, an 8-bit baseline/progressive frame and a scan. It does not decode
the image or interpret the SM12 screen. The operator still establishes the exact filters and zero
count; the receipt binds those observations to the unchanged image SHA-256 values. PNG, renamed
non-JPEG bytes, truncated/unsupported envelopes and hash mismatches refuse. No image is converted.

V3 uses the **unchanged six-owner v2 graph** across DDLS, DCLS, DDLX, BDEF and SRVD, including the
separate abstract DDLS dependency. A fresh random 16-hex suffix distinguishes this intent. The
existing `ZARC1_V2…` names and `ARC1 declarative v2` source marker deliberately identify the fixture
generation; the state protocol and receipts identify v3. This avoids changing reviewed ABAP source
merely to rename the experiment. There is no implementation class, service binding, publication,
table-data operation, ABAP execution or additional family.

The exact Node 22.21.1/loader/environment gates, clean full-revision binding, immutable intent,
five-minute preflight/SM12 limits, target identity and no-replay lifecycle remain. The native driver,
fixture graph, transport restrictions, activation, timeout, stop and conservative cleanup rules are
reused. Only closed v3 failure reasons are added to the shared workflow vocabulary.

## Offline check and the execution boundary

The offline check verifies runtime/source binding, existing private directories, intent identity and
fixtures, successful matching GET-only preflight, both SM12 observations, image signatures/hashes,
chronology and freshness. It rechecks source, intent and every captured receipt after reading and
refuses a concurrent preflight or already-consumed attempt. It neither creates a state parent nor
claims a directory or writes a result. Its Git reads disable optional index writes. It does not load
the native runner, client, HTTP implementation or dotenv, and never invokes credential/client/native
dependencies. A successful result explicitly says `attemptClaimed:false` and `executionGrant:false`.

The check is an operator-error detector, not a reservation or authorization. Execution **always**
claims once and independently rereads/revalidates every prerequisite, including after asynchronous
dependency loading and before credential access. Later source/intent/receipt changes are rechecked
through the existing lifecycle, including final independent absence. Freshness is enforced until
the first native mutation; the existing longer bounded cleanup window remains available afterward.
A failed execute, including another prerequisite error, still consumes the v3 claim permanently.

## Proposed sequence after independent review

Use the final reviewed clean checkout and full commit. These commands are proposals, not approval:

```sh
node --import tsx scripts/qualification/pr1142/native-declarative-v3.ts --prepare-reviewed-declarative-v3 <reviewed-full-commit>
node --import tsx scripts/qualification/pr1142/native-declarative-v3.ts --preflight-reviewed-declarative-v3 <reviewed-full-commit>
node --import tsx scripts/qualification/pr1142/native-declarative-v3.ts --check-reviewed-declarative-v3 <reviewed-full-commit> <fresh-preflight-id>
node --import tsx scripts/qualification/pr1142/native-declarative-v3.ts --execute-reviewed-declarative-v3 <reviewed-full-commit> <fresh-preflight-id>
```

Between preflight and check, obtain two genuinely fresh SM12 observations after that preflight:
client 001, table `*`; suffix search user `*`, argument `*<new suffix>*`; user search MARIAN,
argument `*`; both zero. Save the **new unmodified JPEG captures** with the fixed `.jpg` names and
private permissions in that sample directory. Save `sm12-baseline.json` with protocol
`pr1142-native-declarative-v3`, reviewed revision, saved intent hash, preflight ID, and the existing
strict `suffixSearch`/`userSearch` fields (`observedAt`, `client`, `user`, `table`, `argument`,
`lockCount`, `evidenceSha256`). Do not rename, convert, copy forward or repair v2's old evidence.

Run the offline check before the separately approved execution. If it fails or evidence expires,
correct only unconsumed v3 operator inputs or obtain a new GET-only sample and new SM12 captures.
Never delete a claim or interpret a successful check as permission to execute. A claimed protocol
cannot refresh preflight or be resumed under a different revision.

Tests cover historical JPEG-as-PNG refusal, isolated fixed claims, offline no-import/no-call/no-write
behavior, async binding, raw JPEG envelopes, malformed/hash/chronology failures, post-check drift,
concurrent state changes, permanent refusal and shared lifecycle regression. A separate read-only
byte probe accepts both actual unchanged v2 JPEG captures under the new JPEG signature function;
it does not run a phase or reuse their receipts. Final author checks and source commit are recorded
outside the repository for independent review. Native fixture syntax/activation, actual v3 execution,
two mapped PP writers and public admission remain unqualified.

## Actual first attempt — stopped after the first DDLS update

The [independent phase verdict](2026-11-03-native-declarative-v3-review1-verbatim.md) approved the
exact frozen8135 source conditionally. Fresh preflight6C429830936744AE and two independently viewed
rawJPEG SM12zero-lock receipts passed the offlinecheck. The single execution on2026-11-02 at
23:43:09–23:43:25UTC created, activated and updated `ZARC1_V2V_F4C656905A65AA61` in `$TMP`.
SAP accepted the update and its source readback; unlock returned200 and the owning session closed.
The harness then refused metadata with `metadata-state-link`: SAP's inactive owner advertises
`./zarc1_v2v_f4c656905a65aa61?version=active`, while the verifier accepted only absolute source links.
No second activation, other owner creation or deletion was attempted.

The attempt is **failed and consumed**, with one view in `inspectionRequired`, cleanup unconfirmed
and independent finalabsence notrun. The original intent, sample, receipts,95 journalrows and result
are preserved. No retry, claim repair or relabelled success is permitted. A separate owner-specific
cleanup and a qualified link-contract correction need their own review.
