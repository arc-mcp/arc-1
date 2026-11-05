# Eighth review follow-up and native function probe

PR #1142 remains draft; FEAT-93 remains open. The eighth actual Claude Code Opus 5.5
review inspected immutable commit `0b0649e8d8e834201125ba09c5be5a1ff048f35b`, with
`--effort max` in the launcher. It reported no High, no Medium and six Low findings.
The reviewer confirmed the model, but could not independently see the effort setting.
Its first/last manifest checks and the author's subsequent check verified 4,350 unchanged
files. The [verbatim report](broader-pinned-pp-writes/claude-activation-followup-review-20261102.md)
has SHA-256 `cd2dd01ddfb089aebc001e4ae13c201bf3c1f1d9392eb24d634cd5f12edca11c`.
This permits continued development; it is not whole-PR acceptance or live qualification.

## Follow-up dispositions

| Finding | Change and evidence |
| --- | --- |
| 1: pre-submit/preaudit-validation errors received an activation-unknown marker | Only the three activation POST boundaries now add this marker. Pre-submit cancellation and cancellation after a preaudit prompt have negative assertions. Existing recovery wording is retained. The legacy sequential ED064 test now waits for a real retry-start signal instead of counting microtasks. |
| 2: hierarchy failures copied SAP diagnostics into safety errors | Hierarchy errors retain the root/status and typed local traversal-limit reasons. Other upstream messages are omitted. Tests cover a native sentinel through the package policy and pinned serializer with both minimal-error settings. |
| 3: successful LOCK responses could lose cleanup evidence | Missing handles produce an explicit unknown-lock record. Non-modifiable responses retain their returned handle privately and release it through the owning session; the legacy 423 contract remains. Tests verify both paths. Queued cancellation remains conservatively uncertain, with conditional recovery wording. |
| 4: metadata-only creation failed at the result boundary | The admitted route and private candidate tests use the same internal `executePinnedSourceWrite` boundary. A verified metadata-only creation returns `created`, actual source hash and observed parent membership. It does not claim an inactive save. No function capability was publicly admitted. |
| 5: ignored function inputs | The private factory applies action/type field lists before SAP access. Tests reject processing/parameter inputs on the wrong types/actions and source on deletion. A creation package remains accepted because the existing native-parent check actually validates it. |
| 6: test gaps | Added uncertain/rejected POSTs, package/recording drift, post-create membership drift/size, prefix refusal, creation ordering, nonvacuous POST/PUT transport assertions, additional/delete lock uncertainty, prior cleanup refusal, the inner text-input gate and diagnostic bounds. The remaining broad FUGR refusal assertion now checks its reason. |

The author reproduced four failing assertions before the corresponding fixes: activation
uncertainty before confirmation, leaked hierarchy text, a missing-handle LOCK proceeding,
and a returned non-modifiable handle not being unlocked. This does not mean every review
finding was reproduced. The reviewer itself executed no failing case.

Structural-include membership now explicitly requests the parent's inactive source view.
That is a selection request, not evidence that SAP returned a distinct inactive version.
The [function source comparison candidate](2026-11-02-pinned-function-source-proof.md) accepts
identifier case normalization in framing while preserving body/literals/comments. Its native
save behavior remains unqualified.

## Native probe: prepared, not yet executed

`scripts/qualification/pr1142/native-function-contract.ts` is a narrowly scoped native protocol
probe for A4H/001. It uses the existing MARIAN Basic credentials directly, outside any MCP
application. It does not enable a Basic multi-target route, change roles/configuration or
establish PP/authentication correctness. The private adapter is exercised through its shared
result boundary; final deployed two-writer PP qualification remains required.

The probe requires a clean checkout at an explicitly supplied reviewed commit. It generates
one fresh `$TMP` function group and one function module, proves initial absence, creates native
metadata, verifies a source update, and captures group activation preaudit. Any expanded
reference list is recorded and refused before confirmation; the transport also blocks a
confirmation POST. An initial preaudit request can itself execute activation when SAP requires
no expansion, so this is a write test, not a read-only probe.

Private durable receipts contain request/response evidence, source hashes and metadata. They
exclude headers/cookies, query lock handles and lock response bodies. All intercepted requests
receive finite deadlines and no-replay policy. Cleanup verifies the native name, description,
author and source/metadata receipt under the owning lock. Version/change-time differences are
explicitly excluded from the metadata hash; other metadata differences are significant.
The group creator is required. FUNC metadata on this system has no promised creator field;
the probe checks any reported author and requires `changedBy=MARIAN` after its source update.
Initial module provenance is the typed absence, confirmed create and exact owned parent/container.
Group cleanup additionally requires module absence, restricted native membership and unchanged
generated TOP/UXX source baselines. A rejected or uncertain step can preserve fixtures for
operator inspection; there is no blind mutation retry or force-cleanup mode. Signals stop forward
work cooperatively. This does not provide crash/SIGKILL/disk-failure recovery guarantees.

The helper's offline checks cover its mutation restrictions, identity binding, deadline policy,
metadata comparison, receipt redaction, owning-session observation and refused cleanup. They do
not execute the live runner or prove SAP behavior. Native response shapes, normalization,
creation/processing side effects, class/function/pool activation references and post-delete
cleanup still require controlled captures. The last PP run remains the older `77e41fdcd` artifact.

No new live mutation or elevated state was introduced while preparing this checkpoint. The
earlier BTP/SAP restoration remains complete. Remaining accepted PR 2 scope is unchanged; see
the [implementation plan](../plans/2026-10-26-broader-pinned-pp-writes.md).

GET-only controls at 00:35 UTC on 2 November confirmed typed `ExceptionResourceNotFound`
404s for a fresh group URI and its module URI. Existing `SU_USER` metadata included creator,
changer and description fields (3,357 bytes, SHA-256
`b692a6f68381918f98e21ff1959298195452247a6e9102a3ba005ecc8aa77679`). Its
`BAPI_USER_GETLIST` module metadata included changer and description but no creator field
(2,639 bytes, SHA-256 `5393f7e288de773f2b7c33920e879acf6b2b3f636780d6c4e56ef88ccc09dfca`).
These private captures establish read shapes only, not creation/update or author qualification.

## Current-main integration

Merged `b6fd8629bee59b25ae6a4741a59275c22774db1f` through merge commit `2ebeaa76f`.
The PR's Node 24 CI run (`41363131230`, job `125017573717`) exposed a new-main
regression test: invalid pinned whole-class source reached three native reads before lint
rejected it. The failure was reproduced locally on the merged branch. Whole-source pinned
CLAS/INTF/PROG/INCL updates now lint before package/recording reads and reuse that result;
legacy ordering and source transformations/fragments retain their existing paths. Tests prove
zero native requests on the invalid input and one lint invocation for a successful save.

Merged-branch author validation: 470 unit files / 12,672 tests, all three TypeScript projects,
build, strict documentation build, lint (four existing informational diagnostics), policy
coverage, file/schema budgets and the historical qualification-harness tests pass. These are
local checks, not a new live qualification or an independent review of this revision.
