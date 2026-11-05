# Native function protocol: source, activation and recovery

The first bounded native run used **`5704f92b88793752fa2a48ff5a0b3ed6bcea83e6`**, after the
[eleventh Claude Code Opus 5.5 max review](broader-pinned-pp-writes/claude-native-probe-corrections-review-20261102.md)
allowed one run. The reviewer found no High/Medium and four Low findings. Its immutable 4,466-file
snapshot was verified again by the author; the launcher selected `claude-opus-5-5 --effort max`.
The verbatim report SHA-256 is `9165eef35f31044c3e9abe8e0e1a6a31f89a15973e9d69d43eecbb90b8554b9d`.

## What ran and what failed

On A4H/001, existing MARIAN Basic credentials created one random-named `$TMP` function group and
one function module. Both creation requests returned 201. The complete 15-read group baseline
succeeded. One function-source PUT returned 200; its immediate GET also returned 200. **The probe
failed its strict readback comparison**, preserved both fixtures and reported `source-save-unknown`.
The original failed outcome remains unchanged. No activation request or DELETE was sent by the
probe. This was a native protocol observation, **not PP qualification or public function admission**.

Private receipts: `~/.local/state/arc1-qualification/pr1142-native-function-A89B1B693704A91A`.
There are 145 original records. `00127` is the PUT input, `00128` its response, `00130` the GET
readback, and `00145` the failed final result. The source-only fixture is committed at
`tests/fixtures/adt/function-source-a4h-readback.json`; it contains our temporary test code, no
credentials or SAP framework implementation. The GET source SHA-256 is
`600d083dc08fd796b8f428977c1ceca3b03a039ca0ffdacbf7341c0a7e5c91db`.

SAP lowercased signature identifiers, used CRLF and omitted the final CRLF on GET. The existing
comparator already allowed those changes. The new observation was **three empty lines between
the signature and executable body**. Parameter literal `'MiXeD'`, executable lines, indentation
and the body comment were unchanged. Separate active/inactive reads showed the generated empty
function still active and the new source inactive.

Read-only inspection of `CL_FB_FUNC_SOURCE_CONVERTER` explains the padding: its source assembler
adds empty signature lines to retain backend code line positions. The implementation remains in
private research, SHA-256 `c067c49d98b7dec34aef83cc0a74b6b4a0393f4ec0b4cd9e6e5f56211f1439fe`.
This explains a variable amount of empty padding, rather than a universal three-line rule.

## Individual recovery and absence evidence

The full probe was not rerun for cleanup. Separate operator recovery selected each exact fixture:

1. Fresh active/inactive metadata and source matched the inspected receipts and original identity,
   marker and `$TMP` package. The shared deletion adapter repeated those checks under the module's
   owning lock, sent one module DELETE, verified native absence and confirmed session closure.
2. After that deletion, all 15 original group baseline hashes matched. The shared group deletion
   adapter repeated the baseline check under the group and text-pool locks, sent one group DELETE,
   verified native absence and confirmed session closure.
3. Final GETs returned typed `ExceptionResourceNotFound` for group, module and group text pool.
   The 21,127-byte native inactive-object listing contained no fixture suffix. Its SHA-256 is
   `a41870c2e23e759bcd4ff35091334a204a359cdc8af5e5f834b1c796708bfff8`.

The recovery directories and `final-absence-2026-11-02T04-04-49.019Z` are under the same private
root. Both recovery results report `deleted`, `unlockFailed: false`, `sessionClosed: true`.
These observations do not claim a complete inventory of every SAP workbench object. They do
resolve the two preserved owners and selected text pool. No cloud, destination, role or XSUAA
configuration changed; previous PP cleanup remains complete.

## Corrections and regression evidence

The comparator now treats only **leading empty body lines** as generated framing. It still compares
body indentation, comments, internal line breaks and literals exactly after CRLF normalization.
The captured PUT response and GET readback now pass. A multiline-template regression proves that
internal empty lines and indentation cannot be changed. This is not general whitespace folding.
The second run below verifies this corrected comparison natively at `1bb2eb43`.

| Eleventh-review finding | Follow-up |
| --- | --- |
| 1: unexpected disappearance | A typed current 404 for a receipted fixture, without this run's DELETE, preserves its parent and records `unexpectedAbsence`. Runner cases cover disappearance before update and after a verified save. |
| 2: missing active source | A runner case covers post-create active-source 404, retains both inspection paths and sends no DELETE. |
| 3: raw session-close response | Pinned sessions get a separate all-response allowance of at most 64 KiB for close, independent of the forward response budget. Weaker nested policies refuse before creating a session. Legacy cleanup is unchanged. The internal close remains outside the private wire observer; the final close result is recorded, not a fabricated wire receipt. |
| 4: embedded userinfo | Audit scrubbing removes userinfo through the last `@` within each URL authority, including nested plain URLs in absolute paths/queries. `?`/`#` end the authority, so a query email address is preserved. Inputs retain the existing 500-character redaction bound. |

Nine new assertions failed before these fixes: the two native captures, padded template, two
unexpected disappearances, oversized close response and three userinfo shapes. The realistic
post-create active-read failure case already passed, confirming that existing preservation path.
After the fixes, focused checks pass, including independent close capacity after an exhausted
forward allowance. These authored regressions were subsequently checked by the twelfth independent review below.

The complete unit suite passes **474 files / 12,744 tests**. Type checks, build, lint, policy and
59 historical harness simulations pass. A cleanup-options type was extracted into the existing
HTTP budget module to keep the HTTP implementation within its size ratchet. The extracted type passes all three TypeScript projects; size/schema checks and strict documentation
also pass. These checks describe the reviewed `1bb2eb43` checkpoint; later corrections below need their own review.

## Second reviewed run and module activation

The [twelfth Claude Code Opus 5.5 max review](broader-pinned-pp-writes/claude-native-padding-review-20261102.md)
found no High/Medium and five Low findings. It permitted one fresh bounded run at
**`1bb2eb43b2627890c1789c27b3f09a8a0f2b8fe7`**. Both reviewer and author verified the immutable
4,469-file snapshot. Actual assistant metadata says `claude-opus-5-5`; the launcher used `--effort max`.
The verbatim report SHA-256 is `35b1de1e37e04b8b69b5517d9c53908836d70be9e9c1277f729ef91aa6d7b8c2`.

The second run created a new pair under the private root
`~/.local/state/arc1-qualification/pr1142-native-function-9E542DBBB23CA3D8`. Its 166 original receipts
remain unchanged. **Source update passed and reported `saved-inactive`** in record `00133`. The verified
source hash was `6c197970fd0ba60464638ee4bd2ddc8f0928c346c7929fcf2cc57e75dbbbdda9`.

The group preaudit POST (`00153`/`00154`) returned HTTP 200 with `checkExecuted=false`,
`activationExecuted=false`, `generationExecuted=true`. The strict engine refused to report activation,
and the run failed with both fixtures preserved, no confirmation and no DELETE. A subsequent 19-read
inspection confirmed that the module's active source was still the original empty generated function
(hash `82c85f4be9c3d4896b2cdf0a206658ba86e5d49c54472919a583a2595ae31b7e`); its inactive source
matched the verified save. Group generation did **not** activate the module in this observation.

A **separate author-reviewed operator action** then selected that exact existing module. This was
not a rerun of the creation/cleanup probe and was not independently reviewed by Claude before execution.
It required the clean `1bb2eb43` checkout, fixed fixture identity, all 19 inspected resource hashes,
one stateless preaudit POST and no confirmation, creation, source PUT or DELETE. Its exclusive
`individual-module-preaudit` directory contains 45 records. Record `0043` returned HTTP 200 with
all three execution flags true; `0044` reports native activation success. Fresh active-source GET
matched the saved source hash above. The explicit inactive GET fell back to the active representation;
it is not evidence that another inactive draft existed.

This records one observed native module activation. It does not qualify other function
activation scopes, pinned PP authorization or public function-family admission.

## Activated-module deletion refusal and complete-group recovery

An individually bound cleanup rechecked the post-activation receipts under the module lock, but
DELETE returned **423 / `ExceptionResourceInvalidLockHandle`**. The adapter reported `delete-rejected`,
`retryable: false`, `unlockFailed: false`, `sessionClosed: true`. It did not delete either fixture.
The failed attempt is retained in `recovery-delete-module-2026-11-02T04-56-33.025Z`.

A diagnostic repeated the lock/read/unlock sequence while locally refusing every DELETE. It recorded
only context-presence/equality booleans, never cookie values. The same SAP context remained present
through the checks, and cleanup closed it. This does **not** establish why the native lock handle was
refused. Reads changing native editing state remain a hypothesis; no production workaround is claimed.

The operator then deliberately selected the **complete owned test group, including its receipted
module**, for cleanup. The shared group deletion adapter held its group and text-pool locks while
all 19 post-activation resource hashes were rechecked through the original read connection. Every
hash matched. One group DELETE succeeded; unlock and session close both completed. This is distinct
from the automatic probe's empty-group cleanup rule and does not turn module deletion into a pass.
The recovery directory is `whole-owned-group-recovery-delete-group-2026-11-02T05-10-26.172Z`.

Final evidence in `final-absence-2026-11-02T05-12-20.335Z` shows typed 404s for group, module and
text pool. The inactive-object response is again 21,127 bytes with the same `a41870c2…` hash recorded
above, and contains no new fixture suffix. Both native runs' selected fixtures are now absent.
No cloud, destination, role or XSUAA change was made.

## Twelfth-review follow-up

- Metadata receipts now ignore source ETags alongside native version/timestamp attributes. Native
  source and identity checks remain independent; other metadata and link targets still participate
  in the hash. The candidate selects the saved module for activation. The explicit preservation
  gate below prevents any subsequent activated-module DELETE.
- An unexplained disappearance sets `failure: true` as well as the inspection ledger; regressions
  require the `unexpectedAbsence` record even when both owners are currently absent.
- Pinned close retains its Connectivity connection through bounded GET and fallback HEAD. The
  streaming adapter borrows that client; the owning session closes it. Real socket regressions
  cover success, 404 fallback, oversized response and an oversized response with a reset cookie.
  The 64 KiB allowance remains independent of the forward budget. Fresh PP verification is pending.
- Malformed userinfo containing `?`/`#` is scrubbed again. An author-discovered cutoff case now
  discards unfinished URL authorities before truncation can expose a password prefix. Complete
  authorities and ordinary long paths retain bounded diagnostics; harmless query emails survive.
- Added coverage verifies the recorded source hash, variable empty-line padding, rejection of
  whitespace-only lines, a runner using captured source framing and simulated ETag transitions,
  and oversized close preservation at runner level. These are authored simulations, not native runs.

Author verification of these corrections passes **474 files / 12,762 unit tests**, all three
TypeScript projects, build, policy, size/schema checks, strict documentation and the 59 historical
harness scenarios. Five audit, four proxy and four native-harness cases failed before their fixes.
The additional padding/hash and oversized-runner rows exercise already-present safeguards.
Two test fixture type omissions were corrected after the first typecheck; their focused suites
and the final typecheck pass. The thirteenth review below independently checked this checkpoint.

CI at the preceding `1bb2eb43` checkpoint passed unit and end-to-end tests but failed the existing
where-used case in [run 41388646841](https://github.com/arc-mcp/arc-1/actions/runs/41388646841).
The same intermittent failure is tracked in [#1057](https://github.com/arc-mcp/arc-1/issues/1057).
No assertions, fixture behavior or retry policy were weakened to make it pass.

## Thirteenth review and corrections

Actual **Claude Code Opus 5.5, max effort** reviewed immutable `fd44784187b92d6463e8f43186ef45bbc47d1c18`.
The [verbatim report](broader-pinned-pp-writes/claude-native-checkpoint-review-20261102.md) has SHA-256
`9c824ae04cac36edd4105e3f911eb46aa78e3953561e1f52f3c462f031a61e4a`.
The author independently verified the unchanged 4,475-file snapshot and launcher/model settings.
All allowed checks passed, including 12,762 unit tests and 59 harness scenarios. The verdict accepted
continued development, **not another live run**, with one Medium and four Low findings.

- The Medium finding is now addressed by an explicit gate: successful module activation preserves
  both owners and records the unresolved deletion reason. No activated-module DELETE follows.
  Separately, active-source readback must match the saved source and owned metadata before an
  `activeSourceVerified` receipt is written. True flags with unchanged source fail. A mock of the
  observed native 423 verifies one DELETE attempt, `delete-rejected`, and completed cleanup; it
  does not qualify the operation. Only module preaudit remains in the probe's wire allowlist.
- Successful integration/e2e function lifecycles now assert their existing module deletion outcome.
  Invalid-handle responses are excluded from cleanup retries, including a typed native error with
  a generic message. The user-facing hint asks for state inspection and repeating the whole operation only if it remains safe.
- Audit regressions cover slash-bearing malformed and cut-off credentials, including nested URLs.
  Absolute valid URL paths containing email addresses and numeric ports remain visible. Relative
  embedded URLs are conservatively over-redacted through their last `@`; regression coverage pins
  that loss of path detail. A numeric or empty port followed by an email-like path is syntactically
  valid and cannot be distinguished from a malformed credential attempt; those ordinary URLs remain visible. Pinned borrowed-close
  tests now also cover a stalled body/deadline and unexpected gzip without losing the write result.
- Replaying actual native metadata showed that ETag tolerance alone was insufficient: activation
  removed the exact owned `objectstates` alternate-version link. The new function-only comparator
  tolerates that one observed self-contained link; foreign hrefs, attributes, bindings and duplicate
  links still differ. The committed `function-metadata-a4h-activation.json` contains only our owned
  fixture metadata and hashes, with no credentials or SAP framework source. The original reviewer
  predicted the ETag fix would let the delete guard pass; retained native bytes show this additional
  comparison would still have refused. The explicit gate makes preservation independent of either
  incidental metadata mismatch.

Eight new/changed regression assertions failed before these corrections. The author subsequently
passed **474 files / 12,775 unit tests**. One broader run found an old assertion for the replaced
"Retry first" hint; the assertion now requires the new inspection guidance, and the final run passes.
All three TypeScript projects, build, lint (four pre-existing infos), policy, size/schema checks,
strict documentation and the 59 historical harness scenarios also pass. Independent review of
these new corrections is pending. No new native fixture has been created.

## Read-only deletion investigation

The existing e2e audit artifact from [CI run 41388646841](https://github.com/arc-mcp/arc-1/actions/runs/41388646841)
contains three FUNC DELETE requests, all HTTP **200**, including the main lifecycle fixture.
That CI server identifies its target as **a4h-2025**, distinct from the **a4h/001** target used by
these native probes. This is evidence of successful legacy deletions on the CI target; it does not
qualify pinned deletion or establish the cause on a4h.

The two retained a4h recovery sequences contain the same nine requests between LOCK and DELETE:
parent and child metadata, recording check, then active/inactive parent metadata, child metadata and
child source. The saved-inactive case succeeded; the activated case failed. File receipt timestamps
suggest roughly 0.90 and 1.08 seconds respectively; these are filesystem timing observations, not
native server durations. The failed response's reported handle is 40 hexadecimal characters and
contains no `+`; its value remains private.

Read-only native implementation inspection confirms that the handle is derived from the enqueue
argument and its timestamp/work-process/host identity. The DELETE check compares that value with
the current enqueue. A stable `sap-contextid` does not establish equality. Native implementation
source remains private. This explains what the check measures, **not which request changes it**.

The proposed repeated-LOCK diagnostic was not executed. The fourteenth review below rejected its
orchestration; subsequent read-only native inspection ruled out the method itself.

## Fourteenth review and retired diagnostic

The [fourteenth Claude Code Opus 5.5 max review](broader-pinned-pp-writes/claude-lock-continuity-design-review-20261102.md)
accepted immutable `0bf538a3d90cf09bb7d0b41b98b15ade9f40b4d5` as a development checkpoint with five Low
findings. The separate ignored diagnostic received five Medium findings plus a Low bundle and
**NO-GO**. Both reviewer and author verified all 4,474 snapshot files unchanged; actual model metadata
says `claude-opus-5-5`, and the launcher supplied `--effort max`. The verbatim report SHA-256 is
`71b063da8c924afb6d3f59c3011c56667a01ad2186c42bf370b4fb84034e40dc`.

The subsequent code/test corrections narrow alternate-version tolerance to the observed
`?version=active` link only, replay captured metadata through the runner, reject metadata drift,
distinguish deliberate activated-fixture preservation, and assert successful parameter-lifecycle
module deletion in integration/e2e suites. The reverse-link regression failed before the comparator
fix. The audit retention limitation and operator-facing error hint are clarified above.

The prerequisite investigation answered the key question without setting a lock: this target's
native FUNC branch calls `ENQUEUE_ESFUNCTION` with `mode_tfdir = c_enqueue_excl`; the observed
constant is `X`, with scope `1`. Every ADT LOCK obtains a new handle object and calls this native
enqueue path before hashing the fresh enqueue identity. It does not offer a passive cached-handle
read. [SAP's lock documentation](https://help.sap.com/docs/ABAP_PLATFORM_NEW/6568469cf5a1460a8d85c58b83d21ec2/47dc35ac5bc33b8be10000000a421937.html)
explains that X locks are non-cumulative. A repeated LOCK can therefore conflict with the existing
lock; it cannot serve as the proposed equality measurement. The candidate is retired, its local
entrypoint now refuses unconditionally, and the exact reviewed source is retained in the private
review archive. No fixture was created, no diagnostic LOCK was sent, and no cleanup was necessary.
The orchestration findings are not claimed fixed; that unexecuted design was dropped.

Private native evidence includes `LSEUQF02` SHA-256
`70e70b06a9766abfe879998a237a6357524a9c246a9472ba5ce58a1d73527f9d` and `LSEUQTOP`
`498a59a3850736af7aef4be9dd845b7602e3e2c72174faab442f6cb8fb303cf3`. Vendor implementation is not
committed. The discovery response advertised lock-object definition services, but no runtime
lock-entry read service was found in that response. This is not proof that no such native API exists.
The invalid-handle cause remains unresolved; no production lock-order change follows from this research.

A read-only WebGUI SM12 inspection on A4H/001 confirmed a passive lock-table view. The exact
selection was client `001`, user `MARIAN`, table `TFDIR`, argument `ZARC1_NF_*`, limit `20`;
it returned zero locks. The view exposes lock time, mode, dialog/update counters, context and
argument, and offers a details view. No lock was created or deleted. This establishes an available
observation surface, not a validated replacement experiment or evidence about a future lock.

## Active-version evidence follow-up

Author inspection during the fourteenth immutable review found that matching source and normalized
metadata could still label an explicit active GET's inactive fallback as active. Two new runner
regressions reproduced this with successful activation flags, matching source and either inactive
or missing native version metadata. Both failed before the correction. The identity parser now
retains the namespace-validated native version, and post-activation proof requires `active` before
recording `activeSourceVerified`. The captured saved/active metadata also verifies these values.

The correction passes 43 focused probe tests, all 12,777 unit tests and all three TypeScript projects.
It is subsequent to the immutable `0bf538a3d` review snapshot and needs independent review before any
new diagnostic run. No new SAP fixture or configuration change has occurred.

CI on `0bf538a3d` flagged `tests/unit/adt/class-structure-evidence.test.ts:170` as incomplete string
escaping. The expression was intentionally inserting one MiB of whitespace into a test XML fixture,
not escaping input. It is now an explicit single insertion using slices, preserving the same bytes
and size-limit refusal while removing the misleading replacement shape. The focused class-evidence
suite passes; the next CI run must verify the annotation is resolved.

After all five Low follow-ups and the active-version correction, the author passed **474 files /
12,781 unit tests**, all three TypeScript projects, build, lint (three infos), policy, size/schema
checks and strict documentation. These final checks supersede the intermediate 12,777-test count
above. Independent review of this subsequent patch is still pending.

## Fifteenth review and passive observation candidate

The [fifteenth Claude Code Opus 5.5 max review](broader-pinned-pp-writes/claude-active-version-review-20261102.md)
accepted `ca87161729b039daf6f8a2d7321a292fa8807eb2` as a development checkpoint with **zero High,
zero Medium and six Low findings**. The actual model was `claude-opus-5-5`, with `--effort max`;
reviewer and author independently verified all **4,473** archived files unchanged. The verbatim
report SHA-256 is `4fe72885383b3d3e0a82af77ecb673aebced79aef8279c8c2c763164ab7d8ece`.
It passed 474 files / 12,781 unit tests, 59 historical harness scenarios, the three TypeScript
projects and size/schema checks. This does not approve a new native experiment or the complete PR.

The six follow-ups are addressed in the subsequent candidate:

1. The foreign Atom-namespace regression now changes the alternate-version link's own binding.
2. A preaudit that activates the saved source while returning a confirmation prompt now preserves
   both owners. The new regression reproduced both unwanted DELETEs before the correction.
3. Snapshot events distinguish `requestedVersion` from `nativeVersion`, including explicit null
   for missing metadata. The active-source receipt includes its native version and metadata hash.
4. Tests now assert deliberate preservation, invalid-lock inspection guidance, foreign/duplicate/
   unqualified root-version attributes, and the captured saved-state fallback through the runner.
5. The plan identifies the repeated-LOCK candidate as rejected and retired, not pending.
6. Retained preactivation active responses are replayed through the narrow comparator and runner.
   Original receipts `00110.json` and `00145.json` both hash to
   `b0c066d6268852139a8f364616aa1268344b9963305f408dc38f591e3b0343e1`; they report active version,
   retain the inactive alternate link, and still serve the unchanged empty active source. These
   captured owned-fixture responses are committed with the existing fixture, without another run.

[CI for ca8716172](https://github.com/arc-mcp/arc-1/actions/runs/41405547564) is green, including
CodeQL, integration and e2e. The actual logs confirm both two-test FUNC parameter suites executed,
including their successful-delete assertions; they were not skipped. Their CI target remains
distinct from this A4H/001 pinned/native investigation.

The new tracked `native-lock-workflow.ts` proposes a fixed, one-time experiment with separate
fixture preparation, passive SM12 observation and inspected whole-group recovery invocations.
It binds the actual loaded entry and clean source, refuses executable shadows, claims each phase
durably before credentials, and preserves fixtures between phases. The observer uses one LOCK,
bounded reads and external SM12 reports; it never calls DELETE or repeats LOCK. Owning HTTP context
booleans accompany each observation. Independent cleanup remains bounded on stop or timeout.
Recovery requires explicit acknowledgement of the inspected complete inventory and fresh identical
reads under the separate owner locks, followed by native absence checks.

The [operator procedure](../../scripts/qualification/pr1142/README.md#passive-sm12-investigation)
requires fresh SM12 searches and private per-step UI captures. Operator answers and visible enqueue
columns are not proof of the backend's full handle identity. The parser does not itself verify the
separate capture files. The candidate has not run on SAP and still needs independent review.
No replacement fixture, diagnostic lock or cloud/access change has occurred.

The author passed **477 files / 12,826 unit tests**, the three TypeScript projects, build, lint
(three existing infos), policy, size/schema and strict documentation checks, plus all 59 historical
harness scenarios. The added observer, recovery and control suites contain 36 cases, including
deadline/abort, changed context, uncertain locks/close, changed parent content, extra group members,
malformed inactive-list evidence, fixed phase claims and rejected copied entrypoints. A test-only
type annotation and formatting issue found during the full checks were corrected. Native evidence
and independent review remain distinct outstanding requirements.

## Sixteenth review and executed passive observation

The [sixteenth Claude Code Opus 5.5 max review](broader-pinned-pp-writes/claude-passive-lock-review-20261102.md)
accepted `086a8f5b18c575d183f2ccb2e46ba1d6f4f755b1` as a development checkpoint with
**0 High, 5 Medium and 7 Low findings**, all Medium findings concerning the private experiment.
The actual model was `claude-opus-5-5`, launched with `--effort max`; reviewer and author verified
4,483 archived files unchanged. Verbatim report SHA-256:
`c5ee82c8b39086561c6e0f1f21100cb1e81f6fc2aa28aa701865fe55cd4ea08c`.
All six findings from review 15 were closed. This was conditional approval of one experiment,
not whole-PR acceptance or production/PP qualification.

The author satisfied its prerequisites before preparation:

- Clean exact revision, Node 22.21.1, real dependencies, validated existing MARIAN/001 HTTPS
  credentials, no ignored source shadows or Git index exceptions. `NODE_OPTIONS` was absent,
  the only `GIT_*` variable was stripped, and each native phase ran under `caffeinate -i`.
- Retained trees from both previous pairs contained SAPL before the group preaudit; their
  post-child trees passed the exact four-member check. Pre-child trees correctly lacked FUNC.
  All 19 retained raw-body hashes matched the later raw-comparison receipts, including reads
  under group/pool locks. The later whole bodies and original MIME headers were not all retained;
  this replay does not establish those headers. The old diagnostic confirmed the same owning
  connection and exact nine-request order.
- Ten complete fresh zero-lock searches, AX/screenshot captures and acknowledgments passed
  with a persistent input writer: 10.7–16.7 seconds each, below the required 18 seconds.
  Two earlier read-only rehearsals failed: one exceeded the input deadline, and one encountered
  an expired WebGUI session. Neither involved a native fixture or lock. Both remain recorded.
- Stop rules, outcome interpretations and independent SM12 controls were written outside Git
  before preparation. Each phase and the fixed experiment name were claimed once.

The one experiment ran at the reviewed revision on A4H/001 on **2 November 2026**:

| Phase (UTC) | Observed result |
|---|---|
| Preparation, 09:44:05–09:44:17 | One random local FUGR/FUNC pair; active source/native version verified; all 19 actual bodies and MIME types inspected. No DELETE request was attempted. |
| Before observation, 09:45:19 | Fresh SM12 search for the exact module: zero locks. |
| Observation, 09:45:31–09:48:18 | One FUNC LOCK; initial and seven subsequent captures showed unchanged visible fields. First absence followed the inactive FUNC metadata GET. |
| After observation, 09:49:05 | Process exited; UNLOCK and session close confirmed; fresh SM12 search showed zero locks. |
| Separate recovery, 09:49:41–09:49:45 | All 19 fresh raw hashes matched under the separate group/pool locks; only whole-FUGR DELETE was sent. Group, module and text pool returned typed 404; valid inactive list contained no fixture. |
| After recovery, 09:50:27 | Fresh SM12 search showed zero locks. |

The ordered observations were `locked`, `group-default`, `module-default`, `recording-check`,
`group-active`, `module-active`, `source-active`, `group-inactive`: **present**; then
`module-inactive`: **absent**. The final `source-inactive` read was deliberately skipped.
The visible lock was X, dialog counter 1, update counter 0, with unchanged time and blank
context/backup columns while present. HTTP context equality remained true through every
checkpoint and cleanup. The result is a correctly stopped transcript, not a completed ten-point
sequence. Visible fields and HTTP context do not establish complete native handle identity.

The interpretation was fixed in advance: this is the **first visible change after the sequence
through inactive FUNC metadata**, not proof that that request alone caused the change, nor proof
of the earlier DELETE 423 mechanism. There was no direct FUNC DELETE. This slow, single-system,
activated-state sample does not qualify FUNC deletion or PP. The independently successful
whole-group cleanup does not change that limitation.

Private evidence remains under the consumed `pr1142-passive-function-lock-v1` claim: 194
preparation records, 59 observation records, 52 recovery records, per-step and control AX/PNG
captures, inspection acknowledgments and results. The private evidence-manifest SHA-256 is
`77d9d99d54c3c8b6faf854d1b556e538f171a58ccb68bca0d3a21c21bbcfa24f`.
The inspected inventory SHA-256 is
`2a831b756aa0f8abccf45d846c7e56e4cf5c5034606cb2f15b7669a612cf765b`.
Both owners and their text pool are absent. No BTP, PP, destination or permission change occurred.
Do not rerun or rename the consumed experiment.

Review 16's timing, inventory and missing-control findings were addressed by the prerequisites
and controls above. The phase-gate test gap and unsupported-failure recovery cases remain limits
of that historical workflow; no such recovery was needed. Its remaining Low findings are retained
in the verbatim report, not silently declared fixed. Any future workflow needs its own reviewed
controls, source binding and failure plan.

The next author change isolates additional **qualification** version/source verification reads on
that fixture identity's original base HTTP connection while the mutation retains its lock.
Production owner, package and CTS checks stay in the owning session. A deliberately hostile mock
that invalidates a lock on a versioned guard read reproduced the old refusal and passes after the
isolation change; all 24 runner cases pass. This constructed regression establishes isolation,
not SAP's exact invalidation mechanism. Activated fixtures remain preserved by default, and a
new native activated-module deletion qualification still needs a separately reviewed procedure.

The branch also merged main at `744064c49`; the only textual conflict was the dev-guide table.
Both pinned package-resolution guidance and main's retryable feature-probe guidance were retained.
Dependencies were reinstalled from the merged lockfile; existing private caches were preserved.

## Active-deletion candidate before execution

The private native entry now requires the explicit `--execute-reviewed-active-delete` mode and
claims `pr1142-active-function-delete-v1` once. Its testable orchestration covers argument,
runtime, source-binding, credential, claim, stop-listener and final-proof gates. Isolated real-Git
tests cover the accepting binding path, wrong revisions, changed entries/lockfiles, hidden index
flags and ignored executable siblings. Git calls now have ten-second deadlines.

The ordinary runner still preserves active fixtures. Only the explicit qualification mode can
release its deliberate preservation after confirmed native active source and metadata, with no
pre-existing uncertainty. A fresh active-version check and independent fixture reads on the base connection
precede the actual deletion under its owning lock. The mode reports `activeDeletionVerified` only
after that DELETE and typed module absence. A confirmation-only preaudit cannot qualify it.
Final success additionally requires typed absence of the group, module and text pool plus a valid
bounded inactive-list response without the fixture. This remains a candidate for review, not native
evidence or a production admission change. The [operator procedure](../../scripts/qualification/pr1142/README.md#native-active-function-deletion-qualification)
fixes the one-run limits and the stop/recovery rule before execution.

## Seventeenth review and successful native active deletion

The [seventeenth actual Claude Code Opus 5.5 max review](broader-pinned-pp-writes/claude-active-delete-review-20261102.md)
accepted `5b1669eb75f631aaceb3758b1957ed7d7924e5b4` as a development checkpoint: **0 High,
4 Medium and 7 Low findings**. It conditionally approved one exact active-FUNC deletion run,
not the complete PR, public function admission or PP qualification. Its verbatim report SHA-256 is
`94cd3c7fef94473fb7daab78b701fd9ad83b49267b6aae79ece855cea1ad6930`. Both reviewer and author verified 4,514 snapshot files unchanged.
The reviewer independently passed 484 files / 12,961 unit tests, 59 historical harness scenarios,
three TypeScript projects, 962 source/test budgets and 12 schema scenarios. The author's build,
lint (three existing infos), 135 policy entries / 14 schemas and strict documentation also passed.
The reviewer disclosed three executed read-only `wc` commands outside its permitted command list
and one refused outside-snapshot read; no SAP/operator command or source edit occurred.

All required preconditions were recorded outside Git before the one invocation:

- The real checkout was clean and detached at the reviewed revision. Real installed dependencies,
  Node 22.21.1, all index flags, ignored-source absence, the missing fixed claim and existing
  MARIAN/001 credentials were checked. Runtime Node/Git/tsx overrides were removed from the child
  environment; strict-TLS authenticated discovery returned 200. The process ran under `caffeinate`.
- The retained postactivation default FUNC metadata normalized to the verified active receipt
  (`69ddefbc971e86f5b0c0cf2cf9f8cc64a95f18fc56f4fd184af41a8df895f4c6`). Parent default metadata
  and inactive main source matched creation. Three of 15 parent inventory resources differed while
  the child still existed. Group preservation was therefore expected, without weakening the guard.
- Stop rules and result interpretations were written before execution. A fresh complete SM12 search
  for MARIAN/001 across all tables and arguments showed zero locks. All CI checks had completed:
  E2E/build/unit/docs/security passed; the sole integration failure was the documented #1057
  empty where-used result family. Its initial logs and exact diagnostic artifact were retained.
  That explicit review exception is not an all-green-CI claim or a root-cause finding.

The single consumed `pr1142-active-function-delete-v1` invocation ran on **2 November 2026,
11:11:30–11:11:47 UTC**. It created one random `$TMP` FUGR/FUNC pair,
verified native active version and exact saved source, and deleted the active FUNC under its
owning lock. Its separate fixture guard used the base connection; production package/recording
checks remained in the owning session. All 15 parent baseline comparisons passed after child
removal, allowing the guarded group/text-pool cleanup. Typed group/module/pool absence and the
bounded native inactive list confirmed removal. No recovery or second attempt was needed.

The [sanitized result](broader-pinned-pp-writes/active-function-delete-native-20261102.json) records
`failure=false`, `activeDeletionVerified=true`, `cleanupUnconfirmed=false`,
`finalAbsenceConfirmed=true`, no remaining/pending/inspection objects and no cleanup issues.
All 297 private journal records remain retained. Result SHA-256:
`2cc6121979b5377735509c07fb3be6503015d4acf25470a503d6c693fcfab74b`; private evidence-manifest SHA-256:
`e3db18abdb147c81266337ff7959fad18884b63f937d54f90a6547625162bbf9`.

After process exit the first WebGUI search encountered an expired session and was discarded.
A fresh completed search after renewal at **11:15:16 UTC**, across every user and table
in client 001 for the random fixture suffix, showed **zero locks**. AX/PNG controls are retained.
This is a later independent observation, not proof that no transient lock existed between samples.

Review 17's first two Medium concerns were addressed by the retained replay and the observed native
baseline restoration; its third by the written controls and result table. Its fourth remains an
interpretation limit: the base connection's context absence was not instrumented, so neither this
success nor the passive sequence establishes the historical 423 cause. Low findings remain limits
of the consumed private harness, not silently fixed production findings. Any future workflow must
address applicable findings and receive separate source-bound review. Never rerun or rename this claim.

## Remaining qualification

This successful native sample does not convert the earlier failed full probes into passing runs.
It qualifies the one local active-FUNC deletion case at `5b1669eb`, not PP, recording transports or
another release. The newer private exact-FUNC activation adapter has offline tests but was not
part of this execution. FUGR/group-INCL activation, public function admission, remaining profile
qualification and current-byte two-writer/recording-transport PP evidence remain open.
The last PP artifact remains `77e41fdcd`.

Remaining DDIC/CDS/SDO, RAP/batches, package/API/publication, CTS, trace/quickfix and classic FLP work
remains in PR #1142. Git/plugins remain excluded; aggregate, Basic, Copilot and read-only connections
remain mutation-free. All native fixtures are absent. No BTP, PP, destination or permission change
occurred. PR #1142 stays draft; FEAT-93 stays open.
