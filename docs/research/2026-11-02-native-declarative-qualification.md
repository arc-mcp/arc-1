# Proposed one-run native CDS/RAP qualification

Status: **historical v1 proposal, now consumed**. The one native attempt failed and its retained
DDLS was removed by separately reviewed cleanup. Preserve this original design history; use the
[failure/recovery record](2026-11-02-native-declarative-failure-and-recovery.md) for the actual outcome.
The [new fixed v2 candidate](2026-11-02-native-declarative-v2.md) awaits independent review and has
no native-run approval. Do not execute the historical v1 commands.

This is a native protocol sample on A4H/001 as MARIAN using Basic authentication. It is not PP,
recording-transport or other-release qualification, and it does not enable public mutation routes.

## Selected resources and workflow

Six fresh `$TMP` resources use one 16-hex random suffix: a CDS root view over SFLIGHT, a separate
root abstract entity, DCLS, DDLX, abstract BDEF and SRVD. The abstract BDEF has no implementation
class. There is no service binding/publication, table-data write or ABAP execution. Source declarations
and dependency edges are fixed in `scripts/qualification/pr1142/native-declarative-fixtures.ts`.
DCLS carries the fixture label explicitly, as do the base DDLS and SRVD sources.

Before any mutation, require typed native absence of all owners and a valid inactive-object inventory
without the suffix. Each owner then completes create → activate → comment-only update → activate
before the next owner is created. Cleanup runs in reverse dependency order. An uncertain create,
save, activation or deletion preserves that owner and its full base dependency closure; other owned
independent fixtures may be cleaned. A create is treated as never sent only when the observer saw no
create POST and the adapter reports `unchanged`; only then does its base stay eligible for cleanup.
Explicit stop prevents further forward and deletion mutations, including a stop arriving during the
deletion guard reads. A validated own UNLOCK and bounded session close remain available after a stop
or a source-binding failure, on the exact selected owner, handle and query shape only.

The private CRUD and activation entrypoints are the actual implementations under qualification.
Separate stateless reads verify exact native identity, `$TMP`, fixture description, any reported
author, source bytes and complete canonical metadata. Active receipts additionally capture explicit
active metadata. Before update/activation/deletion, these receipts must still agree. Extra deletion
verification occurs while the production deletion owns its lock, using the stateless connection;
all dependent children must already be typed-absent. This is bounded observational evidence, not an
atomic snapshot across SAP requests. A native metadata or newline variant can refuse conservatively.

## Execution envelope

- `native-declarative-contract.ts` requires a full reviewed commit, the real clean checkout, exact
  tracked entry/source binding and safe runtime flags before credential loading. It also refuses
  `NODE_EXTRA_CA_CERTS`, `NODE_USE_SYSTEM_CA`, `NODE_PATH` and any `TSX_*`. The fixed exclusive
  claim is `~/.local/state/arc1-qualification/pr1142-native-declarative-v1`; never repeat a claimed run.
- `native-declarative-preflight.ts` is the separate GET-only prerequisite. It uses fresh names, holds
  only a `get` method, has its own state directory and cannot create the claim above.
- Bind only HTTPS `https://a4h.marianzeis.de`, client `001`, user `MARIAN`, TLS verification on. Load
  existing local credentials without writing them to receipts. Force `$TMP`, no recording requests,
  and private native-only write safety. Lint/check-before-write are off for this protocol experiment;
  offline quality guards remain separately tested. No Git, extensions or production app config change.
- The workflow has a 12-minute envelope with four minutes reserved from forward work for cleanup.
  Individual adapter phases use at most 60 seconds; native HTTP requests use at most 30 seconds,
  no replay/transient retry, and at most 2 MiB counting all responses. Production adapter limits may
  be smaller. Owning-session cleanup retains its independent bounded reserve. Final independent
  absence confirmation adds up to 60 seconds. Slow SAP can still leave an honestly unconfirmed result.
- Only the selected fixture may be created, locked, updated, activated or deleted. Source PUTs must
  match its fixed initial or comment-update text. Activation references stay on that single owner.
  Reject extra/duplicate mutation query fields, foreign/normalized paths and client/user overrides.
  CTS check packets are canonical exact-owner/local-package requests; no CTS management is allowed.
- Share the historical request observer and request policy through `native-observed-http.ts`, while
  retaining the old function experiment's own request validator and public exports. This is a refactor
  of observation, not permission to repeat either consumed function experiment.
- Persist owner-only manifest, intent/result journal and final result. Never capture authorization
  headers, cookies or lock handles. Confirm typed absence plus inactive-inventory absence after cleanup
  and independently at the entrypoint. If inspection is required, preserve receipts and do not retry.
- Independent reads journal status, media type, size, hash and permitted body **before** any check.
  Owner metadata, source and typed error bodies are retained up to 1 MiB; an untyped error keeps
  its hash and the inactive inventory stays hash-only on every path. `AdtApiError` carries no response
  headers, so an error row has no media type. Refusals use one closed vocabulary of reasons
  (`DeclarativeReason`), and other exceptions become `unclassified`, so no raw message reaches a receipt.
- A post-claim configuration refusal journals a fixed reason and invalid field names, then writes a
  no-mutation `result.json`. Stop signals are journaled.

A successful native run still needs independent fresh lock-inventory controls and review of the
receipts before admission. Existing owned native fixtures are absent; this run has not claimed a
namespace or created any SAP object yet.

## Results

`failure: false` and `cleanupUnconfirmed: false` in `result.json` together define a pass, which then
needs the external lock control. The other fields explain a failure and never relax it:

| Field | Meaning |
| --- | --- |
| `mutationAttempted` | A non-read request other than the CTS check left the observer, whatever its outcome. When false, `cleanupUnconfirmed` is false because nothing needs cleanup; `failure` stays true. |
| `pendingCreation` | A create POST was sent, or it could not be excluded. Its outcome is unknown, even after a rejection: no absence is inferred from an error. |
| `createNeverSent` | Positive evidence that this create left no native object. |
| `remaining` | Owners still believed present. |
| `confirmedDeleted` | Owners with adapter and independent typed absence, including any whose cleanup then failed. |
| `cleanupIssues` | A deletion step failed for this owner, or its lock/session stayed unconfirmed. |
| `cleanupNotAttempted` | No cleanup request was attempted, for example after a stop. Its bases stay preserved. |
| `inspectionRequired` | Uncertain owners and their full base closure. |
| `finalAbsenceConfirmed` | The workflow's own typed-absence and inventory check. A later failure elsewhere does not erase it. |
| `independentAbsence` | The entry's separate second check: `confirmed`, `unconfirmed` or `not-run`. A pass requires `confirmed`. |

## Offline evidence and limits

Tests cover the exact dependency graph and both source versions; pure workflow stop/failure/cleanup
states; exact request guards; six complete lifecycles through real adapters with mocked HTTP; unknown
save preservation; cleanup after stop; lingering inactive evidence; safe entrypoint/claim ordering;
and the historical function observer regressions. Only DDLS fixture syntax reaches a local parser.
BDEF/DDLX rules are limited, DCLS/SRVD have no local grammar validation, and A4H compilation remains
unproven. No mocked source/version behavior is promoted to native evidence.

During test development, the native mock needed the requested CTS operation echoed back, and the
request fence needed the actual BDEF `_package` query key. Final-inventory failure now asserts that
all six deletions occurred, avoiding an earlier-failure false positive. These were offline corrections.
The complete checkpoint checks and independent review must precede the first live execution.

The [review 23 follow-up](2026-11-02-native-declarative-harness-review-followup.md) adds exact-reason
rows for each independent check, drift that appears only after the prior check, a live child seen only
under the base lock, the forward/cleanup/phase deadlines, the fixture labels, this entry's binding and
the result fields. All of them are mocks or isolated local Git; none is native evidence.
