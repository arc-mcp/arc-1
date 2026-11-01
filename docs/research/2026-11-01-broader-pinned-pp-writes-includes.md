# Pinned class-local includes — implementation and qualification

PR #1142 now implements `SAPWrite.update` for CLAS `definitions`, `implementations`, `macros`
and `testclasses`. The fresh two-writer run below qualifies their local `$TMP` lifecycle at
`77e41fdcdcfd43ead7fc66fbb23508037d6e2dba`. Earlier checkpoints and the failed attempt remain historical
evidence; neither the earlier [combined run](2026-11-01-broader-pinned-pp-writes-combined-qualification.md)
nor this new run qualifies transportable includes or the rest of PR 2.

## Complete fresh PP run, 16:02–16:07 UTC

The [sanitized receipt](broader-pinned-pp-writes/include-qualification-20261101.json) binds run
`53e76504-7aab-4944-90bc-580518297ac9` to the clean source revision, harness, fresh fixture manifest,
CF package and selected droplet. The fresh build contains 1,219 hashed files, reverified after the
run. Production source, harness, integration helper and lockfile match the Opus-reviewed `771aff1c6`;
the intervening commit contains only its test and documentation follow-ups.

Three separately authenticated sessions first passed 39 identity/scope checks. The parent lifecycle
then passed **1,216 checks with zero failures**; its formatter child passed **262 with zero failures**.
Both writers created and edited CLAS/INTF fixtures, exercised the shared main-method handler,
replaced all four class includes, and activated each complete owner. Each class initialized a
previously absent `testclasses` include; the other three kinds already existed. This does not prove
initialization of every kind. Missing/stale hashes and blank requests were refused, while explicit
hash-guarded clearing and subsequent replacement succeeded.

Native active/editable source hashes matched for both owners and all eight includes. Their native
last changers were `MARIAN` and `ARC1_WG_RO` respectively. These observations followed activation;
they do not independently attribute every earlier request or reveal every other user's drafts.
Reader, read-only destination, aggregate and compatibility-route refusals passed. Formatter settings,
including the primary user's optional v5 preference seed, were restored. Secondary preference isolation
was observed through MCP, without an independent native enumeration of that user's preferences.
Deletion and independent typed absence checks confirmed all four fixture names absent. No manual
fixture recovery was needed. The harness stopped with zero active operations and discarded its sessions.

Fresh read-only verification matched both users' complete role/profile rows and both named roles'
authorization/organization-level rows exactly to their pre-run captures. The temporary SAP assignment,
BTP role/collection and destination were removed. The original app, droplet, full environment, routes,
seven XSUAA security fields and source read-only destination matched their baselines; the app was
running and healthy. Receipt timestamps identify when each verification completed, not when each
preceding removal happened. The rollback ledger is `fully-restored`.

The preserved host power log covers setup through restoration (15:49:16–16:13:58 UTC), including
89 lines and no sleep/wake event. A run-scoped idle assertion covered the harness lifetime and the
lid was checked open; the assertion cannot prevent deliberate lid-closed sleep. This run resolves
the prior incomplete local include qualification. It does not make the broader PR merge-ready.

## Shared protocol and policy

`adt/class-include-write.ts` owns the existing include read/initialize/save protocol. `crud.ts`
retains its compatibility export and legacy signature. Single-target callers keep optional hashes,
their legacy missing-resource behavior and transport fallback. Pinned calls provide a registered
mutation context, finite non-replayable request policy and mandatory owning-lock policy.

`write/pinned-lock.ts` factors the existing package/recording recheck out of the main-source adapter.
Both main source and includes use it: resolve the real class package and recording before locking,
lock the class, revalidate both policies and the lock's recording evidence, then touch source.
An include belongs to this exact owner. A verified parent request is used for both initialization
and saving; a pinned save cannot fall back to the lock's task ID.

Existing includes require the exact hash returned by `SAPRead(format="editable", include=...)`.
The helper reads again under the lock. Hash omission only permits initialization when that same
read reports typed `ExceptionResourceNotFound` without a service-resolution classification.
Generic HTML, untyped/service 404s and disappearance with a supplied hash refuse initialization.
There is no invented hash for a missing include.

After saving, exact editable readback must match, allowing only CRLF normalization and terminal
line breaks. The returned hash uses SAP's actual bytes. Exactly `source=""` with an existing include hash is preserved through normalization for both
single-target and pinned dispatch. Empty source without a hash and whitespace-only source are
refused, preserving the existing protection against optional-field pollution. Other actions retain
their missing/empty-source rules. Saving never activates the class automatically.

## Admission and outcomes

The capability table admits only the four explicit selectors on CLAS update. Create, delete,
INTF, main/text-symbol selectors and include-based surgery remain refused. Raw selectors are
checked before legacy normalization can drop an inapplicable include and broaden the request.
The pinned catalog and instructions describe this boundary.

Results distinguish unconfirmed or rejected initialization from a confirmed initialization followed
by an uncertain/rejected source save. `initialized` is omitted until initialization status is known;
a later PUT failure retains the created-include state and never triggers automatic deletion.
Unlock/session cleanup uses the shared owning-session lifecycle and reports cleanup failure separately.

## Checks and next evidence

The full unit suite passed 396 files / 10,924 tests; build, typecheck, lint and file/schema budgets
passed. Focused tests exercise all four selectors, exact hashes, typed absence, initialization,
parent request mapping, changed package, partial outcomes, no replay, cancellation and cleanup.
Legacy compatibility and explicit empty replacement are also exercised. These are mocked HTTP
tests, not SAP or PP evidence.

Before treating this family as qualified, review the immutable implementation and run both mapped
writers against disposable classes: native initialization/absence behavior, successive include hashes,
whole-owner activation, active/editable native readback, actor binding and complete fixture cleanup.
Keep existing reader/destination/aggregate/Basic denials and the broader PR's pending families explicit.

## Read-only native protocol probe

At 05:15 UTC, direct reads on A4H/001 returned `text/plain` for all four include kinds of
`CL_ABAP_CONTEXT_INFO`. Both `CX_ROOT` and `CL_ABAP_CHAR_UTILITIES` had readable class metadata
but returned HTTP 404 / `ExceptionResourceNotFound` for `testclasses`, without a service-error
classification. The [sanitized observations](broader-pinned-pp-writes/include-read-contract-20261101.json)
contain response metadata only; no SAP source bodies or credentials are published.

This supports the strict absence predicate against existing class owners. The probe acquired no
lock and sent no mutation. It does not qualify initialization, saving, PP identity or cleanup.

## First Opus review and correction

The [verbatim Opus 5.5 max review](broader-pinned-pp-writes/claude-includes-review-20261101.md)
reviewed immutable revision `cc34bbd6b`; all 2,568 snapshot hashes matched before and after.
It found one Medium issue (blank source without a hash could clear a single-target include)
and three Low coverage gaps (positive route preparation, recording drift and failed unlock).
The correction requires an exact empty string plus a hash for clearing, rejects whitespace-only
source, and adds those regression cases. It also documents the single-target clear contract.

The reviewer ran all 37 previous offline simulations. Its focused Vitest command failed during
argument parsing, so it ran **zero unit tests**; its typecheck failed on `.mjs` resolution inside
the `node_modules/.cache` snapshot. Those are not test passes. The next review uses
`--silent=true` and a snapshot outside `node_modules`, and must review the new include harness
before any live run.

## Include qualification harness

The combined qualifier now exercises both writers' existing temporary class fixtures before
whole-owner activation. For each of the four include kinds it checks initial/existing writes,
missing/stale-hash refusal, explicit clearing and final source restoration. A failed preliminary
MCP read is not absence evidence: only the writer's typed native absence check can authorize
initialization. The first independent ownership receipt is captured after activation and includes
all eight active/editable include hashes. Subsequent native checks and cleanup compare those
hashes too, including under the class lock. Incomplete ownership evidence or a foreign include
draft visible to the primary native reader preserves the fixture for investigation. This does not
prove visibility of every other SAP user's inactive drafts. The original ownership receipt is never replaced.

The harness remains offline-only until reviewed and run against a new, clean source revision.
Transportable include initialization still requires a separate qualification; this fixture run
uses `$TMP`.

The stale-hash case reuses the first save's real hash after the second save. The journal records
which include kinds were initialized. Missing initialization coverage fails qualification without
stopping the remaining cleanup; it is never reported as a successful initialization test.

## Second Opus review and harness correction

The [verbatim follow-up review](broader-pinned-pp-writes/claude-include-harness-review-20261101.md)
examined `00dde0613`. It closed the previous four findings but identified a High harness defect:
the include-save predicate required `ok`, which real source-save results do not return. A shared
predicate now consumes actual `handleToolCall` results in contract tests; the simulation no longer
invents that field. Production response semantics are unchanged.

The Medium finding concerned per-include attribution. Native receipts now capture each include's
`createdBy`, `changedBy` and `version`, require the expected last changer and active version, and
compare those fields during cleanup as well as both source hashes. Missing or ambiguous include descriptors, last changer or active version
fail qualification; creator is recorded when present, and a class-level author is not substituted. These observations follow whole-owner
activation and do not independently attribute every earlier request or expose other users' drafts.

The Low findings add empty-without-hash and whitespace refusals before the first save, preserve
cleanup diagnostics in failed native-worker reports, and expand fault coverage. The actual combined
wrapper is exercised offline with only the formatter branch replaced; durable include progress is
checked after success, cancellation, uncertain save and refusal. Additional simulations cover
tool-level read errors, denied-route writes, second-writer-only failure and wrong include authorship.
Unavailable preliminary reads remain explicitly distinct from native absence evidence.

The reviewer actually passed 13 files / 437 tests, all 44 then-current simulations and the complete
typecheck. Snapshot hashes were unchanged. Its outside-root read attempt was refused and an
unsupported search expression failed; neither changed the snapshot. At that review checkpoint, the candidate staged from
`00dde0613` had not been selected or started, and no temporary SAP/IAM/destination permissions were
enabled. The later reviewed attempt is recorded below.

## Reviewed native check and incomplete PP attempt at `b7fa68830`

The next actual [Opus 5.5 max review](broader-pinned-pp-writes/claude-include-harness-fix-review-20261101.md)
accepted a controlled qualification after checking same-session initialization directly. That native
check passed: a missing `testclasses` include was initialized and read back in its owning session,
an unhashed repeat was refused, and whole-owner activation produced an active descriptor with the
expected last changer. The fixture was deleted with verified native absence. The first probe's
main-source save received a generic HTTP 400 and left a shell, which was separately inspected and deleted;
both attempts remain in the private operator record. Direct identity evidence does not establish PP.

The [source-bound PP attempt](broader-pinned-pp-writes/include-qualification-attempt-20261101.json)
passed 386 assertions before an HTTP failure on the read following a successful `testclasses`
update. Primary-writer definitions, implementations and macros completed their include sequences;
testclasses initialization and its subsequent save returned success. The run did not reach owner
activation, the second writer, formatter qualification or normal deletion. The HTTP failure's cause
is not established. These results do not qualify the complete class-include family.

Automatic cleanup preserved the unfinished class because it lacked a completed independent
ownership receipt. Operator recovery compared the main source with its saved editable receipt and
all four includes with their successful save hashes and exact test content, checked native package
and actors, then repeated these checks under the owning class lock before deletion. All four fixture
names were independently confirmed absent. The harness stopped with zero active operations.
The archived recovery script enforces those comparisons, but its contemporaneous report did not
persist the individual before-lock/under-lock observations or a script hash. Its hash was captured
retrospectively; this is a code audit plus recorded outcome, not independent runtime proof of each comparison.
The original application/environment, temporary destination and SAP role/profile are restored;
temporary IAM entries and XSUAA restoration initially awaited operator BTP session renewal;
they were subsequently restored and freshly verified at 13:44:21 UTC, as recorded below.

The follow-up closes the review's offline coverage gaps: persisted attempts are checked when the
mock receives each include mutation, including the second writer; contradictory or missing save
fields are rejected; blank requests traverse route preparation and the real handler; and blank-refusal
side effects, wrong writing sessions and inactive include metadata have negative controls. Native
diagnostics record descriptor counts/types before refusal. Missing last changer/version are tested
separately from the optional creator. The cleanup reporter function is exercised on an injected failing
operation with failed unlock and successful session closure. The combined wrapper has an explicit
30-second test budget. These changes still require follow-up review and a fresh complete live run.

Author validation for this follow-up passed 398 files / 10,976 tests, all three typecheck projects,
55 offline qualification simulations, lint, strict documentation and file/schema budgets. The
switched-session simulation was refined afterward to replace the Authorization header at the mock
transport boundary; all 35 deletion/include simulations passed again. Production files are unchanged.

## Transport diagnostics and integration follow-up

The next [actual Opus 5.5 max review](broader-pinned-pp-writes/claude-include-evidence-review-20261101.md)
retained `c6d7fc371` and closed the prior findings within their stated scope. It requested transport
diagnostics and an offline reproduction of the saved-source/read-failure sequence before a fresh run.
It passed 474 focused tests, 55 simulations and all typecheck projects; 2,469 snapshot files were unchanged.

The available failed-run timestamps leave **954,253 ms** between the last successful RPC receipt
and cleanup's first phase, then **3,539 ms** through the final journal. The first cleanup worker
started 894 ms after that phase. This is an unobserved interval, not a measured fetch duration:
the configured timeout was 330,000 ms. The RPC records alone cannot explain the excess wall time or
establish a network/backend cause. The failed request rejected without a recorded status or body.

A subsequent read of the host's macOS power log found lid-closed sleep beginning at
06:57:47 UTC, a maintenance wake at 07:13:43 UTC, and sleep again at 07:13:45 UTC.
The reported sleep lasted 956 seconds; cleanup began within one second of the maintenance wake.
These are not exact execution boundaries: the last RPC receipt is 2.2 seconds after the sleep entry,
and the final journal is 2.0 seconds after the next sleep entry. Clock behavior across sleep was not measured.
This explains the wall-clock gap without recovering the missing fetch error or establishing a
backend defect. The selected original power events and their hash are retained privately; their
sanitized observation is in the attempt record. The qualification remains failed. The next run
requires an awake host, including an open laptop lid; an idle-sleep assertion cannot prevent
explicit lid-closed sleep. Preserve the host power log for the complete run and cleanup window.

The follow-up adds bounded error classifications and both elapsed clocks to failed RPC receipts,
separate save/read-back phase labels, and a negative control that checks the successful save is
durable before its read rejects. Additional controls exercise stale refusals with side effects,
wrong refusal state and contradictory save evidence. A resolved lifecycle with failed unlock now
must fail native cleanup while preserving the cleanup flags. The blank route test pins the actual
source-validation message. The mock matches the observed three initial includes and stripped
terminal newlines. These are offline checks; the complete include PP run remains pending.

Current `main` was integrated at `c8a0c9c27`, retaining both instructions in the sole textual conflict.
That exact tree passed 422 files / 11,474 tests, 55 simulations, typechecks, build, lint, strict docs and
size/schema budgets before this diagnostic follow-up. FEAT-93 remains open; neither checkpoint is
whole-PR acceptance. Temporary BTP IAM/XSUAA rollback was still pending at that checkpoint; the later restoration is recorded below.

Author validation of the diagnostic follow-up passed **422 files / 11,478 tests**, all three
typecheck projects, **59 offline simulations** (20 formatter and 39 deletion, including 22 include
scenarios), lint, strict documentation and file/schema budgets. No production `src/` changes were
made after the `main` integration. Follow-up Opus review and the next live qualification remain pending.

## Integration review and follow-up dispositions

The [actual Opus 5.5 max integration review](broader-pinned-pp-writes/claude-main-integration-review-20261101.md)
retained `92dc1a711`, found no High/Medium issue, and closed the seven earlier findings within their
documented limits. It passed 11,478 tests, 59 simulations and all typecheck projects. The 2,600-file
snapshot was unchanged before and after. Its size check could not run because the archive had no
Git index; the author check passed. Its supplied merge-resolution diff named the wrong revision;
the next review must use the actual `c8a0c9c27` merge. Neither limitation is a passed check.

The seven new Low findings have these dispositions:

| Finding | Follow-up |
| --- | --- |
| SSE failures and timing evidence | Real loopback tests send partial SSE, then stall or disconnect. They verify response-read failure, status, parseable start time and nonzero elapsed clocks near the timeout. Failed receipt persistence preserves the original error and adds a fixed flag; successful-response receipt failure still stops the run. |
| Unknown transport causes | Additional network, HTTP-parser and TLS codes have explicit allowlist entries. An unlisted code becomes fixed `OTHER`; absent codes remain null. Arbitrary values and messages are not copied. |
| Pinned CSRF 503 retry change | Retained. Create/update adapter tests prove one bootstrap HEAD, no mutation submission and an unchanged recording-preflight refusal. This is distinct from a rejected fetch. |
| Unnamed SAP definition | A fresh named audit confirms the old `definition` rows describe the unassigned `Z_ARC1_PR2_TEST`, not `Z_ARC1_WG_RO`. User roles/profile and the test-role definition match their baseline. The currently assigned read-only role has only S_DEVELOP activity 03. Its complete pre-run definition was not saved, so historical full-definition equality cannot be established. |
| Recovery template binding | Historical scripts are evidence only. Any new recovery requires owner-only inputs, verified run/HEAD/harness/manifest/actor/receipt binding, and a script hash on both inspection and cleanup. This is a prerequisite for a newly rebound recovery, not executed generic recovery coverage. A preserved fixture may wait. |
| Offline controls absent from CI | The full `test:qualification:pr1142` command now runs in the existing Node 22/24 test matrix. |
| Include-support contradiction | The writes document now distinguishes admitted include replacement from still-refused include method surgery. |

The [shared chain refusal](2026-11-01-class-surgery-range-boundaries.md) at `65585c620` was added
after that immutable review. The next review, recorded below, examined the shared guard,
host-sleep observation, named SAP audit and changes above. Author validation passes **425 files /
11,516 tests**, all three typecheck projects, **59 simulations** and lint. Live include qualification
remained incomplete at that checkpoint. IAM/XSUAA was subsequently restored; FEAT-93 remains open.


## Stream and chain review at `8c259f96`

The [verbatim Opus review](broader-pinned-pp-writes/claude-stream-and-chain-review-20261101.md)
retained the checkpoint for a new controlled run once original IAM/XSUAA is restored. It found no
High/Medium issue and four Low follow-ups. Its five checks passed: 425 files / 11,516 tests, all 59
simulations, all typecheck projects, file/schema budgets and the unchanged 2,617-file snapshot.
The CLI command explicitly used `--model claude-opus-5-5 --effort max`; the initialization event
confirmed that model. The review itself correctly says it cannot see the effort setting.
Verbatim report SHA-256: `4462ca3450269cb3e3acf218fc493c114049c832b352e38649ea08a84d83e4d7`.

| Finding | Disposition |
| --- | --- |
| Transport timer classification | Fetch connect/header/body timeout codes now have fixed `transport-timeout` classification. Injected-cause tests cover all three. Independent tests cover an owned abort with an ordinary reader error and a TimeoutError with an un-aborted owned signal. This does not extend Node's fetch timeout or prove its runtime defaults. |
| Preserve host power logs | The runbook now requires saving the complete run/cleanup window, including failed runs. A run-scoped sleep assertion and open lid remain prerequisites. |
| Evidence wording | The restored-definition key now names the test role. Timestamp overlaps are explicit; 954,253 ms is the receipt gap, while 956 seconds is the reported sleep. |
| Chain shape coverage | Public wording now describes only the observed keyword/colon range. The guard additionally honors its start column. Positive selected-name and complete source/structure checks remain mandatory before broader pinned metadata surgery is admitted. |

The current follow-up also converges the existing pinned main-method edit with the
[single-target action handler](2026-11-01-shared-pinned-method-edit.md). This changes shipped source,
so the accepted `8c259f96` review is not approval of those later bytes. They need follow-up review,
a fresh build and new qualification manifests before deployment. The complete two-writer include
run remains pending. IAM/XSUAA restoration is recorded below.


## Original cloud configuration restored

The operator renewed the BTP session, removed the remaining temporary role collection and role,
and restored XSUAA using the saved original configuration. At **2026-11-01 13:44:21 UTC**, fresh
read-only verification completed and matched the app environment, droplet, routes and seven
XSUAA security fields against the original baseline and verified exact absence of both temporary
IAM objects. The app is started with `SAP_ALLOW_WRITES=false`.

The private `cloud-restoration-verified.json` receipt includes comparison hashes, the fields checked,
run identity and retrospective restoration/verification script hashes computed by the verifier,
not contemporaneous execution attestations. Its sanitized observation is included
in the attempt JSON. The rollback ledger is `fully-restored`, with `awaitingBtpLogin=false` and
`activeConfigurationChanged=false`. SAP role/profile, destination and fixture restoration retain
their earlier evidence timestamps; these cloud checks do not claim to re-exercise SAP authorization.
The failed include run remains failed. A new reviewed artifact and new manifests are still required.
