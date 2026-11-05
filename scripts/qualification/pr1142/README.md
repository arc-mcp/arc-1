# PR 1142 live qualification harness

The sections below preserve dated qualification plans and their original review status. Historical
“private”, “closed” and “pending” statements are not the current runtime admission table; use the
[operator matrix](../../../docs_page/multi-target-writes.md) and the exact run's immutable audit.
Inspect the latest separately reviewed remaining tail before execution. Consumed claims remain
consumed even when a failed response followed a physical save or activation.

The first current-build PP/recording phase is documented in
[CURRENT-PP-WORKFLOWS.md](CURRENT-PP-WORKFLOWS.md). Its named login profiles, exact deployment/CTS
bindings, four-owner workflow and fail-and-retain policy are separate from the legacy plans below.

This harness produced [revision-bound live evidence](../../../docs/research/2026-11-01-broader-pinned-pp-writes-combined-qualification.md)
at `1b234d3a4`: 482 deletion/write assertions and 262 formatter assertions passed. Later recovery
journal corrections are covered offline; they do not relabel that run as a newer revision.
The native formatter reader requires the complete v5
representation; historical v2 checks cannot establish preservation of newer preferences.
The historical class and formatter records use earlier
harnesses and revisions; this source does not retroactively attest them.

The live command `{"command":"qualify","plan":"delete-two-user-v1"}` creates four disposable
`$TMP` owners through two independently verified PP sessions, checks create/update/stale-hash,
method-edit or interface-update and activation, then captures native A4H author/source receipts.
The same frozen tokens feed the formatter phase. Its native source-hash sentinels bind the routes
to those receipts, and direct native reads as the primary SAP user check preferences before,
during both users' differing patches and after restoration. Native setup first saves the primary's
complete v5 XML, then sets all five optional preferences to nondefault sentinel values. The before
check requires all five; an empty-field comparison cannot pass. After the two-field PP restoration,
a separate guarded native step restores and verifies the complete pre-seed XML. Upper/lower keyword behavior is tested.
The primary's baseline and patch both use `keywordUpper`, so its independent native proof covers an
indentation change, preservation and restoration. The style change to `keywordLower` uses the secondary's
MCP session, without a separate native preference reader for that user.
Read-token, destination, aggregate and compatibility-route refusals precede positive owner deletion.
Native absence and guarded fixture cleanup finish the run.

All native access is pinned to the owner's A4H/001 test system over HTTPS port 443. Cloud deployment,
destination/IAM changes and SAP role assignments are separate operator steps with their own rollback
ledger. They are not performed by these scripts. Do not run against an unprepared deployment.

Set these environment values before starting the harness or any native helper:

- `ARC1_QUALIFICATION_STATE_DIR`: a fresh, persistent directory outside this repository, the OS
  temporary directory, `/tmp` and `/var/tmp` (including their realpath aliases).
- `ARC1_TEST_PRIMARY_EMAIL` / `ARC1_TEST_SECONDARY_EMAIL`: the two expected XSUAA users.
- `ARC1_TEST_PRIMARY_SAP_USER` / `ARC1_TEST_SECONDARY_SAP_USER`: their distinct expected SAP users.
- `TEST_SAP_URL=https://a4h.marianzeis.de`, `TEST_SAP_CLIENT=001`, `TEST_SAP_INSECURE=false`;
  native integration-helper credentials must resolve to the primary SAP user.

Disabled TLS verification (`NODE_TLS_REJECT_UNAUTHORIZED=0`), including a value loaded by dotenv,
is refused before bearer/native access. The native helpers also require `TEST_SAP_INSECURE=false`.

Use the real Git checkout root; a source snapshot nested under an ignored directory is refused.
After committing the clean source and building it, run `node scripts/qualification/pr1142/run-manifest.mjs`.
It exclusively creates the private run directory, source/harness hashes and random fixture manifest.
Save the actual deployment artifact manifest and CF droplet/package identity separately. A current
Git SHA, MCP package version or environment label alone is not proof of the deployed build.
That deployment record is a mandatory operator precondition; the harness itself does not refuse a
missing record or verify the running droplet. Do not treat a green harness result alone as build provenance.
Our executable module closure is archived here; the installed `@arc-mcp/xsuaa-auth` JavaScript closure and package lock are hashed; other installed
third-party dependency bytes are not independently attested.

`live-harness.mjs` takes `--base-url`, `--credentials-file`, `--auth-module` and optional `--port`.
Use the existing isolated test app, owner-only XSUAA credential JSON, and the installed
`node_modules/@arc-mcp/xsuaa-auth/dist/index.js` (the path must match the resolved package entry). Obtain sessions interactively through its login commands; no token-import
command is provided. The qualifier freezes and verifies all three sessions before SAP requests.
The expected session labels are `writerA`, `writerB`, `readerA`; request only `read write`, `read write`
and `read`, respectively. Both writers need exact write grants for `PR1142/001` and `A4H/001`, while
the latter destination remains read-only. Keep the source and deployment unchanged during the run.
Both SAP users need development access for `$TMP` CLAS/INTF fixtures named `ZARC1*`, including
create/change/display/delete/activate (`S_DEVELOP` activities 01/02/03/06/07), standard ABAP language
access (`S_ABPLNGVS` 01/02/03/07), and the required ADT paths (`S_ADT_RES`). The secondary's original
display-only role is insufficient. Preserve the before-state and restore temporary assignments afterward.

Run in a detached OS session with stdout/stderr redirected to regular private files. Stop only with
`kill -TERM <harness-pid>`, targeting that PID rather than its process group. Do not use terminal
Ctrl-C, pipe output through `tee`, or close an attached terminal. Native workers now retain in-flight
work on SIGINT, and stdout failure no longer aborts cleanup. Subprocess tests exercise these hooks;
additional real-entrypoint probes check installation after an intentional startup/TLS refusal.
Those probes do not execute SAP cleanup.
SIGHUP and process-group SIGTERM can still kill workers, and full terminal shutdown is not qualified. These are operating constraints,
not tested crash recovery guarantees. With PID-only SIGTERM, forward qualification stops at the next
cooperative boundary and existing restoration/cleanup continue with the frozen tokens.
`stopping` is not completion. Wait for `stopped` with
zero active operations, inspect cleanup results, and only then begin cloud/SAP-access rollback.
Completion events include their plan: the formatter event can occur while repository fixtures remain.

Restore-only recovery is `{"command":"qualify","plan":"formatter-two-user-v2","restoreOnly":true}`.
It requires fresh verified sessions and the same private run/harness binding. It validates the saved
two-field baseline, journals attempts, sends only fields changed by this run, and checks both users.
Visible foreign changes are preserved. Native unconditional PUTs still cannot protect an intervening
same-user edit; the recorded concurrency mode makes that limitation explicit. Secondary formatter
restoration is checked through MCP for the two exposed fields; only the primary has native XML
byte-level evidence. Recovery also restores the saved pre-seed document. The deletion journal's
current restoration fields are updated without erasing the original failed qualification. If a crash
left only `formatterAttempted` after the formatter baseline was saved, `formatterRecovery` records
the outcome without manufacturing a completed formatter or deletion result. Earlier crashes cannot
have changed preferences and may refuse restore-only without recording recovery. Repeated recovery
preserves the previous result in history. Recovery uses `recoveryFinishedAt` and marks interrupted
formatter journals without adding a forward `finishedAt`. Separate
`restorationStatus` values distinguish not-required, verified and incomplete work. No claim of
repository absence is made for the formatter's source-only probe.

If a lossy native PUT drops a sentinel field, automatic recovery preserves that apparent foreign
state and refuses to overwrite it. Keep the saved `originalXml` in `native-formatter-seed.json`.
The operator must inspect a fresh v5 GET, establish whether another session changed the preferences,
and coordinate a restoration with that SAP user. After resolving any foreign edits, restore the
saved full v5 document through the primary user's native session, capture the PUT outcome and a
fresh GET, and verify byte equality. Keep this manual receipt and the original failed qualification;
do not edit journals to make the run pass or replay the whole qualification. This intervention was
not needed in the recorded successful run.

Deletion cleanup requires a successful native ownership receipt and identical source/metadata before
and under lock. Missing receipts, foreign edits and unknown/service 404s fail closed and remain
explicitly incomplete for operator inspection. An interrupted create may therefore leave a fixture.
The native receipt requires active version and expected creator/changer; no TADIR cross-check is made.
Native reads run as the primary user. The draft guard covers drafts visible to that reader; whether
SAP hides another user's inactive draft has not been qualified. Cleanup retries get new UUID receipt
filenames and repeat the same ownership checks; failed receipts are retained. Direct invocation of
the native cleanup worker requires a fresh lowercase UUID as its third argument.
Do not clear attempt journals or retry a whole run blindly. Directory and file fsyncs provide local
durability, not a guarantee against disk failure. Check the separate cloud/access rollback ledger too.

Keep the host awake throughout qualification and cleanup. On macOS, keep the laptop lid open and
use an idle-sleep assertion scoped to the harness process; it does not prevent explicit lid-closed
sleep. Save the host power log for the complete run and cleanup window in the private run directory,
including after a failure. The failed include run's 954,253 ms receipt gap coincided with a reported
956 seconds of clamshell sleep and ended near a maintenance wake. Its missing fetch cause remains unknown and its qualification remains failed.
Host suspension is not a tested recovery mode; inspect preserved receipts before any new attempt.

Local fault simulations (no SAP, CF or credential access):

```sh
npm run test:qualification:pr1142
```

These simulate oracles, replay, token freezing, raw-field loss, foreign edits, uncertain results,
shutdown, cleanup isolation and actual restore-only recovery. `npm test` additionally executes the
real native identity/cleanup and formatter fixture functions with mocked I/O, boots both native
workers through `tsx` to check the TLS refusal, and tests the shutdown/drain and Git-root guards.
They are not substitutes for native/PP evidence.

Refusal probes on the read-only destination, aggregate and compatibility routes use the primary
identity; the read-token probe is also primary. Forward formatter patches send both exposed fields;
restoration sends only fields this run changed. The deleting SAP actor is inferred from the same
frozen creator token and strict-PP route, not independently observed for DELETE. One generic refusal
code covers multiple gates, so it does not identify which gate fired. Actual read-grant values are
recorded, including wildcard grants. RPC receipts include initialization, catalogs and malformed
bodies before protocol validation; known access tokens and JWT-shaped strings are redacted.

## Class-include replacement qualification

The local `$TMP` replacement run at `77e41fdcd` passed for both writers; see
`docs/research/2026-11-01-broader-pinned-pp-writes-includes.md`. It used comment-only include bodies.
Transportable includes and the later include-method adapter remain unqualified.

The live combined command also runs `include-qualification.mjs` for each writer's temporary
class before its first whole-owner activation and independent ownership receipt. It exercises
all four include kinds, blank/whitespace refusals, missing/stale hashes, existing saves, hash-guarded empty replacement,
final restoration and denied-route calls. The native observer binds the receipt to all active
and editable include hashes plus per-include last changer and active version, then rechecks those
fields before and under any cleanup lock. Missing or ambiguous include descriptors, last changer or active version fail qualification; creator is recorded when present.
It never replaces the first ownership receipt. A failure before a complete receipt, or any
later foreign draft visible to the primary native reader, preserves the fixture for investigation.
It does not establish visibility of other users' private inactive drafts.

The local suite includes twenty-two composed include scenarios: success, ignored clear, accepted stale
hash, wrong native include proof, a foreign include draft, failed HTTP/tool-level preliminary reads,
absent initialization coverage, denied-route writes, cancellation, uncertain save, second-writer-only
failure, wrong include authorship/version, a switched writing session, three blank-refusal faults,
refused-but-mutating stale writes, wrong refusal state, contradictory save evidence and a rejected
read after a successful save. Tests also execute the actual combined wrapper and consume
real handler save results; each include-save attempt is read from disk before the mock accepts it.
Both writers’ partial journals and denied-route call counts are asserted.
The rejected-read scenario checks the durable successful-save receipt at the failing request,
then verifies that no later mutation occurs and the fixture is preserved. The mock starts with
three native-style includes and normalizes saved terminal newlines; `testclasses` needs initialization.
Native reader/cleanup tests exercise active/editable hash and author/version mismatches, missing or
duplicate include metadata, and a foreign draft under the actual shared lock callback.
These are offline tests, not live proof.
The first missing-include read may fail; that is not absence evidence. Only the writer's fresh,
typed native 404 under the class lock permits initialization. Clearing requires an existing hash.

Rejected fetches and response reads have sanitized RPC receipts before cleanup: recognized error
name/cause code, tool/method, configured timeout, start time, wall elapsed time and monotonic elapsed
time. Unknown names/codes are not reflected; an unlisted cause code becomes fixed `OTHER`, while
an absent code remains null. Raw messages, URLs, headers and arguments are omitted. Loopback tests
cover an SSE body that stalls or disconnects after headers. Failed receipt persistence retains the
original transport error and marks `receiptWriteFailed`; a successful response whose receipt cannot
be persisted still stops the run.
Save and follow-up read have separate phase labels. A repeated failure at the same step
requires recovery and diagnosis before another live attempt, not an automatic retry.

If an incomplete fixture lacks its normal ownership receipt, prepare a separate recovery bound to
that run's preflight absence, manifest, original actor and exact saved source receipts. Archive and
hash the recovery script before use, and include that hash in both inspection and cleanup records.
Use owner-only input reads and verify the current HEAD, run ID, harness, fixture-manifest hash and
receipt binding before any SAP call. Select the original writer from the verified run configuration;
never default to writer A or substitute the native reader for writer B's expected author. Historical
recovery scripts are evidence only, not reusable recovery commands. A new failure must remain
preserved until its specifically rebound script is inspected. Persist the observed metadata/source comparisons and their
success before locking and again under the owning lock, before DELETE. Refuse any mismatch or
unobservable draft; verify typed absence and record cleanup. Earlier recovery records without these
comparison observations must remain explicitly limited; do not reconstruct them after deletion.

A stale-hash probe uses the actual first-save hash after a second save. A run that initializes no
include for either writer fails that coverage assertion while continuing verified fixture cleanup;
only the recorded `initializedKinds` are evidence for initialization.
## Native declarative v2 candidate

The [fixed v2 protocol](../../../docs/research/2026-11-02-native-declarative-v2.md) is an offline
candidate awaiting independent review. It uses a new fixed claim/name family, an immutable saved
intent, fresh GET-only preflight on those names and two explicit SM12 baseline receipts. It keeps
six owners across the same five families, including the separate abstract DDLS needed by BDEF.
Its documented prepare/preflight/execute commands are proposals, not native-run approval.
The consumed v1 and successful one-time recovery below cannot be repeated or relabeled.

## Native declarative qualification

**Historical v1 commands below are consumed and must not run again.** Review 24 accepted one attempt
at `e2b08f3d`; that attempt failed, and its separately reviewed cleanup subsequently passed. The
[failure/recovery record](../../../docs/research/2026-11-02-native-declarative-failure-and-recovery.md)
contains the actual outcome. These instructions preserve the original local Basic-native procedure;
they are not PP, recording-transport or other-release evidence, public admission or PR readiness.
Aggregate, Basic, Copilot and read-only routes stay mutation-free.

### Conditions before either command

**Historical v1 procedure:** the one-run claim was consumed at `e2b08f3d` and the run failed on
a reserved fixture alias. Do not execute the v1 command again, even from another checkout or host.
Its separately reviewed inactive-DDLS cleanup also passed and its recovery claim is consumed;
never rerun the recovery entry. See the [native failure and separate cleanup](../../../docs/research/2026-11-02-native-declarative-failure-and-recovery.md).

Work in a clean checkout at the exact reviewed commit, started from its real path, with real
`node_modules/` from this lockfile and the same Node version throughout.

- **Runtime:** use exactly `node --import tsx`. Unset `NODE_OPTIONS`, every `GIT_*`,
  `NODE_EXTRA_CA_CERTS`, `NODE_USE_SYSTEM_CA`, `NODE_PATH` and every `TSX_*`. The entries refuse them.
- **Source:** `git ls-files -v` shows only `H`, and nothing is ignored under `src` or
  `scripts/qualification/pr1142`.
- **Credentials:** the existing local `.env` must select HTTPS `https://a4h.marianzeis.de`, user
  `MARIAN`, client `001` and a nonempty password. Check this without printing any value. No credential
  file is created or changed, and no BTP, destination or role change is needed.
  A new checkout does not inherit this ignored file: use the already configured operator checkout,
  or arrange the same authorized local credentials privately before starting. Never commit them.
- **Host:** keep it awake, send output to a private file, and allow no other ADT activity on the fixtures.

### 1. GET-only typed absence on fresh names

Typed absence on these five types is unqualified, and the one-run entry stops at its first variant
after consuming its claim. Sample it first:

```sh
node --import tsx scripts/qualification/pr1142/native-declarative-preflight.ts --execute-reviewed-absence-preflight <full-reviewed-commit>
```

It reads one fresh random name per owner and the inactive-object inventory. The client is read-only
and exposes only `get`. It consumes no claim, and its receipts go under
`~/.local/state/arc1-qualification/pr1142-native-declarative-absence-preflight/<suffix>/`.

Continue only if `result.json` reports `failure: false`, every owner `typed-absent`, and inventory
`valid-without-suffix`. Any other row means the one-run entry would stop at that point: inspect the
retained answer and decide on reviewed code changes, which need a new review. A failed sample proves
nothing about mutations. Absence on a fresh name also says nothing about absence after DELETE, whose
native typed answer remains to be observed.

### 2. Lock control immediately before the run

In a freshly confirmed read-only SM12 session, capture zero locks for `MARIAN` in client `001`.
Confirm the result is current, not a stale display. Do not start with any lock present. Never use
SM12's delete action. Verify `~/.local/state/arc1-qualification/pr1142-native-declarative-v1` does not
exist; never remove or rename it.

### 3. The single run

```sh
node --import tsx scripts/qualification/pr1142/native-declarative-contract.ts --execute-reviewed-declarative <full-reviewed-commit>
```

The claim is created before credentials are read, so any later stop consumes it. The run creates six
random `$TMP` owners and takes each through create, activate, comment update and activate, then deletes
them in reverse dependency order. It sends one invocation only: there is no automatic retry, recovery
or replay. Forward work stops at 8 minutes and cleanup at 12; each phase has 60 seconds and each request
30 seconds. A slow system can honestly finish unconfirmed, and final checks can add bounded time.

**To stop,** send one SIGINT or SIGTERM and wait. Forward work and DELETE are then refused, including
after the deletion guard reads, while the run's own UNLOCK and session close continue. A second signal
does not kill it. SIGKILL or host sleep can leave a lock until the SAP session expires.

### 4. After the process exits

Take the suffix from `manifest.json` and capture a fresh SM12 search across all tables using it as
the argument. Then clear the argument and capture a fresh user-wide search for `MARIAN` in client
`001`, across all tables. Native lock keys can omit or truncate the suffix. Only a pass plus zero
locks in both searches supports the claim below; never delete locks in SM12.

**A pass is exactly** `failure: false` and `cleanupUnconfirmed: false` in `result.json`, whatever the
exit code says. `failure: false` already requires all six owners completed, `finalAbsenceConfirmed: true`
and `independentAbsence: confirmed`.

| Result | Supports | Does not support |
| --- | --- | --- |
| Pass, then zero locks | These six owners completed this lifecycle once on A4H/001 | Admission, PP, recording transports, another release, cause of any earlier failure |
| `stoppedAt: configuration`, `mutationAttempted: false` | The claim was consumed before any SAP request; `reason` and `invalidFields` name the fault | Anything about SAP |
| `preflight` row `absence-*` or `inventory-*`, `mutationAttempted: false` | A native answer differed before any mutation; its body or hash is in the journal | Any create behaviour |
| `createNeverSent` lists an owner | That create left the observer unsent and the adapter reports unchanged | Anything about that type's create |
| `pendingCreation` lists an owner | A create POST was sent or cannot be excluded; outcome unknown | Absence, even after a rejection |
| `create` row `metadata-*` or `source-*`, with its adapter row successful | The adapter created it, then an independent read refused; the journal holds the answer | A failed create, or a reason to relax the check |
| `activate` row `metadata-not-active` | Explicit active metadata was not active after a native success | Activation failure or success |
| `refused-before-send` with no matching request row | The named guard refused; nothing was sent for that step | Anything about the refused request itself |
| `delete-not-sent` | This DELETE was refused before send; the owner remains for inspection | Absence or successful cleanup |
| `delete-unconfirmed` | The DELETE outcome is unknown | Deleted or still present |
| `confirmedDeleted` and `cleanupIssues` both list an owner | Typed absence was read, but the lock or session stayed unconfirmed | A pass, or lock release without SM12 |
| `remaining: []`, `finalAbsenceConfirmed: false` | Current reads found no owners; final evidence is incomplete | A pass; re-check read-only |
| `stopped: true` | A stop signal was honoured; `cleanupNotAttempted` lists directly skipped owners, while `remaining`/`inspectionRequired` also retain dependency bases | Any lifecycle claim, or absence of an owner omitted from `cleanupNotAttempted` |
| No `result.json` | The process ended early and the claim is consumed | Any state; inspect first |

### 5. Leftovers and stopping

Treat every owner in `remaining`, `pendingCreation` or `inspectionRequired` as present, and any lock
as possibly held. Preserve receipts and inspect read-only. A leftover `$TMP` fixture can wait. Any
further mutation needs its own separately reviewed recovery, bound to that fixture and source; this
entry has none. Never repeat a claimed run, remove or rename its claim, or try another host. A failed
run cannot be converted into a pass. A later attempt needs new reviewed bytes and a new experiment name.

## Native active-function deletion qualification

**Consumed on 2 November 2026 at `5b1669eb`: the single reviewed run passed and its fixture
was fully removed. Do not execute this command again, remove/rename the claim or repeat it on
another host. See the [result and limits](../../../docs/research/2026-11-02-native-function-protocol.md#seventeenth-review-and-successful-native-active-deletion).
The procedure below is a historical record, not a pending run.** This is separate from PP qualification and
never enables a shared-Basic write endpoint. The ordinary runner defaults to preserving activated
fixtures; this entry explicitly selects the private active-deletion test mode. Historical failed
probes and successful whole-group recovery remain distinct evidence.

Read the [native investigation](../../../docs/research/2026-11-02-native-function-protocol.md#sixteenth-review-and-executed-passive-observation).
Its passive experiment first observed the lock absent after an inactive FUNC metadata read in the
verification sequence. That does not prove the read alone caused the change or explain the 423.
The candidate keeps extra fixture verification on the original base connection while the
actual adapter retains its owning lock and production owner/package/CTS checks.

Before an approved run, validate the existing local `.env` selects HTTPS A4H/001, MARIAN, with a
nonempty password, without printing credentials. Use the exact clean reviewed checkout, real
installed dependencies and the same Node runtime. Unset `NODE_OPTIONS` and every `GIT_*` variable;
the entry requires exactly `node --import tsx`. Verify the fixed private claim
`~/.local/state/arc1-qualification/pr1142-active-function-delete-v1` does not exist. Keep the host
awake. The CLI binds its actual entry, revision, lockfile and runtime, rejects ignored source
shadows/index exceptions, and bounds Git commands to ten seconds. Dependencies remain lockfile-
identified, not independently byte-attested.

```sh
node --import tsx scripts/qualification/pr1142/native-function-contract.ts --execute-reviewed-active-delete <full-reviewed-commit>
```

This claims one run before loading credentials. It creates one random local FUGR/FUNC pair,
records the original 15-resource empty-group baseline, updates the owned module and requests its
native activation without confirming additional objects. It requires matching source, owner,
metadata and an explicit native active version. Only this proof, with no earlier uncertainty,
permits the private mode to attempt one FUNC DELETE. Under the owning lock, extra verification
reads use the same identity's original base connection and the existing request budget.
The active version is checked again at this point. The empty parent is deleted only after typed
module absence and a fresh exact original-parent baseline check under the group/pool locks.

A pass requires `activeDeletionVerified: true`, explicit session cleanup, no remaining or uncertain
resources, typed group/module/text-pool 404s and a bounded valid XML inactive list without the
fixture. A prompt followed by successful inactive cleanup cannot qualify active deletion. Results
and request/response receipts remain private under the fixed claim. Do not publish raw bodies or
handles. A success qualifies this native local lifecycle only; public function admission,
production activation handling, recording transports and fresh two-writer PP remain separate.

**Stop rule:** no retry, claim removal/rename or second random pair. A failed create, source/owner
change, activation prompt/fallback, unconfirmed cleanup, DELETE rejection, stop or process death
cannot be converted into a pass. The runner may remove only confirmed unchanged inactive fixtures;
verified active fixtures stay preserved on uncertainty. Stop signals prevent further DELETEs in
this explicit mode, including after verification. If resources remain, preserve receipts and use
read-only inspection; any further mutation requires its own reviewed recovery bound to that exact
fixture and source. Do not use SM12's delete action. No BTP, destination or role changes are needed.

## Passive SM12 investigation

**Consumed on 2 November 2026 at `086a8f5b`. Do not rerun or rename its claim.**
The [execution evidence](../../../docs/research/2026-11-02-native-function-protocol.md#sixteenth-review-and-executed-passive-observation)
records a lock disappearance after the inactive FUNC metadata step and complete whole-group
recovery. No FUNC DELETE or PP qualification followed. The commands below preserve the historical
procedure; a future experiment requires a new review, name and failure plan.

`native-lock-workflow.ts` implemented one controlled experiment with three separately claimed phases.
It is a private native diagnostic, not a new public capability or PP qualification. Independent
review must accept this exact candidate before execution. The fixed persistent directory is
`~/.local/state/arc1-qualification/pr1142-passive-function-lock-v1`; an existing experiment or phase
is never overwritten or repeated. Do not rename/remove a claim to retry. The loaded tracked entry,
clean checkout, full revision, Node version and package lock are bound across all phases; ignored
copies and JavaScript siblings that could shadow TypeScript are refused. Installed third-party
dependency bytes are not independently attested.

Before preparation, establish an authenticated passive SM12 view on A4H/001 and a way to capture its
accessibility text and screenshot privately. Keep the host awake and preserve terminal input for
the observation phase. The script reads only the existing local `.env` MARIAN/001 credentials after
the source/phase guards. It does not require PP, BTP or permission changes.

```sh
node --import tsx scripts/qualification/pr1142/native-lock-workflow.ts --create-observation-fixture --execute-reviewed-revision <full-reviewed-commit>
```

Preparation creates one randomly named `$TMP` group/module pair, verifies the module's active
native version and saved source, and preserves both owners. A transport wrapper blocks every
DELETE during this phase. It captures 19 resource responses: the exact four-member structure,
active/editable owner metadata, generated main/TOP/UXX and module source, and all three text parts.
Inspect the actual private bodies and their hashes; names or the marker alone do not establish
that generated parent content has no foreign edits. A failure remains preserved and requires
inspection; never use the full probe as recovery.

```sh
node --import tsx scripts/qualification/pr1142/native-lock-workflow.ts --observe-existing-fixture --execute-reviewed-revision <full-reviewed-commit>
```

Run with an open terminal/stdin. The observer checks its recorded active receipt, obtains exactly
one FUNC lock, then waits after LOCK and each of the nine requests preceding the historical failure.
For each printed prompt, run a fresh SM12 search for client `001`, user `MARIAN`, table `TFDIR`, and
the exact generated module argument (a trailing wildcard may accommodate padding). Verify the
completed result and its argument, mode, time, counters and context; retain matching step/timestamp,
full accessibility text and screenshot in an owner-only `sm12/` subdirectory of the experiment.
Never use SM12's delete-lock action. Enter one JSON line only after that observation, for example:

```json
{"step":"locked","observation":"present"}
```

Use the actual pending step. Values are `present`, `absent`, `changed`, or `unknown`; only `present`
continues. Do not preload answers or infer them from an earlier display. These are operator
observations, not an independently verified lock-identity oracle: unchanged visible columns cannot
prove equality of the backend's complete enqueue identity. The CLI journals the operator answer;
capture files are a separate operator evidence requirement, not enforced by the input parser.
Capture failure or uncertain UI freshness means `unknown` and stops the sequence.

The total observation deadline is four minutes, requests are bounded to 30 seconds and share a
2 MiB/32-attempt budget. HTTP context values remain private; only presence/closed/equality booleans
are recorded at each step and before cleanup. Missing/changed context, cancellation, unexpected input
or uncertain native results stop forward work. The owning session performs independently bounded
UNLOCK and close. `observed` means a completed transcript; it does not establish handle validity or
successful deletion. Only explicit confirmed cleanup permits the separate recovery invocation.

After inspecting every inventory body and the observation cleanup result, acknowledge the exact
SHA-256 of `inventory.json` in a separate command:

```sh
node --import tsx scripts/qualification/pr1142/native-lock-workflow.ts --delete-whole-owned-group --execute-reviewed-revision <full-reviewed-commit> --inspected-inventory-sha256 <inspected-inventory-file-sha256>
```

Recovery deletes only the complete owned FUGR, never the FUNC directly. It repeats all 19 reads
through the original base connection while separate group/text-pool locks are held and refuses
any change, extra member, incomplete response, stop request or source change. Final confirmation
requires owning-session cleanup, typed group/module/text-pool absence and a valid inactive list
without the fixture. A failed phase retains its receipts and is not automatically retried.
Offline tests exercise the real shared mutation/client code with mocked native responses; they do
not establish the cause of the native 423 or qualify any current bytes live.

## Native declarative v3 candidate

V2's GET-only sample passed, but its once-only execution stopped at the PNG prerequisite before
credential loading or native mutation: the raw captures were JPEG bytes saved under `.png` names.
That attempt remains permanently consumed and needs no SAP cleanup. The
[v3 candidate](../../../docs/research/2026-11-03-native-declarative-v3.md) uses its own fixed root,
unchanged six-owner fixture generation, honest `.jpg` receipts and a genuinely read-only offline
prerequisite check. Execution repeats all checks and retains one-attempt semantics. All v3 commands
remain proposals until independent exact-revision review and the corresponding phase authorization.

### Fixed recovery of the consumed v3 DDLS

V3 created/activated/updated its first DDLS, then stopped on the native relative state link after
successful own unlock/session close. One active/inactive owner remains; the other five were never
created. The [fixed recovery candidate](../../../docs/research/2026-11-03-native-declarative-v3-recovery.md)
has a separate `pr1142-native-declarative-v3-recovery-v1` root and prepare/check/execute phases.
It binds the original receipts, both exact versions and fresh JPEG SM12 controls; execute claims
permanently and repeats all checks. No actual recovery phase or new full lifecycle is authorized by
this candidate. Preserve the old claims and private inventory evidence.

The private fixed [classic FLP protocol](../../../docs/research/2026-11-03-native-flp-cust-qualification.md)
starts with one empty Page, then one catalog only after the Page's completed native cleanup and
fresh independent lock controls. Its source-backed deletion-completion result is separate from
GET604, which stays unknown. The `native-flp-cust.ts` entry has passed independent exact-source
review; only offline preparation has run. Fresh native phases remain pending. It does not grant public or PP writes.

## Fresh fixed V5 candidate

The historical V3 and V4 lifecycles failed; their separately reviewed recoveries have removed all
retained owners, with consumed claims preserved. The [fixed V5 candidate](../../../docs/research/2026-11-03-native-declarative-v5.md)
binds those actual recovery ledgers, uses the reviewed `with control` six-owner fixture graph and
records the expected default BDEF class only as a read-only reference. It reuses the existing shared
phase/lifecycle engine and preserves source/runtime, fresh JPEG, nonclaiming check, single-attempt,
deadline and owning-cleanup controls. The final-dispatch correction has passed independent exact-source
review; every real V5 phase is still pending. Historical commands and successful cleanup do not authorize another attempt.

## Fixed private DOMA / DTEL foundation candidate

The [two-owner candidate](../../../docs/research/2026-11-03-native-ddic-foundation.md) uses current
private create/post-PUT/update/activation/delete adapters with a fresh fixed root, GET-only preflight,
raw-JPEG prerequisites, nonclaiming check and one execution claim. It preserves metadata and the
DTEL negative input-history flag and deletes the dependent DTEL before its DOMA. Independent exact-
source review and every actual phase remain pending; public DDIC/PP admission stays closed.
## Fixed retained current-PP continuation

The source-only `current-pp-retained-workflows-v1` candidate is bound to the failed
`01e3783c-ddbd-4353-b71b-af213f4417a7` run and its three retained owners. It uses a new fixed root/claim,
fresh deployment/sessions/native reads/SM12 controls, and only the remaining PROG/text/denial/recording
steps plus reverse PP cleanup. It does not replay completed class/INCL work or edit old journals.
The exact proposed phase chain, preserved hashes and limitations are in
[the continuation contract](../../../docs/research/2026-11-03-current-pp-retained-continuation.md).
No native phase is approved by author tests or by the earlier observer source review.
