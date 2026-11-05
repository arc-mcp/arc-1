# Fixed V4 pair recovery: completed and audited

Status: **the one separately reviewed recovery completed successfully on 3 November 2026**.
Both retained owners are removed. The historical candidate design below remains recorded; its
prepare/check/execute commands do not authorize a replay. See the execution and audit section below.
The failed V4 lifecycle remains consumed and is never resumed, repaired or retried.

## Actual failure and fixed ownership

The [verbatim independent failure audit](2026-11-03-native-declarative-v4-failure-audit-verbatim.md)
has SHA256 `927171cb558de07af18fdf20b34603d1e40153ee713414bd5b3be8e643bcdcf7`.
At `99a375a16efd8891adbff9d2995d2684c5e550fb`, native BDEF activation explicitly did not execute:
its abstract behavior source was missing the native `with control` requirement. The failed result
SHA256 is `3cb95d1620f6dfad4402d61eba1171d955e02f375c7f7cb434c392f161afb940`.
Three previously created owners were removed; SRVD was never created. The failure left these two owners
for the now-completed separate recovery:

| Exact owner, suffix `013FECCE68663763` | Actual fresh GET evidence | Recovery action |
| --- | --- | --- |
| BDEF `ZARC1_V4A_013FECCE68663763` | Default metadata is inactive; explicit active metadata is active. Active source is SAP's generated unmanaged shell (`7be05fce…182de`); default/inactive source is the intended rejected abstract source (`8f34e7d6…effb`). | Delete the whole exact BDEF first, including both native versions, through its owning session. |
| DDLS `ZARC1_V4A_013FECCE68663763` | Default and active metadata are active with no complementary-state link. All three source requests return the updated 209-byte source (`4b8b2e43…13b8`). An inactive-source HTTP200 is a fallback, not proof of a draft. | Delete only after confirmed BDEF absence and owning-session cleanup. |

Root captured these values in the 14-response GET packet `pr1142-v4-failure-get-inspection-2026-11-03T023125763Z`.
The active BDEF shell names class `ZBP_ARC1_V4A_013FECCE68663763`; a separate root GET packet
`pr1142-v4-referenced-class-inspection-2026-11-03T023343009Z` reports typed native absence.
The reference grants **no class ownership**: this candidate only GETs that class and refuses if it
exists or absence cannot be established. It cannot create, delete or modify it.

## Fixed protocol and local prerequisites

New entry: `scripts/qualification/pr1142/native-declarative-v4-recovery.ts`.
New permanent root: `~/.local/state/arc1-qualification/pr1142-native-declarative-v4-recovery-v1`.
Each CLI phase accepts only its fixed flag and a full reviewed revision; there are no owner, root,
source, retry, repair or bypass arguments:

- `--prepare-reviewed-v4-pair-cleanup`: bind the actual clean source/package lock and Node 22.21.1,
  verify original evidence, claim the new root once, and write the fixed intent plus prerequisite directory.
- `--check-reviewed-v4-pair-cleanup`: pure offline, read-only binding and receipt validation. No
  native module loading, credentials, client, mutation, attempt claim or implicit execution grant.
- `--execute-reviewed-v4-pair-cleanup`: permanently claim `attempt/` before prerequisite validation,
  revalidate the original source/proofs/intent/receipts, and only then load the exact native credential
  configuration and client. Any failed attempt remains consumed.

The fixed history validator binds both audit files, the two inspection manifests, actual collector
copies and every captured response (21 hashes). The audit's immutable complete ledger separately
binds **all 622 original protocol files**, including all 600 journal rows, manifest, failed result,
preflight receipts and images. Missing, extra, changed, linked, non-private or oversized files refuse.
It never modifies the old root or uses another result as replacement evidence.

Fresh prerequisites are `prerequisites/sm12-baseline.json`, `sm12-suffix.jpg` and `sm12-user.jpg`.
The receipt binds this protocol, reviewed revision, new intent hash and original failed-result hash.
Both searches must be observed **strictly after preparation**, within five minutes, with no future
timestamp: A4H client 001, zero locks; user MARIAN/table*/argument* and user*/table*/argument*013FECCE68663763*.
The images retain actual JPEG bytes and are bounded to 8 MiB with the shared JPEG signature check.
Prepare/check never create those operator attestations. The candidate validates their hashes and
stated chronology; separate operator/independent visual review still establishes what the pixels show.
No recapture, renaming, image repair or receipt replacement is automatic.

## Shared native cleanup and honest outcomes

The driver calls the existing `runFixedDeclarativeRecovery` and production `executePinnedSourceWrite`
for each fixed owner. It preserves exact independent server/destination package and local recording
policies, owned LOCK/DELETE/UNLOCK/session closure, bounded bodies and no replay. The shared helper
adds only an optional trusted request policy; old single-owner profiles retain their default behavior.
The pair shares a three-minute outer deadline, 2 MiB cumulative response allowance and 192 final-send
attempts; each owner retains the shared 90-second ceiling. The original SM12 prerequisite expiry
also caps the operation deadline through final send, including an initial DELETE authentication wait;
observing an attempted DELETE cannot extend it. Owning cleanup keeps its separate allowance.
The attempt guard rechecks bound source/proofs and stop state at actual direct/Connectivity sends,
including after authentication/queue awaits. A valid own UNLOCK survives stop or binding loss.

Before any first lock and again under the BDEF's own lock, stateless native reads validate both
owners' exact type/name, `$TMP`, MARIAN authorship/responsibility, nonce description, native versions,
full raw metadata hashes and all default/active/inactive source hashes. The same BDEF/parent receipts
and four peer/class absences must hold. After BDEF deletion, independent typed absence and cleanup
must be confirmed before starting the DDLS. The DDLS is reread before/under its lock, with BDEF,
all four peers and the referenced class required absent. Exact raw hashes deliberately refuse any
serialization/state drift; the code does not infer ownership from source similarity.

A final independent read checks all six original owners, the referenced class and suffix inventory,
then rechecks the immutable binding. The native inventory stays hash-only. Stop, stale evidence,
drift, unexpected presence, untyped absence, rejection, network uncertainty or cleanup failure stops
advancement. No uncertain DELETE is replayed, and no source save, activation, repair, CTS compensation,
foreign lock removal or class mutation is admitted. Previously confirmed per-owner deletion/cleanup
facts survive later failure. Inventory/lock absence is not substituted for typed object absence.

## Evidence and remaining work

The committed minimal fixture contains the ten root-captured metadata/source responses for these
two disposable owners. It is read evidence, not a new fixture creation or deletion result. Mock
LOCK/DELETE/cleanup/error responses remain synthetic. Tests use a real AdtHttpClient with external
connections disabled, including actual final-send authorization drift, both cleanup stops, default/
active/inactive source drift, immutable 622-file proof, partial outcomes and isolated entry phases.
No dotenv stub is added. The author report retains exact gates and any initial failures.

The required exact-source re-review, fresh visual prerequisites, actual cleanup, final zero-lock
evidence and immutable result audit are now complete, as recorded below. Root supplied the entity-level
`with control` syntax lead from [SAP Help](https://help.sap.com/docs/abap-cloud/abap-rap/modeling-parameters-for-non-standard-operations)
for a **later fresh lifecycle only**; neither the historical fixture nor its syntax is changed here.
Full native lifecycle, PP, public admission and whole-PR readiness are not claimed. FEAT-93 retains
those gaps; recovery completion does not qualify the corrected full lifecycle.

## First independent review and deadline correction

The [verbatim first recovery review](2026-11-03-native-declarative-v4-recovery-review1-verbatim.md),
SHA256 `fd9f535b9077adfcb3cc4f7c350debed3ab5dbc4b6ad4a50dc4ca317d5e9cf21`,
rejected `2536bdd7` for F1/P2. Its four synthetic actual-HTTP probes reproduced a late DELETE
when the final synchronous source/history validator crossed the deadline. Both owners and both
direct/Connectivity transports were affected. Eighteen other driver controls and the pure-import
probe passed. No native recovery phase ran, and the permanent recovery root remains absent.

The correction is at the existing shared send boundary: after `attemptBudget.consume()` returns,
both transports recheck the actual request's absolute deadline and cancellation signal immediately
before dispatch. This retains the original SM12 expiry, shared three-minute and owner 90-second
ceilings, plus any narrower native 30-second request cap. It does not renew any budget or replace
the synchronous proof with a weaker check. Direct Fetch preserves the typed local refusal. There
is no new await or identity change between proof validation and dispatch.

Independent own UNLOCK and session-close policies remain separately bounded and available after
mutation expiry; earlier confirmed deletion and cleanup facts remain intact. The unchanged four
reviewer probes and narrower original-expiry/native-clamp regressions must pass before re-review.
Their mocked results are not native execution evidence. Original fixture bytes, all 622 historical
files, the 21 inspection/audit bindings, original failed result and once-only phase semantics are
unchanged. Preparation at the rejected revision must not be used to authorize the corrected source.


## Actual recovery and independent audit

The [second independent review](2026-11-03-native-declarative-v4-recovery-review2-verbatim.md)
conditionally approved exact `04826cc7e0d942fb43eaa86de14520bd05efc4f9` for the fixed pair cleanup.
It passed 965 tests (928 committed tests, 23 original probes and 14 narrower deadline controls),
all three TypeScript projects, lint, policy and size checks; 4,752 snapshot files stayed unchanged.
This evidence qualifies the shared effective-deadline correction and the bounded native experiment,
not PP, public capability admission or the full PR.

The first operator launch was rejected because the tool host supplied `GIT_PAGER`, which the reviewed
runtime forbids. It stopped before preparation, binding, a root/claim, credentials or any native work.
The explicit invocation then removed `GIT_PAGER`, `NODE_EXTRA_CA_CERTS` and `ARC1_LOG_HTTP_DEBUG`, used
Node 22.21.1 and the frozen reviewed checkout, and retained an awake hold. It prepared once at
06:11:30.709 UTC; actual new suffix/user SM12 JPEGs at 06:11:54.086 and 06:12:09.809 UTC showed zero
locks. Independent pixel review and the nonclaiming freshness check passed. GitHub reported no active checks immediately before execution; the other agents remained offline.

The sole recovery run at **06:13:12.828–06:13:31.594 UTC** submitted exactly two DELETEs, BDEF then
abstract DDLS, both HTTP200. Exact native versions and source hashes were revalidated before and
under each owner's lock. Both own UNLOCKs returned HTTP200; the reviewed owning-session cleanup
predicate succeeded. Final typed reads confirmed all six original owners and the referenced class
absent; the class was never mutated. The result SHA-256 is
`c444fded9da12a04f5f81c65d91900b251813c746a595568a76ddaed114e7ce4`.
Fresh post-run user/suffix SM12 JPEGs at **06:13:58.197 / 06:14:19.713 UTC** showed exact-filter zero
results without an error overlay.

The [verbatim independent audit](2026-11-03-native-declarative-v4-recovery-audit-verbatim.md)
rehashed all 172 recovery files and 166 journal rows, plus post controls and the unchanged original
622 files/21 fixed bindings. Audit SHA-256:
`eb143421fd5e275987cbe1000bb47b558bbb059a2e1d308d842de29795d15a65`;
complete private proof-ledger SHA-256:
`9079245f351c10cfbf1a219361b7ec403b43b8bc1f040fc4f38c9b6974b13cc0`.
Raw session-close responses are not retained; closure follows the reviewed cleanup predicate. Two
lock bodies and three inventory bodies are intentionally hash-only, and inventory cleanliness is
fixture-specific. These limits remain explicit. Both original failure and successful recovery claims
are consumed. A fresh corrected V5 lifecycle, current-code PP and public admission remain open.
