# Independent native v3 phase-chain verdict

Candidate **8135cea8e7ff550964260b22009c980e477a2a10**, author-delta base
**8ca640e33595e5b21bb86a8dea59f6c57a5b91ad**. Reviewer: Codex, independent of the native v3 harness,
JPEG validator and shared phase/evidence extraction.

**No actionable finding. The four phases below receive bounded conditional GO.** This is approval
of the proposed exact-source phase chain, not a statement that prerequisites exist or that any
native phase has passed.

The only approved execution checkout is
**`/Users/marianzeis/.codex/worktrees/pinned-ddic-sdo/arc-1`**, branch
**`codex/native-declarative-v3-qualification`**, clean and frozen at **8135cea8e7ff550964260b22009c980e477a2a10**.
The parent supplied this checkout identity; the preparation utility archived its exact clean HEAD.
This immutable review snapshot is not an execution checkout. Approval does not follow other primary
integration, another checkout/revision, or altered runtime/configuration/dependencies.

| Phase | Verdict and required bound |
| --- | --- |
| Offline preparation | **GO once** with `--prepare-reviewed-declarative-v3` and the full candidate SHA. The fixed v3 root must not exist. Inspect and preserve the resulting exact six-owner intent. No native/credential work is part of this phase. |
| Fixed GET-only preflight | **GO** after that saved intent is inspected. Use `--preflight-reviewed-declarative-v3`, the same SHA/checkout/runtime. Retain the actual emitted sample ID, complete results and receipts. A failed or stale sample is not evidence; an authorized refresh must create another retained sample, without overwriting history or resetting a crashed sentinel. |
| Nonclaiming offline check | **GO** using `--check-reviewed-declarative-v3`, that SHA and the actual successful preflight ID, after the two genuine JPEG SM12 receipts below exist. It may be repeated to diagnose/correct unconsumed v3 operator inputs. Its success grants no execution permission and reserves nothing. |
| One six-owner native lifecycle | **GO for exactly one attempt**, using `--execute-reviewed-declarative-v3`, that SHA and the genuine fresh sample ID, only after all source/runtime/operating prerequisites below are met and the offline check passes. Scope is direct HTTPS **Basic-native A4H/001, MARIAN, `$TMP`**, using the fixed graph and source bytes. |

Use `/Users/marianzeis/.nvm/versions/node/v22.21.1/bin/node --import tsx` with the fixed
`scripts/qualification/pr1142/native-declarative-v3.ts` entry. There is no example operational
sample ID in this report. Do not invoke execute as a diagnostic: its exclusive claim is permanent
even if prerequisites/configuration refuse before native work. A passed offline check is never
cached as execution authorization.

## Evidence and scope of independent review

The source packet is
`/Users/marianzeis/.local/state/arc1-review/pr1142-native-declarative-v3-review1-20261102-233403/source`.
First and final verification each report **4,669 files unchanged** at the exact candidate.
The final source action was the verifier; this report was written outside afterward.

I read the full v3 implementation delta, fixed wrappers, shared coordinator and prerequisite reader,
runtime/binding changes, import graph, JPEG validator, regression tests, research/README, applicable
instructions/roadmap/plan, and effective native runner, driver, workflow, observer, request guard,
fixture graph and activation paths. The report preserves the distinction between byte-level image
validation and a human's interpretation of SM12.

Comparison with the previously independently approved **a0681f531efc452edaf8fca0777cfce0d0312ef6**
covered **2,778 tracked paths: 2,702 unchanged / 76 changed** (`independent-source-comparison.json`).
This is not merely the 21-file v3 delta: intervening private adapters are present. A separate
**29-path** list proves byte identity for the fixed fixture graph, driver, runner, native evidence,
transport fence, observer, declarative owner/context/source lifecycle, HTTP/mutation guards,
metadata projection, package and lockfile (`independent-unchanged-native-paths.json`). The shared
activation preparation refactor and raw-reference bound changed since a068; I inspected their
effective declarative path and tested current-source consumers. Single-owner native activation
still selects the explicit declarative grant, validates exact owner/package/recording/source,
preserves preaudit and verifies active native state. It does not select batch execution.

Prior review reference:
`../pr1142-native-declarative-v2-review3-20261102-220053/codex-independent-native-verdict.md`.
Historical operational audit:
`/Users/marianzeis/.local/state/arc1-qualification/pr1142-native-declarative-v2-prerequisite-audit-20261103.md`.
The latter explains the consumed v2 attempt: genuine JPEG bytes under PNG filenames failed the
correct old signature check, before that execute phase's credential/client/mutation entry.
V2's successful GET-only preflight did use authenticated reads. No v2 receipt is re-authorized,
relabelled or reused. I did not revisit or alter any permanent operational evidence or `.env`.

| Independent check | Result / artifact |
| --- | --- |
| Existing affected entry/binding/runtime/JPEG/driver/source/activation tests | **22 files / 645 tests passed**, `independent-focused.log` |
| Fixed fixture/evidence/transport/workflow tests | **4 files / 149 tests passed**, `independent-graph-activation.log` |
| New independent asynchronous-boundary/file probes | **13/13 passed**, `independent-phase-probes.test.ts`, `independent-probes.log` |
| All source/scripts/tests TypeScript projects | Passed, `independent-typecheck.log` |
| Full lint without fixes | Passed, three pre-existing informational template-literal notices, `independent-lint.log` |
| Final snapshot verification | **4,669 unchanged**, `independent-snapshot-final.log` |

The 13 probes simulate source/intent/preflight/baseline/image/time drift **inside asynchronous
runner loading**, after earlier checks. Every execution refuses before credential/client/runner
calls, permanently retaining its attempt. They also verify missing-root check creates no state,
and symlink, public-permission or oversized local receipts fail without claims/native calls.
Existing tests independently cover real temporary Git binding and unchanged index bytes,
offline import refusal on dotenv/HTTP/client/runner/preflight loading, historical v2 JPEG rejection,
chronology/freshness, replay, concurrent markers, actual-driver guards and owning cleanup.

Checks used existing dependencies and Node **22.21.1**; only mocked/injected native edges and
temporary test state were exercised. No source edits, install, manual Git commands, real protocol
entry/preparation/preflight/check/execute invocation, credentials, browser, SAP/external-network
access, delegation or push occurred. No dotenv/DNS incident or failed independent test occurred.
A read requested a nonexistent `native-declarative-observer.ts`; it was corrected to the existing
shared `native-observed-http.ts`, with no execution or state effect. Some broad diff outputs were
truncated; affected effective activation code and retained diffs were subsequently inspected.

I did not automatically repeat the author's full **530-file / 14,921-test**, build/docs/policy/size
gates or **59 historical scenarios**. Those remain clearly identified author results in
`review-input/author-report.md` (SHA-256
`46652b9a3b8be4bdd48e4fee4fbec2c80aba482a0bf0292b6c507948aada4281`), not independent native evidence.

## Why the phase chain is acceptable within this scope

The new tracked v3 entry maps to one new fixed permanent root. No CLI root/profile/image-format
override exists. Intent binds the exact source, actual repository path, Node runtime, fixture bytes,
target and identity. V3 intentionally reuses the unchanged V2 fixture name/marker family with a
fresh random suffix; it does not reopen the consumed V2 root. V2's wrapper preserves its PNG-only
receipt contract and permanent claim behavior.

The fixed `.jpg` files must be private regular files, opened without following a final symlink,
bounded at 8 MiB, with exact receipt hashes. The validator checks bounded JPEG markers/segments,
frame, scan and terminal EOI; it neither converts bytes nor decodes/interprets the screenshot.
Strict receipt schemas bind protocol/revision/intent/sample, exact client/user/table/argument,
zero-count assertions, chronology and five-minute freshness. Complete saved prerequisite bytes
are checked again, including through native execution and independent final absence.

The offline check takes the read-only binder path, disables optional Git index writes, requires
existing private state, and makes no directories, claims, journals or credential/native calls.
Its fixed result explicitly reports `attemptClaimed:false` and `executionGrant:false`. Execute
independently claims once, freshly reads the prerequisites and repeats combined verification after
asynchronous loading, before credential access. Source/evidence drift remains checked throughout
the lifecycle; freshness remains checked until the first mutation. A later refusal stays consumed.

The unchanged observer repeats request/source admission after asynchronous deletion guard reads,
before dispatch, preserving deadlines, response/attempt budgets and no-replay behavior. Owned
unlock and bounded owning-session close survive drift/stop. Deletion requires the current owner's
saved receipt and native absence of its fixed direct children; uncertainty preserves the dependency
closure. Independent final absence is followed by another combined evidence/source check. No
child, foreign owner or arbitrary native operation has been added.

## Genuine prerequisites and operating limits

Before actual execution, obtain a complete successful new v3 GET-only preflight and **both** fresh
SM12 searches after its completion, with independent visual inspection of the actual images:

- Client **001**, table **`*`**, user **`*`**, argument **`*<actual new intent suffix>*`**, complete
  result showing **zero locks**.
- Client **001**, table **`*`**, user **MARIAN**, argument **`*`**, complete result showing
  **zero locks**.

Store the **new untouched JPEG bytes** as `sm12-suffix.jpg` and `sm12-user.jpg` in the selected
v3 sample directory, with the strict private `sm12-baseline.json`, genuine observation times and
hashes of those exact files. No conversion, old-image reuse or v2 renaming is approved. The full
preflight and both observations must remain within the five-minute gate through the first mutation.
The harness cannot interpret displayed filters/counts; a hash/signature or refreshed UI session
alone is insufficient. No fabricated receipt, time, sample or zero-count assertion is permitted.

Keep the reviewed Node/loader/environment exclusions: no NODE_OPTIONS/GIT_* overrides, HTTP debug,
extra trust-root/module/TSX override or unsafe diagnostics; TLS remains verified. Preserve real
installed dependencies and ignored configuration. Package-lock/source binding does not attest
installed third-party dependency bytes; this existing limitation remains explicit. Do not commit
this report or other integration into the frozen execution checkout during the phase chain.

Use an idle SAP CI window, prevent unrelated MARIAN/native fixture writers from overlapping the
experiment and its post-controls, and keep the host awake. The one lifecycle is fixed: view DDLS,
abstract DDLS, DCLS, DDLX, abstract BDEF and SRVD; create/activate/comment-update/activate each, then
delete in reverse dependency order. No behavior implementation class, service binding/publication,
table-data mutation, helper execution, destination/role change or additional owner is included.
Actual SAP syntax/metadata/session behavior remains unknown until observed.

After exit, inspect all preserved outcomes and obtain fresh external suffix and MARIAN-wide
zero-lock controls. A pass requires all six completed owners, confirmed deletions, workflow and
independent typed absence/inventory, confirmed owning cleanup and both external controls. Preserve
any remaining resource, uncertainty and failure. No repair, repeated activation, forced DELETE,
foreign cleanup, lock deletion, claim removal/rename or second attempt is authorized by this verdict.
Any additional cleanup needs its own concrete scope and review.

This is only the exact **Basic-native A4H/001 MARIAN `$TMP` v3 phase-chain approval**. It is not PP
qualification, public capability/read-profile admission, deployment approval or whole-PR merge approval.
