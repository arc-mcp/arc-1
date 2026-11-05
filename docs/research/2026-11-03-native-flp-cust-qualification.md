# Fixed native classic FLP qualification protocol

The [independent review](2026-11-03-native-flp-review-verbatim.md) conditionally approved the fixed
phase chain at `daa4cfe4dbfc3d7f24e596bf876268c97d04aed0`: 339 committed tests and 45 independent
probes passed, with all 4,794 snapshot files unchanged. Both native stages subsequently completed
on 3 November at that exact revision: one create/readback/delete for the empty Page and one for
the empty catalog. The [independent execution audit](2026-11-03-native-flp-execution-audit-verbatim.md)
verified the saved receipts and final zero-lock controls; no owned cleanup blocker remains within
this bounded contract. Both claims are consumed. GET604 remains unknown read absence and CTS
recording remains unverified. This evidence does not admit
public writes, change a deployed destination, establish Principal Propagation or qualify arbitrary
FLP content. The fixed native account is MARIAN on A4H/001 over verified HTTPS; Basic is used only
inside this source-bound experiment, never in a multi-target server route.

## Bounded source contract

The private ledger `pr1142-flp-native-delete-completion-evidence.json` binds 27 payloads in 12
capture packets. Its SHA-256 is `edcfa9086e44ee213c5c60cbe6886ce0a07e1b05a862d2345af66b6d8be8f075`;
the assessment SHA-256 is `55dc5fad68f346c00e34fa50600f9e2667998fec95a70cbc91d85965f8cb3719`.
All proprietary source remains in the operator's private review directory. The protocol rehashes
these payloads, manifests, ledger and assessment, along with its clean reviewed source/runtime
binding. Historical reports retain their existing modes inside the owner-only review directory;
new receipts require owner-only files and reject symlinks. No historical evidence is rewritten.

The ordinary Page CREATE path classifies its source operation as **must not exist**. WD_CONFIG
rejects an existing configuration before modifier access, and CHG_TOOL_BASE repeats the check
under its native enqueue before clearing/preparing data. Catalog creation supplies CREATE to both
its Page and PageConfig accessors. This supports conditional creation without an absence oracle.
A unique name or the lookup's `/UI2/FND/604` is not evidence of creation or absence. Known existing
resources refuse before POST; an unresolved lookup permits only the existing native create-only
adapter, never update/overwrite. The Page stage is a direct collection create, with no PageSet
navigation association. The catalog stage retains its two-part Page plus PageConfig scope.

The captured ordinary CUST DELETE path reaches the exact configuration-key deletion, commits,
then performs change notification and teardown. Empty main-entity handling does not take the
604 early exit. A completed operation in this controlled supported path can establish **native
CUST deletion completion**, independently of read absence. A nonmatching root, unrelated mapped604,
FDM/custom factory replacement, concurrent editing, cancellation or post-commit failure can defeat
that inference. An operator's acknowledgement names these limits; it is not machine proof that an
unobservable branch never exists. Current service metadata must match the captured fingerprint.
These are A4H/758 ordinary-path limits, not universal release or platform claims.

## Fixed owners and order

The permanent root is `~/.local/state/arc1-qualification/pr1142-native-flp-cust-v1`.
The fixed suffix is `3D5C96A8170F42BE`:

| Stage | Native key / owned marker |
| --- | --- |
| Page | `ZARC1_FLP_P_3D5C96A8170F42BE`, title `ARC1 owned empty Page 3D5C96A8170F42BE` |
| Catalog | `X-SAP-UI2-CATALOGPAGE:ZARC1_FLP_C_3D5C96A8170F42BE`, title `ARC1 owned empty catalog 3D5C96A8170F42BE` |

Each stage has a permanent once-only `attempt` directory. The first stage must complete with
native deletion completion and owning-session closure (or no context issued). The catalog then
needs fresh zero-lock controls taken after the Page result. It cannot run after an uncertain Page
result. No automatic cleanup, repair, recreate-as-proof, retry or name rotation follows a failure.
A consumed attempt is preserved even if it stopped before credentials were loaded.

Each stage uses the reviewed private native-governed FLP create entry, registered context and both
explicit unrestricted request policies. It retains shared no-replay, policy, target/client,
read/write and deadline checks. The catalog DELETE also calls the reviewed private entry; its
accepted-but-unverified public-style result is retained as such. The protocol's separate inference
uses the actual successful native response plus the owned lifecycle contract. Page cleanup is an
internal exact-fixture DELETE through the same registered profile and shared transport; it adds no
public group-delete operation, arbitrary bypass or selector.

A successful create requires HTTP 201, JSON without a native diagnostic header, the exact returned
ID/title and native ownership fields, plus matching fresh readback. Before DELETE, full Page (and
Catalog where applicable) data must remain unchanged, with a complete empty tile collection.
The catalog helper additionally creates PageConfig, whose Bag collection must be complete and
empty. Direct Page creation owns only Page; it neither follows nor claims a separate PageConfig.
Results declare these native parts even after an uncertain partial operation. No continuation is
followed. Unknown Bag/metadata shapes leave the fixture retained. The exact same checks run again
at the actual DELETE guard. Native locking and teardown
belong to the ordinary CUST operation; the harness invents no FLP lock endpoint. It closes only its
own HTTP application context through the shared bounded cleanup path and never removes foreign
locks. A missing issued context is explicitly distinguished from successful context closure.

The ordinary path additionally requires a completed HTTP 204 with an empty body and no native
message header. This is the deliberately narrow initial response profile, not a claimed prior
DELETE observation. Other status/body/diagnostic variants remain unresolved. Keyed post-reads are
recorded separately: recognized604 is **lookup unknown**, never `readAbsenceConfirmed=true`.
A still-readable owner, nonmatching identity, unexpected read error, partial catalog operation or
cleanup failure stops progression. Recorded failures may include CTS or committed content effects.
There is no automatic CTS compensation or verified request/task receipt.

## Offline and operator phases

Use only Node 22.21.1 with `--import tsx`, the full independently reviewed revision and the original
clean checkout. Runtime/source guards reject unsafe loader, Git, diagnostics and trust overrides.
Prepare and check do not import the native runtime or read `.env`. Execution loads the fixed
credentials only after the durable claim and repeated prerequisite checks. This document supplies
phase syntax for later review; authoring it grants no permission to execute.

```text
node --import tsx scripts/qualification/pr1142/native-flp-cust.ts --prepare-reviewed-flp <full-reviewed-sha>
node --import tsx scripts/qualification/pr1142/native-flp-cust.ts --check-reviewed-flp-page <full-reviewed-sha>
node --import tsx scripts/qualification/pr1142/native-flp-cust.ts --execute-reviewed-flp-page <full-reviewed-sha>
node --import tsx scripts/qualification/pr1142/native-flp-cust.ts --check-reviewed-flp-catalog <full-reviewed-sha>
node --import tsx scripts/qualification/pr1142/native-flp-cust.ts --execute-reviewed-flp-catalog <full-reviewed-sha>
node --import tsx scripts/qualification/pr1142/native-flp-cust.ts --verify-reviewed-flp-cleanup <full-reviewed-sha>
```

For each stage, and for `final`, preserve actual unmodified JPEG captures as
`<stage>/prerequisites/sm12-suffix.jpg` and `sm12-user.jpg`, plus `sm12-baseline.json`. Files must be
0600. Both captures must be newer than the prepare intent; catalog/final captures must also be
newer than the immediately preceding successful result. Both must be no older than five minutes.
The JSON's exact fields are:

```json
{
  "protocol": "pr1142-native-flp-cust-v1",
  "stage": "page",
  "revision": "<full reviewed SHA>",
  "intentHash": "<intent.json SHA-256>",
  "previousResultHash": null,
  "ordinaryCustSourceContractAcknowledged": true,
  "noConcurrentFixtureEditing": true,
  "suffixSearch": {
    "observedAt": "<actual UTC observation time>", "client": "001", "user": "*",
    "table": "*", "argument": "*3D5C96A8170F42BE*", "lockCount": 0,
    "evidenceSha256": "<actual sm12-suffix.jpg SHA-256>"
  },
  "userSearch": {
    "observedAt": "<actual UTC observation time>", "client": "001", "user": "MARIAN",
    "table": "*", "argument": "*", "lockCount": 0,
    "evidenceSha256": "<actual sm12-user.jpg SHA-256>"
  }
}
```

For catalog, `previousResultHash` is the Page's exact `attempt/result.json` SHA-256. For final it is
the catalog result hash. The catalog receipt also binds its preceding Page result, so the final
check detects subsequent changes to either result. Screenshot signature checks do not interpret
SM12; the operator supplies the actual observed counts and filters. Preserve the images and all
JSON/journal records. No new universal absence API, SQL, RFC or installed helper is used.

Each stage shares a 120-second deadline, clamped to the original screenshot expiry, 48 attempts
and 2 MiB across all responses. Native calls also retain the existing 30-second per-request clamp.
Freshness never becomes optional after an observer logs mutation intent: it is rechecked after
queue/authentication waits and final synchronous binding work at the actual send boundary. The
HTTP layer rechecks the effective narrower deadline. Owning-session cleanup has its separate
30-second/64-KiB allowance and remains available after expiry or cancellation.

Only final fresh zero-lock controls can complete the independent cleanup check. Even then,
`readAbsenceConfirmed` remains false and recording remains `native-governed-unverified`. Source
proof, synthetic unit results and operator acknowledgements do not become PP identity evidence.
The audited successful responses qualify this bounded ordinary empty-content lifecycle only.
Verified recording, duplicate/refusal and populated-content experiments, current-build two-writer
PP and public admission remain separate qualification work. FEAT-93 retains those gaps.
