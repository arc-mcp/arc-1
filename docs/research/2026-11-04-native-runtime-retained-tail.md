# Fixed retained runtime tail after the native quickfix type refusal

The original `pr1142-native-runtime-flp-v1` remains failed and consumed at
`4f5804fe86667772ad386c9bc6100ae13b7ab7d4`. Formatter settings were changed and
restored. The class `ZCL_RSF_8B71E0C2954FA36D` was created and saved in `$TMP` by
MARIAN, then two evaluations returned concrete native proposal identifiers.
The old proposal parser stopped before application. There was no activation or
DELETE, and profiler, populated FLP and ST05 stages were unattempted.

The [narrow production correction](2026-11-04-native-quickfix-type-contract.md)
is separately reviewed. `native-runtime-retained.ts` adds one fixed private
continuation, with root `pr1142-native-runtime-flp-retained-v1`. It is source for
independent review; no native phase has been executed by its author.

## Fixed history and scope

The new intent binds the complete original 95-file protocol and 17-file operator
packet through the independently audited ledger, plus both independent and
operator report/ledger hashes. The old successful formatter and failed quickfix
results remain distinct. The first new result links to the failed quickfix hash
`518a327c86387e6d88184ca13a9355043003c51fc9ebdee593e49f92bec9db24`.
Historical files, their privacy, and exact file sets are rechecked before every
forward dispatch. No historical claim or receipt is edited, relabeled or reset.

The only stages are `quickfix`, `profiler`, `populated-flp`, and `st05`, followed by
an offline final receipt check. The new fixed entry shares the original bounded
stage engine, prerequisites and unchanged later drivers; it has no caller-selected
owner, root, protocol, arbitrary arguments or resume flag. The original entry's
commands and fixed stages remain unchanged.

The quickfix stage first GETs the retained class and editable source. It requires
exact name, type, MARIAN creator, marker, `$TMP`, inactive/new metadata, and the
saved raw metadata/source digests. The actual captured metadata is inactive; the
raw digest does not admit an arbitrary new-state substitute. The stage skips
CREATE and source PUT, repeats only the local invalid-proposal refusal, evaluates
the current unsaved text, and applies the exact supported proposal to compute a
single unsaved declaration delta. It verifies unchanged stored bytes, rechecks
the receipt under its own deletion lock, deletes once, and independently verifies
typed absence twice. No activation or ABAP execution is allowed.

Historical confirmed deletion remains separate from later present/uncertain
observations. Failure retains the owner for inspection when final absence is
unconfirmed. A final source/stop check preserves confirmed deletion and cleanup
facts while refusing success. Own UNLOCK/session cleanup retain their bounded
exception to forward-proof failure; session closure is a shared cleanup predicate,
not a fabricated raw close receipt.

## Operator sequence after independent approval

Use the exact reviewed clean revision and Node22.21.1 with the existing documented
runtime environment restrictions. The source-bound fixed entry accepts exactly a
command and the full reviewed SHA:

```text
scripts/qualification/pr1142/native-runtime-retained.ts --prepare-reviewed-runtime-retained <SHA>
scripts/qualification/pr1142/native-runtime-retained.ts --check-reviewed-runtime-retained-quickfix <SHA>
scripts/qualification/pr1142/native-runtime-retained.ts --execute-reviewed-runtime-retained-quickfix <SHA>
```

Prepare is offline and creates only the new fixed local intent/directories. For
each stage, supply fresh, unmodified JPEG SM12 suffix/all-MARIAN observations in
that stage's prerequisites directory after intent preparation and after any prior
stage result. The strict baseline includes the new protocol, stage, revision,
intent hash, previous result hash, ordinary CUST contract acknowledgement, and
both existing non-overlap acknowledgements. The first previous hash is the failed
quickfix result above; later stages use the preceding new successful result hash.

Check is genuinely read-only and nonclaiming: it loads no credentials, creates no
client and performs no network requests. It does not grant execution. Execute
permanently claims that stage before checking prerequisites again and before
loading credentials. It independently rereads all source/history/intent/receipt
bytes. The fresh native class reads occur inside the claimed quickfix stage before
its first evaluation; there is no new standalone native preflight framework.
The original absolute freshness deadline remains enforced through actual sends,
including queue/authentication waits and synchronous proof work.

After a successful stage and genuinely fresh controls, repeat check/execute for
`profiler`, then `populated-flp`, then `st05`. A failed or consumed stage is never
replayed. No failure triggers automatic catch cleanup or guessed restoration.
Finally supply fresh controls under `final/prerequisites` and use
`--verify-reviewed-runtime-retained-cleanup <SHA>`; this final check is offline.

## Limits retained from the original protocol

This is Basic native-contract qualification for MARIAN/A4H/001, not PP or public
admission. Profiler cancellation does not prove parameter-resource deletion;
parameter retention remains explicitly unverified. Classic CUST cleanup uses its
reviewed native DELETE contract, while GET604 remains unknown and never proves
absence. ST05 requires an already matching inactive filter that can be restored
exactly. The completed formatter result belongs to the original source, and the
continuation does not claim that formatter was executed again on its new revision.
Current-code PP, destination/recording acceptance and the other plan gaps remain
separate. The old and new claimed roots must be preserved even if a later stage
fails or an operator prerequisite is invalid.
