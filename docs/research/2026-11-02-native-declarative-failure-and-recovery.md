# Declarative qualification: retained inactive DDLS and bounded recovery

Status: the original experiment failed. The separately reviewed cleanup passed at `eb82bd99`
and removed its one retained inactive DDLS. Both claims are consumed. This is neither full
lifecycle qualification nor public admission.

## Review and actual native attempt

Actual Claude Code `claude-opus-5-5`, launched with HIGH effort, independently reviewed
`e2b08f3d984f8cd84a30038f74820932db36cf1a`. Review 24 closed all eight review 23 findings and found
zero High, zero Medium and four Low findings. It accepted one bounded native invocation after a
successful GET-only preflight and fresh SM12 controls. The
[verbatim report](broader-pinned-pp-writes/claude-native-declarative-review24-20261102.md) has SHA-256
`e3d57519532b28f16333f0424e19978fe5407c1221a51de17557e47d00649633`.

All required CI at that revision passed, including live integration and e2e. The native run used
a clean detached checkout, Node `v22.21.1`, direct HTTPS A4H/001, SAP_BASIS 758, Basic identity
MARIAN and `$TMP`. `GIT_PAGER` and `NODE_EXTRA_CA_CERTS` were removed from the child environment;
HTTP debug was unset. The host was kept awake for the command. No BTP configuration, roles or
permissions changed.

The GET-only preflight passed on six fresh names (`6CBF9FF28DC3BF6A`): typed absence for each
owner and a valid inactive inventory without the suffix. A fresh SM12 user-wide search showed
zero locks. The mutating invocation ran once at 18:55:52–18:56:02 UTC with a different fresh suffix,
`61EDD87470C55DB0`:

| Observed operation | Native result |
| --- | --- |
| Six owner GETs and inactive inventory | All typed absent; inventory valid without suffix |
| Create `DDLS ZARC1_NV_61EDD87470C55DB0` | HTTP 201 |
| Own LOCK, metadata/recording checks, source PUT and source readback | Successful; stored source hash matched |
| Own UNLOCK | HTTP 200; adapter reported session closed |
| Independent snapshot | Expected owner, `$TMP`, marker and inactive source |
| Exact-owner activation | HTTP 200 containing failed activation, including `CONNECTION is a reserved word` (DT 205) |
| Forward work and cleanup | Stopped conservatively; no other owner created and no DELETE sent |

The result is permanently `failure: true`, `mutationAttempted: true`, `cleanupUnconfirmed: true`,
with that one owner in `remaining` and `inspectionRequired`. The claim
`pr1142-native-declarative-v1` is consumed and must never be removed, renamed or reused. Both
fresh post-run SM12 searches—suffix across all tables, then user-wide MARIAN/001—showed zero locks.
Zero locks does not mean the repository object is absent.

## Fresh read-only inspection

Six bounded, no-replay GETs subsequently read default/inactive/active metadata and source for
that exact owner. All returned HTTP 200. Every metadata variant explicitly said **inactive**;
all source variants returned the same original 331 bytes. Thus the `version=active` query fell
back to inactive content and is not active-state proof. The recorded native metadata/source is
preserved as a [test fixture](../../tests/fixtures/declarative-owners/failed-ddls-native-20261102.json).

- Source SHA-256: `781de85d098984f7661581ebd222ee0f7875f17d57e4d02744694a1019f8c115`.
- Raw post-failure metadata SHA-256: `02ef881d64cae1f70f1b74c3fef5dab129c9b5acb189f958de05baea0b155848`.
- Namespace-bound canonical metadata SHA-256: `37b72e19abf15b3d21f5faaa43440ad0acb0c3492ba774ba3345ab3ce6218c54`.

The activation-log links added after the failed activation change the metadata receipt from
the pre-activation receipt. Recovery uses this fresh observed state, not an assumption that a
failed activation left metadata bytes unchanged. Private receipts retain the original experiment,
inspection and SM12 evidence. No unrelated inactive-inventory body is published.

## Corrections and recovery boundary

The generic fixture now uses `ConnectionId`; its regression checks both initial and updated
source variants. This does not repair the retained object or prove native compilation of the
remaining fixtures. A future full attempt needs new reviewed bytes and a new experiment name.

Review 24's four Low findings are addressed: non-200 absence answers retain an untyped status
instead of claiming presence; configuration refusals preserve field names and no-mutation status;
the operator table explains `delete-not-sent` and preserved dependency bases; and SM12 controls
require both suffix and user-wide searches. The README explains ignored credential-file setup.

`native-declarative-recovery.ts` is a separate cleanup-only entry. Before credentials it binds the
reviewed source and claims `pr1142-native-declarative-recovery-v1`. It then verifies the immutable
original manifest and failed-result hashes. The exact owner, source, marker, authorship, package
and inactive metadata receipt are fixed; changed or unconfirmed state refuses cleanup. Fresh
proof is repeated while the shared deletion adapter holds its owning lock. The adapter rechecks
the actual package and native local recording context in that session.

Only GET evidence, exact-owner recording checks, own LOCK/UNLOCK and the single exact-owner DELETE
are allowed. No create, source repair, activation, different owner or request replay is permitted.
Cancellation or a changed source binding refuses DELETE after the guard reads; the validated
own UNLOCK and session close remain available. Success requires the adapter's deletion result,
fresh independent typed absence, inventory evidence and confirmed lock/session cleanup. A failed
or uncertain result remains failed and cannot be retried under the same claim.

Independent [Codex review 25](broader-pinned-pp-writes/codex-native-recovery-review25-20261102.md)
returned **NO-GO** for `4575b2cb`: the inherited observation helper could retain a live lock
handle echoed in a typed DELETE response. No live cleanup ran at that revision. The correction
omits success/error response bodies for every request carrying a lock handle, while preserving
status and byte-count/digest receipts. Two regressions exercise the actual recovery/observer
path: a typed DELETE failure stays unconfirmed with one attempt and its own unlock/close, and
a successful DELETE response still requires independent typed absence. Both sweep persisted
records and outcome for the fixture handle, session context and password. This is a recorder
correction; the literal cleanup scope and original experiment claim are unchanged.

**Historical cleanup procedure, now consumed:** review 26 accepted exactly one invocation at
`eb82bd99cd786e5b073b79cfd300ad3696465123`. It has run; do not execute this command again:

```sh
node --import tsx scripts/qualification/pr1142/native-declarative-recovery.ts --execute-reviewed-inactive-ddls-cleanup eb82bd99cd786e5b073b79cfd300ad3696465123
```

After exit capture both fresh SM12 searches. A pass needs `failure: false`, `confirmedDeleted: true`,
`cleanupConfirmed: true` and zero locks in both searches. Preserve any mismatch and investigate
read-only; never use SM12 lock deletion. Even a successful recovery will not convert the original
experiment into a pass.

## Executed cleanup and final state

Independent [Codex review 26](broader-pinned-pp-writes/codex-native-recovery-review26-20261102.md)
closed R25-1 with no new findings and approved one cleanup at the exact revision above. Its report
SHA-256 is `4f7ed819b7902153767a7c8513bddfd6bcf96e0f5a285670b1931b3a9c60e4db`.
The source remained clean and detached throughout execution, using its real dependencies and Node
`v22.21.1`; the prescribed runtime variables were unset. No credentials, BTP roles, destination
configuration or SAP permissions changed. The stale browser session was refreshed before a new
SM12 user-wide MARIAN/001 all-table search confirmed zero locks.

The one cleanup ran **20:08:23–20:08:29 UTC on 2 November 2026**. Fixed source/metadata receipts
matched before locking and again while the shared adapter held its lock. Native package/recording
checks passed. The single DELETE returned HTTP 200; own UNLOCK returned HTTP 200 and session
cleanup was confirmed. Independent stateless GET proved typed owner absence; the valid inactive
inventory did not contain the fixture. Fresh suffix and user-wide all-table SM12 searches each
showed zero locks. No fixture remains from these experiments.

The [sanitized result and evidence hashes](broader-pinned-pp-writes/inactive-ddls-cleanup-native-20261102.json)
record `failure: false`, `confirmedDeleted: true`, `cleanupConfirmed: true` and empty `remaining` /
`inspectionRequired`. Original v1 receipts and failed-result hash are unchanged. Both the original
lifecycle and cleanup claims are permanently consumed. Cleanup success does not convert the
original activation failure into a passing lifecycle or authorize another attempt.

## Remaining qualification

Offline correction checks: **504 unit files / 13,581 tests** passed, including 59 cleanup driver/
entry cases and the four new fixture/refusal regressions. All three TypeScript projects, build,
lint (three existing informational findings), policy validation, strict documentation and all
59 historical qualification scenarios passed. These remain offline checks; the separate native cleanup evidence is described above.

Current-code PP with two SAP writers, recording transports, full declarative lifecycle, remaining
object/resource families and final review remain open. Native evidence here covers only this
local direct-Basic create/save/lock/unlock and failed activation. Public function/declarative
mutations remain closed, as do all aggregate, Basic, Copilot and read-only-route mutations.

The requested Claude session limit was reached after this review; Codex continued the corrections
and cleanup preparation. Neither a limit-truncated Claude session nor a passing mock suite is
reported as an independent review verdict or native qualification.
